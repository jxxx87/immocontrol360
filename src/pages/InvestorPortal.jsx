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
    Edit3
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import CurrencyInput from '../components/ui/CurrencyInput';
import RateInput from '../components/ui/RateInput';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';

const InvestorPortal = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const { selectedPortfolioID } = usePortfolio();
    const auditRef = useRef(null);

    // UI State
    const [activeTab, setActiveTab] = useState('cockpit');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);

    // Detail Modal
    const [detailProperty, setDetailProperty] = useState(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // Audit Modal (Inline in cockpit table)
    const [auditPropertyId, setAuditPropertyId] = useState(null);

    // Action Menu
    const [openMenuId, setOpenMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    // Data State
    const [properties, setProperties] = useState([]);
    const [loans, setLoans] = useState([]);
    const [stats, setStats] = useState({
        netCashflow: 0,
        ltv: 0,
        rentPotential: 0,
        totalMarketValue: 0,
        totalDebt: 0
    });

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
        if (tab === 'deals' || !tab || tab === 'cockpit') fetchDeals();
    }, [location.search]);

    useEffect(() => {
        if (user) fetchData();
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
            let propQuery = supabase.from('properties').select('*, units(*, leases(*))');
            if (selectedPortfolioID) propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);
            const { data: propData } = await propQuery;

            let loanQuery = supabase.from('loans').select('*');
            if (selectedPortfolioID) {
                const propertyIds = propData?.map(p => p.id) || [];
                if (propertyIds.length > 0) loanQuery = loanQuery.in('property_id', propertyIds);
                else loanQuery = null;
            }
            const { data: loanData } = loanQuery ? await loanQuery : { data: [] };

            setProperties(propData || []);
            setLoans(loanData || []);
            calculateCockpitStats(propData || [], loanData || []);
        } catch (error) {
            console.error('Fehler beim Laden der Daten:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculateCockpitStats = (props, lns) => {
        let totalMonthlyIncome = 0;
        let totalDebt = 0;
        let totalMarketValue = 0;
        let totalTargetRent = 0;
        let totalMonthlyDebtService = 0;

        props.forEach(p => {
            totalMarketValue += parseFloat(p.market_value_total) || 0;
            (p.units || []).forEach(u => {
                const activeLease = u.leases?.find(l => l.status === 'active');
                totalMonthlyIncome += activeLease ? (parseFloat(activeLease.cold_rent) || 0) : 0;
                totalTargetRent += (parseFloat(u.target_rent) || 0);
            });
        });

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
        const amount = parseFloat(loan.loan_amount) || 0;
        const interestRate = (parseFloat(loan.interest_rate) || 0) / 100;
        const startDate = new Date(loan.start_date);
        const today = new Date();
        if (isNaN(startDate.getTime())) return amount;
        const monthsDiff = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth());
        if (monthsDiff <= 0) return amount;
        let balance = amount;
        const repaymentRate = (parseFloat(loan.initial_repayment_rate) || 0) / 100;
        const payment = loan.fixed_annuity ? parseFloat(loan.fixed_annuity) : (amount * (interestRate + repaymentRate) / 12);
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
            const activeLease = u.leases?.find(l => l.status === 'active');
            if (activeLease) total += parseFloat(activeLease.cold_rent) || 0;
        });
        return total;
    };

    const getPropertyRentSoll = (property) => {
        return (property.units || []).reduce((sum, u) => sum + (parseFloat(u.target_rent) || 0), 0);
    };

    const handleUpdateProperty = async (id, updates) => {
        try {
            setSaving(id);
            const { error } = await supabase.from('properties').update(updates).eq('id', id);
            if (error) throw error;
            const updatedProps = properties.map(p => p.id === id ? { ...p, ...updates } : p);
            setProperties(updatedProps);
            if (detailProperty?.id === id) setDetailProperty({ ...detailProperty, ...updates });
            if (updates.market_value_total !== undefined) {
                calculateCockpitStats(updatedProps, loans);
            }
        } catch (err) {
            alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(null);
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

    const saveDeal = async () => {
        if (!user || savingDeal) return;
        setSavingDeal(true);
        try {
            const metrics = calculateAuditMetrics();
            const loanTotal = auditData.loans.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
            const payload = {
                user_id: user.id,
                portfolio_id: selectedPortfolioID || null,
                name: dealName || 'Neuer Deal',
                purchase_price: parseFloat(auditData.purchasePrice) || 0,
                total_investment: metrics.totalInvestment,
                cold_rent_ist: parseFloat(auditData.coldRentIst) || 0,
                cold_rent_soll: parseFloat(auditData.coldRentSoll) || 0,
                equity: parseFloat(auditData.equity) || 0,
                loan_total: loanTotal,
                deal_data: auditData,
                scenario_data: scenario,
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
        setAuditData(deal.deal_data);
        setScenario(deal.scenario_data || { rentGrowth: 3, interestAdj: 0, repaymentAdj: 2 });
        setDealName(deal.name);
        setEditingDealId(deal.id);
        navigate('/investor-portal?tab=audit');
    };

    const startNewDeal = () => {
        setAuditData({
            purchasePrice: 0, transferTaxRate: 5, brokerRate: 3.57, notaryRate: 1.5, registryRate: 0.5, renovationCosts: 0,
            coldRentIst: 0, garageIst: 0, otherCostsIst: 0, coldRentSoll: 0, garageSoll: 0, otherCostsSoll: 0, targetYear: '',
            housegeld: '', reserves: '', equity: 0,
            loans: [{ amount: 0, interest: 3.5, repayment: 2, fixedYears: 10 }],
            afaRate: 2, buildingShare: 80, taxRate: 42
        });
        setScenario({ rentGrowth: 3, interestAdj: 0, repaymentAdj: 2 });
        setDealName('Neuer Deal');
        setEditingDealId(null);
        navigate('/investor-portal?tab=audit');
    };

    // ─── RENDER: DEALS OVERVIEW ─────────────────────────────────────
    const renderDealsOverview = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button icon={Plus} onClick={startNewDeal}>Buy & Hold Deal anlegen</Button>
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
                                        {['Name', 'Kaufpreis', 'Gesamtinvest.', 'Kaltmiete IST', 'Kaltmiete SOLL', 'EK', 'Darlehen', 'Erstellt', 'Aktionen'].map(h => (
                                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteWhiteSpace: 'nowrap' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {deals.map(deal => (
                                        <tr key={deal.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background-color 0.15s' }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                            onClick={() => loadDeal(deal)}>
                                            <td style={{ padding: '12px', fontWeight: 600 }}>{deal.name}</td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.purchase_price)}</td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.total_investment)}</td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.cold_rent_ist)}</td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap', color: deal.cold_rent_soll > 0 ? '#3B82F6' : 'var(--text-secondary)' }}>
                                                {deal.cold_rent_soll > 0 ? formatCurrency(deal.cold_rent_soll) : '–'}
                                            </td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.equity)}</td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{formatCurrency(deal.loan_total)}</td>
                                            <td style={{ padding: '12px', whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                {new Date(deal.created_at).toLocaleDateString('de-DE')}
                                            </td>
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
                            {deals.map(deal => (
                                <div key={deal.id}
                                    onClick={() => loadDeal(deal)}
                                    style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--spacing-md)',
                                        backgroundColor: 'var(--surface-color)',
                                        cursor: 'pointer'
                                    }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{deal.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{new Date(deal.created_at).toLocaleDateString('de-DE')}</div>
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
                                            <div style={{ fontWeight: 500 }}>{formatCurrency(deal.cold_rent_ist)}</div>
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
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(0)}</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Geplante Erhöhungen</p>
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
                            {properties.map(p => {
                                const totalSqm = p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                                const rentIstMo = getPropertyRentIst(p);
                                const rentSollMo = getPropertyRentSoll(p);
                                const debt = getPropertyDebt(p.id);
                                const marketValue = parseFloat(p.market_value_total) || 0;

                                return (
                                    <React.Fragment key={p.id}>
                                        <tr style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.15s' }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(59,130,246,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.street} {p.house_number}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.zip} {p.city}{totalSqm > 0 ? ` • ${totalSqm} m²` : ''}</div>
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {(parseFloat(p.total_investment_cost) || 0) > 0 ? formatCurrency(p.total_investment_cost) : (
                                                    <button
                                                        onClick={() => navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`)}
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
                                            <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {(parseFloat(p.equity_invested) || 0) > 0 ? formatCurrency(p.equity_invested) : (
                                                    <button
                                                        onClick={() => navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`)}
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
                                            <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {formatCurrency(rentIstMo * 12)}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {formatCurrency(rentSollMo * 12)}
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {marketValue > 0 ? (
                                                    formatCurrency(marketValue)
                                                ) : (
                                                    <button
                                                        onClick={() => {
                                                            setDetailProperty(p);
                                                            setIsDetailOpen(true);
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
                                            <td style={{ textAlign: 'right', padding: '14px 16px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {debt > 0 ? formatCurrency(debt) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '14px 16px' }}>
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
                                            </td>
                                        </tr>
                                        {/* Inline Audit Panel */}
                                        {auditPropertyId === p.id && (
                                            <tr>
                                                <td colSpan="8" style={{ padding: '0 16px 20px 16px', borderBottom: '1px solid var(--border-color)' }}>
                                                    <div ref={auditRef}>
                                                        {renderInlineAudit(p)}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {properties.length === 0 && (
                                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>Keine Immobilien gefunden.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Cards */}
                <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                    {properties.map(p => {
                        const totalSqm = p.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                        const rentIstMo = getPropertyRentIst(p);
                        const rentSollMo = getPropertyRentSoll(p);
                        const debt = getPropertyDebt(p.id);
                        const marketValue = parseFloat(p.market_value_total) || 0;

                        return (
                            <div key={p.id} style={{
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--spacing-md)',
                                backgroundColor: 'var(--surface-color)',
                                display: 'flex', flexDirection: 'column', gap: '12px'
                            }}>
                                {/* Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>{p.street} {p.house_number}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{p.zip} {p.city} • {totalSqm > 0 ? `${totalSqm} m²` : ''}</div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setDetailProperty(p);
                                            setIsDetailOpen(true);
                                        }}
                                        style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer' }}
                                    >
                                        <Eye size={20} />
                                    </button>
                                </div>

                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }}></div>

                                {/* Key Stats Grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Gesamtinvest</div>
                                        <div style={{ fontWeight: 500 }}>
                                            {(parseFloat(p.total_investment_cost) || 0) > 0 ? formatCurrency(p.total_investment_cost) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Eigenkapital</div>
                                        <div style={{ fontWeight: 500 }}>
                                            {(parseFloat(p.equity_invested) || 0) > 0 ? formatCurrency(p.equity_invested) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Miete IST (p.a.)</div>
                                        <div style={{ fontWeight: 500 }}>{formatCurrency(rentIstMo * 12)}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Miete SOLL (p.a.)</div>
                                        <div style={{ fontWeight: 500 }}>{formatCurrency(rentSollMo * 12)}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Marktwert</div>
                                        <div style={{ fontWeight: 500 }}>
                                            {marketValue > 0 ? formatCurrency(marketValue) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Restschuld</div>
                                        <div style={{ fontWeight: 500 }}>
                                            {debt > 0 ? formatCurrency(debt) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }}></div>

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <Button size="sm" variant="secondary" onClick={() => navigate(`/properties?editPropertyId=${p.id}&returnTo=cockpit`)} style={{ flex: 1 }}>
                                        <Edit3 size={14} style={{ marginRight: '6px' }} /> Bearbeiten
                                    </Button>
                                    <Button size="sm" variant="secondary" onClick={() => {
                                        if (auditPropertyId === p.id) setAuditPropertyId(null);
                                        else setAuditPropertyId(p.id);
                                    }} style={{ flex: 1, borderColor: auditPropertyId === p.id ? 'var(--primary-color)' : 'var(--border-color)' }}>
                                        <ShieldCheck size={14} style={{ marginRight: '6px' }} /> Zustand
                                    </Button>
                                </div>

                                {/* Inline Audit Mobile */}
                                {auditPropertyId === p.id && (
                                    <div ref={auditRef} style={{ marginTop: '8px' }}>
                                        {renderInlineAudit(p)}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {properties.length === 0 && (
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
                    style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600, minWidth: '200px' }}
                />
                <Button icon={savingDeal ? Loader2 : Save} onClick={saveDeal} disabled={savingDeal} style={savingDeal ? { opacity: 0.7, pointerEvents: 'none' } : {}}>
                    {savingDeal ? 'Speichert...' : (editingDealId ? 'Aktualisieren' : 'Speichern')}
                </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) 1fr', gap: 'var(--spacing-xl)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* 1. Investition */}
                    <Card title="1. Investition">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
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
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                            <RateInput label="Makler (%)" value={auditData.brokerRate} onChange={e => setAuditData({ ...auditData, brokerRate: e.target.value })} />
                            <RateInput label="Notar (%)" value={auditData.notaryRate} onChange={e => setAuditData({ ...auditData, notaryRate: e.target.value })} />
                            <RateInput label="Grundbuch (%)" value={auditData.registryRate} onChange={e => setAuditData({ ...auditData, registryRate: e.target.value })} />
                            <div>
                                <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>Renovierung (€)</span>
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
                                                Renovierungskosten werden in die AfA-Berechnung übernommen, wenn die Summe 15&nbsp;% höher ist als der Kaufpreis.
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
                    </Card>

                    {/* 2. Ertragsrechnung */}
                    <Card title="2. Ertragsrechnung (Mo.)">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
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
                            <div style={{ padding: '1rem', paddingLeft: '1.5rem', backgroundColor: 'rgba(59,130,246,0.04)', borderLeft: '2px solid rgba(59,130,246,0.15)', borderRadius: '0 8px 8px 0' }}>
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
                    </Card>

                    {/* 3. Finanzierung */}
                    <Card title="3. Finanzierung">
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
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
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
                    </Card>

                    {/* 4. Steuer-Parameter */}
                    <Card title="4. Steuer-Parameter">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                            <RateInput label="AfA Satz (%)" step="0.1" value={auditData.afaRate} onChange={e => setAuditData({ ...auditData, afaRate: e.target.value })} />
                            <RateInput label="Gebäudeanteil (%)" value={auditData.buildingShare} onChange={e => setAuditData({ ...auditData, buildingShare: e.target.value })} />
                            <RateInput label="Grenzsteuersatz (%)" value={auditData.taxRate} onChange={e => setAuditData({ ...auditData, taxRate: e.target.value })} />
                        </div>
                    </Card>
                </div>

                {/* Sticky Results */}
                <div style={{ position: 'sticky', top: '80px', height: 'fit-content', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
                </div>
            </div>
        </div>
    );

    // ─── LOADING ────────────────────────────────────────────────────
    if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Loader2 className="animate-spin" size={48} /></div>;

    // ─── MAIN RENDER ────────────────────────────────────────────────
    return (
        <div>
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>
                    {activeTab === 'cockpit' && 'Investorportal – Cockpit'}
                    {activeTab === 'deals' && 'Neue Deals – Überblick'}
                    {activeTab === 'audit' && 'Buy & Hold'}
                    {activeTab === 'calculator' && 'Rechner'}
                </h1>
                <p style={{ color: 'var(--text-secondary)' }}>
                    {activeTab === 'cockpit' && 'Strategisches Performance-Monitoring & Objekt-Sicht'}
                    {activeTab === 'deals' && 'Alle gespeicherten Deal-Berechnungen im Überblick'}
                    {activeTab === 'audit' && 'Bewertung und Analyse eines Ankaufsobjekts'}
                    {activeTab === 'calculator' && 'Cashflow-Optimierung und Refinanzierungstools'}
                </p>
            </div>

            {activeTab === 'cockpit' && renderCockpit()}
            {activeTab === 'deals' && renderDealsOverview()}
            {activeTab === 'audit' && renderAudit()}
            {activeTab === 'calculator' && (
                <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.6 }}>
                    <Calculator size={64} style={{ margin: '0 auto 20px' }} />
                    <h3>Spezial-Rechner</h3>
                    <p>Hier entstehen Werkzeuge für Cashflow-Optimierung und Refinanzierung.</p>
                </div>
            )}
        </div>
    );
};

export default InvestorPortal;
