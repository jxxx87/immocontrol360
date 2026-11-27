// Unit-Tests der Mietkonto-/Rückstandslogik (Finance.jsx + Dashboard.jsx).
// Erwartungswerte von Hand nachgerechnet; Rechenweg jeweils als Kommentar.
// Datumswerte werden lokal erzeugt (new Date(y, m, d)), wie in der App (toLocalDateStr).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: fromMock } }));

import {
    RENT_TOLERANCE,
    BESTAND_THRESHOLD_MONTHS,
    num,
    round2,
    toLocalDateStr,
    toMonthStr,
    parseDateOnly,
    addMonths,
    monthDiff,
    monthsBetween,
    leaseMonthlyRent,
    leaseActiveRatio,
    dueDateForMonth,
    ledgerKey,
    buildRentIndex,
    paidForMonth,
    expectedRentForMonth,
    leaseBookingStartMonth,
    computeArrears,
    summarizeHidden,
    filterExpensesByPortfolio,
    isMissingRelationError,
    fetchAllRows,
    loadMahnverfahren
} from './rentArrears';

// --- Hilfen -------------------------------------------------------------------

// Mietvertrag mit 1.000 € Gesamtmiete (800 kalt + 150 NK + 50 HK), Zahltag 3.
const makeLease = (over = {}) => ({
    id: 'A',
    start_date: '2024-03-01',
    end_date: null,
    cold_rent: 800,
    service_charge: 150,
    heating_cost: 50,
    other_costs: 0,
    payment_due_day: 3,
    ...over
});
const pay = (lease_id, period_month, amount) => ({ lease_id, period_month, amount });
const ledger = (lease_id, period_month, over = {}) => ({ id: `${lease_id}_${period_month}`, lease_id, period_month, ...over });

const TODAY = new Date(2024, 5, 10); // 10.06.2024 (lokal)

// Minimaler, verkettbarer Supabase-Query-Builder: zeichnet Aufrufe auf, liefert resolve(calls)
const queryBuilder = (resolve) => {
    const calls = [];
    const q = {
        calls,
        then(onFulfilled, onRejected) {
            return Promise.resolve().then(() => resolve(calls)).then(onFulfilled, onRejected);
        }
    };
    ['select', 'not', 'order', 'eq', 'in', 'update', 'insert', 'delete'].forEach(name => {
        q[name] = (...args) => { calls.push([name, ...args]); return q; };
    });
    q.range = (...args) => { calls.push(['range', ...args]); return Promise.resolve(resolve(calls)); };
    return q;
};

beforeEach(() => {
    fromMock.mockReset();
});

// --- Konstanten ---------------------------------------------------------------

describe('Konstanten', () => {
    it('Toleranz 1 € entspricht der Statusschwelle im Mietkonto (paid >= expected - 1)', () => {
        expect(RENT_TOLERANCE).toBe(1);
    });
    it('Bestandsmietvertrag ab mehr als 3 Monaten zwischen Mietbeginn und Erfassung', () => {
        expect(BESTAND_THRESHOLD_MONTHS).toBe(3);
    });
});

// --- Zahlen / Rundung -----------------------------------------------------------

describe('num', () => {
    it('wandelt Zahlen und numerische Strings, alles andere wird 0', () => {
        expect(num(12.5)).toBe(12.5);
        expect(num('650.40')).toBe(650.4);
        expect(num(-3)).toBe(-3);
        expect(num(null)).toBe(0);
        expect(num(undefined)).toBe(0);
        expect(num('')).toBe(0);
        expect(num('abc')).toBe(0);
        expect(num(NaN)).toBe(0);
        expect(num(Infinity)).toBe(0);
    });
});

describe('round2 (kaufmännisch auf Cent)', () => {
    it('rundet ab einem halben Cent auf', () => {
        expect(round2(2.344)).toBe(2.34);
        expect(round2(2.345)).toBe(2.35);
        expect(round2(1.005)).toBe(1.01); // klassischer Binärfehler 1.005 -> 1.00499999...
    });

    it('rundet halbe Cent auch bei Binär-Rauschen korrekt (frühere EPSILON-Variante lieferte 1 Cent zu wenig)', () => {
        expect(round2(8.575)).toBe(8.58); // 8.575 * 100 = 857.4999999999999
        expect(round2(10.075)).toBe(10.08);
        expect(round2(4.015)).toBe(4.02);
        expect(round2(500.01 * 0.5)).toBe(250.01); // = 250.00499999999997, mathematisch 250,005
        expect(round2(123456.785)).toBe(123456.79);
    });

    it('rundet negative Beträge symmetrisch (vom Nullpunkt weg) und liefert nie -0', () => {
        expect(round2(-1.005)).toBe(-1.01);
        expect(round2(-12.345)).toBe(-12.35);
        expect(round2(-0.004)).toBe(0);
    });

    it('beseitigt Gleitkomma-Summenfehler und behandelt ungültige Werte als 0', () => {
        expect(round2(0.1 + 0.2)).toBe(0.3);
        expect(round2('99.999')).toBe(100);
        expect(round2(null)).toBe(0);
        expect(round2('abc')).toBe(0);
        expect(round2(0)).toBe(0);
    });
});

// --- Datum ----------------------------------------------------------------------

describe('Datumshilfen', () => {
    it('toLocalDateStr / toMonthStr nutzen das lokale Datum (nicht UTC)', () => {
        expect(toLocalDateStr(new Date(2024, 0, 5, 23, 59))).toBe('2024-01-05');
        expect(toLocalDateStr(new Date(2024, 0, 1, 0, 30))).toBe('2024-01-01');
        expect(toMonthStr(new Date(2024, 11, 31, 23, 0))).toBe('2024-12');
    });

    it('parseDateOnly liest YYYY-MM-DD als lokales Datum 00:00, auch mit Zeitanteil', () => {
        const d = parseDateOnly('2024-02-29');
        expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2024, 1, 29, 0]);
        // Zeitanteil wird abgeschnitten, keine Zeitzonenverschiebung auf den Folgetag
        expect(toLocalDateStr(parseDateOnly('2024-03-05T23:59:00Z'))).toBe('2024-03-05');
        expect(toLocalDateStr(parseDateOnly(new Date(2024, 2, 5, 17, 45)))).toBe('2024-03-05');
        expect(parseDateOnly(new Date(2024, 2, 5, 17, 45)).getHours()).toBe(0);
    });

    it('parseDateOnly liefert null bei leeren oder ungültigen Werten (kein stilles Überlaufen)', () => {
        expect(parseDateOnly(null)).toBeNull();
        expect(parseDateOnly('')).toBeNull();
        expect(parseDateOnly('05.03.2024')).toBeNull();
        expect(parseDateOnly(new Date('ungültig'))).toBeNull();
        expect(parseDateOnly('2023-02-29')).toBeNull(); // kein Schaltjahr – früher 01.03.2023
        expect(parseDateOnly('2024-04-31')).toBeNull();
        expect(parseDateOnly('2024-13-01')).toBeNull();
        expect(parseDateOnly('2000-02-29')).not.toBeNull(); // 2000 ist Schaltjahr (durch 400 teilbar)
    });

    it('addMonths rechnet über Jahresgrenzen', () => {
        expect(addMonths('2024-01', 1)).toBe('2024-02');
        expect(addMonths('2024-12', 1)).toBe('2025-01');
        expect(addMonths('2024-01', -1)).toBe('2023-12');
        expect(addMonths('2024-01', 0)).toBe('2024-01');
        expect(addMonths('2024-01', 25)).toBe('2026-02'); // 2 Jahre + 1 Monat
    });

    it('monthDiff zählt Kalendermonate (vorzeichenbehaftet)', () => {
        expect(monthDiff('2023-11', '2024-02')).toBe(3); // Nov->Dez->Jan->Feb
        expect(monthDiff('2024-02', '2023-11')).toBe(-3);
        expect(monthDiff('2024-05', '2024-05')).toBe(0);
    });

    it('monthsBetween liefert alle Monate inklusive Anfangs- und Endmonat', () => {
        expect(monthsBetween('2024-11-15', '2025-02-01')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
        expect(monthsBetween('2024-03-31', '2024-03-31')).toEqual(['2024-03']);
        expect(monthsBetween('2024-04-01', '2024-03-31')).toEqual([]); // Start nach Ende
        expect(monthsBetween(null, '2024-03-31')).toEqual([]);
    });

    it('monthsBetween ist auf 100 Jahre (1200 Monate) begrenzt', () => {
        const months = monthsBetween('1900-01-01', '2100-12-31'); // 201 Jahre = 2412 Monate
        expect(months).toHaveLength(1200);
        expect(months[1199]).toBe('1999-12');
    });
});

// --- Vertrag: Miete, Laufzeitanteil, Fälligkeit -----------------------------------

describe('leaseMonthlyRent', () => {
    it('summiert Kaltmiete, NK-, Heizkosten- und sonstige Vorauszahlung', () => {
        // 650,50 + 150 + 80 + 0 = 880,50
        expect(leaseMonthlyRent({ cold_rent: '650.50', service_charge: 150, heating_cost: 80, other_costs: null })).toBe(880.5);
        expect(leaseMonthlyRent(null)).toBe(0);
        expect(leaseMonthlyRent({})).toBe(0);
    });
});

describe('leaseActiveRatio (taggenauer Anteil)', () => {
    it('voller Monat = 1', () => {
        expect(leaseActiveRatio({ start_date: '2023-01-01' }, '2024-02')).toBe(1);
        // Ende am Monatsletzten zählt den ganzen Monat
        expect(leaseActiveRatio({ start_date: '2024-01-01', end_date: '2024-04-30' }, '2024-04')).toBe(1);
    });

    it('Einzug am 15. im Februar: Schaltjahr 15/29, sonst 14/28', () => {
        // 2024: Tage 15..29 = 15 von 29
        expect(leaseActiveRatio({ start_date: '2024-02-15' }, '2024-02')).toBeCloseTo(15 / 29, 12);
        // 2023: Tage 15..28 = 14 von 28 = 0,5
        expect(leaseActiveRatio({ start_date: '2023-02-15' }, '2023-02')).toBe(0.5);
    });

    it('Auszug im Monat und Ein-/Auszug im selben Monat', () => {
        // 01.–10.04. = 10 von 30 Tagen
        expect(leaseActiveRatio({ start_date: '2024-01-01', end_date: '2024-04-10' }, '2024-04')).toBeCloseTo(1 / 3, 12);
        // 10.–20.03. = 11 von 31 Tagen
        expect(leaseActiveRatio({ start_date: '2024-03-10', end_date: '2024-03-20' }, '2024-03')).toBeCloseTo(11 / 31, 12);
        // Einzug am 31.01. = 1 Tag
        expect(leaseActiveRatio({ start_date: '2024-01-31' }, '2024-01')).toBeCloseTo(1 / 31, 12);
    });

    it('außerhalb der Laufzeit, ohne Mietbeginn oder mit Ende vor Beginn = 0', () => {
        expect(leaseActiveRatio({ start_date: '2024-03-01' }, '2024-02')).toBe(0);
        expect(leaseActiveRatio({ start_date: '2024-01-01', end_date: '2024-04-10' }, '2024-05')).toBe(0);
        expect(leaseActiveRatio({ start_date: null }, '2024-05')).toBe(0);
        expect(leaseActiveRatio(null, '2024-05')).toBe(0);
        expect(leaseActiveRatio({ start_date: '2024-03-20', end_date: '2024-03-10' }, '2024-03')).toBe(0);
    });
});

describe('dueDateForMonth', () => {
    it('Standard ist der 3. des Monats (Kalendertag)', () => {
        expect(dueDateForMonth({}, '2024-05')).toBe('2024-05-03');
        expect(dueDateForMonth({ payment_due_day: null }, '2024-05')).toBe('2024-05-03');
        expect(dueDateForMonth({ payment_due_day: '' }, '2024-05')).toBe('2024-05-03');
        expect(dueDateForMonth(null, '2024-05')).toBe('2024-05-03');
    });

    it('nutzt den vereinbarten Zahltag, auch als String', () => {
        expect(dueDateForMonth({ payment_due_day: 15 }, '2024-05')).toBe('2024-05-15');
        expect(dueDateForMonth({ payment_due_day: '5' }, '2024-05')).toBe('2024-05-05');
    });

    it('begrenzt den Zahltag auf das Monatsende (Schaltjahr beachtet)', () => {
        expect(dueDateForMonth({ payment_due_day: 31 }, '2024-02')).toBe('2024-02-29');
        expect(dueDateForMonth({ payment_due_day: 31 }, '2023-02')).toBe('2023-02-28');
        expect(dueDateForMonth({ payment_due_day: 31 }, '2024-04')).toBe('2024-04-30');
        expect(dueDateForMonth({ payment_due_day: 31 }, '2024-12')).toBe('2024-12-31');
    });
});

// --- Mietkonto-Index -----------------------------------------------------------

describe('buildRentIndex / paidForMonth', () => {
    it('ordnet Zahlungen je Vertrag und Leistungsmonat zu und summiert centgenau', () => {
        const index = buildRentIndex({
            payments: [
                pay('A', '2024-03-01', 500),
                pay('A', '2024-03-15', '300.10'), // Monat aus period_month, Tag egal
                pay('A', '2024-03-01', -50), // Rückbuchung
                pay('A', '2024-04-01', 0.1),
                pay('A', '2024-04-01', 0.2),
                pay('B', '2024-03-01', 999),
                pay('A', null, 1000), // ohne Leistungsmonat: keine Zuordnung
                { period_month: '2024-03-01', amount: 77 }, // ohne Vertrag
                null
            ]
        });
        // März: 500 + 300,10 - 50 = 750,10
        expect(index.paidByKey.get('A_2024-03')).toBe(750.1);
        // April: 0,1 + 0,2 = 0,30 (ohne Gleitkomma-Rest)
        expect(index.paidByKey.get('A_2024-04')).toBe(0.3);
        expect(index.paidByKey.get('B_2024-03')).toBe(999);
        expect(index.paidByKey.size).toBe(3);
        expect(index.ledgerByKey.size).toBe(0);
    });

    it('indiziert Mietkonto-Zeilen nach Vertrag + Monat und überspringt unvollständige Zeilen', () => {
        const row = ledger('A', '2024-03-01', { expected_rent: 1000, paid_amount: 400 });
        const index = buildRentIndex({ ledgerRows: [row, { lease_id: 'A' }, { period_month: '2024-03-01' }, null] });
        expect(index.ledgerByKey.get(ledgerKey('A', '2024-03'))).toBe(row);
        expect(index.ledgerByKey.size).toBe(1);
    });

    it('gezahlter Betrag = Maximum aus Mietkonto und geladenen Zahlungen', () => {
        const index = buildRentIndex({
            ledgerRows: [
                ledger('A', '2024-03-01', { paid_amount: 800 }), // Dashboard: nicht alle Zahlungen geladen
                ledger('A', '2024-04-01', { paid_amount: '300' })
            ],
            payments: [pay('A', '2024-03-01', 500), pay('A', '2024-04-01', 750.1), pay('A', '2024-05-01', 200)]
        });
        expect(paidForMonth(index, 'A', '2024-03')).toBe(800); // max(800, 500)
        expect(paidForMonth(index, 'A', '2024-04')).toBe(750.1); // max(300, 750,10)
        expect(paidForMonth(index, 'A', '2024-05')).toBe(200); // keine Ledger-Zeile
        expect(paidForMonth(index, 'A', '2024-06')).toBe(0);
        expect(paidForMonth(undefined, 'A', '2024-06')).toBe(0);
        expect(buildRentIndex()).toEqual({ ledgerByKey: new Map(), paidByKey: new Map() });
    });
});

// --- Soll je Monat -----------------------------------------------------------------

describe('expectedRentForMonth', () => {
    it('ohne Mietkonto-Zeile: Vertragsmiete, im Einzugsmonat tagesanteilig', () => {
        expect(expectedRentForMonth(makeLease(), '2024-04', undefined)).toBe(1000);
        // 1.000 € × 15/29 (Einzug 15.02.2024, Schaltjahr) = 517,2413… -> 517,24
        expect(expectedRentForMonth(makeLease({ start_date: '2024-02-15' }), '2024-02', null)).toBe(517.24);
        // Auszug 10.04.: 1.000 € × 10/30 = 333,33
        expect(expectedRentForMonth(makeLease({ end_date: '2024-04-10' }), '2024-04', null)).toBe(333.33);
    });

    it('Mietkonto-Zeile (Miete aus der im Monat gültigen Mietperiode) hat Vorrang vor der aktuellen Vertragsmiete', () => {
        // Vertrag führt heute 1.000 € (nach Erhöhung), im März galt laut Mietkonto noch 900 €
        expect(expectedRentForMonth(makeLease(), '2024-03', ledger('A', '2024-03-01', { expected_rent: 900 }))).toBe(900);
        // mietfreier Monat im Mietkonto
        expect(expectedRentForMonth(makeLease(), '2024-03', ledger('A', '2024-03-01', { expected_rent: 0 }))).toBe(0);
    });

    it('angebrochener Monat: volle Monatsmiete aus dem Mietkonto wird tagesanteilig gekürzt', () => {
        // Einzug 15.02.2023: Anteil 14/28 = 0,5; Mietkonto führt die alte Staffelmiete 800 € -> 400 €
        const lease = makeLease({ start_date: '2023-02-15' });
        expect(expectedRentForMonth(lease, '2023-02', ledger('A', '2023-02-01', { expected_rent: 800 }))).toBe(400);
        // Mietkonto mit voller Vertragsmiete 1.000 € -> 500 €
        expect(expectedRentForMonth(lease, '2023-02', ledger('A', '2023-02-01', { expected_rent: 1000 }))).toBe(500);
    });

    it('angebrochener Monat: bereits tagesanteilige Mietkonto-Zeile wird nicht doppelt gekürzt', () => {
        // 1.000 × 15/29 = 517,2413…; Zeile enthält 517,24 (Abweichung 0,0014 < 0,02) -> unverändert
        const lease = makeLease({ start_date: '2024-02-15' });
        expect(expectedRentForMonth(lease, '2024-02', ledger('A', '2024-02-01', { expected_rent: 517.24 }))).toBe(517.24);
    });

    it('rundet den Tagesanteil kaufmännisch auf Cent', () => {
        // 500,01 € × 14/28 = 250,005 -> 250,01 (Float: 250,00499999999997)
        const lease = makeLease({ start_date: '2023-02-15', cold_rent: 400.01, service_charge: 100, heating_cost: 0 });
        expect(expectedRentForMonth(lease, '2023-02', null)).toBe(250.01);
    });

    it('außerhalb der Vertragslaufzeit 0 – auch wenn noch eine Mietkonto-Zeile existiert', () => {
        const lease = makeLease({ end_date: '2024-04-10' });
        expect(expectedRentForMonth(lease, '2024-05', ledger('A', '2024-05-01', { expected_rent: 1000 }))).toBe(0);
        expect(expectedRentForMonth(lease, '2024-02', null)).toBe(0);
    });
});

// --- Buchungsbeginn ------------------------------------------------------------------

describe('leaseBookingStartMonth', () => {
    it('ohne Mietbeginn null, ohne/ungültiges Erfassungsdatum der Mietbeginn', () => {
        expect(leaseBookingStartMonth({ start_date: null })).toBeNull();
        expect(leaseBookingStartMonth({ start_date: '2023-01-01' })).toBe('2023-01');
        expect(leaseBookingStartMonth({ start_date: '2023-01-01', created_at: 'xyz' })).toBe('2023-01');
    });

    it('Erfassung bis 3 Monate nach Mietbeginn: Buchung ab Mietbeginn', () => {
        // Jan -> Apr = 3 Monate (Grenze inklusive)
        expect(leaseBookingStartMonth({ start_date: '2024-01-15', created_at: '2024-04-15T10:00:00Z' })).toBe('2024-01');
    });

    it('Bestandsmietvertrag (Erfassung > 3 Monate nach Mietbeginn): Buchung ab Erfassungsmonat', () => {
        // Jan -> Mai = 4 Monate
        expect(leaseBookingStartMonth({ start_date: '2024-01-15', created_at: '2024-05-15T10:00:00Z' })).toBe('2024-05');
        expect(leaseBookingStartMonth({ start_date: '2019-07-01', created_at: '2024-11-20T09:00:00Z' })).toBe('2024-11');
    });

    it('Vertrag vor Mietbeginn erfasst: Buchung ab Mietbeginn', () => {
        expect(leaseBookingStartMonth({ start_date: '2024-09-01', created_at: '2024-06-15T10:00:00Z' })).toBe('2024-09');
    });

    it('ausdrücklicher Buchungsbeginn hat Vorrang, aber nie vor dem Mietbeginn', () => {
        const base = { start_date: '2023-01-01', created_at: '2024-04-15T10:00:00Z' };
        expect(leaseBookingStartMonth({ ...base, booking_start_date: '2023-07-01' })).toBe('2023-07');
        expect(leaseBookingStartMonth({ ...base, booking_start_date: '2022-05-01' })).toBe('2023-01');
    });
});

// --- Rückstände ------------------------------------------------------------------------

describe('computeArrears – Rückstand je Monat', () => {
    it('Soll minus Zahlung je fälligem Monat; Summe ohne Toleranzfälle', () => {
        const lease = makeLease(); // ab 01.03.2024, 1.000 €/Monat, Zahltag 3.
        const index = buildRentIndex({
            payments: [pay('A', '2024-03-01', 1000), pay('A', '2024-04-01', 600), pay('A', '2024-05-01', 999.5)]
        });
        const res = computeArrears({ leases: [lease], index, today: TODAY });
        // März bezahlt, April 400 offen, Mai 0,50 offen (<= 1 € Toleranz), Juni (fällig 03.06.) 1.000 offen
        expect(res.entries.map(e => [e.monthStr, e.open])).toEqual([['2024-04', 400], ['2024-06', 1000]]);
        expect(res.totalOverdue).toBe(1400);
        expect(res.entries[0]).toEqual({
            id: 'A_2024-04-01',
            key: 'A_2024-04',
            leaseId: 'A',
            lease,
            monthStr: '2024-04',
            periodMonth: '2024-04-01',
            dueDate: '2024-04-03',
            expected: 1000,
            paid: 600,
            open: 400,
            isMahn: false,
            beforeBookingStart: false,
            bookingStartMonth: '2024-03'
        });
        expect(res.hidden).toEqual({ count: 0, amount: 0, leases: 0 });
    });

    it('Toleranz: genau 1,00 € offen zählt nicht, 1,01 € zählt', () => {
        const lease = makeLease({ start_date: '2024-05-01' });
        const index = buildRentIndex({ payments: [pay('A', '2024-05-01', 999), pay('A', '2024-06-01', 998.99)] });
        const res = computeArrears({ leases: [lease], index, today: TODAY });
        expect(res.entries.map(e => [e.monthStr, e.open])).toEqual([['2024-06', 1.01]]);
        expect(res.totalOverdue).toBe(1.01);
    });

    it('Überzahlung erzeugt keinen negativen Rückstand', () => {
        const lease = makeLease({ start_date: '2024-05-01' });
        const index = buildRentIndex({ payments: [pay('A', '2024-05-01', 1200), pay('A', '2024-06-01', 1000)] });
        const res = computeArrears({ leases: [lease], index, today: TODAY });
        expect(res.entries).toEqual([]);
        expect(res.totalOverdue).toBe(0);
    });

    it('Fälligkeitstag selbst ist noch fristgerecht, ab dem Folgetag überfällig', () => {
        const lease = makeLease({ start_date: '2024-06-01' });
        const index = buildRentIndex({});
        expect(computeArrears({ leases: [lease], index, today: new Date(2024, 5, 3) }).entries).toEqual([]);
        const res = computeArrears({ leases: [lease], index, today: new Date(2024, 5, 4) });
        expect(res.entries.map(e => [e.monthStr, e.dueDate, e.open])).toEqual([['2024-06', '2024-06-03', 1000]]);
    });

    it('späterer Zahltag (15.) und Fälligkeit aus dem Mietkonto werden beachtet', () => {
        const index = buildRentIndex({ ledgerRows: [ledger('A', '2024-05-01', { expected_rent: 1000, paid_amount: 0, due_date: '2024-06-12' })] });
        // Zahltag 15.: Juni am 10.06. noch nicht fällig; Mai laut Mietkonto erst am 12.06. fällig
        const res = computeArrears({ leases: [makeLease({ start_date: '2024-05-01', payment_due_day: 15 })], index, today: TODAY });
        expect(res.entries).toEqual([]);
        // am 13.06.: Mai (fällig 12.06.) überfällig, Juni (15.06.) noch nicht
        const later = computeArrears({ leases: [makeLease({ start_date: '2024-05-01', payment_due_day: 15 })], index, today: new Date(2024, 5, 13) });
        expect(later.entries.map(e => [e.monthStr, e.dueDate])).toEqual([['2024-05', '2024-06-12']]);
    });

    it('Einzug nach dem Zahltag: keine Fälligkeit vor Mietbeginn (Teilmonat fällig ab Einzug)', () => {
        // Einzug 20.06.2024, Zahltag 3.: anteilige Junimiete 900 € × 11/30 = 330 €
        const lease = makeLease({ start_date: '2024-06-20', cold_rent: 700, service_charge: 150, heating_cost: 50 });
        const index = buildRentIndex({});
        // 10.06.: Mietverhältnis hat noch nicht begonnen -> kein Rückstand
        expect(computeArrears({ leases: [lease], index, today: TODAY }).entries).toEqual([]);
        // 20.06. (Einzugstag = Fälligkeit) -> noch fristgerecht
        expect(computeArrears({ leases: [lease], index, today: new Date(2024, 5, 20) }).entries).toEqual([]);
        // 25.06.: 330 € überfällig, fällig seit Mietbeginn
        const res = computeArrears({ leases: [lease], index, today: new Date(2024, 5, 25) });
        expect(res.entries.map(e => [e.monthStr, e.dueDate, e.expected, e.open])).toEqual([['2024-06', '2024-06-20', 330, 330]]);
    });

    it('Einzug nach dem Zahltag: auch die vom Mietkonto (DB) gesetzte Fälligkeit 03.06. gilt erst ab Mietbeginn; Folgemonat normal', () => {
        // DB-Trigger setzt due_date = Monatserster + Zahltag - 1 = 03.06., ohne Rücksicht auf den Einzug am 20.06.
        // Mietkonto führt die volle Miete 900 €; Anteil 11/30 -> |900 - 330| >= 0,02 -> 900 × 11/30 = 330 €
        const lease = makeLease({ start_date: '2024-06-20', cold_rent: 700, service_charge: 150, heating_cost: 50 });
        const index = buildRentIndex({ ledgerRows: [ledger('A', '2024-06-01', { expected_rent: 900, paid_amount: 0, due_date: '2024-06-03' })] });
        // 10.06.: vor Mietbeginn kein Rückstand, obwohl das Mietkonto 03.06. nennt
        expect(computeArrears({ leases: [lease], index, today: TODAY }).entries).toEqual([]);
        // 10.07.: Juni 330 € (fällig 20.06.) + Juli 900 € (fällig 03.07., unverändert) = 1.230 €
        const res = computeArrears({ leases: [lease], index, today: new Date(2024, 6, 10) });
        expect(res.entries.map(e => [e.monthStr, e.dueDate, e.open])).toEqual([['2024-06', '2024-06-20', 330], ['2024-07', '2024-07-03', 900]]);
        expect(res.totalOverdue).toBe(1230);
    });

    it('Soll aus dem Mietkonto (Staffel-/Indexmiete je Monat) statt aktueller Vertragsmiete', () => {
        // Vertrag heute 1.000 €; März/April galt laut Mietkonto 900 € (vollständig bezahlt)
        const index = buildRentIndex({
            ledgerRows: [
                ledger('A', '2024-03-01', { expected_rent: 900, paid_amount: 900 }),
                ledger('A', '2024-04-01', { expected_rent: 900, paid_amount: 900 }),
                ledger('A', '2024-05-01', { expected_rent: 1000, paid_amount: 0 }),
                ledger('A', '2024-06-01', { expected_rent: 1000, paid_amount: 1000 })
            ]
        });
        const res = computeArrears({ leases: [makeLease()], index, today: TODAY });
        expect(res.entries.map(e => [e.monthStr, e.expected, e.open])).toEqual([['2024-05', 1000, 1000]]);
        expect(res.totalOverdue).toBe(1000);
    });

    it('ausgebuchte Monate (loss) und mietfreie Monate (Soll 0) zählen nicht', () => {
        const index = buildRentIndex({
            ledgerRows: [
                ledger('A', '2024-03-01', { expected_rent: 0, paid_amount: 0 }),
                ledger('A', '2024-04-01', { expected_rent: 1000, paid_amount: 0, status: 'loss' })
            ],
            payments: [pay('A', '2024-05-01', 1000), pay('A', '2024-06-01', 1000)]
        });
        expect(computeArrears({ leases: [makeLease()], index, today: TODAY }).entries).toEqual([]);
    });

    it('beendeter Vertrag: nur Monate bis zum Auszug, Auszugsmonat tagesanteilig', () => {
        // 01.03.–10.04.2024: März 1.000 + April 1.000 × 10/30 = 333,33; Summe 1.333,33
        const lease = makeLease({ end_date: '2024-04-10' });
        const index = buildRentIndex({ ledgerRows: [ledger('A', '2024-05-01', { expected_rent: 1000, paid_amount: 0 })] });
        const res = computeArrears({ leases: [lease], index, today: TODAY });
        expect(res.entries.map(e => [e.monthStr, e.open])).toEqual([['2024-03', 1000], ['2024-04', 333.33]]);
        expect(res.totalOverdue).toBe(1333.33);
    });

    it('künftige Verträge, Verträge ohne ID/Mietbeginn und leere Eingaben liefern nichts', () => {
        const res = computeArrears({
            leases: [makeLease({ start_date: '2024-07-01' }), makeLease({ id: null }), makeLease({ id: 'X', start_date: null }), null],
            index: buildRentIndex({}),
            today: TODAY
        });
        expect(res.entries).toEqual([]);
        expect(computeArrears({ leases: null, today: TODAY })).toEqual({
            entries: [], totalOverdue: 0, hiddenEntries: [], hidden: { count: 0, amount: 0, leases: 0 }
        });
    });

    it('Monate im Mahnverfahren werden geliefert, aber nicht in totalOverdue summiert', () => {
        const index = buildRentIndex({ payments: [pay('A', '2024-03-01', 1000), pay('A', '2024-05-01', 1000)] });
        const res = computeArrears({ leases: [makeLease()], index, mahnKeys: new Set(['A_2024-04']), today: TODAY });
        expect(res.entries.map(e => [e.monthStr, e.isMahn])).toEqual([['2024-04', true], ['2024-06', false]]);
        expect(res.totalOverdue).toBe(1000); // nur Juni
    });

    it('summiert mehrere Verträge', () => {
        const a = makeLease({ start_date: '2024-06-01' }); // Juni 1.000 offen
        const b = makeLease({ id: 'B', start_date: '2024-05-01', cold_rent: 500, service_charge: 0, heating_cost: 0 }); // Mai+Juni 500
        const res = computeArrears({ leases: [a, b], index: buildRentIndex({ payments: [pay('B', '2024-05-01', 250)] }), today: TODAY });
        // A: 1.000; B: Mai 250 + Juni 500 -> 1.750
        expect(res.totalOverdue).toBe(1750);
        expect(res.entries).toHaveLength(3);
    });
});

describe('computeArrears – Buchungsbeginn bei Bestandsmietverträgen', () => {
    // Mietbeginn 01.01.2023, in der App erfasst im April 2024 (15 Monate später), 500 €/Monat
    const bestand = (over = {}) => makeLease({
        id: 'B', start_date: '2023-01-01', created_at: '2024-04-15T10:00:00Z',
        cold_rent: 500, service_charge: 0, heating_cost: 0, ...over
    });

    it('Monate vor dem Buchungsbeginn werden ausgeblendet und nur gezählt', () => {
        const res = computeArrears({ leases: [bestand()], index: buildRentIndex({}), today: TODAY });
        // sichtbar: Apr–Jun 2024 = 3 × 500; ausgeblendet: Jan 2023–Mär 2024 = 15 × 500 = 7.500
        expect(res.entries.map(e => e.monthStr)).toEqual(['2024-04', '2024-05', '2024-06']);
        expect(res.totalOverdue).toBe(1500);
        expect(res.hidden).toEqual({ count: 15, amount: 7500, leases: 1 });
        expect(res.hiddenEntries[0]).toMatchObject({ leaseId: 'B', monthStr: '2023-01', open: 500, isMahn: false });
        expect(res.entries.every(e => e.bookingStartMonth === '2024-04' && !e.beforeBookingStart)).toBe(true);
    });

    it('per Schalter werden auch ältere Monate geliefert und summiert', () => {
        const res = computeArrears({ leases: [bestand()], index: buildRentIndex({}), today: TODAY, includeBeforeBookingStart: true });
        // 18 Monate × 500 = 9.000
        expect(res.entries).toHaveLength(18);
        expect(res.totalOverdue).toBe(9000);
        expect(res.hidden.count).toBe(0);
        expect(res.entries.filter(e => e.beforeBookingStart)).toHaveLength(15);
    });

    it('Buchungsbeginn = min(Heuristik, erster Monat mit Zahlung)', () => {
        // Teilzahlung 200 € für Oktober 2023 -> Mietkonto nachweislich ab 10/2023 geführt
        const index = buildRentIndex({ payments: [pay('B', '2023-10-01', 200)] });
        const res = computeArrears({ leases: [bestand()], index, today: TODAY });
        // sichtbar: Okt 2023 (300 offen) + Nov 2023–Jun 2024 (8 × 500) = 4.300; ausgeblendet: Jan–Sep 2023 = 9 × 500
        expect(res.entries).toHaveLength(9);
        expect(res.entries[0]).toMatchObject({ monthStr: '2023-10', open: 300, bookingStartMonth: '2023-10' });
        expect(res.totalOverdue).toBe(4300);
        expect(res.hidden).toEqual({ count: 9, amount: 4500, leases: 1 });
    });

    it('eine Zahlung nach dem heuristischen Buchungsbeginn verschiebt ihn nicht nach hinten', () => {
        const index = buildRentIndex({ payments: [pay('B', '2024-05-01', 500)] });
        const res = computeArrears({ leases: [bestand()], index, today: TODAY });
        expect(res.entries.map(e => e.monthStr)).toEqual(['2024-04', '2024-06']);
        expect(res.hidden.count).toBe(15);
    });

    it('Mahn-Monate werden nie ausgeblendet, zählen aber weder in totalOverdue noch in hidden.amount', () => {
        const res = computeArrears({ leases: [bestand()], index: buildRentIndex({}), mahnKeys: new Set(['B_2023-02']), today: TODAY });
        expect(res.entries.map(e => [e.monthStr, e.isMahn, e.beforeBookingStart])).toEqual([
            ['2023-02', true, true],
            ['2024-04', false, false],
            ['2024-05', false, false],
            ['2024-06', false, false]
        ]);
        expect(res.totalOverdue).toBe(1500);
        expect(res.hidden).toEqual({ count: 14, amount: 7000, leases: 1 });
    });
});

describe('summarizeHidden', () => {
    it('zählt Monate, Betrag (ohne Mahn-Monate) und betroffene Verträge', () => {
        expect(summarizeHidden()).toEqual({ count: 0, amount: 0, leases: 0 });
        expect(summarizeHidden([
            { leaseId: 'A', open: 100.1 },
            { leaseId: 'A', open: 200.2 },
            { leaseId: 'B', open: 50, isMahn: true },
            { leaseId: 'C', open: 0.1 }
        ])).toEqual({ count: 4, amount: 300.4, leases: 3 }); // 100,1 + 200,2 + 0,1 = 300,40
    });
});

// --- Portfolio-Filter / Fehlercodes ---------------------------------------------------

describe('filterExpensesByPortfolio', () => {
    const propertyPortfolio = new Map([['P1', 'PF1'], ['P2', 'PF2']]);
    const expenses = [
        { id: 1, property_id: 'P1' },
        { id: 2, property_id: 'P2' },
        { id: 3, property_id: null },
        { id: 4 }
    ];

    it('ohne Portfolio-Auswahl: alle Ausgaben', () => {
        expect(filterExpensesByPortfolio(expenses, { selectedPortfolioID: null, propertyPortfolio })).toEqual({ list: expenses, hiddenUnassigned: 0 });
        expect(filterExpensesByPortfolio(null, { selectedPortfolioID: null, propertyPortfolio })).toEqual({ list: [], hiddenUnassigned: 0 });
    });

    it('mit Portfolio: nur dessen Objekte, Ausgaben ohne Objekt ausgeblendet und gezählt', () => {
        const res = filterExpensesByPortfolio(expenses, { selectedPortfolioID: 'PF1', propertyPortfolio, includeUnassigned: false });
        expect(res.list.map(e => e.id)).toEqual([1]);
        expect(res.hiddenUnassigned).toBe(2);
    });

    it('mit Portfolio und includeUnassigned: Ausgaben ohne Objekt zählen mit', () => {
        const res = filterExpensesByPortfolio(expenses, { selectedPortfolioID: 'PF2', propertyPortfolio, includeUnassigned: true });
        expect(res.list.map(e => e.id)).toEqual([2, 3, 4]);
        expect(res.hiddenUnassigned).toBe(0);
    });
});

describe('isMissingRelationError', () => {
    it('erkennt fehlende Tabelle/Beziehung', () => {
        expect(isMissingRelationError({ code: '42P01' })).toBe(true);
        expect(isMissingRelationError({ code: 'PGRST205' })).toBe(true);
        expect(isMissingRelationError({ code: 'PGRST200' })).toBe(true);
        expect(isMissingRelationError({ code: '42501' })).toBe(false);
        expect(isMissingRelationError(null)).toBe(false);
    });
});

// --- Laden (Supabase gemockt) -------------------------------------------------------

describe('fetchAllRows (seitenweises Laden)', () => {
    it('lädt alle Seiten bis zur Gesamtzahl und sortiert stabil nach id', async () => {
        const all = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
        const builders = [];
        fromMock.mockImplementation(() => {
            const q = queryBuilder(calls => {
                const [, from, to] = calls.find(c => c[0] === 'range');
                return { data: all.slice(from, to + 1), error: null, count: 5 };
            });
            builders.push(q);
            return q;
        });
        const res = await fetchAllRows('rent_payments', 'id', q => q.eq('user_id', 'u1'), 2);
        expect(res).toEqual({ data: all, error: null });
        // 5 Zeilen à 2 = 3 Seiten: 0–1, 2–3, 4–5
        expect(builders.map(q => q.calls.find(c => c[0] === 'range').slice(1))).toEqual([[0, 1], [2, 3], [4, 5]]);
        expect(builders[0].calls[0]).toEqual(['select', 'id', { count: 'exact' }]); // Gesamtzahl nur auf Seite 1
        expect(builders[1].calls[0]).toEqual(['select', 'id', undefined]);
        expect(builders[0].calls).toContainEqual(['eq', 'user_id', 'u1']);
        expect(builders[0].calls).toContainEqual(['order', 'id', { ascending: true }]);
    });

    it('gibt bei Fehler die bis dahin geladenen Zeilen und den Fehler zurück', async () => {
        let page = 0;
        fromMock.mockImplementation(() => queryBuilder(() => (page++ === 0
            ? { data: [{ id: 1 }, { id: 2 }], error: null, count: 4 }
            : { data: null, error: { code: '57014' } })));
        const res = await fetchAllRows('t', 'id', undefined, 2);
        expect(res).toEqual({ data: [{ id: 1 }, { id: 2 }], error: { code: '57014' } });
    });
});

describe('loadMahnverfahren', () => {
    it('ermittelt Monate offener Forderungsakten über Mietkonto-IDs (fehlende Zeilen werden nachgeladen)', async () => {
        const claimBuilders = [];
        const ledgerBuilders = [];
        fromMock.mockImplementation((table) => {
            if (table === 'claim_items') {
                const q = queryBuilder(() => ({
                    data: [
                        { id: 'ci1', rent_ledger_ids: ['r1', 'r2'], rent_ledger_id: null, claims: { id: 'c1' } },
                        { id: 'ci2', rent_ledger_ids: null, rent_ledger_id: 'r3', claims: { id: 'c2' } },
                        { id: 'ci3', rent_ledger_ids: ['r1'], claims: { id: 'c3' } } // r1 bereits c1 zugeordnet
                    ],
                    error: null,
                    count: 3
                }));
                claimBuilders.push(q);
                return q;
            }
            const q = queryBuilder(() => ({ data: [{ id: 'r3', lease_id: 'B', period_month: '2023-02-01' }], error: null }));
            ledgerBuilders.push(q);
            return q;
        });

        const res = await loadMahnverfahren([
            { id: 'r1', lease_id: 'A', period_month: '2024-04-01' },
            { id: 'r2', lease_id: 'A', period_month: '2024-05-01' }
        ]);

        expect(res.error).toBeNull();
        expect([...res.keys].sort()).toEqual(['A_2024-04', 'A_2024-05', 'B_2023-02']);
        expect(res.claimByKey.get('A_2024-04')).toBe('c1');
        expect(res.claimByKey.get('B_2023-02')).toBe('c2');
        // abgeschlossene Akten werden in der Abfrage ausgeschlossen
        expect(claimBuilders[0].calls).toContainEqual(['not', 'claims.status', 'in', '("settled","cancelled","archived")']);
        // nur die fehlende Zeile r3 wird nachgeladen
        expect(ledgerBuilders).toHaveLength(1);
        expect(ledgerBuilders[0].calls).toContainEqual(['in', 'id', ['r3']]);
    });

    it('liefert bei Ladefehler leere Schlüssel und den Fehler', async () => {
        fromMock.mockImplementation(() => queryBuilder(() => ({ data: null, error: { code: '42501' }, count: null })));
        const res = await loadMahnverfahren([]);
        expect(res.keys.size).toBe(0);
        expect(res.error).toEqual({ code: '42501' });
    });
});
