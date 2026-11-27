// Unit-Tests für den Rechenkern der Nebenkostenabrechnung (src/lib/utilitySettlement.js).
// Alle Erwartungswerte sind von Hand nachgerechnet; der Rechenweg steht jeweils im Kommentar.
// Beträge im Modul in Cent; Restcents nach dem Größte-Reste-Verfahren (bei Gleichstand
// erhält die zuerst aufgeführte Einheit bzw. der zuerst aufgeführte Abschnitt den Cent).
import { describe, it, expect } from 'vitest';
import {
    isValidISODate, daysInclusive, addDaysISO, addMonthsISO, localISODate, formatDateDE,
    settlementYearLabel, settlementDeadline, validatePeriod, periodsOverlap, monthsInRange,
    parseNumber, toCents, centsToEuro, formatEUR, formatCents, allocateCents,
    resolveDistributionKey, isHeatingCostName, buildUnitOccupancy, computeDistribution,
    buildUnitRows, computeLeasePrepayment, computeMeterConsumption, computeSettlement,
    legacyUnitAmount, convertLegacyUnitCosts, buildTemplateVariables
} from './utilitySettlement';

// ── Testdaten ────────────────────────────────────────────────────────────────
const P_START = '2025-01-01';
const P_END = '2025-12-31'; // 365 Tage (kein Schaltjahr)

const KEYS = [
    { id: 'k-area', name: 'Wohnfläche', calculation_type: 'area' },
    { id: 'k-pers', name: 'Personen', calculation_type: 'persons' },
    { id: 'k-units', name: 'Wohneinheiten', calculation_type: 'units' },
    { id: 'k-equal', name: 'Gleich', calculation_type: 'equal' },
    { id: 'k-mea', name: 'MEA', calculation_type: 'mea' },
    { id: 'k-cons', name: 'Verbrauch', calculation_type: 'custom' },
    { id: 'k-direct', name: 'Direkt', calculation_type: 'direct' },
    { id: 'k-odd', name: 'Pauschale', calculation_type: 'flat_rate' }
];

const unit = (id, sqm, extra = {}) => ({ id, unit_name: id, sqm, property_id: 'P1', ...extra });
const tenant = (id, first, last, occupants) => ({ id, first_name: first, last_name: last, occupants });
const lease = (id, unitId, start, end, t, extra = {}) => ({ id, unit_id: unitId, start_date: start, end_date: end, tenant_id: t?.id ?? null, tenant: t ?? null, ...extra });
const item = (id, amount, key, extra = {}) => ({ id, category_name: id, amount, distribution_key: key, ...extra });

const occFor = (houseUnits, leases, { start = P_START, end = P_END, vacancyPersons = 1 } = {}) =>
    Object.fromEntries(houseUnits.map(u => [u.id, buildUnitOccupancy({ unitId: u.id, leases, tenantsById: {}, periodStart: start, periodEnd: end, vacancyPersons })]));
const sumOf = (obj) => Object.values(obj || {}).reduce((s, x) => s + x, 0);

// Haus A: drei Einheiten, alle das ganze Jahr vermietet (keine Zeitanteile)
//   W1 60 m², MEA 250, 2 Personen | W2 40 m², MEA 250, 1 Person | W3 100 m², MEA 500, 4 Personen
const HOUSE_A = [
    unit('W1', 60, { ownership_share: 250 }),
    unit('W2', 40, { ownership_share: 250 }),
    unit('W3', 100, { ownership_share: 500 })
];
const LEASES_A = [
    lease('L1', 'W1', '2020-01-01', null, tenant('T1', 'Anna', 'Albers', 2)),
    lease('L2', 'W2', '2020-01-01', null, tenant('T2', 'Bernd', 'Berg', 1)),
    lease('L3', 'W3', '2020-01-01', null, tenant('T3', 'Clara', 'Christ', 4))
];
const distA = (items, opts) => computeDistribution({ costItems: items, houseUnits: HOUSE_A, occupancy: occFor(HOUSE_A, LEASES_A, opts), distributionKeys: KEYS });

// Haus B: Mieterwechsel / Leerstand im Abrechnungszeitraum 2025
//   W1 60 m²: Albers (2 P.) ganzjährig                         -> 365 Tage
//   W2 40 m²: Berg (1 P.) bis 30.06.2025 (31+28+31+30+31+30)   -> 181 Tage, danach Leerstand 184 Tage
//   W3 100 m²: Christ (4 P.) ab 01.04.2025 (365 − 90)          -> 275 Tage, davor Leerstand 90 Tage
const HOUSE_B = [unit('W1', 60), unit('W2', 40), unit('W3', 100)];
const LEASES_B = [
    lease('L1', 'W1', '2020-01-01', null, tenant('T1', 'Anna', 'Albers', 2), { service_charge: 40, heating_cost: 0 }),
    lease('L2', 'W2', '2023-01-01', '2025-06-30', tenant('T2', 'Bernd', 'Berg', 1), { service_charge: 30, heating_cost: 0 }),
    lease('L3', 'W3', '2025-04-01', null, tenant('T3', 'Clara', 'Christ', 4), { service_charge: 60, heating_cost: 0 })
];

// ── Datum ────────────────────────────────────────────────────────────────────
describe('Datumsfunktionen', () => {
    it('isValidISODate erkennt echte Kalenderdaten (Schaltjahr, Monatsgrenzen)', () => {
        expect(isValidISODate('2024-02-29')).toBe(true); // 2024 ist Schaltjahr
        expect(isValidISODate('2025-02-29')).toBe(false); // 2025 nicht
        expect(isValidISODate('2025-04-31')).toBe(false); // April hat 30 Tage
        expect(isValidISODate('2025-13-01')).toBe(false);
        expect(isValidISODate('2025-1-1')).toBe(false); // kein ISO-Format
        expect(isValidISODate('2025-06-30T22:00:00Z')).toBe(true); // nur Datumsteil zählt
        expect(isValidISODate(null)).toBe(false);
        expect(isValidISODate('')).toBe(false);
    });

    it('daysInclusive zählt Anfangs- und Endtag mit, auch über Schalttag und Zeitumstellung', () => {
        expect(daysInclusive('2025-01-01', '2025-12-31')).toBe(365);
        expect(daysInclusive('2024-01-01', '2024-12-31')).toBe(366); // Schaltjahr
        expect(daysInclusive('2024-02-28', '2024-03-01')).toBe(3); // 28., 29., 1.
        expect(daysInclusive('2025-03-29', '2025-03-31')).toBe(3); // Sommerzeit-Umstellung 30.03. ohne Einfluss
        expect(daysInclusive('2025-05-05', '2025-05-05')).toBe(1);
    });

    it('addDaysISO und addMonthsISO rechnen über Monats- und Jahresgrenzen, Monatsende wird begrenzt', () => {
        expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29');
        expect(addDaysISO('2025-01-01', -1)).toBe('2024-12-31');
        expect(addMonthsISO('2024-01-31', 1)).toBe('2024-02-29'); // 31. Feb. gibt es nicht -> Monatsletzter
        expect(addMonthsISO('2025-01-31', 1)).toBe('2025-02-28');
        expect(addMonthsISO('2024-02-29', 12)).toBe('2025-02-28');
        expect(addMonthsISO('2025-11-15', 3)).toBe('2026-02-15');
        expect(addMonthsISO('2025-03-31', -1)).toBe('2025-02-28');
    });

    it('localISODate nutzt das lokale Kalenderdatum (nicht UTC)', () => {
        // 01.01.2025 00:30 Ortszeit wäre in UTC (DE) noch der 31.12.2024
        expect(localISODate(new Date(2025, 0, 1, 0, 30))).toBe('2025-01-01');
        expect(localISODate('kein Datum')).toBe('');
    });

    it('formatDateDE und settlementYearLabel', () => {
        expect(formatDateDE('2025-03-07')).toBe('07.03.2025');
        expect(formatDateDE('')).toBe('–');
        expect(settlementYearLabel('2025-01-01', '2025-12-31')).toBe('2025');
        expect(settlementYearLabel('2024-07-01', '2025-06-30')).toBe('2024/2025'); // abweichendes Abrechnungsjahr
        expect(settlementYearLabel('', '')).toBe('');
    });

    it('settlementDeadline: Ablauf des 12. Monats nach Ende des Zeitraums (§ 556 Abs. 3 BGB, § 188 BGB)', () => {
        expect(settlementDeadline('2025-12-31')).toBe('2026-12-31');
        expect(settlementDeadline('2025-06-30')).toBe('2026-06-30');
        // Ende 29.02.2024: Tag fehlt im Folgejahr -> Monatsletzter (§ 188 Abs. 3 BGB)
        expect(settlementDeadline('2024-02-29')).toBe('2025-02-28');
        expect(settlementDeadline('2025-02-30')).toBeNull();
        expect(settlementDeadline(null)).toBeNull();
    });

    it('validatePeriod: 12 Monate erlaubt, längere Zeiträume ergeben eine Warnung (§ 556 Abs. 3 BGB)', () => {
        expect(validatePeriod('2025-01-01', '2025-12-31')).toEqual({ errors: [], warnings: [] });
        expect(validatePeriod('2024-01-01', '2024-12-31')).toEqual({ errors: [], warnings: [] }); // 366 Tage, aber 12 Monate
        expect(validatePeriod('2024-07-01', '2025-06-30')).toEqual({ errors: [], warnings: [] });
        expect(validatePeriod('2024-03-01', '2025-02-28')).toEqual({ errors: [], warnings: [] });
        // 12 Monate + 1 Tag
        expect(validatePeriod('2025-01-01', '2026-01-01').warnings).toHaveLength(1);
        expect(validatePeriod('2025-12-31', '2025-01-01').errors[0]).toMatch(/vor dem Beginn/);
        expect(validatePeriod('', '2025-12-31').errors[0]).toMatch(/Beginn und Ende/);
        expect(validatePeriod('2025-02-29', '2025-12-31').errors).toHaveLength(1); // ungültiges Datum
    });

    it('validatePeriod: Beginn am 29.02. – 12 Monate enden am 28.02. des Folgejahres (§ 188 Abs. 3 BGB)', () => {
        // 29.02.2024 + 12 Monate: der 29.02.2025 fehlt -> Fristende = Monatsletzter 28.02.2025
        expect(validatePeriod('2024-02-29', '2025-02-28').warnings).toEqual([]);
        // ein Tag mehr ist länger als 12 Monate
        expect(validatePeriod('2024-02-29', '2025-03-01').warnings).toHaveLength(1);
        // Gegenprobe ohne Schalttag (§ 188 Abs. 2 BGB): Beginn 31.01.2025 -> 12 Monate bis 30.01.2026
        expect(validatePeriod('2025-01-31', '2026-01-30').warnings).toEqual([]);
        expect(validatePeriod('2025-01-31', '2026-01-31').warnings).toHaveLength(1);
    });

    it('periodsOverlap inklusive Randtagen', () => {
        expect(periodsOverlap('2025-01-01', '2025-06-30', '2025-06-30', '2025-12-31')).toBe(true); // gemeinsamer Tag
        expect(periodsOverlap('2025-01-01', '2025-06-29', '2025-06-30', '2025-12-31')).toBe(false);
        expect(periodsOverlap('2025-01-01', null, '2025-06-30', '2025-12-31')).toBe(false); // fehlendes Datum
    });

    it('monthsInRange liefert Tage je Kalendermonat (Teilmonate, Februar im Schaltjahr)', () => {
        expect(monthsInRange('2024-02-10', '2024-04-05')).toEqual([
            { key: '2024-02', first: '2024-02-01', days: 20, daysInMonth: 29 }, // 10.–29.02.
            { key: '2024-03', first: '2024-03-01', days: 31, daysInMonth: 31 },
            { key: '2024-04', first: '2024-04-01', days: 5, daysInMonth: 30 }
        ]);
        expect(monthsInRange('2024-12-15', '2025-01-10').map(m => [m.key, m.days])).toEqual([['2024-12', 17], ['2025-01', 10]]);
        expect(monthsInRange('2025-12-31', '2025-01-01')).toEqual([]);
    });
});

// ── Zahlen / Geld ────────────────────────────────────────────────────────────
describe('Geldbeträge und Rundung', () => {
    it('parseNumber akzeptiert Dezimalkomma und liefert null bei leeren/ungültigen Werten', () => {
        expect(parseNumber('12,5')).toBe(12.5);
        expect(parseNumber(' 3 ')).toBe(3);
        expect(parseNumber(0)).toBe(0);
        expect(parseNumber(-4.2)).toBe(-4.2);
        expect(parseNumber('')).toBeNull();
        expect(parseNumber(null)).toBeNull();
        expect(parseNumber(undefined)).toBeNull();
        expect(parseNumber('abc')).toBeNull();
        expect(parseNumber(Infinity)).toBeNull();
    });

    it('toCents rundet kaufmännisch auf ganze Cent, symmetrisch für negative Beträge', () => {
        expect(toCents(1.005)).toBe(101); // 1.005 ist binär 1.00499…, muss trotzdem aufrunden
        expect(toCents(-1.005)).toBe(-101);
        expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004
        expect(toCents('12.345')).toBe(1235);
        expect(toCents(1234.56)).toBe(123456);
        expect(toCents(0.004)).toBe(0);
        expect(toCents(0)).toBe(0);
        expect(toCents(null)).toBe(0);
        expect(toCents('')).toBe(0);
        expect(toCents('abc')).toBe(0);
    });

    it('centsToEuro / formatEUR / formatCents', () => {
        expect(centsToEuro(12345)).toBe(123.45);
        expect(centsToEuro(0)).toBe(0);
        expect(centsToEuro(null)).toBe(0);
        expect(formatCents(123456)).toBe('1.234,56 €');
        expect(formatEUR(-12.5)).toBe('-12,50 €');
        expect(formatEUR(-0.004)).toBe('0,00 €'); // kein „-0,00 €"
        expect(formatEUR(undefined)).toBe('0,00 €');
    });

    it('allocateCents verteilt exakt (Summe = Gesamtbetrag), Restcents nach größtem Rest', () => {
        // 100,00 € / 3 = 33,333… -> 3 × 33,33 = 99,99, 1 Cent Rest an den ersten (Gleichstand)
        expect(allocateCents(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
        // 2,00 € / 3 = 66,67 Cent je -> 3 × 66 = 198, 2 Cent Rest an die ersten beiden
        expect(allocateCents(200, [1, 1, 1])).toEqual([67, 67, 66]);
        // 1 Cent auf drei gleiche Anteile
        expect(allocateCents(1, [1, 1, 1])).toEqual([1, 0, 0]);
        // 10,00 € im Verhältnis 1:2 -> 333,33 / 666,67: Rest-Cent an den größeren Rest (0,67)
        expect(allocateCents(1000, [1, 2])).toEqual([333, 667]);
        // Gutschrift (negativer Betrag) spiegelbildlich
        expect(allocateCents(-10000, [1, 1, 1])).toEqual([-3334, -3333, -3333]);
    });

    it('allocateCents: negative, ungültige und Null-Gewichte bekommen nichts', () => {
        // gültige Gewichte 1 und 3 -> 10,00 € × 1/4 = 2,50 €, × 3/4 = 7,50 €
        expect(allocateCents(1000, [1, -5, NaN, 3])).toEqual([250, 0, 0, 750]);
        expect(allocateCents(100, [0, 0])).toEqual([0, 0]);
        expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
        expect(allocateCents(500, [])).toEqual([]);
    });

    it('allocateCents: Summenprobe bei krummen Gewichten', () => {
        const weights = [50.5, 72.25, 33.1, 0.15];
        const out = allocateCents(123457, weights);
        expect(out.reduce((s, x) => s + x, 0)).toBe(123457);
        // jeder Anteil weicht höchstens 1 Cent vom exakten Wert ab
        const sum = weights.reduce((s, x) => s + x, 0);
        out.forEach((c, i) => expect(Math.abs(c - (123457 * weights[i]) / sum)).toBeLessThan(1));
    });
});

// ── Verteilerschlüssel auflösen ──────────────────────────────────────────────
describe('resolveDistributionKey', () => {
    it('löst gespeicherte Schlüssel, Altschlüssel und mitgespeicherte Typen auf', () => {
        expect(resolveDistributionKey({ distribution_key: 'k-mea' }, KEYS)).toMatchObject({ type: 'mea', name: 'MEA', resolved: true });
        expect(resolveDistributionKey({ distribution_key: 'wohnflaeche' }, KEYS)).toMatchObject({ type: 'area', resolved: true });
        expect(resolveDistributionKey({ distribution_key: 'personenanzahl' }, [])).toMatchObject({ type: 'persons', resolved: true });
        // Schlüssel gelöscht, aber Typ beim Speichern mitgeschrieben
        expect(resolveDistributionKey({ distribution_key: 'weg', key_type: 'mea', key_name: 'MEA alt' }, KEYS))
            .toMatchObject({ type: 'mea', name: 'MEA alt', resolved: true, fromSaved: true });
        // Kostenart auf eine Einheit gebucht -> Direktzuordnung, unabhängig vom Schlüssel
        expect(resolveDistributionKey({ distribution_key: 'k-area', unit_id: 'W2' }, KEYS)).toMatchObject({ type: 'unit_direct', resolved: true });
    });

    it('nicht auflösbare Schlüssel werden NICHT still als Wohnfläche gerechnet', () => {
        expect(resolveDistributionKey({ distribution_key: 'weg' }, KEYS)).toMatchObject({ resolved: false, type: null });
        expect(resolveDistributionKey({ distribution_key: null }, KEYS).reason).toBe('Kein Verteilerschlüssel gewählt.');
        expect(resolveDistributionKey({ distribution_key: 'k-odd' }, KEYS)).toMatchObject({ resolved: false, type: null });
        expect(resolveDistributionKey(null, KEYS).resolved).toBe(false);
    });
});

describe('isHeatingCostName', () => {
    it('erkennt typische Heiz-/Warmwasser-Bezeichnungen', () => {
        ['Heizkosten', 'Heizöl', 'Fernwärme', 'Waermelieferung', 'Warmwasser', 'Brennstoffkosten', 'Pellets', 'Gas']
            .forEach(n => expect(isHeatingCostName(n), n).toBe(true));
        ['Grundsteuer', 'Müllabfuhr', 'Gartenpflege', 'Hausstrom', '', null].forEach(n => expect(isHeatingCostName(n), String(n)).toBe(false));
    });

    // BEFUND: „\bgas\b" verlangt eine Wortgrenze nach „gas" und verfehlt deshalb deutsche
    // Komposita wie „Erdgas", „Gaskosten" oder „Gasverbrauch". Folge: includeHeating ist
    // per Voreinstellung aus, Heizkosten-Vorauszahlungen würden nicht angerechnet (es erscheint
    // aber eine Warnung, und der Schalter lässt sich im Assistenten setzen). Nicht geändert,
    // weil es eine Namens-Heuristik ist und eine Erweiterung die Voreinstellung bestehender
    // Entwürfe verändern würde – fachlich zu entscheiden.
    it.skip('BEFUND: erkennt auch Komposita wie „Erdgas" und „Gaskosten"', () => {
        expect(isHeatingCostName('Erdgas')).toBe(true);
        expect(isHeatingCostName('Gaskosten')).toBe(true);
    });
});

// ── Belegung ─────────────────────────────────────────────────────────────────
describe('buildUnitOccupancy – Zeitanteile, Leerstand, Personentage', () => {
    it('Auszug, Leerstand und Einzug im Zeitraum', () => {
        // Vertrag 1 bis 31.03.2025 (31+28+31 = 90 Tage), April leer (30 Tage),
        // Vertrag 2 ab 01.05.2025 ohne Ende (365 − 120 = 245 Tage)
        const occ = buildUnitOccupancy({
            unitId: 'W1', periodStart: P_START, periodEnd: P_END, tenantsById: {},
            leases: [
                lease('L1', 'W1', '2024-05-01', '2025-03-31', tenant('T1', 'Anna', 'Albers', 2)),
                lease('L2', 'W1', '2025-05-01', null, tenant('T2', 'Bernd', 'Berg', 3)),
                lease('LX', 'W9', '2025-01-01', null, tenant('T9', 'X', 'Fremd', 1)), // andere Einheit
                lease('LY', 'W1', '2023-01-01', '2024-12-31', tenant('T8', 'Y', 'Alt', 1)) // vor dem Zeitraum beendet
            ]
        });
        expect(occ.totalDays).toBe(365);
        expect(occ.cells.map(c => [c.key, c.start, c.end, c.days, c.persons])).toEqual([
            ['L1', '2025-01-01', '2025-03-31', 90, 2],
            ['L2', '2025-05-01', '2025-12-31', 245, 3],
            ['vacancy', '2025-04-01', '2025-04-30', 30, 1]
        ]);
        expect(occ.vacancyDays).toBe(30);
        expect(occ.overlap).toBe(false);
        // Personentage: 2 × 90 + 3 × 245 + 1 × 30 (Leerstand mit 1 Person) = 180 + 735 + 30 = 945
        expect(occ.personDays).toBe(945);
        expect(occ.cells[0].ratio).toBeCloseTo(90 / 365, 12);
        expect(occ.cells.reduce((s, c) => s + c.ratio, 0)).toBeCloseTo(1, 12);
        expect(occ.cells[0].displayName).toBe('Albers, Anna');
    });

    it('Schaltjahr: Auszug am 29.02.2024', () => {
        // 31 (Jan) + 29 (Feb) = 60 Tage vermietet, 366 − 60 = 306 Tage Leerstand
        const occ = buildUnitOccupancy({
            unitId: 'W1', periodStart: '2024-01-01', periodEnd: '2024-12-31', tenantsById: {},
            leases: [lease('L1', 'W1', '2019-01-01', '2024-02-29', tenant('T1', 'Anna', 'Albers', 1))]
        });
        expect(occ.totalDays).toBe(366);
        expect(occ.cells.map(c => [c.key, c.days])).toEqual([['L1', 60], ['vacancy', 306]]);
    });

    it('fehlende Personenzahl -> 1 Person mit Kennzeichnung, Leerstand mit vacancyPersons', () => {
        const occ = buildUnitOccupancy({
            unitId: 'W1', periodStart: P_START, periodEnd: P_END, tenantsById: {}, vacancyPersons: 0,
            leases: [lease('L1', 'W1', '2025-07-01', null, tenant('T1', 'Anna', 'Albers', null))]
        });
        const [l1, vac] = occ.cells;
        expect(l1).toMatchObject({ persons: 1, personsMissing: true, days: 184 }); // 01.07.–31.12. = 184 Tage
        expect(vac).toMatchObject({ kind: 'vacancy', persons: 0, days: 181, personDays: 0 });
        expect(occ.missingPersons.map(c => c.leaseId)).toEqual(['L1']);
        expect(occ.personDays).toBe(184); // 1 × 184 + 0 × 181
    });

    it('Mieter über tenantsById, unbekannter Mieter, ungültige Vertragsdaten', () => {
        const occ = buildUnitOccupancy({
            unitId: 'W1', periodStart: P_START, periodEnd: P_END,
            tenantsById: { T1: tenant('T1', 'Anna', 'Albers', 3) },
            leases: [
                { id: 'L1', unit_id: 'W1', tenant_id: 'T1', start_date: '2025-01-01', end_date: '2025-06-30' },
                { id: 'L2', unit_id: 'W1', tenant_id: null, start_date: '2025-07-01', end_date: 'kaputt' }, // ohne Ende
                { id: 'L3', unit_id: 'W1', start_date: 'kein Datum' }, // ignoriert
                { id: 'L4', unit_id: 'W1', start_date: '2025-05-01', end_date: '2025-04-01' } // Ende vor Beginn: ignoriert
            ]
        });
        expect(occ.cells.map(c => [c.key, c.days, c.persons, c.displayName])).toEqual([
            ['L1', 181, 3, 'Albers, Anna'],
            ['L2', 184, 1, 'Unbekannt']
        ]);
        expect(occ.vacancyDays).toBe(0);
    });

    it('überschneidende Verträge: Tagesanteile werden auf 100 % normiert', () => {
        // L1 01.01.–30.06. (181 Tage), L2 01.06.–31.12. (214 Tage): Juni doppelt (30 Tage)
        const occ = buildUnitOccupancy({
            unitId: 'W1', periodStart: P_START, periodEnd: P_END, tenantsById: {},
            leases: [
                lease('L1', 'W1', '2025-01-01', '2025-06-30', tenant('T1', 'A', 'A', 1)),
                lease('L2', 'W1', '2025-06-01', null, tenant('T2', 'B', 'B', 1))
            ]
        });
        expect(occ.overlap).toBe(true);
        expect(occ.leaseDaySum).toBe(395); // 181 + 214
        expect(occ.vacancyDays).toBe(0);
        expect(occ.cells[0].ratio).toBeCloseTo(181 / 395, 12);
        expect(occ.cells[1].ratio).toBeCloseTo(214 / 395, 12);
    });

    it('ungültiger Zeitraum -> leere Belegung', () => {
        const occ = buildUnitOccupancy({ unitId: 'W1', leases: LEASES_A, periodStart: '2025-12-31', periodEnd: '2025-01-01' });
        expect(occ).toMatchObject({ totalDays: 0, cells: [], vacancyDays: 0, personDays: 0 });
    });
});

// ── Verteilerschlüssel ──────────────────────────────────────────────────────
describe('computeDistribution – Verteilerschlüssel (ganzjährig vermietet)', () => {
    it('Wohnfläche: 1.000 € auf 60/40/100 m² = 300/200/500 €', () => {
        // 1000 € / 200 m² = 5 €/m²
        const d = distA([item('c1', 1000, 'k-area')]).c1;
        expect(d.status).toBe('ok');
        expect(d.unitCents).toEqual({ W1: 30000, W2: 20000, W3: 50000 });
        expect(d.basis).toMatchObject({ total: 200, unitLabel: 'm²', unitValues: { W1: 60, W2: 40, W3: 100 } });
        expect(d.cellCents).toEqual({ W1: { L1: 30000 }, W2: { L2: 20000 }, W3: { L3: 50000 } });
    });

    it('Wohneinheiten / Gleichverteilung: 100 € auf 3 Einheiten mit Restcent', () => {
        // 100 € / 3 = 33,333… -> 33,34 / 33,33 / 33,33
        expect(distA([item('c1', 100, 'k-units')]).c1.unitCents).toEqual({ W1: 3334, W2: 3333, W3: 3333 });
        expect(distA([item('c1', 100, 'k-equal')]).c1.unitCents).toEqual({ W1: 3334, W2: 3333, W3: 3333 });
        // Altschlüssel „einheit"
        expect(distA([item('c1', 100, 'einheit')]).c1.unitCents).toEqual({ W1: 3334, W2: 3333, W3: 3333 });
    });

    it('Wohneinheiten: 1.000,01 € auf 3 Einheiten -> zwei Restcents', () => {
        // 100001 Cent / 3 = 33333,67 -> 3 × 33333 = 99999, 2 Cent Rest an W1 und W2
        expect(distA([item('c1', 1000.01, 'k-units')]).c1.unitCents).toEqual({ W1: 33334, W2: 33334, W3: 33333 });
    });

    it('Miteigentumsanteile: 1.000 € auf 250/250/500 MEA = 250/250/500 €', () => {
        const d = distA([item('c1', 1000, 'k-mea')]).c1;
        expect(d.unitCents).toEqual({ W1: 25000, W2: 25000, W3: 50000 });
        expect(d.basis).toMatchObject({ total: 1000, unitLabel: 'MEA' });
    });

    it('Personen: 700 € nach Personentagen 2/1/4 Personen × 365 Tage', () => {
        // 730 + 365 + 1460 = 2555 Personentage; 700 € × 730/2555 = 200 €, × 365/2555 = 100 €, × 1460/2555 = 400 €
        const d = distA([item('c1', 700, 'k-pers')]).c1;
        expect(d.unitCents).toEqual({ W1: 20000, W2: 10000, W3: 40000 });
        expect(d.basis).toMatchObject({ total: 2555, unitLabel: 'Pers.-Tage' });
    });

    it('Verbrauch: 1.400 € nach 5.000/2.000/7.000 kWh = 500/200/700 €', () => {
        // 1400 € / 14000 kWh = 0,10 €/kWh
        const d = distA([item('c1', 1400, 'k-cons', { unit_values: { W1: 5000, W2: 2000, W3: 7000 }, consumption_unit: 'kWh' })]).c1;
        expect(d.unitCents).toEqual({ W1: 50000, W2: 20000, W3: 70000 });
        expect(d.basis).toMatchObject({ total: 14000, unitLabel: 'kWh' });
    });

    it('Verbrauch: Werte mit Dezimalkomma aus dem Eingabefeld', () => {
        // 2,5 + 2,5 + 5 = 10 m³; 100 € -> 25/25/50 €
        const d = distA([item('c1', 100, 'k-cons', { unit_values: { W1: '2,5', W2: '2,5', W3: '5' } })]).c1;
        expect(d.unitCents).toEqual({ W1: 2500, W2: 2500, W3: 5000 });
    });

    it('Direktzuordnung (feste Beträge je Einheit), Einheiten ohne Betrag tragen nichts', () => {
        const d = distA([item('c1', 200.5, 'k-direct', { unit_values: { W1: 120.5, W2: 0, W3: '80' } })]).c1;
        expect(d.status).toBe('ok');
        expect(d.unitCents).toEqual({ W1: 12050, W3: 8000 });
        expect(d.basis.unitLabel).toBe('€');
    });

    it('auf eine Einheit gebuchte Kosten (unit_direct) gehen nur an diese Einheit', () => {
        const d = distA([item('c1', 99.99, 'k-area', { unit_id: 'W2' })]).c1;
        expect(d.key.type).toBe('unit_direct');
        expect(d.unitCents).toEqual({ W1: 0, W2: 9999, W3: 0 });
        expect(d.basis.total).toBeNull();
    });

    it('negative Kostenart (Erstattung/Gutschrift) wird spiegelbildlich verteilt', () => {
        // −100 € / 3 Einheiten -> −33,34 / −33,33 / −33,33
        const d = distA([item('c1', -100, 'k-units')]).c1;
        expect(d.unitCents).toEqual({ W1: -3334, W2: -3333, W3: -3333 });
    });

    it('Kostenart mit 0 € ist gültig und verteilt 0', () => {
        const d = distA([item('c1', 0, 'k-area')]).c1;
        expect(d.status).toBe('ok');
        expect(sumOf(d.unitCents)).toBe(0);
    });

    it('Summe aller Anteile = Gesamtkosten für jeden Schlüssel (Cent-Rest)', () => {
        const items = [
            item('a', 1234.57, 'k-area'), item('p', 987.65, 'k-pers'), item('u', 100.01, 'k-units'),
            item('m', 333.33, 'k-mea'), item('v', 777.77, 'k-cons', { unit_values: { W1: 1.3, W2: 2.7, W3: 3.3 } })
        ];
        const dist = distA(items);
        items.forEach(it => {
            expect(dist[it.id].status, it.id).toBe('ok');
            expect(sumOf(dist[it.id].unitCents), it.id).toBe(toCents(it.amount));
        });
    });
});

describe('computeDistribution – fehlende/ungültige Bezugsgrößen', () => {
    const house = (patch) => HOUSE_A.map(u => ({ ...u, ...(patch[u.id] || {}) }));
    const distWith = (houseUnits, items, opts = {}) => computeDistribution({
        costItems: items, houseUnits, occupancy: occFor(houseUnits, opts.leases || LEASES_A, opts), distributionKeys: KEYS
    });

    it('Wohnfläche fehlt -> Fehler statt Rechnen mit 0 oder 1', () => {
        const d = distWith(house({ W2: { sqm: null } }), [item('c1', 1000, 'k-area')]).c1;
        expect(d.status).toBe('error');
        expect(d.message).toContain('Wohnfläche fehlt für: W2');
        expect(d.unitCents).toEqual({});
    });

    it('0 m² bei einer Einheit -> Warnung, die übrigen tragen die Kosten', () => {
        // 1000 € auf 60 + 100 m² -> 60/160 = 375 €, 100/160 = 625 €
        const d = distWith(house({ W2: { sqm: 0 } }), [item('c1', 1000, 'k-area')]).c1;
        expect(d.status).toBe('ok');
        expect(d.warning).toContain('W2');
        expect(d.unitCents).toEqual({ W1: 37500, W2: 0, W3: 62500 });
    });

    it('alle Flächen 0 -> Fehler „Summe der Bezugsgrößen ist 0"', () => {
        const d = distWith(house({ W1: { sqm: 0 }, W2: { sqm: '0' }, W3: { sqm: 0 } }), [item('c1', 1000, 'k-area')]).c1;
        expect(d.status).toBe('error');
        expect(d.message).toBe('Die Summe der Bezugsgrößen ist 0.');
    });

    it('MEA für keine Einheit hinterlegt -> Fehler; teilweise -> Warnung', () => {
        const none = distWith(house({ W1: { ownership_share: null }, W2: { ownership_share: 0 }, W3: { ownership_share: '' } }), [item('c1', 1000, 'k-mea')]).c1;
        expect(none.status).toBe('error');
        expect(none.message).toMatch(/Miteigentumsanteile/);
        // W2 ohne MEA: 1000 € auf 250 + 500 -> 333,333… / 666,666… -> Rest-Cent an W3 (größerer Rest 0,67)
        const part = distWith(house({ W2: { ownership_share: null } }), [item('c1', 1000, 'k-mea')]).c1;
        expect(part.status).toBe('ok');
        expect(part.warning).toContain('W2');
        expect(part.unitCents).toEqual({ W1: 33333, W2: 0, W3: 66667 });
    });

    it('Verbrauchswert fehlt -> Fehler; negativer Verbrauch -> Fehler', () => {
        const missing = distA([item('c1', 100, 'k-cons', { unit_values: { W1: 1, W2: 2 } })]).c1;
        expect(missing.status).toBe('error');
        expect(missing.message).toContain('Verbrauchswerte fehlen für: W3');
        const negative = distA([item('c1', 100, 'k-cons', { unit_values: { W1: -1, W2: 2, W3: 3 } })]).c1;
        expect(negative.status).toBe('error');
        expect(negative.message).toContain('Negative Verbrauchswerte bei: W1');
    });

    it('Befund G09a-06: Verbrauch überall 0 -> Kostenart verschwindet NICHT, sondern wird als Fehler gemeldet', () => {
        const d = distA([item('c1', 240, 'k-cons', { unit_values: { W1: 0, W2: 0, W3: '0' } })]).c1;
        expect(d.status).toBe('error');
        expect(d.message).toBe('Die Summe der Bezugsgrößen ist 0.');
        expect(d.totalCents).toBe(24000);
    });

    it('Personenschlüssel ohne Personen im Zeitraum -> Fehler', () => {
        // alle Einheiten leer, Leerstand mit 0 Personen
        const d = distWith(HOUSE_A, [item('c1', 100, 'k-pers')], { leases: [], vacancyPersons: 0 }).c1;
        expect(d.status).toBe('error');
        expect(d.message).toMatch(/keine Personen/);
    });

    it('Schlüssel fehlt / unbekannt / nicht unterstützt, keine Einheiten, fremde Einheit', () => {
        expect(distA([item('c1', 100, null)]).c1).toMatchObject({ status: 'error', message: 'Kein Verteilerschlüssel gewählt.' });
        expect(distA([item('c1', 100, 'geloescht')]).c1.message).toMatch(/nicht gefunden/);
        expect(distA([item('c1', 100, 'k-odd')]).c1.message).toMatch(/nicht unterstützt/);
        expect(computeDistribution({ costItems: [item('c1', 100, 'k-area')], houseUnits: [] }).c1.message).toBe('Keine Einheiten im Objekt.');
        expect(distA([item('c1', 100, 'k-area', { unit_id: 'FREMD' })]).c1.message).toMatch(/gehört nicht zu diesem Objekt/);
    });
});

describe('computeDistribution – Zeitanteile bei Mieterwechsel, Leerstand trägt der Vermieter', () => {
    const occB = (opts) => occFor(HOUSE_B, LEASES_B, opts);

    it('Wohnfläche 1.000 €: Einheitenanteil zeitanteilig auf Mieter und Leerstand', () => {
        // W1: 60/200 × 1000 = 300,00 € (ganzjährig Albers)
        // W2: 40/200 × 1000 = 200 €: Berg 200 × 181/365 = 99,178…, Leerstand 200 × 184/365 = 100,821…
        // W3: 100/200 × 1000 = 500 €: Christ 500 × 275/365 = 376,712…, Leerstand 500 × 90/365 = 123,287…
        // abgerundet 30000 + 9917 + 10082 + 37671 + 12328 = 99998 -> 2 Restcents an die größten
        // Reste: Berg (0,808) und Leerstand W3 (0,767)
        const d = computeDistribution({ costItems: [item('c1', 1000, 'k-area')], houseUnits: HOUSE_B, occupancy: occB(), distributionKeys: KEYS }).c1;
        expect(d.cellCents).toEqual({
            W1: { L1: 30000 },
            W2: { L2: 9918, vacancy: 10082 },
            W3: { L3: 37671, vacancy: 12329 }
        });
        expect(d.unitCents).toEqual({ W1: 30000, W2: 20000, W3: 50000 });
    });

    it('Personen 365 €: Leerstand mit 1 Person, Vermieter trägt dessen Personentage', () => {
        // Personentage: Albers 2 × 365 = 730 | Berg 1 × 181 = 181, Leerstand 1 × 184 = 184 |
        //               Christ 4 × 275 = 1100, Leerstand 1 × 90 = 90  -> gesamt 2285
        // 36500 Cent × 730/2285 = 11660,83 | × 181/2285 = 2891,25 | × 184/2285 = 2939,17 |
        //              × 1100/2285 = 17571,12 | × 90/2285 = 1437,64
        // abgerundet 36498 -> 2 Restcents an Albers (0,83) und Leerstand W3 (0,64)
        const d = computeDistribution({ costItems: [item('c1', 365, 'k-pers')], houseUnits: HOUSE_B, occupancy: occB(), distributionKeys: KEYS }).c1;
        expect(d.basis.total).toBe(2285);
        expect(d.cellCents).toEqual({
            W1: { L1: 11661 },
            W2: { L2: 2891, vacancy: 2939 },
            W3: { L3: 17571, vacancy: 1438 }
        });
        expect(sumOf(d.unitCents)).toBe(36500);
    });

    it('Personen 365 € mit 0 Personen für Leerstand: leere Zeiten tragen nichts', () => {
        // Personentage 730 + 181 + 1100 = 2011; 36500 × 730/2011 = 13249,63 | × 181/2011 = 3285,18 |
        // × 1100/2011 = 19965,19 -> abgerundet 36499, 1 Restcent an Albers (0,63)
        const d = computeDistribution({ costItems: [item('c1', 365, 'k-pers')], houseUnits: HOUSE_B, occupancy: occB({ vacancyPersons: 0 }), distributionKeys: KEYS }).c1;
        expect(d.basis.total).toBe(2011);
        expect(d.cellCents).toEqual({ W1: { L1: 13250 }, W2: { L2: 3285 }, W3: { L3: 19965 } });
    });

    it('Wohneinheiten 300 €: je Einheit 100 €, zeitanteilig', () => {
        // W2: Berg 100 × 181/365 = 49,589…, Leerstand 50,410… | W3: Christ 100 × 275/365 = 75,342…, Leerstand 24,657…
        // abgerundet 10000 + 4958 + 5041 + 7534 + 2465 = 29998 -> Restcents an Berg (0,90) und Leerstand W3 (0,75)
        const d = computeDistribution({ costItems: [item('c1', 300, 'k-units')], houseUnits: HOUSE_B, occupancy: occB(), distributionKeys: KEYS }).c1;
        expect(d.cellCents).toEqual({ W1: { L1: 10000 }, W2: { L2: 4959, vacancy: 5041 }, W3: { L3: 7534, vacancy: 2466 } });
    });

    it('Schaltjahr 2024: 366 € Fläche, Auszug 29.02. -> Mieter 60 €, Leerstand 306 €', () => {
        // 366 € / 366 Tage = 1 €/Tag; Mieter 31 + 29 = 60 Tage, Leerstand 306 Tage
        const houseUnits = [unit('W1', 100)];
        const occupancy = occFor(houseUnits, [lease('L1', 'W1', '2019-01-01', '2024-02-29', tenant('T1', 'A', 'A', 1))], { start: '2024-01-01', end: '2024-12-31' });
        const d = computeDistribution({ costItems: [item('c1', 366, 'k-area')], houseUnits, occupancy, distributionKeys: KEYS }).c1;
        expect(d.cellCents).toEqual({ W1: { L1: 6000, vacancy: 30600 } });
    });
});

// ── Zeilen je Einheit ─────────────────────────────────────────────────────────
describe('buildUnitRows', () => {
    const occupancy = occFor(HOUSE_A, LEASES_A);
    const items = [item('c1', 1000, 'k-area'), item('c2', 100, 'k-cons', { unit_values: { W1: 0, W2: 0, W3: 0 } }), item('c3', 50, 'k-direct', { unit_values: { W3: 50 } })];
    const distribution = computeDistribution({ costItems: items, houseUnits: HOUSE_A, occupancy, distributionKeys: KEYS });

    it('Fehlerhafte Kostenart bleibt als Zeile sichtbar, Anteil 0 ohne Fehler wird ausgeblendet', () => {
        const rows = buildUnitRows({ costItems: items, selectedUnitIds: ['W1'], distribution, occupancy }).W1;
        // c1 300 € (ok), c2 Fehler (Summe 0) mit 0 €, c3 hat für W1 keinen Betrag -> ausgeblendet
        expect(rows.map(r => [r.id, r.amountCents, r.status])).toEqual([['c1', 30000, 'ok'], ['c2', 0, 'error']]);
        expect(rows[1].message).toBe('Die Summe der Bezugsgrößen ist 0.');
    });

    it('Handkorrektur, entfernte Zeile und Zusatzposition', () => {
        const rows = buildUnitRows({
            costItems: items, selectedUnitIds: ['W1'], distribution, occupancy,
            unitOverrides: { W1: { c1: { amount: 250.5, label: 'Grundsteuer (korrigiert)' }, c2: { removed: true } } },
            customRows: { W1: [{ id: 'x1', label: 'Gartenpflege', amount: 25 }] }
        }).W1;
        expect(rows.map(r => [r.id, r.label, r.amountCents, r.computedCents, r.overridden, r.isCustom])).toEqual([
            ['c1', 'Grundsteuer (korrigiert)', 25050, 30000, true, false],
            ['x1', 'Gartenpflege', 2500, 2500, false, true]
        ]);
        expect(rows[0].split).toEqual({ L1: 25050 });
    });
});

// ── Vorauszahlungen ──────────────────────────────────────────────────────────
describe('computeLeasePrepayment', () => {
    it('Soll ganzjährig: 12 × 40 € Betriebskosten, 12 × 55,55 € Heizkosten', () => {
        const pp = computeLeasePrepayment({ lease: { service_charge: 40, heating_cost: 55.55 }, start: P_START, end: P_END });
        expect(pp).toMatchObject({ sollSvc: 480, sollHeat: 666.6, istSvc: 0, istHeat: 0, months: 12, hasPaymentData: false, historyUsed: false });
    });

    it('Einzug am 16.03.: Teilmonat taggenau (16/31) + 9 volle Monate', () => {
        // März 31 € × 16/31 = 16,00 € + April–Dezember 9 × 31 € = 279 € -> 295,00 €; Monate 9 + 16/31 = 9,52
        const pp = computeLeasePrepayment({ lease: { service_charge: 31 }, start: '2025-03-16', end: P_END });
        expect(pp.sollSvc).toBe(295);
        expect(pp.months).toBe(9.52);
    });

    it('Schaltjahr: 15.–29.02.2024 = 15/29 eines Monats', () => {
        // 58 € × 15/29 = 30,00 €; gezahlte volle 58 € werden nur bis zum Soll angerechnet
        const pp = computeLeasePrepayment({
            lease: { service_charge: 58 }, start: '2024-02-15', end: '2024-02-29',
            payments: [{ amount: 58, period_month: '2024-02-01' }]
        });
        expect(pp.sollSvc).toBe(30);
        expect(pp.istSvc).toBe(30);
        expect(pp.months).toBe(0.52); // 15/29 = 0,517
    });

    it('Ist: Zahlungen erst auf Betriebs-, dann auf Heizkosten, je Monat höchstens das Soll', () => {
        // Soll je Monat 100 € BK + 50 € HK, Zeitraum Jan–Mär 2025
        // Jan: 900 € (inkl. Kaltmiete) -> 100 + 50 | Feb: 120 € -> 100 + 20 | Mär: 120 − 50 Rückbuchung = 70 -> 70 + 0
        // Zuordnung über period_month vor payment_date (Dezember-Zahlung für Januar zählt im Januar)
        const pp = computeLeasePrepayment({
            lease: { service_charge: 100, heating_cost: 50 }, start: '2025-01-01', end: '2025-03-31',
            payments: [
                { amount: 900, period_month: '2025-01-01', payment_date: '2024-12-28' },
                { amount: '120', payment_date: '2025-02-03' },
                { amount: 120, payment_date: '2025-03-01' },
                { amount: -50, payment_date: '2025-03-20' },
                { amount: 999, payment_date: '2025-04-01' }, // außerhalb des Zeitraums
                { amount: 10 } // ohne Datum: ignoriert
            ]
        });
        expect(pp).toMatchObject({ sollSvc: 300, sollHeat: 150, istSvc: 270, istHeat: 70, hasPaymentData: true });
    });

    it('Miethistorie: Erhöhung ab Juli, Monat von valid_from zählt voll', () => {
        // Jan–Jun 6 × 80 € = 480 € + Jul–Dez 6 × 100 € = 600 € -> 1.080 € (Heizkosten 6 × 0 + 6 × 20 = 120 €)
        const pp = computeLeasePrepayment({
            lease: { service_charge: 999, heating_cost: 999 }, // heutiger Vertragsstand darf nicht genutzt werden
            start: P_START, end: P_END,
            rentPeriods: [
                { valid_from: '2025-07-15', service_charge: 100, heating_cost: 20 },
                { valid_from: '2024-01-01', service_charge: 80, heating_cost: 0 }
            ]
        });
        expect(pp).toMatchObject({ sollSvc: 1080, sollHeat: 120, historyUsed: true });
    });

    it('Miethistorie beginnt erst im Zeitraum: davor gilt der erste Eintrag', () => {
        // Jan–Mär 2025, einziger Eintrag ab 01.04.2025 mit 90 € -> 3 × 90 = 270 €
        const pp = computeLeasePrepayment({ lease: { service_charge: 10 }, start: '2025-01-01', end: '2025-03-31', rentPeriods: [{ valid_from: '2025-04-01', service_charge: 90 }] });
        expect(pp.sollSvc).toBe(270);
    });

    it('fehlende Vertragsdaten -> 0, ungültiger Zeitraum -> 0 Monate', () => {
        expect(computeLeasePrepayment({ lease: null, start: P_START, end: P_END })).toMatchObject({ sollSvc: 0, sollHeat: 0, months: 12 });
        expect(computeLeasePrepayment({ lease: { service_charge: 50 }, start: '2025-12-31', end: '2025-01-01' })).toMatchObject({ sollSvc: 0, months: 0 });
    });
});

// ── Zählerstände ─────────────────────────────────────────────────────────────
describe('computeMeterConsumption', () => {
    const meters = [
        { id: 'm1', unit_id: 'W1', meter_type: 'heat', meter_number: 'H-1' },
        { id: 'm2', unit_id: 'W1', meter_type: 'heat', meter_number: 'H-2' },
        { id: 'm3', unit_id: 'W2', meter_type: 'heat', meter_number: 'H-3' },
        { id: 'm4', unit_id: 'W2', meter_type: 'water', meter_number: 'W-4' },
        { id: 'm5', unit_id: null, meter_type: 'heat', meter_number: 'Hauptzähler' }
    ];
    const readings = [
        { id: 'r1', meter_id: 'm1', reading_date: '2024-12-01', reading_value: 900 }, // 31 Tage vor Beginn
        { id: 'r2', meter_id: 'm1', reading_date: '2025-01-02', reading_value: 1000 }, // 1 Tag -> Anfangsstand
        { id: 'r3', meter_id: 'm1', reading_date: '2025-12-30', reading_value: 1600 },
        { id: 'r4', meter_id: 'm2', reading_date: '2024-12-31', reading_value: '200.5' },
        { id: 'r5', meter_id: 'm2', reading_date: '2026-01-05', reading_value: 450.25 },
        { id: 'r6', meter_id: 'm3', reading_date: '2025-01-01', reading_value: 500 },
        { id: 'r7', meter_id: 'm3', reading_date: '2025-12-31', reading_value: 400 }, // Endstand kleiner
        { id: 'r8', meter_id: 'm4', reading_date: '2025-01-01', reading_value: 10 },
        { id: 'r9', meter_id: 'm4', reading_date: '2025-12-31', reading_value: 99 },
        { id: 'r10', meter_id: 'm5', reading_date: '2025-01-01', reading_value: 0 },
        { id: 'r11', meter_id: 'm5', reading_date: '2025-12-31', reading_value: 5000 }
    ];

    it('Summe mehrerer Zähler je Einheit, nächstgelegene Ablesung, nur gewählte Zählerart', () => {
        // W1: H-1 1600 − 1000 = 600 (nicht 900, Ablesung 02.01. liegt näher) + H-2 450,25 − 200,5 = 249,75 -> 849,75
        const res = computeMeterConsumption({ meters, readings, periodStart: P_START, periodEnd: P_END, meterType: 'heat' });
        expect(Object.keys(res).sort()).toEqual(['W1', 'W2']); // Hauptzähler ohne Einheit zählt nicht
        expect(res.W1.complete).toBe(true);
        expect(res.W1.value).toBe(849.75);
        expect(res.W1.details.map(d => d.consumption)).toEqual([600, 249.75]);
        // W2: Endstand kleiner als Anfangsstand -> unvollständig, Wasserzähler zählt nicht mit
        expect(res.W2).toMatchObject({ complete: false, value: 0 });
        expect(res.W2.details[0].error).toBe('Endstand kleiner als Anfangsstand');
    });

    it('Ablesung außerhalb des Fensters (Standard 45 Tage) fehlt', () => {
        // 15.11.2024 -> 01.01.2025 sind 47 Tage
        const r = [
            { id: 'a', meter_id: 'm1', reading_date: '2024-11-15', reading_value: 100 },
            { id: 'b', meter_id: 'm1', reading_date: '2025-12-31', reading_value: 160 }
        ];
        const m = [meters[0]];
        const strict = computeMeterConsumption({ meters: m, readings: r, periodStart: P_START, periodEnd: P_END, meterType: 'heat' });
        expect(strict.W1.complete).toBe(false);
        expect(strict.W1.details[0].error).toMatch(/fehlt/);
        const wide = computeMeterConsumption({ meters: m, readings: r, periodStart: P_START, periodEnd: P_END, meterType: 'heat', windowDays: 60 });
        expect(wide.W1).toMatchObject({ complete: true, value: 60 });
    });

    it('eine einzige Ablesung dient nicht zugleich als Anfangs- und Endstand', () => {
        const res = computeMeterConsumption({
            meters: [meters[0]], readings: [{ id: 'x', meter_id: 'm1', reading_date: '2025-01-15', reading_value: 5 }],
            periodStart: '2025-01-01', periodEnd: '2025-01-31', meterType: 'heat'
        });
        expect(res.W1.complete).toBe(false);
    });

    it('Verbrauch wird auf 3 Nachkommastellen gerundet', () => {
        // 0.4 − 0.1 = 0.30000000000000004 -> 0,3
        const res = computeMeterConsumption({
            meters: [meters[0]],
            readings: [
                { id: 'a', meter_id: 'm1', reading_date: P_START, reading_value: 0.1 },
                { id: 'b', meter_id: 'm1', reading_date: P_END, reading_value: 0.4 }
            ],
            periodStart: P_START, periodEnd: P_END, meterType: 'heat'
        });
        expect(res.W1.value).toBe(0.3);
    });
});

// ── Gesamtberechnung ─────────────────────────────────────────────────────────
describe('computeSettlement – Haus mit Mieterwechsel und Leerstand', () => {
    // Kostenarten 2025:
    //  c1 Grundsteuer 1.000 € nach Wohnfläche, c2 Müllabfuhr 365 € nach Personen, c3 Hausstrom 300 € nach Einheiten
    // Anteile (siehe Verteilungstests oben):
    //  Albers  c1 30000 + c2 11661 + c3 10000 = 51661  (516,61 €)
    //  Berg    c1  9918 + c2  2891 + c3  4959 = 17768  (177,68 €)
    //  Christ  c1 37671 + c2 17571 + c3  7534 = 62776  (627,76 €)
    //  Leerstand W2: 10082 + 2939 + 5041 = 18062; Leerstand W3: 12329 + 1438 + 2466 = 16233
    //  Summe 51661 + 17768 + 62776 + 18062 + 16233 = 166500 = 1.665,00 €
    // Vorauszahlungen (Soll, keine Zahlungsdaten):
    //  Albers 12 × 40 = 480 € -> Nachzahlung 36,61 € | Berg 6 × 30 = 180 € -> Guthaben 2,32 €
    //  Christ 9 × 60 = 540 € -> Nachzahlung 87,76 €
    const COSTS = [
        { id: 'c1', category_name: 'Grundsteuer', amount: 1000, distribution_key: 'k-area' },
        { id: 'c2', category_name: 'Müllabfuhr', amount: 365, distribution_key: 'k-pers' },
        { id: 'c3', category_name: 'Hausstrom', amount: 300, distribution_key: 'k-units' }
    ];
    const run = (extra = {}) => computeSettlement({
        periodStart: P_START, periodEnd: P_END, houseUnits: HOUSE_B, selectedUnitIds: ['W1', 'W2', 'W3'],
        leases: LEASES_B, distributionKeys: KEYS, costItems: COSTS, today: '2026-03-01', ...extra
    });

    it('Seiten je Mieter mit Anteilen, Vorauszahlungen und Saldo', () => {
        const r = run();
        expect(r.totalDays).toBe(365);
        expect(r.pages.map(p => [p.tenantDisplayName, p.days, p.totalCents, p.prepay.svcCents, p.balanceCents, p.balanceType])).toEqual([
            ['Albers, Anna', 365, 51661, 48000, 3661, 'nachzahlung'],
            ['Berg, Bernd', 181, 17768, 18000, -232, 'guthaben'],
            ['Christ, Clara', 275, 62776, 54000, 8776, 'nachzahlung']
        ]);
        expect(r.pages[2].prepay).toMatchObject({ source: 'soll', months: 9, heatCents: 0, includeHeating: false });
        expect(r.hasErrors).toBe(false);
    });

    it('Leerstand erscheint nicht auf Mieterseiten, sondern als Vermieteranteil', () => {
        const r = run();
        expect(r.vacancies.map(v => [v.unitId, v.days, v.totalCents])).toEqual([['W2', 184, 18062], ['W3', 90, 16233]]);
        expect(r.vacancies[1].gaps).toEqual([{ start: '2025-01-01', end: '2025-03-31' }]);
        expect(r.pages.some(p => p.leaseId === null)).toBe(false);
    });

    it('Summenprobe: umgelegt + Leerstand = Gesamtkosten (Differenz 0)', () => {
        const r = run();
        expect(r.sumCheck.map(s => [s.itemId, s.totalCents, s.tenantsCents, s.vacancyCents, s.otherUnitsCents, s.diffCents])).toEqual([
            ['c1', 100000, 77589, 22411, 0, 0], // 30000 + 9918 + 37671 | 10082 + 12329
            ['c2', 36500, 32123, 4377, 0, 0], // 11661 + 2891 + 17571 | 2939 + 1438
            ['c3', 30000, 22493, 7507, 0, 0] // 10000 + 4959 + 7534 | 5041 + 2466
        ]);
        const all = r.pages.reduce((s, p) => s + p.totalCents, 0) + r.vacancies.reduce((s, v) => s + v.totalCents, 0);
        expect(all).toBe(166500);
    });

    it('nur einen Teil der Einheiten abrechnen: Rest als „nicht abgerechnete Einheiten"', () => {
        // W3 (50000 Cent Grundsteuer) wird nicht abgerechnet
        const r = run({ selectedUnitIds: ['W1', 'W2'] });
        const c1 = r.sumCheck.find(s => s.itemId === 'c1');
        expect(c1).toMatchObject({ tenantsCents: 39918, vacancyCents: 10082, otherUnitsCents: 50000, diffCents: 0 });
        expect(r.pages).toHaveLength(2);
    });

    it('Bezugsgrößen je Position auf der Mieterseite', () => {
        const r = run();
        const albersGrund = r.pages[0].items.find(i => i.cost_item_id === 'c1');
        // 1000 € / 200 m² = 5 €/m², Albers 60 m², 365/365 Tage -> 300 €
        expect(albersGrund).toMatchObject({ basisTotal: 200, basisUnit: 60, unitLabel: 'm²', costPerBasis: 5, timeText: '365/365 Tage', share: 300 });
        const bergMuell = r.pages[1].items.find(i => i.cost_item_id === 'c2');
        expect(bergMuell).toMatchObject({ basisTotal: 2285, basisUnit: 181, unitLabel: 'Pers.-Tage', timeText: '1 P. × 181 T.', shareCents: 2891 });
        expect(bergMuell.costPerBasis).toBeCloseTo(365 / 2285, 12);
    });

    it('Hinweise: Leerstand beim Personenschlüssel, keine Fehler, Frist noch offen', () => {
        const r = run();
        expect(r.issues.some(i => i.level === 'info' && /Leerstand wird beim Personenschlüssel mit 1 Person/.test(i.text))).toBe(true);
        expect(r.issues.filter(i => i.level !== 'info')).toEqual([]);
    });

    it('Abrechnungsfrist § 556 Abs. 3 BGB: bis 31.12.2026 keine Warnung, ab 01.01.2027 Warnung', () => {
        expect(run({ today: '2026-12-31' }).issues.some(i => /Abrechnungsfrist/.test(i.text))).toBe(false);
        const late = run({ today: '2027-01-01' }).issues.find(i => /Abrechnungsfrist/.test(i.text));
        expect(late.level).toBe('warning');
        expect(late.text).toContain('31.12.2026');
    });

    it('Handkorrektur führt zu sichtbarer Differenz in der Summenprobe', () => {
        // Albers Hausstrom 100 € -> 90 €: Gesamt 51661 − 1000 = 50661; Differenz c3 = 30000 − 29000 = 1000
        const r = run({ unitOverrides: { W1: { c3: { amount: 90 } } } });
        expect(r.pages[0].totalCents).toBe(50661);
        expect(r.pages[0].balanceCents).toBe(2661); // 506,61 − 480,00
        expect(r.sumCheck.find(s => s.itemId === 'c3').diffCents).toBe(1000);
        expect(r.issues.find(i => i.text.startsWith('Hausstrom:')).text).toContain('290,00 € statt 300,00 € (Differenz 10,00 €)');
    });

    it('entfernte Zeile: Einheitenanteil einschließlich Leerstand fehlt in der Summenprobe', () => {
        // W2 Müllabfuhr entfernt: Berg 2891 + Leerstand W2 2939 = 5830 Cent nicht verteilt
        const r = run({ unitOverrides: { W2: { c2: { removed: true } } } });
        expect(r.pages[1].totalCents).toBe(17768 - 2891);
        expect(r.sumCheck.find(s => s.itemId === 'c2').diffCents).toBe(5830);
    });

    it('Zusatzposition wird dem Mieter berechnet, gehört aber nicht zu den Gesamtkosten', () => {
        const r = run({ customRows: { W1: [{ id: 'x1', label: 'Gartenpflege direkt', amount: 25 }] } });
        expect(r.pages[0].totalCents).toBe(51661 + 2500);
        expect(r.customCents).toBe(2500);
        expect(r.sumCheck.every(s => s.diffCents === 0)).toBe(true);
        expect(r.issues.some(i => i.level === 'info' && i.text.includes('25,00 €'))).toBe(true);
    });

    it('überschriebene Vorauszahlung', () => {
        // Berg: 200 € statt 180 € -> 177,68 − 200,00 = −22,32 € Guthaben
        const r = run({ prepayOverrides: { L2: { svc: '200' } } });
        expect(r.pages[1].prepay).toMatchObject({ svcCents: 20000, source: 'manual', svcOverridden: true });
        expect(r.pages[1].balanceCents).toBe(-2232);
    });

    it('Saldo genau 0 -> „even"', () => {
        // Albers Vorauszahlung = Kosten 516,61 €
        const r = run({ prepayOverrides: { L1: { svc: 516.61 } } });
        expect(r.pages[0]).toMatchObject({ balanceCents: 0, balanceType: 'even' });
    });

    it('Befund G09a-06: Verbrauchsschlüssel mit Summe 0 verschwindet nicht still', () => {
        // Kaltwasser 240 € nach Verbrauch, alle Zähler 0 -> Fehler, Position sichtbar, Abschluss blockiert
        const costs = [...COSTS, { id: 'c4', category_name: 'Kaltwasser', amount: 240, distribution_key: 'k-cons', unit_values: { W1: 0, W2: 0, W3: 0 } }];
        const r = run({ costItems: costs });
        const pos = r.pages[0].items.find(i => i.cost_item_id === 'c4');
        expect(pos).toMatchObject({ status: 'error', shareCents: 0, message: 'Die Summe der Bezugsgrößen ist 0.' });
        expect(r.sumCheck.find(s => s.itemId === 'c4')).toMatchObject({ status: 'error', totalCents: 24000 });
        const err = r.issues.find(i => i.level === 'error');
        expect(err.text).toBe('Kaltwasser: Die Summe der Bezugsgrößen ist 0. 240,00 € werden derzeit nicht verteilt.');
        expect(r.hasErrors).toBe(true);
        // die übrigen Kostenarten bleiben unverändert
        expect(r.pages[0].totalCents).toBe(51661);
    });

    it('fehlende Personenzahl -> Warnung „mit 1 Person angesetzt"', () => {
        const leases = LEASES_B.map(l => (l.id === 'L3' ? { ...l, tenant: { ...l.tenant, occupants: null } } : l));
        const r = run({ leases });
        expect(r.issues.find(i => /Personenzahl nicht hinterlegt/.test(i.text)).text).toContain('Christ, Clara (W3)');
    });

    it('Zeitraum länger als 12 Monate und Einheit nicht mehr im Objekt -> Warnungen', () => {
        const r = run({ periodEnd: '2026-01-31', selectedUnitIds: ['W1', 'W2', 'W3', 'WEG'] });
        expect(r.issues.some(i => i.level === 'warning' && /länger als 12 Monate/.test(i.text))).toBe(true);
        expect(r.issues.some(i => i.level === 'warning' && /1 ausgewählte Einheit/.test(i.text))).toBe(true);
    });
});

describe('computeSettlement – Heizkosten (HeizkostenV: Grund- und Verbrauchsanteil)', () => {
    // 2 Einheiten ganzjährig vermietet: W1 60 m², W2 40 m²
    // Heizkosten gesamt 2.000 €, aufgeteilt in 30 % Grundkosten nach Fläche und 70 % nach Verbrauch:
    //  Grund 600 €: W1 60/100 = 360 €, W2 240 €
    //  Verbrauch 1.400 € nach 3.000/4.000 kWh: W1 600 €, W2 800 €
    //  W1 960 €, W2 1.040 € (Summe 2.000 €)
    // Heizkostenvorauszahlung: W1 12 × 70 = 840 € -> Nachzahlung 120 €; W2 12 × 90 = 1.080 € -> Guthaben 40 €
    const houseUnits = [unit('W1', 60), unit('W2', 40)];
    const leases = [
        lease('L1', 'W1', '2020-01-01', null, tenant('T1', 'Anna', 'Albers', 1), { service_charge: 0, heating_cost: 70 }),
        lease('L2', 'W2', '2020-01-01', null, tenant('T2', 'Bernd', 'Berg', 1), { service_charge: 0, heating_cost: 90 })
    ];
    const costItems = [
        { id: 'h1', category_name: 'Heizkosten Grundkosten (30 %)', amount: 600, distribution_key: 'k-area' },
        { id: 'h2', category_name: 'Heizkosten Verbrauchskosten (70 %)', amount: 1400, distribution_key: 'k-cons', unit_values: { W1: 3000, W2: 4000 }, consumption_unit: 'kWh' }
    ];
    const run = (extra = {}) => computeSettlement({
        periodStart: P_START, periodEnd: P_END, houseUnits, selectedUnitIds: ['W1', 'W2'], leases,
        distributionKeys: KEYS, costItems, today: '2026-03-01', ...extra
    });

    it('Grund- und Verbrauchsanteil, Heizkostenvorauszahlung wird automatisch angerechnet', () => {
        const r = run();
        expect(r.heatingDetected).toBe(true);
        expect(r.includeHeating).toBe(true);
        expect(r.pages.map(p => [p.unitId, p.items.map(i => i.shareCents), p.totalCents, p.prepay.heatCents, p.balanceCents, p.balanceType])).toEqual([
            ['W1', [36000, 60000], 96000, 84000, 12000, 'nachzahlung'],
            ['W2', [24000, 80000], 104000, 108000, -4000, 'guthaben']
        ]);
        expect(r.sumCheck.every(s => s.diffCents === 0)).toBe(true);
    });

    it('HeizkostenV-Hinweis nur für die nicht verbrauchsabhängige Position', () => {
        const hints = run().issues.filter(i => i.text.includes('HeizkostenV'));
        expect(hints).toHaveLength(1);
        expect(hints[0].level).toBe('info');
        expect(hints[0].text.startsWith('Heizkosten Grundkosten (30 %):')).toBe(true);
    });

    it('Heizkosten-Vorauszahlungen abgeschaltet -> nicht angerechnet, mit Warnung', () => {
        const r = run({ options: { includeHeatingPrepay: false } });
        expect(r.pages[0]).toMatchObject({ balanceCents: 96000 });
        expect(r.pages[0].prepay.heatCents).toBe(0);
        expect(r.issues.some(i => i.level === 'warning' && /nicht angerechnet/.test(i.text))).toBe(true);
    });

    it('Heizkosten-Vorauszahlung ohne Heizkostenposition -> Warnung, falls trotzdem angerechnet', () => {
        const r = run({ costItems: [{ id: 'g', category_name: 'Grundsteuer', amount: 100, distribution_key: 'k-area' }], options: { includeHeatingPrepay: true } });
        expect(r.heatingDetected).toBe(false);
        expect(r.issues.some(i => /keine Heizkosten-Position erkannt/.test(i.text))).toBe(true);
    });

    it('Ist-Vorauszahlungen aus dem Mietkonto: fehlender Dezember wird nicht angerechnet', () => {
        // Albers zahlt Jan–Nov je 70 € -> Ist 770 €; 960 − 770 = 190 € Nachzahlung
        // Berg ohne Zahlungen -> Soll 1.080 € mit Hinweis
        const payments = Array.from({ length: 11 }, (_, i) => ({ amount: 70, period_month: `2025-${String(i + 1).padStart(2, '0')}-01` }));
        const r = run({ prepayData: { loaded: true, historyAvailable: false, paymentsAvailable: true, paymentsByLease: { L1: payments } } });
        expect(r.pages[0].prepay).toMatchObject({ source: 'ist', heatCents: 77000, istHeat: 770, sollHeat: 840 });
        expect(r.pages[0].balanceCents).toBe(19000);
        expect(r.pages[1].prepay).toMatchObject({ source: 'soll', heatCents: 108000 });
        expect(r.issues.find(i => /Keine Zahlungen im Mietkonto/.test(i.text)).text).toContain('Berg, Bernd');
        expect(r.issues.some(i => /Miethistorie ist noch nicht verfügbar/.test(i.text))).toBe(true);
    });

    it('Zahlungseingänge nicht ladbar -> Soll mit Warnung', () => {
        const r = run({ prepayData: { loaded: true, historyAvailable: true, paymentsAvailable: false, rentPeriodsByLease: {} } });
        expect(r.pages[0].prepay.source).toBe('soll');
        expect(r.issues.some(i => i.level === 'warning' && /Zahlungseingänge konnten nicht geladen werden/.test(i.text))).toBe(true);
    });
});

// ── Alte Entwürfe ────────────────────────────────────────────────────────────
describe('legacyUnitAmount / convertLegacyUnitCosts', () => {
    const houseUnits = [unit('W1', 60), unit('W2', 40)];
    const costItems = [{ id: 'c1', category_name: 'Grundsteuer', amount: 1000, distribution_key: 'wohnflaeche' }];

    it('alte Flächenrechnung: fehlende Fläche zählte als 1 m²', () => {
        // Fläche W2 fehlt -> 60 + 1 = 61; W1 = 1000 × 60/61 = 983,606…
        const amt = legacyUnitAmount({ item: costItems[0], unit: houseUnits[0], houseUnits: [houseUnits[0], unit('W2', null)], leases: [] });
        expect(amt).toBeCloseTo(60000 / 61, 9);
    });

    it('unveränderte Beträge -> keine Korrektur; abweichende -> Korrektur; unbekannte -> Zusatzposition', () => {
        let n = 0;
        const res = convertLegacyUnitCosts({
            savedUnitCosts: {
                W1: [{ cost_item_id: 'c1', amount: 600 }], // 1000 × 60/100 = 600 -> unverändert
                W2: [{ label: 'Grundsteuer', amount: '450' }, { label: 'Sonstiges', amount: 12 }] // erwartet 400
            },
            costItems, houseUnits, leases: [], distributionKeys: [], newId: () => `n${++n}`
        });
        expect(res.unitOverrides).toEqual({ W2: { c1: { amount: 450 } } });
        expect(res.customRows).toEqual({ W2: [{ id: 'n1', label: 'Sonstiges', amount: 12, isCustom: true }] });
    });
});

// ── Briefvariablen (Saldo) ───────────────────────────────────────────────────
describe('buildTemplateVariables – Saldo und Zeitraum', () => {
    const base = { tenantFullName: 'Anna Albers', tenantLastName: 'Albers', unitName: 'W1', start: '2025-04-01', end: '2025-12-31', letter: {} };

    it('Nachzahlung', () => {
        const v = buildTemplateVariables({ ...base, totalCents: 51661, balanceCents: 3661, balanceType: 'nachzahlung', prepay: { totalCents: 48000, svcCents: 48000, heatCents: 0 } },
            { periodStart: P_START, periodEnd: P_END, letterDate: '2026-02-15' });
        expect(v.saldo_betrag.text).toBe('36,61 €');
        expect(v.saldo_art.text).toBe('Nachzahlung');
        expect(v.gesamtkosten_mieter.text).toBe('516,61 €');
        expect(v.vorauszahlungs_betrag.text).toBe('480,00 €');
        expect(v.abrechnungsjahr.text).toBe('2025');
        expect(v.nutzungszeitraum.text).toBe('01.04.2025 - 31.12.2025');
        expect(v.erstellungsdatum.text).toBe('15.02.2026');
        expect(v.nebenkosten_tabelle.html).toContain('Ihre Nachzahlung (Brutto):');
    });

    it('Guthaben wird als positiver Betrag „Gutschrift" ausgewiesen, ausgeglichen ohne Vorzeichen', () => {
        const g = buildTemplateVariables({ ...base, totalCents: 17768, balanceCents: -232, balanceType: 'guthaben', prepay: { totalCents: 18000 } },
            { periodStart: '2024-07-01', periodEnd: '2025-06-30', letterDate: '2025-09-01' });
        expect(g.saldo_betrag.text).toBe('2,32 €');
        expect(g.saldo_art.text).toBe('Gutschrift');
        expect(g.abrechnungsjahr.text).toBe('2024/2025');
        const e = buildTemplateVariables({ ...base, totalCents: 100, balanceCents: 0, balanceType: 'even', prepay: { totalCents: 100 } },
            { periodStart: P_START, periodEnd: P_END, letterDate: '2026-01-10' });
        expect(e.saldo_art.text).toBe('ausgeglichen');
        expect(e.saldo_betrag.text).toBe('0,00 €');
    });
});
