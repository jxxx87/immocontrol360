import React, { useState, useEffect } from 'react';
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
    ArrowRight,
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

const KPICard = ({ title, value, trend, trendValue, icon: Icon, color }) => (
    <Card className="kpi-card">
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
        <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem' }}>
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
            <span style={{ color: 'var(--text-secondary)' }}>vs. Vormonat</span>
        </div>
    </Card>
);

const Dashboard = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const [loading, setLoading] = useState(true);

    // Live KPI state
    const [incomeThisMonth, setIncomeThisMonth] = useState(0);
    const [incomeLastMonth, setIncomeLastMonth] = useState(0);
    const [expensesThisMonth, setExpensesThisMonth] = useState(0);
    const [expensesLastMonth, setExpensesLastMonth] = useState(0);
    const [vacantUnits, setVacantUnits] = useState(0);
    const [totalUnits, setTotalUnits] = useState(0);
    const [overdueRent, setOverdueRent] = useState(0);
    const [recentBookings, setRecentBookings] = useState([]);
    const [chartData, setChartData] = useState([]);

    useEffect(() => {
        if (user) fetchDashboardData();
    }, [user, selectedPortfolioID]);

    const fetchDashboardData = async () => {
        try {
            setLoading(true);
            const now = new Date();
            const thisYear = now.getFullYear();
            const thisMonth = now.getMonth(); // 0-indexed

            // Current month range
            const currentMonthStart = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}-01`;
            const nextMonthDate = new Date(thisYear, thisMonth + 1, 1);
            const currentMonthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

            // Last month range
            const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
            const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

            // Fetch all data in parallel
            const [rentRes, expRes, leasesRes, unitsRes, tenantsRes] = await Promise.all([
                supabase.from('rent_payments').select('*, lease:leases(*, unit:units(property:properties(id, portfolio_id)))').order('payment_date', { ascending: false }),
                supabase.from('expenses').select('*, expense_categories(name)').order('booking_date', { ascending: false }),
                supabase.from('leases').select('*, unit:units(*, property:properties(*))'),
                supabase.from('units').select('*, property:properties(*)'),
                supabase.from('tenants').select('*')
            ]);

            if (rentRes.error) throw rentRes.error;
            if (expRes.error) throw expRes.error;
            if (leasesRes.error) throw leasesRes.error;
            if (unitsRes.error) throw unitsRes.error;

            let allPayments = rentRes.data || [];
            let allExpenses = expRes.data || [];
            let allLeases = leasesRes.data || [];
            let allUnits = unitsRes.data || [];
            let allTenants = tenantsRes.data || [];

            // Portfolio filter
            if (selectedPortfolioID) {
                allPayments = allPayments.filter(r => r.lease?.unit?.property?.portfolio_id === selectedPortfolioID);
                allExpenses = allExpenses.filter(e => {
                    if (!e.property_id) return true;
                    // Need to check property portfolio
                    const unit = allUnits.find(u => u.property_id === e.property_id);
                    return unit?.property?.portfolio_id === selectedPortfolioID;
                });
                allLeases = allLeases.filter(l => l.unit?.property?.portfolio_id === selectedPortfolioID);
                allUnits = allUnits.filter(u => u.property?.portfolio_id === selectedPortfolioID);
            }

            // --- Income: period_month based ---
            const incCurrent = allPayments
                .filter(p => p.period_month && p.period_month.startsWith(`${thisYear}-${String(thisMonth + 1).padStart(2, '0')}`))
                .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

            const incLast = allPayments
                .filter(p => p.period_month && p.period_month.startsWith(`${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`))
                .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

            setIncomeThisMonth(incCurrent);
            setIncomeLastMonth(incLast);

            // --- Expenses: booking_date based ---
            const expCurrent = allExpenses
                .filter(e => e.booking_date >= currentMonthStart && e.booking_date < currentMonthEnd)
                .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

            const expLast = allExpenses
                .filter(e => e.booking_date >= lastMonthStart && e.booking_date < currentMonthStart)
                .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

            setExpensesThisMonth(expCurrent);
            setExpensesLastMonth(expLast);

            // --- Vacancy ---
            const today = now.toISOString().split('T')[0];
            let occupied = 0;
            allUnits.forEach(unit => {
                const hasActiveLease = allLeases.some(l =>
                    l.unit_id === unit.id &&
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );
                if (hasActiveLease) occupied++;
            });
            setTotalUnits(allUnits.length);
            setVacantUnits(allUnits.length - occupied);

            // --- Overdue (Expected - Paid this month) ---
            let expectedThisMonth = 0;
            const checkDate = `${thisYear}-${String(thisMonth + 1).padStart(2, '0')}-01`;
            allLeases.forEach(l => {
                if (l.status === 'active' && l.start_date <= checkDate && (!l.end_date || l.end_date >= checkDate)) {
                    expectedThisMonth += (l.cold_rent || 0) + (l.service_charge || 0) + (l.heating_cost || 0) + (l.other_costs || 0);
                }
            });
            const overdue = Math.max(0, expectedThisMonth - incCurrent);
            setOverdueRent(overdue);

            // --- Recent Bookings (combined, last 10) ---
            const combinedBookings = [
                ...allExpenses.slice(0, 30).map(e => ({
                    id: `exp-${e.id}`,
                    date: e.booking_date,
                    text: e.payee || e.expense_categories?.name || 'Ausgabe',
                    note: e.note || '',
                    amount: parseFloat(e.amount) || 0,
                    status: 'expense'
                })),
                ...allPayments.slice(0, 30).map(r => {
                    const t = r.lease?.tenant_id ? allTenants.find(t => t.id === r.lease.tenant_id) : null;
                    return {
                        id: `inc-${r.id}`,
                        date: r.payment_date,
                        text: t ? `Mieteingang ${t.last_name}, ${t.first_name}` : 'Mieteinnahme',
                        note: r.note || '',
                        amount: parseFloat(r.amount) || 0,
                        status: 'income'
                    };
                })
            ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

            setRecentBookings(combinedBookings);

            // --- Chart Data (last 6 months) ---
            const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
            const chartMonths = [];
            for (let i = 5; i >= 0; i--) {
                const d = new Date(thisYear, thisMonth - i, 1);
                const y = d.getFullYear();
                const m = d.getMonth();
                const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
                const monthStartStr = `${prefix}-01`;
                const nextM = new Date(y, m + 1, 1);
                const monthEndStr = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, '0')}-01`;

                const einnahmen = allPayments
                    .filter(p => p.period_month && p.period_month.startsWith(prefix))
                    .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

                const ausgaben = allExpenses
                    .filter(e => e.booking_date >= monthStartStr && e.booking_date < monthEndStr)
                    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

                chartMonths.push({ name: monthNames[m], einnahmen: Math.round(einnahmen), ausgaben: Math.round(ausgaben) });
            }
            setChartData(chartMonths);

        } catch (error) {
            console.error('Dashboard fetch error:', error);
        } finally {
            setLoading(false);
        }
    };

    // --- KPI Calculations ---
    const formatCurrency = (val) => {
        return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    };

    const calcTrend = (current, previous) => {
        if (previous === 0 && current === 0) return { trend: 'neutral', value: '0%' };
        if (previous === 0) return { trend: 'up', value: '+100%' };
        const pct = ((current - previous) / previous) * 100;
        const sign = pct >= 0 ? '+' : '';
        return {
            trend: pct >= 0 ? 'up' : 'down',
            value: `${sign}${pct.toFixed(1)}%`
        };
    };

    const incomeTrend = calcTrend(incomeThisMonth, incomeLastMonth);
    const expenseTrend = calcTrend(expensesThisMonth, expensesLastMonth);
    const netCurrent = incomeThisMonth - expensesThisMonth;
    const netLast = incomeLastMonth - expensesLastMonth;
    const netTrend = calcTrend(netCurrent, netLast);
    const occupancyPct = totalUnits > 0 ? Math.round(((totalUnits - vacantUnits) / totalUnits) * 100) : 0;

    const kpis = [
        { title: 'Gesamteinnahmen', value: formatCurrency(incomeThisMonth), trend: incomeTrend.trend, trendValue: incomeTrend.value, icon: Wallet, color: '#0066CC' },
        { title: 'Ausgaben (Gesamt)', value: formatCurrency(expensesThisMonth), trend: expenseTrend.trend === 'up' ? 'down' : 'up', trendValue: expenseTrend.value, icon: TrendingDown, color: '#DC2626' },
        { title: 'Leerstand', value: `${vacantUnits} Einheit${vacantUnits !== 1 ? 'en' : ''}`, trend: vacantUnits > 0 ? 'down' : 'up', trendValue: `${vacantUnits} / ${totalUnits}`, icon: Home, color: '#F59E0B' },
        { title: 'Offene Forderungen', value: formatCurrency(overdueRent), trend: overdueRent > 0 ? 'down' : 'up', trendValue: overdueRent > 0 ? 'Offen' : 'Alles bezahlt', icon: AlertCircle, color: '#EF4444' },
    ];

    const bookingColumns = [
        { header: 'Datum', accessor: 'date', render: row => new Date(row.date).toLocaleDateString('de-DE') },
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

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700 }}>Dashboard</h1>
            </div>

            {/* KPI Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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
                        <Card title="Einnahmen & Ausgaben (letzte 6 Monate)">
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
                                    {new Date(row.date).toLocaleDateString('de-DE')}
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
