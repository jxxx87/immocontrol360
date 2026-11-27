import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Plus, Trash2, Edit2, ChevronDown, ChevronRight, Calculator, AlertCircle } from 'lucide-react';
import ExportDropdown from '../components/ExportDropdown';

// --- Berechnungen (ohne React-State) ---
const MAX_MONTHS = 600; // 50 Jahre

const parseNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

const pad2 = (n) => String(n).padStart(2, '0');
const toLocalDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// 'YYYY-MM-DD' als lokales Datum (nicht UTC)
const parseLocalDate = (value) => {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
};
const formatDateDE = (value) => {
    const d = parseLocalDate(value);
    return d ? d.toLocaleDateString('de-DE') : 'Kein Datum';
};
const eur = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

// i-ter Ratentermin ab Startdatum; Tag wird auf das Monatsende begrenzt (31.01. -> 28./29.02. -> 31.03.)
const paymentDateAt = (start, i) => {
    const y = start.getFullYear();
    const m0 = start.getMonth() + i;
    const lastDay = new Date(y, m0 + 1, 0).getDate();
    return new Date(y, m0, Math.min(start.getDate(), lastDay));
};

// Monatliche Rate: feste Rate oder Darlehensbetrag × (Zins + anf. Tilgung) / 12 – dieselbe Formel wie im Tilgungsplan
const getMonthlyPayment = (loan) => {
    const fixed = parseNum(loan.fixed_annuity);
    if (fixed !== null && fixed > 0) return round2(fixed);
    const amount = parseNum(loan.loan_amount);
    const rate = parseNum(loan.interest_rate);
    const repayment = parseNum(loan.initial_repayment_rate);
    if (!(amount > 0) || rate === null || repayment === null) return null;
    const payment = round2((amount * (rate + repayment)) / 100 / 12);
    return payment > 0 ? payment : null;
};

/**
 * Tilgungsplan je Monat (Zins/Tilgung auf Cent gerundet, letzte Rate auf Restschuld + Zins begrenzt).
 * Tatsächliche Restschuld: Raten bis einschließlich Stichtag laufen regulär, danach gilt der Ist-Wert;
 * die nächste Rate folgt am nächsten regulären Ratentag. Liegt der Stichtag nach untilDate, gilt der reguläre Plan.
 */
const generateSchedule = (loan, untilDate = null) => {
    const original = parseNum(loan.loan_amount) || 0;
    const start = parseLocalDate(loan.start_date);
    const actual = parseNum(loan.actual_residual_debt);
    let actualDate = parseLocalDate(loan.actual_residual_debt_date);
    let notice = null;
    // Altbestand: Ist-Restschuld ohne Datum galt bisher ab dem Startdatum – so beibehalten, aber kennzeichnen
    if (actual !== null && !actualDate && start) {
        actualDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
        notice = 'Tatsächliche Restschuld ohne „Gültig ab“-Datum – wird ab Startdatum angesetzt. Bitte Datum ergänzen.';
    }
    const hasReset = actual !== null && !!actualDate;
    const until = untilDate ? new Date(untilDate.getFullYear(), untilDate.getMonth(), untilDate.getDate()) : null;
    const resetApplies = hasReset && (!until || actualDate <= until);
    const result = { rows: [], issue: null, notice, balance: round2(resetApplies ? actual : original), resetAt: null, resetAmount: null };

    const annualRate = parseNum(loan.interest_rate);
    const payment = getMonthlyPayment(loan);
    if (!start) {
        result.issue = 'Startdatum fehlt';
        return result;
    }
    if (annualRate === null || payment === null) {
        result.issue = 'Rate fehlt: feste Rate oder Zinssatz + Tilgung (mit Darlehensbetrag) angeben';
        return result;
    }

    let balance = round2(original);
    let resetDone = false;
    let pendingIssue = null;
    for (let i = 0; i < MAX_MONTHS; i++) {
        const date = paymentDateAt(start, i);
        if (hasReset && !resetDone && date > actualDate) {
            if (until && actualDate > until) break;
            balance = round2(actual);
            resetDone = true;
            result.resetAt = actualDate;
            result.resetAmount = balance;
        }
        if (until && date > until) break;
        if (balance <= 0.005) {
            if (hasReset && !resetDone) continue; // regulärer Plan getilgt, Ist-Wert folgt erst zum Stichtag
            break;
        }

        const interest = round2((balance * annualRate) / 100 / 12);
        if (payment <= interest + 0.005) {
            const msg = payment < interest - 0.005
                ? 'Die Rate deckt die monatlichen Zinsen nicht – die Restschuld würde wachsen.'
                : 'Die Rate entspricht nur den Zinsen (tilgungsfrei) – keine Tilgung.';
            // Bis zum Stichtag der tatsächlichen Restschuld ohne Plan weiter, danach mit dem Ist-Wert
            if (hasReset && !resetDone) {
                pendingIssue = msg;
                continue;
            }
            result.issue = msg;
            break;
        }
        const principal = Math.min(round2(payment - interest), balance);
        const endBalance = round2(balance - principal);
        result.rows.push({
            date,
            interest,
            principal,
            payment: round2(interest + principal),
            startBalance: balance,
            endBalance
        });
        balance = endBalance;
    }
    if (!result.issue && !resetDone && pendingIssue) result.issue = pendingIssue;
    result.balance = balance;
    return result;
};

// Gruppenschlüssel: Wirtschaftseinheit (direkt oder über das Objekt) bzw. Objekt
const loanGroupInfo = (loan, propsById) => {
    const prop = propsById.get(loan.property_id);
    const weId = loan.economic_unit_id || prop?.economic_unit_id || null;
    return { key: weId || loan.property_id, isWE: !!weId };
};

const buildGroups = (rawLoans, rawProps, rawWEs, filters) => {
    const propsById = new Map(rawProps.map(p => [p.id, p]));
    const today = new Date();

    // Filter (WE-Auswahl umfasst auch Darlehen der Mitgliedsobjekte – wie die Gruppierung)
    const filtered = rawLoans.filter(l => {
        if (filters.propertyId) {
            if (filters.propertyId.startsWith('we_')) {
                const info = loanGroupInfo(l, propsById);
                if (!info.isWE || `we_${info.key}` !== filters.propertyId) return false;
            } else if (l.property_id !== filters.propertyId) {
                return false;
            }
        }
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

    // Build prop groups map for economic units
    const propGroups = {};
    rawProps.forEach(p => {
        const key = p.economic_unit_id || p.id;
        if (!propGroups[key]) {
            propGroups[key] = {
                id: key,
                isGroup: !!p.economic_unit_id,
                properties: [],
                street: p.street,
                house_number: p.house_number,
                city: p.city
            };
        }
        propGroups[key].properties.push(p);
    });

    Object.values(propGroups).forEach(g => {
        const weRow = rawWEs.find(we => we.id === g.id);
        if (g.isGroup && g.properties.length > 0) {
            const propLabels = g.properties.map(pr => `${pr.street} ${pr.house_number}`.trim()).filter(Boolean);
            g.street = weRow?.name ? `${weRow.name} (${propLabels.join(', ')})` : `Wirtschaftseinheit: ${propLabels.join(', ')}`;
            g.house_number = ''; // Reset since streets and house numbers are already formatted in street field
            const cities = Array.from(new Set(g.properties.map(pr => pr.city).filter(Boolean)));
            g.city = cities.join(', ');
        } else {
            g.isGroup = false;
        }
    });

    // Ensure empty WE groups exist if they have loans attached directly to them
    rawWEs.forEach(we => {
        if (!propGroups[we.id]) {
            propGroups[we.id] = {
                id: we.id,
                isGroup: true,
                properties: [],
                street: we.name || 'Wirtschaftseinheit',
                house_number: '',
                city: ''
            };
        }
    });

    // Group by Property or Economic Unit; Kennzahlen je Darlehen nur einmal berechnen
    const groups = {};
    filtered.forEach(loan => {
        const { key: pid, isWE } = loanGroupInfo(loan, propsById);
        if (!groups[pid]) {
            groups[pid] = {
                property: propGroups[pid] || loan.property,
                isWE,
                loans: [],
                totals: { amount: 0, currentDebt: 0, annuity: 0 }
            };
        }
        const current = generateSchedule(loan, today);
        const monthlyPayment = getMonthlyPayment(loan);
        const enriched = {
            ...loan,
            _currentDebt: current.balance,
            _monthlyPayment: monthlyPayment,
            _issue: current.issue,
            _notice: current.notice
        };
        groups[pid].loans.push(enriched);
        groups[pid].totals.amount += parseNum(loan.loan_amount) || 0;
        groups[pid].totals.currentDebt += current.balance;
        groups[pid].totals.annuity += monthlyPayment || 0;
    });

    return groups;
};

function getEmptyForm() {
    return {
        property_id: '',
        bank_name: '',
        account_number: '',
        loan_amount: '',
        start_date: toLocalDateStr(new Date()),
        end_date: '',
        interest_rate: '', // in %
        initial_repayment_rate: '', // in %
        fixed_annuity: '', // Optional monthly payment
        actual_residual_debt: '', // Optional actual debt
        actual_residual_debt_date: '', // Optional date for actual debt
        notes: ''
    };
}

const Loans = () => {
    const { user } = useAuth();
    const userId = user?.id;
    const { selectedPortfolioID } = usePortfolio();

    const [loans, setLoans] = useState([]);
    const [properties, setProperties] = useState([]);
    const [economicUnits, setEconomicUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [expandedGroups, setExpandedGroups] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const urlPropertyId = params.get('propertyId');
        return urlPropertyId ? { [urlPropertyId]: true } : {};
    });

    // Filters
    const [filters, setFilters] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return {
            search: '',
            propertyId: params.get('propertyId') || ''
        };
    });

    // Add/Edit Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingLoan, setEditingLoan] = useState(null);
    const [loanForm, setLoanForm] = useState(getEmptyForm);

    // Schedule Modal
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [scheduleLoan, setScheduleLoan] = useState(null);
    const [scheduleData, setScheduleData] = useState([]);
    const [scheduleInfo, setScheduleInfo] = useState({ issue: null, notice: null, resetAt: null, resetAmount: null });

    // --- Data Fetching ---
    const fetchData = useCallback(async () => {
        if (!userId) return;
        try {
            // Fetch Properties
            let propQuery = supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id, economic_unit_id')
                .order('street');

            if (selectedPortfolioID) {
                propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const { data: propData, error: propError } = await propQuery;
            if (propError) throw propError;

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

            // Fetch Economic Units
            const { data: weData, error: weError } = await supabase.from('economic_units').select('*');
            if (weError) throw weError;

            setProperties(propData || []);
            setLoans(loanData || []);
            setEconomicUnits(weData || []);
        } catch (error) {
            console.error(error);
            alert(translateError(error));
        } finally {
            setLoading(false);
        }
    }, [userId, selectedPortfolioID]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Gruppierung + Kennzahlen: nur bei geänderten Daten/Filtern neu berechnen (kein erneuter DB-Abruf)
    const groupedLoans = useMemo(
        () => buildGroups(loans, properties, economicUnits, filters),
        [loans, properties, economicUnits, filters]
    );

    // --- Actions ---
    const handleSave = async () => {
        if (isSaving) return;
        let resolvedPropertyId = loanForm.property_id;
        let resolvedWeId = null;

        if (!resolvedPropertyId) return alert('Bitte Immobilie wählen');

        // If a WE was selected, resolve to the economic unit id directly
        if (resolvedPropertyId.startsWith('we_')) {
            resolvedWeId = resolvedPropertyId.replace('we_', '');
            resolvedPropertyId = null; // property_id can be null if it's attached to WE
        }

        if (!editingLoan) {
            const known = resolvedWeId
                ? (economicUnits.some(eu => eu.id === resolvedWeId) || properties.some(p => p.economic_unit_id === resolvedWeId))
                : properties.some(p => p.id === resolvedPropertyId);
            if (!known) return alert('Die gewählte Immobilie bzw. Wirtschaftseinheit wurde nicht gefunden. Bitte erneut auswählen.');
        }

        const amount = parseNum(loanForm.loan_amount);
        const rate = parseNum(loanForm.interest_rate);
        const repayment = parseNum(loanForm.initial_repayment_rate);
        const fixed = parseNum(loanForm.fixed_annuity);
        const hasFixed = fixed !== null && fixed > 0;
        const actualDate = loanForm.actual_residual_debt_date || '';
        const actualValue = parseNum(loanForm.actual_residual_debt);

        if (!(loanForm.bank_name || '').trim()) return alert('Bitte Bank bzw. Darlehensgeber angeben.');
        if (!loanForm.start_date) return alert('Bitte Startdatum eingeben');
        if (!loanForm.end_date) return alert('Bitte das Datum „Zinsbindung bis“ angeben.');
        if (loanForm.end_date < loanForm.start_date) return alert('„Zinsbindung bis“ darf nicht vor dem Startdatum liegen.');
        if (rate === null || rate < 0) return alert('Bitte einen Zinssatz angeben (0 % oder mehr).');
        if (!hasFixed) {
            if (repayment === null || repayment < 0) return alert('Bitte eine feste monatliche Rate oder die anfängliche Tilgung angeben.');
            if (!(amount > 0)) return alert('Ohne feste Rate wird der Darlehensbetrag zur Berechnung der Rate benötigt.');
            if (rate + repayment <= 0) return alert('Zinssatz und Tilgung ergeben keine Rate. Bitte Tilgung oder feste Rate angeben.');
        }
        // Tatsächliche Restschuld nur zusammen mit Stichtag (0 = vollständig getilgt ist erlaubt)
        if (actualDate && actualValue === null) return alert('Bitte die tatsächliche Restschuld zum Stichtag angeben (0 bei vollständiger Tilgung).');
        if (!actualDate && actualValue !== null && actualValue > 0) return alert('Bitte zur tatsächlichen Restschuld das Datum „Gültig ab“ angeben.');
        if (actualValue !== null && actualValue < 0) return alert('Die tatsächliche Restschuld darf nicht negativ sein.');
        if (!(amount > 0) && !actualDate) return alert('Bitte den Darlehensbetrag angeben.');

        setIsSaving(true);
        try {
            let derivedPortfolioId = selectedPortfolioID || null;
            if (!derivedPortfolioId) {
                if (resolvedWeId) {
                    const weProp = properties.find(p => p.economic_unit_id === resolvedWeId);
                    derivedPortfolioId = weProp?.portfolio_id || null;
                } else {
                    const selectedProp = properties.find(p => p.id === resolvedPropertyId);
                    derivedPortfolioId = selectedProp?.portfolio_id || null;
                }
            }
            if (!derivedPortfolioId && editingLoan) derivedPortfolioId = editingLoan.portfolio_id || null;

            if (!derivedPortfolioId) {
                setIsSaving(false);
                return alert("Portfolio-Zuweisung fehlgeschlagen. Bitte ordnen Sie der Wirtschaftseinheit zuerst eine Immobilie in einem Portfolio zu.");
            }

            const payload = {
                portfolio_id: derivedPortfolioId,
                property_id: resolvedPropertyId,
                economic_unit_id: resolvedWeId,
                bank_name: loanForm.bank_name.trim(),
                account_number: (loanForm.account_number || '').trim() || null,
                loan_amount: amount > 0 ? round2(amount) : null,
                start_date: loanForm.start_date,
                end_date: loanForm.end_date,
                interest_rate: rate,
                initial_repayment_rate: repayment,
                fixed_annuity: hasFixed ? round2(fixed) : null,
                actual_residual_debt: actualDate ? round2(actualValue) : null,
                actual_residual_debt_date: actualDate || null,
                notes: loanForm.notes
            };

            if (editingLoan) {
                // user_id bleibt unverändert (Eigentümer der Zeile), auch wenn ein Teammitglied bearbeitet
                const { error } = await supabase.from('loans').update(payload).eq('id', editingLoan.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('loans').insert([{ ...payload, user_id: user.id }]);
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
            property_id: loan.economic_unit_id ? `we_${loan.economic_unit_id}` : loan.property_id,
            bank_name: loan.bank_name || '',
            account_number: loan.account_number || '',
            loan_amount: loan.loan_amount ?? '',
            start_date: loan.start_date || '',
            end_date: loan.end_date || '',
            interest_rate: loan.interest_rate ?? '',
            initial_repayment_rate: loan.initial_repayment_rate ?? '',
            fixed_annuity: loan.fixed_annuity ?? '',
            actual_residual_debt: loan.actual_residual_debt ?? '',
            actual_residual_debt_date: loan.actual_residual_debt_date || '',
            notes: loan.notes || ''
        });
        setIsModalOpen(true);
    };

    const openSchedule = (loan) => {
        setScheduleLoan(loan);
        // Generate full schedule until paid or 50 years, ignoring the interest binding end date for the preview
        const schedule = generateSchedule(loan);

        // Aggregate to yearly for display
        const yearly = [];
        let currentYear = null;
        let yearTotals = { interest: 0, principal: 0, payment: 0, endBalance: 0 };

        schedule.rows.forEach(item => {
            const year = item.date.getFullYear();
            if (currentYear !== year) {
                if (currentYear) yearly.push({ year: currentYear, ...yearTotals });
                currentYear = year;
                yearTotals = { interest: 0, principal: 0, payment: 0, endBalance: 0 };
            }
            yearTotals.interest = round2(yearTotals.interest + item.interest);
            yearTotals.principal = round2(yearTotals.principal + item.principal);
            yearTotals.payment = round2(yearTotals.payment + item.payment);
            yearTotals.endBalance = item.endBalance;
        });
        if (currentYear) yearly.push({ year: currentYear, ...yearTotals });

        setScheduleData(yearly);
        setScheduleInfo({ issue: schedule.issue, notice: schedule.notice, resetAt: schedule.resetAt, resetAmount: schedule.resetAmount });
        setIsScheduleModalOpen(true);
    };

    const openAdd = () => {
        setEditingLoan(null);
        // pre-select property if filter is active
        setLoanForm({ ...getEmptyForm(), property_id: filters.propertyId || '' });
        setIsModalOpen(true);
    };

    const toggleGroup = (pid) => {
        setExpandedGroups(prev => ({ ...prev, [pid]: !prev[pid] }));
    };

    const rateLabel = (loan) => (loan._monthlyPayment !== null ? eur(loan._monthlyPayment) : '–');
    const percent = (v) => (v === null || v === undefined || v === '' ? '–' : `${v}%`);
    const issueHint = (loan) => (
        <>
            {loan._issue && (
                <div style={{ fontSize: '0.72rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }} title={loan._issue}>
                    <AlertCircle size={12} /> {loan._issue}
                </div>
            )}
            {loan._notice && (
                <div style={{ fontSize: '0.72rem', color: '#B45309', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }} title={loan._notice}>
                    <AlertCircle size={12} /> {loan._notice}
                </div>
            )}
        </>
    );

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Finanzierungen</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Verwaltung Ihrer Immobilienfinanzierungen</p>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <ExportDropdown
                        reportType="finanzierungen"
                        data={Object.values(groupedLoans).flatMap(g => g.loans.map(loan => ({
                            property_id: loan.property_id,
                            bank: loan.bank_name || '–',
                            immobilie: `${g.property?.street || ''} ${g.property?.house_number || ''}`.trim(),
                            darlehensbetrag: parseNum(loan.loan_amount) || 0,
                            zinssatz: (parseNum(loan.interest_rate) || 0) / 100,
                            tilgung: (parseNum(loan.initial_repayment_rate) || 0) / 100,
                            rate_monat: loan._monthlyPayment || 0,
                            restschuld: loan._currentDebt,
                            beginn: loan.start_date || '',
                            zinsbindung_bis: loan.end_date || '',
                            konto_nr: loan.account_number || '',
                            _propertyLabel: `${g.property?.street || ''} ${g.property?.house_number || ''}`.trim(),
                        })))}
                        properties={properties.map(p => ({ id: p.id, label: `${p.street} ${p.house_number}` }))}
                        totalRows={Object.values(groupedLoans).reduce((s, g) => s + g.loans.length, 0)}
                    />
                    <Button icon={Plus} onClick={openAdd}>Neues Darlehen</Button>
                </div>
            </div>

            {/* Filter */}
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Immobilie</label>
                        <select
                            style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)' }}
                            value={filters.propertyId}
                            onChange={e => {
                                const val = e.target.value;
                                setFilters(prev => ({ ...prev, propertyId: val }));
                            }}
                        >
                            <option value="">Alle Immobilien</option>
                            {(() => {
                                const weGroups = {};
                                const standalone = [];
                                properties.forEach(p => {
                                    if (p.economic_unit_id) {
                                        if (!weGroups[p.economic_unit_id]) weGroups[p.economic_unit_id] = [];
                                        weGroups[p.economic_unit_id].push(p);
                                    } else standalone.push(p);
                                });

                                const options = [];
                                Object.entries(weGroups).forEach(([weId, weProps]) => {
                                    const weRow = economicUnits.find(eu => eu.id === weId);
                                    const label = weRow?.name || `🏢 WE: ${Array.from(new Set(weProps.map(p => p.street))).join(', ')}`;
                                    options.push(<option key={`we_${weId}`} value={`we_${weId}`} style={{ fontWeight: 600 }}>{label}</option>);
                                    weProps.forEach(p => options.push(<option key={p.id} value={p.id}>  └ {p.street} {p.house_number}</option>));
                                });
                                standalone.forEach(p => options.push(<option key={p.id} value={p.id}>{p.street} {p.house_number}</option>));
                                return options;
                            })()}
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
                            }}
                        />
                    </div>
                </div>
            </div>

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
                                cursor: 'pointer',
                                flexWrap: 'wrap',
                                gap: '10px'
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
                            <div style={{ display: 'flex', gap: '2rem', textAlign: 'right', flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Gesamtdarlehen</div>
                                    <div style={{ fontWeight: 600 }}>{eur(group.totals.amount)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Restschuld (aktuell)</div>
                                    <div style={{ fontWeight: 600 }}>{eur(group.totals.currentDebt)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rate (mtl.)</div>
                                    <div style={{ fontWeight: 600 }}>{eur(group.totals.annuity)}</div>
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
                                                        {formatDateDE(loan.start_date)}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        {eur(parseNum(loan.loan_amount) || 0)}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        <div>{percent(loan.interest_rate)} Zins</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{percent(loan.initial_repayment_rate)} Tilgung</div>
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        {rateLabel(loan)}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                                                        {eur(loan._currentDebt)}
                                                        {issueHint(loan)}
                                                    </td>
                                                    <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>
                                                        {formatDateDE(loan.end_date)}
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
                                                    {eur(parseNum(loan.loan_amount) || 0)}
                                                </div>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Zins / Tilgung</div>
                                                    <div>{percent(loan.interest_rate)} / {percent(loan.initial_repayment_rate)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Rate</div>
                                                    <div>{rateLabel(loan)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Restschuld</div>
                                                    <div style={{ fontWeight: 600 }}>{eur(loan._currentDebt)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Laufzeit bis</div>
                                                    <div>{formatDateDE(loan.end_date)}</div>
                                                </div>
                                            </div>
                                            {loan._issue && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--danger-color)', marginBottom: '8px' }}>{loan._issue}</div>
                                            )}
                                            {loan._notice && (
                                                <div style={{ fontSize: '0.75rem', color: '#B45309', marginBottom: '8px' }}>{loan._notice}</div>
                                            )}

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
                                        // WE-Gruppen haben im Auswahlfeld den Wert we_<id>
                                        setLoanForm({ ...getEmptyForm(), property_id: group.isWE ? `we_${pid}` : pid });
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
                onClose={() => { if (!isSaving) setIsModalOpen(false); }}
                title={editingLoan ? "Darlehen bearbeiten" : "Neues Darlehen erfassen"}
                maxWidth="800px"
                footer={<><Button variant="secondary" disabled={isSaving} onClick={() => setIsModalOpen(false)}>Abbrechen</Button><Button disabled={isSaving} onClick={handleSave}>Speichern</Button></>}
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
                            {(() => {
                                // Build grouped options: WE groups first, then standalone properties
                                const weGroups = {};
                                const standalone = [];
                                properties.forEach(p => {
                                    if (p.economic_unit_id) {
                                        if (!weGroups[p.economic_unit_id]) {
                                            weGroups[p.economic_unit_id] = [];
                                        }
                                        weGroups[p.economic_unit_id].push(p);
                                    } else {
                                        standalone.push(p);
                                    }
                                });

                                const options = [];

                                // Add WE group options
                                Object.entries(weGroups).forEach(([weId, weProps]) => {
                                    const weRow = economicUnits.find(eu => eu.id === weId);
                                    if (weProps.length > 0 || weRow) {
                                        const streets = Array.from(new Set(weProps.map(p => p.street).filter(Boolean)));
                                        const houseNumbers = weProps.map(p => p.house_number).filter(Boolean).join(' & ');
                                        const label = weRow?.name || `🏢 WE: ${streets.join(', ')} ${houseNumbers}`;
                                        options.push(<option key={`we_${weId}`} value={`we_${weId}`} style={{ fontWeight: 600 }}>{label}</option>);
                                    }
                                    // Also add individual properties within the WE
                                    weProps.forEach(p => {
                                        options.push(<option key={p.id} value={p.id}>{weProps.length > 0 ? `  └ ` : ''}{p.street} {p.house_number}, {p.city}</option>);
                                    });
                                });

                                // Add standalone properties
                                standalone.forEach(p => {
                                    options.push(<option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>);
                                });

                                return options;
                            })()}
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

                    <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ gridColumn: 'span 2', fontWeight: 600, fontSize: '0.9rem', marginBottom: '-0.5rem' }}>Anpassung der Restschuld (Sondertilgung, Tilgungsaussetzung etc.)</div>
                        <CurrencyInput label="Tatsächliche Restschuld (€) [Optional]" allowDecimals value={loanForm.actual_residual_debt} onChange={e => setLoanForm({ ...loanForm, actual_residual_debt: e.target.value })} />
                        <Input
                            label="Gültig ab Datum"
                            type="date"
                            value={loanForm.actual_residual_debt_date}
                            onChange={e => setLoanForm({ ...loanForm, actual_residual_debt_date: e.target.value })}
                        />
                        <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '-0.5rem' }}>
                            <AlertCircle size={16} style={{ marginRight: '5px', flexShrink: 0 }} />
                            <span>Wenn angegeben, gilt die Restschuld am „Gültig ab“-Datum (nach der an diesem Tag fälligen Rate); ab dem nächsten regulären Ratentermin wird mit der unveränderten Rate weitergerechnet. Dies korrigiert z.B. Sondertilgungen. Restschuld 0 mit Datum = vollständig getilgt. Ohne Datum wird keine Anpassung gespeichert.</span>
                        </div>
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
                                <div style={{ fontWeight: 600 }}>{percent(scheduleLoan.interest_rate)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tilgung</div>
                                <div style={{ fontWeight: 600 }}>{percent(scheduleLoan.initial_repayment_rate)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Zinsbindung bis</div>
                                <div style={{ fontWeight: 600 }}>{formatDateDE(scheduleLoan.end_date)}</div>
                            </div>
                        </div>

                        {scheduleInfo.resetAt && (
                            <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                Tatsächliche Restschuld zum {scheduleInfo.resetAt.toLocaleDateString('de-DE')}: <strong>{eur(scheduleInfo.resetAmount)}</strong> – ab dem folgenden Ratentermin wird damit weitergerechnet.
                            </div>
                        )}
                        {scheduleInfo.notice && (
                            <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: '#B45309', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <AlertCircle size={16} /> {scheduleInfo.notice}
                            </div>
                        )}
                        {scheduleInfo.issue && (
                            <div style={{ marginBottom: '0.75rem', padding: '10px 12px', borderRadius: '6px', backgroundColor: 'rgba(239, 68, 68, 0.06)', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: '0.85rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <AlertCircle size={16} /> {scheduleInfo.issue}
                            </div>
                        )}

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
                                    {scheduleData.map((row) => (
                                        <tr key={row.year} className="table-row" style={{ borderBottom: '1px solid #eee' }}>
                                            <td style={{ padding: '8px' }}>{row.year}</td>
                                            <td style={{ textAlign: 'right', padding: '8px', color: 'var(--danger-color)' }}>{eur(row.interest)}</td>
                                            <td style={{ textAlign: 'right', padding: '8px', color: 'var(--success-color)' }}>{eur(row.principal)}</td>
                                            <td style={{ textAlign: 'right', padding: '8px' }}>{eur(row.payment)}</td>
                                            <td style={{ textAlign: 'right', padding: '8px', fontWeight: 600 }}>{eur(row.endBalance)}</td>
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
