import { describe, it, expect } from 'vitest';
import {
    DEFAULT_STOREY_HEIGHT_MM, DEFAULT_SLAB_THICKNESS_MM,
    storeyHeightMm, ceilingThicknessMm, storeyStackHeightMm, storeyBaseOffsetsMm, totalStackHeightMm,
} from './storeyStack';

describe('storeyStack', () => {
    it('Geschosshöhe: gültiger Wert oder Standard', () => {
        expect(storeyHeightMm({ height_mm: 2750 })).toBe(2750);
        expect(storeyHeightMm({ height_mm: 0 })).toBe(DEFAULT_STOREY_HEIGHT_MM);
        expect(storeyHeightMm({ height_mm: NaN })).toBe(DEFAULT_STOREY_HEIGHT_MM);
        expect(storeyHeightMm(null)).toBe(DEFAULT_STOREY_HEIGHT_MM);
    });

    it('Deckenstärke: nur Platten auf/über Geschosshöhe, größte Dicke', () => {
        const storey = {
            height_mm: 2600,
            slabs: [
                { ref_height_mm: -300, thickness_mm: 250 },  // Bodenplatte → zählt nicht
                { ref_height_mm: 2600, thickness_mm: 180 },
                { ref_height_mm: 2599.5, thickness_mm: 220 }, // innerhalb 1 mm Toleranz
                { ref_height_mm: 1200, thickness_mm: 400 },   // Zwischenebene → zählt nicht
            ],
        };
        expect(ceilingThicknessMm(storey)).toBe(220);
    });

    it('Deckenstärke: fehlende Dicke → Standarddicke, keine Decke → 0', () => {
        expect(ceilingThicknessMm({ height_mm: 2600, slabs: [{ ref_height_mm: 2600 }] })).toBe(DEFAULT_SLAB_THICKNESS_MM);
        expect(ceilingThicknessMm({ height_mm: 2600, slabs: [] })).toBe(0);
        expect(ceilingThicknessMm({ height_mm: 2600 })).toBe(0);
        expect(ceilingThicknessMm({ height_mm: 2600, slabs: [{ ref_height_mm: 'x', thickness_mm: 200 }] })).toBe(0);
    });

    it('Stapelung: nächstes Geschoss beginnt oberhalb der Decke', () => {
        const eg = { height_mm: 2600, slabs: [{ ref_height_mm: 2600, thickness_mm: 200 }] };
        const og = { height_mm: 2500 };
        const dg = { height_mm: 2400, slabs: [{ ref_height_mm: 2400, thickness_mm: 160 }] };
        expect(storeyStackHeightMm(eg)).toBe(2800);
        expect(storeyBaseOffsetsMm([eg, og, dg])).toEqual([0, 2800, 5300]);
        expect(totalStackHeightMm([eg, og, dg])).toBe(2800 + 2500 + 2560);
    });

    it('Stapelung ohne Decken entspricht der bisherigen Summe der Raumhöhen', () => {
        const list = [{ height_mm: 2600 }, { height_mm: 2500 }, {}];
        expect(storeyBaseOffsetsMm(list)).toEqual([0, 2600, 5100]);
        expect(storeyBaseOffsetsMm(null)).toEqual([]);
        expect(totalStackHeightMm(undefined)).toBe(0);
    });
});
