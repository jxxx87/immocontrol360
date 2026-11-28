// Unit-Tests der reinen Rechen-/Formatierungslogik von invoiceDocument.js:
// Cent-Rundung, Steuersatz je Position, Summen je Steuersatz (19/7/0 %), Kleinunternehmer (§ 19 UStG),
// Gutschrift (negative Beträge), leere Rechnung, Betragsformat im Druck-HTML, Rechnungsnummern-Format
// und -Vergabe (get_next_invoice_number bzw. bisheriger Weg in der App).
// Keine Netzwerk-/Datenbankzugriffe: supabase wird durch einen Abfrage-/RPC-Stub ersetzt, fontFaces
// (braucht window.location) durch Konstanten. Kein DOM: in Node greifen die DOMParser-losen Pfade.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => {
    const state = {};
    // Voreinstellung: Datenbank-Funktionen fehlen (PostgREST PGRST202) -> die Tests prüfen den App-Weg
    const missingRpc = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    const reset = () => {
        state.queries = [];
        state.rpcCalls = [];
        state.rpcHandler = missingRpc;
        state.selectHandler = () => ({ data: [], error: null });
        state.counterHandler = () => ({ data: [], error: null });
        state.insertHandler = (rows) => ({ data: { id: 'neu-1', ...rows[0] }, error: null });
        state.updateHandler = () => ({ data: [{ id: 'orig-1' }], error: null });
    };
    const resolve = (q) => {
        if (q.op === 'insert') return state.insertHandler(q.rows, q);
        if (q.op === 'update') return state.updateHandler(q.values, q);
        if (q.op === 'delete') return { data: null, error: null };
        if (q.table === 'invoice_counters') return state.counterHandler(q);
        return state.selectHandler(q);
    };
    const rpc = (name, args) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve().then(() => state.rpcHandler(name, args));
    };
    const from = (table) => {
        const q = { table, op: 'select', filters: [], range: null };
        state.queries.push(q);
        const b = {
            select: () => b,
            insert: (rows) => { q.op = 'insert'; q.rows = rows; return b; },
            update: (values) => { q.op = 'update'; q.values = values; return b; },
            delete: () => { q.op = 'delete'; return b; },
            eq: (col, val) => { q.filters.push(['eq', col, val]); return b; },
            like: (col, val) => { q.filters.push(['like', col, val]); return b; },
            is: (col, val) => { q.filters.push(['is', col, val]); return b; },
            order: () => b,
            limit: () => b,
            range: (start, end) => { q.range = [start, end]; return b; },
            single: () => b,
            then: (onOk, onErr) => Promise.resolve().then(() => resolve(q)).then(onOk, onErr),
        };
        return b;
    };
    reset();
    return { state, from, rpc, reset, missingRpc };
});

vi.mock('./supabase', () => ({ supabase: { from: db.from, rpc: db.rpc } }));
vi.mock('./fontFaces', () => ({ openSansFontFaceCss: () => '', fontOrigin: () => 'http://localhost' }));

import {
    r2,
    getPositionVatRate,
    computeTaxBreakdown,
    isInvoiceSmallBusiness,
    isSmallBusinessPortfolio,
    hasSmallBusinessColumn,
    getInvoiceDocumentInfo,
    getInvoiceMissingFields,
    generateInvoiceHtml,
    fetchNextInvoiceNumber,
    insertInvoiceWithNumber,
    createCreditNote,
    parseLocalDate,
    formatDateDE,
    toLocalDateString,
    LEGACY_VAT_RATE,
    SMALL_BUSINESS_NOTE,
    INVOICE_STATUS,
} from './invoiceDocument';

beforeEach(() => db.reset());

// ─── Testdaten ───────────────────────────────────────────────────────
// Position wie InvoiceForm sie speichert (Basis Netto: USt = r2(Netto × Satz), Brutto = Netto + USt)
const pos = (pos, description, netTotal, vat, grossTotal, vatRate, extra = {}) =>
    ({ pos, description, netTotal, vat, grossTotal, vatRate, ...extra });

// Ferienwohnungs-Rechnung mit allen drei Sätzen:
//   Übernachtung 300,00 @ 7 % -> USt 21,00, Brutto 321,00 (§ 12 Abs. 2 Nr. 11 UStG, Beherbergung)
//   Endreinigung  50,00 @ 19 % -> USt  9,50, Brutto  59,50
//   Parkplatz     20,00 @ 19 % -> USt  3,80, Brutto  23,80
//   Kurtaxe       12,00 @ 0 %  -> USt  0,00, Brutto  12,00 (durchlaufender Posten)
const MIXED_POSITIONS = [
    pos(1, 'Übernachtung 7 Nächte', 300, 21, 321, 7),
    pos(2, 'Endreinigung', 50, 9.5, 59.5, 19),
    pos(3, 'Kurtaxe', 12, 0, 12, 0),
    pos(4, 'Parkplatz', 20, 3.8, 23.8, 19),
];

const PORTFOLIO = {
    id: 'pf-1', name: 'Fewo Seeblick', street: 'Seestraße', house_number: '5', zip: '23743', city: 'Grömitz',
    email: 'info@seeblick.example', phone: '04562 1234', iban: 'DE02120300000000202051', bic: 'BYLADEM1001',
    bank_name: 'Testbank', tax_number: '12/345/67890', vat_id: '', is_small_business: false,
};

const baseInvoice = (overrides = {}) => ({
    id: 'inv-1',
    portfolio_id: 'pf-1',
    status: INVOICE_STATUS.ISSUED,
    invoice_number: '2026-001',
    invoice_date: '2026-03-15',
    move_in: '2026-03-01',
    move_out: '2026-03-08',
    recipient_name: 'Erika Mustermann',
    recipient_street: 'Hauptstraße 1',
    recipient_zip: '10115',
    recipient_city: 'Berlin',
    positions: [],
    ...overrides,
});

const render = (inv, opts = {}) => generateInvoiceHtml(inv, { portfolios: [PORTFOLIO], ...opts });

// Betrag in der Zelle direkt hinter einer Summen-Beschriftung (Summenblock der Positionstabelle)
const valueAfter = (html, label) => {
    const marker = `>${label}</td>`;
    const i = html.indexOf(marker);
    if (i < 0) return null;
    const m = /^<td[^>]*>([^<]*)<\/td>/.exec(html.slice(i + marker.length));
    return m ? m[1] : null;
};

// ─── r2: kaufmännische Rundung auf Cent ──────────────────────────────
describe('r2 (Rundung auf Cent)', () => {
    it('lässt Beträge mit zwei Nachkommastellen unverändert', () => {
        expect(r2(19.99)).toBe(19.99);
        expect(r2(321)).toBe(321);
        expect(r2(0)).toBe(0);
    });

    it('rundet ab halbem Cent auf (kaufmännisch, DIN 1333)', () => {
        expect(r2(1.005)).toBe(1.01);
        expect(r2(0.125)).toBe(0.13);
        expect(r2(0.004)).toBe(0);
        expect(r2(0.005)).toBe(0.01);
        // 50,50 € Netto × 7 % = 3,535 € -> 3,54 €
        expect(r2(50.5 * 0.07)).toBe(3.54);
    });

    it('rundet halbe Cent auch bei Beträgen ab 2 € richtig (Binärdarstellung)', () => {
        // 2.135 * 100 ergibt binär 213.49999999999997 – kaufmännisch richtig ist 2,14
        expect(r2(2.135)).toBe(2.14);
        expect(r2(4.015)).toBe(4.02);
        expect(r2(1234.565)).toBe(1234.57);
        expect(r2(99999.995)).toBe(100000);
    });

    it('rundet negative Beträge (Gutschrift) spiegelbildlich: Betrag runden, Vorzeichen behalten', () => {
        expect(r2(-1.005)).toBe(-1.01);
        expect(r2(-0.125)).toBe(-0.13);
        expect(r2(-2.135)).toBe(-2.14);
        expect(r2(-19.99)).toBe(-19.99);
    });

    it('liefert für jeden halben Cent bis 1.000 € das richtige Ergebnis und r2(-x) === -r2(x)', () => {
        const wrong = [];
        for (let c = 0; c < 100000; c++) {
            const x = (c * 10 + 5) / 1000; // 0,005 · 0,015 · … · 999,995
            const expected = (c + 1) / 100; // jeweils auf den nächsten Cent aufgerundet
            if (r2(x) !== expected || r2(-x) !== -expected) wrong.push(x);
        }
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(wrong.length).toBe(0);
    });

    it('entfernt Gleitkomma-Rauschen aus Summen', () => {
        // 0.1 + 0.2 = 0.30000000000000004
        expect(r2(0.1 + 0.2)).toBe(0.3);
        expect(r2(0.1 + 0.1 + 0.1)).toBe(0.3);
    });

    it('liefert nie -0 (sonst Anzeige „-0,00 €")', () => {
        expect(Object.is(r2(-0.004), 0)).toBe(true);
        expect(Object.is(r2(-0), 0)).toBe(true);
    });

    it('behandelt fehlende/ungültige Werte als 0 und Zahlen als Text (Punkt) als Zahl', () => {
        expect(r2(null)).toBe(0);
        expect(r2(undefined)).toBe(0);
        expect(r2('')).toBe(0);
        expect(r2('abc')).toBe(0);
        expect(r2(NaN)).toBe(0);
        expect(r2(Infinity)).toBe(0);
        expect(r2('12.345')).toBe(12.35);
    });
});

// ─── Steuersatz je Position ──────────────────────────────────────────
describe('getPositionVatRate', () => {
    it('übernimmt den gespeicherten Satz 19/7/0 (auch als Text)', () => {
        expect(getPositionVatRate({ vatRate: 19 })).toBe(19);
        expect(getPositionVatRate({ vatRate: 7 })).toBe(7);
        expect(getPositionVatRate({ vatRate: '19' })).toBe(19);
    });

    it('lässt 0 % stehen (steuerfreie Position wird NICHT zum Altsatz 7 %)', () => {
        expect(getPositionVatRate({ vatRate: 0 })).toBe(0);
        expect(getPositionVatRate({ vatRate: '0' })).toBe(0);
    });

    it('nimmt für Altpositionen ohne Satz den bisherigen Festsatz 7 %', () => {
        expect(LEGACY_VAT_RATE).toBe(7);
        expect(getPositionVatRate({})).toBe(7);
        expect(getPositionVatRate({ vatRate: null })).toBe(7);
        expect(getPositionVatRate({ vatRate: '' })).toBe(7);
        expect(getPositionVatRate({ vatRate: 'abc' })).toBe(7);
        expect(getPositionVatRate(null)).toBe(7);
        expect(getPositionVatRate(undefined)).toBe(7);
    });

    it('setzt beim Kleinunternehmer (§ 19 UStG) immer 0 %', () => {
        expect(getPositionVatRate({ vatRate: 19 }, true)).toBe(0);
        expect(getPositionVatRate({ vatRate: 19, smallBusiness: true })).toBe(0);
        expect(getPositionVatRate({}, true)).toBe(0);
    });

    it('behält historische Sätze (16 %/5 % aus 2. Hj. 2020) bei, statt sie umzudeuten', () => {
        expect(getPositionVatRate({ vatRate: 16 })).toBe(16);
        expect(getPositionVatRate({ vatRate: 5 })).toBe(5);
    });
});

// ─── Kleinunternehmer-Erkennung ──────────────────────────────────────
describe('Kleinunternehmer-Erkennung', () => {
    it('erkennt § 19 nur am eingefrorenen Positionsmerkmal smallBusiness === true', () => {
        expect(isInvoiceSmallBusiness({ positions: [{ smallBusiness: true }] })).toBe(true);
        expect(isInvoiceSmallBusiness({ positions: [{ smallBusiness: 'true' }] })).toBe(false);
        expect(isInvoiceSmallBusiness({ positions: [] })).toBe(false);
        expect(isInvoiceSmallBusiness({ positions: null })).toBe(false);
        expect(isInvoiceSmallBusiness({ positions: [null, { smallBusiness: true }] })).toBe(true);
        expect(isInvoiceSmallBusiness(null)).toBe(false);
    });

    it('liest die Portfolio-Option strikt und erkennt eine fehlende Spalte', () => {
        expect(isSmallBusinessPortfolio({ is_small_business: true })).toBe(true);
        expect(isSmallBusinessPortfolio({ is_small_business: 'true' })).toBe(false);
        expect(isSmallBusinessPortfolio(null)).toBe(false);
        expect(hasSmallBusinessColumn({ is_small_business: false })).toBe(true);
        expect(hasSmallBusinessColumn({ name: 'x' })).toBe(false);
        expect(hasSmallBusinessColumn(null)).toBe(false);
    });
});

// ─── Summen je Steuersatz ────────────────────────────────────────────
describe('computeTaxBreakdown', () => {
    it('liefert für leere oder fehlende Positionen keine Gruppe', () => {
        expect(computeTaxBreakdown([])).toEqual([]);
        expect(computeTaxBreakdown()).toEqual([]);
        expect(computeTaxBreakdown(null)).toEqual([]);
        expect(computeTaxBreakdown('kein Array')).toEqual([]);
    });

    it('gruppiert 19/7/0 % und sortiert absteigend nach Satz', () => {
        // 19 %: Netto 50,00 + 20,00 = 70,00; USt 9,50 + 3,80 = 13,30; Brutto 59,50 + 23,80 = 83,30
        //  7 %: Netto 300,00; USt 21,00; Brutto 321,00
        //  0 %: Netto 12,00; USt 0,00; Brutto 12,00
        expect(computeTaxBreakdown(MIXED_POSITIONS)).toEqual([
            { rate: 19, net: 70, vat: 13.3, gross: 83.3 },
            { rate: 7, net: 300, vat: 21, gross: 321 },
            { rate: 0, net: 12, vat: 0, gross: 12 },
        ]);
    });

    it('USt je Satz = Satz × Netto je Satz, wenn die Positionen centgenau sind', () => {
        // 70,00 × 19 % = 13,30 ✓   300,00 × 7 % = 21,00 ✓
        computeTaxBreakdown(MIXED_POSITIONS).forEach(g => {
            expect(g.vat).toBe(r2(g.net * g.rate / 100));
            expect(g.gross).toBe(r2(g.net + g.vat));
        });
    });

    it('entspricht in Summe den Tabellenzeilen (Tabelle und Summenblock stimmen überein)', () => {
        const groups = computeTaxBreakdown(MIXED_POSITIONS);
        const sum = (key) => r2(groups.reduce((s, g) => s + g[key], 0));
        // Netto 382,00 = 300 + 50 + 12 + 20; USt 34,30 = 21 + 9,50 + 3,80; Brutto 416,30
        expect(sum('net')).toBe(382);
        expect(sum('vat')).toBe(34.3);
        expect(sum('gross')).toBe(416.3);
    });

    it('verrechnet einen Rabatt als negative Position im selben Steuersatz', () => {
        // 100,00 @ 19 % (19,00 / 119,00) + Rabatt -10,00 @ 19 % (-1,90 / -11,90)
        // -> Netto 90,00, USt 17,10 (= 90 × 19 %), Brutto 107,10
        const groups = computeTaxBreakdown([
            pos(1, 'Miete Stellplatz', 100, 19, 119, 19),
            pos(2, 'Rabatt 10 %', -10, -1.9, -11.9, 19),
        ]);
        expect(groups).toEqual([{ rate: 19, net: 90, vat: 17.1, gross: 107.1 }]);
    });

    it('führt eine reine Gutschrift mit negativen Beträgen spiegelbildlich zur Rechnung', () => {
        const negated = MIXED_POSITIONS.map(p => ({ ...p, netTotal: -p.netTotal, vat: -p.vat, grossTotal: -p.grossTotal }));
        expect(computeTaxBreakdown(negated)).toEqual([
            { rate: 19, net: -70, vat: -13.3, gross: -83.3 },
            { rate: 7, net: -300, vat: -21, gross: -321 },
            { rate: 0, net: -12, vat: 0, gross: -12 },
        ]);
    });

    it('summiert ohne Gleitkomma-Rest (3 × 0,10 € Netto)', () => {
        // 3 × 0,10 = 0,30 (nicht 0.30000000000000004); USt je Position r2(0,019) = 0,02 -> 0,06
        const groups = computeTaxBreakdown([1, 2, 3].map(i => pos(i, 'Kleinteil', 0.1, 0.02, 0.12, 19)));
        expect(groups).toEqual([{ rate: 19, net: 0.3, vat: 0.06, gross: 0.36 }]);
    });

    it('ordnet Altpositionen ohne Satz dem Festsatz 7 % zu', () => {
        const groups = computeTaxBreakdown([
            { netTotal: 100, vat: 7, grossTotal: 107 },
            pos(2, 'neu', 50, 3.5, 53.5, 7),
        ]);
        expect(groups).toEqual([{ rate: 7, net: 150, vat: 10.5, gross: 160.5 }]);
    });

    it('behandelt fehlende Beträge einer Position als 0', () => {
        expect(computeTaxBreakdown([{ vatRate: 19 }])).toEqual([{ rate: 19, net: 0, vat: 0, gross: 0 }]);
    });

    it('Kleinunternehmer: eine Gruppe 0 %, keine USt, Brutto = Positionsbetrag', () => {
        // 300,00 + 50,00 = 350,00; eine (veraltete) USt-Angabe in der Position wird ignoriert
        const groups = computeTaxBreakdown([
            { netTotal: 300, vat: 0, grossTotal: 300, vatRate: 0, smallBusiness: true },
            { netTotal: 50, vat: 9.5, grossTotal: 50, vatRate: 19, smallBusiness: true },
        ], true);
        expect(groups).toEqual([{ rate: 0, net: 350, vat: 0, gross: 350 }]);
    });

    it('Kleinunternehmer: fehlt der Bruttobetrag, gilt der Nettobetrag als Rechnungsbetrag', () => {
        expect(computeTaxBreakdown([{ netTotal: 80 }], true)).toEqual([{ rate: 0, net: 80, vat: 0, gross: 80 }]);
    });

    it('summiert die gespeicherte (je Position gerundete) USt – Tabelle = Summenblock', () => {
        // 2 × 1,03 € @ 19 %: USt je Position r2(0,1957) = 0,20 -> Summe 0,40
        const groups = computeTaxBreakdown([pos(1, 'A', 1.03, 0.2, 1.23, 19), pos(2, 'B', 1.03, 0.2, 1.23, 19)]);
        expect(groups).toEqual([{ rate: 19, net: 2.06, vat: 0.4, gross: 2.46 }]);
    });

    // BEFUND (fachlich zu klären, nicht geändert): Die USt je Steuersatz wird als Summe der je Position
    // gerundeten Steuerbeträge ermittelt (Kopfkommentar: „damit Tabelle und Summen übereinstimmen").
    // Nach § 14 Abs. 4 Nr. 8 UStG ist der „auf das Entgelt entfallende Steuerbetrag" auszuweisen;
    // auf die Nettosumme gerechnet wären es 2,06 × 19 % = 0,3914 -> 0,39 €, ausgewiesen werden 0,40 €
    // (Mehrbetrag ggf. nach § 14c Abs. 1 UStG geschuldet). Abweichung bis ±0,5 Cent je Position.
    // Positionsweise Rundung ist in der Praxis verbreitet und unionsrechtlich nicht verboten (EuGH C-302/07),
    // daher kein eindeutiger Fehler, sondern fachlich (Steuerberater) zu entscheiden.
    // Eine Umstellung müsste InvoiceForm (Summen, net/vat/gross_amount) und die Tabellenzeilen mitziehen.
    it.skip('BEFUND (fachlich zu klären): USt je Steuersatz auf die Nettosumme gerechnet (§ 14 Abs. 4 Nr. 8 UStG)', () => {
        const groups = computeTaxBreakdown([pos(1, 'A', 1.03, 0.2, 1.23, 19), pos(2, 'B', 1.03, 0.2, 1.23, 19)]);
        expect(groups[0].vat).toBe(0.39);
        expect(groups[0].gross).toBe(2.45);
    });
});

// ─── Summenblock und Hinweise im Druck-HTML ──────────────────────────
describe('generateInvoiceHtml – Summen, Betragsformat, Hinweise', () => {
    it('ein Steuersatz: Zwischensumme, USt-Zeile und Gesamtbetrag', () => {
        const html = render(baseInvoice({ positions: [pos(1, 'Übernachtung', 300, 21, 321, 7)] }));
        expect(valueAfter(html, 'Zwischensumme (Netto):')).toBe('300,00 €');
        expect(valueAfter(html, 'zzgl. 7 % USt.:')).toBe('21,00 €');
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('321,00 €');
        expect(html).not.toContain(SMALL_BUSINESS_NOTE);
    });

    it('mehrere Sätze: je Satz Entgelt und Steuerbetrag (§ 14 Abs. 4 Nr. 7/8 UStG), absteigend', () => {
        const html = render(baseInvoice({ positions: MIXED_POSITIONS }));
        expect(valueAfter(html, 'Summe Netto:')).toBe('382,00 €');
        expect(valueAfter(html, 'zzgl. 19 % USt. auf 70,00 €:')).toBe('13,30 €');
        expect(valueAfter(html, 'zzgl. 7 % USt. auf 300,00 €:')).toBe('21,00 €');
        expect(valueAfter(html, 'Umsatzsteuer 0 % auf 12,00 €:')).toBe('0,00 €');
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('416,30 €');
        const i19 = html.indexOf('zzgl. 19 %');
        const i7 = html.indexOf('zzgl. 7 %');
        const i0 = html.indexOf('Umsatzsteuer 0 %');
        expect(i19).toBeGreaterThan(-1);
        expect(i19).toBeLessThan(i7);
        expect(i7).toBeLessThan(i0);
    });

    it('stellt die Summen auch als Vorlagen-Platzhalter bereit (Netto/USt/Brutto)', () => {
        const html = render(baseInvoice({ positions: MIXED_POSITIONS }), {
            writingTemplates: { fewo_invoice_template: '<p>{netto_betrag}|{mwst_betrag}|{brutto_betrag}|{steuer_hinweis}</p>' },
        });
        // USt gesamt 13,30 + 21,00 + 0,00 = 34,30
        expect(html).toContain('<p>382,00 €|34,30 €|416,30 €|</p>');
    });

    it('formatiert Beträge deutsch mit Tausenderpunkt und Dezimalkomma', () => {
        const html = render(baseInvoice({ positions: [pos(1, 'Jahresmiete Lager', 12345.6, 2345.66, 14691.26, 19)] }));
        // 12.345,60 × 19 % = 2.345,664 -> 2.345,66; Brutto 14.691,26
        expect(valueAfter(html, 'Zwischensumme (Netto):')).toBe('12.345,60 €');
        expect(valueAfter(html, 'zzgl. 19 % USt.:')).toBe('2.345,66 €');
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('14.691,26 €');
    });

    it('Zeile und Summe runden einen unrunden Altbetrag gleich (2,135 -> 2,14)', () => {
        const html = render(baseInvoice({ positions: [pos(1, 'Altposition', 2.135, 0, 2.135, 0)] }));
        // Zeile: Netto und Gesamt je 2,14 €; Summenblock ebenfalls 2,14 € (nicht 2,13 €)
        expect(html.split('>2,14 €</td>').length - 1).toBe(4);
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('2,14 €');
        expect(html).not.toContain('2,13 €');
    });

    it('zeigt Beträge unter einem halben Cent als 0,00 € statt -0,00 €', () => {
        const html = render(baseInvoice({ positions: [pos(1, 'Rundungsrest', -0.004, 0, -0.004, 0)] }));
        expect(html).not.toContain('-0,00');
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('0,00 €');
    });

    it('Kleinunternehmer: § 19-Hinweis, keine USt-Zeile, Gesamtbetrag = Summe der Positionen', () => {
        const html = render(baseInvoice({
            positions: [
                { pos: 1, description: 'Übernachtung', netTotal: 300, vat: 0, grossTotal: 300, vatRate: 0, smallBusiness: true },
                { pos: 2, description: 'Endreinigung', netTotal: 50, vat: 0, grossTotal: 50, vatRate: 0, smallBusiness: true },
            ],
        }));
        expect(html).toContain(SMALL_BUSINESS_NOTE);
        expect(valueAfter(html, 'Gesamtbetrag:')).toBe('350,00 €');
        expect(html).not.toContain('USt.:');
        expect(html).not.toContain('Zwischensumme');
        expect(html).not.toContain('>Netto</th>');
    });

    it('Kleinunternehmer: Hinweis auch über den Platzhalter {steuer_hinweis}', () => {
        const html = render(baseInvoice({
            positions: [{ pos: 1, description: 'Übernachtung', netTotal: 300, vat: 0, grossTotal: 300, vatRate: 0, smallBusiness: true }],
        }), { writingTemplates: { fewo_invoice_template: '<p>{brutto_betrag}|{mwst_betrag}|{steuer_hinweis}</p>' } });
        expect(html).toContain(`<p>300,00 €|0,00 €|${SMALL_BUSINESS_NOTE}</p>`);
    });

    it('Gutschrift: negative Beträge, Beschriftung „Gutschriftsbetrag" und „Umsatzsteuer" statt „zzgl."', () => {
        const html = render(baseInvoice({
            status: INVOICE_STATUS.CREDIT_NOTE,
            invoice_number: '2026-002',
            invoice_date: '2026-03-20', // eigenes Gutschriftsdatum, verschieden vom Rechnungsdatum
            positions: [pos(1, 'Übernachtung', -300, -21, -321, 7, { refInvoiceId: 'inv-1', refInvoiceNumber: '2026-001', refInvoiceDate: '2026-03-15' })],
        }));
        expect(valueAfter(html, 'Zwischensumme (Netto):')).toBe('-300,00 €');
        expect(valueAfter(html, 'Umsatzsteuer 7 %:')).toBe('-21,00 €');
        expect(valueAfter(html, 'Gutschriftsbetrag (Brutto):')).toBe('-321,00 €');
        expect(html).not.toContain('zzgl.');
        // Bezug auf die Originalrechnung (Nummer und Datum) aus den Positionen, eigenes Datum im Kopf
        expect(html).toContain('Rechnung Nr. 2026-001 vom 15.03.2026');
        expect(html).toContain('Datum: <strong>20.03.2026</strong>');
    });

    it('leere Rechnung: Summen aus den Kopfbeträgen (Altbestand), Satz 7 %', () => {
        const html = render(baseInvoice({ positions: [], net_amount: 100, vat_amount: 7, gross_amount: 107 }));
        expect(valueAfter(html, 'Zwischensumme (Netto):')).toBe('100,00 €');
        expect(valueAfter(html, 'zzgl. 7 % USt.:')).toBe('7,00 €');
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('107,00 €');
    });

    it('leere Rechnung ohne Beträge: alles 0,00 €, kein Absturz bei fehlenden Positionen', () => {
        const html = render(baseInvoice({ positions: undefined }));
        expect(valueAfter(html, 'Zwischensumme (Netto):')).toBe('0,00 €');
        expect(valueAfter(html, 'zzgl. 7 % USt.:')).toBe('0,00 €');
        expect(valueAfter(html, 'Gesamtbetrag (Brutto):')).toBe('0,00 €');
    });

    it('zeigt den Leistungszeitraum deutsch formatiert und markiert ein fehlendes Datum', () => {
        expect(render(baseInvoice({ positions: MIXED_POSITIONS }))).toContain('01.03.2026 – 08.03.2026');
        expect(render(baseInvoice({ move_out: null }))).toContain('[Leistungszeitraum fehlt]');
    });

    it('nimmt die Steuernummer in die Hinweise auf, wenn die Vorlage sie nicht enthält', () => {
        const html = render(baseInvoice({ positions: MIXED_POSITIONS }), {
            writingTemplates: { fewo_invoice_template: '<p>{positions_tabelle}</p>' },
        });
        expect(html).toContain('Steuernummer: 12/345/67890');
    });
});

// ─── Belegart, Nummer, Dateiname ─────────────────────────────────────
describe('getInvoiceDocumentInfo', () => {
    it('ausgestellte Rechnung: Nummer unverändert, Dateiname mit bereinigtem Empfänger', () => {
        const info = getInvoiceDocumentInfo(baseInvoice({ recipient_name: 'Müller & Söhne GmbH' }));
        expect(info).toMatchObject({
            kind: 'invoice', label: 'Rechnung', number: '2026-001', isDraft: false, reference: null,
            titleBase: 'Rechnung_2026-001',
            // „&" entfällt, Leerzeichenfolgen -> „_", Umlaute bleiben
            filenameBase: 'Rechnung_2026-001_Müller_Söhne_GmbH',
        });
    });

    it('Entwurf (auch ohne Status) wird im Titel gekennzeichnet', () => {
        expect(getInvoiceDocumentInfo(baseInvoice({ status: 'draft' })).titleBase).toBe('Entwurf_Rechnung_2026-001');
        expect(getInvoiceDocumentInfo(baseInvoice({ status: undefined })).isDraft).toBe(true);
    });

    it('ohne Nummer: Platzhalter im Dateinamen', () => {
        const info = getInvoiceDocumentInfo(baseInvoice({ invoice_number: '  ', recipient_name: '' }));
        expect(info.number).toBe('');
        expect(info.filenameBase).toBe('Rechnung_ohne_Nummer');
    });

    it('Alt-Gutschrift: Nummer „GS-<Rechnungsnummer>" mit Bezug auf die Rechnung', () => {
        const info = getInvoiceDocumentInfo(baseInvoice({ status: 'credited' }), { legacyCredit: true });
        expect(info).toMatchObject({
            kind: 'credit_note', label: 'Gutschrift', number: 'GS-2026-001',
            reference: { id: 'inv-1', number: '2026-001', date: '2026-03-15' },
        });
        expect(getInvoiceDocumentInfo(baseInvoice({ invoice_number: '' }), { legacyCredit: true }).number).toBe('');
    });

    it('eigener Gutschrift-Beleg: eigene Nummer, Bezug aus den Positionen', () => {
        const info = getInvoiceDocumentInfo(baseInvoice({
            status: INVOICE_STATUS.CREDIT_NOTE, invoice_number: '2026-007',
            positions: [{ refInvoiceId: 'inv-1', refInvoiceNumber: '2026-001', refInvoiceDate: '2026-03-15' }],
        }));
        expect(info).toMatchObject({
            kind: 'credit_note', number: '2026-007', titleBase: 'Gutschrift_2026-007',
            reference: { id: 'inv-1', number: '2026-001', date: '2026-03-15' },
        });
    });
});

// ─── Pflichtangaben (§ 14 Abs. 4 UStG) ───────────────────────────────
describe('getInvoiceMissingFields', () => {
    it('vollständige Rechnung: nichts fehlt', () => {
        expect(getInvoiceMissingFields(baseInvoice(), PORTFOLIO)).toEqual([]);
    });

    it('Steuernummer ODER USt-IdNr. genügt', () => {
        expect(getInvoiceMissingFields(baseInvoice(), { ...PORTFOLIO, tax_number: '', vat_id: 'DE123456789' })).toEqual([]);
        expect(getInvoiceMissingFields(baseInvoice(), { ...PORTFOLIO, tax_number: '', vat_id: '' }))
            .toEqual(['Steuernummer oder USt-IdNr. (im Portfolio hinterlegen)']);
    });

    it('meldet fehlende Nummer, Datum, Leistungszeitraum und unvollständige Empfängeranschrift', () => {
        const missing = getInvoiceMissingFields(baseInvoice({
            invoice_number: '', invoice_date: null, move_in: '2026-03-01', move_out: '', recipient_zip: '',
        }), PORTFOLIO);
        expect(missing).toEqual([
            'Vollständige Anschrift des Rechnungsempfängers',
            'Rechnungsnummer',
            'Rechnungsdatum',
            'Leistungszeitraum (Anreise/Abreise)',
        ]);
    });

    it('IBAN ist nur für Rechnungen Pflicht, nicht für Gutschriften', () => {
        const noBank = { ...PORTFOLIO, iban: '' };
        expect(getInvoiceMissingFields(baseInvoice(), noBank)).toEqual(['Bankverbindung/IBAN (im Portfolio hinterlegen)']);
        expect(getInvoiceMissingFields(baseInvoice({ status: INVOICE_STATUS.CREDIT_NOTE }), noBank)).toEqual([]);
    });
});

// ─── Datum (lokal, nicht UTC) ────────────────────────────────────────
describe('Datumshilfen', () => {
    it('parst JJJJ-MM-TT als lokales Datum (kein UTC-Versatz am Monats-/Jahresanfang)', () => {
        const d = parseLocalDate('2026-01-01');
        expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 1]);
        expect(toLocalDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
        // Zeitstempel ohne Zone (lokal) -> Datumsteil. Zeitstempel MIT Zone (…Z) liest das Modul ebenfalls nur
        // am Datumsteil; kein Aufrufer übergibt solche Werte (nur date-Spalten), daher hier nicht festgeschrieben.
        expect(toLocalDateString(parseLocalDate('2026-03-31T23:30:00'))).toBe('2026-03-31');
    });

    it('formatiert den Schalttag und Monatsgrenzen deutsch', () => {
        expect(formatDateDE('2024-02-29')).toBe('29.02.2024');
        expect(formatDateDE('2026-12-31')).toBe('31.12.2026');
        expect(formatDateDE(null)).toBe('');
        expect(formatDateDE('kein Datum')).toBe('');
    });

    it('verschiebt ein unmögliches Datum nicht still auf einen anderen Tag', () => {
        // 29.02.2023 gibt es nicht (kein Schaltjahr) – new Date(2023, 1, 29) wäre der 01.03.2023
        expect(parseLocalDate('2023-02-29')).toBeNull();
        expect(parseLocalDate('2026-04-31')).toBeNull();
        expect(parseLocalDate('2026-13-01')).toBeNull();
        expect(formatDateDE('2023-02-29')).toBe('');
    });
});

// ─── Rechnungsnummer „JJJJ-NNN" je Portfolio ─────────────────────────
const numberRows = (numbers) => numbers.map((n, i) => ({ id: i + 1, invoice_number: n }));
// Stub für die seitenweise Abfrage: Seite = range-Start / 1000
const pages = (...pageList) => (q) => ({ data: pageList[q.range[0] / 1000] || [], error: null });

describe('fetchNextInvoiceNumber', () => {
    it('verlangt ein Portfolio (Nummernkreis je Portfolio)', async () => {
        await expect(fetchNextInvoiceNumber(null, '2026-03-15')).rejects.toThrow(/Portfolio/);
        expect(db.state.queries).toHaveLength(0);
    });

    it('beginnt jedes Jahr mit -001 und sucht nur im Portfolio und Jahr des Rechnungsdatums', async () => {
        expect(await fetchNextInvoiceNumber('pf-1', '2025-12-31')).toBe('2025-001');
        const [q, c] = db.state.queries;
        expect(q.table).toBe('invoices');
        expect(q.filters).toEqual([['eq', 'portfolio_id', 'pf-1'], ['like', 'invoice_number', '2025-%']]);
        expect(c.table).toBe('invoice_counters');
        expect(c.filters).toEqual([['eq', 'portfolio_id', 'pf-1'], ['eq', 'year', 2025]]);
        expect(await fetchNextInvoiceNumber('pf-1', '2027-01-01')).toBe('2027-001');
    });

    it('nur lesend: verbraucht keine Nummer (keine RPC, kein Schreibzugriff)', async () => {
        db.state.selectHandler = pages(numberRows(['2026-004']));
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-005');
        expect(db.state.rpcCalls).toHaveLength(0);
        expect(db.state.queries.every(q => q.op === 'select')).toBe(true);
    });

    it('berücksichtigt wie get_next_invoice_number einen höheren Zählerstand des Portfolios', async () => {
        db.state.selectHandler = pages(numberRows(['2026-004']));
        db.state.counterHandler = () => ({ data: [{ last_number: 12 }, { last_number: null }], error: null });
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-013');

        db.reset();
        db.state.selectHandler = pages(numberRows(['2026-009']));
        db.state.counterHandler = () => ({ data: [{ last_number: 2 }], error: null });
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-010');
    });

    it('meldet Fehler beim Lesen des Zählers', async () => {
        const error = { message: 'permission denied', code: '42501' };
        db.state.counterHandler = () => ({ data: null, error });
        await expect(fetchNextInvoiceNumber('pf-1', '2026-03-15')).rejects.toBe(error);
    });

    it('zählt fortlaufend weiter (Lücken zählen nicht, Maximum + 1)', async () => {
        db.state.selectHandler = pages(numberRows(['2026-001', '2026-009', '2026-003']));
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-010');
    });

    it('vergleicht numerisch: nach 2026-999 und 2026-1000 kommt 2026-1001', async () => {
        db.state.selectHandler = pages(numberRows(['2026-1000', '2026-999']));
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-1001');
    });

    it('ignoriert fremde Formate und andere Jahre, schneidet Leerzeichen ab', async () => {
        db.state.selectHandler = pages(numberRows(['GS-2026-050', '2026-07-A', '2025-080', null, ' 2026-012 ', '2026-004']));
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-013');
    });

    it('liest über die 1000er-Seitengrenze hinweg', async () => {
        const first = Array.from({ length: 1000 }, (_, i) => `2026-${String(i + 1).padStart(3, '0')}`);
        db.state.selectHandler = pages(numberRows(first), numberRows(['2026-1500']));
        expect(await fetchNextInvoiceNumber('pf-1', '2026-03-15')).toBe('2026-1501');
        expect(db.state.queries.filter(q => q.table === 'invoices').map(q => q.range)).toEqual([[0, 999], [1000, 1999]]);
    });

    it('meldet Abfragefehler, statt mit -001 neu zu beginnen', async () => {
        const error = { message: 'permission denied', code: '42501' };
        db.state.selectHandler = () => ({ data: null, error });
        await expect(fetchNextInvoiceNumber('pf-1', '2026-03-15')).rejects.toBe(error);
    });
});

describe('insertInvoiceWithNumber über get_next_invoice_number', () => {
    // Zähler der Datenbank-Funktion: jeder Aufruf vergibt die nächste Nummer
    const serverNumbers = (...numbers) => {
        let i = 0;
        db.state.rpcHandler = (name) => (name === 'get_next_invoice_number'
            ? { data: numbers[Math.min(i++, numbers.length - 1)], error: null, status: 200 }
            : db.missingRpc());
    };

    it('holt die Nummer beim Speichern serverseitig (Portfolio + Jahr des Rechnungsdatums), ohne selbst zu zählen', async () => {
        serverNumbers('2026-007');
        const saved = await insertInvoiceWithNumber({ portfolio_id: 'pf-1', unit_id: 'u-9', invoice_date: '2026-03-15', status: 'draft' });
        expect(saved.invoice_number).toBe('2026-007');
        expect(saved.status).toBe('draft');
        expect(db.state.rpcCalls).toEqual([{
            name: 'get_next_invoice_number',
            args: { p_portfolio_id: 'pf-1', p_object_unit_id: null, p_year: 2026 },
        }]);
        expect(db.state.queries.map(q => `${q.table}:${q.op}`)).toEqual(['invoices:insert']);
    });

    it('Jahr aus dem Rechnungsdatum (nicht aus dem heutigen Datum)', async () => {
        serverNumbers('2025-031');
        await insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2025-12-31' });
        expect(db.state.rpcCalls[0].args.p_year).toBe(2025);
    });

    it('holt bei einer Nummernkollision (23505) eine neue Nummer', async () => {
        serverNumbers('2026-005', '2026-006');
        let attempt = 0;
        db.state.insertHandler = (rows) => (attempt++ === 0
            ? { data: null, error: { code: '23505' } }
            : { data: { id: 'neu-1', ...rows[0] }, error: null });
        const saved = await insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2026-03-15' });
        expect(saved.invoice_number).toBe('2026-006');
        expect(db.state.rpcCalls).toHaveLength(2);
    });

    it('meldet Fehler der Funktion (z. B. keine Berechtigung) unverändert – ohne Rückfall und ohne Speichern', async () => {
        const err = { code: 'P0001', message: 'Portfolio nicht gefunden oder keine Berechtigung.' };
        db.state.rpcHandler = () => ({ data: null, error: err, status: 400 });
        await expect(insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2026-03-15' })).rejects.toBe(err);
        expect(db.state.queries).toHaveLength(0);
    });

    it('meldet eine leere Antwort, statt ohne Nummer zu speichern', async () => {
        db.state.rpcHandler = () => ({ data: '  ', error: null, status: 200 });
        await expect(insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2026-03-15' })).rejects.toThrow(/nicht vergeben/);
        expect(db.state.queries).toHaveLength(0);
    });

    it('verlangt ein Portfolio, bevor eine Nummer vergeben wird', async () => {
        serverNumbers('2026-001');
        await expect(insertInvoiceWithNumber({ portfolio_id: null, invoice_date: '2026-03-15' })).rejects.toThrow(/Portfolio/);
        expect(db.state.rpcCalls).toHaveLength(0);
        expect(db.state.queries).toHaveLength(0);
    });

    it.each([
        ['PGRST202', { code: 'PGRST202', message: 'Could not find the function' }, 404],
        ['42883', { code: '42883', message: 'function does not exist' }, 404],
        ['HTTP 404', { code: '', message: 'Not Found' }, 404],
    ])('ohne eingespielte Funktion (%s): bisheriger Weg in der App', async (_label, err, status) => {
        db.state.rpcHandler = () => ({ data: null, error: err, status });
        db.state.selectHandler = pages(numberRows(['2026-004']));
        const saved = await insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2026-03-15' });
        expect(saved.invoice_number).toBe('2026-005');
        expect(db.state.queries.map(q => `${q.table}:${q.op}`)).toEqual(['invoices:select', 'invoice_counters:select', 'invoices:insert']);
    });
});

describe('insertInvoiceWithNumber ohne get_next_invoice_number (bisheriger Weg)', () => {
    it('vergibt die Nummer beim Speichern', async () => {
        db.state.selectHandler = pages(numberRows(['2026-004']));
        const saved = await insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2026-03-15' });
        expect(saved.invoice_number).toBe('2026-005');
    });

    it('versucht es bei einer Nummernkollision (23505) erneut', async () => {
        let attempt = 0;
        db.state.selectHandler = () => ({ data: numberRows(attempt === 0 ? ['2026-004'] : ['2026-004', '2026-005']), error: null });
        db.state.insertHandler = (rows) => (attempt++ === 0
            ? { data: null, error: { code: '23505' } }
            : { data: { id: 'neu-1', ...rows[0] }, error: null });
        const saved = await insertInvoiceWithNumber({ portfolio_id: 'pf-1', invoice_date: '2026-03-15' });
        expect(saved.invoice_number).toBe('2026-006');
        expect(attempt).toBe(2);
    });

    it('bricht bei anderen Fehlern sofort ab und nach maxAttempts Kollisionen mit Meldung', async () => {
        const other = { code: '42501' };
        db.state.insertHandler = () => ({ data: null, error: other });
        await expect(insertInvoiceWithNumber({ portfolio_id: 'pf-1' })).rejects.toBe(other);

        db.reset();
        db.state.insertHandler = () => ({ data: null, error: { code: '23505' } });
        await expect(insertInvoiceWithNumber({ portfolio_id: 'pf-1' }, { maxAttempts: 3 }))
            .rejects.toThrow(/keine eindeutige Rechnungsnummer/);
        expect(db.state.queries.filter(q => q.op === 'insert')).toHaveLength(3);
    });
});

// ─── Gutschrift (Storno) aus einer ausgestellten Rechnung ────────────
describe('createCreditNote', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2027, 0, 5, 10, 0, 0)); // Storno im neuen Jahr
    });
    afterEach(() => vi.useRealTimers());

    const original = () => baseInvoice({
        user_id: 'u-1',
        invoice_date: '2026-12-30',
        net_amount: 370, vat_amount: 30.5, gross_amount: 400.5,
        positions: [
            { pos: 1, description: 'Übernachtung', netTotal: 300, vat: 21, grossTotal: 321, pricePerNight: 50, isFirst: true },
            pos(2, 'Endreinigung', 50, 9.5, 59.5, 19),
            pos(3, 'Kurtaxe', 20, 0, 20, 0),
            pos(4, 'Gratis-Frühstück', 0, 0, 0, 7),
        ],
    });

    const insertedPayload = () => db.state.queries.find(q => q.op === 'insert').rows[0];

    it('nur zu ausgestellten Rechnungen', async () => {
        await expect(createCreditNote(baseInvoice({ status: 'draft' }))).rejects.toThrow(/ausgestellten Rechnung/);
        await expect(createCreditNote(baseInvoice({ status: 'credited' }))).rejects.toThrow(/ausgestellten Rechnung/);
        expect(db.state.queries).toHaveLength(0);
    });

    it('negiert alle Beträge, friert den Steuersatz ein und setzt den Bezug', async () => {
        await createCreditNote(original());
        const p = insertedPayload();
        expect(p.status).toBe(INVOICE_STATUS.CREDIT_NOTE);
        expect([p.net_amount, p.vat_amount, p.gross_amount]).toEqual([-370, -30.5, -400.5]);
        expect(p.positions[0]).toMatchObject({
            vatRate: 7, // Altposition ohne Satz -> 7 % eingefroren
            netTotal: -300, vat: -21, grossTotal: -321, pricePerNight: -50,
            refInvoiceId: 'inv-1', refInvoiceNumber: '2026-001', refInvoiceDate: '2026-12-30',
        });
        expect(p.positions[1]).toMatchObject({ vatRate: 19, netTotal: -50, vat: -9.5, grossTotal: -59.5 });
        expect(p.positions[2]).toMatchObject({ vatRate: 0, netTotal: -20, vat: 0, grossTotal: -20 });
    });

    it('Nullbeträge bleiben 0 (nicht -0)', async () => {
        await createCreditNote(original());
        const free = insertedPayload().positions[3];
        ['netTotal', 'vat', 'grossTotal', 'pricePerNight'].forEach(k => expect(Object.is(free[k], 0)).toBe(true));
        expect(Object.is(insertedPayload().positions[2].vat, 0)).toBe(true);
    });

    it('Summen je Steuersatz der Gutschrift spiegeln die Rechnung centgenau', async () => {
        const inv = original();
        await createCreditNote(inv);
        const mirrored = computeTaxBreakdown(inv.positions).map(g => ({ rate: g.rate, net: -g.net, vat: g.vat ? -g.vat : 0, gross: -g.gross }));
        expect(computeTaxBreakdown(insertedPayload().positions)).toEqual(mirrored);
    });

    it('eigenes Datum und Nummer aus dem Nummernkreis des Storno-Jahres', async () => {
        await createCreditNote(original());
        const p = insertedPayload();
        expect(p.invoice_date).toBe('2027-01-05');
        expect(p.invoice_number).toBe('2027-001');
        expect(db.state.queries[0].filters).toContainEqual(['like', 'invoice_number', '2027-%']);
    });

    it('Kleinunternehmer-Rechnung: Gutschrift bleibt § 19 (0 %, Merkmal je Position)', async () => {
        await createCreditNote(baseInvoice({
            positions: [{ pos: 1, netTotal: 300, vat: 0, grossTotal: 300, vatRate: 19, smallBusiness: true }, { pos: 2, netTotal: 40, grossTotal: 40 }],
        }));
        insertedPayload().positions.forEach(p => expect(p).toMatchObject({ vatRate: 0, smallBusiness: true }));
    });

    it('markiert das Original als storniert; schlägt das fehl, wird die Gutschrift wieder gelöscht', async () => {
        await createCreditNote(original());
        const upd = db.state.queries.find(q => q.op === 'update');
        expect(upd.values).toEqual({ status: INVOICE_STATUS.CREDITED });
        expect(upd.filters).toEqual([['eq', 'id', 'inv-1'], ['eq', 'status', INVOICE_STATUS.ISSUED]]);

        db.reset();
        db.state.updateHandler = () => ({ data: [], error: null });
        await expect(createCreditNote(original())).rejects.toThrow(/keine Gutschrift erstellt/);
        const del = db.state.queries.find(q => q.op === 'delete');
        expect(del.filters).toEqual([['eq', 'id', 'neu-1'], ['eq', 'status', INVOICE_STATUS.CREDIT_NOTE]]);
    });
});
