// Unit-Tests der Einheiten-Rotation im Objektkalender (Welle 7, C-10): nur vermietete Einheiten,
// Ferienwohnungen und leerstehende Einheiten werden übersprungen, ohne Verträge wie bisher reihum.
import { describe, it, expect } from 'vitest';
import { isLeaseActiveOn, buildOccupancyCheck, pickRotationUnit, anyUnitEligible } from './calendarRotation';

const units = [
    { id: 'u1', unit_name: 'EG links' },
    { id: 'u2', unit_name: 'EG rechts' },
    { id: 'u3', unit_name: 'OG' },
    { id: 'u4', unit_name: 'FeWo', is_vacation_rental: true },
];
const active = (start, end = null) => ({ status: 'active', start_date: start, end_date: end });

// Folge der zuständigen Einheiten für eine Liste von Terminen (wie generateCleaningEvents)
const rotate = (dates, isEligible, startIdx = 0) => {
    let idx = startIdx;
    return dates.map(iso => {
        const { unit, nextIdx } = pickRotationUnit(units, idx, iso, isEligible);
        if (unit) idx = nextIdx;
        return unit?.id || null;
    });
};

describe('isLeaseActiveOn', () => {
    it('Beginn und Ende inklusive, nur Status active', () => {
        expect(isLeaseActiveOn(active('2026-01-01'), '2026-01-01')).toBe(true);
        expect(isLeaseActiveOn(active('2026-01-01', '2026-06-30'), '2026-06-30')).toBe(true);
        expect(isLeaseActiveOn(active('2026-01-01', '2026-06-30'), '2026-07-01')).toBe(false);
        expect(isLeaseActiveOn(active('2026-02-01'), '2026-01-31')).toBe(false);
        expect(isLeaseActiveOn({ ...active('2026-01-01'), status: 'terminated' }, '2026-03-01')).toBe(false);
        expect(isLeaseActiveOn(null, '2026-03-01')).toBe(false);
    });
});

describe('pickRotationUnit', () => {
    it('ohne Prüfung wie bisher reihum über alle Einheiten (auch über das Listenende)', () => {
        expect(rotate(['a', 'b', 'c', 'd', 'e'], null)).toEqual(['u1', 'u2', 'u3', 'u4', 'u1']);
        expect(rotate(['a', 'b'], null, 3)).toEqual(['u4', 'u1']);
        expect(rotate(['a'], null, 7)).toEqual(['u4']);
    });

    it('überspringt leerstehende Einheiten und Ferienwohnungen, Reihenfolge bleibt', () => {
        const check = buildOccupancyCheck({
            u1: [active('2025-01-01')],
            u2: [],                                   // leer
            u3: [active('2025-01-01', '2026-12-31')], // Auszug Ende 2026
            u4: [active('2025-01-01')],               // Ferienwohnung zählt nicht
        });
        expect(rotate(['2026-11-02', '2026-11-16', '2026-12-07'], check)).toEqual(['u1', 'u3', 'u1']);
        // Nach dem Auszug ist nur noch u1 zuständig
        expect(rotate(['2027-01-04', '2027-01-18'], check)).toEqual(['u1', 'u1']);
        // Anker nach der zuletzt zuständigen Einheit (u1 → Start bei Index 1): nächste vermietete ist u3
        expect(rotate(['2026-11-02'], check, 1)).toEqual(['u3']);
    });

    it('Einzug mitten im Plan: Einheit kommt ab Vertragsbeginn dazu', () => {
        const check = buildOccupancyCheck({ u1: [active('2025-01-01')], u2: [active('2027-02-01')] });
        expect(rotate(['2027-01-04', '2027-01-18', '2027-02-01', '2027-02-15'], check)).toEqual(['u1', 'u1', 'u2', 'u1']);
    });

    it('an einem Tag ohne vermietete Einheit: keine Einheit, Rotation bleibt stehen', () => {
        const check = buildOccupancyCheck({ u1: [active('2027-01-01')] });
        expect(pickRotationUnit(units, 2, '2026-12-01', check)).toEqual({ unit: null, nextIdx: 2 });
        expect(pickRotationUnit([], 0, '2026-12-01', null)).toEqual({ unit: null, nextIdx: 0 });
    });

    it('Mietverträge nicht geladen → keine Prüfung', () => {
        expect(buildOccupancyCheck(null)).toBeNull();
    });
});

describe('anyUnitEligible', () => {
    it('erkennt, ob überhaupt eine Einheit an einem der Termine vermietet ist', () => {
        const none = buildOccupancyCheck({});
        expect(anyUnitEligible(units, ['2026-12-01', '2027-01-01'], none)).toBe(false);
        const some = buildOccupancyCheck({ u2: [active('2027-01-01')] });
        expect(anyUnitEligible(units, ['2026-12-01', '2027-01-01'], some)).toBe(true);
        expect(anyUnitEligible(units, ['2026-12-01'], null)).toBe(false);
    });
});
