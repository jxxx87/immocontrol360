import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    HardHat, Plus, Search, Building2, Calendar, Trash2, Archive,
    CheckCircle2, Clock, AlertTriangle, Loader2, MoreVertical,
    Settings as SettingsIcon, ClipboardList, FolderKanban, ArrowRight, Calculator, PenTool
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useViewMode } from '../../context/ViewModeContext';
import RenovationSettings from './RenovationSettings';
import RenovationTasks from './RenovationTasks';
import RenovationCalculator from './RenovationCalculator';
import ExportDropdown from '../../components/ExportDropdown';
import FloorPlanLibrary from './FloorPlanLibrary';

/* ─── Status Config ─────────────────────── */
const STATUS_MAP = {
    planned: { label: 'Geplant', color: '#64748b', bg: '#f1f5f9', icon: Clock },
    active: { label: 'Aktiv', color: '#0ea5e9', bg: '#e0f2fe', icon: HardHat },
    completed: { label: 'Abgeschlossen', color: '#16a34a', bg: '#dcfce7', icon: CheckCircle2 },
    archived: { label: 'Archiviert', color: '#9ca3af', bg: '#f3f4f6', icon: Archive },
};

const fmt = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);

const RenovationManager = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const { isMobile } = useViewMode();
    const navigate = useNavigate();
    const location = useLocation();

    // Tab state
    const queryTab = new URLSearchParams(location.search).get('tab');
    const [activeTab, setActiveTab] = useState(queryTab || 'projects');

    // Data
    const [projects, setProjects] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [openTaskCount, setOpenTaskCount] = useState(0);

    useEffect(() => {
        if (user) fetchData();
    }, [user, selectedPortfolioID]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch properties for display
            let propQuery = supabase.from('properties').select('id, street, house_number, city, zip');
            if (selectedPortfolioID) propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);
            const { data: props } = await propQuery;
            setProperties(props || []);

            // Fetch projects with aggregated data
            const { data: projs, error } = await supabase
                .from('renovation_projects')
                .select(`
                    *,
                    property:properties(street, house_number, city),
                    unit:units(unit_name),
                    trades:renovation_project_trades(
                        id, status, name,
                        subtrades:renovation_project_subtrades(
                            budget_soll,
                            invoices:renovation_invoices(amount)
                        ),
                        milestones:renovation_milestones(is_completed, is_completion_trigger)
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setProjects(projs || []);

            // Fetch open task count for badge
            const { count } = await supabase.from('renovation_tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_completed', false);
            setOpenTaskCount(count || 0);
        } catch (err) {
            console.error('Error fetching renovation data:', err);
        } finally {
            setLoading(false);
        }
    };

    /* ─── Computed project stats ──────────── */
    const enrichedProjects = useMemo(() => {
        return projects.map(p => {
            let budgetSoll = 0, istBezahlt = 0, totalMilestones = 0, completedMilestones = 0;
            (p.trades || []).forEach(t => {
                (t.subtrades || []).forEach(st => {
                    budgetSoll += Number(st.budget_soll || 0);
                    (st.invoices || []).forEach(inv => { istBezahlt += Number(inv.amount || 0); });
                });
                (t.milestones || []).forEach(m => {
                    totalMilestones++;
                    if (m.is_completed) completedMilestones++;
                });
            });
            const budgetInklPuffer = budgetSoll;
            const progress = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;
            const propertyLabel = p.property ? `${p.property.street} ${p.property.house_number || ''}, ${p.property.city}` : '—';
            const unitLabel = p.unit?.unit_name || null;
            return { ...p, budgetSoll, budgetInklPuffer, istBezahlt, progress, propertyLabel, unitLabel, totalMilestones, completedMilestones };
        });
    }, [projects]);

    const filtered = useMemo(() => {
        return enrichedProjects.filter(p => {
            if (statusFilter !== 'all' && p.status !== statusFilter) return false;
            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                return (p.name + p.propertyLabel).toLowerCase().includes(s);
            }
            return true;
        });
    }, [enrichedProjects, statusFilter, searchTerm]);

    /* ─── Delete ──────────── */
    const handleDelete = async (id) => {
        if (!window.confirm('Projekt endgültig löschen? Alle Gewerke, Rechnungen und Aufgaben werden gelöscht.')) return;
        const { error } = await supabase.from('renovation_projects').delete().eq('id', id);
        if (!error) fetchData();
    };

    /* ─── Tab Navigation ──────────── */
    const tabs = [
        { key: 'projects', label: 'Projekte', icon: FolderKanban },
        { key: 'calculator', label: 'Sanierungsrechner', icon: Calculator },
        { 
            key: 'floorplan', 
            label: (
                <span>
                    Grundrisseditor <span style={{ color: '#ef4444', marginLeft: '2px', fontSize: '0.78rem', fontWeight: 600 }}>(Testphase)</span>
                </span>
            ), 
            icon: PenTool 
        },
        { key: 'tasks', label: 'Aufgaben', icon: ClipboardList },
        { key: 'settings', label: 'Einstellungen', icon: SettingsIcon },
    ];

    const handleTabChange = (key) => {
        setActiveTab(key);
        navigate(`/renovation?tab=${key}`, { replace: true });
    };

    /* ─── Render ──────────── */
    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: isMobile ? '1.4rem' : '1.875rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <HardHat size={isMobile ? 22 : 28} color="#f59e0b" />
                        Sanierungsmanager
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        Sanierungsprojekte planen, budgetieren und verfolgen.
                    </p>
                </div>
                {activeTab === 'projects' && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <ExportDropdown
                            reportType="sanierung"
                            data={enrichedProjects.map(p => ({
                                projekt: p.name || '–',
                                objekt: p.propertyLabel || '–',
                                budget_soll: p.budgetSoll || 0,
                                ist_bezahlt: p.istBezahlt || 0,
                                fortschritt: p.progress ? p.progress / 100 : 0,
                                ziel_enddatum: p.target_end_date || '',
                                offene_aufgaben: p.totalMilestones - p.completedMilestones,
                            }))}
                            totalRows={enrichedProjects.length}
                        />
                        <Button icon={Plus} onClick={() => navigate('/renovation/new')}>
                            {isMobile ? 'Neu' : 'Neues Projekt'}
                        </Button>
                    </div>
                )}
                {activeTab === 'calculator' && (
                    <Button icon={Plus} onClick={() => navigate('/renovation/calculator/new')}>
                        {isMobile ? 'Neu' : 'Neue Kalkulation'}
                    </Button>
                )}
                {activeTab === 'floorplan' && (
                    <Button icon={Plus} onClick={() => navigate('/renovation/floorplan/new')}>
                        {isMobile ? 'Neu' : 'Neuer Grundriss'}
                    </Button>
                )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '0' }}>
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => handleTabChange(t.key)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: isMobile ? '10px 12px' : '10px 20px',
                            fontSize: isMobile ? '0.82rem' : '0.875rem', fontWeight: 600,
                            border: 'none', background: 'none', cursor: 'pointer',
                            color: activeTab === t.key ? '#0ea5e9' : 'var(--text-secondary)',
                            borderBottom: activeTab === t.key ? '2px solid #0ea5e9' : '2px solid transparent',
                            marginBottom: '-1px', transition: 'all 0.2s',
                        }}
                    >
                        <t.icon size={16} />
                        {t.label}
                        {t.key === 'tasks' && openTaskCount > 0 && (
                            <span style={{
                                minWidth: '18px', height: '18px', borderRadius: '9px',
                                background: '#0ea5e9', color: '#fff',
                                fontSize: '0.68rem', fontWeight: 700,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 5px', marginLeft: '2px', lineHeight: 1,
                            }}>{openTaskCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'projects' && (
                <>
                    {/* Filters */}
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '360px' }}>
                            <input
                                type="text"
                                placeholder="Projekt suchen..."
                                className="padded-left-icon"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.875rem' }}
                            />
                            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}
                        >
                            <option value="all">Alle Status</option>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>

                    {/* Project Cards */}
                    {filtered.length === 0 ? (
                        <Card>
                            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <HardHat size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                <p style={{ fontWeight: 600 }}>Keine Projekte gefunden</p>
                                <p style={{ fontSize: '0.85rem', marginTop: '4px' }}>Erstelle dein erstes Sanierungsprojekt.</p>
                            </div>
                        </Card>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {filtered.map(p => {
                                const st = STATUS_MAP[p.status] || STATUS_MAP.planned;
                                const overBudget = p.istBezahlt > p.budgetInklPuffer && p.budgetInklPuffer > 0;
                                return (
                                    <div
                                        key={p.id}
                                        onClick={() => navigate(`/renovation/${p.id}`)}
                                        style={{
                                            background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                                            border: `1px solid ${overBudget ? '#fca5a5' : 'var(--border-color)'}`,
                                            padding: isMobile ? '14px' : '20px', cursor: 'pointer',
                                            transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                        }}
                                        onMouseEnter={e => { if (!isMobile) e.currentTarget.style.borderColor = '#0ea5e9'; }}
                                        onMouseLeave={e => { if (!isMobile) e.currentTarget.style.borderColor = overBudget ? '#fca5a5' : 'var(--border-color)'; }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '180px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                    <span style={{ fontWeight: 700, fontSize: isMobile ? '0.95rem' : '1.05rem' }}>{p.name}</span>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 10px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700, background: st.bg, color: st.color }}>
                                                        {React.createElement(st.icon, { size: 12 })} {st.label}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Building2 size={13} /> {p.propertyLabel}
                                                        {p.unitLabel && <span style={{ color: 'var(--text-secondary)', marginLeft: '4px' }}>({p.unitLabel})</span>}
                                                    </span>
                                                    {p.target_end_date && (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <Calendar size={13} /> {new Date(p.target_end_date).toLocaleDateString('de-DE')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* KPIs */}
                                            <div style={{ display: 'flex', gap: isMobile ? '12px' : '24px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Budget (Soll)</div>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{fmt(p.budgetInklPuffer)}</div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Ist bezahlt</div>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: overBudget ? '#dc2626' : 'var(--text-primary)' }}>{fmt(p.istBezahlt)}</div>
                                                </div>
                                                <div style={{ textAlign: 'center', minWidth: '50px' }}>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Fortschritt</div>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: p.progress === 100 ? '#16a34a' : '#0ea5e9' }}>{p.progress}%</div>
                                                </div>
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleDelete(p.id); }}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '6px' }}
                                                    title="Löschen"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Progress Bar */}
                                        <div style={{ marginTop: '12px', height: '4px', borderRadius: '2px', background: 'var(--border-color)' }}>
                                            <div style={{ height: '100%', borderRadius: '2px', width: `${p.progress}%`, background: p.progress === 100 ? '#16a34a' : 'linear-gradient(90deg, #0ea5e9, #06b6d4)', transition: 'width 0.4s' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {activeTab === 'tasks' && <RenovationTasks onTaskChange={async () => {
                const { count } = await supabase.from('renovation_tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_completed', false);
                setOpenTaskCount(count || 0);
            }} />}
            {activeTab === 'calculator' && <RenovationCalculator />}
            {activeTab === 'floorplan' && <FloorPlanLibrary />}
            {activeTab === 'settings' && <RenovationSettings onSaved={fetchData} />}
        </div>
    );
};

export default RenovationManager;
