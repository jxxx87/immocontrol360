/**
 * register-trial
 *
 * Legt ein NEUES Konto an und vergibt einmalig die 10-tägige Testphase.
 * Läuft bewusst ohne Anmeldung (das Konto existiert ja noch nicht).
 * SDK-frei: Nutzt nur fetch() für Supabase Auth/REST API.
 *
 * Sicherheit (Komplett-Check 2026-11-27, E3-01/G01-03/E3-17/E3-18/E3-04/G01-02/D3a-04):
 * - Bestehende Konten werden NIE angefasst (kein Reset auf Testphase, keine Auto-Bestätigung,
 *   kein Passwort). Existiert die E-Mail, antwortet die Funktion genauso wie bei einem neuen Konto.
 * - Es wird keine Nutzer-ID zurückgegeben.
 * - Tarif nur aus der erlaubten Liste; E-Mail/Passwort werden auf Plausibilität geprüft.
 * - Missbrauchsbremse: Begrenzung pro E-Mail-Domain und gesamt pro Stunde
 *   (RPC register_trial_rate_check; fällt auf eine globale Zählung zurück, solange die RPC fehlt).
 * - E-Mail-Bestätigung (Double-Opt-In): mit Env REGISTER_TRIAL_CONFIRM_EMAIL=true wird das Konto
 *   über die normale Supabase-Registrierung angelegt und erst nach Klick auf den Bestätigungslink
 *   nutzbar. Voraussetzung: funktionierender E-Mail-Versand in Supabase Auth (eigener SMTP).
 *   Ohne die Variable bleibt es beim bisherigen Sofort-Zugang – aber nur für NEUE Adressen.
 *
 * Wave 4 (E3-21): eingebautes Deno.serve statt deno.land/std@0.131.0 (keine externen Importe mehr).
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://app.immocontrol360.de").replace(/\/+$/, "");
const CONFIRM_EMAIL = (Deno.env.get("REGISTER_TRIAL_CONFIRM_EMAIL") ?? "").trim().toLowerCase() === "true";

const ALLOWED_PLANS = new Set(["starter", "professional", "business"]);
const TRIAL_DAYS = 10;
// Rückfall-Grenze, solange die RPC register_trial_rate_check noch nicht eingespielt ist
const FALLBACK_TRIALS_PER_HOUR = 30;
// Wie MIN_PASSWORD_LENGTH in der App (Registrierung, Einstellungen, Passwort zurücksetzen)
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const serviceHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

/** Fehler weiterhin mit 200 + success:false, damit die App die Meldung lesen kann. */
function fail(message: string): Response {
    return json({ success: false, error: message });
}

type AuthOutcome =
    | { kind: "created"; userId: string; hasSession: boolean }
    | { kind: "exists" }
    | { kind: "weak_password" }
    | { kind: "invalid_email" }
    | { kind: "rate_limited" }
    | { kind: "error" };

function classifyAuthError(status: number, data: any): AuthOutcome {
    const code = String(data?.error_code ?? data?.code ?? "").toLowerCase();
    const msg = String(data?.msg ?? data?.message ?? data?.error_description ?? data?.error ?? "").toLowerCase();
    if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/.test(msg)) {
        return { kind: "exists" };
    }
    if (code === "weak_password" || /password/.test(msg)) return { kind: "weak_password" };
    if (code === "email_address_invalid" || /invalid.*email|email.*invalid/.test(msg)) return { kind: "invalid_email" };
    if (status === 429 || code.startsWith("over_") || /rate limit/.test(msg)) return { kind: "rate_limited" };
    console.error("Auth error:", status, code, msg);
    return { kind: "error" };
}

/** Bisheriger Weg: Konto sofort bestätigt anlegen – schlägt für bestehende Adressen fehl. */
async function createConfirmedUser(email: string, password: string, fullName: string): Promise<AuthOutcome> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName },
        }),
    });
    const data = await res.json().catch(() => ({}));
    const user = data?.user ?? data;
    if (res.ok && user?.id) return { kind: "created", userId: user.id, hasSession: false };
    return classifyAuthError(res.status, data);
}

/** Double-Opt-In: normale Registrierung, Supabase verschickt den Bestätigungslink. */
async function signUpWithConfirmation(email: string, password: string, fullName: string): Promise<AuthOutcome> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(APP_URL + "/")}`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, data: { full_name: fullName } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return classifyAuthError(res.status, data);

    const user = data?.user ?? data;
    const hasSession = !!data?.access_token;
    // Bei bereits registrierter Adresse liefert Supabase einen Platzhalter ohne Identitäten
    // (bzw. das bestehende unbestätigte Konto) – das darf keine Testphase bekommen.
    const createdAt = Date.parse(user?.created_at ?? "");
    const isNew = !!user?.id
        && Array.isArray(user.identities) && user.identities.length > 0
        && Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000;
    return isNew ? { kind: "created", userId: user.id, hasSession } : { kind: "exists" };
}

/** Missbrauchsbremse. true = Anfrage ablehnen. Bei technischen Fehlern wird nicht blockiert. */
async function isRateLimited(email: string): Promise<boolean> {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_trial_rate_check`, {
            method: "POST",
            headers: serviceHeaders,
            body: JSON.stringify({ p_email: email }),
        });
        if (res.ok) {
            const verdict = await res.json().catch(() => "ok");
            return verdict !== "ok";
        }
        const txt = await res.text();
        if (!(res.status === 404 || txt.includes("PGRST202"))) {
            console.error("Rate check RPC failed:", res.status, txt);
            return false;
        }
    } catch (e) {
        console.error("Rate check RPC error:", (e as Error).message);
        return false;
    }

    // Rückfall (RPC noch nicht eingespielt): globale Zahl neuer Testphasen in der letzten Stunde
    try {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/subscriptions?select=id&status=eq.trialing&stripe_customer_id=is.null&created_at=gte.${encodeURIComponent(since)}`,
            { headers: { ...serviceHeaders, Prefer: "count=exact", Range: "0-0" } }
        );
        const range = res.headers.get("content-range") ?? "";
        const total = parseInt(range.split("/")[1] ?? "", 10);
        await res.body?.cancel();
        return Number.isFinite(total) && total >= FALLBACK_TRIALS_PER_HOUR;
    } catch (e) {
        console.error("Rate check fallback error:", (e as Error).message);
        return false;
    }
}

/** Testphase nur einmalig anlegen – eine vorhandene Zeile wird nie überschrieben. */
async function insertTrial(userId: string, plan: string): Promise<boolean> {
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
        method: "POST",
        headers: { ...serviceHeaders, Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: userId, plan, status: "trialing", trial_ends_at: trialEnd }),
    });
    if (!res.ok) {
        console.error("Trial insert failed:", res.status, await res.text());
        return false;
    }
    await res.body?.cancel();
    return true;
}

async function deleteUser(userId: string): Promise<void> {
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
            method: "DELETE",
            headers: serviceHeaders,
        });
        await res.body?.cancel();
    } catch (e) {
        console.error("Cleanup of new user failed:", (e as Error).message);
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return json({ success: false, error: 'Methode nicht erlaubt.' }, 405);
    }

    try {
        const body = await req.json().catch(() => null);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        const plan = typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "";
        const fullName = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, 200) : "";

        // ── Plausibilitätsprüfung ──
        if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
            return fail("Bitte gib eine gültige E-Mail-Adresse ein.");
        }
        if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
            return fail(`Das Passwort muss zwischen ${MIN_PASSWORD_LENGTH} und ${MAX_PASSWORD_LENGTH} Zeichen lang sein.`);
        }
        if (!ALLOWED_PLANS.has(plan)) {
            return fail("Ungültiger Tarif.");
        }

        // ── Missbrauchsbremse ──
        if (await isRateLimited(email)) {
            return fail("Zu viele Registrierungen in kurzer Zeit. Bitte versuche es später erneut.");
        }

        // ── Konto anlegen (bestehende Konten bleiben unangetastet) ──
        const outcome = CONFIRM_EMAIL
            ? await signUpWithConfirmation(email, password, fullName)
            : await createConfirmedUser(email, password, fullName);

        switch (outcome.kind) {
            case "weak_password":
                return fail("Das Passwort ist zu schwach. Bitte wähle ein längeres bzw. sichereres Passwort.");
            case "invalid_email":
                return fail("Bitte gib eine gültige E-Mail-Adresse ein.");
            case "rate_limited":
                return fail("Zu viele Registrierungen in kurzer Zeit. Bitte versuche es später erneut.");
            case "error":
                return fail("Registrierung fehlgeschlagen. Bitte versuche es später erneut.");
            case "created": {
                const ok = await insertTrial(outcome.userId, plan);
                if (!ok) {
                    // Frisch angelegtes Konto wieder entfernen, damit ein neuer Versuch möglich ist
                    await deleteUser(outcome.userId);
                    return fail("Registrierung fehlgeschlagen. Bitte versuche es später erneut.");
                }
                console.log(`Trial registered for new user ${outcome.userId} (plan ${plan})`);
                return json({ success: true, confirmation_required: CONFIRM_EMAIL && !outcome.hasSession });
            }
            case "exists":
            default:
                // Einheitliche Antwort – verrät nicht, ob die Adresse schon registriert ist.
                // Das bestehende Konto (inkl. Abo) wird nicht verändert.
                return json({ success: true, confirmation_required: CONFIRM_EMAIL });
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Register & trial error:", message);
        return fail("Registrierung fehlgeschlagen. Bitte versuche es später erneut.");
    }
});
