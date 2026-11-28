// Saldo eines einzelnen Mietvertrags (Prüfung vor der Mietschuldenfreiheitsbescheinigung)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: fromMock } }));

import { summarizeLeaseBalance, loadLeaseBalance } from './rentArrears';

// 1.000 € Gesamtmiete, ab 01.03.2024, Zahltag 3. Heute: 10.06.2024 → fällig: März bis Juni
const lease = {
    id: 'L1', start_date: '2024-03-01', end_date: null, created_at: '2024-03-01T10:00:00Z',
    cold_rent: 800, service_charge: 150, heating_cost: 50, other_costs: 0, payment_due_day: 3
};
const TODAY = new Date(2024, 5, 10);
const pay = (period_month, amount, lease_id = 'L1') => ({ lease_id, period_month, amount });
const allPaid = ['2024-03-01', '2024-04-01', '2024-05-01', '2024-06-01'].map(m => pay(m, 1000));

describe('summarizeLeaseBalance', () => {
    it('alles bezahlt → keine offenen Beträge', () => {
        const res = summarizeLeaseBalance({ lease, payments: allPaid, today: TODAY });
        expect(res.hasOpen).toBe(false);
        expect(res.rentOpen).toBe(0);
        expect(res.openMonths).toEqual([]);
        expect(res.claimsOpen).toBe(0);
    });

    it('offene Monate werden summiert (Toleranz 1 €)', () => {
        const payments = [pay('2024-03-01', 1000), pay('2024-04-01', 600), pay('2024-05-01', 999.5)];
        const res = summarizeLeaseBalance({ lease, payments, today: TODAY });
        // April 400 offen, Mai 0,50 (Toleranz), Juni 1.000 offen
        expect(res.openMonths).toEqual(['2024-04', '2024-06']);
        expect(res.rentOpen).toBe(1400);
        expect(res.hasOpen).toBe(true);
    });

    it('Zahlungen anderer Verträge zählen nicht', () => {
        const res = summarizeLeaseBalance({ lease, payments: allPaid.map(p => ({ ...p, lease_id: 'X' })), today: TODAY });
        expect(res.rentOpen).toBe(4000);
    });

    it('ausgebuchte Monate (loss) gelten als offen', () => {
        const ledgerRows = [{ id: 'r1', lease_id: 'L1', period_month: '2024-04-01', expected_rent: 1000, paid_amount: 200, status: 'loss' }];
        const payments = allPaid.filter(p => p.period_month !== '2024-04-01');
        const res = summarizeLeaseBalance({ lease, ledgerRows, payments, today: TODAY });
        expect(res.rentOpen).toBe(0);
        expect(res.writtenOffMonths).toEqual(['2024-04']);
        expect(res.writtenOffOpen).toBe(800);
        expect(res.hasOpen).toBe(true);
    });

    it('offene Forderungsakten werden getrennt ausgewiesen', () => {
        const res = summarizeLeaseBalance({ lease, payments: allPaid, claimTotals: [{ claim_id: 'c1', total_due: '250.40' }, { claim_id: 'c2', total_due: 0 }], today: TODAY });
        expect(res.claimsOpen).toBe(250.4);
        expect(res.openClaimCount).toBe(1);
        expect(res.rentOpen).toBe(0);
        expect(res.hasOpen).toBe(true);
    });

    it('Monate vor dem Buchungsbeginn werden nur gemeldet', () => {
        // Erfasst im Juni 2024, Mietbeginn Januar 2023 → Bestandsvertrag, Buchungsbeginn 2024-06
        const old = { ...lease, start_date: '2023-01-01', created_at: '2024-06-01T10:00:00Z' };
        const res = summarizeLeaseBalance({ lease: old, payments: [pay('2024-06-01', 1000)], today: TODAY });
        expect(res.rentOpen).toBe(0);
        expect(res.hiddenMonths).toBe(17);
        expect(res.bookingStartMonth).toBe('2024-06');
        expect(res.hasOpen).toBe(false);
    });
});

// Abfrage-Baustein: zeichnet Aufrufe auf, liefert beim Await das Ergebnis von resolve(table, calls)
const builder = (table, resolve) => {
    const calls = [];
    const q = { calls };
    ['select', 'eq', 'in', 'order', 'range', 'maybeSingle'].forEach(name => {
        q[name] = (...args) => { calls.push([name, ...args]); return q; };
    });
    q.then = (onFulfilled, onRejected) => Promise.resolve(resolve(table, calls)).then(onFulfilled, onRejected);
    return q;
};

describe('loadLeaseBalance', () => {
    beforeEach(() => fromMock.mockReset());

    const respond = (overrides = {}) => (table, calls) => {
        if (overrides[table]) return overrides[table](calls);
        if (table === 'leases') return { data: lease, error: null };
        if (table === 'rent_payments') return { data: allPaid, error: null, count: allPaid.length };
        if (table === 'claims') return { data: [{ id: 'c1', status: 'action_required' }, { id: 'c2', status: 'cancelled' }], error: null, count: 2 };
        if (table === 'claim_totals_view') return { data: [{ claim_id: 'c1', total_due: 120 }], error: null };
        return { data: [], error: null, count: 0 };
    };

    it('lädt nur den Vertrag und ignoriert stornierte Forderungsakten', async () => {
        const seen = [];
        fromMock.mockImplementation((table) => { const q = builder(table, respond()); seen.push([table, q]); return q; });
        const res = await loadLeaseBalance('L1', { today: TODAY });
        expect(res.error).toBe(null);
        expect(res.balance.rentOpen).toBe(0);
        expect(res.balance.claimsOpen).toBe(120);
        expect(res.balance.hasOpen).toBe(true);
        const totals = seen.find(([t]) => t === 'claim_totals_view')[1];
        expect(totals.calls).toContainEqual(['in', 'claim_id', ['c1']]);
        seen.filter(([t]) => ['rent_ledger', 'rent_payments', 'claims'].includes(t))
            .forEach(([, q]) => expect(q.calls).toContainEqual(['eq', 'lease_id', 'L1']));
    });

    it('Ladefehler → error, kein Saldo (nie stille Freigabe)', async () => {
        fromMock.mockImplementation((table) => builder(table, respond({ rent_payments: () => ({ data: null, error: { code: '500', message: 'kaputt' } }) })));
        const res = await loadLeaseBalance('L1', { today: TODAY });
        expect(res.balance).toBe(null);
        expect(res.error).toBeTruthy();
    });

    it('fehlende Beträge einer Forderungsakte → error', async () => {
        fromMock.mockImplementation((table) => builder(table, respond({ claim_totals_view: () => ({ data: [], error: null }) })));
        const res = await loadLeaseBalance('L1', { today: TODAY });
        expect(res.balance).toBe(null);
        expect(res.error).toBeTruthy();
    });

    it('ohne Vertrag → error', async () => {
        const res = await loadLeaseBalance(null);
        expect(res.balance).toBe(null);
        expect(res.error).toBeTruthy();
        expect(fromMock).not.toHaveBeenCalled();
    });
});
