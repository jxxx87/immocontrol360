// @ts-ignore
import { serve } from "https://deno.land/std@0.131.0/http/server.ts";

/**
 * stripe-webhook
 *
 * Komplett-Check 2026-11-27 (E3-07, E3-09, E3-11, E3-12, E3-13, E3-22, G03-13):
 * - Signaturprüfung gegen ein ODER mehrere Signing-Secrets (Plattform + optional Connect),
 *   Vergleich in konstanter Zeit, keine Fehlerdetails in den Antworten.
 *   Von verbundenen Konten (event.account) wird nur account.updated verarbeitet.
 * - Forderungszahlungen werden nur gebucht, wenn das Geld tatsächlich eingegangen ist
 *   (payment_status = 'paid'); verzögerte Zahlarten über checkout.session.async_payment_succeeded.
 *   Doppelte Zustellung wird über die Checkout-Session-ID in der Zahlungsnotiz erkannt.
 * - Abo-Status wird auf die bekannte Stripe-Statusmenge abgebildet; DB-Fehler führen zu 500
 *   (Stripe wiederholt), fehlende Zeilen werden über metadata.user_id / stripe_customer_id gefunden.
 * - Tarif nur aus Preis-Mapping bzw. erlaubten Metadaten (starter/professional/business).
 */

// ─── Config ───
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Plattform-Endpunkt und (optional) eigener Connect-Endpunkt haben je ein Secret
const WEBHOOK_SECRETS = [
    Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET") ?? "",
    Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "",
].filter(Boolean);

const ALLOWED_PLANS = new Set(["starter", "professional", "business"]);
const KNOWN_STATUSES = new Set([
    "trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused",
]);
// Abos, die noch laufen (Zugang/Verwaltung nötig)
const RUNNING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Price ID → Plan mapping ───
// Hinweis: identisch in create-checkout-session (PRICE_IDS) gepflegt.
const PRICE_TO_PLAN: Record<string, string> = {
    "price_1T1GauFpRUY7TQZUpmxwYOJb": "starter",
    "price_1T1l3oFpRUY7TQZUtwi16wzf": "starter",
    "price_1T1GbJFpRUY7TQZUPASgpSTz": "professional",
    "price_1T1l37FpRUY7TQZUwCuCfubf": "professional",
    "price_1T1GbhFpRUY7TQZUtvTFLgI7": "business",
    "price_1T1l1xFpRUY7TQZUIEG7ATgZ": "business",
};

// ─── Stripe Webhook Signature Verification (Web Crypto) ───
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

async function verifyStripeSignature(
    payload: string,
    sigHeader: string,
    secrets: string[],
    tolerance = 300
): Promise<boolean> {
    let timestamp = "";
    const signatures: string[] = [];

    for (const part of sigHeader.split(",")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key === "t") timestamp = value;
        if (key === "v1") signatures.push(value);
    }

    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || signatures.length === 0) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > tolerance) {
        console.error(`Webhook timestamp outside tolerance (${now - ts}s)`);
        return false;
    }

    const signedPayload = `${timestamp}.${payload}`;
    for (const secret of secrets) {
        const expected = await hmacHex(secret, signedPayload);
        if (signatures.some((s) => timingSafeEqual(s, expected))) return true;
    }
    return false;
}

// ─── Safe date conversion ───
function toISO(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "number") {
        return value > 946684800 ? new Date(value * 1000).toISOString() : null;
    }
    if (typeof value === "string") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
}

/** Kalenderdatum (YYYY-MM-DD) in Europe/Berlin für einen Unix-Zeitstempel. */
function berlinDate(unixSeconds: unknown): string {
    const ms = typeof unixSeconds === "number" && unixSeconds > 0 ? unixSeconds * 1000 : Date.now();
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ms));
}

function mapStatus(status: unknown): string {
    const s = String(status ?? "");
    if (KNOWN_STATUSES.has(s)) return s;
    console.error(`ALARM: unknown Stripe subscription status "${s}" → stored as incomplete`);
    return "incomplete";
}

// ─── Stripe REST API (no SDK) ───
async function stripeGet(path: string): Promise<any> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET}`,
            "Stripe-Version": "2022-11-15",
        },
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Stripe API error (${res.status}): ${txt}`);
    }
    return res.json();
}

// ─── Supabase REST API (no SDK) ───
type SbResult = { ok: boolean; status: number; data: any; text: string };

async function sb(path: string, init: RequestInit = {}): Promise<SbResult> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            ...((init.headers as Record<string, string>) ?? {}),
        },
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, text };
}

/**
 * Schreibt in subscriptions. Die Spalte cancel_at_period_end ist neu (100500_sec_subscriptions.sql);
 * fehlt sie noch, wird ohne sie erneut geschrieben.
 */
async function writeSubscription(
    write: (body: Record<string, unknown>) => Promise<SbResult>,
    body: Record<string, unknown>
): Promise<SbResult> {
    let r = await write(body);
    if (!r.ok && "cancel_at_period_end" in body && /PGRST204|cancel_at_period_end/.test(r.text)) {
        const { cancel_at_period_end: _omit, ...rest } = body;
        r = await write(rest);
    }
    return r;
}

async function upsertSubscription(body: Record<string, unknown>): Promise<SbResult> {
    return writeSubscription((b) => sb("subscriptions?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(b),
    }), body);
}

async function updateSubscriptionByUser(userId: string, body: Record<string, unknown>): Promise<SbResult> {
    return writeSubscription((b) => sb(`subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(b),
    }), body);
}

async function findSubscriptionRow(column: string, value: string): Promise<any | null> {
    const r = await sb(`subscriptions?${column}=eq.${encodeURIComponent(value)}&select=user_id,plan,status,stripe_subscription_id`);
    if (!r.ok) throw new Error(`Subscription lookup failed (${r.status})`);
    return Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null;
}

/** Tarif nur aus Preis-Mapping oder erlaubten Metadaten; sonst `fallback` (mit Alarm im Log). */
async function resolvePlan(sub: any, fallback: string | null): Promise<string | null> {
    const price = sub.items?.data?.[0]?.price;
    const mapped = PRICE_TO_PLAN[price?.id];
    if (mapped) return mapped;

    const metaPlan = String(sub.metadata?.plan ?? "").toLowerCase();
    if (ALLOWED_PLANS.has(metaPlan)) {
        console.warn(`Price ${price?.id} not mapped – using subscription metadata plan "${metaPlan}"`);
        return metaPlan;
    }

    const productId = typeof price?.product === "string" ? price.product : price?.product?.id;
    if (productId) {
        try {
            const product = await stripeGet(`/products/${encodeURIComponent(productId)}`);
            const productPlan = String(product.metadata?.plan_id ?? "").toLowerCase();
            if (ALLOWED_PLANS.has(productPlan)) return productPlan;
        } catch (_e) { /* ignore */ }
    }

    console.error(`ALARM: unknown price ${price?.id} (product ${productId}) – plan fallback "${fallback}". Bitte PRICE_TO_PLAN ergänzen.`);
    return fallback;
}

// ─── Forderungszahlung (Forderungsportal) ───
async function bookClaimPayment(session: any, eventCreated: number): Promise<void> {
    const claimId = session.metadata?.claim_id;
    if (typeof claimId !== "string" || !UUID_RE.test(claimId)) {
        console.error(`Claim checkout ${session.id} without valid claim_id – nothing booked`);
        return;
    }
    if (session.payment_status !== "paid") {
        console.log(`Claim checkout ${session.id}: payment_status=${session.payment_status} → wait for async_payment_succeeded`);
        return;
    }

    // Idempotenz: dieselbe Checkout-Session nie zweimal buchen
    const sessionId = String(session.id ?? "");
    if (!/^[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("Invalid session id");
    const existing = await sb(`claim_payments?claim_id=eq.${claimId}&note=like.*${sessionId}*&select=id&limit=1`);
    if (!existing.ok) throw new Error(`claim_payments lookup failed (${existing.status})`);
    if (Array.isArray(existing.data) && existing.data.length > 0) {
        console.log(`Claim checkout ${sessionId} already booked – skipping duplicate delivery`);
        return;
    }

    const metaAmount = parseFloat(session.metadata?.claim_amount ?? "");
    const amount = Number.isFinite(metaAmount) && metaAmount > 0
        ? Math.round(metaAmount * 100) / 100
        : Math.round(Number(session.amount_total ?? 0)) / 100;
    if (!(amount > 0)) {
        console.error(`Claim checkout ${sessionId}: no positive amount – nothing booked`);
        return;
    }

    console.log(`Processing claim checkout payment: claimId=${claimId}, amount=${amount}`);

    const rpc = await sb("rpc/record_claim_payment", {
        method: "POST",
        body: JSON.stringify({
            p_claim_id: claimId,
            p_payment_date: berlinDate(eventCreated || session.created),
            p_amount: amount,
            p_note: `Online-Zahlung via Stripe Checkout (${sessionId})`,
            p_installment_id: null,
        }),
    });

    if (!rpc.ok) {
        // 500 → Stripe wiederholt und zeigt den Fehler im Dashboard; Doppelbuchung verhindert die Idempotenz-Prüfung.
        console.error(`ALARM: record_claim_payment failed for claim ${claimId} / session ${sessionId}:`, rpc.text);
        throw new Error("record_claim_payment failed");
    }
    console.log(`✅ Recorded payment of ${amount} EUR for claim ${claimId}`);
}

// ═════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════
serve(async (req: Request) => {
    const signature = req.headers.get("Stripe-Signature");
    const body = await req.text();

    console.log("=== STRIPE WEBHOOK ===");

    if (!signature || WEBHOOK_SECRETS.length === 0) {
        console.error("Missing signature or webhook secret");
        return new Response("Bad request", { status: 400 });
    }

    // 1. Verify signature
    let valid = false;
    try {
        valid = await verifyStripeSignature(body, signature, WEBHOOK_SECRETS);
    } catch (err) {
        console.error("Signature error:", (err as Error).message);
    }
    if (!valid) {
        console.error("Signature INVALID");
        return new Response("Invalid signature", { status: 400 });
    }

    // 2. Parse event
    let event: any;
    try {
        event = JSON.parse(body);
    } catch {
        return new Response("Bad request", { status: 400 });
    }
    console.log(`Event: ${event.type} (${event.id})${event.account ? ` account=${event.account}` : ""}`);

    // Ereignisse verbundener Konten (Connect): nur account.updated ist relevant. Checkout-/Abo-Ereignisse
    // entstehen ausschließlich im Plattformkonto (Destination Charges) und werden sonst ignoriert,
    // damit ein über das Connect-Secret signiertes Ereignis keine Zahlung/kein Abo verbuchen kann.
    if (event.account && event.type !== "account.updated") {
        console.warn(`Ignoring ${event.type} from connected account ${event.account}`);
        return new Response(JSON.stringify({ received: true, ignored: true }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        switch (event.type) {
            // ═══════════════════════════════════════
            // CHECKOUT COMPLETED / ASYNC PAYMENT
            // ═══════════════════════════════════════
            case "checkout.session.async_payment_succeeded":
            case "checkout.session.completed": {
                const session = event.data.object;
                console.log("mode:", session.mode, "payment_status:", session.payment_status, "sub:", session.subscription);

                if (session.metadata?.payment_type === "claim_checkout") {
                    await bookClaimPayment(session, event.created);
                    break;
                }

                if (event.type !== "checkout.session.completed") break;

                if (session.mode !== "subscription" || !session.subscription) {
                    console.warn("Not a subscription checkout, skipping.");
                    break;
                }

                const userId = session.client_reference_id || session.metadata?.user_id;
                if (typeof userId !== "string" || !UUID_RE.test(userId)) throw new Error("No valid user_id in checkout session");
                console.log("userId:", userId);

                // Fetch subscription from Stripe
                const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
                const sub = await stripeGet(`/subscriptions/${encodeURIComponent(subId)}`);
                console.log("sub.status:", sub.status, "period_end:", sub.current_period_end);

                const existing = await findSubscriptionRow("user_id", userId);
                if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id
                    && RUNNING_STATUSES.has(existing.status)) {
                    console.warn(`ALARM: user ${userId} hatte bereits Abo ${existing.stripe_subscription_id} (${existing.status}); neues Abo ${sub.id}. Doppelabbuchung in Stripe prüfen!`);
                }

                // Bisheriger Standard bei unbekanntem Preis war 'professional' – bleibt als letzter Rückfall.
                const plan = await resolvePlan(sub, existing?.plan ?? "professional");

                // Wie bisher: ein abgeschlossener Checkout gilt als aktiv, auch wenn die erste Zahlung
                // (z. B. SEPA) noch verarbeitet wird; Stripe korrigiert später per customer.subscription.updated.
                let status = mapStatus(sub.status);
                if (status === "incomplete") status = "active";

                const upsertData: Record<string, unknown> = {
                    user_id: userId,
                    stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
                    stripe_subscription_id: sub.id,
                    status,
                    plan,
                    trial_ends_at: status === "trialing" ? toISO(sub.trial_end) : null,
                    current_period_end: toISO(sub.current_period_end),
                    cancel_at_period_end: !!sub.cancel_at_period_end,
                };
                console.log("UPSERT:", JSON.stringify(upsertData));

                const result = await upsertSubscription(upsertData);
                if (!result.ok) {
                    console.error("UPSERT ERROR:", result.text);
                    throw new Error("Subscription upsert failed");
                }
                console.log(`✅ Saved: user ${userId} → ${plan} (${status})`);
                break;
            }

            case "checkout.session.async_payment_failed": {
                const session = event.data.object;
                if (session.metadata?.payment_type === "claim_checkout") {
                    console.warn(`Claim checkout ${session.id}: async payment FAILED – nichts gebucht (claim ${session.metadata?.claim_id})`);
                }
                break;
            }

            // Rückbuchungen/Erstattungen werden (noch) nicht automatisch storniert → deutlicher Hinweis im Log
            case "charge.dispute.created":
            case "charge.refunded": {
                const obj = event.data.object;
                console.warn(`ALARM: ${event.type} für ${obj?.id} (payment_intent ${obj?.payment_intent}) – ggf. Forderungszahlung manuell stornieren.`);
                break;
            }

            // ═══════════════════════════════════════
            // SUBSCRIPTION UPDATED / DELETED
            // ═══════════════════════════════════════
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                const eventSub = event.data.object;
                console.log(`${event.type}: sub.id=${eventSub.id} status=${eventSub.status}`);

                // Fetch fresh data from Stripe API (pinned version) for consistent format
                const sub = await stripeGet(`/subscriptions/${encodeURIComponent(eventSub.id)}`);
                const status = event.type === "customer.subscription.deleted" ? "canceled" : mapStatus(sub.status);
                const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

                // 1. Zeile über die Abo-ID
                let row = await findSubscriptionRow("stripe_subscription_id", sub.id);

                // 2. Sonst über metadata.user_id bzw. stripe_customer_id – aber nur übernehmen,
                //    wenn dieses Abo läuft und die Zeile kein anderes laufendes Abo führt.
                if (!row) {
                    const metaUid = sub.metadata?.user_id;
                    let candidate = typeof metaUid === "string" && UUID_RE.test(metaUid)
                        ? await findSubscriptionRow("user_id", metaUid)
                        : null;
                    if (!candidate && customerId) candidate = await findSubscriptionRow("stripe_customer_id", customerId);

                    const candidateRunsOther = candidate?.stripe_subscription_id
                        && candidate.stripe_subscription_id !== sub.id
                        && RUNNING_STATUSES.has(candidate.status);

                    if (!RUNNING_STATUSES.has(status) || candidateRunsOther) {
                        console.warn(`No matching row for sub ${sub.id} (status ${status}) – nothing changed`);
                        break;
                    }

                    if (candidate) {
                        row = candidate;
                    } else if (typeof metaUid === "string" && UUID_RE.test(metaUid)) {
                        // Ereignis kam vor checkout.session.completed → Zeile anlegen
                        const plan = await resolvePlan(sub, "professional");
                        const ins = await upsertSubscription({
                            user_id: metaUid,
                            stripe_customer_id: customerId,
                            stripe_subscription_id: sub.id,
                            status,
                            plan,
                            trial_ends_at: status === "trialing" ? toISO(sub.trial_end) : null,
                            current_period_end: toISO(sub.current_period_end),
                            cancel_at_period_end: !!sub.cancel_at_period_end,
                        });
                        if (!ins.ok) {
                            console.error("UPSERT ERROR:", ins.text);
                            throw new Error("Subscription upsert failed");
                        }
                        console.log(`✅ Created row for user ${metaUid} from ${event.type}`);
                        break;
                    } else {
                        console.warn(`No matching subscription in DB for ${sub.id} – nothing changed`);
                        break;
                    }
                }

                const userId = row.user_id;
                const updateData: Record<string, unknown> = {
                    status,
                    stripe_subscription_id: sub.id,
                    current_period_end: toISO(sub.current_period_end),
                    trial_ends_at: status === "trialing" ? toISO(sub.trial_end) : null,
                    cancel_at_period_end: !!sub.cancel_at_period_end,
                };
                if (customerId) updateData.stripe_customer_id = customerId;

                // Plan nur bei Updates und nur aus erlaubten Quellen; unbekannt → Plan bleibt
                if (event.type === "customer.subscription.updated" && sub.items?.data?.length > 0) {
                    const newPlan = await resolvePlan(sub, null);
                    if (newPlan) updateData.plan = newPlan;
                }

                console.log("UPDATE:", JSON.stringify(updateData));
                const updateResult = await updateSubscriptionByUser(userId, updateData);
                if (!updateResult.ok) {
                    console.error("UPDATE ERROR:", updateResult.text);
                    throw new Error("Subscription update failed");
                }
                console.log(`✅ Updated: user ${userId} → ${status}`);
                break;
            }

            // ═══════════════════════════════════════
            // CONNECT ACCOUNT UPDATED
            // ═══════════════════════════════════════
            case "account.updated": {
                const account = event.data.object;
                const connectId = String(account.id ?? "");
                const enabled = !!(account.charges_enabled && account.details_submitted);

                console.log(`account.updated: id=${connectId}, charges_enabled=${account.charges_enabled}, details_submitted=${account.details_submitted}`);
                if (!connectId) break;

                const r = await sb(`profiles?stripe_connect_id=eq.${encodeURIComponent(connectId)}`, {
                    method: "PATCH",
                    headers: { Prefer: "return=minimal" },
                    body: JSON.stringify({ stripe_connect_enabled: enabled, updated_at: new Date().toISOString() }),
                });
                if (!r.ok) {
                    console.error(`Failed to update profile for connect account ${connectId}:`, r.text);
                    throw new Error("Profile update failed");
                }
                console.log(`✅ Updated profile stripe_connect_enabled to ${enabled} for account ${connectId}`);
                break;
            }

            default:
                console.log("Unhandled:", event.type);
        }

        console.log("=== END (200) ===");
        return new Response(JSON.stringify({ received: true }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("=== ERROR:", msg, "===");
        return new Response(JSON.stringify({ error: "processing_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
