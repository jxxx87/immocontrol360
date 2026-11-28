import { describe, it, expect } from 'vitest';
import {
    MAX_PLAN_VERSIONS, stripBackgrounds, isValidVersionEntry, normalizeVersionHistory,
    createVersionEntry, addVersionEntry, restoreVersionPlanData, summarizePlanData,
} from './planVersions';

const plan = () => ([
    { id: 's1', label: 'EG', rooms: [{ id: 'r1' }, { id: 'r2' }], walls: [{ id: 'w1' }], bgImage: { path: 'p/s1-a.jpg', scale: 0.05 } },
    { id: 's2', label: 'OG', rooms: [], walls: [] },
]);

describe('planVersions', () => {
    it('entfernt Hintergrundbilder ohne das Original zu verändern', () => {
        const p = plan();
        const stripped = stripBackgrounds(p);
        expect(stripped[0].bgImage).toBeUndefined();
        expect(stripped[0].label).toBe('EG');
        expect(p[0].bgImage).toBeDefined();
        expect(stripBackgrounds(null)).toEqual([]);
        expect(stripBackgrounds([null, 5])).toEqual([null, 5]);
    });

    it('Eintrag anlegen und auf höchstens 5 begrenzen (neuester zuerst)', () => {
        let history = [{ foo: 1 }, null]; // ungültige Altlasten werden verworfen
        for (let i = 0; i < 7; i++) {
            history = addVersionEntry(history, createVersionEntry(plan(), { stand: `t${i}`, archivedAt: `a${i}` }));
        }
        expect(history).toHaveLength(MAX_PLAN_VERSIONS);
        expect(history[0].stand).toBe('t6');
        expect(history[4].stand).toBe('t2');
        expect(history.every(isValidVersionEntry)).toBe(true);
        expect(history[0].plan_data[0].bgImage).toBeUndefined();
        expect(normalizeVersionHistory('x')).toEqual([]);
    });

    it('Wiederherstellen behält die aktuellen Hintergrundbilder je Geschoss', () => {
        const current = plan();
        const version = [
            { id: 's1', label: 'EG alt', rooms: [], bgImage: { path: 'veraltet.jpg' } },
            { id: 's3', label: 'DG', rooms: [] },
        ];
        const restored = restoreVersionPlanData(current, version);
        expect(restored[0].label).toBe('EG alt');
        expect(restored[0].bgImage).toEqual({ path: 'p/s1-a.jpg', scale: 0.05 });
        expect(restored[1].bgImage).toBeUndefined();
        expect(restored).toHaveLength(2);
    });

    it('Zusammenfassung zählt Geschosse, Räume und Wände', () => {
        expect(summarizePlanData(plan())).toEqual({ storeys: 2, rooms: 2, walls: 1 });
        expect(summarizePlanData(undefined)).toEqual({ storeys: 0, rooms: 0, walls: 0 });
    });
});
