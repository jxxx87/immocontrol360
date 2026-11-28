// Unit-Tests für den Schlüssel „HeizkostenV (Grund-/Verbrauchskosten)" in src/lib/utilitySettlement.js.
// Erwartungswerte von Hand nachgerechnet (Rechenweg im Kommentar). Beträge in Cent.
import { describe, it, expect } from 'vitest';
import {
    buildCalculationSnapshot, buildUnitOccupancy, computeDistribution, computeSettlement, expandItemParts,
    HEATING_SPLIT_KEY_ID, parseConsumptionShare, resolveDistributionKey
} from './utilitySettlement';

const P_START = '2025-01-01';
const P_END = '2025-12-31'; // 365 Tage

const KEYS = [
    { id: 'k-area', name: 'Wohnfläche', calculation_type: 'area' },
    { id: 'k-cons', name: 'Verbrauch', calculation_type: 'custom' }
];

const unit = (id, sqm, extra = {}) => ({ id, unit_name: id, sqm, property_id: 'P1', ...extra });
const tenant = (id, first, last, occupants) => ({ id, first_name: first, last_name: last, occupants });
const lease = (id, unitId, start, end, t, extra = {}) => ({ id, unit_id: unitId, start_date: start, end_date: end, tenant_id: t?.id ?? null, tenant: t ?? null, ...extra });
const heating = (id, amount, share, values, extra = {}) => ({
    id, category_name: id, amount, distribution_key: HEATING_SPLIT_KEY_ID,
    consumption_share: share, unit_values: values, consumption_unit: 'kWh', ...extra
});
const occFor = (houseUnits, leases) =>
    Object.fromEntries(houseUnits.map(u => [u.id, buildUnitOccupancy({ unitId: u.id, leases, tenantsById: {}, periodStart: P_START, periodEnd: P_END })]));
const sumOf = (obj) => Object.values(obj || {}).reduce((s, x) => s + x, 0);

// Zwei Einheiten ganzjährig vermietet: W1 60 m², W2 40 m²
const HOUSE = [unit('W1', 60), unit('W2', 40)];
const LEASES = [
    lease('L1', 'W1', '2020-01-01', null, tenant('T1', 'Anna', 'Albers', 1), { service_charge: 0, heating_cost: 70 }),
    lease('L2', 'W2', '2020-01-01', null, tenant('T2', 'Bernd', 'Berg', 1), { service_charge: 0, heating_cost: 90 })
];
const dist = (items, houseUnits = HOUSE, leases = LEASES) =>
    computeDistribution({ costItems: items, houseUnits, occupancy: occFor(houseUnits, leases), distributionKeys: KEYS });

describe('parseConsumptionShare (§§ 7, 8 HeizkostenV: 50–70 %)', () => {
    it('akzeptiert nur Werte von 50 bis 70 %', () => {
        expect(parseConsumptionShare(70)).toBe(70);
        expect(parseConsumptionShare('50')).toBe(50);
        expect(parseConsumptionShare('62,5')).toBe(62.5);
        expect(parseConsumptionShare(49.99)).toBeNull();
        expect(parseConsumptionShare(70.01)).toBeNull();
        expect(parseConsumptionShare(null)).toBeNull();
        expect(parseConsumptionShare('')).toBeNull();
    });
});

describe('Schlüssel HeizkostenV – Verteilung', () => {
    it('wird ohne Datensatz in distribution_keys aufgelöst', () => {
        expect(resolveDistributionKey({ distribution_key: HEATING_SPLIT_KEY_ID }, KEYS))
            .toMatchObject({ type: 'heating_split', resolved: true });
    });

    it('30 % Grundkosten nach Fläche, 70 % Verbrauchskosten nach Verbrauch', () => {
        // 2.000 €: Grund 600 € -> W1 60/100 = 360 €, W2 240 €
        //          Verbrauch 1.400 € nach 3.000/4.000 kWh -> W1 600 €, W2 800 €
        //          W1 960 €, W2 1.040 € (wie zwei getrennte Positionen)
        const d = dist([heating('h', 2000, 70, { W1: 3000, W2: 4000 })]).h;
        expect(d.status).toBe('ok');
        expect(d.unitCents).toEqual({ W1: 96000, W2: 104000 });
        expect(d.split).toMatchObject({ consumptionShare: 70, baseShare: 30, baseCents: 60000, consumptionCents: 140000 });
        expect(d.split.area.unitCents).toEqual({ W1: 36000, W2: 24000 });
        expect(d.split.consumption.unitCents).toEqual({ W1: 60000, W2: 80000 });
    });

    it('fehlender oder unzulässiger Verbrauchsanteil ist ein Fehler (kein stiller Standardwert)', () => {
        const missing = dist([heating('h', 2000, null, { W1: 3000, W2: 4000 })]).h;
        expect(missing.status).toBe('error');
        expect(missing.message).toMatch(/zwischen 50 und 70 %/);
        expect(dist([heating('h', 2000, 80, { W1: 3000, W2: 4000 })]).h.status).toBe('error');
        expect(dist([heating('h', 2000, 45, { W1: 3000, W2: 4000 })]).h.status).toBe('error');
    });

    it('fehlende Fläche, fehlende/negative Verbrauchswerte und Verbrauchssumme 0 sind Fehler', () => {
        expect(dist([heating('h', 100, 70, { W1: 1, W2: 1 })], [unit('W1', null), unit('W2', 40)]).h.message).toMatch(/Wohnfläche fehlt/);
        expect(dist([heating('h', 100, 70, { W1: 1 })]).h.message).toMatch(/Verbrauchswerte fehlen/);
        expect(dist([heating('h', 100, 70, { W1: -1, W2: 2 })]).h.message).toMatch(/Negative Verbrauchswerte/);
        expect(dist([heating('h', 100, 70, { W1: 0, W2: 0 })]).h.message).toMatch(/Summe der Verbrauchswerte ist 0/);
    });

    it('verteilt cent-genau, auch bei Mieterwechsel und Leerstand', () => {
        // 1.234,57 € bei 65 %: Verbrauch round(123457 × 0,65) = 80247 ct, Grund 43210 ct
        const house = [unit('W1', 55.5), unit('W2', 72.3), unit('W3', 0)];
        const leases = [
            lease('L1', 'W1', '2020-01-01', null, tenant('T1', 'A', 'A', 1)),
            lease('L2', 'W2', '2020-01-01', '2025-06-30', tenant('T2', 'B', 'B', 1)),
            lease('L3', 'W3', '2025-04-01', null, tenant('T3', 'C', 'C', 1))
        ];
        const d = dist([heating('h', 1234.57, 65, { W1: 1234.5, W2: 987.25, W3: 333 })], house, leases).h;
        expect(d.status).toBe('ok');
        expect(d.warning).toMatch(/tragen keine Grundkosten: W3/);
        expect(d.split.consumptionCents).toBe(80247);
        expect(d.split.baseCents).toBe(43210);
        expect(sumOf(d.split.area.unitCents)).toBe(43210);
        expect(sumOf(d.split.consumption.unitCents)).toBe(80247);
        expect(sumOf(d.unitCents)).toBe(123457);
        // Abschnitte (Mieter + Leerstand) ergeben je Einheit genau den Einheitenanteil
        house.forEach(u => expect(sumOf(d.cellCents[u.id])).toBe(d.unitCents[u.id]));
        expect(d.cellCents.W2.vacancy).toBeGreaterThan(0);
    });

    it('Gutschrift (negativer Betrag) wird ebenfalls aufgeteilt', () => {
        // −100 €: Verbrauch −70 €, Grund −30 €; W1 −18 € −30 € = −48 €, W2 −12 € −40 € = −52 €
        const d = dist([heating('h', -100, 70, { W1: 3, W2: 4 })]).h;
        expect(d.split).toMatchObject({ consumptionCents: -7000, baseCents: -3000 });
        expect(d.unitCents).toEqual({ W1: -4800, W2: -5200 });
    });
});

describe('Schlüssel HeizkostenV – Abrechnung, Detailblatt und Festschreibung', () => {
    const costItems = [heating('Heizkosten', 2000, 70, { W1: 3000, W2: 4000 })];
    const run = (extra = {}) => computeSettlement({
        periodStart: P_START, periodEnd: P_END, houseUnits: HOUSE, selectedUnitIds: ['W1', 'W2'], leases: LEASES,
        distributionKeys: KEYS, costItems, today: '2026-03-01', ...extra
    });

    it('Ergebnis je Mieter wie bei getrennten Positionen, ohne HeizkostenV-Hinweis', () => {
        const r = run();
        expect(r.hasErrors).toBe(false);
        expect(r.pages.map(p => [p.unitId, p.totalCents, p.prepay.heatCents, p.balanceCents])).toEqual([
            ['W1', 96000, 84000, 12000],
            ['W2', 104000, 108000, -4000]
        ]);
        expect(r.sumCheck.every(s => s.diffCents === 0)).toBe(true);
        expect(r.issues.some(i => i.text.includes('nach der HeizkostenV überwiegend'))).toBe(false);
    });

    it('weist Grund- und Verbrauchskosten als eigene Zeilen aus (Summe = Anteil)', () => {
        const page = run().pages[0];
        const item = page.items[0];
        expect(item.parts.map(p => [p.kind, p.keyName, p.shareCents, p.basisTotal, p.basisUnit])).toEqual([
            ['base', 'Wohnfläche', 36000, 100, 60],
            ['consumption', 'Verbrauch', 60000, 7000, 3000]
        ]);
        expect(item.parts[0].label).toBe('Heizkosten – Grundkosten (30 %)');
        expect(item.parts[1].label).toBe('Heizkosten – Verbrauchskosten (70 %)');
        expect(item.parts[1].costPerBasis).toBeCloseTo(0.2, 10); // 1.400 € / 7.000 kWh
        const rows = expandItemParts(page.items);
        expect(rows).toHaveLength(2);
        expect(rows.reduce((s, r) => s + r.shareCents, 0)).toBe(item.shareCents);
    });

    it('Handkorrektur: keine Teilzeilen, der korrigierte Betrag gilt', () => {
        const r = run({ unitOverrides: { W1: { Heizkosten: { amount: 900 } } } });
        const item = r.pages[0].items[0];
        expect(item.shareCents).toBe(90000);
        expect(item.parts).toBeUndefined();
    });

    it('Festschreibung enthält Teilzeilen und Aufteilungsgrundlagen', () => {
        const r = run();
        const snap = buildCalculationSnapshot({ result: r, costItems, periodStart: P_START, periodEnd: P_END, options: {}, finalizedAt: '2026-03-01T10:00:00Z' });
        expect(snap.cost_items[0].heating_split).toMatchObject({ consumption_share: 70, base_cents: 60000, consumption_cents: 140000, area_total: 100, consumption_total: 7000, consumption_unit: 'kWh' });
        expect(snap.pages[0].items[0].parts.map(p => p.shareCents)).toEqual([36000, 60000]);
        // Aus der Festschreibung erzeugte Detailzeilen
        expect(expandItemParts(snap.pages[1].items).map(p => p.shareCents)).toEqual([24000, 80000]);
    });
});
