// Tarife der Marketing-Website – EINE Quelle für Preise und Leistungen auf /preise, /paywall
// und /abo-starten (Komplett-Check 2026-11-27, W1c-03/W1c-07/W1c-11).
// Preise wie in der App (immo-web/src/components/subscription/PaywallModal.jsx); verbindlich ist der
// im Stripe-Checkout angezeigte Betrag. Bei Preisänderungen Stripe, App und diese Datei gemeinsam anpassen.
// Einheiten-Grenzen und Testphase stammen aus den gemeinsamen Eckdaten in data/faqData.js.
import { TRIAL_DAYS, TRIAL_MAX_UNITS, PLAN_UNIT_LIMITS } from '../data/faqData';

export { TRIAL_DAYS, TRIAL_MAX_UNITS, PLAN_UNIT_LIMITS };

// Standard-Tarif, wenn kein oder ein unbekannter Tarif übergeben wird (wie Register.jsx der App)
export const DEFAULT_PLAN_ID = 'professional';

// Kontakt für Portfolios oberhalb der Business-Grenze
export const ENTERPRISE_CONTACT_EMAIL = 'sales@immocontrol360.de';

// Laut AGB (Ziffer 4) verstehen sich alle Preise inklusive der gesetzlichen Mehrwertsteuer.
export const VAT_NOTE = 'inkl. MwSt.';

export const PLANS = [
    {
        id: 'starter',
        title: 'Starter',
        // Beträge in Cent: Monatspreis bei monatlicher Zahlung bzw. Monatspreis bei jährlicher Zahlung
        monthlyCents: 999,
        yearlyPerMonthCents: 899,
        description: 'Für Einsteiger mit ersten Objekten.',
        features: [
            { text: `Bis zu ${PLAN_UNIT_LIMITS.starter} Einheiten`, included: true },
            { text: 'Immobilien & Mieterverwaltung', included: true },
            { text: 'Finanzen', included: true },
            { text: 'Nebenkostenabrechnung', included: true },
            { text: 'Zählermanagement', included: true },
            { text: 'Kein Mieterportal', included: false },
            { text: 'Kein Investorportal', included: false },
        ],
    },
    {
        id: 'professional',
        title: 'Professional',
        monthlyCents: 3299,
        yearlyPerMonthCents: 2969,
        description: 'Für wachsende Portfolios. Volle Kontrolle.',
        highlighted: true,
        features: [
            { text: `Bis zu ${PLAN_UNIT_LIMITS.professional} Einheiten`, included: true },
            { text: 'Alles aus dem Starter inbegriffen', included: true },
            { text: 'Mieterportal', included: true },
            { text: 'Investorportal', included: true },
        ],
    },
    {
        id: 'business',
        title: 'Business',
        monthlyCents: 5999,
        yearlyPerMonthCents: 5399,
        description: 'Für semi-professionelle Investoren.',
        features: [
            { text: `Bis zu ${PLAN_UNIT_LIMITS.business} Einheiten`, included: true },
            { text: 'Alles aus Professional inbegriffen', included: true },
            { text: 'Multi-User Zugriff', included: true },
            { text: 'Priorisierter Support', included: true },
        ],
    },
];

const euroFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 899 → "8,99" (Währungszeichen setzt die Anzeige selbst)
export const formatEuro = (cents) => euroFormat.format(cents / 100);

export const getPlan = (planId) => PLANS.find((plan) => plan.id === planId) || null;

// Tarif aus der URL nur übernehmen, wenn er bekannt ist – sonst Standard-Tarif
export const normalizePlanId = (raw) => {
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return getPlan(id) ? id : DEFAULT_PLAN_ID;
};

// Zahlweise aus der URL: 'monthly' | 'yearly' | null (nicht angegeben oder unbekannt)
export const normalizeCycle = (raw) => {
    const cycle = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return cycle === 'monthly' || cycle === 'yearly' ? cycle : null;
};

// Preisangaben für die Anzeige. Bei jährlicher Zahlung wird der Jahresbetrag im Voraus fällig;
// er ergibt sich aus dem beworbenen Monatspreis × 12 (vor Preisänderungen mit dem Stripe-Jahrespreis abgleichen).
export const getPriceInfo = (plan, isYearly) => ({
    perMonth: formatEuro(isYearly ? plan.yearlyPerMonthCents : plan.monthlyCents),
    yearlyTotal: isYearly ? formatEuro(plan.yearlyPerMonthCents * 12) : null,
});
