import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, ArrowUpRight, ArrowDownLeft, Loader2, Filter, Trash2, CircleAlert, CircleCheck, ChevronDown, ChevronRight, EllipsisVertical, Send, Banknote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import ExportDropdown from '../components/ExportDropdown';
import {
    RENT_TOLERANCE,
    num,
    round2,
    toLocalDateStr,
    toMonthStr,
    parseDateOnly,
    monthsBetween,
    leaseMonthlyRent,
    leaseActiveRatio,
    expectedRentForMonth,
    paidForMonth,
    dueDateForMonth,
    leaseBookingStartMonth,
    ledgerKey,
    buildRentIndex,
    computeArrears,
    summarizeHidden,
    filterExpensesByPortfolio,
    fetchAllRows,
    loadMahnverfahren,
    isMissingRelationError
} from '../lib/rentArrears';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const BOOKINGS_PAGE_SIZE = 50;

// --- Hilfsfunktionen (ohne React-State) ---
const eur = (v) => num(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const formatDateDE = (value) => {
    const d = parseDateOnly(value);
    return d ? d.toLocaleDateString('de-DE') : '-';
};
const formatMonthDE = (monthStr) => {
    const d = parseDateOnly(`${monthStr}-01`);
    return d ? d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : monthStr;
};
const tenantLabel = (t) => {
    if (!t) return 'Unbekannt';
    return [t.last_name, t.first_name].filter(Boolean).join(', ') || 'Unbekannt';
};
const propertyLabel = (p) => (p ? `${p.street || ''} ${p.house_number || ''}`.trim() : '');
const leaseMatchesFilter = (lease, propertyId, unitId) => {
    if (!propertyId && !unitId) return true;
    if (!lease) return false;
    if (propertyId && lease.unit?.property_id !== propertyId) return false;
    if (unitId && lease.unit_id !== unitId) return false;
    return true;
};
const isCurrentLease = (lease, todayStr) =>
    lease.status === 'active' && lease.start_date <= todayStr && (!lease.end_date || lease.end_date >= todayStr);
// Vertrag für einen Monat wählen: bevorzugt der in diesem Monat laufende, sonst der jüngste
const pickLeaseForMonth = (candidates, monthStr) => {
    if (!candidates || candidates.length === 0) return null;
    const covering = monthStr ? candidates.filter(l => leaseActiveRatio(l, monthStr) > 0) : [];
    const pool = covering.length > 0 ? covering : candidates;
    return [...pool].sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))[0];
};
const leaseOptionLabel = (lease) => {
    const from = formatDateDE(lease.start_date);
    const to = lease.end_date ? formatDateDE(lease.end_date) : 'unbefristet';
    const status = lease.status === 'active' ? 'aktiv' : (lease.status || 'beendet');
    return `${from} – ${to} (${status})`;
};

const getEmptyExpenseForm = () => ({
    booking_date: toLocalDateStr(),
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

const getEmptyIncomeForm = () => ({
    payment_date: toLocalDateStr(),
    period_month: toMonthStr(), // YYYY-MM
    amount: '',
    note: '',
    tenant_id: '',
    property_id: '',
    unit_id: '',
    lease_id: ''
});

const MAHN_HINT = 'Dieser Monat ist Teil einer laufenden Forderungsakte. Bitte die Zahlung in der Forderungsakte erfassen, damit Forderung und Mietkonto übereinstimmen.';

const Finance = () => {
    const { user } = useAuth();
    const userId = user?.id;
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const location = useLocation();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [loadWarnings, setLoadWarnings] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const requestIdRef = useRef(0);

    const [showOverdueDetails, setShowOverdueDetails] = useState(() => location.state?.view === 'overdue_details');
    useEffect(() => {
        if (location.state?.view) {
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location.state, navigate, location.pathname]);

    // Rohdaten (alle für den Nutzer sichtbaren Zeilen, seitenweise geladen)
    const [rawExpenses, setRawExpenses] = useState([]);
    const [rawPayments, setRawPayments] = useState([]);
    const [rawLeases, setRawLeases] = useState([]);
    const [rawUnits, setRawUnits] = useState([]);
    const [rawProperties, setRawProperties] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [categories, setCategories] = useState([]);
    const [ledgerRows, setLedgerRows] = useState([]);
    const [mahnverfahrenMonths, setMahnverfahrenMonths] = useState(() => new Set());
    const [mahnverfahrenClaims, setMahnverfahrenClaims] = useState(() => new Map());

    // Filters
    const [filterStartDate, setFilterStartDate] = useState(() => {
        const t = new Date();
        return toLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1));
    });
    const [filterEndDate, setFilterEndDate] = useState(() => {
        const t = new Date();
        return toLocalDateStr(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    });
    const [filterPropertyId, setFilterPropertyId] = useState('');
    const [filterUnitId, setFilterUnitId] = useState('');
    const [bookingsLimit, setBookingsLimit] = useState(BOOKINGS_PAGE_SIZE);
    const [includeBeforeBookingStart, setIncludeBeforeBookingStart] = useState(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [bookingType, setBookingType] = useState('expense'); // expense, income
    const [isExpectedDetailsOpen, setIsExpectedDetailsOpen] = useState(false);
    const [isPaidDetailsOpen, setIsPaidDetailsOpen] = useState(false);
    const [processingPaymentId, setProcessingPaymentId] = useState(null);
    const [deletingBookingId, setDeletingBookingId] = useState(null);

    // Forms
    const [expenseForm, setExpenseForm] = useState(getEmptyExpenseForm);
    const [incomeForm, setIncomeForm] = useState(getEmptyIncomeForm);

    // Fetch Data
    const fetchData = useCallback(async () => {
        if (!userId) return;
        const requestId = ++requestIdRef.current;
        try {
            const [propRes, unitRes, leaseRes, tenantRes, payRes, expRes, catRes, ledgerRes] = await Promise.all([
                fetchAllRows('properties', 'id, street, house_number, portfolio_id', q => q.order('street')),
                fetchAllRows('units', 'id, unit_name, property_id, is_vacation_rental', q => q.order('unit_name')),
                fetchAllRows('leases', '*'),
                fetchAllRows('tenants', 'id, first_name, last_name', q => q.order('last_name')),
                fetchAllRows('rent_payments', '*', q => q.order('payment_date', { ascending: false })),
                fetchAllRows('expenses', '*, expense_categories(name)', q => q.order('booking_date', { ascending: false })),
                supabase.from('expense_categories').select('*'),
                fetchAllRows('rent_ledger', 'id, lease_id, period_month, due_date, expected_rent, paid_amount, status')
            ]);
            if (requestId !== requestIdRef.current) return;

            const firstError = [propRes, unitRes, leaseRes, tenantRes, payRes, expRes].find(r => r.error)?.error;
            if (firstError) throw firstError;

            const warnings = [];
            if (catRes.error) warnings.push('Kostenarten konnten nicht geladen werden.');
            let ledger = [];
            if (ledgerRes.error) {
                if (!isMissingRelationError(ledgerRes.error)) {
                    warnings.push('Das Mietkonto konnte nicht geladen werden – Soll und Rückstände werden aus den Mietverträgen berechnet.');
                }
            } else {
                ledger = ledgerRes.data || [];
            }

            // Verknüpfen im Speicher statt verschachtelter Joins
            const propMap = new Map((propRes.data || []).map(p => [p.id, p]));
            const unitList = (unitRes.data || []).map(u => ({ ...u, property: propMap.get(u.property_id) || null }));
            const unitMap = new Map(unitList.map(u => [u.id, u]));
            const leaseList = (leaseRes.data || []).map(l => ({ ...l, unit: unitMap.get(l.unit_id) || null }));
            const leaseMap = new Map(leaseList.map(l => [l.id, l]));
            const paymentList = (payRes.data || []).map(p => ({ ...p, lease: leaseMap.get(p.lease_id) || null }));

            const mahn = await loadMahnverfahren(ledger);
            if (requestId !== requestIdRef.current) return;
            if (mahn.error) {
                warnings.push('Der Mahnstatus (Forderungsakten) konnte nicht geladen werden – Monate im Mahnverfahren können als offen erscheinen.');
            }

            setRawProperties(propRes.data || []);
            setRawUnits(unitList);
            setRawLeases(leaseList);
            setRawPayments(paymentList);
            setRawExpenses(expRes.data || []);
            setTenants(tenantRes.data || []);
            setCategories(catRes.data || []);
            setLedgerRows(ledger);
            setMahnverfahrenMonths(mahn.keys);
            setMahnverfahrenClaims(mahn.claimByKey);
            setLoadWarnings(warnings);
            setLoadError(null);
            setHasLoaded(true);
        } catch (error) {
            if (requestId !== requestIdRef.current) return;
            console.error('Error fetching finance data:', error);
            setLoadError(translateError(error));
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // --- Portfolio-Sicht ---
    const ownPortfolioIds = useMemo(
        () => (portfolios || []).filter(p => p.user_id === userId).map(p => p.id),
        [portfolios, userId]
    );

    const scoped = useMemo(() => {
        const pid = selectedPortfolioID;
        const propertyPortfolio = new Map(rawProperties.map(p => [p.id, p.portfolio_id]));
        const includeUnassigned = !pid || (ownPortfolioIds.length === 1 && ownPortfolioIds[0] === pid);
        const { list: expenseList, hiddenUnassigned } = filterExpensesByPortfolio(rawExpenses, { selectedPortfolioID: pid, propertyPortfolio, includeUnassigned });
        if (!pid) {
            return { properties: rawProperties, units: rawUnits, leases: rawLeases, payments: rawPayments, expenses: expenseList, hiddenUnassigned };
        }
        return {
            properties: rawProperties.filter(p => p.portfolio_id === pid),
            units: rawUnits.filter(u => u.property?.portfolio_id === pid),
            leases: rawLeases.filter(l => l.unit?.property?.portfolio_id === pid),
            payments: rawPayments.filter(p => p.lease?.unit?.property?.portfolio_id === pid),
            expenses: expenseList,
            hiddenUnassigned
        };
    }, [rawProperties, rawUnits, rawLeases, rawPayments, rawExpenses, selectedPortfolioID, ownPortfolioIds]);

    const { properties, units: allUnits, leases, payments: rentPayments, expenses, hiddenUnassigned } = scoped;

    const propertyById = useMemo(() => new Map(rawProperties.map(p => [p.id, p])), [rawProperties]);
    const tenantsById = useMemo(() => new Map(tenants.map(t => [t.id, t])), [tenants]);
    const rentIndex = useMemo(() => buildRentIndex({ ledgerRows, payments: rawPayments }), [ledgerRows, rawPayments]);

    const filterUnits = useMemo(
        () => (filterPropertyId ? allUnits.filter(u => u.property_id === filterPropertyId) : []),
        [allUnits, filterPropertyId]
    );

    // --- Rückstände (gemeinsame Logik mit dem Dashboard) ---
    const arrears = useMemo(
        () => computeArrears({ leases, index: rentIndex, mahnKeys: mahnverfahrenMonths, includeBeforeBookingStart }),
        [leases, rentIndex, mahnverfahrenMonths, includeBeforeBookingStart]
    );

    const overdueEntries = useMemo(
        () => arrears.entries.filter(e => leaseMatchesFilter(e.lease, filterPropertyId, filterUnitId)),
        [arrears, filterPropertyId, filterUnitId]
    );
    const overdueHidden = useMemo(
        () => summarizeHidden(arrears.hiddenEntries.filter(e => leaseMatchesFilter(e.lease, filterPropertyId, filterUnitId))),
        [arrears, filterPropertyId, filterUnitId]
    );
    // KPI-Kachel: dieselben Objekt-/Einheitenfilter wie die Detailansicht (ohne Filter = Wert im Dashboard)
    const overdueTotal = useMemo(
        () => round2(overdueEntries.reduce((s, e) => s + (e.isMahn ? 0 : e.open), 0)),
        [overdueEntries]
    );

    // --- KPIs und Buchungsliste ---
    const finance = useMemo(() => {
        const months = monthsBetween(filterStartDate, filterEndDate);
        const firstMonth = months[0];
        const lastMonth = months[months.length - 1];

        const filteredExpenses = expenses.filter(e => {
            if (!e.booking_date || e.booking_date < filterStartDate || e.booking_date > filterEndDate) return false;
            if (filterPropertyId && e.property_id !== filterPropertyId) return false;
            if (filterUnitId && e.unit_id !== filterUnitId) return false;
            return true;
        });

        // Zahlungseingänge (Cashflow): nach Zahldatum – wie die Buchungsliste
        const filteredPayments = rentPayments.filter(p =>
            p.payment_date && p.payment_date >= filterStartDate && p.payment_date <= filterEndDate &&
            leaseMatchesFilter(p.lease, filterPropertyId, filterUnitId)
        );

        const totalExpenses = round2(filteredExpenses.reduce((sum, e) => sum + num(e.amount), 0));
        const paidCashflow = round2(filteredPayments.reduce((sum, p) => sum + num(p.amount), 0));

        // Soll: je Vertrag und Monat (Mietkonto, sonst Vertrag tagesanteilig)
        let expectedRent = 0;
        leases.forEach(lease => {
            if (!leaseMatchesFilter(lease, filterPropertyId, filterUnitId)) return;
            months.forEach(m => {
                expectedRent += expectedRentForMonth(lease, m, rentIndex.ledgerByKey.get(ledgerKey(lease.id, m)));
            });
        });

        // Periodengerechte Sicht: Zahlungen, die Monaten im Zeitraum zugeordnet sind (ohne Monat: Zahldatum)
        let paidAllocated = 0;
        if (firstMonth) {
            rentPayments.forEach(p => {
                if (!leaseMatchesFilter(p.lease, filterPropertyId, filterUnitId)) return;
                const m = String(p.period_month || p.payment_date || '').slice(0, 7);
                if (m && m >= firstMonth && m <= lastMonth) paidAllocated += num(p.amount);
            });
        }

        const bookings = [
            ...filteredExpenses.map(e => ({ ...e, type: 'expense', date: e.booking_date, amount: -num(e.amount) })),
            ...filteredPayments.map(r => ({ ...r, type: 'income', date: r.payment_date, amount: num(r.amount) }))
        ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

        return {
            kpi: {
                expectedRent: round2(expectedRent),
                paidRent: paidCashflow,
                paidAllocated: round2(paidAllocated),
                totalExpenses,
                surplus: round2(paidCashflow - totalExpenses)
            },
            bookings
        };
    }, [expenses, rentPayments, leases, rentIndex, filterStartDate, filterEndDate, filterPropertyId, filterUnitId]);

    const kpiData = finance.kpi;
    const allBookings = finance.bookings;
    const recentBookings = useMemo(() => allBookings.slice(0, bookingsLimit), [allBookings, bookingsLimit]);

    // --- Detail-Modals (nur bei geöffnetem Modal berechnet) ---
    const expectedDetails = useMemo(() => {
        if (!isExpectedDetailsOpen) return [];
        const months = monthsBetween(filterStartDate, filterEndDate);
        const leasesByUnit = new Map();
        leases.forEach(l => {
            if (!leasesByUnit.has(l.unit_id)) leasesByUnit.set(l.unit_id, []);
            leasesByUnit.get(l.unit_id).push(l);
        });
        return allUnits
            .filter(u => (!filterPropertyId || u.property_id === filterPropertyId) && (!filterUnitId || u.id === filterUnitId))
            .map(unit => {
                let totalRent = 0;
                let latest = null;
                const names = [];
                (leasesByUnit.get(unit.id) || []).forEach(lease => {
                    let leaseTotal = 0;
                    months.forEach(m => {
                        leaseTotal += expectedRentForMonth(lease, m, rentIndex.ledgerByKey.get(ledgerKey(lease.id, m)));
                    });
                    if (leaseTotal <= 0) return;
                    totalRent += leaseTotal;
                    const name = tenantLabel(tenantsById.get(lease.tenant_id));
                    if (!names.includes(name)) names.push(name);
                    if (!latest || (lease.start_date || '') > (latest.start_date || '')) latest = lease;
                });
                return {
                    id: unit.id,
                    unit_name: unit.unit_name,
                    property: unit.property,
                    tenant_name: names.length > 0 ? names.join(' / ') : null,
                    isVacationRental: !!unit.is_vacation_rental,
                    monthlyRent: latest ? leaseMonthlyRent(latest) : 0,
                    totalRent: round2(totalRent)
                };
            });
    }, [isExpectedDetailsOpen, filterStartDate, filterEndDate, filterPropertyId, filterUnitId, leases, allUnits, rentIndex, tenantsById]);

    const paidDetails = useMemo(() => {
        if (!isPaidDetailsOpen) return [];
        const months = monthsBetween(filterStartDate, filterEndDate);
        return leases
            .filter(l => leaseMatchesFilter(l, filterPropertyId, filterUnitId))
            .map(lease => {
                let totalExpected = 0;
                let totalPaid = 0;
                const missingMonths = [];
                const bookingStartM = leaseBookingStartMonth(lease);
                months.forEach(m => {
                    const expected = expectedRentForMonth(lease, m, rentIndex.ledgerByKey.get(ledgerKey(lease.id, m)));
                    if (expected <= 0) return;
                    const paid = paidForMonth(rentIndex, lease.id, m);
                    totalExpected += expected;
                    totalPaid += paid;
                    if (expected - paid > RENT_TOLERANCE) {
                        missingMonths.push({
                            str: m,
                            expected,
                            paid,
                            isMahn: mahnverfahrenMonths.has(ledgerKey(lease.id, m)),
                            beforeBookingStart: !!bookingStartM && m < bookingStartM
                        });
                    }
                });
                if (totalExpected <= 0) return null;
                return {
                    id: lease.id,
                    unit_name: lease.unit?.unit_name || 'Unbekannt',
                    property: lease.unit?.property,
                    tenant_name: tenantLabel(tenantsById.get(lease.tenant_id)),
                    totalExpected: round2(totalExpected),
                    totalPaid: round2(totalPaid),
                    missingMonths,
                    lease,
                    leaseId: lease.id
                };
            })
            .filter(Boolean);
    }, [isPaidDetailsOpen, filterStartDate, filterEndDate, filterPropertyId, filterUnitId, leases, rentIndex, tenantsById, mahnverfahrenMonths]);

    // --- Mieteingang: Auswahl von Mieter / Einheit / Vertrag ---
    const tenantOptions = useMemo(() => {
        const todayStr = toLocalDateStr();
        const byTenant = new Map();
        leases.forEach(l => {
            if (!l.tenant_id) return;
            const current = isCurrentLease(l, todayStr);
            const prev = byTenant.get(l.tenant_id);
            if (!prev || (current && !prev.current) || (current === prev.current && (l.start_date || '') > (prev.lease.start_date || ''))) {
                byTenant.set(l.tenant_id, { lease: l, current });
            }
        });
        return [...byTenant.entries()]
            .map(([tenantId, { lease, current }]) => {
                const name = tenantLabel(tenantsById.get(tenantId));
                const place = [propertyLabel(lease.unit?.property), lease.unit?.unit_name].filter(Boolean).join(', ');
                return {
                    id: tenantId,
                    label: `${name}${place ? ` – ${place}` : ''}${current ? '' : ' (kein laufender Vertrag)'}`,
                    sortKey: name.toLowerCase()
                };
            })
            .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'de'));
    }, [leases, tenantsById]);

    const incomeLeaseCandidates = useMemo(() => {
        if (!incomeForm.tenant_id || !incomeForm.unit_id) return [];
        return leases.filter(l => l.tenant_id === incomeForm.tenant_id && l.unit_id === incomeForm.unit_id);
    }, [leases, incomeForm.tenant_id, incomeForm.unit_id]);

    const selectedIncomeLease = useMemo(() => {
        if (incomeForm.lease_id) {
            const chosen = incomeLeaseCandidates.find(l => l.id === incomeForm.lease_id);
            if (chosen) return chosen;
        }
        return pickLeaseForMonth(incomeLeaseCandidates, incomeForm.period_month);
    }, [incomeLeaseCandidates, incomeForm.lease_id, incomeForm.period_month]);

    const expectedRentDisplay = useMemo(() => {
        if (!selectedIncomeLease) return null;
        if (incomeForm.period_month) {
            const row = rentIndex.ledgerByKey.get(ledgerKey(selectedIncomeLease.id, incomeForm.period_month));
            return expectedRentForMonth(selectedIncomeLease, incomeForm.period_month, row).toFixed(2);
        }
        return leaseMonthlyRent(selectedIncomeLease).toFixed(2);
    }, [selectedIncomeLease, incomeForm.period_month, rentIndex]);

    const formUnits = useMemo(() => {
        const propId = bookingType === 'expense' ? expenseForm.property_id : incomeForm.property_id;
        if (!propId) return [];
        return allUnits
            .filter(u => u.property_id === propId)
            .sort((a, b) => String(a.unit_name || '').localeCompare(String(b.unit_name || ''), 'de', { numeric: true }));
    }, [allUnits, bookingType, expenseForm.property_id, incomeForm.property_id]);

    // Handlers for Dynamic Form Behavior
    const handleTenantChange = (e) => {
        const newTenantId = e.target.value;
        const todayStr = toLocalDateStr();
        const tenantLeases = leases.filter(l => l.tenant_id === newTenantId);
        const preferred = tenantLeases.find(l => isCurrentLease(l, todayStr)) || pickLeaseForMonth(tenantLeases, null);
        setIncomeForm(prev => {
            const next = { ...prev, tenant_id: newTenantId, lease_id: '' };
            if (newTenantId && preferred && preferred.unit) {
                next.property_id = preferred.unit.property_id;
                next.unit_id = preferred.unit_id;
            }
            return next;
        });
    };

    const handleUnitChange = (e) => {
        const newUnitId = e.target.value;
        const todayStr = toLocalDateStr();
        setIncomeForm(prev => {
            const next = { ...prev, unit_id: newUnitId, lease_id: '' };
            if (!newUnitId) return next;
            const unitLeases = leases.filter(l => l.unit_id === newUnitId);
            // Gewählten Mieter behalten, wenn er (auch früher) in dieser Einheit gewohnt hat
            if (prev.tenant_id && unitLeases.some(l => l.tenant_id === prev.tenant_id)) return next;
            const current = unitLeases.find(l => isCurrentLease(l, todayStr));
            next.tenant_id = current ? current.tenant_id : '';
            return next;
        });
    };

    const openBookingModal = () => {
        setExpenseForm(getEmptyExpenseForm());
        setIncomeForm(getEmptyIncomeForm());
        setBookingType('expense');
        setIsModalOpen(true);
    };

    const handleSaveExpense = async () => {
        if (isSaving) return;
        const amount = num(expenseForm.amount);
        if (!expenseForm.booking_date) return alert('Bitte ein Buchungsdatum angeben.');
        if (!(amount > 0)) return alert('Bitte einen Betrag größer 0 eingeben.');
        if (expenseForm.scope === 'unit' && (!expenseForm.property_id || !expenseForm.unit_id)) {
            return alert('Bitte Immobilie und Einheit wählen (oder Zuordnung „Allgemein“).');
        }

        setIsSaving(true);
        try {
            const unitId = expenseForm.scope === 'unit' ? (expenseForm.unit_id || null) : null;
            const { error } = await supabase.from('expenses').insert([{
                user_id: user.id,
                booking_date: expenseForm.booking_date,
                payee: expenseForm.payee.trim() || null,
                category_id: expenseForm.category_id || null,
                category_custom: expenseForm.category_id ? null : (expenseForm.category_custom.trim() || null),
                property_id: expenseForm.property_id || null,
                unit_id: unitId,
                scope: unitId ? 'unit' : 'general',
                amount: round2(amount),
                is_allocatable: expenseForm.is_allocatable,
                note: expenseForm.note.trim() || null
            }]);

            if (error) throw error;
            setIsModalOpen(false);
            setExpenseForm(getEmptyExpenseForm());
            await fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveIncome = async () => {
        if (isSaving) return;
        const amount = num(incomeForm.amount);
        if (!incomeForm.tenant_id || !incomeForm.unit_id) return alert('Bitte Mieter und Einheit wählen.');
        if (!incomeForm.payment_date) return alert('Bitte ein Zahldatum angeben.');
        if (!incomeForm.period_month) return alert('Bitte den Monat angeben, für den die Zahlung gilt.');
        if (!(amount > 0)) return alert('Bitte einen Betrag größer 0 eingeben.');
        const lease = selectedIncomeLease;
        if (!lease) return alert('Für diesen Mieter wurde in dieser Einheit kein Mietvertrag gefunden.');
        if (mahnverfahrenMonths.has(ledgerKey(lease.id, incomeForm.period_month))) return alert(MAHN_HINT);

        setIsSaving(true);
        try {
            const { error } = await supabase.from('rent_payments').insert([{
                user_id: user.id,
                lease_id: lease.id,
                payment_date: incomeForm.payment_date,
                period_month: `${incomeForm.period_month}-01`,
                amount: round2(amount),
                note: incomeForm.note.trim() || null
            }]);

            if (error) throw error;
            setIsModalOpen(false);
            setIncomeForm(getEmptyIncomeForm());
            await fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // Zahlung für einen Monat buchen. Monate vor dem Buchungsbeginn werden als Eröffnungsbuchung mit dem
    // jeweiligen Fälligkeitsdatum gebucht, damit sie die Einnahmen des aktuellen Zeitraums nicht aufblähen.
    const buildPaymentRecord = (lease, monthStr, amount, opening) => ({
        user_id: user.id,
        lease_id: lease.id,
        payment_date: opening ? dueDateForMonth(lease, monthStr) : toLocalDateStr(),
        period_month: `${monthStr}-01`,
        amount: round2(amount),
        note: opening ? `Eröffnungsbuchung Miete ${monthStr}` : `Miete ${monthStr}`
    });

    const handleMarkAsPaid = async (lease, monthStr, amount, opening = false) => {
        if (!lease || !(num(amount) > 0)) return;
        if (mahnverfahrenMonths.has(ledgerKey(lease.id, monthStr))) {
            alert(MAHN_HINT);
            return;
        }
        try {
            setProcessingPaymentId(`${lease.id}-${monthStr}`);
            const { error } = await supabase.from('rent_payments').insert([buildPaymentRecord(lease, monthStr, amount, opening)]);
            if (error) throw error;
            await fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setProcessingPaymentId(null);
        }
    };

    const handleBatchMarkAsPaid = async (entries) => {
        // Monate im Mahnverfahren nur über die Forderungsakte buchen
        const bookable = (entries || []).filter(e => !e.isMahn && num(e.open) > 0);
        if (bookable.length === 0) return;
        try {
            setProcessingPaymentId('batch');
            const paymentRecords = bookable.map(e => buildPaymentRecord(e.lease, e.monthStr, e.open, e.beforeBookingStart));

            // Batch insert in chunks of 500
            const chunkSize = 500;
            for (let i = 0; i < paymentRecords.length; i += chunkSize) {
                const chunk = paymentRecords.slice(i, i + chunkSize);
                const { error } = await supabase.from('rent_payments').insert(chunk);
                if (error) throw error;
            }

            await fetchData();
        } catch (error) {
            alert(translateError(error));
            await fetchData();
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
            await fetchData();
        } catch (error) {
            alert(translateError(error));
            setDeletingBookingId(null);
        }
    };

    const resetBookingsLimit = () => setBookingsLimit(BOOKINGS_PAGE_SIZE);

    const bookingPropertyLabel = (row) => {
        if (row.type === 'income') {
            return row.lease?.unit?.property ? propertyLabel(row.lease.unit.property) : '-';
        }
        const p = propertyById.get(row.property_id);
        return p ? propertyLabel(p) : 'Allgemein';
    };

    // Columns
    const bookingColumns = [
        {
            header: 'Datum',
            accessor: 'date',
            render: row => formatDateDE(row.date)
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
            render: row => bookingPropertyLabel(row)
        },
        {
            header: 'Zahler / Empfänger',
            accessor: 'party',
            render: row => {
                if (row.type === 'income') {
                    if (row.lease?.tenant_id) return tenantLabel(tenantsById.get(row.lease.tenant_id));
                    return 'Mieteinnahme';
                }
                return row.payee || 'Unbekannt';
            }
        },
        {
            header: 'Betreff / Kategorie',
            accessor: 'note',
            render: row => (
                <div>
                    <div style={{ fontWeight: 500 }}>{row.type === 'expense' ? (row.expense_categories?.name || row.category_custom || 'Ausgabe') : 'Miete'}</div>
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
                        {row.amount > 0 ? '+' : ''}{Math.abs(num(row.amount)).toFixed(2)} €
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

    const mapBookingsForExport = (bookings) => {
        return bookings.map(b => {
            let empfaenger = '–';
            let kategorie = '–';
            let immobilie = '–';

            if (b.type === 'income') {
                empfaenger = b.lease?.tenant_id ? tenantLabel(tenantsById.get(b.lease.tenant_id)) : 'Mieteinnahme';
                kategorie = 'Miete';
                if (b.lease?.unit?.property) {
                    immobilie = propertyLabel(b.lease.unit.property) || '–';
                }
            } else {
                empfaenger = b.payee || 'Unbekannt';
                kategorie = b.expense_categories?.name || b.category_custom || 'Ausgabe';
                const p = propertyById.get(b.property_id);
                immobilie = p ? propertyLabel(p) : 'Allgemein';
            }

            return {
                property_id: b.property_id || (b.lease?.unit?.property_id),
                datum: b.date || b.booking_date || b.payment_date || '',
                empfaenger,
                verwendungszweck: b.note || '–',
                betrag: b.amount || 0,
                kategorie,
                immobilie,
                _propertyLabel: immobilie,
            };
        });
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    if (loadError && !hasLoaded) {
        return (
            <Card>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px', gap: '16px', textAlign: 'center' }}>
                    <CircleAlert size={40} color="#E53E3E" />
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Finanzdaten konnten nicht geladen werden</h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '560px' }}>{loadError}</p>
                    <Button onClick={() => { setLoading(true); fetchData(); }}>Erneut laden</Button>
                </div>
            </Card>
        );
    }

    const bookingTenantOptionMissing = incomeForm.tenant_id && !tenantOptions.some(t => t.id === incomeForm.tenant_id);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Buchhaltung</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Einnahmen, Ausgaben und Mieteingänge</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ExportDropdown
                        reportType="buchhaltung"
                        data={mapBookingsForExport(allBookings)}
                        properties={properties.map(p => ({ id: p.id, label: propertyLabel(p) }))}
                        currentFilters={{ property_id: filterPropertyId, start_date: filterStartDate, end_date: filterEndDate }}
                        totalRows={allBookings.length}
                    />
                    <Button icon={Plus} onClick={openBookingModal}>Buchung erfassen</Button>
                </div>
            </div>

            {(loadError || loadWarnings.length > 0) && (
                <div style={{ marginBottom: 'var(--spacing-md)', padding: '12px 16px', borderRadius: '8px', border: '1px solid #FCA5A5', backgroundColor: 'rgba(239, 68, 68, 0.06)', color: '#991B1B', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {loadError && <span><strong>Aktualisierung fehlgeschlagen:</strong> {loadError} – die angezeigten Werte können veraltet sein.</span>}
                        {loadWarnings.map((w, i) => <span key={i}>{w}</span>)}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => fetchData()}>Erneut laden</Button>
                </div>
            )}

            {/* Filter Bar */}
            <div style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Von</label>
                    <input type="date" value={filterStartDate} onChange={e => { setFilterStartDate(e.target.value); resetBookingsLimit(); }} style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Bis</label>
                    <input type="date" value={filterEndDate} onChange={e => { setFilterEndDate(e.target.value); resetBookingsLimit(); }} style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>Immobilie</label>
                    <select
                        value={filterPropertyId}
                        onChange={e => { setFilterPropertyId(e.target.value); setFilterUnitId(''); resetBookingsLimit(); }}
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
                        onChange={e => { setFilterUnitId(e.target.value); resetBookingsLimit(); }}
                        disabled={!filterPropertyId}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '100px' }}
                    >
                        <option value="">Alle</option>
                        {filterUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                    </select>
                </div>
            </div>

            {hiddenUnassigned > 0 && !filterPropertyId && (
                <div style={{ marginTop: '-0.75rem', marginBottom: 'var(--spacing-md)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {hiddenUnassigned} Ausgabe{hiddenUnassigned !== 1 ? 'n' : ''} ohne Objektzuordnung {hiddenUnassigned !== 1 ? 'werden' : 'wird'} keinem Portfolio zugeordnet und nur unter „Alle Portfolios“ berücksichtigt.
                </div>
            )}

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Erwartete Miete (Soll)</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary-color)' }}>
                                {eur(kpiData.expectedRent)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>für die Monate im Zeitraum</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>davon zugeordnet bezahlt: {eur(kpiData.paidAllocated)}</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setIsExpectedDetailsOpen(true)}>Details</Button>
                    </div>
                </Card>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Bezahlte Mieten (Ist)</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success-color)' }}>
                                {eur(kpiData.paidRent)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Zahlungseingänge im Zeitraum (nach Zahldatum)</div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setIsPaidDetailsOpen(true)}>Details</Button>
                    </div>
                </Card>
                <Card style={showOverdueDetails ? { border: '2px solid var(--danger-color)' } : {}}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Überfällige Mieten</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: overdueTotal > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
                                {eur(overdueTotal)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rückstände nach Fälligkeit (kumuliert, ohne Mahnverfahren)</div>
                            {!includeBeforeBookingStart && overdueHidden.count > 0 && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>zzgl. {eur(overdueHidden.amount)} vor Buchungsbeginn (ausgeblendet)</div>
                            )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowOverdueDetails(!showOverdueDetails)}>
                            {showOverdueDetails ? 'Schließen' : 'Details'}
                        </Button>
                    </div>
                </Card>
                <Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Überschuss / Cashflow</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: kpiData.surplus >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                        {eur(kpiData.surplus)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Zahlungseingänge - Ausgaben im Zeitraum</div>
                </Card>
            </div>

            {showOverdueDetails ? (
                <OverdueRentsView
                    entries={overdueEntries}
                    tenantsById={tenantsById}
                    onMarkPaid={handleMarkAsPaid}
                    onMarkAllPaid={handleBatchMarkAsPaid}
                    processingPaymentId={processingPaymentId}
                    mahnverfahrenClaims={mahnverfahrenClaims}
                    navigate={navigate}
                    hidden={overdueHidden}
                    includeBeforeBookingStart={includeBeforeBookingStart}
                    onToggleBeforeBookingStart={() => setIncludeBeforeBookingStart(v => !v)}
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
                                                    {formatDateDE(row.date)}
                                                </div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem', marginTop: '2px', color: row.amount > 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                                    {row.amount > 0 ? '+' : ''}{Math.abs(num(row.amount)).toFixed(2)} €
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
                                            {row.type === 'expense' ? (row.expense_categories?.name || row.category_custom || 'Ausgabe') : 'Miete'}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                            {row.note}
                                        </div>

                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                {row.type === 'income' && row.lease?.unit?.property
                                                    ? `${propertyLabel(row.lease.unit.property)}, ${row.lease.unit.unit_name}`
                                                    : bookingPropertyLabel(row)}
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: 'var(--spacing-md)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                <span>{recentBookings.length} von {allBookings.length} Buchungen</span>
                                {recentBookings.length < allBookings.length && (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <Button size="sm" variant="secondary" onClick={() => setBookingsLimit(l => l + BOOKINGS_PAGE_SIZE)}>Weitere {Math.min(BOOKINGS_PAGE_SIZE, allBookings.length - recentBookings.length)} laden</Button>
                                        <Button size="sm" variant="ghost" onClick={() => setBookingsLimit(allBookings.length)}>Alle anzeigen</Button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </Card>
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
                        Zeitraum: <strong>{formatDateDE(filterStartDate)} - {formatDateDE(filterEndDate)}</strong>
                        <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>Soll je Monat laut Mietkonto; angebrochene Monate (Ein-/Auszug) tagesanteilig.</div>
                    </div>
                    <Table
                        columns={[
                            { header: 'Einheit', accessor: 'unit', render: r => <div><div style={{ fontWeight: 500 }}>{r.property?.street} {r.property?.house_number}</div><div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.unit_name}</div></div> },
                            { header: 'Mieter', accessor: 'tenant', render: r => r.tenant_name || <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{r.isVacationRental ? 'Ferienwohnung' : 'Leerstand'}</span> },
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
                        data={expectedDetails}
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
                        Zeitraum: <strong>{formatDateDE(filterStartDate)} - {formatDateDE(filterEndDate)}</strong>
                        <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>Zahlungen nach zugeordnetem Monat (Mietkonto).</div>
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
                                                <span style={{ fontSize: '0.8rem' }}>{formatMonthDE(m.str)}</span>
                                                {m.isMahn ? (
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#DC2626' }}>Im Mahnverfahren</span>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        disabled={processingPaymentId === `${r.leaseId}-${m.str}`}
                                                        onClick={() => handleMarkAsPaid(r.lease, m.str, m.expected - m.paid, m.beforeBookingStart)}
                                                        style={{ fontSize: '0.75rem', padding: '2px 8px', height: 'auto', minHeight: '24px' }}
                                                    >
                                                        {processingPaymentId === `${r.leaseId}-${m.str}` ? <Loader2 className="animate-spin" size={12} /> : 'Bezahlen'}
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )
                            }
                        ]}
                        data={paidDetails}
                    />
                </div>
            </Modal>

            <Modal
                isOpen={isModalOpen}
                onClose={() => { if (!isSaving) setIsModalOpen(false); }}
                title="Buchung erfassen"
                footer={
                    <>
                        <Button variant="secondary" disabled={isSaving} onClick={() => setIsModalOpen(false)}>Abbrechen</Button>
                        <Button disabled={isSaving} onClick={bookingType === 'expense' ? handleSaveExpense : handleSaveIncome}>Speichern</Button>
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
                                    <option value="">{expenseForm.scope === 'unit' ? 'Wählen...' : 'Keine (objektübergreifend)'}</option>
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
                            <Input label="Monat (Leistungsmonat)" type="month" value={incomeForm.period_month} onChange={e => setIncomeForm({ ...incomeForm, period_month: e.target.value, lease_id: '' })} />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Mieter</label>
                            <select
                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                value={incomeForm.tenant_id}
                                onChange={handleTenantChange}
                            >
                                <option value="">Wählen...</option>
                                {bookingTenantOptionMissing && (
                                    <option value={incomeForm.tenant_id}>{tenantLabel(tenantsById.get(incomeForm.tenant_id))}</option>
                                )}
                                {tenantOptions.map(t => (
                                    <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={incomeForm.property_id}
                                    onChange={e => setIncomeForm({ ...incomeForm, property_id: e.target.value, unit_id: '', lease_id: '' })}
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

                        {incomeLeaseCandidates.length > 1 && (
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Mietvertrag</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={selectedIncomeLease?.id || ''}
                                    onChange={e => setIncomeForm({ ...incomeForm, lease_id: e.target.value })}
                                >
                                    {incomeLeaseCandidates.map(l => <option key={l.id} value={l.id}>{leaseOptionLabel(l)}</option>)}
                                </select>
                            </div>
                        )}
                        {incomeForm.tenant_id && incomeForm.unit_id && incomeLeaseCandidates.length === 0 && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--danger-color)' }}>Für diesen Mieter gibt es in dieser Einheit keinen Mietvertrag.</div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Betrag (€)" allowDecimals value={incomeForm.amount} onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })} />
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Soll-Miete (Monat)</label>
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
const OverdueRentsView = ({ entries, tenantsById, onMarkPaid, onMarkAllPaid, processingPaymentId, mahnverfahrenClaims, navigate, hidden, includeBeforeBookingStart, onToggleBeforeBookingStart }) => {
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [confirmingAllId, setConfirmingAllId] = useState(null);
    const [markingAllId, setMarkingAllId] = useState(null);
    const [selectedEntries, setSelectedEntries] = useState(() => new Set());

    const toggleExpand = (id) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setExpandedIds(newSet);
    };

    const toggleEntrySelection = (entry, e) => {
        e.stopPropagation();
        if (entry.isMahn) return; // Mahnverfahren: nur über die Forderungsakte
        const newSet = new Set(selectedEntries);
        if (newSet.has(entry.id)) newSet.delete(entry.id);
        else newSet.add(entry.id);
        setSelectedEntries(newSet);
    };

    const toggleAllInGroup = (selectable, e) => {
        e.stopPropagation();
        const newSet = new Set(selectedEntries);
        const allSelected = selectable.length > 0 && selectable.every(en => newSet.has(en.id));
        if (allSelected) {
            selectable.forEach(en => newSet.delete(en.id));
        } else {
            selectable.forEach(en => newSet.add(en.id));
        }
        setSelectedEntries(newSet);
    };

    // Gruppen je Mietvertrag (nicht je Einheit)
    const overdueGroups = useMemo(() => {
        const groupMap = new Map();
        entries.forEach(entry => {
            const lease = entry.lease;
            if (!groupMap.has(lease.id)) {
                groupMap.set(lease.id, {
                    leaseId: lease.id,
                    unitId: lease.unit_id,
                    unitName: lease.unit?.unit_name || 'Unbekannt',
                    property: lease.unit?.property,
                    tenantName: tenantLabel(tenantsById.get(lease.tenant_id)),
                    lease,
                    totalOverdue: 0,
                    entries: []
                });
            }
            const group = groupMap.get(lease.id);
            if (!entry.isMahn) group.totalOverdue = round2(group.totalOverdue + entry.open);
            group.entries.push({ ...entry, claimId: entry.isMahn ? mahnverfahrenClaims.get(entry.key) : undefined });
        });
        return Array.from(groupMap.values())
            .map(g => ({
                ...g,
                entries: [...g.entries].sort((a, b) => b.monthStr.localeCompare(a.monthStr)),
                selectable: g.entries.filter(en => !en.isMahn)
            }))
            .sort((a, b) => b.totalOverdue - a.totalOverdue);
    }, [entries, tenantsById, mahnverfahrenClaims]);

    const shownBeforeStart = useMemo(() => entries.filter(e => e.beforeBookingStart).length, [entries]);

    const bookingStartNotice = (() => {
        if (!includeBeforeBookingStart && hidden?.count > 0) {
            return (
                <div style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span>
                        Bei {hidden.leases} Bestandsmietvertr{hidden.leases !== 1 ? 'ägen' : 'ag'} beginnt die Mietkonto-Führung in ImmoControl360 erst nach dem Mietbeginn (hinterlegter Buchungsbeginn bzw. Erfassung des Vertrags).
                        {' '}{hidden.count} offene{hidden.count !== 1 ? '' : 'r'} Monat{hidden.count !== 1 ? 'e' : ''} vor dem Buchungsbeginn ({eur(hidden.amount)}) {hidden.count !== 1 ? 'werden' : 'wird'} nicht als Rückstand gezählt.
                    </span>
                    <Button size="sm" variant="secondary" onClick={onToggleBeforeBookingStart}>Einblenden</Button>
                </div>
            );
        }
        if (includeBeforeBookingStart) {
            return (
                <div style={{ margin: '0 0 12px', padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span>
                        Monate vor dem Buchungsbeginn werden angezeigt{shownBeforeStart > 0 ? ` (${shownBeforeStart})` : ''}. Als bezahlt markierte Altmonate werden als Eröffnungsbuchung mit dem jeweiligen Fälligkeitsdatum gebucht.
                    </span>
                    <Button size="sm" variant="secondary" onClick={onToggleBeforeBookingStart}>Ausblenden</Button>
                </div>
            );
        }
        return null;
    })();

    if (overdueGroups.length === 0) {
        return (
            <Card title="Überfällige Mieten">
                {bookingStartNotice}
                <div style={{ padding: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'var(--surface-color)', padding: '1rem', borderRadius: '50%' }}><CircleCheck size={32} color="green" /></div>
                    <div>
                        <h4 style={{ fontWeight: 700 }}>Keine überfälligen Mieten!</h4>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Alle fälligen Mieten sind bezahlt.</p>
                    </div>
                </div>
            </Card>
        );
    }

    const totalAllOverdue = round2(overdueGroups.reduce((sum, g) => sum + g.totalOverdue, 0));

    return (
        <Card title="Überfällige Mieten" action={
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#EF4444' }}>
                Gesamt: {eur(totalAllOverdue)}
            </span>
        }>
            {bookingStartNotice}
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
                    {overdueGroups.map(group => {
                        const isExpanded = expandedIds.has(group.leaseId);
                        return (
                            <div key={group.leaseId} style={{ borderBottom: '1px solid #eee' }}>
                                <div
                                    onClick={() => toggleExpand(group.leaseId)}
                                    style={{
                                        display: 'grid', gridTemplateColumns: '2.5fr 2fr 1.5fr 1.2fr 0.3fr',
                                        padding: '14px 16px', alignItems: 'center', cursor: 'pointer',
                                        backgroundColor: isExpanded ? '#FEF2F2' : 'white',
                                        transition: 'background-color 0.15s'
                                    }}
                                    onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.backgroundColor = '#FAFAFA'; }}
                                    onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
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
                                        {eur(group.totalOverdue)}
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </div>
                                </div>
                                {/* Expanded: individual overdue months */}
                                {isExpanded && (
                                    <div style={{ backgroundColor: 'var(--background-color)', padding: '4px 16px 8px' }}>
                                        {/* Sub-header */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1fr 1fr 1fr 0.6fr', gap: '8px', padding: '8px 8px 6px', fontSize: '0.7rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    disabled={group.selectable.length === 0}
                                                    checked={group.selectable.length > 0 && group.selectable.every(en => selectedEntries.has(en.id))}
                                                    onChange={(e) => toggleAllInGroup(group.selectable, e)}
                                                    onClick={e => e.stopPropagation()}
                                                    style={{ cursor: 'pointer', accentColor: 'var(--primary-color)', width: '14px', height: '14px' }}
                                                />
                                            </div>
                                            <div>Monat</div>
                                            <div style={{ textAlign: 'right' }}>Soll</div>
                                            <div style={{ textAlign: 'right' }}>Bezahlt</div>
                                            <div style={{ textAlign: 'right' }}>Offen</div>
                                            <div style={{ textAlign: 'right' }}>Aktion</div>
                                        </div>
                                        {group.entries.map(entry => (
                                            <div
                                                key={entry.id}
                                                onClick={(e) => toggleEntrySelection(entry, e)}
                                                style={{
                                                    display: 'grid', gridTemplateColumns: 'auto 2fr 1fr 1fr 1fr 0.6fr', gap: '8px',
                                                    padding: '10px 8px', alignItems: 'center', cursor: entry.isMahn ? 'default' : 'pointer',
                                                    borderBottom: '1px solid #F3F4F6',
                                                    fontSize: '0.88rem',
                                                    backgroundColor: selectedEntries.has(entry.id) ? 'rgba(59,130,246,0.05)' : 'transparent',
                                                    transition: 'background-color 0.15s'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedEntries.has(entry.id)}
                                                        disabled={entry.isMahn}
                                                        readOnly
                                                        title={entry.isMahn ? 'Im Mahnverfahren – Zahlung bitte in der Forderungsakte erfassen' : undefined}
                                                        style={{ cursor: entry.isMahn ? 'not-allowed' : 'pointer', accentColor: 'var(--primary-color)', width: '14px', height: '14px' }}
                                                    />
                                                </div>
                                                <span style={{ fontWeight: 600 }}>
                                                    {formatMonthDE(entry.monthStr)}
                                                    <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 400, color: '#6B7280' }}>
                                                        fällig am {formatDateDE(entry.dueDate)}{entry.beforeBookingStart ? ' · vor Buchungsbeginn' : ''}
                                                    </span>
                                                </span>
                                                <span style={{ textAlign: 'right', color: '#6B7280' }}>{entry.expected.toFixed(2)} €</span>
                                                <span style={{ textAlign: 'right', color: entry.paid > 0 ? 'var(--success-color)' : '#6B7280' }}>{entry.paid.toFixed(2)} €</span>
                                                <span style={{ textAlign: 'right', color: '#EF4444', fontWeight: 700 }}>{entry.open.toFixed(2)} €</span>
                                                <div style={{ textAlign: 'right' }}>
                                                    {entry.isMahn ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                                                            <span style={{
                                                                display: 'inline-block',
                                                                padding: '2px 8px',
                                                                borderRadius: '12px',
                                                                fontSize: '0.7rem',
                                                                fontWeight: 600,
                                                                backgroundColor: '#FEF2F2',
                                                                color: '#DC2626',
                                                                border: '1px solid #FCA5A5'
                                                            }}>
                                                                {entry.paid > 0 ? 'Im Mahnverfahren (Teilzahlung)' : 'Im Mahnverfahren'}
                                                            </span>
                                                            {entry.claimId && (
                                                                <Button size="sm" onClick={(e) => { e.stopPropagation(); navigate('/forderungen/' + entry.claimId); }} style={{ fontSize: '0.7rem', padding: '2px 8px', height: 'auto', minHeight: '22px' }}>
                                                                    Forderungsakte
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <OverdueActionMenu
                                                            onMarkPaid={(customAmount) => onMarkPaid(entry.lease, entry.monthStr, customAmount !== undefined ? customAmount : entry.open, entry.beforeBookingStart)}
                                                            onCreateClaim={() => navigate('/forderungen')}
                                                            isProcessing={processingPaymentId === `${entry.leaseId}-${entry.monthStr}`}
                                                            dueAmount={entry.open}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {/* Alle als bezahlt markieren Button (ohne Monate im Mahnverfahren) */}
                                        {group.selectable.length > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '12px 8px 8px', borderTop: '1px solid #E5E7EB', marginTop: '4px' }}>
                                                {(() => {
                                                    const groupSelected = group.selectable.filter(en => selectedEntries.has(en.id));
                                                    const hasSelection = groupSelected.length > 0;
                                                    const countToMark = hasSelection ? groupSelected.length : group.selectable.length;
                                                    const labelToMark = hasSelection ? `${countToMark} ausgewählte als bezahlt markieren` : 'Alle als bezahlt markieren';

                                                    return markingAllId === group.leaseId ? (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#6B7280' }}>
                                                            <Loader2 className="animate-spin" size={14} /> Wird markiert...
                                                        </span>
                                                    ) : confirmingAllId === group.leaseId ? (
                                                        <>
                                                            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
                                                                Wirklich {countToMark} Monat{countToMark !== 1 ? 'e' : ''} markieren?
                                                            </span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setConfirmingAllId(null);
                                                                    setMarkingAllId(group.leaseId);
                                                                    const markAll = async () => {
                                                                        const entriesToMark = hasSelection ? groupSelected : group.selectable;
                                                                        await onMarkAllPaid(entriesToMark);
                                                                        if (hasSelection) {
                                                                            setSelectedEntries(prev => {
                                                                                const newSet = new Set(prev);
                                                                                groupSelected.forEach(en => newSet.delete(en.id));
                                                                                return newSet;
                                                                            });
                                                                        }
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
                                                            onClick={(e) => { e.stopPropagation(); setConfirmingAllId(group.leaseId); }}
                                                            style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
                                                                border: '1px solid #16a34a', backgroundColor: hasSelection ? '#16a34a' : 'var(--surface-color)',
                                                                color: hasSelection ? 'white' : '#16a34a',
                                                                cursor: 'pointer', transition: 'all 0.15s'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#16a34a'; e.currentTarget.style.color = 'white'; }}
                                                            onMouseLeave={e => {
                                                                if (!hasSelection) {
                                                                    e.currentTarget.style.backgroundColor = '#F0FFF4';
                                                                    e.currentTarget.style.color = '#16a34a';
                                                                }
                                                            }}
                                                        >
                                                            <CircleCheck size={14} /> {labelToMark}
                                                        </button>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
};

const OverdueActionMenu = ({ onMarkPaid, onCreateClaim, isProcessing, dueAmount }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [hoveredItem, setHoveredItem] = useState(null);
    const [showPartial, setShowPartial] = useState(false);
    const [partialValue, setPartialValue] = useState('');
    const [partialError, setPartialError] = useState('');
    const menuRef = useRef(null);
    const contentRef = useRef(null);
    const [menuStyle, setMenuStyle] = useState({});

    const closeMenu = () => {
        setIsOpen(false);
        setShowPartial(false);
        setPartialValue('');
        setPartialError('');
    };

    const openMenu = () => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            setMenuStyle({
                position: 'fixed',
                top: `${rect.bottom + 5}px`,
                left: `${Math.max(8, rect.right - 220)}px`,
                zIndex: 9999
            });
        }
        setIsOpen(true);
    };

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleClickOutside = (event) => {
            const isOutsideTrigger = menuRef.current && !menuRef.current.contains(event.target);
            const isOutsideContent = contentRef.current && !contentRef.current.contains(event.target);
            if (isOutsideTrigger && isOutsideContent) {
                setIsOpen(false);
                setShowPartial(false);
                setPartialValue('');
                setPartialError('');
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [isOpen]);

    if (isProcessing) {
        return <Loader2 className="animate-spin" size={16} />;
    }

    const savePartial = () => {
        const val = round2(parseFloat(String(partialValue).replace(',', '.')));
        if (!(val > 0)) {
            setPartialError('Bitte einen Betrag größer 0 eingeben.');
            return;
        }
        if (val > round2(dueAmount)) {
            setPartialError(`Höchstens ${eur(dueAmount)} (offener Betrag). Überzahlungen bitte über „Buchung erfassen“ buchen.`);
            return;
        }
        onMarkPaid(val);
        closeMenu();
    };

    const MenuContent = (
        <div
            ref={contentRef}
            style={{
                ...menuStyle,
                width: '220px',
                backgroundColor: 'var(--surface-color)', borderRadius: '8px',
                boxShadow: '0 10px 25px -3px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)',
                border: '1px solid #E5E7EB', padding: '4px',
                animation: 'fadeIn 0.12s ease-out'
            }}
            onClick={e => e.stopPropagation()}
        >
            {!showPartial ? (
                <>
                    <div
                        onClick={() => { onMarkPaid(); closeMenu(); }}
                        onMouseEnter={() => setHoveredItem('paid')}
                        onMouseLeave={() => setHoveredItem(null)}
                        style={{
                            padding: '10px 12px', fontSize: '0.85rem', cursor: 'pointer', borderRadius: '6px',
                            display: 'flex', gap: '10px', alignItems: 'center',
                            backgroundColor: hoveredItem === 'paid' ? '#F0FFF4' : 'transparent',
                            transition: 'background-color 0.12s'
                        }}
                    >
                        <CircleCheck size={15} color="#16a34a" /> Vollständig bezahlt ({eur(dueAmount)})
                    </div>
                    <div
                        onClick={(e) => { e.stopPropagation(); setShowPartial(true); setPartialValue(''); setPartialError(''); }}
                        onMouseEnter={() => setHoveredItem('partial')}
                        onMouseLeave={() => setHoveredItem(null)}
                        style={{
                            padding: '10px 12px', fontSize: '0.85rem', cursor: 'pointer', borderRadius: '6px',
                            display: 'flex', gap: '10px', alignItems: 'center',
                            backgroundColor: hoveredItem === 'partial' ? '#FFFBEB' : 'transparent',
                            transition: 'background-color 0.12s'
                        }}
                    >
                        <Banknote size={15} color="#D97706" /> Teilzahlung erfassen
                    </div>
                    <div
                        onClick={() => { closeMenu(); onCreateClaim(); }}
                        onMouseEnter={() => setHoveredItem('reminder')}
                        onMouseLeave={() => setHoveredItem(null)}
                        title="Mahnungen laufen über eine Forderungsakte (Menü Forderungen)"
                        style={{
                            padding: '10px 12px', fontSize: '0.85rem', cursor: 'pointer', borderRadius: '6px',
                            display: 'flex', gap: '10px', alignItems: 'center',
                            backgroundColor: hoveredItem === 'reminder' ? '#EFF6FF' : 'transparent',
                            transition: 'background-color 0.12s'
                        }}
                    >
                        <Send size={15} color="#2563EB" /> Forderung / Mahnung anlegen
                    </div>
                </>
            ) : (
                <div style={{ padding: '8px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', marginBottom: '8px' }}>Teilbetrag eingeben (max. {eur(dueAmount)}):</div>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={round2(dueAmount)}
                        autoFocus
                        value={partialValue}
                        onChange={e => { setPartialValue(e.target.value); setPartialError(''); }}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #D1D5DB', marginBottom: '8px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                    />
                    {partialError && (
                        <div style={{ fontSize: '0.72rem', color: '#DC2626', marginBottom: '8px' }}>{partialError}</div>
                    )}
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                            onClick={savePartial}
                            style={{ flex: 1, padding: '6px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}
                        >Speichern</button>
                        <button
                            onClick={() => { setShowPartial(false); setPartialError(''); }}
                            style={{ flex: 1, padding: '6px', background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                        >Zurück</button>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div style={{ position: 'relative' }} ref={menuRef}>
            <button
                onClick={(e) => { e.stopPropagation(); if (isOpen) closeMenu(); else openMenu(); }}
                style={{ padding: '4px 6px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F3F4F6'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
                <EllipsisVertical size={18} />
            </button>
            {isOpen && createPortal(MenuContent, document.body)}
        </div>
    );
};

export default Finance;
