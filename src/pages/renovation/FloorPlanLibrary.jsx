import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, Search, Loader2, Trash2, Copy, ExternalLink, PenTool,
    LayoutGrid, LayoutList, AlertTriangle, History
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import { translateError } from '../../lib/errorTranslator';
import { assertWrite } from '../../components/renovation/renovationUtils';
import { mm2ToM2 } from '../../lib/floorplan/constants';
import {
    isStoredBackground, collectBackgroundPaths, retargetBackgroundPath,
    listPlanBackgroundPaths, removeBackgroundObjects, copyBackgroundObject,
} from '../../lib/floorplan/planBackgrounds';
import {
    normalizeVersionHistory, createVersionEntry, addVersionEntry, restoreVersionPlanData, summarizePlanData,
} from '../../lib/floorplan/planVersions';

// Für die Liste nur Kennzahlen laden: room_count, total_area_mm2 und storey_labels berechnet
// die Datenbank aus plan_data (generierte Spalten). plan_data selbst (Geometrie, ältere
// Pläne mit eingebetteten Hintergrundbildern) wird nur beim Öffnen/Duplizieren geladen.
const PLAN_LIST_COLUMNS = 'id, user_id, name, status, property_id, unit_id, room_count, total_area_mm2, storey_labels, created_at, updated_at, property:properties(street, house_number, city), unit:units(unit_name)';
// Rückfall, solange die Kennzahl-Spalten in der Datenbank noch fehlen
const PLAN_LIST_COLUMNS_LEGACY = 'id, user_id, name, status, property_id, unit_id, plan_data, created_at, updated_at, property:properties(street, house_number, city), unit:units(unit_name)';
const isMissingColumnError = (err) => err?.code === '42703' || /room_count|total_area_mm2|storey_labels/.test(err?.message || '');

const formatDateTimeDE = (value) => {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Geschoss ohne Hintergrundbild (für Kopien, deren Bild noch nicht kopiert ist)
const withoutBackground = (storey) => {
    if (!storey || typeof storey !== 'object') return storey;
    const { bgImage: _bgImage, ...rest } = storey;
    return rest;
};

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
    // Versionen eines Plans: { plan, loading, error, entries, current, restoring }
    const [versionDialog, setVersionDialog] = useState(null);

    // Sichtbarkeit entscheidet die RLS (eigene Pläne + Pläne freigegebener Objekte).
    // Spinner nur beim ersten Laden, spätere Aktualisierungen im Hintergrund.
    const fetchData = async () => {
        const loadPlans = (columns) => supabase.from('floor_plans')
            .select(columns)
            .order('updated_at', { ascending: false });
        const [firstPlansRes, propsRes, unitsRes] = await Promise.all([
            loadPlans(PLAN_LIST_COLUMNS),
            supabase.from('properties')
                .select('id, street, house_number, city')
                .order('street'),
            supabase.from('units')
                .select('id, unit_name, property_id')
                .order('unit_name'),
        ]);
        let plansRes = firstPlansRes;
        if (plansRes.error && isMissingColumnError(plansRes.error)) {
            plansRes = await loadPlans(PLAN_LIST_COLUMNS_LEGACY);
        }
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

    // Duplizieren: plan_data wird erst hier geladen (nicht in der Liste). Hintergrundbilder im
    // Dateispeicher werden in den Ordner der Kopie kopiert; eingebettete (ältere) Bilder
    // gehen wie bisher mit plan_data mit.
    const handleDuplicate = async (plan) => {
        if (busyPlanId) return;
        setBusyPlanId(plan.id);
        try {
            const { data: source, error: sourceError } = await supabase
                .from('floor_plans').select('plan_data').eq('id', plan.id).single();
            if (sourceError) throw sourceError;
            const planData = Array.isArray(source?.plan_data) ? source.plan_data : [];
            const hasStoredBg = collectBackgroundPaths(planData).length > 0;
            const newPlan = {
                user_id: user.id,
                name: `${plan.name} (Kopie)`,
                property_id: plan.property_id,
                unit_id: plan.unit_id,
                status: 'draft',
                // Bild-Pfade zeigen in den Ordner des Originals → erst nach dem Kopieren eintragen
                plan_data: hasStoredBg ? planData.map(s => (isStoredBackground(s?.bgImage) ? withoutBackground(s) : s)) : planData,
            };
            const inserted = assertWrite(await supabase.from('floor_plans').insert(newPlan).select('id'), 'Duplizieren');
            const newId = inserted?.[0]?.id;
            if (hasStoredBg && newId) {
                let failed = 0;
                const copied = [];
                for (const s of planData) {
                    if (!isStoredBackground(s?.bgImage)) { copied.push(s); continue; }
                    try {
                        const target = retargetBackgroundPath(s.bgImage.path, newId);
                        await copyBackgroundObject(supabase.storage, s.bgImage.path, target);
                        copied.push({ ...s, bgImage: { ...s.bgImage, path: target } });
                    } catch {
                        failed += 1;
                        copied.push(withoutBackground(s));
                    }
                }
                if (failed < collectBackgroundPaths(planData).length) {
                    assertWrite(await supabase.from('floor_plans').update({ plan_data: copied }).eq('id', newId).select('id'), 'Hintergrundbilder übernehmen');
                }
                if (failed > 0) {
                    alert(`Die Kopie wurde angelegt, aber ${failed === 1 ? 'ein Hintergrundbild konnte' : `${failed} Hintergrundbilder konnten`} nicht kopiert werden.`);
                }
            }
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
            // Hintergrundbilder im Dateispeicher zuerst entfernen (danach erlaubt der Speicher
            // keinen Zugriff mehr, weil die Berechtigung am Grundriss hängt)
            try {
                const paths = await listPlanBackgroundPaths(supabase.storage, plan.id);
                await removeBackgroundObjects(supabase.storage, paths);
            } catch {
                // Kein Dateispeicher oder keine Bilder – der Grundriss wird trotzdem gelöscht
            }
            assertWrite(await supabase.from('floor_plans').delete().eq('id', plan.id).select('id'), 'Löschen');
            await fetchData();
        } catch (err) {
            alert('Fehler beim Löschen: ' + translateError(err));
        }
    };

    // ─── Frühere Stände (version_history, vom Editor beim ersten Speichern je Sitzung angelegt) ───
    const openVersions = async (plan) => {
        setVersionDialog({ plan, loading: true, error: null, entries: [], current: null, restoring: false });
        const { data, error } = await supabase
            .from('floor_plans').select('plan_data, version_history, updated_at').eq('id', plan.id).single();
        if (error || !data) {
            setVersionDialog(prev => (prev?.plan.id === plan.id
                ? { ...prev, loading: false, error: translateError(error || 'Grundriss nicht gefunden.') }
                : prev));
            return;
        }
        setVersionDialog(prev => (prev?.plan.id === plan.id
            ? { ...prev, loading: false, entries: normalizeVersionHistory(data.version_history), current: data }
            : prev));
    };

    const restoreVersion = async (entry) => {
        const dlg = versionDialog;
        if (!dlg?.current || dlg.restoring) return;
        const label = formatDateTimeDE(entry.stand || entry.archived_at);
        if (!window.confirm(`Stand vom ${label} wiederherstellen?\nDer aktuelle Stand wird vorher als Version gesichert. Hintergrundbilder bleiben erhalten.`)) return;
        setVersionDialog(prev => (prev ? { ...prev, restoring: true } : prev));
        try {
            const current = dlg.current;
            const nextHistory = addVersionEntry(
                dlg.entries,
                createVersionEntry(current.plan_data, { stand: current.updated_at, name: dlg.plan.name }),
            );
            // Nur übernehmen, wenn der Plan seit dem Öffnen dieses Dialogs nicht gespeichert wurde
            let query = supabase.from('floor_plans').update({
                plan_data: restoreVersionPlanData(current.plan_data, entry.plan_data),
                version_history: nextHistory,
                updated_at: new Date().toISOString(),
            }).eq('id', dlg.plan.id);
            if (current.updated_at) query = query.eq('updated_at', current.updated_at);
            const { data, error } = await query.select('id');
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Der Grundriss wurde inzwischen geändert oder Sie haben keine Schreibrechte. Bitte den Dialog neu öffnen.');
            }
            setVersionDialog(null);
            await fetchData();
        } catch (err) {
            setVersionDialog(prev => (prev ? { ...prev, restoring: false } : prev));
            alert('Fehler beim Wiederherstellen: ' + translateError(err));
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
            let roomCount = 0;
            let totalArea = 0;
            let storeysLabels = [];
            if (Array.isArray(p.plan_data)) {
                // Rückfall ohne Kennzahl-Spalten: aus plan_data rechnen (gleiche Regeln wie die DB)
                p.plan_data.forEach(s => {
                    const rooms = Array.isArray(s?.rooms) ? s.rooms : [];
                    roomCount += rooms.length;
                    rooms.forEach(r => { if (Number.isFinite(r?.area_mm2)) totalArea += r.area_mm2; });
                    storeysLabels.push(s?.label || '?');
                });
            } else {
                roomCount = Number(p.room_count) || 0;
                totalArea = Number(p.total_area_mm2) || 0;
                storeysLabels = Array.isArray(p.storey_labels) ? p.storey_labels : [];
            }
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
                                            <button onClick={() => openVersions(p)} title="Frühere Stände" style={iconBtnStyle}><History size={15} /></button>
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
                                <button onClick={() => openVersions(p)} title="Frühere Stände" style={iconBtnStyle}><History size={14} /></button>
                                <button onClick={() => handleDelete(p)} title="Löschen" style={{ ...iconBtnStyle, color: '#ef4444' }}><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Frühere Stände */}
            <Modal
                isOpen={!!versionDialog}
                onClose={() => { if (!versionDialog?.restoring) setVersionDialog(null); }}
                title={versionDialog ? `Frühere Stände – ${versionDialog.plan.name}` : 'Frühere Stände'}
                maxWidth="560px"
            >
                {versionDialog?.loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}><Loader2 className="animate-spin" size={22} /></div>
                ) : versionDialog?.error ? (
                    <p style={{ color: '#b91c1c', fontSize: '0.88rem' }}>Die Stände konnten nicht geladen werden: {versionDialog.error}</p>
                ) : versionDialog && versionDialog.entries.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                        Noch keine früheren Stände vorhanden. Beim ersten Speichern nach dem Öffnen im Editor wird der vorherige Stand automatisch gesichert (die letzten 5 Stände bleiben erhalten).
                    </p>
                ) : versionDialog ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0 }}>
                            Gesichert werden Wände, Räume, Öffnungen, Möbel und Anmerkungen. Hintergrundbilder bleiben beim Wiederherstellen unverändert.
                        </p>
                        {versionDialog.entries.map((entry, idx) => {
                            const info = summarizePlanData(entry.plan_data);
                            return (
                                <div key={`${entry.archived_at || ''}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Stand vom {formatDateTimeDE(entry.stand || entry.archived_at)}</div>
                                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                            {info.storeys} Geschoss{info.storeys === 1 ? '' : 'e'} · {info.rooms} Räume · {info.walls} Wände · gesichert am {formatDateTimeDE(entry.archived_at)}
                                        </div>
                                    </div>
                                    <Button size="sm" variant="secondary" disabled={versionDialog.restoring} onClick={() => restoreVersion(entry)}>
                                        Wiederherstellen
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                ) : null}
            </Modal>
        </div>
    );
};

const iconBtnStyle = {
    background: 'none', border: 'none', cursor: 'pointer', padding: '6px',
    color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', transition: 'color 0.15s',
};

export default FloorPlanLibrary;
