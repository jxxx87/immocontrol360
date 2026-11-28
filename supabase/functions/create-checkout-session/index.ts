/**
 * create-checkout-session
 *
 * Erstellt eine Stripe Checkout Session (Abo) für den ANGEMELDETEN Nutzer.
 * SDK-frei: Nutzt nur fetch() für Stripe API und Supabase REST API.
 *
 * Sicherheit/Logik (Komplett-Check 2026-11-27, E3-06/E3-08/E3-15/E3-19/E3-25/G03-02):
 * - Nutzer und E-Mail kommen ausschließlich aus dem Authorization-Header (Nutzer-JWT);
 *   role=anon zählt nicht als angemeldet. `user_id` im Body wird ignoriert.
 * - Besteht bereits ein laufendes Abo (DB + Stripe), wird KEIN zweites Abo angelegt,
 *   sondern das Stripe-Kundenportal (Planwechsel) zurückgegeben (`already_subscribed`).
 * - Gespeicherter stripe_customer_id wird wiederverwendet; Redirect-Ziele nur eigene Origins.
 * - Wave 3 (E3-13, E3-21): Preis-IDs nur noch in ../_shared/stripePlans.ts (gemeinsam mit
 *   stripe-webhook); eingebautes Deno.serve statt deno.land/std@0.131.0.
 *   Ausrollen: index.ts UND ../_shared/stripePlans.ts hochladen (siehe supabase/config.toml).
 */

import { priceIdFor } from "../_shared/stripePlans.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Stripe-Status, bei denen ein Abo noch läuft bzw. noch verwaltet werden muss
// (kein zweites Abo anlegen). 'incomplete' verfällt nach 23 h von selbst → neuer Checkout erlaubt,
// außer die erste Zahlung wird gerade verarbeitet (z. B. SEPA-Lastschrift).
const RUNNING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

function isRunning(sub: any): boolean {
    if (!sub) return false;
    if (RUNNING_STATUSES.has(sub.status)) return true;
    return sub.status === "incomplete" && sub.latest_invoice?.payment_intent?.status === "processing";
}

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

/** Basis-URL für Redirects: Origin-Header nur, wenn er zu den eigenen Origins gehört. */
function resolveBaseUrl(req: Request): string {
    const origin = req.headers.get("origin") ?? "";
    return isAllowedOrigin(origin) ? origin : APP_URL;
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

// ─── Stripe REST helpers ───
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
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
}

async function stripeGet(path: string): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Stripe-Version": "2022-11-15",
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Stripe error: ${res.status}`);
    return data;
}

/** Bestehende Abo-Zeile des Nutzers (Service-Role). */
async function loadSubscriptionRow(userId: string): Promise<any | null> {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,stripe_customer_id,stripe_subscription_id`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await res.json().catch(() => null);
    if (!res.ok) {
        console.error("Subscription lookup failed:", JSON.stringify(rows));
        throw new Error("Abo-Daten konnten nicht geladen werden.");
    }
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/** Sucht einen vorhandenen Stripe-Kunden des Nutzers (DB → Metadaten → E-Mail). */
async function findCustomerId(userId: string, email: string, row: any | null): Promise<string | null> {
    // 1. In der DB gespeicherter Kunde
    if (row?.stripe_customer_id) {
        try {
            const c = await stripeGet(`/customers/${encodeURIComponent(row.stripe_customer_id)}`);
            if (c?.id && !c.deleted) return c.id;
        } catch (e) {
            console.warn("Stored customer not retrievable:", (e as Error).message);
        }
    }

    // 2. Kunde mit Metadaten supabase_uid (Search-API ist nicht überall verfügbar → optional)
    try {
        const q = encodeURIComponent(`metadata['supabase_uid']:'${userId}'`);
        const found = await stripeGet(`/customers/search?query=${q}&limit=1`);
        if (found?.data?.length > 0) return found.data[0].id;
    } catch (e) {
        console.warn("Customer search unavailable:", (e as Error).message);
    }

    // 3. Kunde mit gleicher E-Mail, aber nur wenn er nicht einem ANDEREN Nutzer zugeordnet ist
    const byEmail = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=10`);
    const candidates = (byEmail?.data ?? []).filter((c: any) => {
        const uid = c?.metadata?.supabase_uid;
        return !uid || uid === userId;
    });
    const exact = candidates.find((c: any) => c?.metadata?.supabase_uid === userId);
    return (exact ?? candidates[0])?.id ?? null;
}

/** Läuft für diesen Kunden bereits ein Abo? (DB-Eintrag + alle Abos des Kunden in Stripe) */
async function findRunningSubscription(customerId: string | null, row: any | null): Promise<any | null> {
    if (row?.stripe_subscription_id) {
        try {
            const sub = await stripeGet(
                `/subscriptions/${encodeURIComponent(row.stripe_subscription_id)}?expand[]=latest_invoice.payment_intent`
            );
            if (isRunning(sub)) return sub;
        } catch (e) {
            console.warn("Stored subscription not retrievable:", (e as Error).message);
        }
    }
    if (customerId) {
        const list = await stripeGet(
            `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20&expand[]=data.latest_invoice.payment_intent`
        );
        const running = (list?.data ?? []).find((s: any) => isRunning(s));
        if (running) return running;
    }
    return null;
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
            return json({ error: 'not_authenticated', message: 'Bitte melde dich an, um ein Abo abzuschließen.' }, 401);
        }
        if (!authUser.email) {
            return json({ error: 'no_email', message: 'Für dein Konto ist keine E-Mail-Adresse hinterlegt.' }, 400);
        }

        // user_id aus dem Body wird bewusst ignoriert (alte App-Versionen senden es noch).
        const body = await req.json().catch(() => ({}));
        const plan_id = typeof body?.plan_id === "string" ? body.plan_id : "";
        const billing_period = typeof body?.billing_period === "string" ? body.billing_period : "";

        const priceId = priceIdFor(plan_id, billing_period);
        if (!priceId) {
            return json({ error: 'invalid_plan', message: 'Ungültiger Tarif oder Abrechnungszeitraum.' }, 400);
        }

        const userId = authUser.id;
        const email = authUser.email;
        const baseUrl = resolveBaseUrl(req);

        // 1. Bestehenden Kunden / bestehendes Abo ermitteln
        const row = await loadSubscriptionRow(userId);
        let customerId = await findCustomerId(userId, email, row);

        const running = await findRunningSubscription(customerId, row);
        if (running) {
            // Kein zweites Abo: Planwechsel über das Stripe-Kundenportal (Proration durch Stripe).
            const portalCustomer = typeof running.customer === "string" ? running.customer : running.customer?.id;
            const portal = await stripePost("/billing_portal/sessions", {
                customer: portalCustomer || customerId || "",
                // ?tab=billing: Einstellungen öffnen direkt „Abrechnung & Abo“ (Settings.jsx)
                return_url: `${baseUrl}/settings?tab=billing`,
            });
            console.log(`User ${userId} already has running subscription ${running.id} (${running.status}) → portal`);
            return json({
                url: portal.url,
                already_subscribed: true,
                message: 'Du hast bereits ein laufendes Abo. Tarifwechsel und Verwaltung erfolgen im Stripe-Kundenportal.',
            });
        }

        // 2. Kunden anlegen, falls noch keiner existiert
        if (!customerId) {
            const newCustomer = await stripePost("/customers", {
                email,
                "metadata[supabase_uid]": userId,
            });
            customerId = newCustomer.id;
        }

        // 3. Create Stripe Checkout Session
        const sessionParams: Record<string, string> = {
            client_reference_id: userId,
            customer: customerId as string,
            "line_items[0][price]": priceId,
            "line_items[0][quantity]": "1",
            mode: "subscription",
            success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/settings?tab=billing`,
            "metadata[user_id]": userId,
            "subscription_data[metadata][user_id]": userId,
            "subscription_data[metadata][plan]": plan_id,
            "subscription_data[metadata][billing_period]": billing_period,
            allow_promotion_codes: "true",
        };

        const session = await stripePost("/checkout/sessions", sessionParams);

        console.log(`Checkout session created: ${session.id} for user ${userId}`);

        return json({ url: session.url });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Checkout session error:", message);
        return json({ error: 'checkout_failed', message: 'Der Checkout konnte nicht gestartet werden. Bitte versuche es später erneut.' }, 400);
    }
});
