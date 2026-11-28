/**
 * Fix-&-Flip-Rechner – reine Rechenlogik (ohne React-State).
 *
 * Gemeinsam genutzt vom Rechner (FixFlipCalculator.jsx) und vom Deal-Ranking im Investorportal:
 * Das Ranking rechnet aus den gespeicherten Eingaben (deal_data) neu, statt gespeicherte Ergebnisse
 * zu lesen – sonst bliebe es nach einer Übernahme der Sanierungssumme aus dem Sanierungsrechner alt.
 */

export const DEFAULT_INPUTS = {
    purchasePrice: 0,
    size: 0,
    notaryPercent: 2,
    brokerPercent: 3.6,
    taxPercent: 5,
    financing: 0,
    interestRate: 5.5,
    duration: 8,
    houseMoney: 0,
    electricity: 0,
    heating: 0,
    renovation: 0,
    kitchen: 0,
    staging: 0,
    misc: 0,
    priceLowSqm: 3500,
    priceHighSqm: 3900,
    // Szenario: Verkauf als Kapitalanlage
    coldRentIst: 0,
    coldRentSoll: 0,
    targetYield: 5,
    name: 'Neuer Fix & Flip Deal',
    address: ''
};

const NUMERIC_FIELDS = Object.keys(DEFAULT_INPUTS).filter(k => typeof DEFAULT_INPUTS[k] === 'number');

/**
 * Geladene Deal-Daten bereinigen: Zahlenfelder als Zahl übernehmen (leere/ungültige
 * Werte → Standardwert), damit z. B. ein leerer Kaufpreis ('') nicht als Text in die
 * Summen eingeht.
 */
export const sanitizeInitialData = (data) => {
    if (!data) return {};
    const out = { ...data };
    for (const k of NUMERIC_FIELDS) {
        if (k in out) {
            const n = parseFloat(out[k]);
            out[k] = Number.isFinite(n) ? Math.max(0, n) : DEFAULT_INPUTS[k];
        }
    }
    if ('name' in out) out.name = out.name == null ? DEFAULT_INPUTS.name : String(out.name);
    if ('address' in out) out.address = out.address == null ? '' : String(out.address);
    return out;
};

/** Eingaben des Rechners aus gespeicherten Deal-Daten (Standardwerte + bereinigte Werte). */
export const buildFixFlipInputs = (data) => ({ ...DEFAULT_INPUTS, ...sanitizeInitialData(data) });

/* ─── Berechnung (rein, ohne State) ─── */
export const computeFixFlip = (inputs) => {
    const {
        purchasePrice, size, notaryPercent, brokerPercent, taxPercent,
        financing, interestRate, duration,
        houseMoney, electricity, heating,
        renovation, kitchen, staging, misc,
        priceLowSqm, priceHighSqm
    } = inputs;

    // 1. Kaufnebenkosten (ohne Finanzierung)
    const notary = purchasePrice * (notaryPercent / 100);
    const broker = purchasePrice * (brokerPercent / 100);
    const tax = purchasePrice * (taxPercent / 100);
    const sideCostsTotal = notary + broker + tax;

    // Gesamtsumme Ankauf (Kaufpreis + Nebenkosten, OHNE Finanzierung)
    const acquisitionTotal = purchasePrice + sideCostsTotal;

    // Finanzierungskosten (Zins auf Finanzierungsbetrag)
    const financingCosts = (financing * (interestRate / 100) / 12) * duration;

    // 2. Holding Costs
    const holdingTotal = (houseMoney + electricity + heating) * duration;

    // 3. Aufbereitung
    const prepTotal = renovation + kitchen + staging + misc;

    // 4. Gesamtinvestment (GIK)
    const totalInvest = acquisitionTotal + financingCosts + holdingTotal + prepTotal;

    // 5. Verkauf
    const sellPriceLow = size * priceLowSqm;
    const sellPriceHigh = size * priceHighSqm;

    const profitLow = sellPriceLow - totalInvest;
    const profitHigh = sellPriceHigh - totalInvest;

    const marginLow = sellPriceLow > 0 ? (profitLow / sellPriceLow) * 100 : 0;
    const marginHigh = sellPriceHigh > 0 ? (profitHigh / sellPriceHigh) * 100 : 0;

    const breakEven = size > 0 ? totalInvest / size : 0;

    // 6. Szenario: Verkauf als Kapitalanlage
    const { coldRentIst, coldRentSoll, targetYield } = inputs;
    const yieldDecimal = targetYield > 0 ? targetYield / 100 : 0;

    const kapSellIst = yieldDecimal > 0 ? (coldRentIst * 12) / yieldDecimal : 0;
    const kapSellSoll = yieldDecimal > 0 ? (coldRentSoll * 12) / yieldDecimal : 0;

    const kapSqmIst = size > 0 ? kapSellIst / size : 0;
    const kapSqmSoll = size > 0 ? kapSellSoll / size : 0;

    const kapProfitIst = kapSellIst - totalInvest;
    const kapProfitSoll = kapSellSoll - totalInvest;

    const kapMarginIst = kapSellIst > 0 ? (kapProfitIst / kapSellIst) * 100 : 0;
    const kapMarginSoll = kapSellSoll > 0 ? (kapProfitSoll / kapSellSoll) * 100 : 0;

    const results = {
        acquisitionTotal,
        sideCostsTotal,
        notary, broker, tax, financingCosts,
        holdingTotal,
        prepTotal,
        totalInvest,
        sellPriceLow, sellPriceHigh,
        profitLow, profitHigh,
        marginLow, marginHigh,
        breakEven,
        // Kapitalanlage
        kapSellIst, kapSellSoll,
        kapSqmIst, kapSqmSoll,
        kapProfitIst, kapProfitSoll,
        kapMarginIst, kapMarginSoll
    };

    // Ankaufs-Matrix (Finanzierungsbetrag bleibt unverändert; GIK wie im Hauptergebnis inkl. Finanzierungskosten)
    const steps = [5, 10, 15, 20, 25, 30];
    const table = steps.map(discount => {
        const discountedPrice = purchasePrice * (1 - discount / 100);
        const d_notary = discountedPrice * (notaryPercent / 100);
        const d_broker = discountedPrice * (brokerPercent / 100);
        const d_tax = discountedPrice * (taxPercent / 100);

        // GIK inkl. Finanzierungskosten – identisch zur Berechnung von „Gesamtinvestment (GIK)"
        const d_totalInvest = discountedPrice + d_notary + d_broker + d_tax + financingCosts + holdingTotal + prepTotal;
        const d_profitLow = sellPriceLow - d_totalInvest;
        const d_marginLow = sellPriceLow > 0 ? (d_profitLow / sellPriceLow) * 100 : 0;

        const d_profitHigh = sellPriceHigh - d_totalInvest;
        const d_marginHigh = sellPriceHigh > 0 ? (d_profitHigh / sellPriceHigh) * 100 : 0;

        return {
            discount,
            gik: d_totalInvest,
            profitLow: d_profitLow,
            marginLow: d_marginLow,
            profitHigh: d_profitHigh,
            marginHigh: d_marginHigh
        };
    });
    return { results, negotiationTable: table };
};

/**
 * Ranking-Wert eines Fix-&-Flip-Deals: Durchschnitt aller positiven Gewinne (Verkauf Low/High,
 * Kapitalanlage IST/SOLL), frisch aus den gespeicherten Eingaben berechnet. Keine positiven Gewinne → 0.
 */
export const getFixFlipRanking = (dealData) => {
    const { results } = computeFixFlip(buildFixFlipInputs(dealData && typeof dealData === 'object' ? dealData : {}));
    const profits = [results.profitLow, results.profitHigh, results.kapProfitIst, results.kapProfitSoll]
        .filter(v => Number.isFinite(v) && v > 0);
    return profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
};
