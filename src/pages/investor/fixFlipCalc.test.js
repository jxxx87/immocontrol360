/**
 * Unit-Tests der Fix-&-Flip-Rechenlogik (gemeinsam für Rechner und Deal-Ranking).
 * Reine Funktionen, kein Supabase/Netz.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_INPUTS, sanitizeInitialData, buildFixFlipInputs, computeFixFlip, getFixFlipRanking } from './fixFlipCalc';

const baseDeal = {
    purchasePrice: 200000, size: 80,
    notaryPercent: 2, brokerPercent: 0, taxPercent: 5,
    financing: 0, interestRate: 0, duration: 6,
    houseMoney: 0, electricity: 0, heating: 0,
    renovation: 20000, kitchen: 0, staging: 0, misc: 0,
    priceLowSqm: 3500, priceHighSqm: 4000,
    coldRentIst: 0, coldRentSoll: 0, targetYield: 5,
};

describe('sanitizeInitialData / buildFixFlipInputs', () => {
    it('macht Zahlenfelder zu Zahlen und ersetzt ungültige Werte durch den Standard', () => {
        const out = sanitizeInitialData({ purchasePrice: '150000', notaryPercent: '', size: -5, name: null });
        expect(out.purchasePrice).toBe(150000);
        expect(out.notaryPercent).toBe(DEFAULT_INPUTS.notaryPercent);
        expect(out.size).toBe(0);
        expect(out.name).toBe(DEFAULT_INPUTS.name);
    });

    it('ergänzt fehlende Felder mit Standardwerten', () => {
        const inputs = buildFixFlipInputs({ purchasePrice: 1000 });
        expect(inputs.purchasePrice).toBe(1000);
        expect(inputs.priceLowSqm).toBe(DEFAULT_INPUTS.priceLowSqm);
        expect(buildFixFlipInputs(null)).toEqual(DEFAULT_INPUTS);
    });
});

describe('computeFixFlip', () => {
    it('rechnet GIK, Verkaufspreise und Gewinne', () => {
        const { results } = computeFixFlip(buildFixFlipInputs(baseDeal));
        // Kaufpreis 200.000 + Notar 2 % (4.000) + GrESt 5 % (10.000) + Sanierung 20.000
        expect(results.totalInvest).toBe(234000);
        expect(results.sellPriceLow).toBe(280000);
        expect(results.sellPriceHigh).toBe(320000);
        expect(results.profitLow).toBe(46000);
        expect(results.profitHigh).toBe(86000);
    });
});

describe('getFixFlipRanking – aus den Eingaben neu berechnet', () => {
    it('Durchschnitt der positiven Gewinne (Kapitalanlage ohne Miete zählt nicht)', () => {
        expect(getFixFlipRanking(baseDeal)).toBe((46000 + 86000) / 2);
    });

    it('folgt einer geänderten Sanierungssumme in deal_data (Übernahme aus dem Sanierungsrechner)', () => {
        const before = getFixFlipRanking(baseDeal);
        const after = getFixFlipRanking({ ...baseDeal, renovation: 40000 });
        expect(after).toBe(before - 20000);
    });

    it('liefert 0 ohne positive Gewinne bzw. ohne Daten', () => {
        expect(getFixFlipRanking({ ...baseDeal, priceLowSqm: 0, priceHighSqm: 0 })).toBe(0);
        expect(getFixFlipRanking(null)).toBe(0);
        expect(getFixFlipRanking(undefined)).toBe(0);
    });
});
