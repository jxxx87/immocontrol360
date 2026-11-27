import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import {
    TrendingUp,
    TrendingDown,
    Wallet,
    Home,
    AlertCircle,
    Loader2
} from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import {
    num,
    toLocalDateStr,
    toMonthStr,
    parseDateOnly,
    buildRentIndex,
    computeArrears,
    filterExpensesByPortfolio,
    fetchAllRows,
    loadMahnverfahren,
    isMissingRelationError
} from '../lib/rentArrears';

const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const KPICard = (props) => {
    const { title, value, trend, trendValue, subtitle, icon: Icon, color, onClick } = props;
    return (
        <Card className="kpi-card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-sm)' }}>
                <div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>{title}</p>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</h3>
                </div>
                <div style={{
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: `${color}20`,
                    color: color
                }}>
                    <Icon size={24} />
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', flexWrap: 'wrap' }}>
                <span style={{
                    color: trend === 'up' ? 'var(--success-color)' : trend === 'down' ? 'var(--danger-color)' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    marginRight: '0.5rem',
                    fontWeight: 500
                }}>
                    {trend === 'up' ? <TrendingUp size={16} style={{ marginRight: 4 }} /> : trend === 'down' ? <TrendingDown size={16} style={{ marginRight: 4 }} /> : null}
                    {trendValue}
                </span>
                {subtitle && <span style={{ color: 'var(--text-secondary)' }}>{subtitle}</span>}
            </div>
        </Card>
    );
};

const formatCurrency = (val) => num(val).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Vormonat 0 -> kein Prozentwert; Basis ist der Betrag des Vormonats (auch bei negativen Werten)
const calcTrend = (current, previous) => {
    if (previous === 0 && current === 0) return { trend: 'neutral', value: '±0%' };
    if (previous === 0) return { trend: 'neutral', value: 'neu' };
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const sign = pct >= 0 ? '+' : '';
    return {
        trend: pct >= 0 ? 'up' : 'down',
        value: `${sign}${pct.toFixed(1)}%`
    };
};

const monthStartStr = (year, month0) => toLocalDateStr(new Date(year, month0, 1));

const Dashboard = () => {
    const { user } = useAuth();
    const userId = user?.id;
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [warnings, setWarnings] = useState([]);
    const [data, setData] = useState(null);
    const requestIdRef = useRef(0);

    // Daten werden portfolio-unabhängig geladen und im Speicher gefiltert: ein Portfoliowechsel braucht
    // keinen neuen Request, und ältere Antworten können neuere nicht überschreiben (Request-Zähler).
    const fetchDashboardData = useCallback(async () => {
        if (!userId) return;
        const requestId = ++requestIdRef.current;
        try {
            const now = new Date();
            // Zeitraum für Diagramm (6 Monate) und Vormonatsvergleich
            const windowStart = monthStartStr(now.getFullYear(), now.getMonth() - 5);
            const paymentCols = 'id, lease_id, payment_date, period_month, amount, note';
            const expenseCols = 'id, booking_date, payee, note, amount, property_id, expense_categories(name)';

            const [propRes, unitRes, leaseRes, ledgerRes, payRes, expRes, recentPayRes, recentExpRes, tenantRes] = await Promise.all([
                fetchAllRows('properties', 'id, portfolio_id'),
                fetchAllRows('units', 'id, property_id, is_vacation_rental'),
                fetchAllRows('leases', '*'),
                fetchAllRows('rent_ledger', 'id, lease_id, period_month, due_date, expected_rent, paid_amount, status'),
                fetchAllRows('rent_payments', paymentCols, q => q.gte('payment_date', windowStart)),
                fetchAllRows('expenses', expenseCols, q => q.gte('booking_date', windowStart)),
                supabase.from('rent_payments').select(paymentCols).order('payment_date', { ascending: false }).order('created_at', { ascending: false }).limit(50),
                supabase.from('expenses').select(expenseCols).order('booking_date', { ascending: false }).order('created_at', { ascending: false }).limit(50),
                fetchAllRows('tenants', 'id, first_name, last_name')
            ]);
            if (requestId !== requestIdRef.current) return;

            const firstError = [propRes, unitRes, leaseRes, payRes, expRes, recentPayRes, recentExpRes, tenantRes].find(r => r.error)?.error;
            if (firstError) throw firstError;

            const nextWarnings = [];
            let ledger = [];
            if (ledgerRes.error) {
                if (!isMissingRelationError(ledgerRes.error)) {
                    nextWarnings.push('Mietkonto nicht verfügbar – Rückstände werden aus den Mietverträgen berechnet.');
                }
            } else {
                ledger = ledgerRes.data || [];
            }

            const mahn = await loadMahnverfahren(ledger);
            if (requestId !== requestIdRef.current) return;
            if (mahn.error) nextWarnings.push('Mahnstatus konnte nicht geladen werden – Monate im Mahnverfahren können als offen zählen.');

            const dedupe = (a, b) => {
                const map = new Map();
                [...(a || []), ...(b || [])].forEach(r => map.set(r.id, r));
                return [...map.values()];
            };

            setData({
                properties: propRes.data || [],
                units: unitRes.data || [],
                leases: leaseRes.data || [],
                ledger,
                payments: dedupe(payRes.data, recentPayRes.data),
                expenses: dedupe(expRes.data, recentExpRes.data),
                tenants: tenantRes.data || [],
                mahnKeys: mahn.keys
            });
            setWarnings(nextWarnings);
            setLoadError(null);
        } catch (error) {
            if (requestId !== requestIdRef.current) return;
            console.error('Dashboard fetch error:', error);
            setLoadError(translateError(error));
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    const ownPortfolioIds = useMemo(
        () => (portfolios || []).filter(p => p.user_id === userId).map(p => p.id),
        [portfolios, userId]
    );

    const view = useMemo(() => {
        if (!data) return null;
        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth(); // 0-indexed
        const todayStr = toLocalDateStr(now);
        const currentMonth = toMonthStr(now);
        const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
        const lastMonth = toMonthStr(lastMonthDate);
        // Vergleich bis zum gleichen Tag des Vormonats (laufender Monat ist unvollständig)
        const daysInLastMonth = new Date(thisYear, thisMonth, 0).getDate();
        const compareDay = Math.min(now.getDate(), daysInLastMonth);
        const lastMonthCompareEnd = toLocalDateStr(new Date(thisYear, thisMonth - 1, compareDay));

        const pid = selectedPortfolioID;
        const propertyPortfolio = new Map(data.properties.map(p => [p.id, p.portfolio_id]));
        const unitById = new Map(data.units.map(u => [u.id, u]));
        const unitPortfolio = (unitId) => propertyPortfolio.get(unitById.get(unitId)?.property_id);
        const leaseById = new Map(data.leases.map(l => [l.id, l]));

        const units = pid ? data.units.filter(u => propertyPortfolio.get(u.property_id) === pid) : data.units;
        const leases = pid ? data.leases.filter(l => unitPortfolio(l.unit_id) === pid) : data.leases;
        const payments = pid
            ? data.payments.filter(p => { const l = leaseById.get(p.lease_id); return l && unitPortfolio(l.unit_id) === pid; })
            : data.payments;
        const includeUnassigned = !pid || (ownPortfolioIds.length === 1 && ownPortfolioIds[0] === pid);
        const { list: expenses } = filterExpensesByPortfolio(data.expenses, { selectedPortfolioID: pid, propertyPortfolio, includeUnassigned });

        // --- Einnahmen / Ausgaben: einheitlich nach Zahl- bzw. Buchungsdatum ---
        const sumIn = (list, dateField, from, to) => list
            .filter(r => r[dateField] && r[dateField] >= from && r[dateField] <= to)
            .reduce((sum, r) => sum + num(r.amount), 0);
        const currentStart = `${currentMonth}-01`;
        const currentEnd = `${currentMonth}-31`;
        const lastStart = `${lastMonth}-01`;

        const incomeThisMonth = sumIn(payments, 'payment_date', currentStart, currentEnd);
        const expensesThisMonth = sumIn(expenses, 'booking_date', currentStart, currentEnd);
        const incomeTrend = calcTrend(
            sumIn(payments, 'payment_date', currentStart, todayStr),
            sumIn(payments, 'payment_date', lastStart, lastMonthCompareEnd)
        );
        const expenseTrend = calcTrend(
            sumIn(expenses, 'booking_date', currentStart, todayStr),
            sumIn(expenses, 'booking_date', lastStart, lastMonthCompareEnd)
        );

        // --- Leerstand (Ferienwohnungen getrennt, nicht in der Quote) ---
        const vacationUnits = units.filter(u => u.is_vacation_rental).length;
        const rentableUnits = units.filter(u => !u.is_vacation_rental);
        let occupied = 0;
        rentableUnits.forEach(unit => {
            const hasActiveLease = leases.some(l =>
                l.unit_id === unit.id &&
                l.status === 'active' &&
                l.start_date <= todayStr &&
                (!l.end_date || l.end_date >= todayStr)
            );
            if (hasActiveLease) occupied++;
        });

        // --- Offene Forderungen: gleiche Rückstandslogik wie Finanzen ("Überfällige Mieten") ---
        const index = buildRentIndex({ ledgerRows: data.ledger, payments: data.payments });
        const arrears = computeArrears({ leases, index, mahnKeys: data.mahnKeys, today: now });

        // --- Letzte Buchungen ---
        const tenantById = new Map(data.tenants.map(t => [t.id, t]));
        const recentBookings = [
            ...expenses.map(e => ({
                id: `exp-${e.id}`,
                date: e.booking_date,
                text: e.payee || e.expense_categories?.name || 'Ausgabe',
                note: e.note || '',
                amount: num(e.amount),
                status: 'expense'
            })),
            ...payments.map(r => {
                const lease = leaseById.get(r.lease_id);
                const t = lease?.tenant_id ? tenantById.get(lease.tenant_id) : null;
                const name = t ? [t.last_name, t.first_name].filter(Boolean).join(', ') : '';
                return {
                    id: `inc-${r.id}`,
                    date: r.payment_date,
                    text: name ? `Mieteingang ${name}` : 'Mieteinnahme',
                    note: r.note || '',
                    amount: num(r.amount),
                    status: 'income'
                };
            })
        ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 10);

        // --- Chart Data (last 6 months) ---
        const chartData = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(thisYear, thisMonth - i, 1);
            const prefix = toMonthStr(d);
            const einnahmen = sumIn(payments, 'payment_date', `${prefix}-01`, `${prefix}-31`);
            const ausgaben = sumIn(expenses, 'booking_date', `${prefix}-01`, `${prefix}-31`);
            chartData.push({ name: MONTH_NAMES[d.getMonth()], einnahmen: Math.round(einnahmen), ausgaben: Math.round(ausgaben) });
        }

        return {
            incomeThisMonth,
            expensesThisMonth,
            incomeTrend,
            expenseTrend,
            compareDay,
            totalUnits: rentableUnits.length,
            vacantUnits: rentableUnits.length - occupied,
            vacationUnits,
            overdueRent: arrears.totalOverdue,
            overdueHiddenAmount: arrears.hidden.amount,
            recentBookings,
            chartData
        };
    }, [data, selectedPortfolioID, ownPortfolioIds]);

    const bookingColumns = [
        { header: 'Datum', accessor: 'date', render: row => { const d = parseDateOnly(row.date); return d ? d.toLocaleDateString('de-DE') : '-'; } },
        { header: 'Buchungstext', accessor: 'text' },
        {
            header: 'Betrag',
            accessor: 'amount',
            align: 'right',
            render: (row) => (
                <span style={{
                    color: row.status === 'income' ? 'var(--success-color)' : 'var(--danger-color)',
                    fontWeight: 600
                }}>
                    {row.status === 'income' ? '+' : '-'}{row.amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </span>
            )
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => (
                <Badge variant={row.status === 'income' ? 'success' : 'danger'}>
                    {row.status === 'income' ? 'Einnahme' : 'Ausgabe'}
                </Badge>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    if (loadError || !view) {
        return (
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700 }}>Dashboard</h1>
                </div>
                <Card>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px', gap: '16px', textAlign: 'center' }}>
                        <AlertCircle size={40} color="#E53E3E" />
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Kennzahlen konnten nicht geladen werden</h3>
                        <p style={{ color: 'var(--text-secondary)', maxWidth: '560px' }}>{loadError || 'Keine Daten verfügbar.'}</p>
                        <Button onClick={() => { setLoading(true); fetchDashboardData(); }}>Erneut laden</Button>
                    </div>
                </Card>
            </div>
        );
    }

    const {
        incomeThisMonth, expensesThisMonth, incomeTrend, expenseTrend, compareDay,
        totalUnits, vacantUnits, vacationUnits, overdueRent, overdueHiddenAmount, recentBookings, chartData
    } = view;
    const occupancyPct = totalUnits > 0 ? Math.round(((totalUnits - vacantUnits) / totalUnits) * 100) : 0;
    const compareLabel = `vs. Vormonat (1.–${compareDay}.)`;

    const kpis = [
        { title: 'Gesamteinnahmen', value: formatCurrency(incomeThisMonth), trend: incomeTrend.trend, trendValue: incomeTrend.value, subtitle: compareLabel, icon: Wallet, color: '#0066CC', onClick: () => navigate('/finance', { state: { view: 'accounting' } }) },
        { title: 'Ausgaben (Gesamt)', value: formatCurrency(expensesThisMonth), trend: expenseTrend.trend === 'up' ? 'down' : expenseTrend.trend === 'down' ? 'up' : 'neutral', trendValue: expenseTrend.value, subtitle: compareLabel, icon: TrendingDown, color: '#DC2626', onClick: () => navigate('/finance', { state: { view: 'accounting' } }) },
        { title: 'Leerstand', value: `${vacantUnits} Einheit${vacantUnits !== 1 ? 'en' : ''}`, trend: vacantUnits > 0 ? 'down' : 'up', trendValue: `${vacantUnits} / ${totalUnits}`, subtitle: vacationUnits > 0 ? `ohne ${vacationUnits} Ferienwohnung${vacationUnits !== 1 ? 'en' : ''}` : 'Einheiten', icon: Home, color: '#F59E0B', onClick: () => navigate('/tenants', { state: { filter: 'vacant' } }) },
        { title: 'Offene Forderungen', value: formatCurrency(overdueRent), trend: overdueRent > 0 ? 'down' : 'up', trendValue: overdueRent > 0 ? 'Offen' : 'Keine Rückstände', subtitle: overdueHiddenAmount > 0 ? `überfällige Mieten (ohne Mahnverfahren), zzgl. ${formatCurrency(overdueHiddenAmount)} vor Buchungsbeginn` : 'überfällige Mieten (ohne Mahnverfahren)', icon: AlertCircle, color: '#EF4444', onClick: () => navigate('/finance', { state: { view: 'overdue_details' } }) },
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700 }}>Dashboard</h1>
            </div>

            {warnings.length > 0 && (
                <div style={{ marginBottom: 'var(--spacing-md)', padding: '10px 14px', borderRadius: '8px', border: '1px solid #FCD34D', backgroundColor: 'rgba(245, 158, 11, 0.08)', color: '#92400E', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {warnings.map((w, i) => <span key={i}>{w}</span>)}
                </div>
            )}

            {/* KPI Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--spacing-lg)',
                marginBottom: 'var(--spacing-xl)'
            }}>
                {kpis.map((kpi, index) => (
                    <KPICard key={index} {...kpi} />
                ))}
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: 'var(--spacing-xl)',
                marginBottom: 'var(--spacing-xl)'
            }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-xl)' }}>
                    {/* Chart Section */}
                    <div style={{ flex: '1 1 500px', minWidth: 0 }}>
                        <Card title="Einnahmen & Ausgaben (letzte 6 Monate, nach Zahl-/Buchungsdatum)">
                            <div style={{ height: '300px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                            formatter={(value) => `${value.toLocaleString('de-DE')} €`}
                                        />
                                        <Bar dataKey="einnahmen" name="Einnahmen" fill="var(--primary-color)" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="ausgaben" name="Ausgaben" fill="#E5E7EB" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                    </div>

                    {/* Occupancy */}
                    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                        <Card title="Leerstände & Auslastung">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center', height: '100%', alignItems: 'center' }}>
                                <div style={{ position: 'relative', width: '150px', height: '150px' }}>
                                    <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                                        <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#E5E7EB" strokeWidth="3.8" />
                                        <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--primary-color)" strokeWidth="3.8" strokeDasharray={`${occupancyPct}, 100`} />
                                    </svg>
                                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                                        <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{occupancyPct}%</span>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Vermietet</div>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {totalUnits - vacantUnits} von {totalUnits} Einheiten vermietet
                                    {vacationUnits > 0 && (
                                        <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>
                                            zzgl. {vacationUnits} Ferienwohnung{vacationUnits !== 1 ? 'en' : ''} (nicht in der Quote)
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Recent Bookings */}
            <Card title="Letzte Buchungen">
                <div className="hidden-mobile">
                    <Table columns={bookingColumns} data={recentBookings} />
                </div>

                {/* Mobile Card View */}
                <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                    {recentBookings.map((row) => (
                        <div key={row.id} style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--spacing-md)',
                            backgroundColor: 'var(--surface-color)',
                            position: 'relative'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {(() => { const d = parseDateOnly(row.date); return d ? d.toLocaleDateString('de-DE') : '-'; })()}
                                </div>
                                <Badge variant={row.status === 'income' ? 'success' : 'danger'}>
                                    {row.status === 'income' ? 'Einnahme' : 'Ausgabe'}
                                </Badge>
                            </div>

                            <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '8px' }}>
                                {row.text}
                            </div>
                            {row.note && (
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>{row.note}</div>
                            )}

                            <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: row.status === 'income' ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                {row.status === 'income' ? '+' : '-'}{row.amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
};

export default Dashboard;
