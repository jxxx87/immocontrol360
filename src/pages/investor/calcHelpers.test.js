/**
 * Unit-Tests der Investor-Rechenhelfer (Darlehen, Datum, IST-Miete) und der
 * Grunderwerbsteuer-Tabelle. Reine Funktionen, kein Supabase/Netz.
 *
 * Annuitätendarlehen (Monatsrate R, Monatszins r = p/12):
 *   Rate         R  = K · (Zins% + Tilgung%) / 100 / 12
 *   Restschuld   Bn = K·qⁿ − R·(qⁿ − 1)/r            mit q = 1 + r
 *   Laufzeit     n  = −ln(1 − r·K/R) / ln(q)
 *   Volltilgung in n Monaten: R = K · r·qⁿ / (qⁿ − 1)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    round2, toNumber, nonNegative,
    toLocalDateStr, todayStr, todayPlusYearsStr, parseDateStr, monthsBetween, yearsBetween, addMonthsToDate, formatDateDE,
    monthlyAnnuity, simulateBalance, monthsToAmortize, fullAmortizationYears, computeRestschuld, recommendedRepayment,
    isLeaseActiveOn, getCurrentLease, getUnitCurrentRent,
} from './calcHelpers';
import { TRANSFER_TAX_RATES, TRANSFER_TAX_RATES_AS_OF } from './transferTaxRates';

const restschuldFormel = (K, zinsPct, R, n) => {
    const r = zinsPct / 100 / 12;
    const q = Math.pow(1 + r, n);
    return K * q - R * (q - 1) / r;
};

/* ─── Zahlen ─── */

describe('round2 – kaufmännisch auf Cent', () => {
    it('rundet …5 auf, auch wenn die Gleitkommadarstellung knapp darunter liegt', () => {
        expect(round2(1.005)).toBe(1.01);        // 1.005 · 100 = 100.4999… in Gleitkomma
        expect(round2(2.5 * 19.99)).toBe(49.98); // 49,975 € (Gleitkomma 49.97499…)
        expect(round2('7.125')).toBe(7.13);
        expect(round2(12.344)).toBe(12.34);
    });

    it('negative Beträge symmetrisch (weg von 0)', () => {
        expect(round2(-1.005)).toBe(-1.01);
        expect(round2(-12.344)).toBe(-12.34);
    });

    it('leer/ungültig → 0, kein −0', () => {
        expect(round2(null)).toBe(0);
        expect(round2(undefined)).toBe(0);
        expect(round2('abc')).toBe(0);
        expect(Object.is(round2(-0.001), 0)).toBe(true);
    });
});

describe('toNumber / nonNegative', () => {
    it('wandelt Zahlstrings, leere und ungültige Werte', () => {
        expect(toNumber('3.5')).toBe(3.5);
        expect(toNumber(42)).toBe(42);
        expect(toNumber('')).toBe(0);
        expect(toNumber(null)).toBe(0);
        expect(toNumber(undefined)).toBe(0);
        expect(toNumber('abc')).toBe(0);
        expect(toNumber(Infinity)).toBe(0);
    });

    it('nonNegative kappt negative Eingaben auf 0', () => {
        expect(nonNegative(-5)).toBe(0);
        expect(nonNegative('7.5')).toBe(7.5);
        expect(nonNegative('')).toBe(0);
    });
});

/* ─── Datum ─── */

describe('Datumshelfer', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('parseDateStr zerlegt YYYY-MM-DD ohne UTC-Verschiebung, auch mit Zeitanteil', () => {
        expect(parseDateStr('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
        expect(parseDateStr('2024-05-01T23:30:00Z')).toEqual({ y: 2024, m: 5, d: 1 });
    });

    it('parseDateStr lehnt ungültige Monate/Tage und Nicht-Strings ab', () => {
        expect(parseDateStr('2024-13-01')).toBeNull();
        expect(parseDateStr('2024-00-10')).toBeNull();
        expect(parseDateStr('2024-01-00')).toBeNull();
        expect(parseDateStr('2024-01-32')).toBeNull();
        expect(parseDateStr('01.02.2024')).toBeNull();
        expect(parseDateStr('')).toBeNull();
        expect(parseDateStr(null)).toBeNull();
        expect(parseDateStr(20240101)).toBeNull();
    });

    it('formatDateDE / toLocalDateStr', () => {
        expect(formatDateDE('2024-02-29')).toBe('29.02.2024');
        expect(formatDateDE('kaputt')).toBe('');
        expect(toLocalDateStr(new Date(2024, 0, 5))).toBe('2024-01-05');
    });

    it('todayStr / todayPlusYearsStr (lokal, Vorgabe-Zinsende)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2024, 1, 29, 12, 0, 0));
        expect(todayStr()).toBe('2024-02-29');
        expect(todayPlusYearsStr(4)).toBe('2028-02-29');  // 2028 ist Schaltjahr
        vi.setSystemTime(new Date(2025, 5, 15, 12, 0, 0));
        expect(todayPlusYearsStr(10)).toBe('2035-06-15');
    });

    it('monthsBetween zählt ganze Kalendermonate, der Tag wird bewusst ignoriert', () => {
        expect(monthsBetween('2020-01-15', '2030-01-15')).toBe(120);
        expect(monthsBetween('2024-01-31', '2024-02-01')).toBe(1);
        expect(monthsBetween('2025-03-01', '2024-03-01')).toBe(-12);
        expect(monthsBetween('2024-01-01', 'x')).toBeNull();
    });

    it('yearsBetween = Tage / 365,25 (Schaltjahre berücksichtigt)', () => {
        expect(yearsBetween('2024-01-01', '2025-01-01')).toBeCloseTo(366 / 365.25, 12); // 2024 Schaltjahr
        expect(yearsBetween('2023-01-01', '2024-01-01')).toBeCloseTo(365 / 365.25, 12);
        // 2020-01-01 … 2030-01-01: 10 · 365 + 3 Schalttage (2020, 2024, 2028) = 3.653 Tage
        expect(yearsBetween('2020-01-01', '2030-01-01')).toBeCloseTo(3653 / 365.25, 12);
        expect(yearsBetween('2024-01-01', '2024-01-01')).toBeNull();
        expect(yearsBetween('2025-01-01', '2024-01-01')).toBeNull();
        expect(yearsBetween('', '2024-01-01')).toBeNull();
    });

    it('addMonthsToDate: normaler Fall und Jahreswechsel', () => {
        expect(toLocalDateStr(addMonthsToDate('2024-01-15', 1))).toBe('2024-02-15');
        expect(toLocalDateStr(addMonthsToDate('2024-10-15', 3))).toBe('2025-01-15');
        expect(toLocalDateStr(addMonthsToDate('2024-05-10', 12))).toBe('2025-05-10');
        expect(addMonthsToDate('kein Datum', 3)).toBeNull();
    });

    it('Sperrfrist § 558 BGB ("frühestens ab"): Tag existiert im Zielmonat → gleicher Tag', () => {
        // Letzte Erhöhung wirksam ab 31.01.2024 (Tagesbeginn, § 187 Abs. 2 BGB): Jahresfrist endet mit
        // Ablauf des 30.01.2025 (§ 188 Abs. 2 Alt. 2) → Verlangen frühestens ab 31.01.2025
        expect(toLocalDateStr(addMonthsToDate('2024-01-31', 12))).toBe('2025-01-31');
        // 15-Monats-Frist ab 31.03.2024: Juni hat keinen 31. → Frist endet 30.06.2025 (§ 188 Abs. 3),
        // wirksam frühestens ab 01.07.2025
        expect(toLocalDateStr(addMonthsToDate('2024-03-31', 15))).toBe('2025-07-01');
        // Letzte Erhöhung 29.02.2024: Jahresfrist endet mit Ablauf des 28.02.2025 → frühestens ab 01.03.2025
        expect(toLocalDateStr(addMonthsToDate('2024-02-29', 12))).toBe('2025-03-01');
    });

    // BEFUND: Fehlt der Tag im Zielmonat und der Monat ist zwei Tage kürzer oder mehr (30./31. → Februar), läuft
    // addMonthsToDate um 1–2 Tage zu weit: 30.11.2023 + 15 Monate → 02.03.2025. Richtig wäre „wirksam
    // frühestens ab“ 01.03.2025 (Frist endet am 28.02.2025, § 188 Abs. 3 BGB). Für § 558 BGB liegt der Fehler auf
    // der sicheren Seite (zu spät, nie zu früh). Ein Kappen auf den Monatsletzten (28.02.) wäre einen Tag ZU FRÜH
    // und rechtlich falsch, deshalb zurückgenommen. Vorschlag: eigener Frist-Helfer „fehlender Tag → 1. des
    // Folgemonats“. Das Tilgungsdatum (endDate + n Monate) braucht dagegen ein eigenes Monatsende-Verhalten.
    it.todo('BEFUND: 30.11.2023 + 15 Monate (§ 558 BGB, frühestens ab) → 01.03.2025 statt 02.03.2025');
    it.todo('BEFUND: Tilgungsdatum 31.01. + 1 Monat → 02.03. (Monatsüberlauf, Anzeige „Vollständige Tilgung“)');
});

/* ─── Darlehen ─── */

describe('monthlyAnnuity', () => {
    it('200.000 € zu 3 % Zins + 2 % Tilgung → 10.000 € p. a. = 833,33 € / Monat', () => {
        expect(monthlyAnnuity(200000, 3, 2)).toBeCloseTo(833.3333, 4);
        expect(monthlyAnnuity('200000', '3', '2')).toBeCloseTo(833.3333, 4);
    });

    it('fehlende Werte → 0', () => {
        expect(monthlyAnnuity(null, 3, 2)).toBe(0);
        expect(monthlyAnnuity(100000, null, null)).toBe(0);
    });
});

describe('simulateBalance – Saldo nach n Monaten', () => {
    it('zinsfrei: 100.000 − 12 · 1.000 = 88.000', () => {
        expect(simulateBalance(100000, 0, 1000, 12)).toBe(88000);
    });

    it('6 % p. a., Rate 1.000 €: Monat 1 Zins 500 → 99.500; Monat 2 Zins 497,50 → 98.997,50', () => {
        expect(simulateBalance(100000, 6, 1000, 1)).toBeCloseTo(99500, 8);
        expect(simulateBalance(100000, 6, 1000, 2)).toBeCloseTo(98997.5, 8);
    });

    it('6 % p. a. nach 12 Monaten entspricht der Annuitätenformel (≈ 93.832,22 €)', () => {
        expect(simulateBalance(100000, 6, 1000, 12)).toBeCloseTo(restschuldFormel(100000, 6, 1000, 12), 6);
        expect(round2(simulateBalance(100000, 6, 1000, 12))).toBe(93832.22);
    });

    it('wird nach Volltilgung nicht negativ; 0 Monate = unverändert', () => {
        expect(simulateBalance(1000, 0, 600, 5)).toBe(0);
        expect(simulateBalance(1000, 5, 600, 0)).toBe(1000);
    });
});

describe('monthsToAmortize / fullAmortizationYears', () => {
    it('zinsfrei: 12.000 € mit 1.000 €/Monat = 12 Monate; mit 1.100 € = 11 (letzte Rate anteilig)', () => {
        expect(monthsToAmortize(12000, 0, 1000)).toBe(12);
        expect(monthsToAmortize(12000, 0, 1100)).toBe(11);
    });

    it('200.000 € / 3 % / 2 % Tilgung: n = ln(2,5)/ln(1,0025) = 366,97 → 367 Monate ≈ 31 Jahre', () => {
        const R = monthlyAnnuity(200000, 3, 2);
        expect(monthsToAmortize(200000, 3, R)).toBe(367);
        expect(fullAmortizationYears(200000, 3, 2)).toBe(31); // 367 / 12 = 30,58 → 31
    });

    it('feste Annuität 1.000 € hat Vorrang: n = −ln(1 − 0,5)/ln(1,0025) = 277,6 → 278 Monate ≈ 23 Jahre', () => {
        expect(fullAmortizationYears(200000, 3, 2, 1000)).toBe(23);
    });

    it('Rate deckt nur die Zinsen (oder ist 0) → keine Volltilgung (null)', () => {
        expect(monthsToAmortize(100000, 6, 500)).toBeNull();   // 100.000 · 0,5 % = 500 € Zins
        expect(monthsToAmortize(100000, 6, 0)).toBeNull();
        expect(fullAmortizationYears(100000, 6, 0)).toBeNull(); // 0 % Tilgung
    });

    it('Volltilgung erst nach > 100 Jahren (1.200 Monaten) → null', () => {
        // n = −ln(1 − 500/500,01)/ln(1,005) ≈ 2.169 Monate
        expect(monthsToAmortize(100000, 6, 500.01)).toBeNull();
    });

    it('kein Restbetrag → 0 Monate; kein Darlehensbetrag → null Jahre; Mindestlaufzeit 1 Jahr', () => {
        expect(monthsToAmortize(0, 3, 500)).toBe(0);
        expect(fullAmortizationYears(0, 3, 2)).toBeNull();
        // 1.000 € zinsfrei, 400 % Tilgung → 333,33 €/Monat → 3 Monate → round(0,25) = 0 → min. 1
        expect(fullAmortizationYears(1000, 0, 400)).toBe(1);
    });
});

describe('computeRestschuld – Restschuld zum Zinsende', () => {
    const base = { loanAmount: 100000, interestRate: 0, repaymentRate: 12, startDate: '2020-01-01', endDate: '2021-01-01' };

    it('Plan: zinsfrei, 12 % Tilgung = 1.000 €/Monat, 12 Monate → 88.000 €', () => {
        expect(computeRestschuld(base)).toEqual({ error: null, restschuld: 88000, basis: 'plan', fromDate: '2020-01-01', monthlyPayment: 1000 });
    });

    it('Plan 10 Jahre: 200.000 € / 3 % / 2 % → Annuitätenformel ≈ 153.419,53 €', () => {
        const res = computeRestschuld({ loanAmount: 200000, interestRate: 3, repaymentRate: 2, startDate: '2015-01-01', endDate: '2025-01-01' });
        const R = 200000 * 0.05 / 12;
        expect(res.restschuld).toBeCloseTo(restschuldFormel(200000, 3, R, 120), 4);
        expect(round2(res.restschuld)).toBe(153419.53);
    });

    it('feste Annuität ersetzt Zins+Tilgung: 100.000 − 12 · 1.500 = 82.000 €', () => {
        const res = computeRestschuld({ ...base, fixedAnnuity: 1500 });
        expect(res.monthlyPayment).toBe(1500);
        expect(res.restschuld).toBe(82000);
    });

    it('Ist-Restschuld mit Stichtag wird ab Stichtag weiter getilgt (6 Monate → 50.000 − 6.000)', () => {
        const res = computeRestschuld({ ...base, actualDebt: 50000, actualDebtDate: '2020-07-01' });
        expect(res).toMatchObject({ restschuld: 44000, basis: 'actual', fromDate: '2020-07-01' });
    });

    it('Ist-Restschuld ohne Stichtag gilt als heutiger Stand (heute 01.10.2020 → 3 Monate)', () => {
        const res = computeRestschuld({ ...base, actualDebt: '50000', actualDebtDate: '' }, '2020-10-01');
        expect(res).toMatchObject({ restschuld: 47000, basis: 'actual_undated', fromDate: '2020-10-01' });
    });

    it('leere Ist-Restschuld → Planrechnung', () => {
        expect(computeRestschuld({ ...base, actualDebt: '' }).basis).toBe('plan');
        expect(computeRestschuld({ ...base, actualDebt: null }).basis).toBe('plan');
    });

    it('negative Ist-Restschuld wird auf 0 gesetzt', () => {
        expect(computeRestschuld({ ...base, actualDebt: -500, actualDebtDate: '2020-07-01' }).restschuld).toBe(0);
    });

    it('Stichtag nach Zinsende → keine (negative) Tilgung, Ist-Wert bleibt', () => {
        expect(computeRestschuld({ ...base, actualDebt: 50000, actualDebtDate: '2021-06-01' }).restschuld).toBe(50000);
    });

    it('Volltilgung vor Zinsende → 0, nicht negativ', () => {
        expect(computeRestschuld({ ...base, loanAmount: 10000, repaymentRate: 120 }).restschuld).toBe(0);
    });

    it('ungültige Daten oder Zinsende ≤ Start → Fehlermeldung, Rate wird trotzdem geliefert', () => {
        const a = computeRestschuld({ ...base, startDate: '' });
        expect(a.error).toBe('Bitte ein gültiges Startdatum und Zinsende eingeben.');
        expect(a.restschuld).toBeNull();
        expect(a.monthlyPayment).toBe(1000);
        const b = computeRestschuld({ ...base, endDate: '2020-01-01' });
        expect(b.error).toBe('Das Zinsende muss nach dem Startdatum liegen.');
        expect(b.restschuld).toBeNull();
    });
});

describe('recommendedRepayment – Anfangstilgung für Volltilgung in der Restlaufzeit', () => {
    it('3 % Zins, 20 Jahre: Annuität 6,6552 % p. a. − 3 % Zins = 3,66 % Tilgung', () => {
        const q = Math.pow(1.0025, 240);
        const annuitaetPct = (0.0025 * q / (q - 1)) * 12 * 100; // 6,6552 %
        expect(recommendedRepayment(100000, 3, 20)).toBe(round2(annuitaetPct - 3));
        expect(recommendedRepayment(100000, 3, 20)).toBe(3.66);
        // Gegenprobe: mit dieser Tilgung ist das Darlehen nach ≈ 20 Jahren getilgt
        expect(monthsToAmortize(100000, 3, 100000 * (3 + 3.66) / 100 / 12)).toBe(240);
    });

    it('5 % Zins, 30 Jahre: Annuität 6,4419 % − 5 % = 1,44 %', () => {
        expect(recommendedRepayment(100000, 5, 30)).toBe(1.44);
    });

    it('zinsfrei: lineare Tilgung 100 % / Jahre', () => {
        expect(recommendedRepayment(100000, 0, 10)).toBe(10);
        expect(recommendedRepayment(100000, 0, 3)).toBe(33.33);
    });

    it('ohne Restschuld oder Restlaufzeit → Standardwert 2 %', () => {
        expect(recommendedRepayment(0, 3, 20)).toBe(2);
        expect(recommendedRepayment(-100, 3, 20)).toBe(2);
        expect(recommendedRepayment(100000, 3, 0)).toBe(2);
    });
});

/* ─── Miete ─── */

describe('IST-Miete', () => {
    const today = '2024-06-15';
    const lease = (o) => ({ status: 'active', start_date: '2024-01-01', end_date: null, cold_rent: 700, ...o });

    it('isLeaseActiveOn: Beginn und Ende inklusive, nur Status active', () => {
        expect(isLeaseActiveOn(lease(), today)).toBe(true);
        expect(isLeaseActiveOn(lease({ start_date: today }), today)).toBe(true);
        expect(isLeaseActiveOn(lease({ end_date: today }), today)).toBe(true);
        expect(isLeaseActiveOn(lease({ end_date: '2024-06-14' }), today)).toBe(false);
        expect(isLeaseActiveOn(lease({ start_date: '2024-06-16' }), today)).toBe(false);
        expect(isLeaseActiveOn(lease({ status: 'terminated' }), today)).toBe(false);
        expect(isLeaseActiveOn(lease({ start_date: null }), today)).toBe(true);
        expect(isLeaseActiveOn(null, today)).toBe(false);
    });

    it('getCurrentLease: bei mehreren laufenden Verträgen der zuletzt begonnene', () => {
        const unit = {
            leases: [
                lease({ id: 'alt', start_date: '2020-01-01' }),
                lease({ id: 'neu', start_date: '2024-03-01' }),
                lease({ id: 'zukunft', start_date: '2024-07-01' }),
                lease({ id: 'beendet', start_date: '2024-05-01', end_date: '2024-05-31' }),
            ],
        };
        expect(getCurrentLease(unit, today).id).toBe('neu');
        expect(getCurrentLease({ leases: [] }, today)).toBeNull();
        expect(getCurrentLease({}, today)).toBeNull();
        expect(getCurrentLease(null, today)).toBeNull();
    });

    it('getUnitCurrentRent: laufender Vertrag, Leerstand = 0', () => {
        expect(getUnitCurrentRent({ leases: [lease({ cold_rent: '700.50' })] }, today)).toBe(700.5);
        expect(getUnitCurrentRent({ leases: [lease({ end_date: '2024-05-31' })] }, today)).toBe(0);
        expect(getUnitCurrentRent({}, today)).toBe(0);
        expect(getUnitCurrentRent(null, today)).toBe(0);
    });

    it('getUnitCurrentRent: Ferienwohnung → hinterlegte IST-Miete, sonst Zielmiete', () => {
        expect(getUnitCurrentRent({ is_vacation_rental: true, cold_rent_ist: '850.50', target_rent: 900 }, today)).toBe(850.5);
        expect(getUnitCurrentRent({ is_vacation_rental: true, cold_rent_ist: null, target_rent: 900 }, today)).toBe(900);
        expect(getUnitCurrentRent({ is_vacation_rental: true }, today)).toBe(0);
    });
});

/* ─── Grunderwerbsteuer ─── */

describe('TRANSFER_TAX_RATES – Grunderwerbsteuersätze je Bundesland', () => {
    // Landessätze nach Wissensstand Mitte 2026 (letzte bekannte Änderung: Bremen 5,5 % ab 01.07.2025).
    // Spätere Änderungen sind ohne Netzabfrage nicht geprüft.
    const GELTEND = {
        'Baden-Württemberg': 5.0,
        'Bayern': 3.5,
        'Berlin': 6.0,
        'Brandenburg': 6.5,
        'Bremen': 5.5,
        'Hamburg': 5.5,
        'Hessen': 6.0,
        'Mecklenburg-Vorpommern': 6.0,
        'Niedersachsen': 5.0,
        'Nordrhein-Westfalen': 6.5,
        'Rheinland-Pfalz': 5.0,
        'Saarland': 6.5,
        'Sachsen': 5.5,
        'Sachsen-Anhalt': 5.0,
        'Schleswig-Holstein': 6.5,
        'Thüringen': 5.0,
    };

    it('enthält alle 16 Bundesländer genau einmal', () => {
        const names = TRANSFER_TAX_RATES.map(s => s.name);
        expect(names).toHaveLength(16);
        expect(new Set(names)).toEqual(new Set(Object.keys(GELTEND)));
    });

    it.each(Object.entries(GELTEND))('%s: %s %%', (land, satz) => {
        expect(TRANSFER_TAX_RATES.find(s => s.name === land)?.tax).toBe(satz);
    });

    it('alle Sätze liegen im gesetzlich vorkommenden Bereich 3,5 %–6,5 % und sind Zahlen', () => {
        for (const s of TRANSFER_TAX_RATES) {
            expect(typeof s.tax).toBe('number');
            expect(s.tax).toBeGreaterThanOrEqual(3.5);
            expect(s.tax).toBeLessThanOrEqual(6.5);
        }
    });

    it('Kaufpreis 300.000 €: NRW 6,5 % = 19.500 €, Bayern 3,5 % = 10.500 €', () => {
        const grest = (land, kaufpreis) => round2(kaufpreis * TRANSFER_TAX_RATES.find(s => s.name === land).tax / 100);
        expect(grest('Nordrhein-Westfalen', 300000)).toBe(19500);
        expect(grest('Bayern', 300000)).toBe(10500);
        expect(grest('Bremen', 250000)).toBe(13750); // 5,5 % seit 01.07.2025
    });

    it('Stand-Datum ist angegeben', () => {
        expect(typeof TRANSFER_TAX_RATES_AS_OF).toBe('string');
        expect(TRANSFER_TAX_RATES_AS_OF.length).toBeGreaterThan(0);
    });
});
