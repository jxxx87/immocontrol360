import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    CheckCircle2, Circle, Calendar, Loader2,
    Plus, ClipboardList, Trash2, HardHat, AlertTriangle
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { usePermission } from '../../context/PermissionContext';
import { translateError } from '../../lib/errorTranslator';
import { localDateStr, formatDateDE, assertWrite } from '../../components/renovation/renovationUtils';

const RenovationTasks = ({ onTaskChange } = {}) => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const perm = usePermission();
    const [tasks, setTasks] = useState([]);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingTask, setEditingTask] = useState(null);
    const [saving, setSaving] = useState(false);
    const [busyTaskId, setBusyTaskId] = useState(null);

    // Filters
    const [filterProject, setFilterProject] = useState('all');
    const [filterStatus, setFilterStatus] = useState('open');
    const [filterDue, setFilterDue] = useState('all');

    // Form
    const [form, setForm] = useState({ title: '', description: '', project_id: '', project_trade_id: '', due_date: '' });

    // Callback des Elternteils (Badge-Zähler) ohne erneutes Laden bei jedem Render aktuell halten
    const onTaskChangeRef = useRef(onTaskChange);
    useEffect(() => { onTaskChangeRef.current = onTaskChange; });

    // Lädt Aufgaben und Projekte. Der Lade-Spinner erscheint nur beim ersten Laden;
    // spätere Aktualisierungen laufen im Hintergrund (kein Flackern, Scrollposition bleibt).
    // Sichtbarkeit entscheidet die RLS (eigene Aufgaben + freigegebene Objekte).
    const fetchAll = async () => {
        const [tasksRes, projRes] = await Promise.all([
            supabase.from('renovation_tasks').select(`
                *, project:renovation_projects(name, user_id, property:properties(street, house_number, city, portfolio_id)),
                trade:renovation_project_trades(name)
            `).order('created_at', { ascending: false }),
            supabase.from('renovation_projects').select('id, name, property_id, user_id, property:properties(portfolio_id, portfolio:portfolios(user_id)), trades:renovation_project_trades(id, name)').order('created_at', { ascending: false }),
        ]);
        const err = tasksRes.error || projRes.error;
        if (err) {
            console.error('Error loading renovation tasks:', err);
            setLoadError(translateError(err));
        } else {
            setLoadError(null);
            setTasks(tasksRes.data || []);
            setProjects(projRes.data || []);
        }
        setLoading(false);
        onTaskChangeRef.current?.();
    };

    useEffect(() => { if (user) fetchAll(); }, [user]);

    // Schreibrecht wie die RLS von renovation_tasks (Freigabe „Immobilien“ oder „Investorportal“ mit
    // Schreibrecht am Objekt des Projekts). Solange die Freigaben laden, nicht sperren.
    const canWriteProject = (project) => {
        if (!perm || perm.loadingPermissions) return true;
        const pid = project?.property?.portfolio_id;
        return !!pid && (perm.canWrite('immobilien', pid) || perm.canWrite('investorportal', pid));
    };

    // Gewähltes Portfolio: nur Aufgaben und Projekte zu Objekten dieses Portfolios
    // (ohne Auswahl: alles, was die RLS freigibt)
    const scopedProjects = useMemo(
        () => (selectedPortfolioID ? projects.filter(p => p.property?.portfolio_id === selectedPortfolioID) : projects),
        [projects, selectedPortfolioID]
    );
    const scopedTasks = useMemo(
        () => (selectedPortfolioID ? tasks.filter(t => t.project?.property?.portfolio_id === selectedPortfolioID) : tasks),
        [tasks, selectedPortfolioID]
    );
    // Neue Aufgaben nur in Projekten mit Schreibrecht
    const writableProjects = scopedProjects.filter(canWriteProject);

    // Portfolio gewechselt: Projekt-Filter passt nicht mehr
    useEffect(() => { setFilterProject('all'); }, [selectedPortfolioID]);

    const filtered = useMemo(() => {
        // Datumsvergleich als lokaler Kalendertag ('YYYY-MM-DD'), nicht als UTC-Zeitpunkt
        const now = new Date();
        const mondayOffset = (now.getDay() + 6) % 7; // Mo=0 … So=6
        const weekStartStr = localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset));
        const weekEndStr = localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - mondayOffset)));
        return scopedTasks.filter(t => {
            if (filterProject !== 'all' && t.project_id !== filterProject) return false;
            if (filterStatus === 'open' && t.is_completed) return false;
            if (filterStatus === 'done' && !t.is_completed) return false;
            if (filterDue === 'week') {
                const due = t.due_date ? String(t.due_date).slice(0, 10) : '';
                if (!due || due < weekStartStr || due > weekEndStr) return false;
            }
            return true;
        });
    }, [scopedTasks, filterProject, filterStatus, filterDue]);

    const toggleTask = async (task) => {
        if (busyTaskId || !canWriteProject(task.project)) return;
        setBusyTaskId(task.id);
        try {
            const is_completed = !task.is_completed;
            assertWrite(await supabase.from('renovation_tasks').update({
                is_completed, completed_at: is_completed ? new Date().toISOString() : null
            }).eq('id', task.id).select('id'), 'Aufgabe aktualisieren');
            await fetchAll();
        } catch (err) {
            alert('Fehler beim Aktualisieren der Aufgabe: ' + translateError(err));
        } finally {
            setBusyTaskId(null);
        }
    };

    const deleteTask = async (id) => {
        if (!window.confirm('Aufgabe löschen?')) return;
        try {
            assertWrite(await supabase.from('renovation_tasks').delete().eq('id', id).select('id'), 'Aufgabe löschen');
            await fetchAll();
        } catch (err) {
            alert('Fehler beim Löschen der Aufgabe: ' + translateError(err));
        }
    };

    const openAdd = () => {
        setEditingTask(null);
        setForm({ title: '', description: '', project_id: writableProjects[0]?.id || '', project_trade_id: '', due_date: '' });
        setShowModal(true);
    };

    const openEdit = (task) => {
        if (!canWriteProject(task.project)) return; // nur Leserecht: keine Bearbeitung
        setEditingTask(task);
        setForm({
            title: task.title, description: task.description || '',
            project_id: task.project_id, project_trade_id: task.project_trade_id || '',
            due_date: task.due_date || '',
        });
        setShowModal(true);
    };

    const saveTask = async () => {
        if (saving) return;
        if (!form.title?.trim() || !form.project_id) return alert('Titel und Projekt sind erforderlich.');
        const selProject = projects.find(p => p.id === form.project_id);
        // property_id aus dem Projekt übernehmen (Grundlage der Team-Freigabe per RLS).
        // Ist das Projekt nicht in der Liste, bleibt ein vorhandener Wert beim Bearbeiten erhalten.
        const propertyId = selProject?.property_id || (editingTask?.project_id === form.project_id ? editingTask?.property_id : null) || null;
        const payload = {
            title: form.title.trim(),
            description: form.description || null,
            project_id: form.project_id,
            property_id: propertyId,
            project_trade_id: form.project_trade_id || null,
            due_date: form.due_date || null,
        };
        setSaving(true);
        try {
            if (editingTask) {
                // user_id beim Bearbeiten nicht überschreiben (Zuordnung bleibt erhalten)
                assertWrite(await supabase.from('renovation_tasks').update(payload).eq('id', editingTask.id).select('id'), 'Aufgabe speichern');
            } else {
                // user_id = Portfolio-Eigentümer bzw. Eigentümer des Projekts, nicht das Konto eines
                // Teammitglieds (ON DELETE CASCADE); beides lässt die Datenbank zu (rls_user_ok).
                // Den Ersteller hält die Datenbank in renovation_tasks.created_by fest.
                const dataOwner = selProject?.property?.portfolio?.user_id || selProject?.user_id || user.id;
                assertWrite(await supabase.from('renovation_tasks').insert({ ...payload, user_id: dataOwner }).select('id'), 'Aufgabe anlegen');
            }
            setShowModal(false);
            await fetchAll();
        } catch (err) {
            alert('Fehler beim Speichern der Aufgabe: ' + translateError(err));
        } finally {
            setSaving(false);
        }
    };

    const selectedProjectTrades = useMemo(() => {
        const proj = projects.find(p => p.id === form.project_id);
        return proj?.trades || [];
    }, [form.project_id, projects]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin" /></div>;

    const todayStr = localDateStr();

    return (
        <div>
            {/* Ladefehler */}
            {loadError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', marginBottom: '12px', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                    <AlertTriangle size={16} />
                    <span style={{ flex: 1 }}>Aufgaben konnten nicht geladen werden: {loadError}</span>
                    <Button size="sm" variant="secondary" onClick={fetchAll}>Erneut laden</Button>
                </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.85rem', background: 'var(--surface-color)' }}>
                    <option value="all">Alle Projekte</option>
                    {scopedProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.85rem', background: 'var(--surface-color)' }}>
                    <option value="open">Offen</option>
                    <option value="done">Erledigt</option>
                    <option value="all">Alle</option>
                </select>
                <select value={filterDue} onChange={e => setFilterDue(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.85rem', background: 'var(--surface-color)' }}>
                    <option value="all">Alle Termine</option>
                    <option value="week">Fällig diese Woche</option>
                </select>
                <div style={{ flex: 1 }} />
                {writableProjects.length > 0 && <Button icon={Plus} size="sm" onClick={openAdd}>Aufgabe</Button>}
            </div>

            {/* Task List */}
            {filtered.length === 0 ? (
                !loadError && (
                    <Card>
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <ClipboardList size={36} style={{ opacity: 0.3, margin: '0 auto 10px' }} />
                            <p style={{ fontWeight: 600 }}>Keine Aufgaben</p>
                        </div>
                    </Card>
                )
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {filtered.map(t => {
                        const due = t.due_date ? String(t.due_date).slice(0, 10) : '';
                        // Überfällig erst ab dem Folgetag (heute fällige Aufgaben sind nicht überfällig)
                        const isOverdue = !!due && !t.is_completed && due < todayStr;
                        const editable = canWriteProject(t.project);
                        return (
                            <div
                                key={t.id}
                                style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                                    padding: '12px 14px', borderRadius: 'var(--radius-md)',
                                    background: 'var(--surface-color)', border: `1px solid ${isOverdue ? '#fca5a5' : 'var(--border-color)'}`,
                                    cursor: editable ? 'pointer' : 'default', transition: 'border-color 0.15s',
                                }}
                                onClick={() => openEdit(t)}
                                title={editable ? undefined : 'Nur Leserecht'}
                            >
                                <button
                                    onClick={e => { e.stopPropagation(); toggleTask(t); }}
                                    disabled={busyTaskId === t.id || !editable}
                                    style={{ background: 'none', border: 'none', cursor: editable ? 'pointer' : 'default', padding: '2px', flexShrink: 0, marginTop: '1px' }}
                                >
                                    {busyTaskId === t.id
                                        ? <Loader2 size={20} className="animate-spin" color="var(--text-secondary)" />
                                        : t.is_completed ? <CheckCircle2 size={20} color="#16a34a" /> : <Circle size={20} color="var(--border-color)" />}
                                </button>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', textDecoration: t.is_completed ? 'line-through' : 'none', opacity: t.is_completed ? 0.5 : 1 }}>
                                        {t.title}
                                    </div>
                                    {t.description && (
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', opacity: t.is_completed ? 0.4 : 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                                            {t.description.length > 80 ? t.description.substring(0, 80) + '…' : t.description}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '12px', fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px', flexWrap: 'wrap' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                            <HardHat size={12} /> {t.project?.name || '—'}
                                        </span>
                                        {t.trade?.name && <span>• {t.trade.name}</span>}
                                        {due && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: isOverdue ? '#dc2626' : 'inherit', fontWeight: isOverdue ? 700 : 400 }}>
                                                <Calendar size={12} /> {formatDateDE(due)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {editable && (
                                    <button onClick={e => { e.stopPropagation(); deleteTask(t.id); }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add/Edit Modal */}
            <Modal isOpen={showModal} onClose={() => { if (!saving) setShowModal(false); }} title={editingTask ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
                footer={<><Button variant="secondary" onClick={() => setShowModal(false)} disabled={saving}>Abbrechen</Button><Button onClick={saveTask} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : 'Speichern'}</Button></>}
            >
                <Input label="Titel" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Aufgabe beschreiben..." />
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>Projekt</label>
                    <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, project_trade_id: '' })}
                        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}>
                        <option value="">Projekt wählen</option>
                        {writableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                {selectedProjectTrades.length > 0 && (
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>Gewerk (optional)</label>
                        <select value={form.project_trade_id} onChange={e => setForm({ ...form, project_trade_id: e.target.value })}
                            style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}>
                            <option value="">Kein Gewerk</option>
                            {selectedProjectTrades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </div>
                )}
                <Input label="Fälligkeitsdatum (optional)" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>Beschreibung (optional)</label>
                    <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                        rows={3} placeholder="Weitere Details..."
                        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', resize: 'vertical', outline: 'none' }} />
                </div>
            </Modal>
        </div>
    );
};

export default RenovationTasks;
