// Gemeinsame Darlehens-/Tilgungslogik für Darlehen-Seite (Loans.jsx), Cockpit (InvestorPortal.jsx)
// und Objektliste (Properties.jsx). Bewusst ohne React, damit alle Seiten dieselbe Restschuld und
// dieselbe Monatsrate zeigen. Referenz ist der Tilgungsplan der Darlehen-Seite.
//
// Regeln:
// - Ratentermine: Startdatum + i Monate (i = 0, 1, …); der Tag wird auf das Monatsende begrenzt.
// - Zins und Tilgung je Rate auf Cent gerundet, die letzte Rate auf Restschuld + Zins begrenzt.
// - Tatsächliche Restschuld mit Stichtag: Raten bis einschließlich Stichtag laufen regulär, danach
//   gilt der Ist-Wert; die nächste Rate folgt am nächsten regulären Ratentag.
// - Tatsächliche Restschuld OHNE Stichtag (Altbestand; neue Einträge verlangen den Stichtag): gilt ab
//   dem Startdatum (Stichtag = Tag vor dem Start) und wird mit einem Hinweis gekennzeichnet.

export const MAX_LOAN_MONTHS = 600; // 50 Jahre

// Zahl aus Eingabe/DB-Wert; leer oder ungültig -> null (eine eingegebene 0 bleibt 0)
export const parseNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

export const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// 'YYYY-MM-DD' (auch mit Zeitanteil) als lokales Datum (nicht UTC)
export const parseLocalDate = (value) => {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
};

// i-ter Ratentermin ab Startdatum; Tag wird auf das Monatsende begrenzt (31.01. -> 28./29.02. -> 31.03.)
export const paymentDateAt = (start, i) => {
    const y = start.getFullYear();
    const m0 = start.getMonth() + i;
    const lastDay = new Date(y, m0 + 1, 0).getDate();
    return new Date(y, m0, Math.min(start.getDate(), lastDay));
};

// Monatliche Rate: feste Rate oder Darlehensbetrag × (Zins + anf. Tilgung) / 12; null, wenn nicht bestimmbar
export const getMonthlyPayment = (loan) => {
    const fixed = parseNum(loan?.fixed_annuity);
    if (fixed !== null && fixed > 0) return round2(fixed);
    const amount = parseNum(loan?.loan_amount);
    const rate = parseNum(loan?.interest_rate);
    const repayment = parseNum(loan?.initial_repayment_rate);
    if (!(amount > 0) || rate === null || repayment === null) return null;
    const payment = round2((amount * (rate + repayment)) / 100 / 12);
    return payment > 0 ? payment : null;
};

export const UNDATED_ACTUAL_NOTICE = 'Tatsächliche Restschuld ohne „Gültig ab“-Datum – wird ab Startdatum angesetzt. Bitte Datum ergänzen.';

/**
 * Tilgungsplan je Monat bis einschließlich untilDate (ohne untilDate: bis zur Volltilgung, höchstens 50 Jahre).
 * Rückgabe: { rows, issue, notice, balance, resetAt, resetAmount }
 * - balance: Restschuld nach der letzten Rate bis untilDate
 * - issue: Grund, warum kein (vollständiger) Plan berechnet werden kann
 * - notice: Hinweis zur Datengrundlage (Ist-Restschuld ohne Stichtag)
 */
export const generateSchedule = (loan, untilDate = null) => {
    const original = parseNum(loan.loan_amount) || 0;
    const start = parseLocalDate(loan.start_date);
    const actual = parseNum(loan.actual_residual_debt);
    let actualDate = parseLocalDate(loan.actual_residual_debt_date);
    let notice = null;
    if (actual !== null && !actualDate && start) {
        actualDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
        notice = UNDATED_ACTUAL_NOTICE;
    }
    const hasReset = actual !== null && !!actualDate;
    const until = untilDate ? new Date(untilDate.getFullYear(), untilDate.getMonth(), untilDate.getDate()) : null;
    const resetApplies = hasReset && (!until || actualDate <= until);
    const result = { rows: [], issue: null, notice, balance: round2(resetApplies ? actual : original), resetAt: null, resetAmount: null };

    const annualRate = parseNum(loan.interest_rate);
    const payment = getMonthlyPayment(loan);
    if (!start) {
        result.issue = 'Startdatum fehlt';
        return result;
    }
    if (annualRate === null || payment === null) {
        result.issue = 'Rate fehlt: feste Rate oder Zinssatz + Tilgung (mit Darlehensbetrag) angeben';
        return result;
    }

    let balance = round2(original);
    let resetDone = false;
    let pendingIssue = null;
    for (let i = 0; i < MAX_LOAN_MONTHS; i++) {
        const date = paymentDateAt(start, i);
        if (hasReset && !resetDone && date > actualDate) {
            if (until && actualDate > until) break;
            balance = round2(actual);
            resetDone = true;
            result.resetAt = actualDate;
            result.resetAmount = balance;
        }
        if (until && date > until) break;
        if (balance <= 0.005) {
            if (hasReset && !resetDone) continue; // regulärer Plan getilgt, Ist-Wert folgt erst zum Stichtag
            break;
        }

        const interest = round2((balance * annualRate) / 100 / 12);
        if (payment <= interest + 0.005) {
            const msg = payment < interest - 0.005
                ? 'Die Rate deckt die monatlichen Zinsen nicht – die Restschuld würde wachsen.'
                : 'Die Rate entspricht nur den Zinsen (tilgungsfrei) – keine Tilgung.';
            // Bis zum Stichtag der tatsächlichen Restschuld ohne Plan weiter, danach mit dem Ist-Wert
            if (hasReset && !resetDone) {
                pendingIssue = msg;
                continue;
            }
            result.issue = msg;
            break;
        }
        const principal = Math.min(round2(payment - interest), balance);
        const endBalance = round2(balance - principal);
        result.rows.push({
            date,
            interest,
            principal,
            payment: round2(interest + principal),
            startBalance: balance,
            endBalance
        });
        balance = endBalance;
    }
    if (!result.issue && !resetDone && pendingIssue) result.issue = pendingIssue;
    result.balance = balance;
    return result;
};

// Aktuelle Restschuld zum Stichtag (Standard: heute) – nie negativ
export const calculateCurrentDebt = (loan, today = new Date()) =>
    Math.max(0, generateSchedule(loan, today).balance);

// Kennzahlen eines Darlehens für den laufenden Monat: getilgte Darlehen zählen nicht mehr mit,
// die Rate ist auf Restschuld + Monatszins begrenzt (letzte Rate)
export const getLoanSnapshot = (loan, today = new Date()) => {
    const debt = calculateCurrentDebt(loan, today);
    const rate = (parseNum(loan.interest_rate) || 0) / 100;
    if (debt <= 0) return { debt: 0, payment: 0, interest: 0, repayment: 0, rate };
    const nominal = getMonthlyPayment(loan) || 0;
    const interest = (debt * rate) / 12;
    const payment = Math.min(nominal, debt + interest);
    return { debt, payment, interest, repayment: Math.max(0, payment - interest), rate };
};
