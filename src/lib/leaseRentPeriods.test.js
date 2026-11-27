// Unit-Tests der Miethistorie ("gültig ab"), Laufzeit-Status, Überschneidungs- und Löschprüfung.
// Erwartungswerte von Hand nachgerechnet; Supabase ist gemockt (keine Netzwerk-/DB-Zugriffe).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: fromMock } }));

import {
    RENT_PERIOD_FIELDS,
    localISODate,
    monthStart,
    addMonths,
    formatDateDE,
    formatMonthDE,
    formatEUR,
    isValidISODate,
    isMissingSchemaError,
    sumRent,
    getLeaseTimeState,
    fetchRentPeriods,
    getEffectivePeriod,
    saveRentPeriod,
    deleteRentPeriod,
    checkLeaseDeletion,
    describeDeletionBlock,
    deletionConfirmText,
    translateLeaseDeleteError,
    findOverlappingLeases,
    describeLease,
    buildTemplateTenantData
} from './leaseRentPeriods';

// Verkettbarer Query-Builder: zeichnet Aufrufe auf, liefert beim await resolve(calls)
const queryBuilder = (resolve) => {
    const calls = [];
    const q = {
        calls,
        then(onFulfilled, onRejected) {
            return Promise.resolve().then(() => resolve(calls)).then(onFulfilled, onRejected);
        }
    };
    ['select', 'eq', 'order', 'update', 'insert', 'delete', 'in'].forEach(name => {
        q[name] = (...args) => { calls.push([name, ...args]); return q; };
    });
    return q;
};

// Registriert je Tabelle eine Antwort; liefert die erzeugten Builder zur Prüfung
const mockTables = (handlers) => {
    const builders = [];
    fromMock.mockImplementation((table) => {
        const q = queryBuilder(calls => handlers[table](calls));
        builders.push({ table, q });
        return q;
    });
    return builders;
};

const nbsp = (s) => s.split(String.fromCharCode(160)).join(' '); // Intl setzt ein geschütztes Leerzeichen vor €

beforeEach(() => {
    fromMock.mockReset();
});

// --- Datum / Format --------------------------------------------------------------

describe('Datums- und Formatierhilfen', () => {
    it('localISODate nutzt das lokale Kalenderdatum (nicht UTC)', () => {
        expect(localISODate(new Date(2024, 1, 29, 0, 30))).toBe('2024-02-29');
        expect(localISODate(new Date(2024, 11, 31, 23, 59))).toBe('2024-12-31');
    });

    it('monthStart liefert den Monatsersten (auch mit Zeitanteil), leer -> null', () => {
        expect(monthStart('2024-03-15')).toBe('2024-03-01');
        expect(monthStart('2024-03-31T23:30:00Z')).toBe('2024-03-01');
        expect(monthStart('2024-03')).toBe('2024-03-01');
        expect(monthStart(null)).toBeNull();
        expect(monthStart('')).toBeNull();
    });

    it('addMonths liefert den Monatsersten des verschobenen Monats (kein Überlauf am 31.)', () => {
        expect(addMonths('2024-01-31', 1)).toBe('2024-02-01');
        expect(addMonths('2024-12-15', 1)).toBe('2025-01-01');
        expect(addMonths('2024-03-01', -3)).toBe('2023-12-01');
        expect(addMonths('2024-02-29', 12)).toBe('2025-02-01');
    });

    it('formatDateDE ohne Zeitzonenverschiebung, Fallback bei leeren/ungültigen Werten', () => {
        expect(formatDateDE('2024-02-29')).toBe('29.02.2024');
        expect(formatDateDE('2024-02-29T23:30:00Z')).toBe('29.02.2024');
        expect(formatDateDE(null)).toBe('—');
        expect(formatDateDE(null, '')).toBe('');
        expect(formatDateDE('abc')).toBe('—');
    });

    it('formatMonthDE liefert MM/JJJJ, Fallback bei leeren/unvollständigen Werten', () => {
        expect(formatMonthDE('2024-02-29')).toBe('02/2024');
        expect(formatMonthDE('2024-11')).toBe('11/2024');
        expect(formatMonthDE(null)).toBe('—');
        expect(formatMonthDE('2024')).toBe('—'); // früher "undefined/2024"
    });

    it('formatEUR formatiert deutsch mit Tausenderpunkt und Komma', () => {
        expect(nbsp(formatEUR(1234.5))).toBe('1.234,50 €');
        expect(nbsp(formatEUR('980.1'))).toBe('980,10 €');
        expect(nbsp(formatEUR(null))).toBe('0,00 €');
        expect(nbsp(formatEUR('abc'))).toBe('0,00 €');
    });

    it('isValidISODate prüft echtes Kalenderdatum inkl. Schaltjahrregel', () => {
        expect(isValidISODate('2024-02-29')).toBe(true);
        expect(isValidISODate('2023-02-29')).toBe(false);
        expect(isValidISODate('2000-02-29')).toBe(true); // durch 400 teilbar
        expect(isValidISODate('1900-02-29')).toBe(false); // durch 100, nicht durch 400 teilbar
        expect(isValidISODate('2024-04-31')).toBe(false);
        expect(isValidISODate('2024-13-01')).toBe(false);
        expect(isValidISODate('2024-1-01')).toBe(false);
        expect(isValidISODate('2024-01-01T00:00:00')).toBe(false);
        expect(isValidISODate(null)).toBe(false);
    });

    it('isMissingSchemaError erkennt fehlende Tabelle/Spalte/Funktion', () => {
        ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202', '42883'].forEach(code => {
            expect(isMissingSchemaError({ code })).toBe(true);
        });
        expect(isMissingSchemaError({ message: 'Could not find the table public.lease_rent_periods in the schema cache' })).toBe(true);
        expect(isMissingSchemaError({ message: 'relation "public.lease_rent_periods" does not exist' })).toBe(true);
        expect(isMissingSchemaError({ message: 'relation "public.other" does not exist' })).toBe(false);
        expect(isMissingSchemaError({ code: '42501', message: 'permission denied' })).toBe(false);
        expect(isMissingSchemaError(null)).toBe(false);
    });
});

// --- Miete / Laufzeit -------------------------------------------------------------

describe('sumRent', () => {
    it('summiert alle vier Mietbestandteile, fehlende als 0', () => {
        // 712,35 + 180 + 95,15 + 0 = 987,50
        expect(sumRent({ cold_rent: '712.35', service_charge: 180, heating_cost: '95.15', other_costs: '' })).toBeCloseTo(987.5, 10);
        expect(sumRent(null)).toBe(0);
        expect(sumRent({})).toBe(0);
    });

    it('die Periodenfelder umfassen Mietbestandteile und Zahltag', () => {
        expect(RENT_PERIOD_FIELDS).toEqual(['cold_rent', 'service_charge', 'heating_cost', 'other_costs', 'payment_due_day']);
    });
});

describe('getLeaseTimeState', () => {
    const today = '2024-06-10';

    it('ohne Vertrag "none"', () => {
        expect(getLeaseTimeState(null, today)).toBe('none');
    });

    it('Enddatum gestern -> beendet; Enddatum heute -> läuft noch (letzter Miettag)', () => {
        expect(getLeaseTimeState({ start_date: '2020-01-01', end_date: '2024-06-09' }, today)).toBe('ended');
        expect(getLeaseTimeState({ start_date: '2020-01-01', end_date: '2024-06-10' }, today)).toBe('running');
    });

    it('gekündigt mit künftigem Enddatum läuft noch; beendet ohne Enddatum (Altdaten) gilt als beendet', () => {
        expect(getLeaseTimeState({ start_date: '2020-01-01', end_date: '2024-09-30', status: 'terminated' }, today)).toBe('running');
        expect(getLeaseTimeState({ start_date: '2020-01-01', end_date: null, status: 'ended' }, today)).toBe('ended');
        expect(getLeaseTimeState({ start_date: '2020-01-01', end_date: null, status: 'active' }, today)).toBe('running');
        expect(getLeaseTimeState({ start_date: '2020-01-01' }, today)).toBe('running'); // unbefristet, ohne Status
    });

    it('Mietbeginn morgen -> künftig; Mietbeginn heute -> läuft', () => {
        expect(getLeaseTimeState({ start_date: '2024-06-11' }, today)).toBe('future');
        expect(getLeaseTimeState({ start_date: '2024-06-10' }, today)).toBe('running');
    });
});

// --- Miethistorie: welche Periode gilt in Monat X ---------------------------------------

describe('getEffectivePeriod (Staffel-/Index-/Erhöhungsperioden)', () => {
    // Staffelmiete, aufsteigend sortiert (wie fetchRentPeriods sie liefert)
    const P1 = { id: 'p1', valid_from: '2022-03-01', cold_rent: 700 };
    const P2 = { id: 'p2', valid_from: '2023-03-01', cold_rent: 730 };
    const P3 = { id: 'p3', valid_from: '2024-03-15', cold_rent: 760 }; // Erhöhung mitten im Monat erfasst
    const periods = [P1, P2, P3];

    it('vor dem ersten Zeitraum gilt die Anfangsmiete', () => {
        expect(getEffectivePeriod(periods, '2022-02-15')).toBe(P1);
        expect(getEffectivePeriod(periods, '2010-01-01')).toBe(P1);
    });

    it('Stufe gilt ab ihrem Monat, der Vormonat (auch Monatsletzter) noch die alte Stufe', () => {
        expect(getEffectivePeriod(periods, '2022-03-01')).toBe(P1);
        expect(getEffectivePeriod(periods, '2023-02-28')).toBe(P1);
        expect(getEffectivePeriod(periods, '2023-03-01')).toBe(P2);
        expect(getEffectivePeriod(periods, '2024-02-29')).toBe(P2); // Schaltjahr, letzter Tag vor Stufe 3
    });

    it('monatsgenau: eine am 15. erfasste Änderung gilt für den ganzen Monat', () => {
        expect(getEffectivePeriod(periods, '2024-03-01')).toBe(P3);
        expect(getEffectivePeriod(periods, '2024-03')).toBe(P3);
    });

    it('letzte Stufe gilt unbefristet weiter (offenes Ende)', () => {
        expect(getEffectivePeriod(periods, '2024-12-31')).toBe(P3);
        expect(getEffectivePeriod(periods, '2035-01-01')).toBe(P3);
    });

    it('Indexmiete mit nur einer Anpassung und leere Historie', () => {
        const index = [{ id: 'i1', valid_from: '2024-01-01', cold_rent: 815.2 }];
        expect(getEffectivePeriod(index, '2023-06-01')).toBe(index[0]);
        expect(getEffectivePeriod(index, '2026-06-01')).toBe(index[0]);
        expect(getEffectivePeriod([], '2024-01-01')).toBeNull();
        expect(getEffectivePeriod(null, '2024-01-01')).toBeNull();
    });
});

describe('fetchRentPeriods', () => {
    it('liefert die Zeiträume aufsteigend nach valid_from abgefragt', async () => {
        const builders = mockTables({ lease_rent_periods: () => ({ data: [{ id: 'p1' }], error: null }) });
        expect(await fetchRentPeriods('L1')).toEqual({ supported: true, periods: [{ id: 'p1' }], error: null });
        expect(builders[0].q.calls).toContainEqual(['eq', 'lease_id', 'L1']);
        expect(builders[0].q.calls).toContainEqual(['order', 'valid_from', { ascending: true }]);
    });

    it('fehlende Tabelle -> supported false, sonstiger Fehler -> supported null', async () => {
        mockTables({ lease_rent_periods: () => ({ data: null, error: { code: '42P01' } }) });
        expect(await fetchRentPeriods('L1')).toEqual({ supported: false, periods: [], error: null });
        mockTables({ lease_rent_periods: () => ({ data: null, error: { code: '42501', message: 'denied' } }) });
        expect(await fetchRentPeriods('L1')).toEqual({ supported: null, periods: [], error: { code: '42501', message: 'denied' } });
    });
});

// --- Mietänderung speichern -------------------------------------------------------------

describe('saveRentPeriod', () => {
    const periods = [
        { id: 'p1', valid_from: '2024-01-15' }, // Anfangsmiete ab Mietbeginn 15.01.2024
        { id: 'p2', valid_from: '2024-07-01' }
    ];
    const values = { cold_rent: '800.50', service_charge: '150', heating_cost: '', other_costs: null, payment_due_day: '' };
    // Strings -> Zahlen, leere Felder -> 0, Zahltag leer -> 3
    const payload = { cold_rent: 800.5, service_charge: 150, heating_cost: 0, other_costs: 0, payment_due_day: 3 };

    const okHandlers = () => ({
        lease_rent_periods: (calls) => (calls[0][0] === 'update' ? { data: [{ id: 'x' }], error: null } : { error: null })
    });

    it('neue Mieterhöhung legt einen Zeitraum zum Monatsersten an', async () => {
        const builders = mockTables(okHandlers());
        const res = await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2024-10-20', leaseStartDate: '2024-01-15', values });
        expect(res).toEqual({ error: null, corrected: false });
        expect(builders[0].q.calls[0]).toEqual(['insert', [{ lease_id: 'L1', valid_from: '2024-10-01', ...payload }]]);
    });

    it('Änderung im Monat eines bestehenden Zeitraums passt diesen an', async () => {
        const builders = mockTables(okHandlers());
        const res = await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2024-07-10', leaseStartDate: '2024-01-15', values });
        expect(res).toEqual({ error: null, corrected: false });
        expect(builders[0].q.calls).toEqual([['update', payload], ['eq', 'id', 'p2'], ['select', 'id']]);
    });

    it('Monat am/vor dem ersten Zeitraum bzw. Mietbeginn korrigiert die Anfangsmiete', async () => {
        let builders = mockTables(okHandlers());
        expect(await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2024-01-20', leaseStartDate: '2024-01-15', values }))
            .toEqual({ error: null, corrected: true });
        expect(builders[0].q.calls[1]).toEqual(['eq', 'id', 'p1']);

        builders = mockTables(okHandlers());
        expect(await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2023-11-01', leaseStartDate: '2024-01-15', values }))
            .toEqual({ error: null, corrected: true });
        expect(builders[0].q.calls[1]).toEqual(['eq', 'id', 'p1']);
    });

    it('Update ohne betroffene Zeile (RLS) wird als Fehler gemeldet', async () => {
        mockTables({ lease_rent_periods: () => ({ data: [], error: null }) });
        const res = await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2024-07-01', leaseStartDate: '2024-01-15', values });
        expect(res.corrected).toBe(false);
        expect(res.error.message).toMatch(/keine Berechtigung/);
    });

    it('DB-Fehler wird durchgereicht', async () => {
        const dbError = { code: '23514', message: 'check violation' };
        mockTables({ lease_rent_periods: () => ({ data: null, error: dbError }) });
        const res = await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2024-01-01', leaseStartDate: '2024-01-15', values });
        expect(res).toEqual({ error: dbError, corrected: true });
    });

    it('vereinbarter Zahltag wird als Ganzzahl übernommen', async () => {
        const builders = mockTables(okHandlers());
        await saveRentPeriod({ leaseId: 'L1', periods, validFrom: '2025-01-01', leaseStartDate: '2024-01-15', values: { cold_rent: 900, payment_due_day: '15' } });
        expect(builders[0].q.calls[0][1][0]).toEqual({
            lease_id: 'L1', valid_from: '2025-01-01', cold_rent: 900, service_charge: 0, heating_cost: 0, other_costs: 0, payment_due_day: 15
        });
    });
});

describe('deleteRentPeriod', () => {
    it('Erfolg nur, wenn eine Zeile gelöscht wurde', async () => {
        mockTables({ lease_rent_periods: () => ({ data: [{ id: 'p2' }], error: null }) });
        expect(await deleteRentPeriod('p2')).toEqual({ error: null });
        mockTables({ lease_rent_periods: () => ({ data: [], error: null }) });
        expect((await deleteRentPeriod('p1')).error.message).toMatch(/Anfangsmiete oder keine Berechtigung/);
    });
});

// --- Löschen eines Mietverhältnisses ------------------------------------------------------

describe('checkLeaseDeletion', () => {
    const handlers = ({ payments = 0, claims = 0, ledger = [], error = null } = {}) => ({
        rent_payments: () => ({ count: payments, error }),
        claims: () => ({ count: claims, error: null }),
        rent_ledger: () => ({ data: ledger, error: null })
    });

    it('ohne Zahlungen, Forderungen und bearbeitete Sollstellungen löschbar', async () => {
        mockTables(handlers({ ledger: [{ paid_amount: 0, status: 'open' }, { paid_amount: '0.00', status: 'open' }] }));
        expect(await checkLeaseDeletion('L1')).toEqual({ ok: true, payments: 0, claims: 0, ledgerRows: 2, bookedLedger: 0, blocked: false });
    });

    it('bezahlte oder ausgebuchte Sollstellungen blockieren das Löschen', async () => {
        mockTables(handlers({ ledger: [{ paid_amount: '12.50' }, { paid_amount: 0, status: 'loss' }, { paid_amount: 0 }] }));
        const res = await checkLeaseDeletion('L1');
        expect(res.bookedLedger).toBe(2);
        expect(res.blocked).toBe(true);
    });

    it('Zahlungen oder Forderungen blockieren das Löschen', async () => {
        mockTables(handlers({ payments: 3 }));
        expect((await checkLeaseDeletion('L1')).blocked).toBe(true);
        mockTables(handlers({ claims: 1 }));
        expect((await checkLeaseDeletion('L1')).blocked).toBe(true);
    });

    it('Ladefehler -> ok false', async () => {
        const error = { code: '42501' };
        mockTables(handlers({ error }));
        expect(await checkLeaseDeletion('L1')).toEqual({ ok: false, error });
    });
});

describe('Lösch-Texte', () => {
    it('describeDeletionBlock nennt Anzahlen mit Singular/Plural', () => {
        expect(describeDeletionBlock({ payments: 1, claims: 2, bookedLedger: 3 })).toContain('(1 Mietzahlung, 2 Forderungen)');
        expect(describeDeletionBlock({ payments: 2, claims: 1, bookedLedger: 0 })).toContain('(2 Mietzahlungen, 1 Forderung)');
        // Sollstellungen nur ohne Zahlungen erwähnen (sonst doppelt gezählt)
        expect(describeDeletionBlock({ payments: 0, claims: 0, bookedLedger: 1 })).toContain('(1 bearbeitete Sollstellung)');
        expect(describeDeletionBlock({ payments: 0, claims: 0, bookedLedger: 4 })).toContain('(4 bearbeitete Sollstellungen)');
    });

    it('deletionConfirmText erwähnt automatisch erzeugte Sollstellungen nur, wenn vorhanden', () => {
        expect(deletionConfirmText({ ledgerRows: 1 })).toContain('1 automatisch erzeugte Sollstellung gelöscht');
        expect(deletionConfirmText({ ledgerRows: 12 })).toContain('12 automatisch erzeugte Sollstellungen gelöscht');
        expect(deletionConfirmText({ ledgerRows: 0 })).not.toContain('Sollstellung');
    });

    it('translateLeaseDeleteError übersetzt Fremdschlüssel-Verletzung (23503)', () => {
        expect(translateLeaseDeleteError({ code: '23503', message: 'fk' })).toMatch(/kann nicht gelöscht werden/);
        expect(translateLeaseDeleteError({ code: 23503 })).toMatch(/kann nicht gelöscht werden/);
        expect(translateLeaseDeleteError({ code: '42501', message: 'permission denied' })).toBe('permission denied');
        expect(translateLeaseDeleteError(null)).toBe('');
    });
});

// --- Überschneidung mit anderen Verträgen derselben Einheit --------------------------------

describe('findOverlappingLeases', () => {
    const unitLeases = [
        { id: 'L1', start_date: '2023-01-01', end_date: '2024-03-31', status: 'ended' },
        { id: 'L2', start_date: '2024-05-01', end_date: null, status: 'active' }, // unbefristet
        { id: 'L3', start_date: '2022-01-01', end_date: null, status: 'ended' }, // Altdaten: beendet ohne Enddatum
        { id: 'SELF', start_date: '2024-04-01', end_date: '2024-04-30', status: 'active' }
    ];
    const run = async (startDate, endDate, excludeLeaseId = 'SELF') => {
        const builders = mockTables({ leases: () => ({ data: unitLeases, error: null }) });
        const res = await findOverlappingLeases({ unitId: 'U1', startDate, endDate, excludeLeaseId });
        return { ids: res.overlaps.map(l => l.id), res, builders };
    };

    it('lückenlos anschließende Verträge überschneiden sich nicht (Ende 31.03., Beginn 01.04.)', async () => {
        const { ids, builders } = await run('2024-04-01', '2024-04-30');
        expect(ids).toEqual([]);
        expect(builders[0].q.calls).toContainEqual(['eq', 'unit_id', 'U1']);
    });

    it('gemeinsamer Tag zählt als Überschneidung (Grenzen inklusive)', async () => {
        expect((await run('2024-03-31', '2024-04-30')).ids).toEqual(['L1']);
        expect((await run('2024-04-15', '2024-05-01')).ids).toEqual(['L2']);
    });

    it('unbefristeter neuer Vertrag überschneidet sich mit unbefristetem Folgevertrag', async () => {
        expect((await run('2024-04-01', null)).ids).toEqual(['L2']);
    });

    it('beendete Altverträge ohne Enddatum zählen nicht; ohne Ausschluss zählt der eigene Vertrag mit', async () => {
        // 2022 läge im Zeitraum von L3 (ab 01.01.2022, ohne Ende), L3 ist aber als beendet markiert
        expect((await run('2022-06-01', '2022-12-31')).ids).toEqual([]);
        expect((await run('2024-04-10', '2024-04-20', null)).ids).toEqual(['SELF']);
    });

    it('Ladefehler wird zurückgegeben', async () => {
        const error = { code: '42501' };
        mockTables({ leases: () => ({ data: null, error }) });
        expect(await findOverlappingLeases({ unitId: 'U1', startDate: '2024-01-01', endDate: null })).toEqual({ error, overlaps: [] });
    });
});

describe('describeLease', () => {
    it('Name, Laufzeit und "unbefristet"', () => {
        expect(describeLease({ tenant: { first_name: 'Anna', last_name: 'Muster' }, start_date: '2024-01-01', end_date: null }))
            .toBe('Muster, Anna (01.01.2024 – unbefristet)');
        expect(describeLease({ start_date: '2023-02-01', end_date: '2024-12-31' }))
            .toBe('Ohne Mieter (01.02.2023 – 31.12.2024)');
    });
});

// --- Vorlagen-Daten -------------------------------------------------------------------------

describe('buildTemplateTenantData', () => {
    const property = { id: 'P1', portfolio_id: 'PF1', street: 'Hauptstr.', house_number: '5', zip: '10115', city: 'Berlin' };
    const lease = { id: 'L1', unit_id: 'U1', cold_rent: 0, service_charge: 150, start_date: '2024-01-01' };

    it('eigene Kontaktadresse des Mieters hat Vorrang', () => {
        const d = buildTemplateTenantData({
            lease, property, unit: { id: 'U9', unit_name: 'WE 3' },
            tenant: { first_name: 'Anna', last_name: 'Muster', street: 'Nebenweg', house_number: '7a', postal_code: '20095', city: 'Hamburg' }
        });
        expect([d.street, d.house_number, d.zip, d.city]).toEqual(['Nebenweg', '7a', '20095', 'Hamburg']);
        expect([d.objekt_strasse, d.objekt_plz, d.objekt_ort]).toEqual(['Hauptstr.', '10115', 'Berlin']);
        expect(d.unit_id).toBe('U1'); // Vertrag vor Einheit
        expect(d.einheit_name).toBe('WE 3');
    });

    it('ohne vollständige Mieteradresse wird die Objektadresse verwendet; 0 € bleibt 0', () => {
        const d = buildTemplateTenantData({ lease, property, tenant: { first_name: 'Ben', street: 'Nur Straße' } });
        expect([d.street, d.house_number, d.zip, d.city]).toEqual(['Hauptstr.', '5', '10115', 'Berlin']);
        expect(d.objekt_name).toBe('Hauptstr. 5');
        expect(d.cold_rent).toBe(0); // ?? statt ||: mietfreie Kaltmiete nicht leer
        expect(d.heating_cost).toBe('');
        expect(d.lease_type).toBe('normal');
        expect(d.end_date).toBeNull();
        expect([d.property_id, d.portfolio_id, d.lease_id]).toEqual(['P1', 'PF1', 'L1']);
    });

    it('Objektschlüssel hat Vorrang als Objektname; ohne Daten leere Werte', () => {
        expect(buildTemplateTenantData({ property: { ...property, object_key: 'MFH-01' } }).objekt_name).toBe('MFH-01');
        const empty = buildTemplateTenantData({});
        expect([empty.first_name, empty.street, empty.objekt_name, empty.unit_id, empty.lease_id]).toEqual(['', '', '', null, null]);
    });
});
