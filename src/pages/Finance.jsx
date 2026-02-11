import React, { useState, useEffect } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { Plus, Wallet, ArrowUpRight, ArrowDownLeft, Loader2, Filter, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const Finance = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();

    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Data
    const [expenses, setExpenses] = useState([]);
    const [rentPayments, setRentPayments] = useState([]);
    const [leases, setLeases] = useState([]); // Needed for Expected Rent
    const [recentBookings, setRecentBookings] = useState([]);

    // Filters
    // Filters
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const [filterStartDate, setFilterStartDate] = useState(formatDate(startOfMonth));
    const [filterEndDate, setFilterEndDate] = useState(formatDate(endOfMonth));
    const [filterPropertyId, setFilterPropertyId] = useState('');
    const [filterUnitId, setFilterUnitId] = useState('');

    // KPIs
    const [kpiData, setKpiData] = useState({
        expectedRent: 0,
        paidRent: 0,
        overdueRent: 0,
        totalExpenses: 0,
        surplus: 0
    });

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [bookingType, setBookingType] = useState('expense'); // expense, income, loan
    const [isExpectedDetailsOpen, setIsExpectedDetailsOpen] = useState(false);
    const [isPaidDetailsOpen, setIsPaidDetailsOpen] = useState(false);
    const [processingPaymentId, setProcessingPaymentId] = useState(null); // For loading state of specific unit/lease operation

    // Helper Data
    const [categories, setCategories] = useState([]);
    const [properties, setProperties] = useState([]);
    // Split units state: one for the filter bar (dependent on filterPropertyId), one for the modal form (dependent on form property)
    const [filterUnits, setFilterUnits] = useState([]);
    const [formUnits, setFormUnits] = useState([]); // For the modal
    const [allUnits, setAllUnits] = useState([]); // For Expected Rent Modal (Vacancies)
    const [tenants, setTenants] = useState([]);

    // Forms
    const [expenseForm, setExpenseForm] = useState({
        booking_date: new Date().toISOString().split('T')[0],
        payee: '',
        category_id: '',
        category_custom: '',
        scope: 'general', // general, unit
        property_id: '',
        unit_id: '',
        is_allocatable: true,
        amount: '',
        note: ''
    });

    const [incomeForm, setIncomeForm] = useState({
        payment_date: new Date().toISOString().split('T')[0],
        period_month: new Date().toISOString().slice(0, 7), // YYYY-MM
        amount: '',
        note: '',
        tenant_id: '',
        property_id: '',
        unit_id: ''
    });
    const [expectedRentDisplay, setExpectedRentDisplay] = useState(null);

    // Helper: Get Days in Month
    const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

    // Helper: Iterate Months between two dates
    const getMonthsBetween = (startStr, endStr) => {
        const start = new Date(startStr);
        const end = new Date(endStr);
        const months = [];
        let current = new Date(start);
        current.setDate(1); // Start at beginning of month to avoid overflow issues

        while (current <= end) {
            months.push(new Date(current));
            current.setMonth(current.getMonth() + 1);
        }
        return months;
    };

    // Calculate Expected Rent Logic
    const calculateFinanceKPIs = (currentExpenses, currentPayments, currentLeases) => {
        // Filter Expenses
        let filteredExpenses = currentExpenses.filter(e => {
            if (e.booking_date < filterStartDate || e.booking_date > filterEndDate) return false;
            // Portfolio filter handled in fetch, Property/Unit filter here
            if (filterPropertyId && e.property_id !== filterPropertyId) return false;
            if (filterUnitId && e.unit_id !== filterUnitId) return false;
            return true;
        });

        // Filter Payments (Actual)
        let filteredPayments = currentPayments.filter(p => {
            // Cashflow View (Expenses & Income KPIs): Based on payment_date/booking_date.
            return p.payment_date >= filterStartDate && p.payment_date <= filterEndDate;
        });

        // Further filter payments by Prop/Unit
        if (filterPropertyId) {
            filteredPayments = filteredPayments.filter(p => p.lease?.unit?.property_id === filterPropertyId);
        }
        if (filterUnitId) {
            filteredPayments = filteredPayments.filter(p => p.lease?.unit_id === filterUnitId);
        }

        const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const paidRentCashflow = filteredPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

        // --- CALCULATION FOR OVERDUE (EXPECTED vs ACTUAL ALLOCATED) ---
        // 1. Identify all months in the filter range.
        const months = getMonthsBetween(filterStartDate, filterEndDate);

        let totalExpected = 0;
        let totalAllocatedActual = 0; // Actual payments allocated to months in this range

        // Iterate Leases to calculate Expected per Lease per Month
        let overdueSum = 0;

        currentLeases.forEach(lease => {
            // Apply Property/Unit Filters
            if (filterPropertyId && lease.unit.property_id !== filterPropertyId) return;
            if (filterUnitId && lease.unit_id !== filterUnitId) return;

            let leaseExpected = 0;
            let leaseActual = 0;

            months.forEach(monthDate => {
                const year = monthDate.getFullYear();
                const month = monthDate.getMonth(); // 0-11
                const daysInMonth = getDaysInMonth(year, month);

                // Construct Date objects for start/end of this month
                const monthStart = new Date(year, month, 1);
                const monthEnd = new Date(year, month, daysInMonth);

                // Lease Dates
                const leaseStart = new Date(lease.start_date);
                const leaseEnd = lease.end_date ? new Date(lease.end_date) : new Date('9999-12-31');

                // Check overlap
                if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
                    // It's active effectively this month.
                    // Calculate Ratio
                    let activeDays = daysInMonth;

                    // Starts in this month?
                    if (leaseStart > monthStart) {
                        activeDays -= (leaseStart.getDate() - 1);
                    }

                    // Ends in this month?
                    if (leaseEnd < monthEnd) {
                        // e.g. ends 15th. Active 15 days.
                        // monthEnd is 30th. 
                        // daysInMonth - (daysInMonth - end.getDate()) = end.getDate()
                        activeDays = leaseEnd.getDate();
                        if (leaseStart > monthStart) {
                            // Case: Starts 5th, Ends 15th. Active = 15 - 5 + 1 = 11 days.
                            const overlapStart = leaseStart > monthStart ? leaseStart : monthStart;
                            const overlapEnd = leaseEnd < monthEnd ? leaseEnd : monthEnd;
                            const diffTime = Math.abs(overlapEnd - overlapStart);
                            activeDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                        }
                    }

                    // Ratio
                    // Exact days (28/29/30/31) is safer for "exact" per user request.
                    const ratio = activeDays / daysInMonth;

                    // Monthly Full Rent
                    const monthlyRent = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);

                    leaseExpected += (monthlyRent * ratio);

                    // Find payments for this specific month (period_month)
                    // period_month format: YYYY-MM-DD (usually first of month)
                    // We match YYYY-MM
                    const periodStr = `${year}-${String(month + 1).padStart(2, '0')}`;

                    const paymentsForMonth = currentPayments.filter(p =>
                        p.lease_id === lease.id &&
                        p.period_month &&
                        p.period_month.startsWith(periodStr)
                    );

                    const monthPay = paymentsForMonth.reduce((sum, p) => sum + (p.amount || 0), 0);
                    leaseActual += monthPay;
                }
            });

            totalExpected += leaseExpected;
            totalAllocatedActual += leaseActual;

            // Overdue per lease
            if (leaseExpected > leaseActual) {
                overdueSum += (leaseExpected - leaseActual);
            }
        });

        setKpiData({
            expectedRent: totalExpected,
            paidRent: totalAllocatedActual,
            overdueRent: overdueSum,
            totalExpenses: totalExpenses,
            surplus: totalAllocatedActual - totalExpenses
        });

        // Filter Expenses & Payments for Table (combine)
        const combined = [
            ...filteredExpenses.map(e => ({ ...e, type: 'expense', date: e.booking_date, amount: -e.amount })),
            ...filteredPayments.map(r => ({ ...r, type: 'income', date: r.payment_date, amount: r.amount }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);

        setRecentBookings(combined);
    };


    // Fetch Data
    const fetchData = async () => {
        try {
            setLoading(true);

            // 1. Fetch Expenses (ALL for portfolio, filter locally)
            let expQuery = supabase.from('expenses').select('*, expense_categories(name)').order('booking_date', { ascending: false });

            // 2. Fetch Rent Payments (ALL for portfolio)
            let rentQuery = supabase.from('rent_payments').select('*, lease:leases(*, unit:units(property:properties(id, street, house_number, portfolio_id)))').order('payment_date', { ascending: false });

            // 3. Fetch Leases (For Expected Calculation) - Fetch ALL to handle history
            let allLeaseQuery = supabase.from('leases').select('*, unit:units(*, property:properties(*))');

            // 4. Fetch All Units (For Vacancy Check)
            let allUnitsQuery = supabase.from('units').select('*, property:properties(*)').order('unit_name');

            // 5. Fetch Tenants (For Name Resolution)
            let tenantsQuery = supabase.from('tenants').select('*');

            const [expRes, rentRes, leaseRes, unitsRes, tenantsRes] = await Promise.all([expQuery, rentQuery, allLeaseQuery, allUnitsQuery, tenantsQuery]);

            if (expRes.error) throw expRes.error;
            if (rentRes.error) throw rentRes.error;
            if (leaseRes.error) throw leaseRes.error;
            if (unitsRes.error) throw unitsRes.error;
            if (tenantsRes.error) throw tenantsRes.error;

            let allExpenses = expRes.data || [];
            let allPayments = rentRes.data || [];
            let allLeases = leaseRes.data || [];
            let allUnitsData = unitsRes.data || [];
            let allTenants = tenantsRes.data || [];

            // Portfolio Filter
            if (selectedPortfolioID) {
                // For expenses (filter properties first or use property_id)
                const { data: props } = await supabase.from('properties').select('id').eq('portfolio_id', selectedPortfolioID);
                const propIds = props.map(p => p.id);

                allExpenses = allExpenses.filter(e => !e.property_id || propIds.includes(e.property_id));
                allPayments = allPayments.filter(r => r.lease?.unit?.property?.portfolio_id === selectedPortfolioID);
                allLeases = allLeases.filter(l => l.unit?.property?.portfolio_id === selectedPortfolioID);
                allUnitsData = allUnitsData.filter(u => u.property?.portfolio_id === selectedPortfolioID);
            }

            setExpenses(allExpenses);
            setRentPayments(allPayments);
            setLeases(allLeases); // Store for recalc
            setAllUnits(allUnitsData);
            setTenants(allTenants);


            // Helpers for Dropdowns
            const { data: props } = await supabase.from('properties').select('id, street, house_number, portfolio_id').order('street');
            let filteredProps = props || [];
            if (selectedPortfolioID) filteredProps = filteredProps.filter(p => p.portfolio_id === selectedPortfolioID);
            setProperties(filteredProps || []);

            // Categories
            const { data: cats } = await supabase.from('expense_categories').select('*');
            setCategories(cats || []);

            // Tenants
            const { data: tens } = await supabase.from('tenants').select('*').order('last_name');
            setTenants(tens || []);

            // Initial Calc
            calculateFinanceKPIs(allExpenses, allPayments, allLeases);

        } catch (error) {
            console.error('Error fetching finance data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Recalculate when filters change (using local data)
    useEffect(() => {
        if (!loading && (expenses.length > 0 || rentPayments.length > 0)) {
            calculateFinanceKPIs(expenses, rentPayments, leases);
        }
    }, [filterStartDate, filterEndDate, filterPropertyId, filterUnitId]);

    // Load Units for Filter Bar
    useEffect(() => {
        const loadUnits = async () => {
            if (filterPropertyId) {
                const { data } = await supabase.from('units').select('id, unit_name').eq('property_id', filterPropertyId);
                setFilterUnits(data || []);
            } else {
                setFilterUnits([]);
            }
        }
        loadUnits();
    }, [filterPropertyId]);

    // Load Units for Modal Form (Dynamic based on selected Property in Form)
    useEffect(() => {
        const fetchFormUnits = async () => {
            const propId = bookingType === 'expense' ? expenseForm.property_id : incomeForm.property_id;
            if (!propId) {
                setFormUnits([]);
                return;
            }
            const { data } = await supabase.from('units').select('id, unit_name').eq('property_id', propId).order('unit_name');
            setFormUnits(data || []);
        };
        fetchFormUnits();
    }, [bookingType, expenseForm.property_id, incomeForm.property_id]);


    useEffect(() => {
        if (user) fetchData();
    }, [user, selectedPortfolioID]);


    // Handlers for Dynamic Form Behavior
    const handleTenantChange = (e) => {
        const newTenantId = e.target.value;
        setIncomeForm(prev => {
            const newData = { ...prev, tenant_id: newTenantId };

            // Auto-fill Property/Unit
            if (newTenantId) {
                const today = new Date().toISOString().split('T')[0];
                const activeLease = leases.find(l =>
                    l.tenant_id === newTenantId &&
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );

                if (activeLease && activeLease.unit) {
                    newData.property_id = activeLease.unit.property_id;
                    newData.unit_id = activeLease.unit_id;

                    // Set Expected Rent Display
                    const totalRent = (activeLease.cold_rent || 0) + (activeLease.service_charge || 0) + (activeLease.heating_cost || 0) + (activeLease.other_costs || 0);
                    setExpectedRentDisplay(totalRent.toFixed(2));
                }
            } else {
                setExpectedRentDisplay(null);
            }
            return newData;
        });
    };

    const handleUnitChange = (e) => {
        const newUnitId = e.target.value;
        setIncomeForm(prev => {
            const newData = { ...prev, unit_id: newUnitId };

            // Auto-select Tenant
            if (newUnitId) {
                const today = new Date().toISOString().split('T')[0];
                const activeLease = leases.find(l =>
                    l.unit_id === newUnitId &&
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );

                if (activeLease) {
                    newData.tenant_id = activeLease.tenant_id;

                    // Set Expected Rent Display
                    const totalRent = (activeLease.cold_rent || 0) + (activeLease.service_charge || 0) + (activeLease.heating_cost || 0) + (activeLease.other_costs || 0);
                    setExpectedRentDisplay(totalRent.toFixed(2));
                } else {
                    newData.tenant_id = '';
                    setExpectedRentDisplay(null);
                }
            } else {
                setExpectedRentDisplay(null);
            }
            return newData;
        });
    };


    const handleSaveExpense = async () => {
        try {
            setIsSaving(true);
            const { error } = await supabase.from('expenses').insert([{
                user_id: user.id,
                booking_date: expenseForm.booking_date,
                payee: expenseForm.payee,
                category_id: expenseForm.category_id || null,
                category_custom: expenseForm.category_id ? null : expenseForm.category_custom,
                property_id: expenseForm.property_id,
                unit_id: expenseForm.scope === 'unit' ? expenseForm.unit_id : null,
                amount: parseFloat(expenseForm.amount),
                is_allocatable: expenseForm.is_allocatable,
                note: expenseForm.note
            }]);

            if (error) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
            setIsSaving(false);
        }
    };

    const handleSaveIncome = async () => {
        try {
            setIsSaving(true);
            const { data: leasesData, error: leaseError } = await supabase
                .from('leases')
                .select('id')
                .eq('tenant_id', incomeForm.tenant_id)
                .eq('unit_id', incomeForm.unit_id)
                .eq('status', 'active')
                .limit(1);

            if (leaseError) throw leaseError;
            if (!leasesData || leasesData.length === 0) {
                alert('Kein aktives Mietverhältnis für diesen Mieter in dieser Einheit gefunden.');
                setIsSaving(false);
                return;
            }

            const leaseId = leasesData[0].id;

            const { error } = await supabase.from('rent_payments').insert([{
                user_id: user.id,
                lease_id: leaseId,
                payment_date: incomeForm.payment_date,
                period_month: incomeForm.period_month ? `${incomeForm.period_month}-01` : null,
                amount: parseFloat(incomeForm.amount),
                note: incomeForm.note
            }]);

            if (error) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
            setIsSaving(false);
        }
    };

    const handleMarkAsPaid = async (lease, monthStr) => {
        try {
            setProcessingPaymentId(`${lease.id}-${monthStr}`);

            // Calculate total rent from lease
            const amount = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);

            const { error } = await supabase.from('rent_payments').insert([{
                user_id: user.id,
                lease_id: lease.id,
                payment_date: new Date().toISOString().split('T')[0], // Today
                period_month: `${monthStr}-01`,
                amount: amount,
                note: `Miete ${monthStr}`
            }]);

            if (error) throw error;

            // Short delay for UX
            await new Promise(resolve => setTimeout(resolve, 800));

            // Refresh
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setProcessingPaymentId(null);
        }
    };

    const handleDeleteBooking = async (row) => {
        if (!confirm('Möchten Sie diese Buchung wirklich löschen?')) return;

        try {
            const table = row.type === 'expense' ? 'expenses' : 'rent_payments';
            const { error } = await supabase.from(table).delete().eq('id', row.id);
            if (error) throw error;
            fetchData();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // Columns
    const bookingColumns = [
        {
            header: 'Datum',
            accessor: 'date',
            render: row => new Date(row.date).toLocaleDateString()
        },
        {
            header: 'Typ',
            accessor: 'type',
            render: row => row.type === 'expense' ?
                <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center' }}><ArrowUpRight size={14} style={{ marginRight: 4 }} /> Ausgabe</span> :
                <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center' }}><ArrowDownLeft size={14} style={{ marginRight: 4 }} /> Einnahme</span>
        },
        {
            header: 'Objekt',
            accessor: 'property',
            render: row => {
                if (row.type === 'income') {
                    return row.lease?.unit?.property ? `${row.lease.unit.property.street} ${row.lease.unit.property.house_number}` : '-';
                } else {
                    const p = properties.find(p => p.id === row.property_id);
                    return p ? `${p.street} ${p.house_number}` : 'Allgemein';
                }
            }
        },
        {
            header: 'Zahler / Empfänger',
            accessor: 'party',
            render: row => {
                if (row.type === 'income') {
                    if (row.lease?.tenant_id) {
                        const t = tenants.find(t => t.id === row.lease.tenant_id);
                        return t ? `${t.last_name}, ${t.first_name}` : 'Unbekannter Mieter';
                    }
                    return 'Mieteinnahme';
                } else {
                    return row.payee || 'Unbekannt';
                }
            }
        },
        {
            header: 'Betreff / Kategorie',
            accessor: 'note',
            render: row => (
                <div>
                    <div style={{ fontWeight: 500 }}>{row.type === 'expense' ? (row.expense_categories?.name || 'Ausgabe') : 'Miete'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.note}</div>
                </div>
            )
        },
        {
            header: 'Betrag',
            accessor: 'amount',
            align: 'right',
            render: row => (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
                    <span style={{ fontWeight: 600, color: row.amount > 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                        {row.amount > 0 ? '+' : ''}{Math.abs(parseFloat(row.amount)).toFixed(2)} €
                    </span>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteBooking(row); }}
                        style={{ color: 'var(--text-secondary)', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', border: 'none', background: 'transparent' }}
                        title="Löschen"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Finanzen</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Einnahmen, Ausgaben und Mieteingänge</p>
                </div>
                <Button icon={Plus} onClick={() => { setIsModalOpen(true); setBookingType('expense'); }}>Buchung erfassen</Button>
            </div>

            {/* Filter Bar */}
            <Card style={{ marginBottom: 'var(--spacing-lg)', padding: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Von</label>
                        <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Bis</label>
                        <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Immobilie</label>
                        <select
                            value={filterPropertyId}
                            onChange={e => { setFilterPropertyId(e.target.value); setFilterUnitId(''); }}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '150px' }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Einheit</label>
                        <select
                            value={filterUnitId}
                            onChange={e => setFilterUnitId(e.target.value)}
                            disabled={!filterPropertyId}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '100px' }}
                        >
                            <option value="">Alle</option>
                            {filterUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                        </select>
                    </div>
                </div>
            </Card>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Erwartete Miete (Soll)</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary-color)' }}>
                                {kpiData.expectedRent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>im gewählten Zeitraum</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setIsExpectedDetailsOpen(true)}>Details</Button>
                    </div>
                </Card>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Bezahlte Mieten (Ist)</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success-color)' }}>
                                {kpiData.paidRent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Zahlungseingänge</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setIsPaidDetailsOpen(true)}>Details</Button>
                    </div>
                </Card>
                <Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Überfällige Mieten</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: kpiData.overdueRent > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
                        {kpiData.overdueRent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rückstände (kumuliert)</div>
                </Card>
                <Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Überschuss / Cashflow</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: kpiData.surplus >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                        {kpiData.surplus.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Einnahmen - Ausgaben</div>
                </Card>
            </div>

            <Card title="Buchungen im Zeitraum">
                {recentBookings.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Keine Buchungen gefunden.</div>
                ) : (
                    <Table columns={bookingColumns} data={recentBookings} />
                )}
            </Card>

            {/* Expected Rent Details Modal */}
            <Modal
                isOpen={isExpectedDetailsOpen}
                onClose={() => setIsExpectedDetailsOpen(false)}
                title="Erwartete Miete (Soll) - Details"
                maxWidth="1000px"
                footer={<Button variant="secondary" onClick={() => setIsExpectedDetailsOpen(false)}>Schließen</Button>}
            >
                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                        Zeitraum: <strong>{new Date(filterStartDate).toLocaleDateString()} - {new Date(filterEndDate).toLocaleDateString()}</strong>
                    </div>
                    <Table
                        columns={[
                            { header: 'Einheit', accessor: 'unit', render: r => <div><div style={{ fontWeight: 500 }}>{r.property?.street} {r.property?.house_number}</div><div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.unit_name}</div></div> },
                            { header: 'Mieter', accessor: 'tenant', render: r => r.tenant_name || <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Leerstand</span> },
                            {
                                header: 'Monatliche Miete (akt.)',
                                accessor: 'monthly',
                                align: 'right',
                                render: r => <span>{r.monthlyRent > 0 ? r.monthlyRent.toFixed(2) + ' €' : '-'}</span>
                            },
                            {
                                header: 'Gesamt Soll (Zeitraum)',
                                accessor: 'total',
                                align: 'right',
                                render: r => <span style={{ fontWeight: 600 }}>{r.totalRent > 0 ? r.totalRent.toFixed(2) + ' €' : '-'}</span>
                            }
                        ]}
                        data={(() => {
                            const months = getMonthsBetween(filterStartDate, filterEndDate);
                            return allUnits.filter(u => !filterPropertyId || u.property_id === filterPropertyId)
                                .map(unit => {
                                    let totalRent = 0;
                                    let currentMonthlyRent = 0;
                                    let lastTenantName = null;

                                    months.forEach(m => {
                                        const year = m.getFullYear();
                                        const month = String(m.getMonth() + 1).padStart(2, '0');
                                        const checkDate = `${year}-${month}-01`;

                                        const activeLease = leases.find(l =>
                                            l.unit_id === unit.id &&
                                            l.status === 'active' &&
                                            l.start_date <= checkDate &&
                                            (!l.end_date || l.end_date >= checkDate)
                                        );

                                        if (activeLease) {
                                            const rent = (activeLease.cold_rent || 0) + (activeLease.service_charge || 0) + (activeLease.heating_cost || 0) + (activeLease.other_costs || 0);
                                            totalRent += rent;
                                            currentMonthlyRent = rent;
                                            if (!lastTenantName) {
                                                const t = tenants.find(t => t.id === activeLease.tenant_id);
                                                lastTenantName = t ? `${t.last_name}, ${t.first_name}` : 'Unbekannt';
                                            }
                                        }
                                    });

                                    return {
                                        id: unit.id,
                                        unit_name: unit.unit_name,
                                        property: unit.property,
                                        tenant_name: lastTenantName,
                                        monthlyRent: currentMonthlyRent,
                                        totalRent: totalRent
                                    };
                                });
                        })()}
                    />
                </div>
            </Modal>

            {/* Paid Rent Details Modal */}
            <Modal
                isOpen={isPaidDetailsOpen}
                onClose={() => setIsPaidDetailsOpen(false)}
                title="Status Mietzahlungen - Details"
                maxWidth="1200px"
                footer={<Button variant="secondary" onClick={() => setIsPaidDetailsOpen(false)}>Schließen</Button>}
            >
                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                        Zeitraum: <strong>{new Date(filterStartDate).toLocaleDateString()} - {new Date(filterEndDate).toLocaleDateString()}</strong>
                    </div>
                    <Table
                        columns={[
                            { header: 'Einheit', accessor: 'unit', render: r => <div><div style={{ fontWeight: 500 }}>{r.property?.street} {r.property?.house_number}</div><div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.unit_name}</div></div> },
                            { header: 'Mieter', accessor: 'tenant', render: r => r.tenant_name },
                            {
                                header: 'Status',
                                accessor: 'status',
                                render: r => {
                                    if (r.missingMonths.length === 0) {
                                        return <span style={{ color: 'var(--success-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>Alles bezahlt ({r.totalPaid.toFixed(2)} €)</span>;
                                    }
                                    return (
                                        <div style={{ color: 'var(--danger-color)', fontWeight: 600 }}>
                                            {r.missingMonths.length} Zahlung(en) offen
                                            <div style={{ fontSize: '0.75rem', fontWeight: 400 }}>
                                                Soll: {r.totalExpected.toFixed(2)} € | Ist: {r.totalPaid.toFixed(2)} €
                                            </div>
                                        </div>
                                    );
                                }
                            },
                            {
                                header: 'Offene Monate / Aktion',
                                accessor: 'action',
                                align: 'right',
                                render: r => (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                                        {r.missingMonths.map(m => (
                                            <div key={m.str} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '0.8rem' }}>{new Date(m.date).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
                                                <Button
                                                    size="sm"
                                                    disabled={processingPaymentId === `${r.leaseId}-${m.str}`}
                                                    onClick={() => handleMarkAsPaid(r.lease, m.str)}
                                                    style={{ fontSize: '0.75rem', padding: '2px 8px', height: 'auto', minHeight: '24px' }}
                                                >
                                                    {processingPaymentId === `${r.leaseId}-${m.str}` ? <Loader2 className="animate-spin" size={12} /> : 'Bezahlen'}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )
                            }
                        ]}
                        data={(() => {
                            const months = getMonthsBetween(filterStartDate, filterEndDate);
                            return allUnits.filter(u => !filterPropertyId || u.property_id === filterPropertyId)
                                .map(unit => {
                                    let totalExpected = 0;
                                    let totalPaid = 0;
                                    let missingMonths = [];
                                    let activeLeaseRef = null;
                                    let tenantNameRef = null;

                                    months.forEach(m => {
                                        const year = m.getFullYear();
                                        const month = String(m.getMonth() + 1).padStart(2, '0');
                                        const monthStr = `${year}-${month}`;
                                        const checkDate = `${monthStr}-01`;

                                        const activeLease = leases.find(l =>
                                            l.unit_id === unit.id &&
                                            l.status === 'active' &&
                                            l.start_date <= checkDate &&
                                            (!l.end_date || l.end_date >= checkDate)
                                        );

                                        if (activeLease) {
                                            if (!activeLeaseRef) activeLeaseRef = activeLease;
                                            if (!tenantNameRef) {
                                                const t = tenants.find(t => t.id === activeLease.tenant_id);
                                                tenantNameRef = t ? `${t.last_name}, ${t.first_name}` : 'Unbekannt';
                                            }

                                            const expected = (activeLease.cold_rent || 0) + (activeLease.service_charge || 0) + (activeLease.heating_cost || 0) + (activeLease.other_costs || 0);
                                            totalExpected += expected;

                                            const payments = rentPayments.filter(p =>
                                                p.lease_id === activeLease.id &&
                                                p.period_month === `${monthStr}-01`
                                            );
                                            const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                                            totalPaid += paid;

                                            if (paid < expected - 1) {
                                                missingMonths.push({ date: m, str: monthStr, expected, paid });
                                            }
                                        }
                                    });

                                    if (!activeLeaseRef && totalExpected === 0) return null;

                                    return {
                                        id: unit.id,
                                        unit_name: unit.unit_name,
                                        property: unit.property,
                                        tenant_name: tenantNameRef || 'Unbekannt',
                                        totalExpected,
                                        totalPaid,
                                        missingMonths,
                                        lease: activeLeaseRef,
                                        leaseId: activeLeaseRef?.id
                                    };
                                }).filter(Boolean);
                        })()}
                    />
                </div>
            </Modal>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Buchung erfassen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={bookingType === 'expense' ? handleSaveExpense : bookingType === 'income' ? handleSaveIncome : () => setIsModalOpen(false)}>Speichern</Button>
                    </>
                }
            >
                {isSaving && <LoadingOverlay message="Buche..." />}
                <div style={{ display: 'flex', gap: '10px', marginBottom: 'var(--spacing-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                    <button
                        onClick={() => setBookingType('expense')}
                        style={{ padding: '8px 16px', borderRadius: '20px', backgroundColor: bookingType === 'expense' ? 'var(--danger-color)' : '#F3F4F6', color: bookingType === 'expense' ? 'white' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    >Kosten</button>
                    <button
                        onClick={() => setBookingType('income')}
                        style={{ padding: '8px 16px', borderRadius: '20px', backgroundColor: bookingType === 'income' ? 'var(--success-color)' : '#F3F4F6', color: bookingType === 'income' ? 'white' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                    >Mieteingänge</button>
                    {/* Loan removed for brevity as per previous file view it was placeholder */}
                </div>

                {bookingType === 'expense' && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Datum" type="date" value={expenseForm.booking_date} onChange={e => setExpenseForm({ ...expenseForm, booking_date: e.target.value })} />
                            <Input label="Zahlungsempfänger" value={expenseForm.payee} onChange={e => setExpenseForm({ ...expenseForm, payee: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Kostenart</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={expenseForm.category_id}
                                    onChange={e => {
                                        const catId = e.target.value;
                                        const cat = categories.find(c => c.id === catId);
                                        setExpenseForm({
                                            ...expenseForm,
                                            category_id: catId,
                                            is_allocatable: cat ? (cat.is_recoverable ?? true) : true
                                        });
                                    }}
                                >
                                    <option value="">Eigene Angabe...</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            {!expenseForm.category_id && (
                                <Input label="Kategorie (Text)" value={expenseForm.category_custom} onChange={e => setExpenseForm({ ...expenseForm, category_custom: e.target.value })} />
                            )}
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Zuordnung</label>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" checked={expenseForm.scope === 'general'} onChange={() => setExpenseForm({ ...expenseForm, scope: 'general' })} /> Allgemein</label>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" checked={expenseForm.scope === 'unit'} onChange={() => setExpenseForm({ ...expenseForm, scope: 'unit' })} /> Einheit</label>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={expenseForm.property_id}
                                    onChange={e => setExpenseForm({ ...expenseForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                                </select>
                            </div>
                            {expenseForm.scope === 'unit' && (
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit</label>
                                    <select
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                        value={expenseForm.unit_id}
                                        onChange={e => setExpenseForm({ ...expenseForm, unit_id: e.target.value })}
                                        disabled={!expenseForm.property_id}
                                    >
                                        <option value="">Wählen...</option>
                                        {formUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Betrag" type="number" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                            <div style={{ display: 'flex', alignItems: 'center', marginTop: '25px' }}>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={expenseForm.is_allocatable} onChange={e => setExpenseForm({ ...expenseForm, is_allocatable: e.target.checked })} style={{ marginRight: 8 }} /> Umlagefähig</label>
                            </div>
                        </div>
                        <Input label="Notiz" value={expenseForm.note} onChange={e => setExpenseForm({ ...expenseForm, note: e.target.value })} />
                    </div>
                )}

                {bookingType === 'income' && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Zahldatum" type="date" value={incomeForm.payment_date} onChange={e => setIncomeForm({ ...incomeForm, payment_date: e.target.value })} />
                            <Input label="Monat" type="month" value={incomeForm.period_month} onChange={e => setIncomeForm({ ...incomeForm, period_month: e.target.value })} />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Mieter</label>
                            <select
                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                value={incomeForm.tenant_id}
                                onChange={handleTenantChange}
                            >
                                <option value="">Wählen...</option>
                                {/* Filter unique tenants by name for display (using Map to dedup) */}
                                {Array.from(new Map(tenants.map(t => [t.first_name + t.last_name, t])).values()).map(t => (
                                    <option key={t.id} value={t.id}>{t.last_name}, {t.first_name}</option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={incomeForm.property_id}
                                    onChange={e => setIncomeForm({ ...incomeForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={incomeForm.unit_id}
                                    onChange={handleUnitChange}
                                    disabled={!incomeForm.property_id}
                                >
                                    <option value="">Wählen...</option>
                                    {formUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Betrag (€)" type="number" value={incomeForm.amount} onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })} />
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Soll-Miete (Gesamt)</label>
                                <input
                                    type="text"
                                    disabled
                                    value={expectedRentDisplay ? `${expectedRentDisplay} €` : '-'}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: '#F3F4F6', color: 'var(--text-secondary)' }}
                                />
                            </div>
                        </div>
                        <Input label="Notiz" value={incomeForm.note} onChange={e => setIncomeForm({ ...incomeForm, note: e.target.value })} />
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default Finance;
