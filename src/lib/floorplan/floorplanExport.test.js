import { describe, it, expect } from 'vitest';
import { de, deText, generateQuantityList } from './floorplanExport';

// Massen-Panel im Editor und CSV/PDF-Export nutzen dieselbe Formatierung (W7 B-2)
describe('floorplanExport – deutsche Zahlenformatierung', () => {
    it('de: Dezimalkomma, zwei Nachkommastellen, nicht endliche Werte als 0,00', () => {
        expect(de(12.3)).toBe('12,30');
        expect(de(3.654)).toBe('3,65');
        expect(de(0)).toBe('0,00');
        expect(de(NaN)).toBe('0,00');
        expect(de(undefined)).toBe('0,00');
    });

    it('deText: toFixed-Text mit Komma, Platzhalter bleiben', () => {
        expect(deText('12.34')).toBe('12,34');
        expect(deText('24.0')).toBe('24,0');
        expect(deText('–')).toBe('–');
        expect(deText(null)).toBe('');
    });

    it('generateQuantityList: Wandfläche brutto und netto (Öffnungen abgezogen)', () => {
        const storey = {
            label: 'EG',
            height_mm: 2500,
            points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 4000, y: 0 }],
            walls: [{ id: 'w1', p1: 'a', p2: 'b', type: 'outer', thickness_mm: 300, height_mm: 2500 }],
            openings: [{ id: 'o1', wall_id: 'w1', type: 'window', width_mm: 1000, height_mm: 1000, sill_mm: 900 }],
            rooms: [],
            furniture: [],
        };
        const { totals } = generateQuantityList([storey]);
        expect(totals.wallArea_m2).toBe(10);
        expect(de(totals.wallArea_m2)).toBe('10,00');
        // netto = brutto (4 m × 2,5 m) minus Fensterfläche dieser Wand (1 m × 1 m)
        expect(totals.wallOpeningArea_m2).toBe(1);
        expect(totals.wallAreaNet_m2).toBe(9);
        expect(de(totals.wallAreaNet_m2)).toBe('9,00');
    });
});
