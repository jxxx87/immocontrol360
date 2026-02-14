import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { translateError } from '../lib/errorTranslator';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import RateInput from '../components/ui/RateInput';
import LoadingOverlay from '../components/ui/LoadingOverlay';
import { Plus, Trash2, Edit2, ChevronDown, ChevronRight, Calculator, Home, AlertCircle } from 'lucide-react';

const Loans = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();

    const [loans, setLoans] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Grouped Data State
    const [groupedLoans, setGroupedLoans] = useState({}); // { [propertyId]: { property: {}, loans: [], totals: {} } }
    const [expandedGroups, setExpandedGroups] = useState({});

    // Filters
    const [filters, setFilters] = useState({
        search: '',
        propertyId: ''
    });

    // Add/Edit Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingLoan, setEditingLoan] = useState(null);
    const [loanForm, setLoanForm] = useState(getEmptyForm());

    // Schedule Modal
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [scheduleLoan, setScheduleLoan] = useState(null);
    const [scheduleData, setScheduleData] = useState([]);

    function getEmptyForm() {
        return {
            property_id: '',
            bank_name: '',
            account_number: '',
            loan_amount: '',
            start_date: new Date().toISOString().split('T')[0],
            end_date: '',
            interest_rate: '', // in %
            initial_repayment_rate: '', // in %
            fixed_annuity: '', // Optional monthly payment
            notes: ''
        };
    }

    // --- Data Fetching ---
    const fetchData = async () => {
        if (!user) return;
        setLoading(true);
        try {
            // Fetch Properties
            let propQuery = supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id')
                .order('street');

            if (selectedPortfolioID) {
                propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const { data: propData, error: propError } = await propQuery;
            if (propError) throw propError;
            setProperties(propData || []);

            // Fetch Loans
            let loanQuery = supabase
                .from('loans')
                .select('*, property:properties(id, street, house_number, city)')
                .order('created_at'); // default sort

            if (selectedPortfolioID) {
                loanQuery = loanQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const { data: loanData, error: loanError } = await loanQuery;
            if (loanError) throw loanError;

            // Process Loans (Group & Filter)
            processLoans(loanData || [], propData || []);

        } catch (error) {
            console.error(error);
            alert(translateError(error));
        } finally {
            setLoading(false);
        }
    };

    const processLoans = (rawLoans, rawProps) => {
        // Filter first
        const filtered = rawLoans.filter(l => {
            if (filters.propertyId && l.property_id !== filters.propertyId) return false;
            if (filters.search) {
                const term = filters.search.toLowerCase();
                return (
                    (l.bank_name || '').toLowerCase().includes(term) ||
                    (l.account_number || '').toLowerCase().includes(term) ||
                    (l.property?.street || '').toLowerCase().includes(term)
                );
            }
            return true;
        });

        // Group by Property
        const groups = {};

        // Initialize groups for all properties (even those without loans, if we want to show them? Maybe only with loans or matching filter)
        // Let's only show those with loans for now unless filtering by property

        filtered.forEach(loan => {
            const pid = loan.property_id;
            if (!groups[pid]) {
                groups[pid] = {
                    property: loan.property,
                    loans: [],
                    totals: {
                        amount: 0,
                        currentDebt: 0,
                        annuity: 0
                    }
                };
            }
            groups[pid].loans.push(loan);

            // Aggregation
            groups[pid].totals.amount += parseFloat(loan.loan_amount || 0);

            // Current Debt (Calculated)
            const currentDebt = calculateCurrentDebt(loan);
            groups[pid].totals.currentDebt += currentDebt;

            // Annuity (Monthly)
            const annuity = parseFloat(loan.fixed_annuity || 0) || calculateStandardAnnuity(loan);
            groups[pid].totals.annuity += annuity;
        });

        setGroupedLoans(groups);
    };

    useEffect(() => {
        fetchData();
    }, [user, selectedPortfolioID]);

    useEffect(() => {
        // Re-process when filters change, but we need the raw data. 
        // For simplicity, we'll re-fetch or store raw data. Storing raw data in state 'loans'
        // Actually, let's just refetch or keep simple. 
        // Better: Process existing 'loans' state.
        // I need to store raw loans in state 'loans'.
    }, [filters]);

    // Using a separate effect to re-process is cleaner if we have raw data
    // Let's modify fetchData to setLoans(rawLoans) and then call a useEffect to process.

    // --- Calculations ---
    const calculateStandardAnnuity = (loan) => {
        const amount = parseFloat(loan.loan_amount || 0);
        const rate = parseFloat(loan.interest_rate); // as percentage e.g 3.5
        const repayment = parseFloat(loan.initial_repayment_rate); // as percentage e.g. 2.0

        if (!amount || !rate || !repayment) return 0;

        // Formula: (Loan * (Interest + Repayment)) / 100 / 12
        return (amount * (rate + repayment)) / 100 / 12;
    };

    const calculateCurrentDebt = (loan) => {
        // Simple approximate calculation for list view
        // Ideally we run the schedule until TODAY.
        const schedule = generateSchedule(loan, new Date());
        if (schedule.length > 0) {
            return schedule[schedule.length - 1].endBalance;
        }
        return parseFloat(loan.loan_amount || 0);
    };

    const generateSchedule = (loan, untilDate = null) => {
        const amount = parseFloat(loan.loan_amount || 0);
        const interestRate = parseFloat(loan.interest_rate) / 100; // 0.035
        let monthlyPayment = parseFloat(loan.fixed_annuity);

        if (!monthlyPayment) {
            const repaymentRate = parseFloat(loan.initial_repayment_rate) / 100; // 0.02
            monthlyPayment = (amount * (interestRate + repaymentRate)) / 12;
        }

        const startDate = new Date(loan.start_date);
        let endDateTarget = loan.end_date ? new Date(loan.end_date) : null;

        // If no end date, default to 50 years from start
        if (!endDateTarget || isNaN(endDateTarget.getTime())) {
            endDateTarget = new Date(startDate);
            endDateTarget.setFullYear(endDateTarget.getFullYear() + 50);
        }

        const validUntil = untilDate ? new Date(untilDate) : endDateTarget;

        let currentBalance = amount;
        let currentDate = new Date(startDate);
        const schedule = [];

        // Safety break
        let months = 0;
        // Run until balance is paid OR untilDate is reached OR 50 years max
        while (currentBalance > 0.01 && months < 600) {
            // If an explicit untilDate was provided (e.g. for current debt calculation), respect it
            if (untilDate && currentDate > validUntil) break;
            const monthlyInterest = currentBalance * interestRate / 12;
            const principial = monthlyPayment - monthlyInterest;
            const endBalance = currentBalance - principial;

            schedule.push({
                date: new Date(currentDate),
                interest: monthlyInterest,
                principal: principial,
                payment: monthlyPayment,
                endBalance: endBalance < 0 ? 0 : endBalance,
                startBalance: currentBalance
            });

            currentBalance = endBalance;
            currentDate.setMonth(currentDate.getMonth() + 1);
            months++;
        }

        return schedule;
    };

    // --- Actions ---
    const handleSave = async () => {
        // Validate
        if (!loanForm.property_id) return alert("Bitte Immobilie wählen");

        if (!loanForm.start_date) return alert("Bitte Startdatum eingeben");

        setIsSaving(true);
        try {
            const selectedProp = properties.find(p => p.id === loanForm.property_id);

            const payload = {
                user_id: user.id,
                portfolio_id: selectedProp.portfolio_id,
                property_id: loanForm.property_id,
                bank_name: loanForm.bank_name,
                account_number: loanForm.account_number,
                loan_amount: loanForm.loan_amount ? parseFloat(loanForm.loan_amount) : null,
                start_date: loanForm.start_date,
                end_date: loanForm.end_date,
                interest_rate: parseFloat(loanForm.interest_rate),
                initial_repayment_rate: parseFloat(loanForm.initial_repayment_rate),
                fixed_annuity: loanForm.fixed_annuity ? parseFloat(loanForm.fixed_annuity) : null,
                notes: loanForm.notes
            };

            if (editingLoan) {
                const { error } = await supabase.from('loans').update(payload).eq('id', editingLoan.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('loans').insert([payload]);
                if (error) throw error;
            }

            setIsModalOpen(false);
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Darlehen wirklich löschen?")) return;
        try {
            const { error } = await supabase.from('loans').delete().eq('id', id);
            if (error) throw error;
            fetchData();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const openEdit = (loan) => {
        setEditingLoan(loan);
        setLoanForm({
            property_id: loan.property_id,
            bank_name: loan.bank_name,
            account_number: loan.account_number || '',
            loan_amount: loan.loan_amount,
            start_date: loan.start_date,
            end_date: loan.end_date,
            interest_rate: loan.interest_rate,
            initial_repayment_rate: loan.initial_repayment_rate || '',
            fixed_annuity: loan.fixed_annuity || '',
            notes: loan.notes || ''
        });
        setIsModalOpen(true);
    };

    const openSchedule = (loan) => {
        setScheduleLoan(loan);
        // Generate full schedule until paid or 50 years, ignoring the interest binding end date for the preview
        const data = generateSchedule(loan);

        // Aggregate to yearly for display
        const yearly = [];
        let currentYear = null;
        let yearTotals = { interest: 0, principal: 0, payment: 0, endBalance: 0 };

        data.forEach(item => {
            const year = item.date.getFullYear();
            if (currentYear !== year) {
                if (currentYear) yearly.push({ year: currentYear, ...yearTotals });
                currentYear = year;
                yearTotals = { interest: 0, principal: 0, payment: 0, endBalance: 0 };
            }
            yearTotals.interest += item.interest;
            yearTotals.principal += item.principal;
            yearTotals.payment += item.payment;
            yearTotals.endBalance = item.endBalance;
        });
        if (currentYear) yearly.push({ year: currentYear, ...yearTotals });

        setScheduleData(yearly);
        setIsScheduleModalOpen(true);
    };

    const openAdd = () => {
        setEditingLoan(null);
        setLoanForm(getEmptyForm());
        // pre-select property if filter is active
        if (filters.propertyId) {
            setLoanForm(prev => ({ ...prev, property_id: filters.propertyId }));
        }
        setIsModalOpen(true);
    };

    const toggleGroup = (pid) => {
        setExpandedGroups(prev => ({ ...prev, [pid]: !prev[pid] }));
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Finanzierungen</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Verwaltung Ihrer Immobilienfinanzierungen</p>
                </div>
                <Button icon={Plus} onClick={openAdd}>Neues Darlehen</Button>
            </div>

            {/* Filter */}
            <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Immobilie</label>
                        <select
                            style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)' }}
                            value={filters.propertyId}
                            onChange={e => {
                                const val = e.target.value;
                                setFilters(prev => ({ ...prev, propertyId: val }));
                                // Also trigger re-fetch/process
                                setTimeout(fetchData, 0);
                            }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Suche</label>
                        <input
                            type="text"
                            placeholder="Bank, Konto, ..."
                            style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                            value={filters.search}
                            onChange={e => {
                                const val = e.target.value;
                                setFilters(prev => ({ ...prev, search: val }));
                                setTimeout(fetchData, 0);
                            }}
                        />
                    </div>
                </div>
            </Card>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.keys(groupedLoans).length === 0 && !loading && (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>Keine Darlehen gefunden.</div>
                )}

                {Object.entries(groupedLoans).map(([pid, group]) => (
                    <Card key={pid} style={{ padding: 0, overflow: 'hidden' }}>
                        {/* Header Row */}
                        <div
                            style={{
                                padding: '1rem',
                                backgroundColor: 'var(--background-color)',
                                borderBottom: '1px solid var(--border-color)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                cursor: 'pointer'
                            }}
                            onClick={() => toggleGroup(pid)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {expandedGroups[pid] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                                        {group.property?.street} {group.property?.house_number}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        {group.property?.city}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '2rem', textAlign: 'right' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Gesamtdarlehen</div>
                                    <div style={{ fontWeight: 600 }}>{group.totals.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Restschuld (aktuell)</div>
                                    <div style={{ fontWeight: 600 }}>{group.totals.currentDebt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rate (mtl.)</div>
                                    <div style={{ fontWeight: 600 }}>{group.totals.annuity.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                </div>
                            </div>
                        </div>

                        {/* Loans Table */}
                        {expandedGroups[pid] && (
                            <div style={{ padding: '1rem' }}>
                                <div className="hidden-mobile">
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                        <thead style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                                            <tr>
                                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Bank / Konto</th>
                                                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Beginn</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Ursprungsbetrag</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Zins / Tilgung</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Rate</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Restschuld (akt.)</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Laufzeit bis</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Aktionen</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {group.loans.map(loan => (
                                                <tr key={loan.id} className="table-row" style={{ borderBottom: '1px solid #eee' }}>
                                                    <td style={{ padding: '0.75rem 0.5rem' }}>
                                                        <div style={{ fontWeight: 500 }}>{loan.bank_name}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{loan.account_number}</div>
                                                    </td>
                                                    <td style={{ padding: '0.75rem 0.5rem' }}>
                                                        {new Date(loan.start_date).toLocaleDateString()}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        {(loan.loan_amount ? parseFloat(loan.loan_amount) : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        <div>{loan.interest_rate}% Zins</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{loan.initial_repayment_rate}% Tilgung</div>
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        {(parseFloat(loan.fixed_annuity) || calculateStandardAnnuity(loan)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                                                        {calculateCurrentDebt(loan).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        {loan.end_date ? new Date(loan.end_date).toLocaleDateString() : 'Kein Datum'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                                            <Button variant="ghost" size="sm" onClick={() => openSchedule(loan)} title="Tilgungsplan">
                                                                <Calculator size={16} />
                                                            </Button>
                                                            <Button variant="ghost" size="sm" onClick={() => openEdit(loan)} title="Bearbeiten">
                                                                <Edit2 size={16} />
                                                            </Button>
                                                            <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} onClick={() => handleDelete(loan.id)} title="Löschen">
                                                                <Trash2 size={16} />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Card View */}
                                <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                    {group.loans.map(loan => (
                                        <div key={loan.id} style={{
                                            border: '1px solid var(--border-color)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: 'var(--spacing-md)',
                                            backgroundColor: 'var(--surface-color)',
                                            position: 'relative'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{loan.bank_name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{loan.account_number}</div>
                                                </div>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--primary-color)' }}>
                                                    {(loan.loan_amount ? parseFloat(loan.loan_amount) : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Zins / Tilgung</div>
                                                    <div>{loan.interest_rate}% / {loan.initial_repayment_rate}%</div>
                                                </div>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Rate</div>
                                                    <div>{(parseFloat(loan.fixed_annuity) || calculateStandardAnnuity(loan)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                                </div>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Restschuld</div>
                                                    <div style={{ fontWeight: 600 }}>{calculateCurrentDebt(loan).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                                </div>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Laufzeit bis</div>
                                                    <div>{loan.end_date ? new Date(loan.end_date).toLocaleDateString() : 'Kein Datum'}</div>
                                                </div>
                                            </div>

                                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                <Button variant="ghost" size="sm" onClick={() => openSchedule(loan)} title="Tilgungsplan" style={{ flex: 1 }}>
                                                    <Calculator size={16} style={{ marginRight: '4px' }} /> Plan
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(loan)} title="Bearbeiten" style={{ flex: 1 }}>
                                                    <Edit2 size={16} style={{ marginRight: '4px' }} /> Bearbeiten
                                                </Button>
                                                <Button variant="ghost" size="sm" style={{ color: 'var(--danger-color)' }} onClick={() => handleDelete(loan.id)} title="Löschen">
                                                    <Trash2 size={16} />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ marginTop: '1rem' }}>
                                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => {
                                        setEditingLoan(null);
                                        setLoanForm({ ...getEmptyForm(), property_id: pid });
                                        setIsModalOpen(true);
                                    }}>Weiteres Darlehen hinzufügen</Button>
                                </div>
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            {/* Edit/Add Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingLoan ? "Darlehen bearbeiten" : "Neues Darlehen erfassen"}
                maxWidth="800px"
                footer={<><Button variant="secondary" onClick={() => setIsModalOpen(false)}>Abbrechen</Button><Button onClick={handleSave}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay />}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                        <select
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)' }}
                            value={loanForm.property_id}
                            onChange={e => setLoanForm({ ...loanForm, property_id: e.target.value })}
                            disabled={!!editingLoan} // Prevent changing property on edit? Or allow? Usually locks simplify things.
                        >
                            <option value="">Bitte wählen...</option>
                            {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>)}
                        </select>
                    </div>

                    <Input label="Bank / Co-Invest / sonstiges Darlehen" value={loanForm.bank_name} onChange={e => setLoanForm({ ...loanForm, bank_name: e.target.value })} />
                    <Input label="Kontonummer / Darlehens-Nr" value={loanForm.account_number} onChange={e => setLoanForm({ ...loanForm, account_number: e.target.value })} />

                    <CurrencyInput label="Darlehensbetrag (€)" value={loanForm.loan_amount} onChange={e => setLoanForm({ ...loanForm, loan_amount: e.target.value })} />
                    <Input
                        label="Startdatum (Bezieht sich auf Tilgungsbeginn)"
                        type="date"
                        value={loanForm.start_date}
                        onChange={e => setLoanForm({ ...loanForm, start_date: e.target.value })}
                    />

                    <Input label="Zinsbindung bis" type="date" value={loanForm.end_date} onChange={e => setLoanForm({ ...loanForm, end_date: e.target.value })} />
                    <div />

                    <RateInput label="Zinssatz (%)" value={loanForm.interest_rate} onChange={e => setLoanForm({ ...loanForm, interest_rate: e.target.value })} />
                    <RateInput label="Anf. Tilgung (%)" value={loanForm.initial_repayment_rate} onChange={e => setLoanForm({ ...loanForm, initial_repayment_rate: e.target.value })} />

                    <CurrencyInput label="Feste Rate (mtl. €) [Optional]" allowDecimals value={loanForm.fixed_annuity} onChange={e => setLoanForm({ ...loanForm, fixed_annuity: e.target.value })} />
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <AlertCircle size={16} style={{ marginRight: '5px' }} />
                        <span>Wenn leer, wird Rate aus Zins + Tilgung berechnet.</span>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Notizen</label>
                        <textarea
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', minHeight: '80px' }}
                            value={loanForm.notes}
                            onChange={e => setLoanForm({ ...loanForm, notes: e.target.value })}
                        />
                    </div>
                </div>
            </Modal>

            {/* Schedule Modal */}
            <Modal
                isOpen={isScheduleModalOpen}
                onClose={() => setIsScheduleModalOpen(false)}
                title="Tilgungsplan (Vorschau)"
                maxWidth="800px"
                footer={<Button onClick={() => setIsScheduleModalOpen(false)}>Schließen</Button>}
            >
                {scheduleLoan && (
                    <div>
                        <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--background-color)', borderRadius: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Zins</div>
                                <div style={{ fontWeight: 600 }}>{scheduleLoan.interest_rate}%</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tilgung</div>
                                <div style={{ fontWeight: 600 }}>{scheduleLoan.initial_repayment_rate}%</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Laufzeitende</div>
                                <div style={{ fontWeight: 600 }}>{new Date(scheduleLoan.end_date).toLocaleDateString()}</div>
                            </div>
                        </div>

                        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                <thead style={{ backgroundColor: 'var(--surface-color)', position: 'sticky', top: 0 }}>
                                    <tr style={{ borderBottom: '2px solid #eee' }}>
                                        <th style={{ textAlign: 'left', padding: '8px' }}>Jahr</th>
                                        <th style={{ textAlign: 'right', padding: '8px' }}>Zinsen</th>
                                        <th style={{ textAlign: 'right', padding: '8px' }}>Tilgung</th>
                                        <th style={{ textAlign: 'right', padding: '8px' }}>Rate</th>
                                        <th style={{ textAlign: 'right', padding: '8px' }}>Restschuld</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scheduleData.map((row, idx) => (
                                        <tr key={row.year} className="table-row" style={{ borderBottom: '1px solid #eee' }}>
                                            <td style={{ padding: '8px' }}>{row.year}</td>
                                            <td style={{ textAlign: 'right', padding: '8px', color: 'var(--danger-color)' }}>{row.interest.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</td>
                                            <td style={{ textAlign: 'right', padding: '8px', color: 'var(--success-color)' }}>{row.principal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</td>
                                            <td style={{ textAlign: 'right', padding: '8px' }}>{row.payment.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</td>
                                            <td style={{ textAlign: 'right', padding: '8px', fontWeight: 600 }}>{row.endBalance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default Loans;
