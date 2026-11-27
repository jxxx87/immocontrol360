import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Search, Loader2, Trash2, Copy, ExternalLink, PenTool,
    LayoutGrid, LayoutList, AlertTriangle
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import { translateError } from '../../lib/errorTranslator';
import { assertWrite } from '../../components/renovation/renovationUtils';
import { mm2ToM2 } from '../../lib/floorplan/constants';

// Für die Liste nur benötigte Spalten laden (u. a. ohne version_history).
// plan_data wird für Räume/Fläche/Geschosse weiterhin gebraucht – eigene Kennzahl-Spalten
// in der Datenbank wären nötig, um auch darauf verzichten zu können.
const PLAN_LIST_COLUMNS = 'id, user_id, name, status, property_id, unit_id, plan_data, created_at, updated_at, property:properties(street, house_number, city), unit:units(unit_name)';

const FloorPlanLibrary = () => {
    const { user } = useAuth();
    const { isMobile } = useViewMode();
    const navigate = useNavigate();

    const [plans, setPlans] = useState([]);
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [busyPlanId, setBusyPlanId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [propertyFilter, setPropertyFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('updated');
    const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'

    // Sichtbarkeit entscheidet die RLS (eigene Pläne + Pläne freigegebener Objekte).
    // Spinner nur beim ersten Laden, spätere Aktualisierungen im Hintergrund.
    const fetchData = async () => {
        const [plansRes, propsRes, unitsRes] = await Promise.all([
            supabase.from('floor_plans')
                .select(PLAN_LIST_COLUMNS)
                .order('updated_at', { ascending: false }),
            supabase.from('properties')
                .select('id, street, house_number, city')
                .order('street'),
            supabase.from('units')
                .select('id, unit_name, property_id')
                .order('unit_name'),
        ]);
        if (plansRes.error) {
            console.error('Error loading floor plans:', plansRes.error);
            setLoadError(translateError(plansRes.error));
        } else {
            setLoadError(null);
            setPlans(plansRes.data || []);
        }
        if (propsRes.error) console.error('Error loading properties:', propsRes.error);
        else setProperties(propsRes.data || []);
        if (unitsRes.error) console.error('Error loading units:', unitsRes.error);
        else setUnits(unitsRes.data || []);
        setLoading(false);
    };

    useEffect(() => {
        if (user) fetchData();
    }, [user]);

    const handleDuplicate = async (plan) => {
        if (busyPlanId) return;
        setBusyPlanId(plan.id);
        try {
            const newPlan = {
                user_id: user.id,
                name: `${plan.name} (Kopie)`,
                property_id: plan.property_id,
                unit_id: plan.unit_id,
                status: 'draft',
                plan_data: plan.plan_data,
            };
            assertWrite(await supabase.from('floor_plans').insert(newPlan).select('id'), 'Duplizieren');
            await fetchData();
        } catch (err) {
            alert('Fehler beim Duplizieren: ' + translateError(err));
        } finally {
            setBusyPlanId(null);
        }
    };

    const handleDelete = async (plan) => {
        if (!window.confirm(`Grundriss „${plan.name}" endgültig löschen?`)) return;
        try {
            assertWrite(await supabase.from('floor_plans').delete().eq('id', plan.id).select('id'), 'Löschen');
            await fetchData();
        } catch (err) {
            alert('Fehler beim Löschen: ' + translateError(err));
        }
    };

    // Zuordnung zur Immobilie bzw. Status direkt in der Bibliothek ändern
    // (der Editor speichert diese Felder nicht).
    const updatePlan = async (plan, fields, what) => {
        if (busyPlanId) return;
        setBusyPlanId(plan.id);
        try {
            assertWrite(await supabase.from('floor_plans').update(fields).eq('id', plan.id).select('id'), what);
            await fetchData();
        } catch (err) {
            alert(`Fehler (${what}): ` + translateError(err));
        } finally {
            setBusyPlanId(null);
        }
    };

    const assignProperty = (plan, propertyId) => {
        const next = propertyId || null;
        if (next === (plan.property_id || null)) return;
        // Einheit gehört zum bisherigen Objekt → Zuordnung zurücksetzen
        updatePlan(plan, { property_id: next, unit_id: null }, 'Immobilie zuordnen');
    };

    const assignUnit = (plan, unitId) => {
        const next = unitId || null;
        if (next === (plan.unit_id || null)) return;
        updatePlan(plan, { unit_id: next }, 'Einheit zuordnen');
    };

    const toggleStatus = (plan) => {
        updatePlan(plan, { status: plan.status === 'completed' ? 'draft' : 'completed' }, 'Status ändern');
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
        if (propertyFilter === 'none') result = result.filter(p => !p.property_id);
        else if (propertyFilter !== 'all') result = result.filter(p => p.property_id === propertyFilter);
        if (statusFilter !== 'all') result = result.filter(p => (p.status || 'draft') === statusFilter);
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

    const resetFilters = () => {
        setSearchTerm('');
        setPropertyFilter('all');
        setStatusFilter('all');
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    const renderPropertySelect = (p) => (
        <select
            value={p.property_id || ''}
            onClick={e => e.stopPropagation()}
            onChange={e => assignProperty(p, e.target.value)}
            disabled={busyPlanId === p.id}
            title="Immobilie zuordnen"
            style={{ maxWidth: '220px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', background: 'var(--surface-color)', color: 'var(--text-secondary)' }}
        >
            <option value="">— keine Immobilie —</option>
            {/* Zugeordnete Immobilie bleibt sichtbar, auch wenn sie nicht in der Liste ist */}
            {p.property_id && !properties.some(pr => pr.id === p.property_id) && (
                <option value={p.property_id}>{p.propertyLabel}</option>
            )}
            {properties.map(pr => (
                <option key={pr.id} value={pr.id}>{pr.street} {pr.house_number}, {pr.city}</option>
            ))}
        </select>
    );

    // Einheit nur innerhalb der zugeordneten Immobilie wählbar
    const renderUnitSelect = (p) => {
        if (!p.property_id) return <span>—</span>;
        const propUnits = units.filter(u => u.property_id === p.property_id);
        if (propUnits.length === 0 && !p.unit_id) return <span>—</span>;
        return (
            <select
                value={p.unit_id || ''}
                onClick={e => e.stopPropagation()}
                onChange={e => assignUnit(p, e.target.value)}
                disabled={busyPlanId === p.id}
                title="Einheit zuordnen"
                style={{ maxWidth: '160px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', background: 'var(--surface-color)', color: 'var(--text-secondary)' }}
            >
                <option value="">— ganzes Objekt —</option>
                {p.unit_id && !propUnits.some(u => u.id === p.unit_id) && (
                    <option value={p.unit_id}>{p.unitLabel || 'Zugeordnete Einheit'}</option>
                )}
                {propUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
            </select>
        );
    };

    const renderStatusBadge = (p, compact = false) => (
        <button
            onClick={e => { e.stopPropagation(); toggleStatus(p); }}
            disabled={busyPlanId === p.id}
            title={p.status === 'completed' ? 'Als Entwurf markieren' : 'Als fertig markieren'}
            style={{
                fontSize: '0.68rem', fontWeight: 600, padding: compact ? '1px 8px' : '2px 8px', borderRadius: compact ? '6px' : '8px',
                background: p.status === 'completed' ? '#dcfce7' : '#f1f5f9',
                color: p.status === 'completed' ? '#16a34a' : '#64748b',
                border: 'none', cursor: 'pointer',
            }}
        >{p.status === 'completed' ? 'Fertig' : 'Entwurf'}</button>
    );

    return (
        <div>
            {/* Ladefehler */}
            {loadError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', marginBottom: '12px', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                    <AlertTriangle size={16} />
                    <span style={{ flex: 1 }}>Grundrisse konnten nicht geladen werden: {loadError}</span>
                    <Button size="sm" variant="secondary" onClick={fetchData}>Erneut laden</Button>
                </div>
            )}

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
                    <option value="none">Ohne Immobilie</option>
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
                loadError ? null : plans.length > 0 ? (
                    /* Pläne vorhanden, aber kein Treffer für die Filter */
                    <Card>
                        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <Search size={36} style={{ margin: '0 auto 12px', opacity: 0.25 }} />
                            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '6px' }}>Keine Grundrisse für die gewählten Filter</p>
                            <p style={{ fontSize: '0.85rem', marginBottom: '16px' }}>Es gibt {plans.length} Grundriss{plans.length === 1 ? '' : 'e'}, aber keiner passt zu Suche, Immobilie oder Status.</p>
                            <Button variant="secondary" onClick={resetFilters}>Filter zurücksetzen</Button>
                        </div>
                    </Card>
                ) : (
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
                )
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
                                            {renderStatusBadge(p)}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{renderPropertySelect(p)}</td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{renderUnitSelect(p)}</td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{p.storeysLabels.join(', ') || '—'}</td>
                                    <td style={{ padding: '12px 14px', fontWeight: 500 }}>{p.roomCount}</td>
                                    <td style={{ padding: '12px 14px', fontWeight: 500 }}>{p.totalArea > 0 ? `${mm2ToM2(p.totalArea)} m²` : '—'}</td>
                                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                                        {new Date(p.updated_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td style={{ padding: '12px 14px' }}>
                                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                                            <button onClick={() => navigate(`/renovation/floorplan/${p.id}`)} title="Öffnen" style={iconBtnStyle}><ExternalLink size={15} /></button>
                                            <button onClick={() => handleDuplicate(p)} disabled={busyPlanId === p.id} title="Duplizieren" style={iconBtnStyle}>
                                                {busyPlanId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                                            </button>
                                            <button onClick={() => handleDelete(p)} title="Löschen" style={{ ...iconBtnStyle, color: '#ef4444' }}><Trash2 size={15} /></button>
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
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {renderPropertySelect(p)}
                                {p.property_id ? renderUnitSelect(p) : null}
                            </div>
                            <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: 'var(--text-secondary)', alignItems: 'center' }}>
                                <span>{p.roomCount} Räume</span>
                                <span>{p.totalArea > 0 ? `${mm2ToM2(p.totalArea)} m²` : '—'}</span>
                                {renderStatusBadge(p, true)}
                            </div>
                            <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }} onClick={e => e.stopPropagation()}>
                                <button onClick={() => handleDuplicate(p)} disabled={busyPlanId === p.id} title="Duplizieren" style={iconBtnStyle}>
                                    {busyPlanId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                                </button>
                                <button onClick={() => handleDelete(p)} title="Löschen" style={{ ...iconBtnStyle, color: '#ef4444' }}><Trash2 size={14} /></button>
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
