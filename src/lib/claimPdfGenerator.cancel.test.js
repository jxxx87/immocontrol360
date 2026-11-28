// Unit-Tests: Forderung stornieren / Forderungsausfall buchen (cancelClaim, Welle 7 A-6/B-48) und die
// Fehlertexte der Forderungs-RPCs (translateClaimError, A-12).
// Keine Netzwerk-/Datenbankzugriffe: supabase wird durch einen Stub mit rpc() und from() ersetzt.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
    const state = {};
    const reset = () => {
        state.rpcCalls = [];
        state.queries = [];
        state.rpcHandler = () => ({ data: null, error: null, status: 200 });
        state.queryHandler = (q) => {
            if (q.table === 'payment_plans' && q.op === 'select') return { data: [], error: null };
            if (q.op === 'update' && q.table === 'claims') return { data: [{ id: 'c-1' }], error: null };
            return { data: null, error: null };
        };
    };
    const rpc = (name, args) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve().then(() => state.rpcHandler(name, args));
    };
    const from = (table) => {
        const q = { table, op: 'select', filters: [] };
        state.queries.push(q);
        const b = {
            select: () => b,
            insert: (rows) => { q.op = 'insert'; q.rows = rows; return b; },
            update: (values) => { q.op = 'update'; q.values = values; return b; },
            eq: (col, val) => { q.filters.push(['eq', col, val]); return b; },
            in: (col, val) => { q.filters.push(['in', col, val]); return b; },
            then: (onOk, onErr) => Promise.resolve().then(() => state.queryHandler(q)).then(onOk, onErr),
        };
        return b;
    };
    reset();
    return { state, rpc, from, reset };
});

vi.mock('./supabase', () => ({ supabase: { rpc: db.rpc, from: db.from } }));
vi.mock('./fontFaces', () => ({ openSansFontFaceCss: () => '', fontOrigin: () => 'http://localhost' }));

import { cancelClaim, isMissingRpcError, translateClaimError, WRITE_OFF_ACTIVE_PLAN_MESSAGE } from './claimPdfGenerator';

beforeEach(() => db.reset());

const claim = { id: 'c-1', user_id: 'owner-1', status: 'open' };
const missingRpc = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.cancel_claim' }, status: 404 });

describe('cancelClaim über die Datenbank-Funktion cancel_claim', () => {
    it('ruft die RPC mit Grund und Ausfall-Kennzeichen auf und schreibt selbst nichts', async () => {
        const result = await cancelClaim({ claim, reason: '  Irrtum ', writeOff: false, userId: 'u-2' });
        expect(result).toEqual({ viaRpc: true, historySaved: true, historyError: null });
        expect(db.state.rpcCalls).toEqual([{ name: 'cancel_claim', args: { p_claim_id: 'c-1', p_reason: 'Irrtum', p_write_off: false } }]);
        expect(db.state.queries).toHaveLength(0);
    });

    it('übergibt p_write_off=true für den Forderungsausfall', async () => {
        await cancelClaim({ claim, reason: 'insolvent', writeOff: true });
        expect(db.state.rpcCalls[0].args.p_write_off).toBe(true);
    });

    it('meldet Fehler der Datenbank unverändert und fällt NICHT auf die Einzelschritte zurück', async () => {
        const err = { code: 'P0001', message: 'Forderung nicht gefunden oder keine Berechtigung.' };
        db.state.rpcHandler = () => ({ data: null, error: err, status: 400 });
        await expect(cancelClaim({ claim, reason: 'x' })).rejects.toBe(err);
        expect(db.state.queries).toHaveLength(0);
    });

    it('verlangt einen Grund (ohne Datenbankaufruf)', async () => {
        await expect(cancelClaim({ claim, reason: '   ' })).rejects.toThrow(/Stornierungsgrund/);
        await expect(cancelClaim({ claim, reason: '', writeOff: true })).rejects.toThrow(/Forderungsausfall/);
        expect(db.state.rpcCalls).toHaveLength(0);
    });
});

describe('cancelClaim ohne cancel_claim (älterer Datenbank-Stand)', () => {
    it('storniert in Einzelschritten: Ratenplan, Forderung (mit Prüfung), Portal-Link, Historie', async () => {
        db.state.rpcHandler = missingRpc;
        db.state.queryHandler = (q) => {
            if (q.table === 'payment_plans' && q.op === 'select') return { data: [{ id: 'p-1' }], error: null };
            if (q.table === 'claims' && q.op === 'update') return { data: [{ id: 'c-1' }], error: null };
            return { data: null, error: null };
        };
        const result = await cancelClaim({ claim, reason: 'Irrtum', userId: 'u-2' });
        expect(result).toEqual({ viaRpc: false, historySaved: true, historyError: null });
        const steps = db.state.queries.map(q => `${q.table}:${q.op}`);
        expect(steps).toEqual([
            'payment_plans:select',
            'payment_plan_installments:update',
            'payment_plans:update',
            'claims:update',
            'claim_access_links:update',
            'claim_events:insert'
        ]);
        const claimUpdate = db.state.queries.find(q => q.table === 'claims');
        expect(claimUpdate.values).toMatchObject({ status: 'cancelled', cancelled_by: 'u-2', cancellation_reason: 'Irrtum' });
        const event = db.state.queries.find(q => q.table === 'claim_events').rows[0];
        expect(event).toMatchObject({ user_id: 'owner-1', claim_id: 'c-1', event_type: 'cancelled', description: 'Forderung storniert' });
        expect(event.event_metadata).toMatchObject({ old_status: 'open', new_status: 'cancelled', reason: 'Irrtum', write_off: false, cancelled_payment_plan_ids: ['p-1'] });
    });

    it('Forderungsausfall: Grund mit Präfix, Verlauf als status_changed', async () => {
        db.state.rpcHandler = missingRpc;
        await cancelClaim({ claim, reason: 'insolvent', writeOff: true, userId: 'u-1' });
        const claimUpdate = db.state.queries.find(q => q.table === 'claims');
        expect(claimUpdate.values.cancellation_reason).toBe('Forderungsausfall: insolvent');
        const event = db.state.queries.find(q => q.table === 'claim_events').rows[0];
        expect(event).toMatchObject({ event_type: 'status_changed', description: 'Forderungsausfall gebucht' });
        expect(event.event_metadata.write_off).toBe(true);
    });

    it('Forderungsausfall bei laufendem Ratenplan wird abgelehnt, ohne etwas zu ändern', async () => {
        db.state.rpcHandler = missingRpc;
        db.state.queryHandler = (q) => (q.table === 'payment_plans' && q.op === 'select'
            ? { data: [{ id: 'p-1' }], error: null }
            : { data: null, error: null });
        await expect(cancelClaim({ claim, reason: 'x', writeOff: true })).rejects.toThrow(WRITE_OFF_ACTIVE_PLAN_MESSAGE);
        expect(db.state.queries.map(q => q.op)).toEqual(['select']);
    });

    it('0 geänderte Zeilen an der Forderung (keine Schreibberechtigung) -> Fehler, kein Link-/Historienschritt', async () => {
        db.state.rpcHandler = missingRpc;
        db.state.queryHandler = (q) => {
            if (q.table === 'payment_plans' && q.op === 'select') return { data: [], error: null };
            if (q.table === 'claims' && q.op === 'update') return { data: [], error: null };
            return { data: null, error: null };
        };
        await expect(cancelClaim({ claim, reason: 'x' })).rejects.toThrow(/keine Berechtigung/);
        expect(db.state.queries.some(q => q.table === 'claim_access_links' || q.table === 'claim_events')).toBe(false);
    });

    it('meldet einen fehlgeschlagenen Historien-Eintrag', async () => {
        db.state.rpcHandler = missingRpc;
        const eventErr = { message: 'RLS' };
        db.state.queryHandler = (q) => {
            if (q.table === 'payment_plans' && q.op === 'select') return { data: [], error: null };
            if (q.table === 'claims' && q.op === 'update') return { data: [{ id: 'c-1' }], error: null };
            if (q.table === 'claim_events') return { data: null, error: eventErr };
            return { data: null, error: null };
        };
        const result = await cancelClaim({ claim, reason: 'x' });
        expect(result).toEqual({ viaRpc: false, historySaved: false, historyError: eventErr });
    });
});

describe('isMissingRpcError', () => {
    it.each([
        ['PGRST202', { code: 'PGRST202' }, 404, true],
        ['42883', { code: '42883' }, 400, true],
        ['nur HTTP 404', { code: 'X' }, 404, true],
        ['Meldungstext', { message: 'Could not find the function public.cancel_claim' }, 400, true],
        ['anderer Fehler', { code: 'P0001', message: 'Keine Berechtigung.' }, 400, false],
        ['kein Fehler', null, 200, false]
    ])('%s', (_label, error, status, expected) => {
        expect(isMissingRpcError(error, status)).toBe(expected);
    });
});

describe('translateClaimError (Rechte-Texte der Forderungs-RPCs)', () => {
    it('übersetzt "… nicht gefunden oder keine Berechtigung." in einen Hinweis auf das Schreibrecht Finanzen', () => {
        expect(translateClaimError({ message: 'Forderung nicht gefunden oder keine Berechtigung.' }))
            .toMatch(/Schreibberechtigung für „Finanzen“/);
        expect(translateClaimError({ message: 'Mietvertrag nicht gefunden oder keine Berechtigung.' }))
            .toMatch(/Schreibberechtigung für „Finanzen“/);
    });

    it('nennt nicht mehr „nur vom Eigentümer“', () => {
        expect(translateClaimError({ message: 'Lease gehört Owner X' })).not.toMatch(/Eigentümer/);
    });

    it('lässt den Ratenplan-Hinweis des Forderungsausfalls unverändert', () => {
        expect(translateClaimError(new Error(WRITE_OFF_ACTIVE_PLAN_MESSAGE))).toBe(WRITE_OFF_ACTIVE_PLAN_MESSAGE);
    });
});
