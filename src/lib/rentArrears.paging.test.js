// fetchAllRows: eindeutige Sortierspalte für Sichten ohne id (z. B. tenant_auth_info in TenantManagement.jsx)
import { describe, it, expect, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: fromMock } }));

import { fetchAllRows } from './rentArrears';

// Minimaler Abfrage-Baustein: zeichnet Aufrufe auf, liefert beim Await das Ergebnis von resolve(calls)
const queryBuilder = (resolve) => {
    const calls = [];
    const q = { calls };
    ['select', 'eq', 'order', 'range'].forEach(name => {
        q[name] = (...args) => { calls.push([name, ...args]); return q; };
    });
    q.then = (onFulfilled, onRejected) => Promise.resolve(resolve(calls)).then(onFulfilled, onRejected);
    return q;
};

describe('fetchAllRows (Sortierspalte)', () => {
    it('sortiert standardmäßig nach id und sonst nach der angegebenen Spalte', async () => {
        const builders = [];
        fromMock.mockImplementation(() => {
            const q = queryBuilder(() => ({ data: [{ tenant_id: 't1' }], error: null, count: 1 }));
            builders.push(q);
            return q;
        });

        await fetchAllRows('tenants', 'id');
        expect(builders[0].calls).toContainEqual(['order', 'id', { ascending: true }]);

        const res = await fetchAllRows('tenant_auth_info', '*', q => q.order('tenant_user_id'), 1000, 'tenant_id');
        expect(res).toEqual({ data: [{ tenant_id: 't1' }], error: null });
        const orders = builders[1].calls.filter(c => c[0] === 'order');
        expect(orders).toEqual([['order', 'tenant_user_id'], ['order', 'tenant_id', { ascending: true }]]);
        expect(builders[1].calls.some(c => c[0] === 'order' && c[1] === 'id')).toBe(false);
    });
});
