/**
 * create-portal-checkout-session
 *
 * Edge function to create a Stripe Checkout Session for a tenant (Forderungsportal).
 * Der Schuldner ist NICHT angemeldet – er weist sich mit Portal-Token + PIN aus
 * (Prüfung über die RPC get_public_claim_by_token).
 *
 * Komplett-Check 2026-11-27 (E3-07, E3-10, E3-14, E3-15, E3-16, E3-19, E3-22, E3-23):
 * - Token/PIN werden weder geloggt noch in Stripe-Metadaten gespeichert.
 * - Redirect-Ziele nur auf eigene Origins (sonst feste App-URL).
 * - Vermieter-Einstellung claim_portal_allow_stripe wird serverseitig beachtet.
 * - Kein Zahlungsentgelt mehr für den Zahler (§ 270a BGB): der Zahler zahlt genau den offenen
 *   Betrag; die Plattformgebühr wird – wie bisher als application_fee – vom Auszahlungsbetrag
 *   an den Vermieter einbehalten.
 * - Zahlarten Karte + SEPA-Lastschrift (Sofort ist bei Stripe abgekündigt); Session läuft nach
 *   31 Minuten ab, damit nicht mehrere offene Sessions lange parallel gültig bleiben.
 */

// @ts-ignore
import { serve } from "https://deno.land/std@0.131.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

/** Basis-URL: origin aus Body/Header nur, wenn er zu den eigenen Origins gehört. */
function resolveBaseUrl(bodyOrigin: unknown, req: Request): string {
    const candidates = [typeof bodyOrigin === "string" ? safeOrigin(bodyOrigin) : "", req.headers.get("origin") ?? ""];
    for (const c of candidates) {
        if (isAllowedOrigin(c)) return c;
    }
    return APP_URL;
}

/** Fehler, deren Text an den Aufrufer gehen darf. */
class PublicError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

async function stripePost(path: string, params: Record<string, string>): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2022-11-15",
        },
        body: new URLSearchParams(params).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error("Stripe error:", res.status, data.error?.message);
        throw new PublicError("Die Online-Zahlung konnte nicht gestartet werden.");
    }
    return data;
}

const serviceHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = await req.json().catch(() => null);
        const token = typeof body?.token === "string" ? body.token.trim() : "";
        const pin = typeof body?.pin === "string" ? body.pin.trim() : String(body?.pin ?? "").trim();

        if (!token || !pin || token.length > 256 || pin.length > 64) {
            throw new PublicError("Bitte Zugangscode und PIN angeben.");
        }

        // 1. Validate token & pin by calling get_public_claim_by_token RPC
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_claim_by_token`, {
            method: "POST",
            headers: { ...serviceHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ p_token: token, p_pin: pin })
        });

        if (!rpcRes.ok) {
            console.warn("Portal credential check failed:", rpcRes.status);
            await rpcRes.body?.cancel();
            throw new PublicError("Zugriff verweigert.", 403);
        }

        const claimDetails = await rpcRes.json().catch(() => null);
        const openAmount = Math.round(Number(claimDetails?.totals?.total_due ?? 0) * 100) / 100;

        if (!(openAmount > 0)) {
            throw new PublicError("Es steht kein offener Betrag aus für diese Forderung.");
        }

        const claimId = String(claimDetails?.claim_id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(claimId)) {
            throw new PublicError("Forderung nicht gefunden.", 404);
        }

        // 2. Query claim to get user_id (landlord)
        const claimQueryRes = await fetch(`${SUPABASE_URL}/rest/v1/claims?id=eq.${encodeURIComponent(claimId)}&select=user_id`, {
            headers: serviceHeaders
        });
        const claimData = await claimQueryRes.json().catch(() => null);
        if (!claimQueryRes.ok || !Array.isArray(claimData) || claimData.length === 0) {
            throw new PublicError("Forderung nicht gefunden.", 404);
        }
        const landlordId = claimData[0].user_id;

        // 3. Query profiles to get stripe_connect_id + Vermieter-Freigabe für Online-Zahlung
        const profileRes = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(landlordId)}&select=stripe_connect_id,stripe_connect_enabled,claim_portal_allow_stripe`,
            { headers: serviceHeaders }
        );
        const profileData = await profileRes.json().catch(() => null);
        if (!profileRes.ok || !Array.isArray(profileData) || profileData.length === 0) {
            throw new PublicError("Online-Zahlung ist für diesen Vermieter zurzeit nicht eingerichtet.");
        }

        const stripeConnectId = profileData[0].stripe_connect_id;
        const stripeConnectEnabled = profileData[0].stripe_connect_enabled;
        const allowStripe = profileData[0].claim_portal_allow_stripe;

        if (allowStripe === false) {
            throw new PublicError("Online-Zahlung ist für diese Forderung nicht freigeschaltet.", 403);
        }
        if (!stripeConnectId || !stripeConnectEnabled) {
            throw new PublicError("Online-Zahlung ist für diesen Vermieter zurzeit nicht eingerichtet.");
        }

        // 4. Create Stripe Checkout Session
        const baseUrl = resolveBaseUrl(body?.origin, req);
        const portalPath = `${baseUrl}/forderung/portal/${encodeURIComponent(token)}`;

        const amountCents = Math.round(openAmount * 100);
        // Plattformgebühr (2 % + 0,25 EUR) – wird vom Vermieter-Anteil einbehalten, NICHT dem Zahler berechnet.
        const feeCents = Math.min(
            Math.round((openAmount * 0.02 + 0.25) * 100),
            Math.max(0, amountCents - 1)
        );

        console.log(`Creating Checkout Session for claim ${claimId}. Amount: ${openAmount}, platform fee (landlord): ${feeCents / 100}`);

        const sessionParams: Record<string, string> = {
            "payment_method_types[0]": "card",
            "payment_method_types[1]": "sepa_debit",
            "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][product_data][name]": `Ausstehende Forderung #${claimId.substring(0, 8)}`,
            "line_items[0][price_data][unit_amount]": amountCents.toString(),
            "line_items[0][price_data][product_data][description]": `Online-Bezahlung über Forderungsportal`,
            "line_items[0][quantity]": "1",
            mode: "payment",
            success_url: `${portalPath}?payment=success`,
            cancel_url: `${portalPath}?payment=cancel`,
            expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
            "payment_intent_data[transfer_data][destination]": stripeConnectId,
            "payment_intent_data[application_fee_amount]": feeCents.toString(),
            "payment_intent_data[metadata][claim_id]": claimId,
            "metadata[claim_id]": claimId,
            "metadata[claim_amount]": openAmount.toFixed(2),
            "metadata[payment_type]": "claim_checkout"
        };

        const session = await stripePost("/checkout/sessions", sessionParams);

        return new Response(JSON.stringify({ url: session.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: unknown) {
        const isPublic = error instanceof PublicError;
        const message = isPublic ? (error as PublicError).message : "Die Online-Zahlung konnte nicht gestartet werden.";
        const status = isPublic ? (error as PublicError).status : 400;
        if (!isPublic) console.error("Checkout session creation error:", error instanceof Error ? error.message : String(error));
        return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
