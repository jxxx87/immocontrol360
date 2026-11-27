/**
 * Rechen-Helfer der Investor-Rechner (rein, ohne React).
 *
 * - Datumswerte 'YYYY-MM-DD' werden in Jahr/Monat/Tag zerlegt (keine UTC-Verschiebung).
 * - Eine einzige Tilgungsschleife für Restschuld, Volltilgung und Gesamtlaufzeit.
 * - Einheitliche Ermittlung der IST-Miete (laufender Vertrag, Leerstand = 0).
 */

/* ─── Zahlen ─── */
/**
 * Kaufmännisch auf 2 Nachkommastellen runden (…5 → weg von 0).
 * Gleitkomma-Rauschen wird vorher entfernt (z. B. 1,005 × 100 = 100,4999… → 1,01 statt 1,00).
 */
export const round2 = (v) => {
    const n = Number(v) || 0;
    const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)));
    return (Math.sign(n) * cents) / 100 || 0;
};

export const toNumber = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/** Eingabe als nicht-negative Zahl (leer/ungültig → 0). */
export const nonNegative = (v) => Math.max(0, toNumber(v));

/* ─── Datum ─── */
const pad = (n) => String(n).padStart(2, '0');

export const toLocalDateStr = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayStr = () => toLocalDateStr(new Date());

/** Heutiges Datum plus n Jahre als 'YYYY-MM-DD' (lokal). */
export const todayPlusYearsStr = (years) => {
    const d = new Date();
    return toLocalDateStr(new Date(d.getFullYear() + years, d.getMonth(), d.getDate()));
};

export const parseDateStr = (str) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof str === 'string' ? str : '');
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d };
};

const dayNumber = (p) => Date.UTC(p.y, p.m - 1, p.d) / 86400000;

/** Ganze Kalendermonate zwischen zwei Datumswerten (Tag wird ignoriert); null bei ungültigem Datum. */
export const monthsBetween = (startStr, endStr) => {
    const a = parseDateStr(startStr);
    const b = parseDateStr(endStr);
    if (!a || !b) return null;
    return (b.y - a.y) * 12 + (b.m - a.m);
};

/** Jahre (dezimal) zwischen zwei Datumswerten; null bei ungültigem Datum oder Ende <= Start. */
export const yearsBetween = (startStr, endStr) => {
    const a = parseDateStr(startStr);
    const b = parseDateStr(endStr);
    if (!a || !b) return null;
    const days = dayNumber(b) - dayNumber(a);
    if (days <= 0) return null;
    return days / 365.25;
};

/** Lokales Date-Objekt: Datum + n Monate; null bei ungültigem Datum. */
export const addMonthsToDate = (str, months) => {
    const p = parseDateStr(str);
    if (!p) return null;
    return new Date(p.y, p.m - 1 + months, p.d);
};

export const formatDateDE = (str) => {
    const p = parseDateStr(str);
    return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : '';
};

/* ─── Darlehen ─── */
/** Monatsrate einer Annuität aus Betrag, Zins und Anfangstilgung (in %). */
export const monthlyAnnuity = (amount, interestPct, repaymentPct) =>
    (toNumber(amount) * ((toNumber(interestPct) + toNumber(repaymentPct)) / 100)) / 12;

/** Saldo nach n Monaten bei fester Monatsrate (Tilgung = Rate − Zins). */
export const simulateBalance = (balance, interestPct, monthlyPayment, months) => {
    let b = balance;
    const r = toNumber(interestPct) / 100 / 12;
    for (let i = 0; i < months; i++) {
        if (b <= 0) break;
        b = Math.max(0, b - (monthlyPayment - b * r));
    }
    return b;
};

/**
 * Monate bis zur vollständigen Tilgung.
 * null = mit dieser Rate keine Volltilgung (Rate deckt höchstens die Zinsen) oder erst nach mehr als maxMonths.
 */
export const monthsToAmortize = (balance, interestPct, monthlyPayment, maxMonths = 1200) => {
    if (!(balance > 0)) return 0;
    const r = toNumber(interestPct) / 100 / 12;
    if (!(monthlyPayment > 0) || monthlyPayment <= balance * r) return null;
    let b = balance;
    let months = 0;
    while (b > 0.01 && months < maxMonths) {
        b = Math.max(0, b - (monthlyPayment - b * r));
        months++;
    }
    return b > 0.01 ? null : months;
};

/** Geplante Gesamtlaufzeit in Jahren aus dem Tilgungsplan; null wenn nicht ableitbar (kein Betrag, keine Volltilgung). */
export const fullAmortizationYears = (amount, interestPct, repaymentPct, fixedAnnuity) => {
    const a = toNumber(amount);
    if (a <= 0) return null;
    const payment = toNumber(fixedAnnuity) > 0 ? toNumber(fixedAnnuity) : monthlyAnnuity(a, interestPct, repaymentPct);
    const months = monthsToAmortize(a, interestPct, payment);
    return months == null ? null : Math.max(1, Math.round(months / 12));
};

/**
 * Restschuld zum Zinsende.
 * inputs: { loanAmount, interestRate, repaymentRate, startDate, endDate, actualDebt, actualDebtDate, fixedAnnuity }
 * - Ist-Restschuld mit Stichtag → ab Stichtag weiter getilgt
 * - Ist-Restschuld ohne Stichtag → als heutiger Stand angenommen (nicht erneut ab Darlehensbeginn getilgt)
 * Rückgabe: { error, restschuld, basis: 'plan'|'actual'|'actual_undated', fromDate, monthlyPayment }
 */
export const computeRestschuld = (inputs, today = todayStr()) => {
    const amount = toNumber(inputs.loanAmount);
    const fixedAnnuity = toNumber(inputs.fixedAnnuity);
    const monthlyPayment = fixedAnnuity > 0
        ? fixedAnnuity
        : monthlyAnnuity(amount, inputs.interestRate, inputs.repaymentRate);

    const start = parseDateStr(inputs.startDate);
    const end = parseDateStr(inputs.endDate);
    if (!start || !end) {
        return { error: 'Bitte ein gültiges Startdatum und Zinsende eingeben.', restschuld: null, basis: null, fromDate: null, monthlyPayment };
    }
    if (dayNumber(end) <= dayNumber(start)) {
        return { error: 'Das Zinsende muss nach dem Startdatum liegen.', restschuld: null, basis: null, fromDate: null, monthlyPayment };
    }

    let balance = amount;
    let fromDate = inputs.startDate;
    let basis = 'plan';
    const actual = inputs.actualDebt;
    if (actual !== null && actual !== undefined && actual !== '' && Number.isFinite(parseFloat(actual))) {
        balance = Math.max(0, parseFloat(actual));
        if (parseDateStr(inputs.actualDebtDate)) {
            fromDate = inputs.actualDebtDate;
            basis = 'actual';
        } else {
            fromDate = today;
            basis = 'actual_undated';
        }
    }

    const months = monthsBetween(fromDate, inputs.endDate);
    const restschuld = months > 0 ? simulateBalance(balance, inputs.interestRate, monthlyPayment, months) : balance;
    return { error: null, restschuld, basis, fromDate, monthlyPayment };
};

/** Anfangstilgung (%), mit der die Restschuld in remainingYrs Jahren getilgt ist. */
export const recommendedRepayment = (restschuld, newInterestPct, remainingYrs) => {
    if (!(restschuld > 0) || !(remainingYrs > 0)) return 2.0;
    const i = (toNumber(newInterestPct) / 100) / 12;
    const n = remainingYrs * 12;
    if (i === 0) return round2((1 / remainingYrs) * 100);
    const monthlyPayment = restschuld * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    const totalAnnualRate = ((monthlyPayment * 12) / restschuld) * 100;
    return round2(Math.max(0, totalAnnualRate - toNumber(newInterestPct)));
};

/* ─── Miete ─── */
export const isLeaseActiveOn = (lease, today) =>
    !!lease &&
    lease.status === 'active' &&
    (!lease.start_date || lease.start_date <= today) &&
    (!lease.end_date || lease.end_date >= today);

/** Laufender Vertrag der Einheit am Stichtag (bei mehreren der zuletzt begonnene). */
export const getCurrentLease = (unit, today) => (unit?.leases || [])
    .filter(l => isLeaseActiveOn(l, today))
    .reduce((latest, l) => (!latest || (l.start_date || '') > (latest.start_date || '') ? l : latest), null);

/** IST-Kaltmiete einer Einheit: Ferienwohnung → hinterlegter Wert, sonst laufender Vertrag, Leerstand = 0. */
export const getUnitCurrentRent = (unit, today) => {
    if (!unit) return 0;
    if (unit.is_vacation_rental) return toNumber(unit.cold_rent_ist) || toNumber(unit.target_rent);
    const lease = getCurrentLease(unit, today);
    return lease ? toNumber(lease.cold_rent) : 0;
};
