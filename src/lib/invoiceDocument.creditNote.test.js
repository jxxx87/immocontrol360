// Unit-Tests: Gutschrift über die Datenbank-Funktion create_credit_note (Paket 13 INVOICES).
// Die Rechenlogik des bisherigen App-Wegs prüft invoiceDocument.test.js; hier geht es nur darum,
// wann die RPC genutzt wird und wann die App auf den bisherigen Weg zurückfällt.
// Keine Netzwerk-/Datenbankzugriffe: supabase wird durch einen Stub mit rpc() und from() ersetzt.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
    const state = {};
    const reset = () => {
        state.rpcCalls = [];
        state.queries = [];
        state.rpcHandler = () => ({ data: null, error: null, status: 200 });
    };
    const rpc = (name, args) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve().then(() => state.rpcHandler(name, args));
    };
    const from = (table) => {
        const q = { table, op: 'select', filters: [] };
        state.queries.push(q);
        const resolve = () => {
            if (q.op === 'insert') return { data: { id: 'neu-1', ...q.rows[0] }, error: null };
            if (q.op === 'update') return { data: [{ id: 'inv-1' }], error: null };
            return { data: [], error: null };
        };
        const b = {
            select: () => b,
            insert: (rows) => { q.op = 'insert'; q.rows = rows; return b; },
            update: (values) => { q.op = 'update'; q.values = values; return b; },
            delete: () => { q.op = 'delete'; return b; },
            eq: (col, val) => { q.filters.push(['eq', col, val]); return b; },
            like: () => b,
            order: () => b,
            range: () => b,
            single: () => b,
            then: (onOk, onErr) => Promise.resolve().then(resolve).then(onOk, onErr),
        };
        return b;
    };
    reset();
    return { state, rpc, from, reset };
});

vi.mock('./supabase', () => ({ supabase: { rpc: db.rpc, from: db.from } }));
vi.mock('./fontFaces', () => ({ openSansFontFaceCss: () => '', fontOrigin: () => 'http://localhost' }));

import { createCreditNote, INVOICE_STATUS } from './invoiceDocument';

beforeEach(() => db.reset());

const issued = (overrides = {}) => ({
    id: 'inv-1',
    user_id: 'u-1',
    portfolio_id: 'pf-1',
    status: INVOICE_STATUS.ISSUED,
    invoice_number: '2026-001',
    invoice_date: '2026-03-15',
    net_amount: 100, vat_amount: 7, gross_amount: 107,
    positions: [{ pos: 1, description: 'Übernachtung', netTotal: 100, vat: 7, grossTotal: 107, vatRate: 7 }],
    ...overrides,
});

describe('createCreditNote über create_credit_note', () => {
    it('ruft die RPC mit der Rechnungs-ID auf und liefert deren Gutschrift (ohne eigene Schreibzugriffe)', async () => {
        const row = { id: 'gs-1', status: INVOICE_STATUS.CREDIT_NOTE, invoice_number: '2026-002' };
        db.state.rpcHandler = () => ({ data: row, error: null, status: 200 });
        await expect(createCreditNote(issued())).resolves.toEqual(row);
        expect(db.state.rpcCalls).toEqual([{ name: 'create_credit_note', args: { p_invoice_id: 'inv-1' } }]);
        expect(db.state.queries).toHaveLength(0);
    });

    it('akzeptiert auch eine Zeilenliste als Antwort', async () => {
        db.state.rpcHandler = () => ({ data: [{ id: 'gs-2' }], error: null, status: 200 });
        await expect(createCreditNote(issued())).resolves.toEqual({ id: 'gs-2' });
    });

    it('meldet Fehler der Datenbank unverändert und fällt NICHT auf den App-Weg zurück', async () => {
        const err = { code: 'P0001', message: 'Eine Gutschrift kann nur zu einer ausgestellten Rechnung erstellt werden.' };
        db.state.rpcHandler = () => ({ data: null, error: err, status: 400 });
        await expect(createCreditNote(issued())).rejects.toBe(err);
        expect(db.state.queries).toHaveLength(0);
    });

    it('meldet eine leere Erfolgsantwort, statt eine zweite Gutschrift anzulegen', async () => {
        db.state.rpcHandler = () => ({ data: null, error: null, status: 200 });
        await expect(createCreditNote(issued())).rejects.toThrow(/Rechnungsliste neu/);
        expect(db.state.queries).toHaveLength(0);
    });

    it.each([
        ['PGRST202', { code: 'PGRST202', message: 'Could not find the function' }, 404],
        ['42883', { code: '42883', message: 'function does not exist' }, 404],
        ['HTTP 404', { code: '', message: 'Not Found' }, 404],
    ])('ohne eingespielte Funktion (%s): bisheriger Weg in der App', async (_label, err, status) => {
        db.state.rpcHandler = () => ({ data: null, error: err, status });
        const creditNote = await createCreditNote(issued());
        expect(creditNote.status).toBe(INVOICE_STATUS.CREDIT_NOTE);
        expect(creditNote.positions[0]).toMatchObject({ netTotal: -100, vat: -7, grossTotal: -107, refInvoiceId: 'inv-1' });
        const update = db.state.queries.find(q => q.op === 'update');
        expect(update.values).toEqual({ status: INVOICE_STATUS.CREDITED });
    });

    it('Rückfall in der App: Nummer der Gutschrift über get_next_invoice_number, wenn nur create_credit_note fehlt', async () => {
        db.state.rpcHandler = (name) => (name === 'get_next_invoice_number'
            ? { data: '2026-002', error: null, status: 200 }
            : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
        const creditNote = await createCreditNote(issued());
        expect(creditNote.invoice_number).toBe('2026-002');
        expect(db.state.rpcCalls.map(c => c.name)).toEqual(['create_credit_note', 'get_next_invoice_number']);
        expect(db.state.rpcCalls[1].args).toMatchObject({ p_portfolio_id: 'pf-1', p_object_unit_id: null });
        expect(db.state.queries.map(q => q.op)).toEqual(['insert', 'update']);
    });

    it('prüft den Status vor dem Aufruf', async () => {
        await expect(createCreditNote(issued({ status: INVOICE_STATUS.DRAFT }))).rejects.toThrow(/ausgestellten Rechnung/);
        await expect(createCreditNote(issued({ status: INVOICE_STATUS.CREDITED }))).rejects.toThrow(/ausgestellten Rechnung/);
        expect(db.state.rpcCalls).toHaveLength(0);
    });
});
