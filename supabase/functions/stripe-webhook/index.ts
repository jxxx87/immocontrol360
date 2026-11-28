import { ALLOWED_PLANS, planForPriceId } from "../_shared/stripePlans.ts";

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
 * - Wave 3 (E3-07): Vollständige Erstattung (charge.refunded) und Rückbuchung (charge.dispute.created
 *   ohne Vorwarnstatus, charge.dispute.closed = lost) stornieren die Forderungszahlung über
 *   reverse_claim_payment (Server-Rolle). Teilerstattungen, Vorwarnungen und gewonnene Anfechtungen
 *   werden nur als Hinweis in der Forderungsakte vermerkt.
 * - Wave 3 (D1b-16): Forderungszahlungen werden zum Stichtag des Betrags (metadata.quote_date,
 *   Berliner Kalendertag) gebucht, wenn der gezahlte Betrag genau diesem Betrag entspricht.
 * - Wave 3 (E3-09): Ereignisprotokoll public.stripe_webhook_events (Migration wave3/10_STRIPE.sql):
 *   jedes Ereignis wird mit event.id vermerkt; bereits verarbeitete Ereignisse werden übersprungen,
 *   gleichzeitige Zustellungen desselben Ereignisses abgewiesen (409, Stripe wiederholt später).
 *   Fehlt das Protokoll (Migration noch nicht eingespielt), läuft die Verarbeitung wie bisher.
 *   Fachlich nicht verbuchbare Forderungszahlungen (Forderung erledigt, Betrag zu hoch …) werden
 *   als Hinweis in der Forderungsakte vermerkt und mit 200 quittiert statt tagelang wiederholt.
 * - Wave 3 (E3-13): Preis-IDs nur noch in ../_shared/stripePlans.ts (gemeinsam mit create-checkout-session).
 * - Wave 3 (E3-21): eingebautes Deno.serve statt deno.land/std@0.131.0.
 *   Ausrollen: index.ts UND ../_shared/stripePlans.ts hochladen (siehe supabase/config.toml).
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

const KNOWN_STATUSES = new Set([
    "trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused",
]);
// Abos, die noch laufen (Zugang/Verwaltung nötig)
const RUNNING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        console.error(`Stripe API error (${res.status}) for ${path.split("?")[0]}:`, txt);
        // Kurze Fehlermeldung ohne Antwortinhalt (wird im Ereignisprotokoll gespeichert)
        let code = "";
        try { code = String(JSON.parse(txt)?.error?.code ?? ""); } catch { code = ""; }
        throw new Error(`Stripe API error (${res.status}${/^[a-z_]{1,60}$/.test(code) ? ` ${code}` : ""})`);
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
    const mapped = planForPriceId(price?.id);
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

    console.error(`ALARM: unknown price ${price?.id} (product ${productId}) – plan fallback "${fallback}". Bitte _shared/stripePlans.ts ergänzen.`);
    return fallback;
}

// ─── Forderungszahlung (Forderungsportal) ───
const QUOTE_MAX_AGE_DAYS = 45;

/**
 * Stichtag des Zahlungsbetrags aus den Session-Metadaten (create-portal-checkout-session),
 * nur wenn der gezahlte Betrag genau dem berechneten Betrag entspricht und der Stichtag
 * plausibel ist (nicht nach dem Buchungstag, höchstens QUOTE_MAX_AGE_DAYS davor).
 */
function quoteDateFor(session: any, metaAmount: number, bookingDate: string): string | null {
    const quoteDate = session.metadata?.quote_date;
    if (typeof quoteDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(quoteDate)) return null;
    const quoteMs = Date.parse(`${quoteDate}T00:00:00Z`);
    const bookingMs = Date.parse(`${bookingDate}T00:00:00Z`);
    if (!Number.isFinite(quoteMs) || !Number.isFinite(bookingMs)) return null;
    if (quoteMs > bookingMs || bookingMs - quoteMs > QUOTE_MAX_AGE_DAYS * 86400000) return null;
    if (!Number.isFinite(metaAmount) || !(metaAmount > 0)) return null;
    const paidCents = Math.round(Number(session.amount_total ?? NaN));
    if (!Number.isFinite(paidCents) || paidCents !== Math.round(metaAmount * 100)) return null;
    return quoteDate;
}

/**
 * Fachliche Ablehnung durch eine Datenbankfunktion (RAISE EXCEPTION → PostgREST 400 / P0001),
 * z. B. „Forderung bereits erledigt“ oder „Betrag übersteigt die offene Gesamtforderung“.
 * Eine Wiederholung durch Stripe ändert daran nichts. „Not authenticated“ (falscher Schlüssel bzw.
 * Datenbankfassung ohne Server-Rolle) bleibt ein technischer Fehler, damit nach der Korrektur
 * automatisch nachgebucht wird. Rückgabe: Meldung der Datenbank oder null.
 */
function businessRejection(r: SbResult): string | null {
    if (r.ok || r.status !== 400 || r.data?.code !== "P0001") return null;
    const message = typeof r.data?.message === "string" ? r.data.message.trim() : "";
    if (!message || /not authenticated/i.test(message)) return null;
    return message.slice(0, 500);
}

/**
 * Nicht verbuchbare Online-Zahlung: Hinweis für den Vermieter in der Forderungsakte
 * (je Checkout-Session nur einmal). Rückgabe: Ergebnis-Code für das Ereignisprotokoll.
 */
async function noteUnbookedClaimPayment(event: any, session: any, claimId: string, reason: string): Promise<string> {
    const sessionId = String(session.id);
    const paid = Number.isFinite(Number(session.amount_total ?? NaN))
        ? formatEur(session.amount_total)
        : formatEur(Math.round(Number(session.metadata?.claim_amount ?? 0) * 100));
    const reasonText = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    const noted = await addClaimNote(claimId, event,
        `Online-Zahlung über Stripe (Session ${sessionId}, Betrag ${paid}) konnte nicht automatisch verbucht werden: ${reasonText} Bitte die Zahlung manuell prüfen und in der Forderungsakte erfassen bzw. über Stripe erstatten.`,
        { portal_event: "stripe_unbooked", session_id: sessionId, amount_cents: session.amount_total ?? null, reason },
        { portal_event: "stripe_unbooked", session_id: sessionId });
    if (!noted) {
        console.error(`ALARM: Online-Zahlung ${sessionId} (${paid}) gehört zu keiner vorhandenen Forderung (${claimId}) – nicht verbucht, bitte in Stripe prüfen/erstatten.`);
        return "claim_payment_unbooked_no_claim";
    }
    console.error(`ALARM: Online-Zahlung ${sessionId} für Forderung ${claimId} nicht verbucht (${reason}) – Hinweis in der Forderungsakte vermerkt.`);
    return "claim_payment_unbooked";
}

async function bookClaimPayment(session: any, event: any): Promise<string> {
    const claimId = session.metadata?.claim_id;
    if (typeof claimId !== "string" || !UUID_RE.test(claimId)) {
        console.error(`ALARM: Claim checkout ${session.id} without valid claim_id – nothing booked`);
        return "claim_payment_invalid";
    }
    if (session.payment_status !== "paid") {
        console.log(`Claim checkout ${session.id}: payment_status=${session.payment_status} → wait for async_payment_succeeded`);
        return "claim_payment_pending";
    }

    // Idempotenz: dieselbe Checkout-Session nie zweimal buchen
    const sessionId = String(session.id ?? "");
    if (!/^[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("Invalid session id");
    const existing = await sb(`claim_payments?claim_id=eq.${claimId}&note=like.*${sessionId}*&select=id&limit=1`);
    if (!existing.ok) throw new Error(`claim_payments lookup failed (${existing.status})`);
    if (Array.isArray(existing.data) && existing.data.length > 0) {
        console.log(`Claim checkout ${sessionId} already booked – skipping duplicate delivery`);
        return "claim_payment_duplicate";
    }

    const metaAmount = parseFloat(session.metadata?.claim_amount ?? "");
    const amount = Number.isFinite(metaAmount) && metaAmount > 0
        ? Math.round(metaAmount * 100) / 100
        : Math.round(Number(session.amount_total ?? 0)) / 100;
    if (!(amount > 0)) {
        console.error(`ALARM: Claim checkout ${sessionId}: no positive amount – nothing booked`);
        return "claim_payment_invalid";
    }
    const eventCreated = Number(event?.created);

    // D1b-16: Der Betrag wurde zum Stichtag quote_date (Berliner Kalendertag, wie claim_totals_view)
    // berechnet. Entspricht der gezahlte Betrag genau diesem Angebot, wird zu diesem Tag gebucht –
    // sonst fehlt bei Zahlung über Mitternacht bzw. bei SEPA-Laufzeit ein Tageszins und die
    // Forderung wird nicht erledigt. Sonst (älteres Angebot, abweichender Betrag) Ereignisdatum.
    const bookingDate = berlinDate(eventCreated || session.created);
    const paymentDate = quoteDateFor(session, metaAmount, bookingDate) ?? bookingDate;

    console.log(`Processing claim checkout payment: claimId=${claimId}, amount=${amount}, payment_date=${paymentDate}`);

    const rpc = await sb("rpc/record_claim_payment", {
        method: "POST",
        body: JSON.stringify({
            p_claim_id: claimId,
            p_payment_date: paymentDate,
            p_amount: amount,
            p_note: `Online-Zahlung via Stripe Checkout (${sessionId})`,
            p_installment_id: null,
        }),
    });

    if (!rpc.ok) {
        // Fachlich abgelehnt (E3-09): Wiederholen hilft nicht → Hinweis an den Vermieter, 200 an Stripe.
        const reason = businessRejection(rpc);
        if (reason) return await noteUnbookedClaimPayment(event, session, claimId, reason);
        // Technisch: 500 → Stripe wiederholt und zeigt den Fehler im Dashboard; Doppelbuchung verhindert die Idempotenz-Prüfung.
        console.error(`ALARM: record_claim_payment failed for claim ${claimId} / session ${sessionId}:`, rpc.text);
        throw new Error(`record_claim_payment failed (${rpc.status})`);
    }
    console.log(`✅ Recorded payment of ${amount} EUR for claim ${claimId}`);
    return "claim_payment_booked";
}

// ─── Erstattung / Rückbuchung einer Forderungszahlung (E3-07) ───
const STRIPE_EVENT_ID_RE = /^evt_[A-Za-z0-9]+$/;

function formatEur(cents: unknown): string {
    const n = Number(cents);
    const value = Number.isFinite(n) ? n / 100 : 0;
    return value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
}

/** Checkout-Session des Forderungsportals zu einem PaymentIntent (sonst null). */
async function findClaimCheckoutSession(paymentIntentId: unknown): Promise<any | null> {
    if (typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return null;
    const list = await stripeGet(`/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=1`);
    const session = Array.isArray(list?.data) ? list.data[0] : null;
    if (!session || session.metadata?.payment_type !== "claim_checkout") return null;
    const claimId = session.metadata?.claim_id;
    if (typeof claimId !== "string" || !UUID_RE.test(claimId)) return null;
    if (!/^[A-Za-z0-9_]+$/.test(String(session.id ?? ""))) return null;
    return session;
}

/** PaymentIntent einer Anfechtung (Fallback über die Charge). */
async function disputePaymentIntent(dispute: any): Promise<string | null> {
    if (typeof dispute?.payment_intent === "string") return dispute.payment_intent;
    if (typeof dispute?.charge === "string" && /^(ch|py)_[A-Za-z0-9]+$/.test(dispute.charge)) {
        const charge = await stripeGet(`/charges/${encodeURIComponent(dispute.charge)}`);
        return typeof charge?.payment_intent === "string" ? charge.payment_intent : null;
    }
    return null;
}

/** Gebuchte Forderungszahlung zur Checkout-Session (Session-ID steht in der Zahlungsnotiz). */
async function findClaimPayment(claimId: string, sessionId: string): Promise<{ id: string; status: string } | null> {
    const r = await sb(`claim_payments?claim_id=eq.${claimId}&note=like.*${sessionId}*&select=id,status&order=created_at.asc&limit=1`);
    if (!r.ok) throw new Error(`claim_payments lookup failed (${r.status})`);
    return Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null;
}

/**
 * Hinweis in der Forderungsakte (unter dem Eigentümer der Forderung); je Stripe-Ereignis nur einmal,
 * bzw. – mit `dedupe` – nur einmal je Kombination dieser Metadaten (z. B. je Checkout-Session).
 * Rückgabe false, wenn die Forderung nicht (mehr) existiert.
 */
async function addClaimNote(
    claimId: string,
    event: any,
    description: string,
    metadata: Record<string, unknown>,
    dedupe?: Record<string, string>,
): Promise<boolean> {
    const eventId = String(event?.id ?? "");
    if (!STRIPE_EVENT_ID_RE.test(eventId)) throw new Error("Invalid event id");
    const dedupeFilter = dedupe && Object.keys(dedupe).length > 0
        ? Object.entries(dedupe).map(([k, v]) => {
            if (!/^[a-z_]{1,40}$/.test(k)) throw new Error("Invalid dedupe key");
            return `event_metadata->>${k}=eq.${encodeURIComponent(v)}`;
        }).join("&")
        : `event_metadata->>stripe_event_id=eq.${eventId}`;
    const dup = await sb(`claim_events?claim_id=eq.${claimId}&event_type=eq.note_added&${dedupeFilter}&select=id&limit=1`);
    if (!dup.ok) throw new Error(`claim_events lookup failed (${dup.status})`);
    if (Array.isArray(dup.data) && dup.data.length > 0) return true;

    const owner = await sb(`claims?id=eq.${claimId}&select=user_id`);
    if (!owner.ok) throw new Error(`claim owner lookup failed (${owner.status})`);
    if (!Array.isArray(owner.data) || owner.data.length === 0) return false;

    const ins = await sb("claim_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
            user_id: owner.data[0].user_id,
            claim_id: claimId,
            event_type: "note_added",
            description,
            event_metadata: { source: "stripe", stripe_event_id: eventId, stripe_event_type: event.type, ...metadata },
        }),
    });
    if (!ins.ok) {
        console.error(`claim note insert failed for claim ${claimId}:`, ins.text);
        throw new Error(`claim note insert failed (${ins.status})`);
    }
    return true;
}

/**
 * Storniert die Forderungszahlung zu einem PaymentIntent. Fachliche Ablehnungen der Datenbank
 * (z. B. alte Datenbankfassung ohne Server-Storno, Forderung nicht wieder zu öffnen) werden als
 * Hinweis vermerkt und nicht wiederholt; technische Fehler -> 500 (Stripe wiederholt).
 */
async function reverseClaimPaymentForStripe(event: any, paymentIntentId: unknown, reasonText: string): Promise<void> {
    const session = await findClaimCheckoutSession(paymentIntentId);
    if (!session) {
        console.log(`${event.type}: payment_intent ${paymentIntentId} gehört zu keiner Forderungszahlung – ignoriert`);
        return;
    }
    const claimId = session.metadata.claim_id as string;
    const payment = await findClaimPayment(claimId, String(session.id));
    if (!payment) {
        console.warn(`${event.type}: keine Forderungszahlung zu ${session.id} gebucht – nichts zu stornieren`);
        return;
    }
    if (payment.status === "cancelled") {
        console.log(`${event.type}: Forderungszahlung ${payment.id} ist bereits storniert`);
        return;
    }

    const rpc = await sb("rpc/reverse_claim_payment", {
        method: "POST",
        body: JSON.stringify({ p_payment_id: payment.id }),
    });
    const meta = { payment_intent: paymentIntentId, claim_payment_id: payment.id };
    if (!rpc.ok) {
        if (rpc.status >= 400 && rpc.status < 500 && rpc.data?.code === "P0001") {
            const reason = typeof rpc.data?.message === "string" ? rpc.data.message : "";
            console.error(`ALARM: ${event.type}: Forderungszahlung ${payment.id} nicht automatisch storniert: ${reason}`);
            await addClaimNote(claimId, event,
                `${reasonText}. Die Forderungszahlung konnte nicht automatisch storniert werden${reason && !/Not authenticated/i.test(reason) ? ` (${reason})` : ""} – bitte stornieren Sie die Zahlung in der Forderungsakte.`,
                { ...meta, auto_reversed: false });
            return;
        }
        console.error(`ALARM: reverse_claim_payment failed for payment ${payment.id}:`, rpc.text);
        throw new Error("reverse_claim_payment failed");
    }
    await addClaimNote(claimId, event, `${reasonText}. Die Forderungszahlung wurde automatisch storniert.`, { ...meta, auto_reversed: true });
    console.log(`✅ Reversed claim payment ${payment.id} (${event.type})`);
}

/** Nur Hinweis (keine Buchung), z. B. Teilerstattung oder Vorwarnung. */
async function noteClaimPaymentForStripe(event: any, paymentIntentId: unknown, description: string, metadata: Record<string, unknown>): Promise<void> {
    const session = await findClaimCheckoutSession(paymentIntentId);
    if (!session) return;
    await addClaimNote(session.metadata.claim_id as string, event, description, { payment_intent: paymentIntentId, ...metadata });
}

// ─── Ereignisprotokoll (E3-09) ───
// "process": verarbeiten · "duplicate": schon verarbeitet · "in_progress": läuft gerade in einer
// anderen Zustellung · "untracked": Protokoll nicht verfügbar (Migration fehlt) → wie bisher verarbeiten.
type EventGate = "process" | "duplicate" | "in_progress" | "untracked";

async function beginEventLog(event: any): Promise<EventGate> {
    const eventId = String(event?.id ?? "");
    if (!STRIPE_EVENT_ID_RE.test(eventId)) return "untracked";
    try {
        const r = await sb("rpc/stripe_webhook_event_begin", {
            method: "POST",
            body: JSON.stringify({
                p_event_id: eventId,
                p_event_type: String(event.type ?? "").slice(0, 100),
                p_livemode: typeof event.livemode === "boolean" ? event.livemode : null,
                p_account: typeof event.account === "string" && /^acct_[A-Za-z0-9]+$/.test(event.account) ? event.account : null,
                p_created: Number.isInteger(event.created) && event.created > 0 ? event.created : null,
            }),
        });
        if (r.ok && (r.data === "process" || r.data === "duplicate" || r.data === "in_progress")) return r.data;
        console.warn(`Ereignisprotokoll nicht verfügbar (${r.status}) – Verarbeitung ohne Protokoll`);
    } catch (err) {
        console.warn("Ereignisprotokoll nicht erreichbar:", (err as Error).message);
    }
    return "untracked";
}

/** Ergebnis im Ereignisprotokoll vermerken; Fehler hier ändern die Antwort an Stripe nicht. */
async function finishEventLog(event: any, gate: EventGate, ok: boolean, outcome: string | null, error: string | null): Promise<void> {
    if (gate !== "process") return;
    try {
        const r = await sb("rpc/stripe_webhook_event_finish", {
            method: "POST",
            body: JSON.stringify({
                p_event_id: String(event.id),
                p_success: ok,
                p_outcome: outcome,
                p_error: error ? error.slice(0, 500) : null,
            }),
        });
        if (!r.ok) console.warn(`Ereignisprotokoll: Abschluss für ${event.id} nicht gespeichert (${r.status})`);
    } catch (err) {
        console.warn("Ereignisprotokoll: Abschluss nicht gespeichert:", (err as Error).message);
    }
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// ═════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
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
        return jsonResponse({ received: true, ignored: true });
    }

    // 3. Ereignisprotokoll: doppelte bzw. gleichzeitige Zustellung desselben Ereignisses erkennen
    const gate = await beginEventLog(event);
    if (gate === "duplicate") {
        console.log(`Event ${event.id} bereits verarbeitet – übersprungen`);
        return jsonResponse({ received: true, duplicate: true });
    }
    if (gate === "in_progress") {
        // Nicht-2xx: Stripe stellt später erneut zu (dann als "duplicate" bzw. nach Abbruch erneut verarbeitet)
        console.warn(`Event ${event.id} wird gerade verarbeitet – erneute Zustellung später`);
        return jsonResponse({ error: "in_progress" }, 409);
    }

    let outcome: string | null = null;
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
                    outcome = await bookClaimPayment(session, event);
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

            // ═══════════════════════════════════════
            // ERSTATTUNG / RÜCKBUCHUNG (Forderungsportal)
            // ═══════════════════════════════════════
            case "charge.refunded": {
                const charge = event.data.object;
                const fullyRefunded = charge?.refunded === true
                    || (Number(charge?.amount_refunded ?? 0) > 0 && Number(charge?.amount_refunded) >= Number(charge?.amount ?? 0));
                if (fullyRefunded) {
                    await reverseClaimPaymentForStripe(event, charge?.payment_intent,
                        `Die Online-Zahlung über ${formatEur(charge?.amount)} wurde über Stripe vollständig erstattet`);
                } else {
                    await noteClaimPaymentForStripe(event, charge?.payment_intent,
                        `Teilerstattung über Stripe: insgesamt ${formatEur(charge?.amount_refunded)} von ${formatEur(charge?.amount)} erstattet. Die Forderungszahlung bleibt gebucht – bitte prüfen und ggf. in der Forderungsakte korrigieren.`,
                        { amount_refunded_cents: charge?.amount_refunded ?? null, amount_cents: charge?.amount ?? null });
                }
                break;
            }

            case "charge.dispute.created":
            case "charge.dispute.closed": {
                const dispute = event.data.object;
                const status = String(dispute?.status ?? "");
                const paymentIntentId = await disputePaymentIntent(dispute);
                const isWarning = status.startsWith("warning_");
                if (event.type === "charge.dispute.created" && isWarning) {
                    // Vorwarnung/Anfrage: noch kein Geld zurückgebucht
                    await noteClaimPaymentForStripe(event, paymentIntentId,
                        `Stripe meldet eine Vorwarnung zur Online-Zahlung (${formatEur(dispute?.amount)}). Noch keine Rückbuchung – die Forderungszahlung bleibt gebucht.`,
                        { dispute_status: status });
                } else if (event.type === "charge.dispute.created" || status === "lost") {
                    // Rückbuchung: der Betrag wurde dem Konto belastet (bzw. die Anfechtung ist verloren)
                    await reverseClaimPaymentForStripe(event, paymentIntentId,
                        `Rückbuchung/Zahlungsanfechtung über Stripe (${formatEur(dispute?.amount)})`);
                } else if (status === "won") {
                    await noteClaimPaymentForStripe(event, paymentIntentId,
                        `Die Zahlungsanfechtung (${formatEur(dispute?.amount)}) wurde zugunsten des Vermieters entschieden. Die zuvor stornierte Zahlung bitte bei Bedarf erneut in der Forderungsakte erfassen.`,
                        { dispute_status: status });
                } else {
                    console.log(`${event.type}: Anfechtung mit Status ${status} – keine Buchung`);
                }
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
                outcome = "unhandled";
        }

        await finishEventLog(event, gate, true, outcome, null);
        console.log("=== END (200) ===");
        return jsonResponse({ received: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("=== ERROR:", msg, "===");
        await finishEventLog(event, gate, false, outcome, msg);
        return jsonResponse({ error: "processing_failed" }, 500);
    }
});
