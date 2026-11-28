// Gemeinsame Briefseiten-Stile: Präfix-Begrenzung für Rechnungen und Druckfenster
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scopeLetterCss } from './letterDocumentCss';

const letterPageCss = readFileSync(fileURLToPath(new URL('./letterPage.css', import.meta.url)), 'utf8');

describe('scopeLetterCss', () => {
    it('setzt den Container vor jeden Selektor einer Liste', () => {
        const out = scopeLetterCss('.a, .b > p { color: red; }', '.root');
        expect(out).toBe('.root .a, .root .b > p { color: red; }');
    });

    it('trennt nicht an Kommas in :has(...) oder Attributwerten', () => {
        const out = scopeLetterCss('.x:has(+ hr), [data-a="1,2"] .y { margin: 0; }', '.s');
        expect(out).toBe('.s .x:has(+ hr), .s [data-a="1,2"] .y { margin: 0; }');
    });

    it('entfernt Kommentare und verarbeitet minifiziertes CSS', () => {
        const out = scopeLetterCss('/* Kommentar */.a{width:1px!important}.b,.c{height:0}', '.r');
        expect(out).toBe('.r .a { width:1px!important }\n.r .b, .r .c { height:0 }');
    });

    it('lässt @-Regeln und leere Regeln weg', () => {
        expect(scopeLetterCss('@page { size: A4; } .a {}', '.r')).toBe('');
    });

    it('begrenzt die echte Briefseiten-Geometrie vollständig', () => {
        const out = scopeLetterCss(letterPageCss, '.ic-invoice-doc');
        const selectors = out.split('\n').map(rule => rule.slice(0, rule.indexOf('{')));
        expect(selectors.length).toBeGreaterThan(10);
        selectors.forEach(list => list.split(', ').forEach(sel => expect(sel.startsWith('.ic-invoice-doc ')).toBe(true)));
        expect(out).toContain('.ic-invoice-doc .letter-page { width: 210mm !important;');
        expect(out).toContain('.ic-invoice-doc .letter-sender:has(+ hr), .ic-invoice-doc .letter-sender:has(+ .editor-hr)');
        expect(out).toContain('.ic-invoice-doc .letter-footer {');
    });

    it('die Geometrie-Datei enthält keine @-Regeln (sonst greift die Begrenzung nicht)', () => {
        expect(letterPageCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/@/);
    });
});
