// Unit-Tests der gemeinsamen Darlehenslogik (Loans.jsx, InvestorPortal.jsx, Properties.jsx).
// Erwartungswerte von Hand nachgerechnet; Rechenweg jeweils als Kommentar.
// Datumswerte werden lokal erzeugt (new Date(y, m, d)), wie in der App.
import { describe, it, expect } from 'vitest';
import {
    MAX_LOAN_MONTHS,
    parseNum,
    round2,
    parseLocalDate,
    paymentDateAt,
    getMonthlyPayment,
    generateSchedule,
    calculateCurrentDebt,
    getLoanSnapshot,
    UNDATED_ACTUAL_NOTICE
} from './loanSchedule';

// ─── Vergleichsfassungen vor der Zusammenführung (wörtlich übernommen) ──────────────

// Bisher InvestorPortal.jsx (Cockpit) – eigenständige Umsetzung derselben Regeln wie der Tilgungsplan
const oldInvestorPortalDebt = (loan, today = new Date()) => {
    const original = parseNum(loan.loan_amount) || 0;
    const start = parseLocalDate(loan.start_date);
    const actual = parseNum(loan.actual_residual_debt);
    let actualDate = parseLocalDate(loan.actual_residual_debt_date);
    if (actual !== null && !actualDate && start) {
        actualDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    }
    const hasReset = actual !== null && !!actualDate;
    const until = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const resetApplies = hasReset && actualDate <= until;
    const annualRate = parseNum(loan.interest_rate);
    const payment = getMonthlyPayment(loan);
    if (!start || annualRate === null || payment === null) {
        return Math.max(0, round2(resetApplies ? actual : original));
    }
    let balance = round2(original);
    let resetDone = false;
    for (let i = 0; i < MAX_LOAN_MONTHS; i++) {
        const date = paymentDateAt(start, i);
        if (hasReset && !resetDone && date > actualDate) {
            if (actualDate > until) break;
            balance = round2(actual);
            resetDone = true;
        }
        if (date > until) break;
        if (balance <= 0.005) {
            if (hasReset && !resetDone) continue;
            break;
        }
        const interest = round2((balance * annualRate) / 100 / 12);
        if (payment <= interest + 0.005) {
            if (hasReset && !resetDone) continue;
            break;
        }
        const principal = Math.min(round2(payment - interest), balance);
        balance = round2(balance - principal);
    }
    return Math.max(0, balance);
};

// Bisher Properties.jsx (Objektliste) – abweichende Regeln (ohne Rundung, Rate am Stichtag selbst,
// Ist-Restschuld ohne Stichtag unverändert)
const oldPropertiesDebt = (loan, today) => {
    const originalAmount = parseFloat(loan.loan_amount || 0);
    const interestRate = parseFloat(loan.interest_rate || 0) / 100;
    let monthlyPayment = parseFloat(loan.fixed_annuity || 0);
    if (!monthlyPayment) {
        const repaymentRate = parseFloat(loan.initial_repayment_rate || 0) / 100;
        monthlyPayment = (originalAmount * (interestRate + repaymentRate)) / 12;
    }
    const hasActual = loan.actual_residual_debt !== null && loan.actual_residual_debt !== undefined && loan.actual_residual_debt !== '';
    const amount = hasActual ? (parseFloat(loan.actual_residual_debt) || 0) : originalAmount;
    if (hasActual && !loan.actual_residual_debt_date) return amount;
    const startDateStr = hasActual ? loan.actual_residual_debt_date : loan.start_date;
    if (!startDateStr) return amount;
    const startDate = new Date(startDateStr);
    if (isNaN(startDate.getTime())) return amount;
    if (!(monthlyPayment > 0)) return amount;
    let currentBalance = amount;
    const currentDate = new Date(startDate);
    let months = 0;
    while (currentBalance > 0.01 && months < 600) {
        if (currentDate > today) break;
        const monthlyInterest = currentBalance * interestRate / 12;
        const endBalance = currentBalance - (monthlyPayment - monthlyInterest);
        currentBalance = endBalance < 0 ? 0 : endBalance;
        currentDate.setMonth(currentDate.getMonth() + 1);
        months++;
    }
    return currentBalance;
};

// Zinsfrei, 12.000 € mit 100 % Anfangstilgung -> 12.000 × 100 % / 12 = 1.000 €/Monat, erste Rate am 15.01.2024
const zinsfrei = { loan_amount: 12000, interest_rate: 0, initial_repayment_rate: 100, start_date: '2024-01-15' };

describe('Grundbausteine', () => {
    it('parseNum: leer/ungültig -> null, 0 bleibt 0, Komma als Dezimaltrenner', () => {
        expect(parseNum('')).toBeNull();
        expect(parseNum(null)).toBeNull();
        expect(parseNum('abc')).toBeNull();
        expect(parseNum(0)).toBe(0);
        expect(parseNum('3,5')).toBe(3.5);
    });

    it('parseLocalDate liest YYYY-MM-DD lokal (auch mit Zeitanteil)', () => {
        expect(parseLocalDate('2024-02-29')).toEqual(new Date(2024, 1, 29));
        expect(parseLocalDate('2024-05-01T23:30:00Z')).toEqual(new Date(2024, 4, 1));
        expect(parseLocalDate('')).toBeNull();
        expect(parseLocalDate('01.02.2024')).toBeNull();
    });

    it('paymentDateAt begrenzt den Ratentag auf das Monatsende (31.01. -> 29.02. -> 31.03.)', () => {
        const start = new Date(2024, 0, 31);
        expect(paymentDateAt(start, 1)).toEqual(new Date(2024, 1, 29));
        expect(paymentDateAt(start, 2)).toEqual(new Date(2024, 2, 31));
        expect(paymentDateAt(start, 13)).toEqual(new Date(2025, 1, 28));
    });

    it('getMonthlyPayment: feste Rate hat Vorrang, sonst Betrag × (Zins + Tilgung) / 12', () => {
        // 200.000 × (3 % + 2 %) / 12 = 833,333… -> 833,33
        expect(getMonthlyPayment({ loan_amount: 200000, interest_rate: 3, initial_repayment_rate: 2 })).toBe(833.33);
        expect(getMonthlyPayment({ loan_amount: 200000, interest_rate: 3, initial_repayment_rate: 2, fixed_annuity: '950,50' })).toBe(950.5);
        expect(getMonthlyPayment({ loan_amount: 200000, interest_rate: 3 })).toBeNull(); // keine Tilgung angegeben
        expect(getMonthlyPayment({ interest_rate: 3, initial_repayment_rate: 2 })).toBeNull(); // kein Betrag
        expect(getMonthlyPayment({ loan_amount: 1000, interest_rate: 0, initial_repayment_rate: 0 })).toBeNull(); // Rate 0
    });
});

describe('generateSchedule / calculateCurrentDebt', () => {
    it('ohne Rate: keine Tilgung, Ursprungsbetrag (bzw. Ist-Restschuld) bleibt stehen', () => {
        const loan = { loan_amount: 100000, interest_rate: 3, start_date: '2020-01-01' };
        const res = generateSchedule(loan, new Date(2024, 0, 1));
        expect(res.issue).toMatch(/^Rate fehlt/);
        expect(res.balance).toBe(100000);
        expect(calculateCurrentDebt({ ...loan, actual_residual_debt: 80000, actual_residual_debt_date: '2023-01-01' }, new Date(2024, 0, 1))).toBe(80000);
    });

    it('zinsfrei: Raten am 15.01., 15.02., 15.03. -> 12.000 − 3 × 1.000 = 9.000', () => {
        expect(calculateCurrentDebt(zinsfrei, new Date(2024, 2, 20))).toBe(9000);
        // am Ratentag selbst zählt die Rate bereits
        expect(calculateCurrentDebt(zinsfrei, new Date(2024, 2, 15))).toBe(9000);
        expect(calculateCurrentDebt(zinsfrei, new Date(2024, 2, 14))).toBe(10000);
        // vor der ersten Rate
        expect(calculateCurrentDebt(zinsfrei, new Date(2024, 0, 14))).toBe(12000);
    });

    it('6 % p. a., Rate 1.000 €: Rate 1 Zins 500 -> 99.500; Rate 2 Zins 497,50 -> 98.997,50', () => {
        const loan = { loan_amount: 100000, interest_rate: 6, fixed_annuity: 1000, start_date: '2024-01-01' };
        expect(calculateCurrentDebt(loan, new Date(2024, 0, 1))).toBe(99500);
        expect(calculateCurrentDebt(loan, new Date(2024, 1, 1))).toBe(98997.5);
        const rows = generateSchedule(loan, new Date(2024, 1, 1)).rows;
        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatchObject({ interest: 497.5, principal: 502.5, payment: 1000, startBalance: 99500, endBalance: 98997.5 });
    });

    it('Ist-Restschuld mit Stichtag: Raten bis zum Stichtag regulär, danach ab dem Ist-Wert', () => {
        // 15.01. -> 11.000, 15.02. -> 10.000; Stichtag 20.02.: 5.000; 15.03. -> 4.000, 15.04. -> 3.000
        const loan = { ...zinsfrei, actual_residual_debt: 5000, actual_residual_debt_date: '2024-02-20' };
        const res = generateSchedule(loan, new Date(2024, 3, 30));
        expect(res.balance).toBe(3000);
        expect(res.resetAt).toEqual(new Date(2024, 1, 20));
        expect(res.resetAmount).toBe(5000);
        expect(res.notice).toBeNull();
        // Stichtag selbst, noch keine weitere Rate
        expect(calculateCurrentDebt(loan, new Date(2024, 1, 20))).toBe(5000);
    });

    it('Stichtag der Ist-Restschuld in der Zukunft: bis dahin gilt der reguläre Plan', () => {
        const loan = { ...zinsfrei, actual_residual_debt: 5000, actual_residual_debt_date: '2024-06-01' };
        expect(calculateCurrentDebt(loan, new Date(2024, 2, 20))).toBe(9000);
        // ab dem Stichtag gilt der Ist-Wert: 01.06. 5.000, Rate 15.06. -> 4.000
        expect(calculateCurrentDebt(loan, new Date(2024, 5, 20))).toBe(4000);
    });

    it('Ist-Restschuld ohne Stichtag: gilt ab Startdatum (mit Hinweis) – einheitlich auf allen Seiten', () => {
        // Stichtag = 14.01.; Raten 15.01., 15.02., 15.03. ab 5.000 -> 2.000
        const loan = { ...zinsfrei, actual_residual_debt: 5000, actual_residual_debt_date: null };
        const res = generateSchedule(loan, new Date(2024, 2, 20));
        expect(res.balance).toBe(2000);
        expect(res.notice).toBe(UNDATED_ACTUAL_NOTICE);
        expect(calculateCurrentDebt(loan, new Date(2024, 2, 20))).toBe(2000);
        // Bisherige Objektliste ließ den Wert stehen (5.000) – das war die Abweichung zu Darlehen-Seite und Cockpit
        expect(oldPropertiesDebt(loan, new Date(2024, 2, 20))).toBe(5000);
    });

    it('getilgt: nie negativ, letzte Rate auf die Restschuld begrenzt', () => {
        // 2.500 € zinsfrei mit 1.000 €/Monat (480 % Tilgung): 1.500, 500, letzte Rate 500 -> 0
        const loan = { loan_amount: 2500, interest_rate: 0, initial_repayment_rate: 480, start_date: '2024-01-01' };
        const res = generateSchedule(loan, new Date(2025, 0, 1));
        expect(res.balance).toBe(0);
        expect(res.rows).toHaveLength(3);
        expect(res.rows[2]).toMatchObject({ principal: 500, payment: 500, endBalance: 0 });
        expect(calculateCurrentDebt(loan, new Date(2030, 0, 1))).toBe(0);
        // negative Ist-Restschuld wird nicht negativ übernommen
        expect(calculateCurrentDebt({ ...loan, actual_residual_debt: -50, actual_residual_debt_date: '2024-06-01' }, new Date(2024, 5, 1))).toBe(0);
    });

    it('Rate deckt die Zinsen nicht: Hinweis, keine Tilgung', () => {
        // 100.000 × 6 % / 12 = 500 € Zins > 400 € Rate
        const loan = { loan_amount: 100000, interest_rate: 6, fixed_annuity: 400, start_date: '2024-01-01' };
        const res = generateSchedule(loan, new Date(2024, 5, 1));
        expect(res.issue).toBe('Die Rate deckt die monatlichen Zinsen nicht – die Restschuld würde wachsen.');
        expect(res.balance).toBe(100000);
        // nur Zinsen (tilgungsfrei)
        expect(generateSchedule({ ...loan, fixed_annuity: 500 }, new Date(2024, 5, 1)).issue)
            .toBe('Die Rate entspricht nur den Zinsen (tilgungsfrei) – keine Tilgung.');
    });

    it('ohne Startdatum: Hinweis, Ursprungsbetrag', () => {
        const res = generateSchedule({ loan_amount: 5000, interest_rate: 1, initial_repayment_rate: 2 }, new Date(2024, 0, 1));
        expect(res.issue).toBe('Startdatum fehlt');
        expect(res.balance).toBe(5000);
    });

    it('ohne untilDate: vollständiger Plan bis zur Volltilgung', () => {
        const res = generateSchedule(zinsfrei);
        expect(res.rows).toHaveLength(12);
        expect(res.balance).toBe(0);
    });
});

describe('Vergleich mit der bisherigen Cockpit-Rechnung (InvestorPortal.jsx)', () => {
    const loans = [
        zinsfrei,
        { loan_amount: 250000, interest_rate: 3.15, initial_repayment_rate: 2, start_date: '2019-03-31' },
        { loan_amount: 180000, interest_rate: 1.2, fixed_annuity: 640, start_date: '2016-08-30' },
        { loan_amount: 300000, interest_rate: 4.1, initial_repayment_rate: 1.5, start_date: '2023-11-15', actual_residual_debt: 291500.12, actual_residual_debt_date: '2025-02-10' },
        { loan_amount: 90000, interest_rate: 2, initial_repayment_rate: 3, start_date: '2021-01-31', actual_residual_debt: 70000, actual_residual_debt_date: '2027-05-01' },
        { loan_amount: 120000, interest_rate: 6, fixed_annuity: 550, start_date: '2022-02-01', actual_residual_debt: 100000, actual_residual_debt_date: '2024-01-15' },
        { loan_amount: 50000, interest_rate: 0, initial_repayment_rate: 10, start_date: '2015-05-05', actual_residual_debt: 1000, actual_residual_debt_date: null },
        { loan_amount: 75000, interest_rate: 3, start_date: '2020-01-01' },
        { loan_amount: '', interest_rate: 2, fixed_annuity: 300, start_date: '2020-01-01', actual_residual_debt: 20000, actual_residual_debt_date: '2022-06-30' }
    ];
    const dates = [new Date(2016, 0, 1), new Date(2020, 5, 30), new Date(2024, 1, 29), new Date(2025, 1, 10), new Date(2026, 10, 28), new Date(2040, 0, 1)];

    it('liefert für alle Vergleichsfälle exakt dieselbe Restschuld', () => {
        loans.forEach(loan => {
            dates.forEach(d => {
                expect(calculateCurrentDebt(loan, d)).toBe(oldInvestorPortalDebt(loan, d));
            });
        });
    });
});

describe('getLoanSnapshot – Monatswerte für Cockpit und Objektliste', () => {
    it('laufendes Darlehen: volle Rate, Zins aus der aktuellen Restschuld', () => {
        // Restschuld 9.000 zinsfrei -> Rate 1.000, Zins 0
        expect(getLoanSnapshot(zinsfrei, new Date(2024, 2, 20))).toEqual({ debt: 9000, payment: 1000, interest: 0, repayment: 1000, rate: 0 });
        // 6 %: Restschuld 99.500 -> Zins 99.500 × 6 % / 12 = 497,50, Tilgung 502,50
        const snap = getLoanSnapshot({ loan_amount: 100000, interest_rate: 6, fixed_annuity: 1000, start_date: '2024-01-01' }, new Date(2024, 0, 10));
        expect(snap.debt).toBe(99500);
        expect(snap.payment).toBe(1000);
        expect(snap.interest).toBeCloseTo(497.5, 10);
        expect(snap.repayment).toBeCloseTo(502.5, 10);
    });

    it('letzte Rate begrenzt, getilgtes Darlehen zählt nicht mehr', () => {
        const loan = { loan_amount: 2500, interest_rate: 0, initial_repayment_rate: 480, start_date: '2024-01-01' };
        expect(getLoanSnapshot(loan, new Date(2024, 1, 10)).payment).toBe(500); // Restschuld 500
        expect(getLoanSnapshot(loan, new Date(2024, 5, 1))).toEqual({ debt: 0, payment: 0, interest: 0, repayment: 0, rate: 0 });
    });

    it('ohne bestimmbare Rate: Restschuld zählt, Rate 0', () => {
        const snap = getLoanSnapshot({ loan_amount: 75000, interest_rate: 3, start_date: '2020-01-01' }, new Date(2024, 0, 1));
        expect(snap.debt).toBe(75000);
        expect(snap.payment).toBe(0);
    });
});
