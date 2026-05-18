import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Search, Building2, Loader2, Trash2, Copy, ExternalLink, PenTool,
    LayoutGrid, LayoutList, ArrowUpDown
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import { mm2ToM2 } from '../../lib/floorplan/constants';

const FloorPlanLibrary = () => {
    const { user } = useAuth();
    const { isMobile } = useViewMode();
    const navigate = useNavigate();

    const [plans, setPlans] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [propertyFilter, setPropertyFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('updated');
    const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'

    useEffect(() => {
        if (user) fetchData();
    }, [user]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [plansRes, propsRes] = await Promise.all([
                supabase.from('floor_plans')
                    .select('*, property:properties(street, house_number, city), unit:units(unit_name)')
                    .eq('user_id', user.id)
                    .order('updated_at', { ascending: false }),
                supabase.from('properties')
                    .select('id, street, house_number, city'),
            ]);
            setPlans(plansRes.data || []);
            setProperties(propsRes.data || []);
        } catch (err) {
            console.error('Error loading floor plans:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDuplicate = async (plan) => {
        const newPlan = {
            user_id: user.id,
            name: `${plan.name} (Kopie)`,
            property_id: plan.property_id,
            unit_id: plan.unit_id,
            status: 'draft',
            plan_data: plan.plan_data,
        };
        const { error } = await supabase.from('floor_plans').insert(newPlan);
        if (!error) fetchData();
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Grundriss endgültig löschen?')) return;
        const { error } = await supabase.from('floor_plans').delete().eq('id', id);
        if (!error) fetchData();
    };

    const enriched = useMemo(() => {
        return plans.map(p => {
            const storeys = Array.isArray(p.plan_data) ? p.plan_data : [];
            let roomCount = 0;
            let totalArea = 0;
            let storeysLabels = [];
            storeys.forEach(s => {
                roomCount += (s.rooms || []).length;
                (s.rooms || []).forEach(r => { totalArea += (r.area_mm2 || 0); });
                storeysLabels.push(s.label || '?');
            });
            const propLabel = p.property
                ? `${p.property.street} ${p.property.house_number || ''}, ${p.property.city}`
                : '—';
            return {
                ...p,
                roomCount,
                totalArea,
                storeysLabels,
                propertyLabel: propLabel,
                unitLabel: p.unit?.unit_name || '',
            };
        });
    }, [plans]);

    const filtered = useMemo(() => {
        let result = enriched;
        if (propertyFilter !== 'all') result = result.filter(p => p.property_id === propertyFilter);
        if (statusFilter !== 'all') result = result.filter(p => p.status === statusFilter);
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            result = result.filter(p =>
                p.name?.toLowerCase().includes(s) ||
                p.propertyLabel.toLowerCase().includes(s) ||
                p.unitLabel.toLowerCase().includes(s)
            );
        }
        if (sortBy === 'name') result = [...result].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        else if (sortBy === 'property') result = [...result].sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));
        // default: by updated_at (already ordered)
        return result;
    }, [enriched, propertyFilter, statusFilter, searchTerm, sortBy]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    return (
        <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '360px' }}>
                    <input
                        type="text"
                        placeholder="Grundriss suchen..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="padded-left-icon"
                        style={{ width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.875rem' }}
                    />
                    <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
                </div>

                <select
                    value={propertyFilter}
                    onChange={e => setPropertyFilter(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}
                >
                    <option value="all">Alle Immobilien</option>
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}
                >
                    <option value="all">Alle Status</option>
                    <option value="draft">Entwurf</option>
                    <option value="completed">Fertig</option>
                </select>

                <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}
                >
                    <option value="updated">Zuletzt geändert</option>
                    <option value="name">Name</option>
                    <option value="property">Immobilie</option>
                </select>

                {!isMobile && (
                    <div style={{ display: 'flex', gap: '2px', background: 'var(--border-color)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
                        <button
                            onClick={() => setViewMode('table')}
                            style={{ padding: '6px 10px', background: viewMode === 'table' ? 'var(--surface-color)' : 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                        >
                            <LayoutList size={16} color={viewMode === 'table' ? '#0ea5e9' : '#9ca3af'} />
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            style={{ padding: '6px 10px', background: viewMode === 'grid' ? 'var(--surface-color)' : 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                        >
                            <LayoutGrid size={16} color={viewMode === 'grid' ? '#0ea5e9' : '#9ca3af'} />
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            {filtered.length === 0 ? (
                <Card>
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <PenTool size={48} style={{ margin: '0 auto 16px', opacity: 0.25 }} />
                        <p style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '6px' }}>Noch kein Grundriss vorhanden</p>
                        <p style={{ fontSize: '0.88rem', marginBottom: '20px' }}>Zeichne deinen ersten Grundriss und nutze Aufmaßdaten für die Sanierung.</p>
                        <Button icon={Plus} onClick={() => navigate('/renovation/floorplan/new')}>
                            Jetzt ersten Grundriss zeichnen
                        </Button>
                    </div>
                </Card>
            ) : viewMode === 'table' ? (
                <Card style={{ padding: 0, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--surface-color)' }}>
                                {['Name', 'Immobilie', 'Einheit', 'Geschosse', 'Räume', 'Fläche', 'Zuletzt geändert', 'Aktionen'].map(h => (
                                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(p => (
                                <tr
                                    key={p.id}
                                    onClick={() => navigate(`/renovation/floorplan/${p.id}`)}
                                    style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.15s' }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {p.name}
                                            <span style={{
                                                fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '8px',
                                                background: p.status === 'completed' ? '#dcfce7' : '#f1f5f9',
                                                color: p.status === 'completed' ? '#16a34a' : '#64748b',
                                            }}>{p.status === 'completed' ? 'Fertig' : 'Entwurf'}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{p.propertyLabel}</td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{p.unitLabel || '—'}</td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{p.storeysLabels.join(', ') || '—'}</td>
                                    <td style={{ padding: '12px 14px', fontWeight: 500 }}>{p.roomCount}</td>
                                    <td style={{ padding: '12px 14px', fontWeight: 500 }}>{p.totalArea > 0 ? `${mm2ToM2(p.totalArea)} m²` : '—'}</td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                        {new Date(p.updated_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td style={{ padding: '12px 14px' }}>
                                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                                            <button onClick={() => navigate(`/renovation/floorplan/${p.id}`)} title="Öffnen" style={iconBtnStyle}><ExternalLink size={15} /></button>
                                            <button onClick={() => handleDuplicate(p)} title="Duplizieren" style={iconBtnStyle}><Copy size={15} /></button>
                                            <button onClick={() => handleDelete(p.id)} title="Löschen" style={{ ...iconBtnStyle, color: '#ef4444' }}><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            ) : (
                /* Grid View */
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '100%' : '300px'}, 1fr))`, gap: '16px' }}>
                    {filtered.map(p => (
                        <div
                            key={p.id}
                            onClick={() => navigate(`/renovation/floorplan/${p.id}`)}
                            style={{
                                background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border-color)', padding: '20px', cursor: 'pointer',
                                transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#0ea5e9'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(14,165,233,0.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}
                        >
                            {/* Preview placeholder */}
                            <div style={{ height: '120px', borderRadius: 'var(--radius-md)', background: '#f8fafc', border: '1px solid var(--border-color)', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <PenTool size={32} style={{ opacity: 0.15 }} />
                            </div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>{p.name}</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                {p.propertyLabel}{p.unitLabel ? ` · ${p.unitLabel}` : ''}
                            </div>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                <span>{p.roomCount} Räume</span>
                                <span>{p.totalArea > 0 ? `${mm2ToM2(p.totalArea)} m²` : '—'}</span>
                                <span style={{
                                    padding: '1px 8px', borderRadius: '6px', fontWeight: 600,
                                    background: p.status === 'completed' ? '#dcfce7' : '#f1f5f9',
                                    color: p.status === 'completed' ? '#16a34a' : '#64748b',
                                }}>{p.status === 'completed' ? 'Fertig' : 'Entwurf'}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }} onClick={e => e.stopPropagation()}>
                                <button onClick={() => handleDuplicate(p)} title="Duplizieren" style={iconBtnStyle}><Copy size={14} /></button>
                                <button onClick={() => handleDelete(p.id)} title="Löschen" style={{ ...iconBtnStyle, color: '#ef4444' }}><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const iconBtnStyle = {
    background: 'none', border: 'none', cursor: 'pointer', padding: '6px',
    color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', transition: 'color 0.15s',
};

export default FloorPlanLibrary;
