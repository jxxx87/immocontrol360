// Unit-Tests für die Seitengeometrie in src/lib/htmlToPdf.js (gleiche Rechenwege wie html2pdf.js 0.10.x).
import { describe, it, expect } from 'vitest';
import { computeInnerPage, getPageSize, normalizeMargin } from './htmlToPdf';

describe('getPageSize', () => {
    it('A4 hochkant in mm wie jsPDF (595,28 × 841,89 pt)', () => {
        const size = getPageSize({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        expect(size.width).toBeCloseTo(210, 2);
        expect(size.height).toBeCloseTo(297, 2);
        expect(size.k).toBeCloseTo(72 / 25.4, 10);
    });

    it('Querformat tauscht Breite und Höhe', () => {
        const size = getPageSize({ unit: 'mm', format: 'a4', orientation: 'landscape' });
        expect(size.width).toBeCloseTo(297, 2);
        expect(size.height).toBeCloseTo(210, 2);
    });

    it('unbekannte Einheit oder unbekanntes Format ist ein Fehler', () => {
        expect(() => getPageSize({ unit: 'xx' })).toThrow(/Einheit/);
        expect(() => getPageSize({ format: 'b9' })).toThrow(/Papierformat/);
    });
});

describe('normalizeMargin', () => {
    it('Zahl, [vertikal, horizontal] und [oben, links, unten, rechts]', () => {
        expect(normalizeMargin(10)).toEqual([10, 10, 10, 10]);
        expect(normalizeMargin([5, 8])).toEqual([5, 8, 5, 8]);
        expect(normalizeMargin([20, 25, 20, 20])).toEqual([20, 25, 20, 20]);
        expect(() => normalizeMargin([1, 2, 3])).toThrow(/Randangabe/);
    });
});

describe('computeInnerPage', () => {
    it('A4 ohne Rand: 1122 px Seitenhöhe (abgerundet, Grundlage der 295-mm-Regel)', () => {
        const inner = computeInnerPage(getPageSize({ unit: 'mm', format: 'a4' }), normalizeMargin(0));
        expect(inner.px).toEqual({ width: 793, height: 1122 });
    });

    it('A4 mit Fließtext-Rand [20, 25, 20, 20] mm', () => {
        const inner = computeInnerPage(getPageSize({ unit: 'mm', format: 'a4' }), normalizeMargin([20, 25, 20, 20]));
        expect(inner.width).toBeCloseTo(165, 2);
        expect(inner.height).toBeCloseTo(257, 2);
        expect(inner.px.height).toBe(971);
        expect(inner.ratio).toBeCloseTo(257 / 165, 3);
    });
});
