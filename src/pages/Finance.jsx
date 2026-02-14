import React, { useState, useEffect, useMemo } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Wallet, ArrowUpRight, ArrowDownLeft, Loader2, Filter, Trash2, CircleAlert, CircleCheck, ChevronDown, ChevronRight, EllipsisVertical, Send, CircleX } from 'lucide-react';
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

    // NEW State for Overdue Details
    const [showOverdueDetails, setShowOverdueDetails] = useState(false);
    const [isSchemaValid, setIsSchemaValid] = useState(true);
    const [rentLedger, setRentLedger] = useState([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [deletingBookingId, setDeletingBookingId] = useState(null);

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

            // Overdue per lease (within filter range — used for Expected/Paid KPIs only)
            if (leaseExpected > leaseActual) {
                overdueSum += (leaseExpected - leaseActual);
            }
        });

        // --- CALCULATE TOTAL OVERDUE (filter-independent: from lease start to today) ---
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);
        let totalOverdueAll = 0;

        currentLeases.forEach(lease => {
            if (!lease.start_date || !lease.unit) return;

            const monthlyRent = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
            if (monthlyRent <= 0) return;

            const leaseStart = new Date(lease.start_date);
            leaseStart.setDate(1);
            const leaseEnd = lease.end_date ? new Date(lease.end_date) : new Date(todayDate);

            let iter = new Date(leaseStart);
            while (iter <= leaseEnd && iter <= todayDate) {
                const year = iter.getFullYear();
                const month = String(iter.getMonth() + 1).padStart(2, '0');
                const monthStr = `${year}-${month}`;

                const paidSum = currentPayments
                    .filter(p => p.lease_id === lease.id && p.period_month && p.period_month.startsWith(monthStr))
                    .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

                if (paidSum < monthlyRent - 1) {
                    totalOverdueAll += (monthlyRent - paidSum);
                }
                iter.setMonth(iter.getMonth() + 1);
            }
        });

        setKpiData({
            expectedRent: totalExpected,
            paidRent: totalAllocatedActual,
            overdueRent: totalOverdueAll,
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

            // NEW: Fetch Ledger for Overdue Details
            const { data: ledgerData, error: ledgerError } = await supabase
                .from('rent_ledger')
                .select('*, lease:leases(*, tenant:tenants(*), unit:units(*, property:properties(*)))')
                .order('period_month', { ascending: false });

            if (ledgerError && ledgerError.code === '42P01') {
                setIsSchemaValid(false);
            } else {
                setIsSchemaValid(true);
                let currentLedger = ledgerData || [];
                if (selectedPortfolioID) {
                    currentLedger = currentLedger.filter(entry => entry.lease?.unit?.property?.portfolio_id === selectedPortfolioID);
                }
                setRentLedger(currentLedger);
            }

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

    const handleBatchMarkAsPaid = async (entries) => {
        try {
            setProcessingPaymentId('batch');

            // Build all payment records at once
            const paymentRecords = entries.map(entry => {
                const lease = entry.lease;
                const amount = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
                return {
                    user_id: user.id,
                    lease_id: lease.id,
                    payment_date: new Date().toISOString().split('T')[0],
                    period_month: `${entry.monthStr}-01`,
                    amount: amount,
                    note: `Miete ${entry.monthStr}`
                };
            });

            // Batch insert in chunks of 500 (Supabase limit)
            const chunkSize = 500;
            for (let i = 0; i < paymentRecords.length; i += chunkSize) {
                const chunk = paymentRecords.slice(i, i + chunkSize);
                const { error } = await supabase.from('rent_payments').insert(chunk);
                if (error) throw error;
            }

            // Single refresh at the end
            await fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setProcessingPaymentId(null);
        }
    };

    const handleDeleteBooking = async (row) => {
        try {
            setDeletingBookingId('deleting-' + row.id);
            const table = row.type === 'expense' ? 'expenses' : 'rent_payments';
            const { error } = await supabase.from(table).delete().eq('id', row.id);
            if (error) throw error;
            setDeletingBookingId(null);
            fetchData();
        } catch (error) {
            alert(translateError(error));
            setDeletingBookingId(null);
        }
    };

    // NEW: Ledger Actions
    const syncRentLedger = async () => {
        if (!isSchemaValid || !user || leases.length === 0) return;
        setIsSyncing(true);
        try {
            const todayLimit = new Date();
            const newEntries = [];
            const existingKeys = new Set(rentLedger.map(r => `${r.lease_id}_${r.period_month}`));

            for (const lease of leases) {
                if (!lease.start_date) continue;
                let iter = new Date(lease.start_date);
                iter.setDate(1);
                let end = lease.end_date ? new Date(lease.end_date) : todayLimit;
                if (end > todayLimit) end = todayLimit;

                while (iter <= end) {
                    const monthStr = iter.toISOString().split('T')[0];
                    if (!existingKeys.has(`${lease.id}_${monthStr}`)) {
                        const totalRent = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
                        const paidSum = rentPayments
                            .filter(p => p.lease_id === lease.id && p.period_month && p.period_month.startsWith(monthStr.slice(0, 7)))
                            .reduce((sum, p) => sum + (p.amount || 0), 0);

                        newEntries.push({
                            user_id: user.id,
                            lease_id: lease.id,
                            period_month: monthStr,
                            expected_rent: totalRent,
                            paid_amount: paidSum,
                            status: paidSum >= (totalRent - 1) ? 'paid' : 'open'
                        });
                    }
                    iter.setMonth(iter.getMonth() + 1);
                }
            }
            if (newEntries.length > 0) {
                const { error } = await supabase.from('rent_ledger').insert(newEntries);
                if (error) throw error;
            }
            fetchData();
        } catch (err) { alert(err.message); } finally { setIsSyncing(false); }
    };

    const handleLedgerAction = async (action, entry) => {
        try {
            if (action === 'mark_paid') {
                await supabase.from('rent_ledger').update({ status: 'paid', paid_amount: entry.expected_rent }).eq('id', entry.id);
                await supabase.from('rent_payments').insert([{
                    user_id: user.id, lease_id: entry.lease_id, payment_date: new Date().toISOString().split('T')[0], period_month: entry.period_month, amount: entry.expected_rent, note: 'Journal-Abgleich'
                }]);
            } else if (action === 'mark_loss') {
                await supabase.from('rent_ledger').update({ status: 'loss', expected_rent: 0, paid_amount: 0 }).eq('id', entry.id);
            } else if (action === 'send_reminder') {
                alert("Meldung: Mahnung wurde vorgemerkt (Kommt bald!)");
                return;
            }
            fetchData();
        } catch (err) { alert(err.message); }
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
                    {deletingBookingId === row.id ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#EF4444' }}>
                            Löschen?
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteBooking(row); }}
                                style={{ color: 'white', backgroundColor: '#EF4444', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                            >
                                Ja
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setDeletingBookingId(null); }}
                                style={{ color: '#6B7280', backgroundColor: 'var(--surface-color)', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                            >
                                Nein
                            </button>
                        </span>
                    ) : deletingBookingId === ('deleting-' + row.id) ? (
                        <Loader2 className="animate-spin" size={14} color="#6B7280" />
                    ) : (
                        <button
                            onClick={(e) => { e.stopPropagation(); setDeletingBookingId(row.id); }}
                            style={{ color: 'var(--text-secondary)', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', border: 'none', background: 'transparent' }}
                            title="Löschen"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Buchhaltung</h1>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
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
                <Card style={showOverdueDetails ? { border: '2px solid var(--danger-color)' } : {}}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Überfällige Mieten</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: kpiData.overdueRent > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
                                {kpiData.overdueRent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rückstände (kumuliert)</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowOverdueDetails(!showOverdueDetails)}>
                            {showOverdueDetails ? 'Schließen' : 'Details'}
                        </Button>
                    </div>
                </Card>
                <Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Überschuss / Cashflow</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: kpiData.surplus >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                        {kpiData.surplus.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Einnahmen - Ausgaben</div>
                </Card>
            </div>

            {!isSchemaValid ? (
                <Card style={{ backgroundColor: 'var(--surface-color)', borderColor: '#FEB2B2' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px', gap: '20px' }}>
                        <CircleAlert size={48} color="#E53E3E" />
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#C53030' }}>Datenbank-Update erforderlich</h3>
                        <p style={{ color: '#742A2A', textAlign: 'center', maxWidth: '600px' }}>
                            Eine neue Tabelle <code>rent_ledger</code> wird benötigt. Bitte SQL ausführen.
                        </p>
                        <pre style={{ backgroundColor: '#2D3748', color: '#E2E8F0', padding: '16px', borderRadius: '8px', overflow: 'auto', fontSize: '0.8rem', width: '100%' }}>
                            {`CREATE TABLE rent_ledger (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  lease_id uuid REFERENCES leases(id) ON DELETE CASCADE NOT NULL,
  period_month date NOT NULL,
  expected_rent decimal(10,2) DEFAULT 0,
  paid_amount decimal(10,2) DEFAULT 0,
  status text CHECK (status IN ('open','paid','loss')) DEFAULT 'open',
  UNIQUE(lease_id, period_month)
);`}
                        </pre>
                        <Button onClick={fetchData}>Erneut prüfen</Button>
                    </div>
                </Card>
            ) : (
                <>
                    {showOverdueDetails ? (
                        <OverdueRentsView
                            leases={leases}
                            rentPayments={rentPayments}
                            tenants={tenants}
                            onMarkPaid={handleMarkAsPaid}
                            onMarkAllPaid={handleBatchMarkAsPaid}
                            processingPaymentId={processingPaymentId}
                        />
                    ) : (
                        <Card title="Buchungen im Zeitraum">
                            {recentBookings.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Keine Buchungen gefunden.</div>
                            ) : (
                                <>
                                    <div className="hidden-mobile">
                                        <Table columns={bookingColumns} data={recentBookings} />
                                    </div>
                                    <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                        {recentBookings.map((row) => (
                                            <div key={row.id}
                                                onClick={() => {
                                                    if (deletingBookingId !== ('deleting-' + row.id) && deletingBookingId !== row.id) {
                                                        // Maybe show details or simulate delete? 
                                                        // For now just allow delete button inside to work
                                                    }
                                                }}
                                                style={{
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: 'var(--radius-md)',
                                                    padding: 'var(--spacing-md)',
                                                    backgroundColor: 'var(--surface-color)',
                                                    position: 'relative'
                                                }}>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                    <div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                            {new Date(row.date).toLocaleDateString()}
                                                        </div>
                                                        <div style={{ fontWeight: 600, fontSize: '1rem', marginTop: '2px', color: row.amount > 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                                            {row.amount > 0 ? '+' : ''}{Math.abs(parseFloat(row.amount)).toFixed(2)} €
                                                        </div>
                                                    </div>
                                                    <div>
                                                        {row.type === 'expense' ?
                                                            <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowUpRight size={10} /> Ausgabe</span> :
                                                            <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowDownLeft size={10} /> Einnahme</span>
                                                        }
                                                    </div>
                                                </div>

                                                <div style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '4px' }}>
                                                    {row.type === 'expense' ? (row.expense_categories?.name || 'Ausgabe') : 'Miete'}
                                                </div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                    {row.note}
                                                </div>

                                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        {row.type === 'income' ?
                                                            (row.lease?.unit?.property ? `${row.lease.unit.property.street} ${row.lease.unit.property.house_number}, ${row.lease.unit.unit_name}` : '-') :
                                                            (() => {
                                                                const p = properties.find(p => p.id === row.property_id);
                                                                return p ? `${p.street} ${p.house_number}` : 'Allgemein';
                                                            })()
                                                        }
                                                    </div>

                                                    {/* Delete Logic in Card */}
                                                    <div onClick={(e) => e.stopPropagation()}>
                                                        {deletingBookingId === row.id ? (
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#EF4444' }}>
                                                                Löschen?
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteBooking(row); }}
                                                                    style={{ color: 'white', backgroundColor: '#EF4444', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                                                                >
                                                                    Ja
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setDeletingBookingId(null); }}
                                                                    style={{ color: '#6B7280', backgroundColor: 'var(--surface-color)', border: '1px solid #D1D5DB', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                                                                >
                                                                    Nein
                                                                </button>
                                                            </span>
                                                        ) : deletingBookingId === ('deleting-' + row.id) ? (
                                                            <Loader2 className="animate-spin" size={14} color="#6B7280" />
                                                        ) : (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setDeletingBookingId(row.id); }}
                                                                style={{ color: 'var(--text-secondary)', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', border: 'none', background: 'transparent' }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </Card>
                    )}
                </>
            )}

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
                            // Group by lease (not by unit) so each tenant gets their own row
                            const relevantLeases = leases.filter(l =>
                                l.status === 'active' &&
                                (!filterPropertyId || l.unit?.property_id === filterPropertyId) &&
                                (!filterUnitId || l.unit_id === filterUnitId)
                            );
                            return relevantLeases.map(lease => {
                                const unit = allUnits.find(u => u.id === lease.unit_id);
                                if (!unit) return null;

                                const t = tenants.find(t => t.id === lease.tenant_id);
                                const tenantName = t ? `${t.last_name}, ${t.first_name}` : 'Unbekannt';

                                let totalExpected = 0;
                                let totalPaid = 0;
                                let missingMonths = [];

                                months.forEach(m => {
                                    const year = m.getFullYear();
                                    const month = String(m.getMonth() + 1).padStart(2, '0');
                                    const monthStr = `${year}-${month}`;
                                    const checkDate = `${monthStr}-01`;

                                    // Only include months where THIS lease is active
                                    if (lease.start_date <= checkDate && (!lease.end_date || lease.end_date >= checkDate)) {
                                        const expected = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
                                        totalExpected += expected;

                                        const payments = rentPayments.filter(p =>
                                            p.lease_id === lease.id &&
                                            p.period_month === `${monthStr}-01`
                                        );
                                        const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                                        totalPaid += paid;

                                        if (paid < expected - 1) {
                                            missingMonths.push({ date: m, str: monthStr, expected, paid });
                                        }
                                    }
                                });

                                if (totalExpected === 0) return null;

                                return {
                                    id: lease.id,
                                    unit_name: unit.unit_name,
                                    property: unit.property,
                                    tenant_name: tenantName,
                                    totalExpected,
                                    totalPaid,
                                    missingMonths,
                                    lease: lease,
                                    leaseId: lease.id
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
                            <CurrencyInput label="Betrag (€)" allowDecimals value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
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
                            <CurrencyInput label="Betrag (€)" allowDecimals value={incomeForm.amount} onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })} />
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Soll-Miete (Gesamt)</label>
                                <input
                                    type="text"
                                    disabled
                                    value={expectedRentDisplay ? `${expectedRentDisplay} €` : '-'}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', color: 'var(--text-secondary)' }}
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

// --- SUB-COMPONENTS FOR OVERDUE VIEW ---
const OverdueRentsView = ({ leases, rentPayments, tenants, onMarkPaid, onMarkAllPaid, processingPaymentId }) => {
    const [expandedIds, setExpandedIds] = useState(new Set());
    const [confirmingAllId, setConfirmingAllId] = useState(null);
    const [markingAllId, setMarkingAllId] = useState(null);

    const toggleExpand = (id) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setExpandedIds(newSet);
    };

    // Calculate overdue rents from leases and rent_payments (filter-independent)
    const overdueGroups = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const groupMap = new Map(); // key: lease.id (per tenant/lease, not per unit)

        leases.forEach(lease => {
            if (!lease.start_date || !lease.unit) return;

            const tenant = tenants.find(t => t.id === lease.tenant_id);
            const tenantName = tenant ? `${tenant.last_name}, ${tenant.first_name}` : 'Unbekannt';

            const leaseStart = new Date(lease.start_date);
            leaseStart.setDate(1); // Start of month
            const leaseEnd = lease.end_date ? new Date(lease.end_date) : new Date(today);

            const monthlyRent = (lease.cold_rent || 0) + (lease.service_charge || 0) + (lease.heating_cost || 0) + (lease.other_costs || 0);
            if (monthlyRent <= 0) return;

            let iter = new Date(leaseStart);
            while (iter <= leaseEnd && iter <= today) {
                const year = iter.getFullYear();
                const month = String(iter.getMonth() + 1).padStart(2, '0');
                const monthStr = `${year}-${month}`;
                const periodMonth = `${monthStr}-01`;

                // Check payments for this lease+month
                const paymentsForMonth = rentPayments.filter(p =>
                    p.lease_id === lease.id &&
                    p.period_month &&
                    p.period_month.startsWith(monthStr)
                );
                const paidSum = paymentsForMonth.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

                if (paidSum < monthlyRent - 1) { // tolerance 1€
                    const leaseKey = lease.id;
                    const due = monthlyRent - paidSum;

                    if (!groupMap.has(leaseKey)) {
                        groupMap.set(leaseKey, {
                            unitId: lease.unit_id,
                            unitName: lease.unit?.unit_name || 'Unbekannt',
                            property: lease.unit?.property,
                            tenantName,
                            tenantId: lease.tenant_id,
                            leaseId: lease.id,
                            lease,
                            totalOverdue: 0,
                            entries: []
                        });
                    }
                    const group = groupMap.get(leaseKey);
                    group.totalOverdue += due;
                    group.entries.push({
                        id: `${lease.id}_${periodMonth}`,
                        leaseId: lease.id,
                        lease,
                        monthStr,
                        periodMonth,
                        monthlyRent,
                        paidSum,
                        dueAmount: due
                    });
                }

                iter.setMonth(iter.getMonth() + 1);
            }
        });

        return Array.from(groupMap.values()).sort((a, b) => b.totalOverdue - a.totalOverdue);
    }, [leases, rentPayments, tenants]);

    if (overdueGroups.length === 0) {
        return (
            <Card title="Überfällige Mieten">
                <div style={{ padding: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'var(--surface-color)', padding: '1rem', borderRadius: '50%' }}><CircleCheck size={32} color="green" /></div>
                    <div>
                        <h4 style={{ fontWeight: 700 }}>Keine überfälligen Mieten!</h4>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Alle Mieten sind bezahlt.</p>
                    </div>
                </div>
            </Card>
        );
    }

    const totalAllOverdue = overdueGroups.reduce((sum, g) => sum + g.totalOverdue, 0);

    return (
        <Card title="Überfällige Mieten" headerAction={
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#EF4444' }}>
                Gesamt: {totalAllOverdue.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            </span>
        }>
            {markingAllId ? (
                <div style={{
                    padding: '4rem 2rem', textAlign: 'center',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: '12px'
                }}>
                    <Loader2 className="animate-spin" size={36} color="#16a34a" />
                    <span style={{ fontSize: '1rem', fontWeight: 600, color: '#374151' }}>Zahlungen werden eingetragen...</span>
                    <span style={{ fontSize: '0.85rem', color: '#6B7280' }}>Bitte warten, die Daten werden gespeichert.</span>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 2fr 1.5fr 1.2fr 0.3fr', padding: '10px 16px', background: '#F9FAFB', borderBottom: '2px solid #E5E7EB', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        <div>Objekt / Einheit</div>
                        <div>Mieter</div>
                        <div>Status</div>
                        <div style={{ textAlign: 'right' }}>Summe</div>
                        <div></div>
                    </div>
                    {/* Rows */}
                    {overdueGroups.map(group => (
                        <div key={group.unitId} style={{ borderBottom: '1px solid #eee' }}>
                            <div
                                onClick={() => toggleExpand(group.unitId)}
                                style={{
                                    display: 'grid', gridTemplateColumns: '2.5fr 2fr 1.5fr 1.2fr 0.3fr',
                                    padding: '14px 16px', alignItems: 'center', cursor: 'pointer',
                                    backgroundColor: expandedIds.has(group.unitId) ? '#FEF2F2' : 'white',
                                    transition: 'background-color 0.15s'
                                }}
                                onMouseEnter={e => { if (!expandedIds.has(group.unitId)) e.currentTarget.style.backgroundColor = '#FAFAFA'; }}
                                onMouseLeave={e => { if (!expandedIds.has(group.unitId)) e.currentTarget.style.backgroundColor = 'white'; }}
                            >
                                <div>
                                    <div style={{ fontWeight: 600 }}>{group.property?.street} {group.property?.house_number}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>{group.unitName}</div>
                                </div>
                                <div style={{ fontWeight: 500 }}>{group.tenantName}</div>
                                <div>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                        padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600,
                                        backgroundColor: 'var(--surface-color)', color: '#DC2626'
                                    }}>
                                        <CircleAlert size={12} /> {group.entries.length} Monat{group.entries.length !== 1 ? 'e' : ''} offen
                                    </span>
                                </div>
                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444', fontSize: '1rem' }}>
                                    {group.totalOverdue.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    {expandedIds.has(group.unitId) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </div>
                            </div>
                            {/* Expanded: individual overdue months */}
                            {expandedIds.has(group.unitId) && (
                                <div style={{ backgroundColor: 'var(--background-color)', padding: '4px 16px 8px' }}>
                                    {/* Sub-header */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 0.6fr', padding: '8px 8px 6px', fontSize: '0.7rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB' }}>
                                        <div>Monat</div>
                                        <div style={{ textAlign: 'right' }}>Soll</div>
                                        <div style={{ textAlign: 'right' }}>Bezahlt</div>
                                        <div style={{ textAlign: 'right' }}>Offen</div>
                                        <div style={{ textAlign: 'right' }}>Aktion</div>
                                    </div>
                                    {group.entries.sort((a, b) => b.monthStr.localeCompare(a.monthStr)).map(entry => (
                                        <div
                                            key={entry.id}
                                            style={{
                                                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 0.6fr',
                                                padding: '10px 8px', alignItems: 'center',
                                                borderBottom: '1px solid #F3F4F6',
                                                fontSize: '0.88rem'
                                            }}
                                        >
                                            <span style={{ fontWeight: 600 }}>
                                                {new Date(entry.periodMonth).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                                            </span>
                                            <span style={{ textAlign: 'right', color: '#6B7280' }}>{entry.monthlyRent.toFixed(2)} €</span>
                                            <span style={{ textAlign: 'right', color: entry.paidSum > 0 ? 'var(--success-color)' : '#6B7280' }}>{entry.paidSum.toFixed(2)} €</span>
                                            <span style={{ textAlign: 'right', color: '#EF4444', fontWeight: 700 }}>{entry.dueAmount.toFixed(2)} €</span>
                                            <div style={{ textAlign: 'right' }}>
                                                <OverdueActionMenu
                                                    onMarkPaid={() => onMarkPaid(entry.lease, entry.monthStr)}
                                                    isProcessing={processingPaymentId === `${entry.leaseId}-${entry.monthStr}`}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                    {/* Alle als bezahlt markieren Button */}
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '12px 8px 8px', borderTop: '1px solid #E5E7EB', marginTop: '4px' }}>
                                        {markingAllId === group.unitId ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#6B7280' }}>
                                                <Loader2 className="animate-spin" size={14} /> Wird markiert...
                                            </span>
                                        ) : confirmingAllId === group.unitId ? (
                                            <>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
                                                    Wirklich alle {group.entries.length} Monate markieren?
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setConfirmingAllId(null);
                                                        setMarkingAllId(group.unitId);
                                                        const markAll = async () => {
                                                            await onMarkAllPaid(group.entries);
                                                            setMarkingAllId(null);
                                                        };
                                                        markAll();
                                                    }}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600,
                                                        border: 'none', backgroundColor: '#16a34a', color: 'white',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <CircleCheck size={13} /> Ja
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setConfirmingAllId(null); }}
                                                    style={{
                                                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600,
                                                        border: '1px solid #D1D5DB', backgroundColor: 'var(--surface-color)', color: '#6B7280',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Abbrechen
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setConfirmingAllId(group.unitId); }}
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                    padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
                                                    border: '1px solid #16a34a', backgroundColor: 'var(--surface-color)', color: '#16a34a',
                                                    cursor: 'pointer', transition: 'all 0.15s'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#16a34a'; e.currentTarget.style.color = 'white'; }}
                                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#F0FFF4'; e.currentTarget.style.color = '#16a34a'; }}
                                            >
                                                <CircleCheck size={14} /> Alle als bezahlt markieren
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
};

const OverdueActionMenu = ({ onMarkPaid, isProcessing }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [hoveredItem, setHoveredItem] = useState(null);

    useEffect(() => {
        const close = () => setIsOpen(false);
        if (isOpen) window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [isOpen]);

    if (isProcessing) {
        return <Loader2 className="animate-spin" size={16} />;
    }

    return (
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
                style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F3F4F6'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
                <EllipsisVertical size={18} />
            </button>
            {isOpen && (
                <div style={{
                    position: 'absolute', right: 0, top: '100%', width: '220px',
                    backgroundColor: 'var(--surface-color)', borderRadius: '8px',
                    boxShadow: '0 10px 25px -3px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)',
                    zIndex: 100, border: '1px solid #E5E7EB', padding: '4px',
                    animation: 'fadeIn 0.12s ease-out'
                }}>
                    <div
                        onClick={() => { onMarkPaid(); setIsOpen(false); }}
                        onMouseEnter={() => setHoveredItem('paid')}
                        onMouseLeave={() => setHoveredItem(null)}
                        style={{
                            padding: '10px 12px', fontSize: '0.85rem', cursor: 'pointer', borderRadius: '6px',
                            display: 'flex', gap: '10px', alignItems: 'center',
                            backgroundColor: hoveredItem === 'paid' ? '#F0FFF4' : 'transparent',
                            transition: 'background-color 0.12s'
                        }}
                    >
                        <CircleCheck size={15} color="#16a34a" /> Als bezahlt markieren
                    </div>
                    <div
                        onClick={() => { alert('Mahnung wurde vorgemerkt (Kommt bald!)'); setIsOpen(false); }}
                        onMouseEnter={() => setHoveredItem('reminder')}
                        onMouseLeave={() => setHoveredItem(null)}
                        style={{
                            padding: '10px 12px', fontSize: '0.85rem', cursor: 'pointer', borderRadius: '6px',
                            display: 'flex', gap: '10px', alignItems: 'center',
                            backgroundColor: hoveredItem === 'reminder' ? '#EFF6FF' : 'transparent',
                            transition: 'background-color 0.12s'
                        }}
                    >
                        <Send size={15} color="#2563EB" /> Mahnung senden
                    </div>
                </div>
            )}
        </div>
    );
};

export default Finance;
