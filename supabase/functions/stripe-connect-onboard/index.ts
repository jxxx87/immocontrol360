/**
 * stripe-connect-onboard
 *
 * Edge function to onboard a user onto Stripe Connect Express.
 *
 * Komplett-Check 2026-11-27 (E3-15, E3-19, E3-20, E3-22):
 * - Nutzer nur aus dem Authorization-Header (Nutzer-JWT, role=anon zählt nicht).
 * - Mieter-Konten dürfen kein Connect-Konto anlegen; ohne Profilzeile wird kein Konto angelegt.
 * - Body wird VOR jedem Seiteneffekt gelesen; Redirect-Ziele nur eigene Origins.
 * - Kontoanlage mit Idempotency-Key, Profil-Update wird auf tatsächlich geänderte Zeile geprüft.
 *
 * Wave 4 (E3-21): eingebautes Deno.serve statt deno.land/std@0.131.0 (keine externen Importe mehr).
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// ─── Erlaubte Rücksprung-Ziele ───
const APP_URL = (Deno.env.get("APP_URL") ?? "https://app.immocontrol360.de").replace(/\/+$/, "");
const ALLOWED_ORIGINS = new Set<string>([
    safeOrigin(APP_URL),
    "https://app.immocontrol360.de",
    "https://immocontrol360.de",
    "https://www.immocontrol360.de",
    "https://localhost",          // Capacitor (Android, androidScheme https)
    "capacitor://localhost",      // Capacitor (iOS)
    ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
].filter(Boolean));

function safeOrigin(url: string): string {
    try { return new URL(url).origin; } catch { return ""; }
}

function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    if (ALLOWED_ORIGINS.has(origin)) return true;
    // Lokale Entwicklung (Vite wählt ggf. einen anderen Port)
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}

function resolveBaseUrl(bodyOrigin: unknown, req: Request): string {
    const candidates = [typeof bodyOrigin === "string" ? safeOrigin(bodyOrigin) : "", req.headers.get("origin") ?? ""];
    for (const c of candidates) {
        if (isAllowedOrigin(c)) return c;
    }
    return APP_URL;
}

// ─── Authentifizierung (Vertrag C2) ───
function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

/** Ermittelt den angemeldeten Nutzer aus dem Authorization-Header oder null. */
async function getAuthenticatedUser(req: Request): Promise<{ id: string; email: string | null } | null> {
    const header = req.headers.get("Authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const jwt = match[1].trim();

    // Vorfilter: öffentlicher Schlüssel (role=anon), Service-Key oder anonyme Konten zählen nicht.
    const claims = decodeJwtPayload(jwt);
    if (!claims || claims.role !== "authenticated" || typeof claims.sub !== "string" || claims.is_anonymous === true) {
        return null;
    }

    // Eigentliche Prüfung (Signatur/Ablauf) durch Supabase Auth.
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY || SUPABASE_KEY,
            Authorization: `Bearer ${jwt}`,
        },
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    if (!user?.id || user.id !== claims.sub) return null;
    return { id: user.id, email: user.email ?? null };
}

/** Fehler, deren Text an den Aufrufer gehen darf. */
class PublicError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

async function stripePost(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<any> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${STRIPE_SECRET}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2022-11-15",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "POST",
        headers,
        body: new URLSearchParams(params).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
}

async function stripeGet(path: string): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Stripe-Version": "2022-11-15",
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
}

const serviceHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Get user authentication
        const authUser = await getAuthenticatedUser(req);
        if (!authUser) {
            throw new PublicError("Bitte melde dich an.", 401);
        }
        const userId = authUser.id;
        const email = authUser.email;

        // Body zuerst lesen (leerer Body ist erlaubt)
        const body = await req.json().catch(() => ({}));
        const baseUrl = resolveBaseUrl(body?.origin, req);

        // 2. Rolle prüfen: Mieter-Konten verwalten keine Forderungen
        const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}&select=role`, {
            headers: serviceHeaders,
        });
        const roles = await roleRes.json().catch(() => null);
        if (!roleRes.ok) {
            throw new Error("Failed to load user role");
        }
        if (Array.isArray(roles) && roles.some((r: any) => r?.role === "tenant")) {
            throw new PublicError("Online-Zahlungen können nur von Vermieter-Konten eingerichtet werden.", 403);
        }

        // 3. Fetch the user's profile from the database
        const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,stripe_connect_id`, {
            headers: serviceHeaders,
        });
        const profileData = await profileRes.json().catch(() => null);
        if (!profileRes.ok) {
            throw new Error("Failed to load profile from database");
        }
        if (!Array.isArray(profileData) || profileData.length === 0) {
            throw new PublicError("Bitte vervollständige zuerst dein Profil in den Einstellungen.", 409);
        }

        let stripeConnectId = profileData[0]?.stripe_connect_id;
        let isAlreadyEnabled = false;

        if (stripeConnectId) {
            console.log(`Checking status for existing Stripe Connect Account: ${stripeConnectId}...`);
            try {
                const account = await stripeGet(`/accounts/${encodeURIComponent(stripeConnectId)}`);
                // Nur Konten akzeptieren, die tatsächlich für diesen Nutzer angelegt wurden
                if (account?.metadata?.supabase_uid && account.metadata.supabase_uid !== userId) {
                    throw new PublicError("Das hinterlegte Stripe-Konto gehört nicht zu deinem Benutzerkonto.", 409);
                }
                const chargesEnabled = account.charges_enabled;
                const detailsSubmitted = account.details_submitted;
                isAlreadyEnabled = !!(chargesEnabled && detailsSubmitted);

                console.log(`Stripe Connect status for ${stripeConnectId}: charges_enabled=${chargesEnabled}, details_submitted=${detailsSubmitted}`);

                // Update database status
                const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
                    method: "PATCH",
                    headers: {
                        ...serviceHeaders,
                        "Content-Type": "application/json",
                        Prefer: "return=minimal",
                    },
                    body: JSON.stringify({
                        stripe_connect_enabled: isAlreadyEnabled,
                        updated_at: new Date().toISOString()
                    }),
                });

                if (!updateRes.ok) {
                    console.error("Failed to update profile connection status in DB");
                }
            } catch (err: any) {
                if (err instanceof PublicError) throw err;
                console.error("Failed to retrieve account status from Stripe:", err.message);
            }
        }

        // If already connected, return early
        if (isAlreadyEnabled) {
            return new Response(JSON.stringify({ url: null, already_connected: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 4. Create Stripe Connect Express Account if not exists
        if (!stripeConnectId) {
            console.log(`Creating Stripe Connect Account for user ${userId}...`);
            const accountParams: Record<string, string> = {
                type: "express",
                country: "DE",
                email: email || "",
                "capabilities[card_payments][requested]": "true",
                "capabilities[transfers][requested]": "true",
                "business_type": "individual",
                "metadata[supabase_uid]": userId,
            };
            // Idempotency-Key verhindert Doppelkonten bei parallelen/wiederholten Aufrufen
            const account = await stripePost("/accounts", accountParams, `connect-account-${userId}`);
            stripeConnectId = account.id;

            console.log(`Saved Stripe Connect ID: ${stripeConnectId}. Updating profile...`);
            // Save stripe_connect_id to profiles table
            const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
                method: "PATCH",
                headers: {
                    ...serviceHeaders,
                    "Content-Type": "application/json",
                    Prefer: "return=representation",
                },
                body: JSON.stringify({ stripe_connect_id: stripeConnectId }),
            });
            const updated = await updateRes.json().catch(() => null);
            if (!updateRes.ok || !Array.isArray(updated) || updated.length === 0) {
                console.error("Failed to update profile with connect id:", updateRes.status);
                throw new Error("Failed to update profile");
            }
        }

        // 5. Create Account Link for onboarding
        console.log(`Creating account link for account ${stripeConnectId}...`);
        const linkParams: Record<string, string> = {
            account: stripeConnectId,
            refresh_url: `${baseUrl}/forderungen?stripe_status=refresh`,
            return_url: `${baseUrl}/forderungen?stripe_status=success`,
            type: "account_onboarding",
        };
        const accountLink = await stripePost("/account_links", linkParams);

        return new Response(JSON.stringify({ url: accountLink.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const isPublic = error instanceof PublicError;
        const message = isPublic ? (error as PublicError).message : "Die Einrichtung der Online-Zahlung ist fehlgeschlagen.";
        const status = isPublic ? (error as PublicError).status : 400;
        if (!isPublic) console.error("Stripe Connect onboarding error:", error instanceof Error ? error.message : String(error));
        return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
