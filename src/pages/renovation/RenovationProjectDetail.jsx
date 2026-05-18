import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ChevronLeft, ChevronDown, ChevronRight, Building2, Calendar,
    HardHat, Loader2, Plus, Trash2, CheckCircle2, Circle,
    DollarSign, TrendingUp, AlertTriangle, BarChart3,
    ClipboardList, Save, User, Milestone
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import GanttChart from '../../components/renovation/GanttChart';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';

const fmt = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);

const STATUS_MAP = {
    planned: { label: 'Geplant', color: '#64748b', bg: '#f1f5f9' },
    active: { label: 'Aktiv', color: '#0ea5e9', bg: '#e0f2fe' },
    completed: { label: 'Abgeschlossen', color: '#16a34a', bg: '#dcfce7' },
    archived: { label: 'Archiviert', color: '#9ca3af', bg: '#f3f4f6' },
};

const TRADE_STATUS = {
    open: { label: 'Offen', color: '#64748b', bg: '#f1f5f9' },
    in_progress: { label: 'In Arbeit', color: '#f59e0b', bg: '#fef3c7' },
    completed: { label: 'Fertig', color: '#16a34a', bg: '#dcfce7' },
};

const RenovationProjectDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { isMobile } = useViewMode();

    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [expandedTrade, setExpandedTrade] = useState(null);
    const [contacts, setContacts] = useState([]);
    const [activeView, setActiveView] = useState('cockpit');
    const [gikModal, setGikModal] = useState(false);

    // Invoice modal
    const [invoiceModal, setInvoiceModal] = useState(null); // { subtradeId }
    const [invoiceForm, setInvoiceForm] = useState({ amount: '', date: '', note: '' });

    // Budget edit
    const [editBudget, setEditBudget] = useState(null); // { subtradeId, value }

    useEffect(() => { if (user && id) fetchProject(); }, [user, id]);
    useEffect(() => {
        if (user) supabase.from('contacts').select('id, name').eq('user_id', user.id).order('name').then(r => setContacts(r.data || []));
    }, [user]);

    const fetchProject = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('renovation_projects')
            .select(`
                *,
                property:properties(street, house_number, city, zip),
                unit:units(unit_name),
                trades:renovation_project_trades(
                    *, milestones:renovation_milestones(*),
                    subtrades:renovation_project_subtrades(
                        *, invoices:renovation_invoices(*),
                        contact:contacts(name)
                    )
                )
            `)
            .eq('id', id).single();
        if (error) { console.error(error); navigate('/renovation'); return; }
        // Sort
        data.trades = (data.trades || []).sort((a, b) => a.sort_order - b.sort_order);
        data.trades.forEach(t => {
            t.subtrades = (t.subtrades || []).sort((a, b) => a.sort_order - b.sort_order);
            t.milestones = (t.milestones || []).sort((a, b) => a.sort_order - b.sort_order);
        });
        setProject(data);
        setLoading(false);
    };

    /* ─── Computed Stats ─────── */
    const stats = useMemo(() => {
        if (!project) return {};
        let budgetSoll = 0, istBezahlt = 0, totalMs = 0, doneMs = 0, totalTrades = project.trades?.length || 0, doneTrades = 0;
        (project.trades || []).forEach(t => {
            if (t.status === 'completed') doneTrades++;
            (t.subtrades || []).forEach(st => {
                budgetSoll += Number(st.budget_soll || 0);
                (st.invoices || []).forEach(inv => { istBezahlt += Number(inv.amount || 0); });
            });
            (t.milestones || []).forEach(m => { totalMs++; if (m.is_completed) doneMs++; });
        });
        const bufferMult = 1;
        const budgetInklPuffer = budgetSoll;
        const progress = totalMs > 0 ? Math.round((doneMs / totalMs) * 100) : 0;
        const overBudget = istBezahlt > budgetSoll && budgetSoll > 0;
        const remaining = budgetSoll - istBezahlt;
        return { budgetSoll, budgetInklPuffer, istBezahlt, progress, overBudget, remaining, totalTrades, doneTrades, totalMs, doneMs };
    }, [project]);

    /* ─── Milestone Toggle ─────── */
    const toggleMilestone = async (milestone) => {
        const is_completed = !milestone.is_completed;
        await supabase.from('renovation_milestones').update({
            is_completed, completed_at: is_completed ? new Date().toISOString() : null,
        }).eq('id', milestone.id);

        // If completion trigger → set trade status to completed
        if (is_completed && milestone.is_completion_trigger) {
            await supabase.from('renovation_project_trades').update({ status: 'completed' }).eq('id', milestone.project_trade_id);
        }
        fetchProject();
    };

    /* ─── Trade status ─────── */
    const updateTradeStatus = async (tradeId, status) => {
        await supabase.from('renovation_project_trades').update({ status }).eq('id', tradeId);
        fetchProject();
    };

    /* ─── Project status ─────── */
    const updateProjectStatus = async (status) => {
        if (status === 'completed') {
            setGikModal(true);
            return;
        }
        await supabase.from('renovation_projects').update({ status }).eq('id', id);
        fetchProject();
    };

    /* ─── GIK: Projekt abschliessen & Kosten uebernehmen ─────── */
    const completeProjectWithGIK = async (writeToProperty) => {
        await supabase.from('renovation_projects').update({ status: 'completed' }).eq('id', id);
        if (writeToProperty && project) {
            const { data: prop } = await supabase.from('properties').select('total_investment_cost').eq('id', project.property_id).single();
            const existingCost = Number(prop?.total_investment_cost || 0);
            const newCost = existingCost + stats.istBezahlt;
            await supabase.from('properties').update({ total_investment_cost: newCost }).eq('id', project.property_id);
        }
        setGikModal(false);
        fetchProject();
    };

    /* ─── Trade date update ─────── */
    const updateTradeDate = async (tradeId, field, value) => {
        await supabase.from('renovation_project_trades').update({ [field]: value || null }).eq('id', tradeId);
        fetchProject();
    };

    /* ─── Budget inline ─────── */
    const saveBudget = async (subtradeId, value) => {
        await supabase.from('renovation_project_subtrades').update({ budget_soll: Number(value) || 0 }).eq('id', subtradeId);
        setEditBudget(null);
        fetchProject();
    };

    /* ─── Invoice CRUD ─────── */
    const addInvoice = async () => {
        if (!invoiceModal || !invoiceForm.amount) return;
        await supabase.from('renovation_invoices').insert({
            project_subtrade_id: invoiceModal.subtradeId,
            project_id: id,
            user_id: user.id,
            amount: Number(invoiceForm.amount),
            date: invoiceForm.date || new Date().toISOString().slice(0, 10),
            note: invoiceForm.note || null,
        });
        setInvoiceModal(null);
        setInvoiceForm({ amount: '', date: '', note: '' });
        fetchProject();
    };

    const deleteInvoice = async (invId) => {
        await supabase.from('renovation_invoices').delete().eq('id', invId);
        fetchProject();
    };

    /* ─── Responsible contact ─────── */
    const updateResponsible = async (subtradeId, contactId) => {
        await supabase.from('renovation_project_subtrades').update({ responsible_contact_id: contactId || null }).eq('id', subtradeId);
        fetchProject();
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;
    if (!project) return null;

    const st = STATUS_MAP[project.status] || STATUS_MAP.planned;

    return (
        <div>
            {/* Back */}
            <button onClick={() => navigate('/renovation')} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px' }}>
                <ChevronLeft size={16} /> Übersicht
            </button>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: isMobile ? '1.3rem' : '1.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {project.name}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 12px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                    </h1>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Building2 size={14} /> {project.property?.street} {project.property?.house_number}, {project.property?.city}</span>
                        {project.unit?.unit_name && <span>• {project.unit.unit_name}</span>}
                        {project.target_end_date && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> Ziel: {new Date(project.target_end_date).toLocaleDateString('de-DE')}</span>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {project.status !== 'completed' && <Button size="sm" onClick={() => updateProjectStatus('completed')} style={{ background: '#16a34a' }}>Abschließen</Button>}
                    {project.status === 'completed' && <Button variant="secondary" size="sm" onClick={() => updateProjectStatus('active')}>Reaktivieren</Button>}
                    <Button variant="secondary" size="sm" onClick={() => updateProjectStatus('archived')}>Archivieren</Button>
                </div>
            </div>

            {/* View Tabs: Cockpit / Gantt */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
                {[{ key: 'cockpit', label: 'Cockpit' }, { key: 'gantt', label: 'Bauzeitenplan' }].map(v => (
                    <button key={v.key} onClick={() => setActiveView(v.key)}
                        style={{
                            padding: isMobile ? '8px 12px' : '10px 20px', fontSize: '0.85rem', fontWeight: 600,
                            border: 'none', background: 'none', cursor: 'pointer',
                            color: activeView === v.key ? '#0ea5e9' : 'var(--text-secondary)',
                            borderBottom: activeView === v.key ? '2px solid #0ea5e9' : '2px solid transparent',
                            marginBottom: '-1px', transition: 'all 0.2s',
                        }}>
                        {v.label}
                    </button>
                ))}
            </div>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                {[
                    { label: 'Budget (Soll)', value: fmt(stats.budgetInklPuffer), icon: DollarSign, color: '#0ea5e9' },
                    { label: 'Ist bezahlt', value: fmt(stats.istBezahlt), icon: TrendingUp, color: stats.overBudget ? '#dc2626' : '#16a34a' },
                    { label: 'Verbleibend', value: fmt(stats.remaining), icon: BarChart3, color: stats.remaining < 0 ? '#dc2626' : '#64748b' },
                    { label: 'Fortschritt', value: `${stats.progress}%`, icon: CheckCircle2, color: stats.progress === 100 ? '#16a34a' : '#f59e0b' },
                ].map((kpi, i) => (
                    <div key={i} style={{ background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '6px' }}>
                            {React.createElement(kpi.icon, { size: 14, color: kpi.color })} {kpi.label}
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
                    </div>
                ))}
            </div>

            {/* Progress Bar */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    <span>{stats.doneMs}/{stats.totalMs} Meilensteine</span>
                    <span>{stats.doneTrades}/{stats.totalTrades} Gewerke abgeschlossen</span>
                </div>
                <div style={{ height: '6px', borderRadius: '3px', background: 'var(--border-color)' }}>
                    <div style={{ height: '100%', borderRadius: '3px', width: `${stats.progress}%`, background: stats.progress === 100 ? '#16a34a' : 'linear-gradient(90deg, #0ea5e9, #06b6d4)', transition: 'width 0.4s' }} />
                </div>
            </div>

            {/* ═══ BAUZEITENPLAN VIEW ═══ */}
            {activeView === 'gantt' && (
                <div style={{ marginBottom: '28px' }}>
                    {/* Ziel-Datum Soll / Ist */}
                    {(() => {
                        const fmtDate = d => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                        const zielSoll = project.target_end_date || null;
                        const tradeEndDates = (project.trades || []).map(t => t.end_date).filter(Boolean);
                        const zielIst = tradeEndDates.length > 0 ? tradeEndDates.sort().pop() : null;
                        const isOverdue = zielSoll && zielIst && zielIst > zielSoll;
                        return (
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(2, 200px)', gap: '12px', marginBottom: '20px' }}>
                                <div style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '4px' }}>Ziel-Datum (Soll)</div>
                                    <input
                                        type="date"
                                        value={zielSoll || ''}
                                        onChange={async (e) => {
                                            const val = e.target.value || null;
                                            await supabase.from('renovation_projects').update({ target_end_date: val }).eq('id', project.id);
                                            setProject(prev => ({ ...prev, target_end_date: val }));
                                        }}
                                        style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0ea5e9', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', outline: 'none', width: '100%' }}
                                    />
                                </div>
                                <div style={{ background: 'var(--surface-color)', border: `1px solid ${isOverdue ? '#dc2626' : 'var(--border-color)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '4px' }}>Ziel-Datum (Ist)</div>
                                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: isOverdue ? '#dc2626' : '#16a34a' }}>{fmtDate(zielIst)}</div>
                                </div>
                            </div>
                        );
                    })()}
                    <GanttChart
                        trades={project.trades || []}
                        onTradeClick={(tradeId) => { setActiveView('cockpit'); setExpandedTrade(tradeId); }}
                        isMobile={isMobile}
                    />
                    <div style={{ marginTop: '16px' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '10px' }}>Zeiträume bearbeiten</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {(project.trades || []).map(t => (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem', minWidth: '140px' }}>{t.name}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Start:</label>
                                        <input type="date" value={t.start_date || ''} onChange={e => updateTradeDate(t.id, 'start_date', e.target.value)}
                                            style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }} />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ende:</label>
                                        <input type="date" value={t.end_date || ''} onChange={e => updateTradeDate(t.id, 'end_date', e.target.value)}
                                            style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ COCKPIT VIEW ═══ */}
            {activeView === 'cockpit' && (<>
                {/* Gewerke Accordion */}
                <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '12px' }}>Gewerke</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(project.trades || []).map(trade => {
                        const isExpanded = expandedTrade === trade.id;
                        const tst = TRADE_STATUS[trade.status] || TRADE_STATUS.open;
                        let tradeSoll = 0, tradeIst = 0;
                        (trade.subtrades || []).forEach(st => {
                            tradeSoll += Number(st.budget_soll || 0);
                            (st.invoices || []).forEach(inv => { tradeIst += Number(inv.amount || 0); });
                        });
                        return (
                            <div key={trade.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                                {/* Trade Header */}
                                <div
                                    onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', cursor: 'pointer', background: 'var(--background-color)' }}
                                >
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    <span style={{ fontWeight: 700, flex: 1 }}>{trade.name}</span>
                                    <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, background: tst.bg, color: tst.color }}>{tst.label}</span>
                                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{fmt(tradeIst)} / {fmt(tradeSoll)}</span>
                                </div>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                                        {/* Milestones */}
                                        <div style={{ marginBottom: '16px' }}>
                                            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Milestone size={14} /> Meilensteine
                                            </h4>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                {(trade.milestones || []).map(m => (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => toggleMilestone(m)}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '5px',
                                                            padding: '6px 12px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                                                            background: m.is_completed ? '#dcfce7' : 'var(--surface-color)',
                                                            color: m.is_completed ? '#16a34a' : 'var(--text-secondary)',
                                                            border: m.is_completed ? '1px solid #16a34a' : '1px solid var(--border-color)',
                                                            transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        {m.is_completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                                                        {m.name}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Trade Status Buttons */}
                                        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
                                            {Object.entries(TRADE_STATUS).map(([k, v]) => (
                                                <button key={k} onClick={() => updateTradeStatus(trade.id, k)}
                                                    style={{
                                                        padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                                                        background: trade.status === k ? v.bg : 'transparent',
                                                        color: trade.status === k ? v.color : 'var(--text-secondary)',
                                                        border: trade.status === k ? `1px solid ${v.color}` : '1px solid var(--border-color)',
                                                    }}>
                                                    {v.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Subtrades Table */}
                                        <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>Untergewerke & Budget</h4>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Untergewerk</th>
                                                        <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Budget Soll</th>
                                                        <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Ist bezahlt</th>
                                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>Verantwortlich</th>
                                                        <th style={{ textAlign: 'center', padding: '6px 8px' }}></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(trade.subtrades || []).map(st => {
                                                        const stIst = (st.invoices || []).reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
                                                        const over = stIst > Number(st.budget_soll || 0) && st.budget_soll > 0;
                                                        return (
                                                            <React.Fragment key={st.id}>
                                                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td style={{ padding: '8px', fontWeight: 600 }}>{st.name}</td>
                                                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                        {editBudget?.subtradeId === st.id ? (
                                                                            <input type="number" defaultValue={st.budget_soll}
                                                                                onBlur={e => saveBudget(st.id, e.target.value)}
                                                                                onKeyDown={e => e.key === 'Enter' && saveBudget(st.id, e.target.value)}
                                                                                autoFocus style={{ width: '100px', textAlign: 'right', padding: '4px', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
                                                                        ) : (
                                                                            <span onClick={() => setEditBudget({ subtradeId: st.id })} style={{ cursor: 'pointer' }} title="Klicken zum Bearbeiten">
                                                                                {fmt(st.budget_soll)}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: over ? '#dc2626' : 'var(--text-primary)' }}>
                                                                        {fmt(stIst)}
                                                                    </td>
                                                                    <td style={{ padding: '8px' }}>
                                                                        <select value={st.responsible_contact_id || ''} onChange={e => updateResponsible(st.id, e.target.value)}
                                                                            style={{ padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem', background: 'var(--surface-color)', maxWidth: '130px' }}>
                                                                            <option value="">—</option>
                                                                            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                                        </select>
                                                                    </td>
                                                                    <td style={{ padding: '8px', textAlign: 'center' }}>
                                                                        <button onClick={() => { setInvoiceModal({ subtradeId: st.id }); setInvoiceForm({ amount: '', date: new Date().toISOString().slice(0, 10), note: '' }); }}
                                                                            style={{ background: 'none', border: '1px solid #0ea5e9', borderRadius: '4px', color: '#0ea5e9', fontSize: '0.72rem', padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                                            <Plus size={12} /> RE
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                                {/* Invoice sub-rows */}
                                                                {(st.invoices || []).map(inv => (
                                                                    <tr key={inv.id} style={{ background: 'var(--background-color)', fontSize: '0.78rem' }}>
                                                                        <td style={{ padding: '4px 8px 4px 28px', color: 'var(--text-secondary)' }}>
                                                                            RE {new Date(inv.date).toLocaleDateString('de-DE')} {inv.note && `– ${inv.note}`}
                                                                        </td>
                                                                        <td></td>
                                                                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt(inv.amount)}</td>
                                                                        <td></td>
                                                                        <td style={{ textAlign: 'center', padding: '4px' }}>
                                                                            <button onClick={() => deleteInvoice(inv.id)}
                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px' }}>
                                                                                <Trash2 size={12} />
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </>)}

            {/* Invoice Modal */}
            <Modal isOpen={!!invoiceModal} onClose={() => setInvoiceModal(null)} title="Rechnung erfassen"
                footer={<><Button variant="secondary" onClick={() => setInvoiceModal(null)}>Abbrechen</Button><Button onClick={addInvoice}>Speichern</Button></>}>
                <Input label="Betrag (€)" type="number" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} placeholder="0" />
                <Input label="Datum" type="date" value={invoiceForm.date} onChange={e => setInvoiceForm({ ...invoiceForm, date: e.target.value })} />
                <Input label="Notiz (optional)" value={invoiceForm.note} onChange={e => setInvoiceForm({ ...invoiceForm, note: e.target.value })} placeholder="z.B. Abschlagszahlung 1" />
            </Modal>

            {/* GIK Completion Modal */}
            <Modal isOpen={gikModal} onClose={() => setGikModal(false)} title="Projekt abschließen"
                footer={
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Button variant="secondary" onClick={() => setGikModal(false)}>Abbrechen</Button>
                        <Button variant="secondary" onClick={() => completeProjectWithGIK(false)}>Ohne Übernahme</Button>
                        <Button onClick={() => completeProjectWithGIK(true)} style={{ background: '#16a34a' }}>Kosten übernehmen</Button>
                    </div>
                }>
                <div style={{ padding: '8px 0', fontSize: '0.92rem', lineHeight: 1.8 }}>
                    <p>Das Projekt <strong>{project?.name}</strong> wird als abgeschlossen markiert.</p>
                    <div style={{ background: 'var(--background-color)', borderRadius: 'var(--radius-md)', padding: '14px', margin: '14px 0', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>GIK-Übernahme (Gemeinkosten)</div>
                        <p style={{ fontSize: '0.88rem' }}>Sollen die Sanierungskosten von <strong style={{ color: '#0ea5e9' }}>{fmt(stats.istBezahlt)}</strong> zur <strong>Gesamtinvestition</strong> der Immobilie addiert werden?</p>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '8px' }}>Betrifft AfA-Berechnung und Cockpit-Wert im Investorportal.</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default RenovationProjectDetail;
