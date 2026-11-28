/**
 * Stripe-Tarife – EINZIGE Quelle für die Preis-IDs der Abos (Befund E3-13).
 *
 * Benutzt von:
 * - create-checkout-session (Tarif + Abrechnungszeitraum → Preis-ID)
 * - stripe-webhook (Preis-ID → Tarif, z. B. nach einem Tarifwechsel im Stripe-Kundenportal)
 *
 * Neue oder geänderte Preise NUR hier eintragen und danach BEIDE Functions neu ausrollen.
 * Beim Ausrollen über die Supabase-CLI wird die Datei automatisch mitgenommen; beim Ausrollen über
 * die Management-API/MCP muss sie als zusätzliche Datei hochgeladen werden (siehe config.toml).
 */

export type BillingPeriod = "monthly" | "yearly";

const PLAN_PRICES: Readonly<Record<string, Readonly<Record<BillingPeriod, string>>>> = Object.freeze({
    starter: Object.freeze({
        monthly: "price_1T1GauFpRUY7TQZUpmxwYOJb",
        yearly: "price_1T1l3oFpRUY7TQZUtwi16wzf",
    }),
    professional: Object.freeze({
        monthly: "price_1T1GbJFpRUY7TQZUPASgpSTz",
        yearly: "price_1T1l37FpRUY7TQZUwCuCfubf",
    }),
    business: Object.freeze({
        monthly: "price_1T1GbhFpRUY7TQZUtvTFLgI7",
        yearly: "price_1T1l1xFpRUY7TQZUIEG7ATgZ",
    }),
});

/** Erlaubte Tarife (Allowlist für Metadaten aus Stripe). */
export const ALLOWED_PLANS: ReadonlySet<string> = new Set(Object.keys(PLAN_PRICES));

/** Erlaubte Abrechnungszeiträume. */
export const BILLING_PERIODS: ReadonlySet<string> = new Set<BillingPeriod>(["monthly", "yearly"]);

const PRICE_TO_PLAN: ReadonlyMap<string, string> = new Map(
    Object.entries(PLAN_PRICES).flatMap(([plan, prices]) =>
        Object.values(prices).map((priceId) => [priceId, plan] as [string, string])
    )
);

/** Preis-ID für Tarif + Zeitraum, sonst null (unbekannter Tarif/Zeitraum). */
export function priceIdFor(plan: unknown, period: unknown): string | null {
    if (typeof plan !== "string" || typeof period !== "string") return null;
    if (!ALLOWED_PLANS.has(plan) || !BILLING_PERIODS.has(period)) return null;
    return PLAN_PRICES[plan][period as BillingPeriod] ?? null;
}

/** Tarif zu einer Stripe-Preis-ID, sonst null (Preis nicht eingetragen). */
export function planForPriceId(priceId: unknown): string | null {
    if (typeof priceId !== "string") return null;
    return PRICE_TO_PLAN.get(priceId) ?? null;
}
