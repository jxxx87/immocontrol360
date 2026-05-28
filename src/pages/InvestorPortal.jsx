import React, { useState, useEffect, useRef } from 'react';
import {
    Calculator,
    TrendingUp,
    Wallet,
    Info,
    Plus,
    Building2,
    MapPin,
    ArrowUpRight,
    Loader2,
    Gauge,
    ShieldCheck,
    Coins,
    Zap,
    Trash2,
    Save,
    MoreVertical,
    Eye,
    X,
    ClipboardList,
    FileText,
    Edit3,
    Flame
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import CurrencyInput from '../components/ui/CurrencyInput';
import RateInput from '../components/ui/RateInput';
import FixFlipCalculator from './investor/FixFlipCalculator';
import { supabase } from '../lib/supabase';
import { generateClientPdf } from '../lib/pdfGenerator';
import { usePdfTemplate } from '../lib/usePdfTemplate';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { useViewMode } from '../context/ViewModeContext';
import ExportDropdown from '../components/ExportDropdown';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

const InvestorPortal = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const { selectedPortfolioID } = usePortfolio();
    const auditRef = useRef(null);

    // UI State
    const { isMobile } = useViewMode();
    const [activeTab, setActiveTab] = useState('cockpit');
    const [activeDealType, setActiveDealType] = useState('buy_hold');
    const pdfTemplate = usePdfTemplate('deal_kalkulation');
    const [auditStep, setAuditStep] = useState(0);
    const [loading, setLoading] = useState(true);
    // eslint-disable-next-line no-unused-vars
    const [saving, setSaving] = useState(null);

    // Detail Modal
    const [detailProperty, setDetailProperty] = useState(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // Audit Modal (Inline in cockpit table)
    const [auditPropertyId, setAuditPropertyId] = useState(null);

    // Expandable Group State
    const [expandedWEId, setExpandedWEId] = useState(null);

    // Action Menu
    const [openMenuId, setOpenMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    // Data State
    const [properties, setProperties] = useState([]);
    const [loans, setLoans] = useState([]);
    const [economicUnits, setEconomicUnits] = useState([]);
    const [weEditModal, setWeEditModal] = useState(null);
    const [stats, setStats] = useState({
        netCashflow: 0,
        ltv: 0,
        rentPotential: 0,
        totalMarketValue: 0,
        totalDebt: 0
    });

    // Renovation Stats (for cockpit card)
    // eslint-disable-next-line no-unused-vars
    const [renovationStats, setRenovationStats] = useState({ activeProjects: 0, openTasks: 0 });

    // Rent increase tracking
    const [pendingIncreases, setPendingIncreases] = useState([]);
    const [showIncreasesModal, setShowIncreasesModal] = useState(false);

    // Deals State
    const [deals, setDeals] = useState([]);
    const [editingDealId, setEditingDealId] = useState(null);
    const [dealName, setDealName] = useState('Neuer Deal');
    const [savingDeal, setSavingDeal] = useState(false);

    // Ankaufsprüfung (standalone page) State
    const [auditData, setAuditData] = useState({
        purchasePrice: 0,
        transferTaxRate: 5,
        brokerRate: 3.57,
        notaryRate: 1.5,
        registryRate: 0.5,
        renovationCosts: 0,
        // Ertrag IST (Summe Mo.)
        coldRentIst: 0,
        garageIst: 0,
        otherCostsIst: 0,
        // Ertrag SOLL (Summe Mo.)
        coldRentSoll: 0,
        garageSoll: 0,
        otherCostsSoll: 0,
        targetYear: '',
        // Kosten
        housegeld: '',
        reserves: '',
        // Finanzierung
        equity: 0,
        loans: [{ amount: 0, interest: 3.5, repayment: 2, fixedYears: 10 }],
        // Steuern
        afaRate: 2,
        buildingShare: 80,
        taxRate: 42
    });

    const [scenario, setScenario] = useState({
        rentGrowth: 3,
        interestAdj: 0,
        repaymentAdj: 2
    });

    // Tooltip for Grunderwerbsteuer
    const [showTaxInfo, setShowTaxInfo] = useState(false);
    const [showRenovInfo, setShowRenovInfo] = useState(false);

    // State Tax Reference
    const statesTaxRef = [
        { name: 'Bayern', tax: 3.5 },
        { name: 'Hamburg', tax: 4.5 },
        { name: 'Baden-Württemberg', tax: 5.0 },
        { name: 'Bremen', tax: 5.0 },
        { name: 'Rheinland-Pfalz', tax: 5.0 },
        { name: 'Sachsen-Anhalt', tax: 5.0 },
        { name: 'Sachsen', tax: 5.5 },
        { name: 'Schleswig-Holstein', tax: 5.5 },
        { name: 'Berlin', tax: 6.0 },
        { name: 'Hessen', tax: 6.0 },
        { name: 'Mecklenburg-Vorpommern', tax: 6.0 },
        { name: 'Brandenburg', tax: 6.5 },
        { name: 'Nordrhein-Westfalen', tax: 6.5 },
        { name: 'Saarland', tax: 6.5 },
        { name: 'Niedersachsen', tax: 5.0 },
        { name: 'Thüringen', tax: 5.0 }
    ];

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        setActiveTab(tab || 'cockpit');
        const urlDealId = params.get('dealId');
        if (tab === 'deals' || !tab || tab === 'cockpit' || (tab === 'audit' && urlDealId)) fetchDeals();
        // Auto-load a deal when returning from Sanierungsrechner with ?dealId=xxx
        if (tab === 'audit' && urlDealId && deals.length > 0 && editingDealId !== urlDealId) {
            const deal = deals.find(d => d.id === urlDealId);
            if (deal) loadDeal(deal);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search, deals]);

    useEffect(() => {
        if (user) fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, selectedPortfolioID]);

    // Close menu on outside click
    // Close audit panel on click outside
    useEffect(() => {
        if (!auditPropertyId) return;
        const handleClickOutsideAudit = (e) => {
            if (auditRef.current && !auditRef.current.contains(e.target)) {
                setAuditPropertyId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutsideAudit);
        return () => document.removeEventListener('mousedown', handleClickOutsideAudit);
    }, [auditPropertyId]);

    useEffect(() => {
        const handleClick = () => setOpenMenuId(null);
        if (openMenuId) document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, [openMenuId]);

    const fetchData = async () => {
        try {
            setLoading(true);
            let propQuery = supabase.from('properties').select('*, units(*, leases(*, tenant:tenants(first_name, last_name)))');
            if (selectedPortfolioID) propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);
            const { data: propData } = await propQuery;

            let loanQuery = supabase.from('loans').select('*');
            if (selectedPortfolioID) {
                loanQuery = loanQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const { data: loanData } = loanQuery ? await loanQuery : { data: [] };

            let weQuery = supabase.from('economic_units').select('*');
            const { data: weData } = await weQuery;

            setProperties(propData || []);
            setLoans(loanData || []);
            setEconomicUnits(weData || []);
            calculateCockpitStats(propData || [], loanData || [], weData || []);

            // Fetch renovation stats for cockpit card
            try {
                const [projRes, taskRes] = await Promise.all([
                    supabase.from('renovation_projects').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
                    supabase.from('renovation_tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_completed', false),
                ]);
                setRenovationStats({ activeProjects: projRes.count || 0, openTasks: taskRes.count || 0 });
            } catch { /* renovation tables may not exist yet */ }

            // Calculate pending rent increases
            const LEASE_TYPE_LABELS = { normal: 'Normalmietvertrag', staffel: 'Staffelmietvertrag', index: 'Indexmietvertrag' };
            const now = new Date();
            const pending = [];
            (propData || []).forEach(p => {
                const addr = `${p.street} ${p.house_number || ''}`.trim();
                (p.units || []).forEach(u => {
                    const activeLease = u.leases?.find(l => l.status === 'active');
                    if (!activeLease) return;
                    const type = activeLease.lease_type || 'normal';
                    const yearsToAdd = type === 'normal' ? 3 : 1;
                    const baseDate = activeLease.last_rent_increase || activeLease.start_date;
                    if (!baseDate) return;
                    const nextDate = new Date(baseDate);
                    nextDate.setFullYear(nextDate.getFullYear() + yearsToAdd);
                    const oneMonthBefore = new Date(nextDate);
                    oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
                    if (now >= oneMonthBefore) {
                        pending.push({
                            tenantName: activeLease.tenant?.first_name
                                ? `${activeLease.tenant.first_name} ${activeLease.tenant.last_name || ''}`
                                : (activeLease.tenant_id || '–'),
                            property: addr,
                            unit: u.unit_name || '–',
                            leaseType: LEASE_TYPE_LABELS[type] || type,
                            nextDate,
                        });
                    }
                });
            });
            setPendingIncreases(pending);
        } catch (error) {
            console.error('Fehler beim Laden der Daten:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculateCockpitStats = (props, lns, WEs = economicUnits) => {
        let totalMonthlyIncome = 0;
        let totalDebt = 0;
        let totalMarketValue = 0;
        let totalTargetRent = 0;
        let totalMonthlyDebtService = 0;

        // Group properties to sum market value taking WEs into account
        const groups = {};
        let ungroupedMarketValue = 0;

        props.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = { sum: 0 };
                }
                groups[p.economic_unit_id].sum += parseFloat(p.market_value_total) || 0;
            } else {
                ungroupedMarketValue += parseFloat(p.market_value_total) || 0;
            }

            (p.units || []).forEach(u => {
                if (u.is_vacation_rental) {
                    const fewoRent = parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
                    totalMonthlyIncome += fewoRent;
                    totalTargetRent += fewoRent;
                } else {
                    const activeLease = u.leases?.find(l => l.status === 'active');
                    totalMonthlyIncome += activeLease ? (parseFloat(activeLease.cold_rent) || 0) : 0;
                    totalTargetRent += (parseFloat(u.target_rent) || 0);
                }
            });
        });

        // Sum up groups, using WE-level override if present
        let groupedMarketValue = 0;
        Object.entries(groups).forEach(([weId, g]) => {
            const weRow = WEs.find(eu => eu.id === weId);
            if (weRow && parseFloat(weRow.market_value_total) > 0) {
                groupedMarketValue += parseFloat(weRow.market_value_total);
            } else {
                groupedMarketValue += g.sum;
            }
        });

        totalMarketValue = ungroupedMarketValue + groupedMarketValue;

        lns.forEach(loan => {
            totalDebt += calculateCurrentDebt(loan);
            const amount = parseFloat(loan.loan_amount) || 0;
            const interestRate = (parseFloat(loan.interest_rate) || 0) / 100;
            const repaymentRate = (parseFloat(loan.initial_repayment_rate) || 0) / 100;
            if (loan.fixed_annuity) totalMonthlyDebtService += parseFloat(loan.fixed_annuity);
            else totalMonthlyDebtService += (amount * (interestRate + repaymentRate)) / 12;
        });

        setStats({
            netCashflow: totalMonthlyIncome - totalMonthlyDebtService,
            ltv: totalMarketValue > 0 ? (totalDebt / totalMarketValue) * 100 : 0,
            rentPotential: totalTargetRent - totalMonthlyIncome,
            totalMarketValue,
            totalDebt
        });
    };

    const calculateCurrentDebt = (loan) => {
        const originalAmount = parseFloat(loan.loan_amount) || 0;
        const interestRate = (parseFloat(loan.interest_rate) || 0) / 100;
        const repaymentRate = (parseFloat(loan.initial_repayment_rate) || 0) / 100;
        const payment = loan.fixed_annuity ? parseFloat(loan.fixed_annuity) : (originalAmount * (interestRate + repaymentRate) / 12);

        const hasActual = loan.actual_residual_debt !== null && loan.actual_residual_debt !== undefined;
        let balance = hasActual ? parseFloat(loan.actual_residual_debt) : originalAmount;
        const startDateStr = hasActual && loan.actual_residual_debt_date ? loan.actual_residual_debt_date : loan.start_date;

        const startDate = new Date(startDateStr);
        const today = new Date();
        if (isNaN(startDate.getTime())) return balance;
        const monthsDiff = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth());
        if (monthsDiff <= 0) return balance;

        for (let i = 0; i < monthsDiff; i++) {
            const interest = balance * interestRate / 12;
            balance -= (payment - interest);
            if (balance < 0) return 0;
        }
        return balance;
    };

    const getPropertyDebt = (propertyId) => {
        return loans
            .filter(l => l.property_id === propertyId)
            .reduce((sum, l) => sum + calculateCurrentDebt(l), 0);
    };

    const getPropertyRentIst = (property) => {
        let total = 0;
        (property.units || []).forEach(u => {
            if (u.is_vacation_rental) {
                total += parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0;
            } else {
                const activeLease = u.leases?.find(l => l.status === 'active');
                if (activeLease) total += parseFloat(activeLease.cold_rent) || 0;
            }
        });
        return total;
    };

    const getPropertyRentSoll = (property) => {
        return (property.units || []).reduce((sum, u) => {
            if (u.is_vacation_rental) {
                return sum + (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
            }
            return sum + (parseFloat(u.target_rent) || 0);
        }, 0);
    };

    const getPropertyLoanPayment = (propertyId) => {
        return loans
            .filter(l => l.property_id === propertyId)
            .reduce((sum, l) => {
                const amount = parseFloat(l.loan_amount) || 0;
                const interestRate = (parseFloat(l.interest_rate) || 0) / 100;
                const repaymentRate = (parseFloat(l.initial_repayment_rate) || 0) / 100;
                if (l.fixed_annuity) return sum + parseFloat(l.fixed_annuity);
                return sum + (amount * (interestRate + repaymentRate)) / 12;
            }, 0);
    };

    const getGroupOrPropertyLoanPayment = (p) => {
        if (p.isGroup) {
            let sum = p.properties.reduce((s, subP) => s + getPropertyLoanPayment(subP.id), 0);
            const weLoans = loans.filter(l => l.economic_unit_id === p.economic_unit_id && !l.property_id);
            weLoans.forEach(l => {
                const amount = parseFloat(l.loan_amount) || 0;
                const interestRate = (parseFloat(l.interest_rate) || 0) / 100;
                const repaymentRate = (parseFloat(l.initial_repayment_rate) || 0) / 100;
                if (l.fixed_annuity) sum += parseFloat(l.fixed_annuity);
                else sum += (amount * (interestRate + repaymentRate)) / 12;
            });
            return sum;
        }
        return getPropertyLoanPayment(p.id);
    };

    const getVacancy = (p) => {
        const units = p.isGroup ? p.properties.flatMap(subP => subP.units || []) : (p.units || []);
        const total = units.length;
        if (total === 0) return '–';
        const vacant = units.filter(u => !u.is_vacation_rental && !u.leases?.some(l => l.status === 'active')).length;
        return `${vacant} / ${total}`;
    };

    // Group Properties by Economic Unit
    const groupedProperties = React.useMemo(() => {
        const groups = {};
        const result = [];

        properties.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = {
                        id: 'we_' + p.economic_unit_id,
                        isGroup: true,
                        economic_unit_id: p.economic_unit_id,
                        street: 'Wirtschaftseinheit',
                        house_number: '',
                        properties: [],
                        total_investment_cost: 0,
                        equity_invested: 0,
                        market_value_total: 0,
                        _rentIst: 0,
                        _rentSoll: 0,
                        _debt: 0,
                        _totalSqm: 0
                    };
                }
                const group = groups[p.economic_unit_id];
                group.properties.push(p);
                group.total_investment_cost += (parseFloat(p.total_investment_cost) || 0);
                group.equity_invested += (parseFloat(p.equity_invested) || 0);
                group.market_value_total += (parseFloat(p.market_value_total) || 0);
                group._rentIst += getPropertyRentIst(p);
                group._rentSoll += getPropertyRentSoll(p);
                group._debt += getPropertyDebt(p.id);
                group._totalSqm += (p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0);
            } else {
                result.push(p);
            }
        });

        Object.values(groups).forEach(g => {
            const weRow = economicUnits.find(eu => eu.id === g.economic_unit_id);
            if (g.properties.length === 1 && !weRow) {
                result.push(g.properties[0]);
            } else if (g.properties.length > 0) {
                const streets = Array.from(new Set(g.properties.map(pr => pr.street).filter(Boolean)));
                g.street = weRow?.name || `Wirtschaftseinheit: ${streets.length > 0 ? streets.join(', ') : 'Diverse'}`;
                g.house_number = g.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                
                // Override calculated sums with explicit WE values if they are > 0
                if (weRow) {
                    if (parseFloat(weRow.total_investment_cost) > 0) g.total_investment_cost = parseFloat(weRow.total_investment_cost);
                    if (parseFloat(weRow.equity_invested) > 0) g.equity_invested = parseFloat(weRow.equity_invested);
                    if (parseFloat(weRow.market_value_total) > 0) g.market_value_total = parseFloat(weRow.market_value_total);
                }
                // Add WE-level loans to _debt
                const weLoans = loans.filter(l => l.economic_unit_id === g.economic_unit_id && !l.property_id);
                weLoans.forEach(l => {
                    g._debt += calculateCurrentDebt(l);
                });

                result.push(g);
            }
        });

        return result.sort((a, b) => (a.street || '').localeCompare(b.street || ''));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [properties, loans, economicUnits]);

    const handleUpdateProperty = async (id, updates) => {
        try {
            setSaving(id);
            const { error } = await supabase.from('properties').update(updates).eq('id', id);
            if (error) throw error;
            const updatedProps = properties.map(p => p.id === id ? { ...p, ...updates } : p);
            setProperties(updatedProps);
            if (detailProperty?.id === id) setDetailProperty({ ...detailProperty, ...updates });
            if (updates.market_value_total !== undefined) {
                calculateCockpitStats(updatedProps, loans, economicUnits);
            }
        } catch (err) {
            alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(null);
        }
    };

    const handleUpdateWE = async (id, updates) => {
        try {
            const rowData = {
                id,
                user_id: user.id,
                ...updates,
                updated_at: new Date().toISOString()
            };
            const { error } = await supabase.from('economic_units').upsert(rowData, { onConflict: 'id' });
            if (error) throw error;
            const exists = economicUnits.some(eu => eu.id === id);
            let updatedWEs;
            if (exists) {
                updatedWEs = economicUnits.map(eu => eu.id === id ? { ...eu, ...updates } : eu);
            } else {
                updatedWEs = [...economicUnits, rowData];
            }
            setEconomicUnits(updatedWEs);
            calculateCockpitStats(properties, loans, updatedWEs);
        } catch (err) {
            alert('Fehler beim Speichern der Wirtschaftseinheit: ' + err.message);
        }
    };

    const formatCurrency = (val) => {
        const num = parseFloat(val) || 0;
        return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    };

    const cashflowColor = (val) => val >= 0 ? '#10B981' : '#EF4444';

    // ─── DEAL CRUD ──────────────────────────────────────────────────
    const fetchDeals = async () => {
        if (!user) return;
        const { data } = await supabase
            .from('deals')
            .select('*')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });
        if (data) setDeals(data);
    };

    const saveDeal = async (skipNavigate = false) => {
        if (!user || savingDeal) return editingDealId;
        setSavingDeal(true);
        let resultId = editingDealId;
        try {
            const metrics = calculateAuditMetrics();
            const loanTotal = auditData.loans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
            const payload = {
                user_id: user.id,
                portfolio_id: selectedPortfolioID || null,
                name: dealName || 'Neuer Deal',
                deal_type: 'buy_hold',
                purchase_price: parseFloat(auditData.purchasePrice) || 0,
                total_investment: metrics.totalInvestment,
                cold_rent_ist: parseFloat(auditData.coldRentIst) || 0,
                cold_rent_soll: parseFloat(auditData.coldRentSoll) || 0,
                equity: parseFloat(auditData.equity) || 0,
                loan_total: loanTotal,
                deal_data: { ...auditData, deal_type: 'buy_hold' },
                scenario_data: scenario,
                updated_at: new Date().toISOString()
            };
            if (editingDealId) {
                await supabase.from('deals').update(payload).eq('id', editingDealId);
            } else {
                const { data } = await supabase.from('deals').insert(payload).select();
                if (data?.[0]) {
                    resultId = data[0].id;
                    setEditingDealId(data[0].id);
                }
            }
            await fetchDeals();
            if (!skipNavigate) navigate('/investor-portal?tab=deals');
        } finally {
            setSavingDeal(false);
        }
        return resultId;
    };

    const saveFixFlipDeal = async (inputs, results) => {
        if (!user || savingDeal) return;
        setSavingDeal(true);
        try {
            const payload = {
                user_id: user.id,
                portfolio_id: selectedPortfolioID || null,
                name: inputs.name || 'Neuer Fix & Flip Deal',
                deal_type: 'fix_flip',
                purchase_price: inputs.purchasePrice || 0,
                total_investment: results.totalInvest || 0,
                cold_rent_ist: inputs.coldRentIst || 0,
                cold_rent_soll: inputs.coldRentSoll || 0,
                equity: 0,
                loan_total: 0,
                deal_data: { ...inputs, deal_type: 'fix_flip' },
                scenario_data: results,
                updated_at: new Date().toISOString()
            };
            if (editingDealId) {
                await supabase.from('deals').update(payload).eq('id', editingDealId);
            } else {
                const { data } = await supabase.from('deals').insert(payload).select();
                if (data?.[0]) setEditingDealId(data[0].id);
            }
            await fetchDeals();
            navigate('/investor-portal?tab=deals');
        } catch (e) {
            console.error(e);
        } finally {
            setSavingDeal(false);
        }
    };

    const deleteDeal = async (id) => {
        if (!confirm('Deal wirklich löschen?')) return;
        await supabase.from('deals').delete().eq('id', id);
        if (editingDealId === id) setEditingDealId(null);
        await fetchDeals();
    };

    const loadDeal = (deal) => {
        const type = deal.deal_type || deal.deal_data?.deal_type || 'buy_hold';
        setActiveDealType(type);
        setAuditData(deal.deal_data);
        if (type === 'buy_hold') {
            setScenario(deal.scenario_data || { rentGrowth: 3, interestAdj: 0, repaymentAdj: 2 });
        }
        setDealName(deal.name);
        setEditingDealId(deal.id);
        navigate('/investor-portal?tab=audit');
    };

    const startNewDeal = (type = 'buy_hold') => {
        setActiveDealType(type);
        setAuditData({
            purchasePrice: '', coldRentIst: '', coldRentSoll: '',
            housegeld: '', reserves: '', equity: 0,
            loans: [{ amount: 0, interest: 3.5, repayment: 2, fixedYears: 10 }],
            afaRate: 2, buildingShare: 80, taxRate: 42
        });
        setScenario({ rentGrowth: 3, interestAdj: 0, repaymentAdj: 2 });
        setDealName(type === 'fix_flip' ? 'Neuer Fix & Flip Deal' : 'Neuer Deal');
        setEditingDealId(null);
        navigate('/investor-portal?tab=audit');
    };

    // ─── RANKING LOGIC ─────────────────────────────────────────────
    const getDealRanking = (deal) => {
        const type = deal.deal_type || deal.deal_data?.deal_type || 'buy_hold';
        if (type === 'buy_hold') {
            // Buy & Hold: Cashflow vor Steuer/Mo × 12 × 10 = 10-Jahres-Cashflow
            const d = deal.deal_data || {};
            const pp = parseFloat(d.purchasePrice) || 0;
            const ttr = parseFloat(d.transferTaxRate) || 0;
            const br = parseFloat(d.brokerRate) || 0;
            const nr = parseFloat(d.notaryRate) || 0;
            const rr = parseFloat(d.registryRate) || 0;
            const knk = pp * ((ttr + br + nr + rr) / 100);
            // eslint-disable-next-line no-unused-vars
            const totalInv = pp + knk + (parseFloat(d.renovationCosts) || 0);
            const grossIstMo = (parseFloat(d.coldRentIst) || 0) + (parseFloat(d.garageIst) || 0);
            const hg = parseFloat(d.housegeld) || 0;
            const res = parseFloat(d.reserves) || 0;
            const nonRecPA = (hg + res) * 12;
            const incomeIstPA = grossIstMo * 12;
            let totalIntPA = 0, totalRepPA = 0;
            (d.loans || []).forEach(l => {
                const amt = parseFloat(l.amount) || 0;
                totalIntPA += amt * ((parseFloat(l.interest) || 0) / 100);
                totalRepPA += amt * ((parseFloat(l.repayment) || 0) / 100);
            });
            const cfPreTaxMo = (incomeIstPA - nonRecPA - totalIntPA - totalRepPA) / 12;
            return cfPreTaxMo * 12 * 10; // 10-Jahres-Cashflow
        } else {
            // Fix & Flip: Durchschnitt aller positiven Gewinne
            const res = deal.scenario_data || {};
            const profits = [];
            if ((res.profitLow || 0) > 0) profits.push(res.profitLow);
            if ((res.profitHigh || 0) > 0) profits.push(res.profitHigh);
            if ((res.kapProfitIst || 0) > 0) profits.push(res.kapProfitIst);
            if ((res.kapProfitSoll || 0) > 0) profits.push(res.kapProfitSoll);
            return profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
        }
    };

    // ─── RENDER: DEALS OVERVIEW ─────────────────────────────────────
    const renderDealsOverview = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <Button icon={Plus} onClick={() => startNewDeal('buy_hold')}>Buy & Hold</Button>
                <Button icon={Plus} onClick={() => startNewDeal('fix_flip')}>Fix & Flip</Button>
            </div>
            <Card title="Gespeicherte Deals" icon={FileText} color="#8B5CF6">
                {deals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.5 }}>
                        <FileText size={48} style={{ margin: '0 auto 16px', display: 'block' }} />
                        <p style={{ fontSize: '1rem', fontWeight: 500 }}>Noch keine Deals gespeichert</p>
                        <p style={{ fontSize: '0.85rem', marginTop: '4px' }}>Klicken Sie auf "Neuen Deal schnell rechnen" um zu starten.</p>
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile" style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                        {['Ranking', 'Name', 'Typ', 'Kaufpreis', 'Gesamtinvest.', 'Kaltmiete IST', 'Kaltmiete SOLL', 'EK', 'Darlehen', 'Aktionen'].map(h => (
                                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...deals]
                                        .map(deal => ({ ...deal, _ranking: getDealRanking(deal) }))
                                        .sort((a, b) => b._ranking - a._ranking)
                                        .map((deal, idx) => (
                                            <tr key={deal.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background-color 0.15s' }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                onClick={() => loadDeal(deal)}>
                                                <td style={{ padding: '12px', fontWeight: 700, color: idx === 0 ? '#f97316' : 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                                    {idx === 0 ? '🔥' : idx + 1}
                                                </td>
                                                <td style={{ padding: '12px', fontWeight: 600 }}>{deal.name}</td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                                                    <span style={{
                                                        padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600,
                                                        backgroundColor: (deal.deal_type || deal.deal_data?.deal_type) === 'fix_flip' ? 'rgba(249, 115, 22, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                                                        color: (deal.deal_type || deal.deal_data?.deal_type) === 'fix_flip' ? '#f97316' : '#3B82F6'
                                                    }}>
                                                        {(deal.deal_type || deal.deal_data?.deal_type) === 'fix_flip' ? 'Fix & Flip' : 'Buy & Hold'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.purchase_price)}</td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.total_investment)}</td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{deal.cold_rent_ist > 0 ? formatCurrency(deal.cold_rent_ist) : '–'}</td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap', color: deal.cold_rent_soll > 0 ? '#3B82F6' : 'var(--text-secondary)' }}>
                                                    {deal.cold_rent_soll > 0 ? formatCurrency(deal.cold_rent_soll) : '–'}
                                                </td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{deal.equity > 0 ? formatCurrency(deal.equity) : '–'}</td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{deal.loan_total > 0 ? formatCurrency(deal.loan_total) : '–'}</td>
                                                <td style={{ padding: '12px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <span style={{ cursor: 'pointer', color: 'var(--primary-color)' }} onClick={() => loadDeal(deal)} title="Bearbeiten">
                                                            <Edit3 size={15} />
                                                        </span>
                                                        <span style={{ cursor: 'pointer', color: 'var(--danger-color, #ef4444)', opacity: 0.7 }} onClick={() => deleteDeal(deal.id)} title="Löschen">
                                                            <Trash2 size={15} />
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile View for Deals */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {[...deals]
                                .map(deal => ({ ...deal, _ranking: getDealRanking(deal) }))
                                .sort((a, b) => b._ranking - a._ranking)
                                .map((deal, idx) => (
                                    <div key={deal.id}
                                        onClick={() => loadDeal(deal)}
                                        style={{
                                            border: idx === 0 ? '1px solid #f97316' : '1px solid var(--border-color)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: 'var(--spacing-md)',
                                            backgroundColor: 'var(--surface-color)',
                                            cursor: 'pointer'
                                        }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: idx === 0 ? '#f97316' : 'var(--text-secondary)' }}>{idx === 0 ? '🔥' : `#${idx + 1}`}</span>
                                                <span style={{ fontWeight: 600, fontSize: '1rem' }}>{deal.name}</span>
                                                <span style={{
                                                    padding: '2px 7px', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 600,
                                                    backgroundColor: (deal.deal_type || deal.deal_data?.deal_type) === 'fix_flip' ? 'rgba(249, 115, 22, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                                                    color: (deal.deal_type || deal.deal_data?.deal_type) === 'fix_flip' ? '#f97316' : '#3B82F6'
                                                }}>
                                                    {(deal.deal_type || deal.deal_data?.deal_type) === 'fix_flip' ? 'Fix & Flip' : 'Buy & Hold'}
                                                </span>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Kaufpreis</div>
                                                <div style={{ fontWeight: 500 }}>{formatCurrency(deal.purchase_price)}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Gesamtinvest</div>
                                                <div style={{ fontWeight: 500 }}>{formatCurrency(deal.total_investment)}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Miete IST</div>
                                                <div style={{ fontWeight: 500 }}>{deal.cold_rent_ist > 0 ? formatCurrency(deal.cold_rent_ist) : '–'}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Miete SOLL</div>
                                                <div style={{ fontWeight: 500 }}>{deal.cold_rent_soll > 0 ? formatCurrency(deal.cold_rent_soll) : '–'}</div>
                                            </div>
                                        </div>

                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                                            <button onClick={(e) => { e.stopPropagation(); loadDeal(deal); }} style={{ color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Edit3 size={16} /> Bearbeiten
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); deleteDeal(deal.id); }} style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Trash2 size={16} /> Löschen
                                            </button>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </>
                )}
            </Card>
        </div>
    );

    // ─── RENDER: COCKPIT ───────────────────────────────────────────
    const renderCockpit = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
            {/* KPI Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-lg)' }}>
                <Card title="Netto-Cashflow" icon={Wallet} color="#10B981">
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700, color: cashflowColor(stats.netCashflow) }}>{formatCurrency(stats.netCashflow)}</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Nach Zins & Tilgung (Ist)</p>
                </Card>
                <Card title="Portfolio LTV" icon={TrendingUp} color="#3B82F6">
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.ltv.toFixed(1)} %</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gesamte Portfoliokredite</p>
                </Card>
                <Card title="Mietpotential" icon={ArrowUpRight} color="#F59E0B">
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(stats.rentPotential)}</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>IST vs. SOLL Kaltmiete</p>
                </Card>
                <Card title="Mieterhöhungen" icon={TrendingUp} color="#EC4899">
                    <div
                        onClick={() => pendingIncreases.length > 0 && setShowIncreasesModal(true)}
                        style={{ cursor: pendingIncreases.length > 0 ? 'pointer' : 'default' }}
                    >
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 700, color: pendingIncreases.length > 0 ? '#EC4899' : 'inherit' }}>{pendingIncreases.length}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {pendingIncreases.length === 1 ? 'Erhöhung möglich' : 'Erhöhungen möglich'}
                        </p>
                        {pendingIncreases.length > 0 && (
                            <p style={{ fontSize: '0.7rem', color: 'var(--primary-color)', marginTop: '4px', fontWeight: 600 }}>Klicken für Details →</p>
                        )}
                    </div>
                </Card>
                <Card title="Marktwert Portfolio" icon={Building2} color="#8B5CF6">
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(stats.totalMarketValue)}</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Summe Objektwerte</p>
                </Card>
            </div>

            {/* Portfolio Table */}
            <Card title="Portfolio Management & Objekt-Sicht">
                {/* Desktop View */}
                <div className="hidden-mobile" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <th style={{ width: '40px', padding: '12px 0 12px 16px' }}></th>
                                <th style={{ textAlign: 'left', padding: '12px 16px' }}>Immobilie</th>
                                <th style={{ textAlign: 'right', padding: '12px 16px' }}>Gesamtinvest</th>
                                <th style={{ textAlign: 'right', padding: '12px 16px' }}>Eigenkapital</th>
                                <th style={{ textAlign: 'right', padding: '12px 16px' }}>Miete IST p.a.</th>
                                <th style={{ textAlign: 'right', padding: '12px 16px' }}>Miete SOLL p.a.</th>
                                <th style={{ textAlign: 'right', padding: '12px 16px' }}>Marktwert</th>
                                <th style={{ textAlign: 'right', padding: '12px 16px' }}>Restschuld</th>
                                <th style={{ textAlign: 'center', padding: '12px 16px', width: '60px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {groupedProperties.map(pOrGroup => {
                                const renderRow = (p, isSubRow = false) => {
                                    const totalSqm = p.isGroup ? p._totalSqm : (p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0);
                                    const rentIstMo = p.isGroup ? p._rentIst : getPropertyRentIst(p);
                                    const rentSollMo = p.isGroup ? p._rentSoll : getPropertyRentSoll(p);
                                    const debt = p.isGroup ? p._debt : getPropertyDebt(p.id);
                                    const marketValue = parseFloat(p.market_value_total) || 0;
                                    
                                    return (
                                        <React.Fragment key={p.id}>
                                            <tr style={{ 
                                                    borderBottom: (p.isGroup && expandedWEId === p.id) ? 'none' : '1px solid var(--border-color)', 
                                                    transition: 'background 0.15s',
                                                    backgroundColor: p.isGroup ? 'rgba(139, 92, 246, 0.02)' : (isSubRow ? 'rgba(0,0,0,0.01)' : 'transparent')
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = p.isGroup ? 'rgba(139, 92, 246, 0.05)' : 'rgba(59,130,246,0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = p.isGroup ? 'rgba(139, 92, 246, 0.02)' : (isSubRow ? 'rgba(0,0,0,0.01)' : 'transparent')}
                                                onClick={() => { if (p.isGroup) setExpandedWEId(expandedWEId === p.id ? null : p.id); }}
                                            >
                                                <td style={{ padding: '14px 0 14px 16px', cursor: p.isGroup ? 'pointer' : 'default', paddingLeft: isSubRow ? '40px' : '16px' }}>
                                                    {p.isGroup && (
                                                        <span style={{ color: 'var(--text-secondary)' }}>
                                                            {expandedWEId === p.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <div style={{ fontWeight: p.isGroup ? 700 : 600, fontSize: '0.9rem', color: p.isGroup ? 'var(--accent-color)' : 'inherit' }}>{p.street} {p.house_number}</div>
                                                    {!p.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.zip} {p.city}{totalSqm > 0 ? ` • ${totalSqm} m²` : ''}</div>}
                                                    {p.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.properties.length} Gebäude verknüpft</div>}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: p.isGroup ? 600 : 500 }}>
                                                    {(parseFloat(p.total_investment_cost) || 0) > 0 ? (
                                                        p.isGroup ? (
                                                            <span onClick={(e) => { e.stopPropagation(); setWeEditModal({ ...p, field: 'total_investment_cost' }); }} style={{ cursor: 'pointer', borderBottom: '1px dashed var(--primary-color)', paddingBottom: '2px' }} title="Gesamtinvestition bearbeiten">
                                                                {formatCurrency(p.total_investment_cost)}
                                                            </span>
                                                        ) : (
                                                            formatCurrency(p.total_investment_cost)
                                                        )
                                                    ) : (
                                                        <button
                                                            onClick={(e) => { 
                                                                e.stopPropagation(); 
                                                                if (p.isGroup) setWeEditModal({ ...p, field: 'total_investment_cost' });
                                                                else navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`); 
                                                            }}
                                                            style={{
                                                                background: 'none', border: '1px dashed var(--primary-color)',
                                                                color: 'var(--primary-color)', cursor: 'pointer', borderRadius: '6px',
                                                                padding: '2px 10px', fontWeight: 700, fontSize: '1rem'
                                                            }}
                                                            title="Gesamtinvestition eintragen"
                                                        >
                                                            +
                                                        </button>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: p.isGroup ? 600 : 500 }}>
                                                    {(parseFloat(p.equity_invested) || 0) > 0 ? (
                                                        p.isGroup ? (
                                                            <span onClick={(e) => { e.stopPropagation(); setWeEditModal({ ...p, field: 'equity_invested' }); }} style={{ cursor: 'pointer', borderBottom: '1px dashed var(--primary-color)', paddingBottom: '2px' }} title="Eigenkapital bearbeiten">
                                                                {formatCurrency(p.equity_invested)}
                                                            </span>
                                                        ) : (
                                                            formatCurrency(p.equity_invested)
                                                        )
                                                    ) : (
                                                        <button
                                                            onClick={(e) => { 
                                                                e.stopPropagation(); 
                                                                if (p.isGroup) setWeEditModal({ ...p, field: 'equity_invested' });
                                                                else navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`); 
                                                            }}
                                                            style={{
                                                                background: 'none', border: '1px dashed var(--primary-color)',
                                                                color: 'var(--primary-color)', cursor: 'pointer', borderRadius: '6px',
                                                                padding: '2px 10px', fontWeight: 700, fontSize: '1rem'
                                                            }}
                                                            title="Eigenkapital eintragen"
                                                        >
                                                            +
                                                        </button>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: p.isGroup ? 600 : 500 }}>
                                                    {formatCurrency(rentIstMo * 12)}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: p.isGroup ? 600 : 500 }}>
                                                    {formatCurrency(rentSollMo * 12)}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: p.isGroup ? 600 : 500 }}>
                                                    {marketValue > 0 ? (
                                                        p.isGroup ? (
                                                            <span onClick={(e) => { e.stopPropagation(); setWeEditModal({ ...p, field: 'market_value_total' }); }} style={{ cursor: 'pointer', borderBottom: '1px dashed var(--primary-color)', paddingBottom: '2px' }} title="Marktwert bearbeiten">
                                                                {formatCurrency(marketValue)}
                                                            </span>
                                                        ) : (
                                                            formatCurrency(marketValue)
                                                        )
                                                    ) : (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (p.isGroup) {
                                                                    setWeEditModal({ ...p, field: 'market_value_total' });
                                                                } else {
                                                                    setDetailProperty(p);
                                                                    setIsDetailOpen(true);
                                                                }
                                                            }}
                                                            style={{
                                                                background: 'none', border: '1px dashed var(--primary-color)',
                                                                color: 'var(--primary-color)', cursor: 'pointer', borderRadius: '6px',
                                                                padding: '2px 10px', fontWeight: 700, fontSize: '1rem'
                                                            }}
                                                            title="Marktwert eintragen"
                                                        >
                                                            +
                                                        </button>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: p.isGroup ? 600 : 500 }}>
                                                    {debt > 0 ? formatCurrency(debt) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                                </td>
                                                <td style={{ textAlign: 'center', padding: '14px 16px' }}>
                                                    {!p.isGroup && (
                                                    <div style={{ position: 'relative' }}>
                                                        <button
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                if (openMenuId === p.id) { setOpenMenuId(null); return; }
                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                setMenuPos({ top: rect.bottom + 4, left: rect.right });
                                                                setOpenMenuId(p.id);
                                                            }}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-secondary)' }}
                                                        >
                                                            <MoreVertical size={18} />
                                                        </button>
                                                    </div>
                                                    )}
                                                </td>
                                            </tr>
                                            {auditPropertyId === p.id && !p.isGroup && (
                                                <tr>
                                                    <td colSpan="9" style={{ padding: '0 16px 20px 16px', borderBottom: '1px solid var(--border-color)' }}>
                                                        <div ref={auditRef}>
                                                            {renderInlineAudit(p)}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                };

                                return (
                                    <React.Fragment key={pOrGroup.id}>
                                        {renderRow(pOrGroup)}
                                        {pOrGroup.isGroup && expandedWEId === pOrGroup.id && pOrGroup.properties.map(subProp => renderRow(subProp, true))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Cards */}
                <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                    {groupedProperties.map(pOrGroup => {
                        const renderMobileCard = (p, isSubCard = false) => {
                            const totalSqm = p.isGroup ? p._totalSqm : (p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0);
                            const rentIstMo = p.isGroup ? p._rentIst : getPropertyRentIst(p);
                            const rentSollMo = p.isGroup ? p._rentSoll : getPropertyRentSoll(p);
                            const debt = p.isGroup ? p._debt : getPropertyDebt(p.id);
                            const marketValue = parseFloat(p.market_value_total) || 0;

                            return (
                                <div key={p.id} style={{
                                    border: p.isGroup ? '2px solid var(--accent-color, #8B5CF6)' : '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-md)',
                                    backgroundColor: p.isGroup ? 'rgba(139, 92, 246, 0.03)' : 'var(--surface-color)',
                                    display: 'flex', flexDirection: 'column', gap: '12px',
                                    marginLeft: isSubCard ? '16px' : 0
                                }}>
                                    {/* Header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
                                        onClick={() => { if (p.isGroup) setExpandedWEId(expandedWEId === p.id ? null : p.id); }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {p.isGroup && (
                                                <span style={{ color: 'var(--text-secondary)' }}>
                                                    {expandedWEId === p.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                </span>
                                            )}
                                            <div>
                                                <div style={{ fontWeight: p.isGroup ? 700 : 600, fontSize: '1rem', color: p.isGroup ? 'var(--accent-color, #8B5CF6)' : 'var(--text-primary)' }}>{p.street} {p.house_number}</div>
                                                {!p.isGroup && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{p.zip} {p.city}{totalSqm > 0 ? ` • ${totalSqm} m²` : ''}</div>}
                                                {p.isGroup && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{p.properties.length} Gebäude verknüpft</div>}
                                            </div>
                                        </div>

                                        {!p.isGroup && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDetailProperty(p);
                                                    setIsDetailOpen(true);
                                                }}
                                                style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer' }}
                                            >
                                                <Eye size={20} />
                                            </button>
                                        )}
                                    </div>

                                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }}></div>

                                    {/* Key Stats Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Gesamtinvest</div>
                                            <div style={{ fontWeight: p.isGroup ? 600 : 500 }}>
                                                {(parseFloat(p.total_investment_cost) || 0) > 0 ? (
                                                    p.isGroup ? (
                                                        <span onClick={(e) => { e.stopPropagation(); setWeEditModal({ ...p, field: 'total_investment_cost' }); }} style={{ cursor: 'pointer', borderBottom: '1px dashed var(--primary-color)', paddingBottom: '2px' }} title="Gesamtinvestition bearbeiten">
                                                            {formatCurrency(p.total_investment_cost)}
                                                        </span>
                                                    ) : (
                                                        formatCurrency(p.total_investment_cost)
                                                    )
                                                ) : (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (p.isGroup) setWeEditModal({ ...p, field: 'total_investment_cost' });
                                                            else navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`);
                                                        }}
                                                        style={{
                                                            background: 'none', border: '1px dashed var(--primary-color)',
                                                            color: 'var(--primary-color)', cursor: 'pointer', borderRadius: '6px',
                                                            padding: '2px 10px', fontWeight: 700, fontSize: '1rem'
                                                        }}
                                                        title="Gesamtinvestition eintragen"
                                                    >
                                                        +
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Eigenkapital</div>
                                            <div style={{ fontWeight: p.isGroup ? 600 : 500 }}>
                                                {(parseFloat(p.equity_invested) || 0) > 0 ? (
                                                    p.isGroup ? (
                                                        <span onClick={(e) => { e.stopPropagation(); setWeEditModal({ ...p, field: 'equity_invested' }); }} style={{ cursor: 'pointer', borderBottom: '1px dashed var(--primary-color)', paddingBottom: '2px' }} title="Eigenkapital bearbeiten">
                                                            {formatCurrency(p.equity_invested)}
                                                        </span>
                                                    ) : (
                                                        formatCurrency(p.equity_invested)
                                                    )
                                                ) : (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (p.isGroup) setWeEditModal({ ...p, field: 'equity_invested' });
                                                            else navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`);
                                                        }}
                                                        style={{
                                                            background: 'none', border: '1px dashed var(--primary-color)',
                                                            color: 'var(--primary-color)', cursor: 'pointer', borderRadius: '6px',
                                                            padding: '2px 10px', fontWeight: 700, fontSize: '1rem'
                                                        }}
                                                        title="Eigenkapital eintragen"
                                                    >
                                                        +
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Miete IST (p.a.)</div>
                                            <div style={{ fontWeight: p.isGroup ? 600 : 500 }}>{formatCurrency(rentIstMo * 12)}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Miete SOLL (p.a.)</div>
                                            <div style={{ fontWeight: p.isGroup ? 600 : 500 }}>{formatCurrency(rentSollMo * 12)}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Marktwert</div>
                                            <div style={{ fontWeight: p.isGroup ? 600 : 500 }}>
                                                {marketValue > 0 ? (
                                                    p.isGroup ? (
                                                        <span onClick={(e) => { e.stopPropagation(); setWeEditModal({ ...p, field: 'market_value_total' }); }} style={{ cursor: 'pointer', borderBottom: '1px dashed var(--primary-color)', paddingBottom: '2px' }} title="Marktwert bearbeiten">
                                                            {formatCurrency(marketValue)}
                                                        </span>
                                                    ) : (
                                                        formatCurrency(marketValue)
                                                    )
                                                ) : (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (p.isGroup) {
                                                                setWeEditModal({ ...p, field: 'market_value_total' });
                                                            } else {
                                                                setDetailProperty(p);
                                                                setIsDetailOpen(true);
                                                            }
                                                        }}
                                                        style={{
                                                            background: 'none', border: '1px dashed var(--primary-color)',
                                                            color: 'var(--primary-color)', cursor: 'pointer', borderRadius: '6px',
                                                            padding: '2px 10px', fontWeight: 700, fontSize: '1rem'
                                                        }}
                                                        title="Marktwert eintragen"
                                                    >
                                                        +
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Restschuld</div>
                                            <div style={{ fontWeight: p.isGroup ? 600 : 500 }}>
                                                {debt > 0 ? formatCurrency(debt) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {!p.isGroup && (
                                        <>
                                            <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }}></div>
                                            {/* Action Buttons */}
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <Button size="sm" variant="secondary" onClick={() => navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`)} style={{ flex: 1 }}>
                                                    <Edit3 size={14} style={{ marginRight: '6px' }} /> Bearbeiten
                                                </Button>
                                                {!window.Capacitor?.isNativePlatform?.() && (
                                                    <Button size="sm" variant="secondary" onClick={() => {
                                                        if (auditPropertyId === p.id) setAuditPropertyId(null);
                                                        else setAuditPropertyId(p.id);
                                                    }} style={{ flex: 1, borderColor: auditPropertyId === p.id ? 'var(--primary-color)' : 'var(--border-color)' }}>
                                                        <ShieldCheck size={14} style={{ marginRight: '6px' }} /> Zustand
                                                    </Button>
                                                )}
                                            </div>
                                            {!window.Capacitor?.isNativePlatform?.() && auditPropertyId === p.id && (
                                                <div ref={auditRef} style={{ marginTop: '8px' }}>
                                                    {renderInlineAudit(p)}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        };

                        return (
                            <React.Fragment key={pOrGroup.id}>
                                {renderMobileCard(pOrGroup)}
                                {pOrGroup.isGroup && expandedWEId === pOrGroup.id && pOrGroup.properties.map(subProp => renderMobileCard(subProp, true))}
                            </React.Fragment>
                        );
                    })}
                    {groupedProperties.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>Keine Immobilien gefunden.</div>
                    )}
                </div>
            </Card>

            {/* Floating Action Menu */}
            {openMenuId && (
                <div style={{
                    position: 'fixed', top: menuPos.top, left: menuPos.left,
                    transform: 'translateX(-100%)',
                    backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                    zIndex: 9999, minWidth: '170px', padding: '4px'
                }}>
                    <button style={menuItemStyle} onClick={() => {
                        const p = properties.find(pr => pr.id === openMenuId);
                        setDetailProperty(p);
                        setIsDetailOpen(true);
                        setOpenMenuId(null);
                    }}>
                        <Eye size={14} /> Details
                    </button>
                </div>
            )}

            {/* Detail Modal */}
            {renderDetailModal()}

            {/* WE Edit Modal */}
            {weEditModal && (
                <Modal
                    isOpen={!!weEditModal}
                    onClose={() => setWeEditModal(null)}
                    title="Wirtschaftseinheit Finanzen"
                    footer={
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <Button variant="secondary" onClick={() => setWeEditModal(null)}>Abbrechen</Button>
                            <Button onClick={async () => {
                                await handleUpdateWE(weEditModal.economic_unit_id, {
                                    total_investment_cost: weEditModal.total_investment_cost,
                                    equity_invested: weEditModal.equity_invested,
                                    market_value_total: weEditModal.market_value_total
                                });
                                setWeEditModal(null);
                            }}>Speichern</Button>
                        </div>
                    }
                >
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <CurrencyInput
                            label="Gesamtinvestition (€)"
                            value={weEditModal.total_investment_cost}
                            onChange={e => {
                                const val = e.target.value;
                                setWeEditModal(prev => ({ ...prev, total_investment_cost: val }));
                            }}
                        />
                        <CurrencyInput
                            label="Eigenkapital (€)"
                            value={weEditModal.equity_invested}
                            onChange={e => {
                                const val = e.target.value;
                                setWeEditModal(prev => ({ ...prev, equity_invested: val }));
                            }}
                        />
                        <CurrencyInput
                            label="Marktwert gesamt (€)"
                            value={weEditModal.market_value_total}
                            onChange={e => {
                                const val = e.target.value;
                                setWeEditModal(prev => ({ ...prev, market_value_total: val }));
                            }}
                        />
                    </div>
                </Modal>
            )}
        </div>
    );

    const menuItemStyle = {
        textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '0.875rem', color: 'var(--text-primary)', width: '100%', borderRadius: '4px'
    };

    // ─── INLINE AUDIT (DD) ──────────────────────────────────────────
    const renderInlineAudit = (p) => {
        const score = p.location_score_total || 5;
        let scoreColor = '#F59E0B';
        if (score >= 8) scoreColor = '#10B981';
        else if (score <= 4) scoreColor = '#EF4444';

        const ddSelectStyle = { padding: '6px 8px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', backgroundColor: 'var(--surface-color)', width: '100%', color: 'var(--text-primary)' };

        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', padding: '20px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', marginTop: '8px' }}>
                {/* Lage Score */}
                <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MapPin size={16} color="var(--primary-color)" /> Lage-Score
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <input type="range" min="1" max="10" step="1" value={score}
                            onChange={e => handleUpdateProperty(p.id, { location_score_total: parseInt(e.target.value) })}
                            style={{ flex: 1, accentColor: scoreColor }}
                        />
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '16px', backgroundColor: `${scoreColor}15`, color: scoreColor, fontWeight: 700, fontSize: '0.85rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: scoreColor }}></span>
                            {score} / 10
                        </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        1-4 🔴 Risiko • 5-7 🟡 Solide • 8-10 🟢 Top-Lage
                    </p>
                </div>

                {/* Objektzustand (DD) */}
                <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldCheck size={16} color="var(--primary-color)" /> Objektzustand
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        {[
                            { key: 'dd_condition_exterior', label: 'Außen' },
                            { key: 'dd_condition_roof', label: 'Dach' },
                            { key: 'dd_condition_staircase', label: 'Treppenhaus' },
                            { key: 'dd_condition_units', label: 'Wohnungen' },
                            { key: 'dd_condition_heating', label: 'Heizung' }
                        ].map(item => (
                            <div key={item.key}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>{item.label}</label>
                                <select value={p[item.key] || 0} onChange={e => handleUpdateProperty(p.id, { [item.key]: parseInt(e.target.value) })} style={ddSelectStyle}>
                                    <option value="0">—</option>
                                    <option value="1">Saniert</option>
                                    <option value="2">Gut</option>
                                    <option value="3">OK</option>
                                    <option value="4">Mangel</option>
                                    <option value="5">Defekt</option>
                                </select>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Energiestand (DD) – now also selects */}
                <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={16} color="var(--primary-color)" /> Energiestand
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        {[
                            { key: 'dd_energy_basement_ceiling', label: 'Kellerdecke' },
                            { key: 'dd_energy_attic_roof', label: 'Dach / OG' },
                            { key: 'dd_energy_facade', label: 'Fassade' },
                            { key: 'dd_energy_windows', label: 'Fenster' },
                            { key: 'dd_energy_heating', label: 'Heizung' }
                        ].map(item => (
                            <div key={item.key}>
                                <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '2px' }}>{item.label}</label>
                                <select value={p[item.key] || 0} onChange={e => handleUpdateProperty(p.id, { [item.key]: parseInt(e.target.value) })} style={ddSelectStyle}>
                                    <option value="0">—</option>
                                    <option value="1">Saniert</option>
                                    <option value="2">Gut</option>
                                    <option value="3">OK</option>
                                    <option value="4">Mangel</option>
                                    <option value="5">Defekt</option>
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // ─── DETAIL MODAL ──────────────────────────────────────────────
    const renderDetailModal = () => {
        if (!detailProperty) return null;
        const p = detailProperty;
        const totalSqm = p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
        const rentIstMo = getPropertyRentIst(p);
        const rentSollMo = getPropertyRentSoll(p);
        const debt = getPropertyDebt(p.id);
        const propLoans = loans.filter(l => l.property_id === p.id);

        return (
            <Modal isOpen={isDetailOpen} onClose={() => setIsDetailOpen(false)} title={`${p.street} ${p.house_number}`}
                footer={<Button variant="secondary" onClick={() => setIsDetailOpen(false)}>Schließen</Button>}
            >
                <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
                    {/* Stammdaten */}
                    <div>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Stammdaten</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '0.9rem' }}>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Adresse</span><div>{p.street} {p.house_number}, {p.zip} {p.city}</div></div>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Einheiten</span><div>{p.units?.length || 0}</div></div>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Fläche</span><div>{totalSqm} m²</div></div>
                        </div>
                    </div>

                    {/* Finanzen */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Investment</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.9rem' }}>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Gesamtinvestition</span><div style={{ fontWeight: 600 }}>{formatCurrency(p.total_investment_cost)}</div></div>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Eigenkapital</span><div style={{ fontWeight: 600 }}>{formatCurrency(p.equity_invested)}</div></div>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Miete IST (Mo.)</span><div style={{ fontWeight: 600 }}>{formatCurrency(rentIstMo)}</div></div>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Miete SOLL (Mo.)</span><div style={{ fontWeight: 600 }}>{formatCurrency(rentSollMo)}</div></div>
                            <div><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Restschuld</span><div style={{ fontWeight: 600 }}>{formatCurrency(debt)}</div></div>
                        </div>
                    </div>

                    {/* Marktwert */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Marktwert</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <CurrencyInput
                                label="Marktwert gesamt (€)"
                                value={p.market_value_total}
                                onChange={e => {
                                    const val = e.target.value;
                                    const perSqm = totalSqm > 0 && val ? (val / totalSqm) : 0;
                                    handleUpdateProperty(p.id, { market_value_total: val, market_value_per_sqm: parseFloat(perSqm.toFixed(2)) });
                                }}
                            />
                            <CurrencyInput
                                label="Marktwert je m² (€)"
                                value={p.market_value_per_sqm}
                                allowDecimals
                                onChange={e => {
                                    const val = e.target.value;
                                    const total = val ? (val * totalSqm) : 0;
                                    handleUpdateProperty(p.id, { market_value_per_sqm: val, market_value_total: parseFloat(total.toFixed(2)) });
                                }}
                            />
                        </div>
                    </div>

                    {/* Darlehen */}
                    {propLoans.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                            <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Darlehen</h4>
                            {propLoans.map(l => (
                                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <span>{l.bank_name || 'Darlehen'}</span>
                                    <span style={{ fontWeight: 600 }}>{formatCurrency(l.loan_amount)} • {l.interest_rate}% Zins • {l.initial_repayment_rate}% Tilgung</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>
        );
    };

    // ─── RENDER: ANKAUFSPRÜFUNG ─────────────────────────────────────
    const calculateAuditMetrics = () => {
        const p = auditData;
        const purchasePrice = parseFloat(p.purchasePrice) || 0;

        // KNK
        const transferTax = parseFloat(p.transferTaxRate) || 0;
        const knk = purchasePrice * ((transferTax + parseFloat(p.brokerRate) + parseFloat(p.notaryRate) + parseFloat(p.registryRate)) / 100);
        const totalInvestment = purchasePrice + knk + (parseFloat(p.renovationCosts) || 0);

        // Nicht umlagefähige Kosten (Mo.)
        const housegeldMo = parseFloat(p.housegeld) || 0;
        const reservesMo = parseFloat(p.reserves) || 0;
        const nonRecoverableMo = housegeldMo + reservesMo;
        const nonRecoverablePA = nonRecoverableMo * 12;

        // Brutto-Einnahmen (Mo.) = Miete + Garage
        const grossIstMo = (parseFloat(p.coldRentIst) || 0) + (parseFloat(p.garageIst) || 0);
        const grossSollMo = (parseFloat(p.coldRentSoll) || 0) + (parseFloat(p.garageSoll) || 0);

        // SOLL hat eigene Felder? Hausgeld/Rücklage nur abziehen wenn SOLL gefüllt
        const sollHasValues = grossSollMo > 0;
        const nonRecoverableSollMo = sollHasValues ? nonRecoverableMo : 0;
        const nonRecoverableSollPA = nonRecoverableSollMo * 12;

        // Netto-Einnahmen (Mo.) = Brutto - Hausgeld - Rücklage
        const netIstMo = grossIstMo - nonRecoverableMo;
        const netSollMo = grossSollMo - nonRecoverableSollMo;

        // Income PA für Renditeberechnungen (Brutto)
        const incomeIstPA = grossIstMo * 12;
        const incomeSollPA = grossSollMo * 12;

        // Yields IST
        const br100 = purchasePrice > 0 ? (incomeIstPA / purchasePrice) * 100 : 0;
        const netYield = totalInvestment > 0 ? ((incomeIstPA - nonRecoverablePA) / totalInvestment) * 100 : 0;
        const factor = incomeIstPA > 0 ? purchasePrice / incomeIstPA : 0;

        // Yields SOLL
        const br100Soll = purchasePrice > 0 ? (incomeSollPA / purchasePrice) * 100 : 0;
        const netYieldSoll = totalInvestment > 0 ? ((incomeSollPA - nonRecoverableSollPA) / totalInvestment) * 100 : 0;
        const factorSoll = incomeSollPA > 0 ? purchasePrice / incomeSollPA : 0;

        // Financing
        let totalInterestPA = 0;
        let totalRepaymentPA = 0;
        // eslint-disable-next-line no-unused-vars
        let loansTotal = 0;
        p.loans.forEach(loan => {
            const amt = parseFloat(loan.amount) || 0;
            loansTotal += amt;
            totalInterestPA += amt * ((parseFloat(loan.interest) || 0) / 100);
            totalRepaymentPA += amt * ((parseFloat(loan.repayment) || 0) / 100);
        });
        const annuMo = (totalInterestPA + totalRepaymentPA) / 12;

        // Taxes IST – AfA: Gesamtinvestition × AfA-Satz
        const renovCosts = parseFloat(p.renovationCosts) || 0;
        const renovIn15 = renovCosts > (purchasePrice * 0.15);
        const afaBase = totalInvestment + (renovIn15 ? renovCosts : 0);
        const afaSum = afaBase * ((parseFloat(p.afaRate) || 2) / 100);
        const taxable = incomeIstPA - totalInterestPA - afaSum - (housegeldMo * 12);
        const taxBurden = Math.max(0, taxable * ((parseFloat(p.taxRate) || 42) / 100));

        const housegeldSollPA = sollHasValues ? (housegeldMo * 12) : 0;
        const taxableSoll = incomeSollPA - totalInterestPA - afaSum - housegeldSollPA;
        const taxBurdenSoll = Math.max(0, taxableSoll * ((parseFloat(p.taxRate) || 42) / 100));

        // Cashflow IST
        const cfPreTaxMo = (incomeIstPA - nonRecoverablePA - totalInterestPA - totalRepaymentPA) / 12;
        const cfPostTaxMo = cfPreTaxMo - (taxBurden / 12);

        // Cashflow SOLL
        const cfPreTaxSollMo = (incomeSollPA - nonRecoverableSollPA - totalInterestPA - totalRepaymentPA) / 12;
        const cfPostTaxSollMo = cfPreTaxSollMo - (taxBurdenSoll / 12);

        // Scenario: Restschuld nach Zinsbindungsende, neue Annuität
        const targetYr = parseFloat(p.targetYear) || 0;
        const rentGrowthRate = (parseFloat(scenario.rentGrowth) || 0) / 100;
        const interestAdj = parseFloat(scenario.interestAdj) || 0;

        // Max Zinsfestschreibung als Zeitrahmen
        const maxFixedYears = Math.max(...p.loans.map(l => parseFloat(l.fixedYears) || 10));

        // Restschuld pro Darlehen berechnen (iterativ, monatsgenau)
        let totalRestschuld = 0;
        let newTotalAnnuPA = 0;
        let newTotalInterestPA = 0;
        p.loans.forEach(loan => {
            const amt = parseFloat(loan.amount) || 0;
            const intRate = (parseFloat(loan.interest) || 0) / 100;
            const repRate = (parseFloat(loan.repayment) || 0) / 100;
            const fixedYrs = parseFloat(loan.fixedYears) || 10;
            const monthlyRate = intRate / 12;
            const annuPA = amt * (intRate + repRate);
            const monthlyPayment = annuPA / 12;

            // Restschuld nach fixedYears
            let balance = amt;
            for (let m = 0; m < fixedYrs * 12; m++) {
                const monthlyInterest = balance * monthlyRate;
                const monthlyPrincipal = monthlyPayment - monthlyInterest;
                balance = Math.max(0, balance - monthlyPrincipal);
            }
            totalRestschuld += balance;

            // Neue Annuität mit neuem Zins und neuer Tilgung aus Szenario auf Restschuld
            const newIntRate = Math.max(0, interestAdj / 100);
            const newRepRate = (parseFloat(scenario.repaymentAdj) || 0) / 100;
            const newAnnuThisLoan = balance * (newIntRate + newRepRate);
            newTotalAnnuPA += newAnnuThisLoan;
            newTotalInterestPA += balance * newIntRate;
        });
        const newAnnuMo = newTotalAnnuPA / 12;

        // Future Income: SOLL-Basis + Mietsteigerung ab targetYear
        const growthYears = Math.max(0, maxFixedYears - targetYr);
        const futureMultiplier = Math.pow(1 + rentGrowthRate, growthYears);
        const futureBasePA = sollHasValues ? incomeSollPA : incomeIstPA;
        const futureNonRecoverablePA = sollHasValues ? nonRecoverableSollPA : nonRecoverablePA;
        const futureIncomePA = futureBasePA * futureMultiplier;

        // Future Cashflow mit neuer Annuität
        // AfA sinkt jährlich: nach maxFixedYears Jahren ist die Basis reduziert
        const futureAfaBase = Math.max(0, afaBase - (afaSum * maxFixedYears));
        const futureAfaSum = futureAfaBase > 0 ? Math.min(afaSum, futureAfaBase) : 0;
        const futureHausgeldPA = housegeldMo * 12;
        const futureTaxable = futureIncomePA - newTotalInterestPA - futureAfaSum - futureHausgeldPA;
        const futureTaxBurden = Math.max(0, futureTaxable * ((parseFloat(p.taxRate) || 42) / 100));
        const futureCfPreTaxMo = (futureIncomePA - futureNonRecoverablePA - newTotalAnnuPA) / 12;
        const futureCfPostTaxMo = futureCfPreTaxMo - (futureTaxBurden / 12);

        // EK-Rendite: Cashflow nach Steuern p.a. / Eigenkapital * 100
        const equityVal = parseFloat(p.equity) || 0;
        const ekRenditeIst = equityVal > 0 ? ((cfPostTaxMo * 12) / equityVal) * 100 : 0;
        const ekRenditeSoll = equityVal > 0 ? ((cfPostTaxSollMo * 12) / equityVal) * 100 : 0;

        return {
            knk, totalInvestment,
            grossIstMo, grossSollMo,
            netIstMo, netSollMo,
            nonRecoverableMo, nonRecoverableSollMo,
            sollHasValues,
            incomeIstMo: incomeIstPA / 12, incomeIstPA,
            incomeSollMo: incomeSollPA / 12, incomeSollPA,
            br100, netYield, factor,
            br100Soll, netYieldSoll, factorSoll,
            ekRenditeIst, ekRenditeSoll,
            annuMo, annuPA: annuMo * 12,
            taxBurdenMo: taxBurden / 12, taxBurdenSollMo: taxBurdenSoll / 12,
            cfPreTaxMo, cfPostTaxMo,
            cfPreTaxSollMo, cfPostTaxSollMo,
            totalRestschuld, newAnnuMo, maxFixedYears,
            futureIncomeMo: futureIncomePA / 12, futureIncomePA,
            futureCfPreTaxMo, futureCfPostTaxMo, futureTaxBurdenMo: futureTaxBurden / 12
        };
    };

    const metrics = calculateAuditMetrics();

    // ─── BUY & HOLD PDF EXPORT ─────────────────────────────────────
    const handleBuyHoldPrint = () => {
        const fc = v => (v || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
        const p = auditData;
        const m = metrics;
        const pdfData = [
            { position: 'Kaufpreis', wert: fc(parseFloat(p.purchasePrice) || 0) },
            { position: 'Kaufnebenkosten (KNK)', wert: fc(m.knk) },
            { position: 'Gesamtinvestition', wert: fc(m.totalInvestment) },
            { position: '─', wert: '' },
            { position: 'Kaltmiete IST (Mo.)', wert: fc(parseFloat(p.coldRentIst) || 0) },
            { position: 'Bruttomiete IST (Mo.)', wert: fc(m.grossIstMo) },
            { position: 'Nettomiete IST (Mo.)', wert: fc(m.netIstMo) },
            ...(m.sollHasValues ? [
                { position: '─', wert: '' },
                { position: 'Kaltmiete SOLL (Mo.)', wert: fc(parseFloat(p.coldRentSoll) || 0) },
                { position: 'Bruttomiete SOLL (Mo.)', wert: fc(m.grossSollMo) },
                { position: 'Nettomiete SOLL (Mo.)', wert: fc(m.netSollMo) },
            ] : []),
            { position: '─', wert: '' },
            { position: 'Bruttorendite IST', wert: m.br100.toFixed(2) + ' %' },
            { position: 'Nettorendite IST', wert: m.netYield.toFixed(2) + ' %' },
            { position: 'Faktor IST', wert: m.factor.toFixed(1) + 'x' },
            { position: 'EK-Rendite IST', wert: m.ekRenditeIst.toFixed(2) + ' %' },
            ...(m.sollHasValues ? [
                { position: '─', wert: '' },
                { position: 'Bruttorendite SOLL', wert: m.br100Soll.toFixed(2) + ' %' },
                { position: 'Nettorendite SOLL', wert: m.netYieldSoll.toFixed(2) + ' %' },
                { position: 'Faktor SOLL', wert: m.factorSoll.toFixed(1) + 'x' },
                { position: 'EK-Rendite SOLL', wert: m.ekRenditeSoll.toFixed(2) + ' %' },
            ] : []),
            { position: '─', wert: '' },
            { position: 'Annuität (Mo.)', wert: fc(m.annuMo) },
            { position: 'Steuerbelastung IST (Mo.)', wert: fc(m.taxBurdenMo) },
            { position: 'Cashflow vor Steuern IST', wert: fc(m.cfPreTaxMo) },
            { position: 'Cashflow nach Steuern IST', wert: fc(m.cfPostTaxMo) },
            ...(m.sollHasValues ? [
                { position: 'Cashflow vor Steuern SOLL', wert: fc(m.cfPreTaxSollMo) },
                { position: 'Cashflow nach Steuern SOLL', wert: fc(m.cfPostTaxSollMo) },
            ] : []),
            { position: '─', wert: '' },
            { position: `Szenario: Restschuld nach ${m.maxFixedYears} J.`, wert: fc(m.totalRestschuld) },
            { position: 'Szenario: Neue Annuität (Mo.)', wert: fc(m.newAnnuMo) },
            { position: 'Szenario: Cashflow vor Steuern', wert: fc(m.futureCfPreTaxMo) },
            { position: 'Szenario: Cashflow nach Steuern', wert: fc(m.futureCfPostTaxMo) },
        ];
        generateClientPdf({
            reportType: 'deal_kalkulation',
            data: pdfData,
            selectedColumns: ['position', 'wert'],
            showSums: false,
            portfolioName: dealName || 'Buy & Hold Deal',
            propertyName: '',
            template: pdfTemplate,
        });
    };

    const auditStepLabels = ['Investition', 'Ertragsrechnung', 'Finanzierung', 'Steuer', 'Kennzahlen'];
    const auditStepCount = auditStepLabels.length;

    const renderAudit = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
            {/* Deal Header: Name + Save + Back */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => navigate('/investor-portal?tab=deals')}>
                    ← Zur Übersicht
                </span>
                <div style={{ flex: 1 }} />
                <input
                    value={dealName}
                    onChange={e => setDealName(e.target.value)}
                    placeholder="Deal-Name eingeben..."
                    style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600, minWidth: isMobile ? '120px' : '200px', flex: isMobile ? 1 : undefined }}
                />
                <Button variant="secondary" icon={FileText} onClick={handleBuyHoldPrint}>
                    PDF
                </Button>
                <Button icon={savingDeal ? Loader2 : Save} onClick={saveDeal} disabled={savingDeal} style={savingDeal ? { opacity: 0.7, pointerEvents: 'none' } : {}}>
                    {savingDeal ? 'Speichert...' : (editingDealId ? 'Aktualisieren' : 'Speichern')}
                </Button>
            </div>

            {/* Mobile Stepper Progress */}
            {isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 4px' }}>
                    {auditStepLabels.map((label, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setAuditStep(i)}>
                            <div style={{
                                height: '3px', width: '100%', borderRadius: '2px',
                                backgroundColor: i <= auditStep ? 'var(--primary-color)' : 'var(--border-color)',
                                transition: 'background-color 0.3s'
                            }} />
                            <span style={{ fontSize: '0.6rem', color: i === auditStep ? 'var(--primary-color)' : 'var(--text-secondary)', fontWeight: i === auditStep ? 700 : 400 }}>
                                {label}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--spacing-xl)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* 1. Investition */}
                    {(!isMobile || auditStep === 0) && <Card title="1. Investition">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                            <CurrencyInput label="Kaufpreis (€)" value={auditData.purchasePrice} onChange={e => setAuditData({ ...auditData, purchasePrice: e.target.value })} />
                            <div style={{ position: 'relative' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '0.4rem' }}>
                                    <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Grunderwerbsteuer (%)</label>
                                    <div style={{ position: 'relative', display: 'inline-block' }}>
                                        <Info size={14} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                                            onMouseEnter={() => setShowTaxInfo(true)}
                                            onMouseLeave={() => setShowTaxInfo(false)}
                                        />
                                        {showTaxInfo && (
                                            <div style={{
                                                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                                                backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                borderRadius: '8px', padding: '12px', minWidth: '250px', zIndex: 100,
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)', fontSize: '0.75rem', marginBottom: '4px'
                                            }}>
                                                <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '0.8rem' }}>Grunderwerbsteuer je Bundesland</div>
                                                {statesTaxRef.map(s => (
                                                    <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                                        <span>{s.name}</span><span style={{ fontWeight: 600 }}>{s.tax} %</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <input
                                    type="number" step="0.1"
                                    value={auditData.transferTaxRate}
                                    onChange={e => {
                                        let val = parseFloat(e.target.value);
                                        if (val > 999) val = 999;
                                        setAuditData({ ...auditData, transferTaxRate: val });
                                    }}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                            <RateInput label="Makler (%)" value={auditData.brokerRate} onChange={e => setAuditData({ ...auditData, brokerRate: e.target.value })} />
                            <RateInput label="Notar (%)" value={auditData.notaryRate} onChange={e => setAuditData({ ...auditData, notaryRate: e.target.value })} />
                            <RateInput label="Grundbuch (%)" value={auditData.registryRate} onChange={e => setAuditData({ ...auditData, registryRate: e.target.value })} />
                            <div>
                                <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>Sanierung (€)</span>
                                    <Calculator
                                        size={14}
                                        style={{ color: '#f97316', cursor: 'pointer', flexShrink: 0 }}
                                        title="Sanierungsrechner öffnen"
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            let currentDealId = editingDealId;
                                            // First save the deal if not yet saved
                                            if (!currentDealId) {
                                                currentDealId = await saveDeal(true);
                                            }
                                            const currentName = encodeURIComponent(dealName || 'Neuer Deal');
                                            if (currentDealId) {
                                                const ret = encodeURIComponent(`/investor-portal?tab=audit&dealId=${currentDealId}`);
                                                const { data } = await supabase
                                                    .from('renovation_calculations')
                                                    .select('id')
                                                    .contains('building_config', { dealId: currentDealId })
                                                    .limit(1);
                                                if (data && data.length > 0) {
                                                    navigate(`/renovation/calculator/${data[0].id}?returnTo=${ret}`);
                                                } else {
                                                    navigate(`/renovation/calculator/new?dealId=${currentDealId}&dealName=${currentName}&returnTo=${ret}`);
                                                }
                                            } else {
                                                const ret = encodeURIComponent('/investor-portal?tab=audit');
                                                navigate(`/renovation/calculator/new?dealName=${currentName}&returnTo=${ret}`);
                                            }
                                        }}
                                    />
                                    <div style={{ position: 'relative', display: 'inline-block' }}>
                                        <Info size={13} style={{ color: 'var(--text-secondary)', cursor: 'pointer', opacity: 0.7 }}
                                            onMouseEnter={() => setShowRenovInfo(true)}
                                            onMouseLeave={() => setShowRenovInfo(false)}
                                        />
                                        {showRenovInfo && (
                                            <div style={{
                                                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                                                backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                borderRadius: '8px', padding: '10px 14px', minWidth: '240px', zIndex: 100,
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)', fontSize: '0.75rem', marginBottom: '4px',
                                                color: 'var(--text-secondary)', lineHeight: 1.5
                                            }}>
                                                Sanierungskosten werden in die AfA-Berechnung übernommen, wenn die Summe 15&nbsp;% höher ist als der Kaufpreis.
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <CurrencyInput value={auditData.renovationCosts} onChange={e => setAuditData({ ...auditData, renovationCosts: e.target.value })} />
                            </div>
                        </div>
                        {/* Gesamtsumme */}
                        <div style={{ marginTop: '1.25rem', padding: '12px 16px', backgroundColor: 'var(--background-color)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Gesamtinvestition inkl. KNK</span>
                            <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--primary-color)' }}>{formatCurrency(metrics.totalInvestment)}</span>
                        </div>
                    </Card>}

                    {/* 2. Ertragsrechnung */}
                    {(!isMobile || auditStep === 1) && <Card title="2. Ertragsrechnung (Mo.)">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '1rem' : '0' }}>
                            <div style={{ padding: '1rem', paddingRight: '1.5rem' }}>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase' }}>IST-Situation</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <CurrencyInput label="Kaltmiete (€ / Mo.)" value={auditData.coldRentIst} onChange={e => setAuditData({ ...auditData, coldRentIst: e.target.value })} />
                                    <CurrencyInput label="Garage / Stellpl. (€)" value={auditData.garageIst} onChange={e => setAuditData({ ...auditData, garageIst: e.target.value })} />
                                    <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem' }}>
                                        <div style={{ marginBottom: '4px' }}><span style={{ fontSize: '0.8rem', fontWeight: 500 }}>− Verwaltung etc. (€)</span> <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>(nicht umlagefähig)</span></div>
                                        <CurrencyInput value={auditData.housegeld} onChange={e => setAuditData({ ...auditData, housegeld: e.target.value })} placeholder="0" />
                                    </div>
                                    <div>
                                        <div style={{ marginBottom: '4px' }}><span style={{ fontSize: '0.8rem', fontWeight: 500 }}>− Rücklage (€)</span> <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>(nicht umlagefähig)</span></div>
                                        <CurrencyInput value={auditData.reserves} onChange={e => setAuditData({ ...auditData, reserves: e.target.value })} placeholder="0" />
                                    </div>
                                </div>
                                <div style={{ marginTop: '1rem', padding: '10px 14px', backgroundColor: 'var(--background-color)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Netto-Einnahmen</span>
                                    <span style={{ fontWeight: 700, color: cashflowColor(metrics.netIstMo) }}>{formatCurrency(metrics.netIstMo)}</span>
                                </div>
                            </div>
                            <div style={{ padding: '1rem', paddingLeft: isMobile ? '1rem' : '1.5rem', backgroundColor: 'rgba(59,130,246,0.04)', borderLeft: isMobile ? 'none' : '2px solid rgba(59,130,246,0.15)', borderTop: isMobile ? '2px solid rgba(59,130,246,0.15)' : 'none', borderRadius: isMobile ? '0 0 8px 8px' : '0 8px 8px 0' }}>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#3B82F6', marginBottom: '1rem', textTransform: 'uppercase' }}>SOLL-Potenzial</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <Input label="Ziel ab Jahr nach Kauf" type="number" value={auditData.targetYear} onChange={e => setAuditData({ ...auditData, targetYear: e.target.value })} placeholder="z.B. 2" />
                                    <CurrencyInput label="Kaltmiete (€ / Mo.)" value={auditData.coldRentSoll} onChange={e => setAuditData({ ...auditData, coldRentSoll: e.target.value })} />
                                    <CurrencyInput label="Garage / Stellpl. (€)" value={auditData.garageSoll} onChange={e => setAuditData({ ...auditData, garageSoll: e.target.value })} />
                                    {metrics.sollHasValues && (
                                        <div style={{ borderTop: '1px dashed rgba(59,130,246,0.2)', paddingTop: '0.75rem' }}>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>− Verwaltung etc. & Rücklage (wie IST)</div>
                                            <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{formatCurrency(metrics.nonRecoverableSollMo)}</div>
                                        </div>
                                    )}
                                </div>
                                <div style={{ marginTop: '1rem', padding: '10px 14px', backgroundColor: 'rgba(59,130,246,0.08)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Netto-Einnahmen</span>
                                    <span style={{ fontWeight: 700, color: '#3B82F6' }}>{formatCurrency(metrics.netSollMo)}</span>
                                </div>
                            </div>
                        </div>
                    </Card>}

                    {/* 3. Finanzierung */}
                    {(!isMobile || auditStep === 2) && <Card title="3. Finanzierung">
                        <div style={{ marginBottom: '1.5rem' }}>
                            <CurrencyInput label="Eigenkapital (€)" value={auditData.equity} onChange={e => setAuditData({ ...auditData, equity: e.target.value })} />
                        </div>
                        {auditData.loans.map((loan, idx) => (
                            <div key={idx} style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '1rem', backgroundColor: 'var(--background-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Darlehen {idx + 1}</span>
                                    {idx > 0 && <span style={{ cursor: 'pointer', color: 'var(--danger-color, #ef4444)', opacity: 0.7, display: 'flex', alignItems: 'center' }} onClick={() => {
                                        const lns = [...auditData.loans]; lns.splice(idx, 1);
                                        setAuditData({ ...auditData, loans: lns });
                                    }}><Trash2 size={14} /></span>}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '1rem' }}>
                                    <CurrencyInput label="Summe (€)" value={loan.amount} onChange={e => {
                                        const lns = [...auditData.loans]; lns[idx].amount = e.target.value;
                                        setAuditData({ ...auditData, loans: lns });
                                    }} />
                                    <RateInput label="Zins (%)" value={loan.interest} onChange={e => {
                                        const lns = [...auditData.loans]; lns[idx].interest = e.target.value;
                                        setAuditData({ ...auditData, loans: lns });
                                    }} />
                                    <RateInput label="Tilgung (%)" value={loan.repayment} onChange={e => {
                                        const lns = [...auditData.loans]; lns[idx].repayment = e.target.value;
                                        setAuditData({ ...auditData, loans: lns });
                                    }} />
                                    <Input label="Zinsbindung (J.)" type="number" value={loan.fixedYears} onChange={e => {
                                        const lns = [...auditData.loans]; lns[idx].fixedYears = e.target.value;
                                        setAuditData({ ...auditData, loans: lns });
                                    }} />
                                </div>
                            </div>
                        ))}
                        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAuditData({ ...auditData, loans: [...auditData.loans, { amount: 0, interest: 3.5, repayment: 2, fixedYears: 10 }] })}>Weiteres Darlehen</Button>
                        <div style={{ marginTop: '1rem', padding: '10px 14px', backgroundColor: 'var(--background-color)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Gesamtdarlehen</span>
                            <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--primary-color)' }}>{formatCurrency(auditData.loans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}</span>
                        </div>
                    </Card>}

                    {/* 4. Steuer-Parameter */}
                    {(!isMobile || auditStep === 3) && <Card title="4. Steuer-Parameter">
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '1rem' }}>
                            <RateInput label="AfA Satz (%)" step="0.1" value={auditData.afaRate} onChange={e => setAuditData({ ...auditData, afaRate: e.target.value })} />
                            <RateInput label="Gebäudeanteil (%)" value={auditData.buildingShare} onChange={e => setAuditData({ ...auditData, buildingShare: e.target.value })} />
                            <RateInput label="Grenzsteuersatz (%)" value={auditData.taxRate} onChange={e => setAuditData({ ...auditData, taxRate: e.target.value })} />
                        </div>
                    </Card>}

                    {/* Mobile: Weiter/Zurück Buttons */}
                    {isMobile && auditStep < 4 && (
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between' }}>
                            <Button variant="secondary" icon={ChevronLeft} onClick={() => setAuditStep(Math.max(0, auditStep - 1))} disabled={auditStep === 0} style={{ flex: 1, opacity: auditStep === 0 ? 0.4 : 1 }}>
                                Zurück
                            </Button>
                            <Button icon={ChevronRight} onClick={() => setAuditStep(Math.min(auditStepCount - 1, auditStep + 1))} style={{ flex: 1 }}>
                                {auditStep === 3 ? 'Kennzahlen' : 'Weiter'}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Results (Sticky on desktop, step 5 on mobile) */}
                <div style={{ position: isMobile ? 'static' : 'sticky', top: '80px', height: 'fit-content', display: (!isMobile || auditStep === 4) ? 'flex' : 'none', flexDirection: 'column', gap: '1.5rem' }}>
                    <Card title="Kennzahlen">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
                            {/* IST Spalte */}
                            <div style={{ padding: '0.75rem 1rem', paddingRight: '1.25rem' }}>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>IST-Situation</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {[
                                        { label: 'Nettomiete', value: formatCurrency(metrics.netIstMo) },
                                        { label: 'Faktor', value: `${metrics.factor.toFixed(1)}x` },
                                        { label: 'Bruttorendite', value: `${metrics.br100.toFixed(2)} %` },
                                        { label: 'Nettorendite', value: `${metrics.netYield.toFixed(2)} %`, color: 'var(--primary-color)' },
                                        { label: 'EK-Rendite', value: `${metrics.ekRenditeIst.toFixed(2)} %`, color: 'var(--primary-color)' },
                                        { label: 'Annuität', value: formatCurrency(metrics.annuMo) },
                                        { label: 'Steuer (Mo.)', value: formatCurrency(metrics.taxBurdenMo) },
                                    ].map((r, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.label}</span>
                                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: r.color || 'var(--text-primary)' }}>{r.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* SOLL Spalte */}
                            <div style={{ padding: '0.75rem 1rem', paddingLeft: '1.25rem', backgroundColor: 'rgba(59,130,246,0.04)', borderLeft: '2px solid rgba(59,130,246,0.15)', borderRadius: '0 8px 8px 0' }}>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#3B82F6', marginBottom: '0.75rem', textTransform: 'uppercase' }}>SOLL-Potenzial</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {[
                                        { label: 'Nettomiete', value: formatCurrency(metrics.netSollMo) },
                                        { label: 'Faktor', value: `${metrics.factorSoll.toFixed(1)}x` },
                                        { label: 'Bruttorendite', value: `${metrics.br100Soll.toFixed(2)} %` },
                                        { label: 'Nettorendite', value: `${metrics.netYieldSoll.toFixed(2)} %`, color: '#3B82F6' },
                                        metrics.sollHasValues && { label: 'EK-Rendite', value: `${metrics.ekRenditeSoll.toFixed(2)} %`, color: '#3B82F6' },
                                        metrics.sollHasValues && { label: 'Annuität', value: formatCurrency(metrics.annuMo) },
                                        metrics.sollHasValues && { label: 'Steuer (Mo.)', value: formatCurrency(metrics.taxBurdenSollMo) },
                                    ].filter(Boolean).map((r, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(59,130,246,0.12)' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.label}</span>
                                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: r.color || 'var(--text-primary)' }}>{r.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Cashflow – volle Breite */}
                        <div style={{ marginTop: '12px', padding: '14px 16px', backgroundColor: 'var(--background-color)', borderRadius: '10px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                <div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>IST</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '0.8rem' }}>Cashflow vor Steuern</span>
                                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: cashflowColor(metrics.cfPreTaxMo) }}>{formatCurrency(metrics.cfPreTaxMo)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Cashflow nach Steuern</span>
                                        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: cashflowColor(metrics.cfPostTaxMo) }}>{formatCurrency(metrics.cfPostTaxMo)}</span>
                                    </div>
                                </div>
                                {metrics.sollHasValues && (
                                    <div style={{ paddingLeft: '1rem', borderLeft: '2px solid rgba(59,130,246,0.15)' }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#3B82F6', textTransform: 'uppercase', marginBottom: '6px' }}>SOLL</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '0.8rem' }}>Cashflow vor Steuern</span>
                                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: cashflowColor(metrics.cfPreTaxSollMo) }}>{formatCurrency(metrics.cfPreTaxSollMo)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Cashflow nach Steuern</span>
                                            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: cashflowColor(metrics.cfPostTaxSollMo) }}>{formatCurrency(metrics.cfPostTaxSollMo)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Scenario */}
                    <Card title="Szenario-Widget" icon={TrendingUp} color="#3B82F6">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <RateInput label="Mietsteigerung p.a. (%)" value={scenario.rentGrowth} onChange={e => setScenario({ ...scenario, rentGrowth: e.target.value })} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <RateInput label="Neuer Zins (%)" step="0.1" value={scenario.interestAdj} onChange={e => setScenario({ ...scenario, interestAdj: e.target.value })} />
                                <RateInput label="Neue Tilgung (%)" step="0.1" value={scenario.repaymentAdj} onChange={e => setScenario({ ...scenario, repaymentAdj: e.target.value })} />
                            </div>
                            <div style={{ marginTop: '8px', padding: '14px', backgroundColor: 'var(--background-color)', borderRadius: '10px' }}>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Nach {metrics.maxFixedYears} Jahren Zinsbindung</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '0.8rem' }}>Restschuld</span>
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatCurrency(metrics.totalRestschuld)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '0.8rem' }}>Neue Annuität (Mo.)</span>
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatCurrency(metrics.newAnnuMo)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '0.8rem' }}>Steuer (Mo.)</span>
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatCurrency(metrics.futureTaxBurdenMo)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px dashed var(--border-color)' }}>
                                    <span style={{ fontSize: '0.8rem' }}>Cashflow vor Steuern</span>
                                    <span style={{ fontWeight: 700, color: cashflowColor(metrics.futureCfPreTaxMo) }}>{formatCurrency(metrics.futureCfPreTaxMo)}</span>
                                </div>
                            </div>
                            <div style={{ padding: '16px', border: '2px dashed var(--primary-color)', borderRadius: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>Cashflow nach Steuern (nach Zinsbindung)</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: cashflowColor(metrics.futureCfPostTaxMo) }}>{formatCurrency(metrics.futureCfPostTaxMo)}</div>
                                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                                    Basierend auf {scenario.rentGrowth}% Mietwachstum, {scenario.interestAdj}% Zins und {scenario.repaymentAdj}% Tilgung.
                                </p>
                            </div>
                        </div>
                    </Card>
                    {isMobile && auditStep === 4 && (
                        <Button variant="secondary" icon={ChevronLeft} onClick={() => setAuditStep(0)} style={{ marginTop: '8px' }}>
                            Zurück zum Rechner
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );

    // ─── LOADING ────────────────────────────────────────────────────
    if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Loader2 className="animate-spin" size={48} /></div>;

    // ─── MAIN RENDER ────────────────────────────────────────────────
    return (
        <>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 'var(--spacing-md)', gap: isMobile ? '10px' : '0' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>
                        {activeTab === 'cockpit' && 'Investorportal – Cockpit'}
                        {activeTab === 'deals' && 'Neue Deals – Überblick'}
                        {activeTab === 'audit' && (activeDealType === 'fix_flip' ? 'Fix & Flip' : 'Buy & Hold')}
                        {activeTab === 'calculator' && 'Rechner'}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>
                        {activeTab === 'cockpit' && 'Strategisches Performance-Monitoring & Objekt-Sicht'}
                        {activeTab === 'deals' && 'Rechne Smart – Kaufe Schnell'}
                        {activeTab === 'audit' && (
                            activeDealType === 'fix_flip' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    Ankauf – Aufwertung – Verkauf: Kosten & Gewinn schnell berechnet
                                    <Flame size={16} style={{ color: '#f97316' }} />
                                </span>
                            ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    Ankauf – Finanzierung – Vermietung: Cashflow & Rendite berechnet
                                    <TrendingUp size={16} style={{ color: 'var(--success-color)' }} />
                                </span>
                            )
                        )}
                        {activeTab === 'calculator' && 'Cashflow-Optimierung und Refinanzierungstools'}
                    </p>
                </div>
                {activeTab === 'cockpit' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <ExportDropdown
                            reportType="immobilien"
                            data={groupedProperties.map(p => {
                                const formattedAddress = p.isGroup ? (() => {
                                    const streets = Array.from(new Set(p.properties.map(pr => pr.street).filter(Boolean)));
                                    const streetName = streets.length > 0 ? streets.join(', ') : 'Diverse';
                                    const numbers = p.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                                    return `${streetName} ${numbers}`.trim();
                                })() : `${p.street} ${p.house_number || ''}`.trim();

                                const rentIstMo = p.isGroup ? p._rentIst : getPropertyRentIst(p);
                                const bankrate = getGroupOrPropertyLoanPayment(p);
                                const totalSqm = p.isGroup ? p._totalSqm : (p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0);
                                const debt = p.isGroup ? p._debt : getPropertyDebt(p.id);

                                return {
                                    property_id: p.id,
                                    adresse: formattedAddress,
                                    einheiten: p.isGroup ? p.properties.reduce((sum, pr) => sum + (pr.units?.length || 0), 0) : (p.units?.length || 0),
                                    kaufpreis: p.total_investment_cost || 0,
                                    marktpreis: p.market_value_total || 0,
                                    restschuld: debt,
                                    miete_monat: rentIstMo,
                                    bankrate: bankrate,
                                    cashflow_monat: rentIstMo - bankrate,
                                    wohnflaeche: totalSqm,
                                    leerstand: getVacancy(p),
                                    ltv: parseFloat(p.market_value_total) > 0 ? debt / parseFloat(p.market_value_total) : 0,
                                    dscr: bankrate > 0 ? rentIstMo / bankrate : 0,
                                    _propertyLabel: formattedAddress,
                                };
                            })}
                            unitData={Object.fromEntries(groupedProperties.map(p => [
                                p.id,
                                (p.isGroup ? p.properties.flatMap(subP => subP.units || []) : (p.units || [])).map(u => ({
                                    unit_name: u.unit_name || '–',
                                    floor: u.floor || '–',
                                    sqm: u.sqm || 0,
                                    rooms: u.rooms || '–',
                                    target_rent: u.is_vacation_rental 
                                        ? (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0) 
                                        : (parseFloat(u.leases?.find(l => l.status === 'active')?.cold_rent) || 0),
                                    status: u.is_vacation_rental ? 'Ferienwohnung' : (u.leases?.find(l => l.status === 'active') ? 'Vermietet' : 'Leerstand'),
                                })),
                            ]))}
                            properties={properties.map(p => ({ id: p.id, label: `${p.street} ${p.house_number || ''}`.trim() }))}
                            totalRows={groupedProperties.length}
                        />
                    </div>
                )}
            </div>

            {activeTab === 'cockpit' && renderCockpit()}
            {activeTab === 'deals' && renderDealsOverview()}
            {activeTab === 'audit' && (
                activeDealType === 'fix_flip' ? (
                    <FixFlipCalculator
                        initialData={{ ...auditData, name: dealName }}
                        onSave={saveFixFlipDeal}
                        onBack={() => navigate('/investor-portal?tab=deals')}
                        onDelete={editingDealId ? () => deleteDeal(editingDealId) : null}
                        isSaving={savingDeal}
                    />
                ) : renderAudit()
            )}
            {activeTab === 'calculator' && (
                <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.6 }}>
                    <Calculator size={64} style={{ margin: '0 auto 20px' }} />
                    <h3>Spezial-Rechner</h3>
                    <p>Hier entstehen Werkzeuge für Cashflow-Optimierung und Refinanzierung.</p>
                </div>
            )}

            {/* Mieterhöhungen Detail Modal */}
            <Modal
                isOpen={showIncreasesModal}
                onClose={() => setShowIncreasesModal(false)}
                title="Mieterhöhungen möglich"
                footer={<Button variant="secondary" onClick={() => setShowIncreasesModal(false)}>Schließen</Button>}
            >
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Folgende Mietverhältnisse sind innerhalb der nächsten 30 Tage für eine Mieterhöhung fällig:
                </p>
                {pendingIncreases.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Keine Erhöhungen fällig.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {pendingIncreases.map((item, i) => (
                            <div key={i} style={{
                                padding: '12px 16px',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.tenantName}</span>
                                    <span style={{
                                        fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px',
                                        borderRadius: '12px', backgroundColor: 'rgba(236, 72, 153, 0.1)', color: '#EC4899'
                                    }}>
                                        ⚠️ {item.nextDate.toLocaleDateString()}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    {item.property} / {item.unit}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {item.leaseType}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>
        </>
    );
};

export default InvestorPortal;
