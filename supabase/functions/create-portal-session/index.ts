/**
 * create-portal-session
 *
 * Erstellt eine Stripe Customer Portal Session für den ANGEMELDETEN Nutzer.
 * SDK-frei: Nutzt nur fetch() für Stripe API und Supabase REST API.
 *
 * Sicherheit (Komplett-Check 2026-11-27, E3-03/G03-02/E3-15/E3-19):
 * - Der Nutzer wird ausschließlich aus dem Authorization-Header (Nutzer-JWT) ermittelt.
 *   Ein JWT mit role=anon (öffentlicher Schlüssel) zählt NICHT als angemeldet.
 * - `user_id` im Body wird ignoriert (alte App-Versionen schicken es weiterhin mit).
 * - return_url nur auf eigene Origins, sonst feste App-URL.
 * - Wave 3 (E3-21): eingebautes Deno.serve statt deno.land/std@0.131.0 (keine externen Importe mehr).
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

/** Liefert die return_url nur, wenn sie auf eine eigene Origin zeigt; sonst Standard. */
function resolveReturnUrl(candidate: unknown): string {
    if (typeof candidate === "string" && candidate.length <= 2048) {
        try {
            const u = new URL(candidate);
            if (isAllowedOrigin(u.origin)) return u.toString();
        } catch { /* ungültige URL → Standard */ }
    }
    return `${APP_URL}/settings`;
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

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authUser = await getAuthenticatedUser(req);
        if (!authUser) {
            return json({ error: 'not_authenticated', message: 'Bitte melde dich an, um dein Abo zu verwalten.' }, 401);
        }

        // Body ist optional; user_id daraus wird bewusst ignoriert.
        const body = await req.json().catch(() => ({}));
        const returnUrl = resolveReturnUrl(body?.return_url);

        // 1. stripe_customer_id NUR des Aufrufers laden
        const dbRes = await fetch(
            `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(authUser.id)}&select=stripe_customer_id`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                },
            }
        );
        const rows = await dbRes.json().catch(() => null);

        if (!dbRes.ok) {
            console.error("Subscription lookup failed:", JSON.stringify(rows));
            throw new Error("lookup_failed");
        }

        if (!Array.isArray(rows) || rows.length === 0 || !rows[0].stripe_customer_id) {
            // 200 statt 404, damit alte und neue App-Versionen die Meldung lesen können
            return json({
                error: 'no_customer',
                message: 'Kein aktives Stripe-Konto gefunden. Bitte schließe zuerst ein Abo ab.'
            });
        }

        const customerId = rows[0].stripe_customer_id;

        // 2. Create Stripe Billing Portal Session (via REST API)
        const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${STRIPE_SECRET}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Stripe-Version": "2022-11-15",
            },
            body: new URLSearchParams({
                customer: customerId,
                return_url: returnUrl,
            }).toString(),
        });

        const portalData = await portalRes.json().catch(() => ({}));

        if (!portalRes.ok) {
            console.error("Stripe Portal error:", JSON.stringify(portalData));
            throw new Error("portal_failed");
        }

        console.log(`Portal session created for user ${authUser.id}`);

        return json({ url: portalData.url });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Portal session error:", message);
        return json({ error: 'portal_failed', message: 'Das Stripe-Kundenportal konnte nicht geöffnet werden.' }, 400);
    }
});
