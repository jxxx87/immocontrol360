import React, { useState, useEffect, useMemo } from 'react';
import {
    CheckCircle2, Circle, Calendar, Building2, Loader2,
    Plus, Filter, ClipboardList, Trash2, HardHat
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';

const RenovationTasks = ({ onTaskChange } = {}) => {
    const { user } = useAuth();
    const { isMobile } = useViewMode();
    const [tasks, setTasks] = useState([]);
    const [projects, setProjects] = useState([]);
    const [trades, setTrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingTask, setEditingTask] = useState(null);

    // Filters
    const [filterProject, setFilterProject] = useState('all');
    const [filterStatus, setFilterStatus] = useState('open');
    const [filterDue, setFilterDue] = useState('all');

    // Form
    const [form, setForm] = useState({ title: '', description: '', project_id: '', project_trade_id: '', due_date: '' });

    useEffect(() => { if (user) fetchAll(); }, [user]);

    const fetchAll = async () => {
        setLoading(true);
        const [tasksRes, projRes] = await Promise.all([
            supabase.from('renovation_tasks').select(`
                *, project:renovation_projects(name, property:properties(street, house_number, city)),
                trade:renovation_project_trades(name)
            `).eq('user_id', user.id).order('created_at', { ascending: false }),
            supabase.from('renovation_projects').select('id, name, trades:renovation_project_trades(id, name)').eq('user_id', user.id),
        ]);
        setTasks(tasksRes.data || []);
        setProjects(projRes.data || []);
        setLoading(false);
        if (onTaskChange) onTaskChange();
    };

    const filtered = useMemo(() => {
        const now = new Date();
        const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + (7 - now.getDay()));
        return tasks.filter(t => {
            if (filterProject !== 'all' && t.project_id !== filterProject) return false;
            if (filterStatus === 'open' && t.is_completed) return false;
            if (filterStatus === 'done' && !t.is_completed) return false;
            if (filterDue === 'week' && (!t.due_date || new Date(t.due_date) > weekEnd)) return false;
            return true;
        });
    }, [tasks, filterProject, filterStatus, filterDue]);

    const toggleTask = async (task) => {
        const is_completed = !task.is_completed;
        await supabase.from('renovation_tasks').update({
            is_completed, completed_at: is_completed ? new Date().toISOString() : null
        }).eq('id', task.id);
        fetchAll();
    };

    const deleteTask = async (id) => {
        if (!window.confirm('Aufgabe löschen?')) return;
        await supabase.from('renovation_tasks').delete().eq('id', id);
        fetchAll();
    };

    const openAdd = () => {
        setEditingTask(null);
        setForm({ title: '', description: '', project_id: projects[0]?.id || '', project_trade_id: '', due_date: '' });
        setShowModal(true);
    };

    const openEdit = (task) => {
        setEditingTask(task);
        setForm({
            title: task.title, description: task.description || '',
            project_id: task.project_id, project_trade_id: task.project_trade_id || '',
            due_date: task.due_date || '',
        });
        setShowModal(true);
    };

    const saveTask = async () => {
        if (!form.title || !form.project_id) return alert('Titel und Projekt sind erforderlich.');
        const selProject = projects.find(p => p.id === form.project_id);
        const payload = {
            user_id: user.id,
            title: form.title,
            description: form.description || null,
            project_id: form.project_id,
            property_id: selProject?.property_id || null,
            project_trade_id: form.project_trade_id || null,
            due_date: form.due_date || null,
        };
        if (editingTask) {
            await supabase.from('renovation_tasks').update(payload).eq('id', editingTask.id);
        } else {
            await supabase.from('renovation_tasks').insert(payload);
        }
        setShowModal(false);
        fetchAll();
    };

    const selectedProjectTrades = useMemo(() => {
        const proj = projects.find(p => p.id === form.project_id);
        return proj?.trades || [];
    }, [form.project_id, projects]);

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.85rem', background: 'var(--surface-color)' }}>
                    <option value="all">Alle Projekte</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                <Button icon={Plus} size="sm" onClick={openAdd}>Aufgabe</Button>
            </div>

            {/* Task List */}
            {filtered.length === 0 ? (
                <Card>
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <ClipboardList size={36} style={{ opacity: 0.3, margin: '0 auto 10px' }} />
                        <p style={{ fontWeight: 600 }}>Keine Aufgaben</p>
                    </div>
                </Card>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {filtered.map(t => {
                        const isOverdue = t.due_date && !t.is_completed && new Date(t.due_date) < new Date();
                        return (
                            <div
                                key={t.id}
                                style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                                    padding: '12px 14px', borderRadius: 'var(--radius-md)',
                                    background: 'var(--surface-color)', border: `1px solid ${isOverdue ? '#fca5a5' : 'var(--border-color)'}`,
                                    cursor: 'pointer', transition: 'border-color 0.15s',
                                }}
                                onClick={() => openEdit(t)}
                            >
                                <button
                                    onClick={e => { e.stopPropagation(); toggleTask(t); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0, marginTop: '1px' }}
                                >
                                    {t.is_completed ? <CheckCircle2 size={20} color="#16a34a" /> : <Circle size={20} color="var(--border-color)" />}
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
                                        {t.due_date && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: isOverdue ? '#dc2626' : 'inherit', fontWeight: isOverdue ? 700 : 400 }}>
                                                <Calendar size={12} /> {new Date(t.due_date).toLocaleDateString('de-DE')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button onClick={e => { e.stopPropagation(); deleteTask(t.id); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add/Edit Modal */}
            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingTask ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
                footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>Abbrechen</Button><Button onClick={saveTask}>Speichern</Button></>}
            >
                <Input label="Titel" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Aufgabe beschreiben..." />
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '4px' }}>Projekt</label>
                    <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, project_trade_id: '' })}
                        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem', background: 'var(--surface-color)' }}>
                        <option value="">Projekt wählen</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
