import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Check, Trash2, Plus, Upload, Settings as SettingsIcon, Clock, AlertTriangle, FileText, Droplets, Sparkles, X, Eye } from 'lucide-react';
import Button from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { useViewMode } from '../context/ViewModeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { usePdfTemplate, fetchPdfTemplate } from '../lib/usePdfTemplate';

// ── Constants ────────────────────────────────────────────────
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAY_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const CLEANING_FREQ = [
    { value: 'monthly', label: '1× pro Monat' },
    { value: 'bimonthly', label: '2× pro Monat' },
    { value: 'weekly4', label: '4× pro Monat' },
    { value: 'weekly', label: 'Wöchentlich' },
];
const WEEKDAY_OPTS = [
    { value: 1, label: 'Montag' }, { value: 2, label: 'Dienstag' }, { value: 3, label: 'Mittwoch' },
    { value: 4, label: 'Donnerstag' }, { value: 5, label: 'Freitag' }, { value: 6, label: 'Samstag' }, { value: 0, label: 'Sonntag' },
];
const WASTE_TYPES = [
    { key: 'restmuell', label: 'Restmüll', color: '#6B7280' },
    { key: 'bio', label: 'Bio', color: '#22C55E' },
    { key: 'papier', label: 'Papier', color: '#3B82F6' },
    { key: 'gelbe_tonne', label: 'Gelbe Tonne', color: '#EAB308' },
    { key: 'sonstiger', label: 'Sonstiger', color: '#A855F7' },
];
const EC = { cleaning: '#3B82F6', waste: '#F97316', custom: '#8B5CF6', done: '#22C55E', overdue: '#EF4444' };

// ── Helpers ──────────────────────────────────────────────────
const toIso = (d) => { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const getMondayOfWeek = (d) => { const date = new Date(d); const day = date.getDay(); date.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); return date; };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isOverdue = (eventDate) => { const end = new Date(eventDate); end.setDate(end.getDate() + 2); end.setHours(0, 0, 0, 0); return new Date() >= end; };
const evColor = (e) => e.status === 'done' ? EC.done : (e.event_type === 'cleaning' ? EC.cleaning : e.event_type === 'waste' ? (e.color || EC.waste) : (e.color || EC.custom));

const parseIcs = (text) => {
    const events = [];
    const blocks = text.split('BEGIN:VEVENT');
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0];
        const summary = block.match(/SUMMARY[^:]*:(.*)/)?.[1]?.trim() || '';
        const dtStart = block.match(/DTSTART[^:]*:(\d{8})/)?.[1];
        if (!dtStart) continue;
        const date = `${dtStart.slice(0, 4)}-${dtStart.slice(4, 6)}-${dtStart.slice(6, 8)}`;
        let wt = 'sonstiger'; const l = summary.toLowerCase();
        if (l.includes('rest')) wt = 'restmuell'; else if (l.includes('bio')) wt = 'bio'; else if (l.includes('papier')) wt = 'papier'; else if (l.includes('gelb') || l.includes('wertstoff')) wt = 'gelbe_tonne';
        events.push({ date, title: summary, wasteType: wt });
    }
    return events;
};

const generateCleaningEvents = (year, units, settings) => {
    if (!settings.cleaning_active || settings.cleaning_performer === 'janitor' || !units.length) return [];
    const events = []; const freq = settings.cleaning_frequency; const weekday = settings.cleaning_weekday;
    let unitIdx = 0; let current = new Date(year, 0, 1);
    while (current.getDay() !== weekday) current = addDays(current, 1);
    while (current.getFullYear() === year) {
        const unit = units[unitIdx % units.length];
        events.push({ event_type: 'cleaning', title: 'Treppenhausreinigung', event_date: toIso(current), assigned_unit_id: unit.id, assigned_unit_name: unit.unit_name, color: EC.cleaning, status: 'pending' });
        unitIdx++;
        if (freq === 'weekly') current = addDays(current, 7); else if (freq === 'weekly4' || freq === 'bimonthly') current = addDays(current, 14); else current = addDays(current, 28);
    }
    return events;
};

// ── Glass style helpers ──────────────────────────────────────
const glass = { background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--glass-shadow)' };
const glassCard = (extra = {}) => ({ ...glass, padding: '20px', ...extra });
const glassBlue = (extra = {}) => ({ ...glass, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)', ...extra });

// ══════════════════════════════════════════════════════════════
const ObjectCalendar = () => {
    const { user, userRole, roleData } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const { isMobile } = useViewMode();
    const { checkFeatureAccess } = useSubscription();
    const pdfTemplate = usePdfTemplate('immobilien');
    const isInvestor = userRole !== 'tenant';

    const [properties, setProperties] = useState([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState(null);
    const [units, setUnits] = useState([]);
    const [settings, setSettings] = useState(null);
    const [events, setEvents] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tab, setTab] = useState('year');
    const [showSettings, setShowSettings] = useState(false);
    const [weekOffset, setWeekOffset] = useState(0);
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [taskForm, setTaskForm] = useState({ title: '', color: '#8B5CF6', recurring: false, recurrence_rule: 'weekly', assigned_unit_id: '', push_enabled: false, event_date: toIso(new Date()) });
    const [selectedMonth, setSelectedMonth] = useState(null); // expanded month in year view
    const [selectedDay, setSelectedDay] = useState(null); // clicked day ISO string
    const [deleteConfirm, setDeleteConfirm] = useState(null); // event to confirm delete
    const [mobileMonth, setMobileMonth] = useState(new Date().getMonth()); // 0-11 for mobile month nav
    const fileInputRef = useRef(null);

    const currentYear = new Date().getFullYear();
    const today = toIso(new Date());
    const tenantUnitId = roleData?.unit_id || null;

    // ── Fetch Properties ─────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        const go = async () => {
            if (isInvestor) {
                let q = supabase.from('properties').select('id, street, house_number, portfolio_id').order('street');
                if (selectedPortfolioID) q = q.eq('portfolio_id', selectedPortfolioID);
                const { data } = await q;
                setProperties(data || []);
                if (data?.length && !selectedPropertyId) setSelectedPropertyId(data[0].id);
            } else {
                // Tenant: use roleData property
                const pid = roleData?.property_id;
                if (pid) {
                    const { data } = await supabase.from('properties').select('id, street, house_number, portfolio_id').eq('id', pid).single();
                    if (data) { setProperties([data]); setSelectedPropertyId(data.id); }
                }
            }
        };
        go();
    }, [user, selectedPortfolioID, roleData]);

    // ── Load data ────────────────────────────────────────────
    useEffect(() => {
        if (!user || !selectedPropertyId) return;
        const load = async () => {
            setLoading(true);
            const { data: uData } = await supabase.from('units').select('id, unit_name, floor').eq('property_id', selectedPropertyId).order('unit_name');
            setUnits(uData || []);
            const { data: sData } = await supabase.from('objektkalender_settings').select('*').eq('property_id', selectedPropertyId).maybeSingle();
            setSettings(sData || { cleaning_active: false, cleaning_performer: 'tenant', cleaning_frequency: 'monthly', cleaning_weekday: 1, waste_active: false, waste_performer: 'tenant' });
            const { data: eData } = await supabase.from('objektkalender_events').select('*').eq('property_id', selectedPropertyId).gte('event_date', `${currentYear}-01-01`).lte('event_date', `${currentYear}-12-31`).order('event_date');
            setEvents(eData || []);
            const { data: hData } = await supabase.from('objektkalender_history').select('*').eq('property_id', selectedPropertyId).order('event_date', { ascending: false }).limit(100);
            setHistory(hData || []);
            setLoading(false);
        };
        load();
    }, [user, selectedPropertyId, currentYear]);

    // ── Save Settings ────────────────────────────────────────
    const handleSaveSettings = async () => {
        if (!user || !selectedPropertyId) return;
        setSaving(true);
        const payload = { ...settings, user_id: user.id, property_id: selectedPropertyId, updated_at: new Date().toISOString() };
        const { error } = await supabase.from('objektkalender_settings').upsert(payload, { onConflict: 'user_id,property_id' });
        if (!error && settings.cleaning_active && settings.cleaning_performer === 'tenant') {
            await supabase.from('objektkalender_events').delete().eq('user_id', user.id).eq('property_id', selectedPropertyId).eq('event_type', 'cleaning').gte('event_date', `${currentYear}-01-01`).lte('event_date', `${currentYear}-12-31`);
            const ne = generateCleaningEvents(currentYear, units, settings);
            if (ne.length) await supabase.from('objektkalender_events').insert(ne.map(e => ({ ...e, user_id: user.id, property_id: selectedPropertyId })));
            const { data } = await supabase.from('objektkalender_events').select('*').eq('property_id', selectedPropertyId).eq('user_id', user.id).gte('event_date', `${currentYear}-01-01`).lte('event_date', `${currentYear}-12-31`).order('event_date');
            setEvents(data || []);
        }
        setSaving(false); setShowSettings(false);
    };

    const handleMarkDone = async (event) => {
        const now = new Date().toISOString();
        await supabase.from('objektkalender_events').update({ status: 'done', completed_at: now, completed_by: user.id }).eq('id', event.id);
        await supabase.from('objektkalender_history').insert({ user_id: user.id, property_id: selectedPropertyId, event_id: event.id, event_type: event.event_type, title: event.title, event_date: event.event_date, assigned_unit_name: event.assigned_unit_name, status: 'done', completed_at: now, completed_by: user.id });
        setEvents(prev => prev.map(e => e.id === event.id ? { ...e, status: 'done', completed_at: now } : e));
    };

    const handleDeleteEvent = async (event) => {
        setDeleteConfirm(event);
    };

    const executeDelete = async (mode) => {
        const event = deleteConfirm;
        if (!event) return;
        if (mode === 'single') {
            await supabase.from('objektkalender_events').delete().eq('id', event.id);
            setEvents(prev => prev.filter(e => e.id !== event.id));
        } else if (mode === 'future') {
            // Delete this + all future events with same title & type
            await supabase.from('objektkalender_events').delete()
                .eq('property_id', selectedPropertyId)
                .eq('event_type', event.event_type)
                .eq('title', event.title)
                .gte('event_date', event.event_date);
            setEvents(prev => prev.filter(e => !(e.event_type === event.event_type && e.title === event.title && e.event_date >= event.event_date)));
        }
        setDeleteConfirm(null);
    };

    const handleAddTask = async () => {
        if (!taskForm.title.trim()) return;
        const unit = units.find(u => u.id === taskForm.assigned_unit_id);
        const payload = { user_id: user.id, property_id: selectedPropertyId, event_type: 'custom', title: taskForm.title, color: taskForm.color, event_date: taskForm.event_date, recurring: taskForm.recurring, recurrence_rule: taskForm.recurring ? taskForm.recurrence_rule : null, assigned_unit_id: taskForm.assigned_unit_id || null, assigned_unit_name: unit?.unit_name || null, push_enabled: taskForm.push_enabled, status: 'pending' };
        const toInsert = [];
        if (taskForm.recurring) {
            let d = new Date(taskForm.event_date);
            while (d.getFullYear() === currentYear) { toInsert.push({ ...payload, event_date: toIso(d), recurring: true }); if (taskForm.recurrence_rule === 'weekly') d = addDays(d, 7); else if (taskForm.recurrence_rule === 'biweekly') d = addDays(d, 14); else d.setMonth(d.getMonth() + 1); }
        } else toInsert.push(payload);
        const { data } = await supabase.from('objektkalender_events').insert(toInsert).select();
        if (data) setEvents(prev => [...prev, ...data].sort((a, b) => a.event_date.localeCompare(b.event_date)));
        setShowTaskModal(false);
        setTaskForm({ title: '', color: '#8B5CF6', recurring: false, recurrence_rule: 'weekly', assigned_unit_id: '', push_enabled: false, event_date: toIso(new Date()) });
    };

    const handleIcsImport = async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const text = await file.text(); const parsed = parseIcs(text);
        if (!parsed.length) { alert('Keine Termine gefunden.'); return; }
        const rows = parsed.map((p, idx) => {
            const unit = units.length ? units[idx % units.length] : null;
            return { user_id: user.id, property_id: selectedPropertyId, event_type: 'waste', title: p.title, event_date: p.date, waste_type: p.wasteType, color: WASTE_TYPES.find(w => w.key === p.wasteType)?.color || EC.waste, status: 'pending', push_enabled: true, assigned_unit_id: unit?.id || null, assigned_unit_name: unit?.unit_name || null };
        });
        const { data } = await supabase.from('objektkalender_events').insert(rows).select();
        if (data) setEvents(prev => [...prev, ...data].sort((a, b) => a.event_date.localeCompare(b.event_date)));
        e.target.value = ''; alert(`${parsed.length} Mülltermine importiert.`);
    };

    // ── Week Data ────────────────────────────────────────────
    const weekStart = useMemo(() => addDays(getMondayOfWeek(new Date()), weekOffset * 7), [weekOffset]);
    const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
    const weekEvents = useMemo(() => { const s = toIso(weekDays[0]), e = toIso(weekDays[6]); return events.filter(ev => ev.event_date >= s && ev.event_date <= e); }, [events, weekDays]);

    // ── Year Grid ────────────────────────────────────────────
    const yearGrid = useMemo(() => {
        const grid = [];
        for (let m = 0; m < 12; m++) {
            const firstDay = new Date(currentYear, m, 1); const lastDay = new Date(currentYear, m + 1, 0);
            const startOffset = (firstDay.getDay() + 6) % 7; const days = [];
            for (let i = 0; i < startOffset; i++) days.push(null);
            for (let d = 1; d <= lastDay.getDate(); d++) {
                const iso = `${currentYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                days.push({ day: d, iso, events: events.filter(e => e.event_date === iso) });
            }
            grid.push({ month: m, days });
        }
        return grid;
    }, [events, currentYear]);

    // ── Mobile Month Data ────────────────────────────────────
    const mobileMonthDays = useMemo(() => {
        const firstDay = new Date(currentYear, mobileMonth, 1);
        const lastDay = new Date(currentYear, mobileMonth + 1, 0);
        const startOffset = (firstDay.getDay() + 6) % 7;
        const days = [];
        for (let i = 0; i < startOffset; i++) days.push(null);
        for (let d = 1; d <= lastDay.getDate(); d++) {
            const iso = `${currentYear}-${String(mobileMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            days.push({ day: d, iso, events: events.filter(e => e.event_date === iso) });
        }
        return days;
    }, [events, currentYear, mobileMonth]);

    const mobileAgendaEvents = useMemo(() => {
        if (selectedDay) return events.filter(e => e.event_date === selectedDay);
        // Default: show upcoming events for current month
        return events.filter(e => {
            const m = parseInt(e.event_date.split('-')[1], 10) - 1;
            return m === mobileMonth && e.event_date >= today;
        }).sort((a, b) => a.event_date.localeCompare(b.event_date));
    }, [events, selectedDay, mobileMonth, today]);

    // ── Mobile Google Calendar View ──────────────────────────
    const renderMobileView = () => {
        const selDayDate = selectedDay ? new Date(selectedDay) : null;
        return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Month Header - Compact like Google Calendar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', marginBottom: '2px' }}>
                    <button className="cal-nav" onClick={() => { setMobileMonth(p => p > 0 ? p - 1 : 11); setSelectedDay(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-primary)', borderRadius: '50%', minHeight: 'auto' }}><ChevronLeft size={18} /></button>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>{MONTHS[mobileMonth]} {currentYear}</div>
                    </div>
                    <button className="cal-nav" onClick={() => { setMobileMonth(p => p < 11 ? p + 1 : 0); setSelectedDay(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-primary)', borderRadius: '50%', minHeight: 'auto' }}><ChevronRight size={18} /></button>
                </div>

                {/* Weekday Headers */}
                <div className="cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 2px' }}>
                    {WEEKDAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)', padding: '4px 0' }}>{d}</div>)}
                </div>

                {/* Month Grid - Compact */}
                <div className="cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 2px', marginBottom: '6px' }}>
                    {mobileMonthDays.map((d, i) => {
                        if (!d) return <div key={`e${i}`} style={{ padding: '2px 0' }} />;
                        const isToday = d.iso === today;
                        const isSelected = d.iso === selectedDay;
                        const hasEvents = d.events.length > 0;
                        return (
                            <button key={d.iso} className="cal-cell" onClick={() => setSelectedDay(isSelected ? null : d.iso)}
                                style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    padding: '2px 0', cursor: 'pointer', border: 'none', background: 'none',
                                    minHeight: 'auto', height: 'auto'
                                }}>
                                <div style={{
                                    width: '32px', height: '32px', borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.8rem', fontWeight: isToday || isSelected ? 700 : 400,
                                    background: isSelected ? 'var(--primary-color)' : isToday ? 'rgba(14,165,233,0.12)' : 'transparent',
                                    color: isSelected ? '#fff' : isToday ? 'var(--primary-color)' : 'var(--text-primary)',
                                    border: isToday && !isSelected ? '1.5px solid var(--primary-color)' : '1.5px solid transparent',
                                    transition: 'all 0.15s'
                                }}>{d.day}</div>
                                {/* Event dots */}
                                <div style={{ display: 'flex', gap: '1.5px', height: '5px', marginTop: '1px', alignItems: 'center' }}>
                                    {hasEvents && d.events.slice(0, 3).map((e, j) => (
                                        <span key={j} style={{ width: '4px', height: '4px', borderRadius: '50%', background: isSelected ? 'rgba(14,165,233,0.5)' : evColor(e) }} />
                                    ))}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Divider */}
                <div style={{ height: '1px', background: 'var(--border-color)', margin: '0 0 10px' }} />

                {/* Agenda section */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }}>
                    {selectedDay && (
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                            {WEEKDAY_FULL[(selDayDate.getDay() + 6) % 7]}, {selDayDate.toLocaleDateString('de-DE', { day: '2-digit', month: 'long' })}
                            <button className="cal-nav" onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', marginLeft: 'auto', padding: '4px', minHeight: 'auto' }}><X size={14} /></button>
                        </div>
                    )}
                    {!selectedDay && (
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            Anstehende Termine
                        </div>
                    )}
                    {mobileAgendaEvents.length === 0 && (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px 12px', fontSize: '0.82rem' }}>
                            {selectedDay ? 'Keine Termine an diesem Tag.' : 'Keine anstehenden Termine.'}
                        </div>
                    )}
                    {mobileAgendaEvents.map(e => {
                        const showDate = !selectedDay;
                        return (
                            <div key={e.id} style={{ marginBottom: '6px' }}>
                                {showDate && <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '2px', fontWeight: 600 }}>{new Date(e.event_date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>}
                                <EventBadge event={e} />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // ── PDF Export (same logic, opens in new tab) ────────────
    const handleExportPdf = async () => {
        const prop = properties.find(p => p.id === selectedPropertyId);
        const propLabel = prop ? `${prop.street} ${prop.house_number || ''}`.trim() : '';
        // Resolve the correct PDF template for this property's portfolio
        const tpl = prop?.portfolio_id
            ? await fetchPdfTemplate(prop.portfolio_id, 'immobilien')
            : pdfTemplate;
        const logoUrl = tpl?.logoUrl || '';
        let monthsHtml = '';
        yearGrid.forEach(({ month, days }) => {
            let dh = WEEKDAYS.map(d => `<div style="font-size:6pt;font-weight:600;color:#64748b;text-align:center;padding:1px 0">${d}</div>`).join('');
            days.forEach(d => {
                if (!d) { dh += `<div></div>`; return; }
                const badges = d.events.map(e => `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${evColor(e)};margin-right:1px"></span>`).join('');
                dh += `<div style="text-align:center;font-size:6pt;padding:1px 0;color:#334155">${d.day}<div style="min-height:6px;line-height:1">${badges}</div></div>`;
            });
            monthsHtml += `<div style="break-inside:avoid"><div style="font-weight:600;font-size:8pt;margin-bottom:3px;color:#1e293b">${MONTHS[month]}</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:0">${dh}</div></div>`;
        });
        const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Objektkalender ${currentYear}</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><style>@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:Inter,sans-serif;color:#1e293b}@media print{.no-print{display:none!important}}@media screen{body{padding:20px;background:#f1f5f9}}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}.legend{display:flex;gap:12px;margin-top:3mm;font-size:7pt;color:#64748b}.legend-item{display:flex;align-items:center;gap:3px}.dot{width:6px;height:6px;border-radius:50%;display:inline-block}</style></head><body><div class="no-print" style="text-align:center;padding:12px 0 20px"><button onclick="window.print()" style="padding:10px 28px;font-size:14px;font-weight:600;background:#0ea5e9;color:white;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15)">🖨️ Als PDF drucken / speichern</button><p style="margin-top:8px;font-size:12px;color:#94a3b8">Drücke Strg+P oder klicke den Button. Wähle "Als PDF speichern" im Druckdialog.</p></div><div class="grid">${monthsHtml}</div><div class="legend"><div class="legend-item"><span class="dot" style="background:${EC.cleaning}"></span> Reinigung</div><div class="legend-item"><span class="dot" style="background:${EC.waste}"></span> Müll</div><div class="legend-item"><span class="dot" style="background:${EC.custom}"></span> Zusatzaufgabe</div></div></body></html>`;
        const w = window.open('', '_blank'); w.document.write(html); w.document.close(); setTimeout(() => { w.print(); }, 600);
    };

    // ── Styles ───────────────────────────────────────────────
    const labelSt = { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' };
    const selectSt = { padding: '8px 12px', borderRadius: '8px', border: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', width: '100%' };
    const inputSt = { ...selectSt };
    const tabSt = (a) => ({ padding: '8px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: a ? 600 : 400, background: a ? 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(14,165,233,0.08))' : 'transparent', color: a ? 'var(--primary-color)' : 'var(--text-secondary)', transition: 'all 0.25s', ...(a ? { boxShadow: '0 0 0 1px rgba(14,165,233,0.2)' } : {}) });
    const toggleSt = (on) => ({ width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer', background: on ? 'var(--primary-color)' : '#D1D5DB', position: 'relative', transition: 'background 0.2s', flexShrink: 0 });
    const toggleDot = (on) => ({ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', left: on ? '20px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' });

    // ── Event Badge ──────────────────────────────────────────
    const EventBadge = ({ event }) => {
        const isDone = event.status === 'done';
        const isOver = !isDone && isOverdue(event.event_date);
        const bgColor = isDone ? EC.done : isOver ? EC.overdue : evColor(event);
        const wasteLabel = event.waste_type ? WASTE_TYPES.find(w => w.key === event.waste_type)?.label : null;
        const isMyUnit = tenantUnitId && event.assigned_unit_id === tenantUnitId;
        const canMarkDone = isInvestor || isMyUnit;

        // Strong highlight style for tenant's own events
        const myUnitStyle = isMyUnit && !isDone ? {
            background: `linear-gradient(135deg, ${bgColor}25, ${bgColor}12)`,
            borderLeft: `4px solid ${bgColor}`,
            boxShadow: `0 0 12px ${bgColor}25, 0 0 0 1px ${bgColor}35`,
            border: `1px solid ${bgColor}40`,
            borderLeftWidth: '4px',
            borderLeftStyle: 'solid',
            borderLeftColor: bgColor,
        } : {};

        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: isMyUnit ? '12px 16px' : '10px 14px', borderRadius: '12px', background: `${bgColor}10`, borderLeft: `3px solid ${bgColor}`, marginBottom: '6px', fontSize: '0.82rem', ...myUnitStyle }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {event.title}
                        {wasteLabel && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.73rem' }}>({wasteLabel})</span>}
                        {isMyUnit && !isDone && <span style={{ fontSize: '0.65rem', background: `linear-gradient(135deg, ${bgColor}, ${bgColor}CC)`, color: '#fff', padding: '2px 10px', borderRadius: '6px', fontWeight: 700, letterSpacing: '0.5px', animation: 'none' }}>⭐ DEINE AUFGABE</span>}
                    </div>
                    {event.assigned_unit_name && <div style={{ fontSize: '0.73rem', color: isMyUnit ? bgColor : 'var(--text-secondary)', fontWeight: isMyUnit ? 600 : 400, marginTop: '2px' }}>{event.assigned_unit_name}</div>}
                    {isDone && <span style={{ fontSize: '0.7rem', color: EC.done, fontWeight: 600 }}>✓ Erledigt</span>}
                    {isOver && <span style={{ fontSize: '0.7rem', color: EC.overdue, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}><AlertTriangle size={10} /> Überfällig</span>}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    {!isDone && canMarkDone && <button onClick={() => handleMarkDone(event)} style={{ background: EC.done, color: '#fff', border: 'none', borderRadius: '8px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}><Check size={12} /> Erledigt</button>}
                    {isInvestor && <button onClick={() => handleDeleteEvent(event)} style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '5px 7px', cursor: 'pointer', color: 'var(--text-secondary)' }}><Trash2 size={12} /></button>}
                </div>
            </div>
        );
    };

    // ── Day Detail Overlay ───────────────────────────────────
    const DayDetail = () => {
        if (!selectedDay) return null;
        const dayEvents = events.filter(e => e.event_date === selectedDay);
        const d = new Date(selectedDay);
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setSelectedDay(null)}>
                <div style={{ ...glassCard({ padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }), background: 'var(--surface-color)' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>{WEEKDAY_FULL[(d.getDay() + 6) % 7]}, {d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}</h3>
                        <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}><X size={18} /></button>
                    </div>
                    {dayEvents.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px', fontSize: '0.88rem' }}>Keine Termine an diesem Tag.</div>}
                    {dayEvents.map(e => <EventBadge key={e.id} event={e} />)}
                </div>
            </div>
        );
    };

    // ── Settings Panel ───────────────────────────────────────
    const renderSettings = () => {
        if (!settings) return null;
        const u = (k, v) => setSettings(prev => ({ ...prev, [k]: v }));
        return (
            <div style={glassCard({ marginBottom: '20px' })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}><SettingsIcon size={18} /> Einstellungen</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Button size="sm" onClick={() => setShowSettings(false)} variant="secondary">Abbrechen</Button>
                        <Button size="sm" onClick={handleSaveSettings} disabled={saving}>{saving ? 'Speichern…' : 'Speichern'}</Button>
                    </div>
                </div>
                <div style={{ ...glassBlue(), padding: '16px', marginBottom: '16px', borderRadius: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <h4 style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Sparkles size={16} color={EC.cleaning} /> Treppenhausreinigung</h4>
                        <button style={toggleSt(settings.cleaning_active)} onClick={() => u('cleaning_active', !settings.cleaning_active)}><div style={toggleDot(settings.cleaning_active)} /></button>
                    </div>
                    {settings.cleaning_active && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px' }}>
                            <div><label style={labelSt}>Durchführung</label><select style={selectSt} value={settings.cleaning_performer} onChange={e => u('cleaning_performer', e.target.value)}><option value="tenant">Mieter (Rotation)</option><option value="janitor">Hausmeisterdienst</option></select></div>
                            <div><label style={labelSt}>Frequenz</label><select style={selectSt} value={settings.cleaning_frequency} onChange={e => u('cleaning_frequency', e.target.value)}>{CLEANING_FREQ.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                            <div><label style={labelSt}>Wochentag</label><select style={selectSt} value={settings.cleaning_weekday} onChange={e => u('cleaning_weekday', Number(e.target.value))}>{WEEKDAY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                        </div>
                    )}
                </div>
                <div style={{ ...glassBlue(), padding: '16px', borderRadius: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <h4 style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Droplets size={16} color={EC.waste} /> Mülltermine</h4>
                        <button style={toggleSt(settings.waste_active)} onClick={() => u('waste_active', !settings.waste_active)}><div style={toggleDot(settings.waste_active)} /></button>
                    </div>
                    {settings.waste_active && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                            <div><label style={labelSt}>Durchführung</label><select style={selectSt} value={settings.waste_performer} onChange={e => u('waste_performer', e.target.value)}><option value="tenant">Mieter (Rotation)</option><option value="janitor">Hausmeisterdienst</option></select></div>
                            <div><label style={labelSt}>ICS importieren</label><input ref={fileInputRef} type="file" accept=".ics" onChange={handleIcsImport} style={{ display: 'none' }} /><Button size="sm" variant="secondary" icon={Upload} onClick={() => fileInputRef.current?.click()}>ICS importieren</Button></div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ── Task Modal ───────────────────────────────────────────
    const renderTaskModal = () => (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShowTaskModal(false)}>
            <div style={{ background: 'var(--surface-color)', borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)' }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontWeight: 700, marginBottom: '16px', fontSize: '1rem' }}>Neue Zusatzaufgabe</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div><label style={labelSt}>Titel *</label><input style={inputSt} value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="z.B. Winterdienst" /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelSt}>Datum</label><input type="date" style={inputSt} value={taskForm.event_date} onChange={e => setTaskForm(p => ({ ...p, event_date: e.target.value }))} /></div>
                        <div><label style={labelSt}>Farbe</label><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><input type="color" value={taskForm.color} onChange={e => setTaskForm(p => ({ ...p, color: e.target.value }))} style={{ width: '36px', height: '36px', border: 'none', cursor: 'pointer', borderRadius: '8px' }} /><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{taskForm.color}</span></div></div>
                    </div>
                    <div><label style={labelSt}>Einheit</label><select style={selectSt} value={taskForm.assigned_unit_id} onChange={e => setTaskForm(p => ({ ...p, assigned_unit_id: e.target.value }))}><option value="">– Keine –</option>{units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select></div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: '0.85rem' }}>Wiederkehrend</span><button style={toggleSt(taskForm.recurring)} onClick={() => setTaskForm(p => ({ ...p, recurring: !p.recurring }))}><div style={toggleDot(taskForm.recurring)} /></button></div>
                    {taskForm.recurring && <div><label style={labelSt}>Frequenz</label><select style={selectSt} value={taskForm.recurrence_rule} onChange={e => setTaskForm(p => ({ ...p, recurrence_rule: e.target.value }))}><option value="weekly">Wöchentlich</option><option value="biweekly">Alle 2 Wochen</option><option value="monthly">Monatlich</option></select></div>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: '0.85rem' }}>Push-Erinnerung</span><button style={toggleSt(taskForm.push_enabled)} onClick={() => setTaskForm(p => ({ ...p, push_enabled: !p.push_enabled }))}><div style={toggleDot(taskForm.push_enabled)} /></button></div>
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <Button variant="secondary" onClick={() => setShowTaskModal(false)}>Abbrechen</Button>
                    <Button onClick={handleAddTask}>Erstellen</Button>
                </div>
            </div>
        </div>
    );

    // ── Week View ────────────────────────────────────────────
    const renderWeekView = () => (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <button onClick={() => setWeekOffset(p => p - 1)} style={{ ...glass, padding: '8px 12px', cursor: 'pointer', color: 'var(--text-primary)', borderRadius: '10px' }}><ChevronLeft size={16} /></button>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {weekDays[0].toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} – {weekDays[6].toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background: 'rgba(14,165,233,0.1)', border: 'none', cursor: 'pointer', fontSize: '0.73rem', color: 'var(--primary-color)', fontWeight: 600, padding: '3px 10px', borderRadius: '6px' }}>Heute</button>}
                </div>
                <button onClick={() => setWeekOffset(p => p + 1)} style={{ ...glass, padding: '8px 12px', cursor: 'pointer', color: 'var(--text-primary)', borderRadius: '10px' }}><ChevronRight size={16} /></button>
            </div>
            {weekDays.map((day, i) => {
                const iso = toIso(day); const dayEv = weekEvents.filter(e => e.event_date === iso); const isToday = iso === today;
                const hasMyEvent = tenantUnitId && dayEv.some(e => e.assigned_unit_id === tenantUnitId && e.status !== 'done');
                return (
                    <div key={iso} style={{ marginBottom: '8px', padding: '14px 16px', borderRadius: '14px', cursor: 'pointer', ...(hasMyEvent ? { ...glassBlue(), border: '2px solid rgba(14,165,233,0.3)', boxShadow: '0 0 16px rgba(14,165,233,0.1)' } : isToday ? glassBlue() : { ...glass, background: 'var(--glass-bg)' }), transition: 'all 0.2s' }} onClick={() => { if (dayEv.length) setSelectedDay(iso); }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: dayEv.length ? '10px' : 0, color: hasMyEvent ? 'var(--primary-color)' : isToday ? 'var(--primary-color)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {WEEKDAY_FULL[i]}
                            <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{day.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                            {isToday && <span style={{ fontSize: '0.63rem', background: 'var(--primary-color)', color: '#fff', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>Heute</span>}
                            {hasMyEvent && !isToday && <span style={{ fontSize: '0.63rem', background: 'linear-gradient(135deg, #3B82F6, #0EA5E9)', color: '#fff', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>⭐ Deine Aufgabe</span>}
                            {dayEv.length > 0 && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}><Eye size={11} />{dayEv.length}</span>}
                        </div>
                        {dayEv.map(e => <EventBadge key={e.id} event={e} />)}
                        {dayEv.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Termine</div>}
                    </div>
                );
            })}
        </div>
    );

    // ── Year View with Clickable Months & Days ───────────────
    const renderYearView = () => (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: isMobile ? '12px' : '16px' }}>
            {yearGrid.map(({ month, days }) => {
                const isExpanded = selectedMonth === month;
                const monthEvents = events.filter(e => { const m = parseInt(e.event_date.split('-')[1], 10) - 1; return m === month; });
                return (
                    <div key={month} style={{ ...glassCard({ padding: '14px', cursor: 'pointer', transition: 'all 0.3s' }), ...(isExpanded ? { gridColumn: isMobile ? '1' : '1/-1', ...glassBlue() } : {}) }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }} onClick={() => setSelectedMonth(isExpanded ? null : month)}>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{MONTHS[month]}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {monthEvents.length > 0 && <span style={{ fontSize: '0.68rem', background: 'rgba(14,165,233,0.12)', color: 'var(--primary-color)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>{monthEvents.length}</span>}
                                <ChevronRight size={14} style={{ color: 'var(--text-secondary)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                            </div>
                        </div>
                        {/* Mini calendar grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '1px' }}>
                            {WEEKDAYS.map(d => <div key={d} style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', paddingBottom: '2px' }}>{d}</div>)}
                            {days.map((d, i) => {
                                if (!d) return <div key={`e${i}`} />;
                                const isToday = d.iso === today; const hasEvents = d.events.length > 0;
                                const hasMyEvent = tenantUnitId && d.events.some(e => e.assigned_unit_id === tenantUnitId && e.status !== 'done');
                                return (
                                    <div key={d.iso} onClick={(e) => { e.stopPropagation(); if (hasEvents) setSelectedDay(d.iso); }} style={{ textAlign: 'center', padding: '2px 0', fontSize: '0.7rem', color: isToday ? '#fff' : hasMyEvent ? 'var(--primary-color)' : 'var(--text-primary)', background: isToday ? 'var(--primary-color)' : hasMyEvent ? 'rgba(14,165,233,0.15)' : 'transparent', borderRadius: '4px', lineHeight: 1.2, cursor: hasEvents ? 'pointer' : 'default', transition: 'all 0.15s', fontWeight: hasMyEvent ? 700 : 400, ...(hasMyEvent && !isToday ? { boxShadow: '0 0 0 1.5px rgba(14,165,233,0.4)' } : {}) }} title={d.events.map(e => `${e.title}${e.assigned_unit_name ? ' – ' + e.assigned_unit_name : ''}`).join('\n')}>
                                        {d.day}
                                        {hasEvents && <div style={{ display: 'flex', justifyContent: 'center', gap: '1px', marginTop: '1px' }}>{d.events.slice(0, 4).map((e, j) => <span key={j} style={{ width: hasMyEvent && e.assigned_unit_id === tenantUnitId ? '6px' : '4px', height: hasMyEvent && e.assigned_unit_id === tenantUnitId ? '6px' : '4px', borderRadius: '50%', background: evColor(e), display: 'inline-block' }} />)}</div>}
                                    </div>
                                );
                            })}
                        </div>
                        {/* Expanded: show all events for this month */}
                        {isExpanded && monthEvents.length > 0 && (
                            <div style={{ marginTop: '16px', borderTop: '1px solid var(--glass-border)', paddingTop: '12px' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Termine im {MONTHS[month]}</div>
                                {monthEvents.sort((a, b) => a.event_date.localeCompare(b.event_date)).map(e => (
                                    <div key={e.id} style={{ marginBottom: '4px' }}>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{new Date(e.event_date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
                                        <EventBadge event={e} />
                                    </div>
                                ))}
                            </div>
                        )}
                        {isExpanded && monthEvents.length === 0 && <div style={{ marginTop: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem', fontStyle: 'italic', padding: '12px 0' }}>Keine Termine im {MONTHS[month]}.</div>}
                    </div>
                );
            })}
        </div>
    );

    // ── History View ─────────────────────────────────────────
    const renderHistory = () => (
        <div>
            {history.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px', fontSize: '0.9rem' }}>Noch keine Historie.</div>}
            {history.map(h => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '12px', ...glass, marginBottom: '6px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: h.status === 'done' ? EC.done : EC.overdue, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>{h.title}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{new Date(h.event_date).toLocaleDateString('de-DE')} {h.assigned_unit_name && `· ${h.assigned_unit_name}`}</div>
                    </div>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: h.status === 'done' ? EC.done : EC.overdue }}>{h.status === 'done' ? 'Erledigt' : 'Überfällig'}</span>
                </div>
            ))}
        </div>
    );

    // ── Render ────────────────────────────────────────────────
    if (loading && !properties.length) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Objektkalender…</div>;

    // ── Mobile Render ─────────────────────────────────────────
    if (isMobile) return (
        <div style={{ position: 'relative', paddingBottom: '80px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(14,165,233,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Calendar size={16} color="var(--primary-color)" /></div>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Objektkalender</h1>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {isInvestor && <button className="cal-nav" onClick={() => setShowSettings(!showSettings)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-secondary)', borderRadius: '8px', minHeight: 'auto' }}><SettingsIcon size={18} /></button>}
                    {isInvestor && <button className="cal-nav" onClick={handleExportPdf} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-secondary)', borderRadius: '8px', minHeight: 'auto' }}><FileText size={18} /></button>}
                </div>
            </div>
            {properties.length > 1 && <select style={{ ...selectSt, marginBottom: '12px', fontSize: '0.82rem' }} value={selectedPropertyId || ''} onChange={e => setSelectedPropertyId(e.target.value)}>{properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number || ''}</option>)}</select>}
            {properties.length === 1 && <div style={{ padding: '6px 12px', borderRadius: '10px', ...glassBlue(), fontSize: '0.8rem', fontWeight: 600, marginBottom: '12px', textAlign: 'center' }}>{properties[0].street} {properties[0].house_number || ''}</div>}
            {showSettings && isInvestor && renderSettings()}
            <div style={glassCard()}>
                {loading ? <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Termine…</div> : renderMobileView()}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', fontSize: '0.65rem', color: 'var(--text-secondary)', flexWrap: 'wrap', justifyContent: 'center' }}>
                {[{ c: EC.cleaning, l: 'Reinigung' }, { c: EC.waste, l: 'Müll' }, { c: EC.custom, l: 'Aufgabe' }, { c: EC.done, l: 'Erledigt' }, { c: EC.overdue, l: 'Überfällig' }].map(({ c, l }) => (
                    <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c }} />{l}</span>
                ))}
            </div>
            {isInvestor && (
                <button onClick={() => setShowTaskModal(true)} style={{ position: 'fixed', bottom: '80px', right: '20px', width: '56px', height: '56px', borderRadius: '16px', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #0EA5E9, #3B82F6)', color: '#fff', boxShadow: '0 4px 20px rgba(14,165,233,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}><Plus size={24} /></button>
            )}
            {showTaskModal && renderTaskModal()}
            {deleteConfirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setDeleteConfirm(null)}>
                    <div style={{ background: 'var(--surface-color)', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ fontWeight: 700, marginBottom: '8px', fontSize: '1rem' }}>Termin löschen</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>„{deleteConfirm.title}" am {new Date(deleteConfirm.event_date).toLocaleDateString('de-DE')}{deleteConfirm.assigned_unit_name && <span> – {deleteConfirm.assigned_unit_name}</span>}</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button onClick={() => executeDelete('single')} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 500 }}>🗑️ Nur diesen Termin löschen</button>
                            <button onClick={() => executeDelete('future')} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', cursor: 'pointer', textAlign: 'left', color: '#EF4444', fontSize: '0.88rem', fontWeight: 500 }}>🗑️ Diesen + alle zukünftigen löschen</button>
                            <button onClick={() => setDeleteConfirm(null)} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>Abbrechen</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // ── Desktop Render (unchanged) ───────────────────────────
    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(14,165,233,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Calendar size={22} color="var(--primary-color)" /></div>
                        Objektkalender
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Reinigung, Müll & Aufgaben für Ihre Immobilien</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {properties.length > 1 && <select style={{ ...selectSt, width: 'auto', minWidth: '180px' }} value={selectedPropertyId || ''} onChange={e => setSelectedPropertyId(e.target.value)}>{properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number || ''}</option>)}</select>}
                    {properties.length === 1 && <div style={{ padding: '6px 14px', borderRadius: '10px', ...glassBlue(), fontSize: '0.85rem', fontWeight: 600 }}>{properties[0].street} {properties[0].house_number || ''}</div>}
                    {isInvestor && <>
                        <Button size="sm" variant="secondary" icon={SettingsIcon} onClick={() => setShowSettings(!showSettings)}>Einstellungen</Button>
                        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setShowTaskModal(true)}>Aufgabe</Button>
                        <Button size="sm" variant="secondary" icon={FileText} onClick={handleExportPdf}>PDF</Button>
                    </>}
                </div>
            </div>

            {showSettings && isInvestor && renderSettings()}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap', ...glassCard({ padding: '6px', display: 'inline-flex' }), borderRadius: '14px' }}>
                <button style={tabSt(tab === 'week')} onClick={() => setTab('week')}>Diese Woche</button>
                <button style={tabSt(tab === 'year')} onClick={() => setTab('year')}>Jahr {currentYear}</button>
                <button style={tabSt(tab === 'history')} onClick={() => setTab('history')}><Clock size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} /> Historie</button>
            </div>

            {/* Content */}
            <div style={glassCard()}>
                {loading ? <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Termine…</div> : <>
                    {tab === 'week' && renderWeekView()}
                    {tab === 'year' && renderYearView()}
                    {tab === 'history' && renderHistory()}
                </>}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '0.73rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                {[{ c: EC.cleaning, l: 'Reinigung' }, { c: EC.waste, l: 'Müll' }, { c: EC.custom, l: 'Zusatzaufgabe' }, { c: EC.done, l: 'Erledigt' }, { c: EC.overdue, l: 'Überfällig' }].map(({ c, l }) => (
                    <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />{l}</span>
                ))}
            </div>

            {showTaskModal && renderTaskModal()}
            {deleteConfirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setDeleteConfirm(null)}>
                    <div style={{ background: 'var(--surface-color)', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ fontWeight: 700, marginBottom: '8px', fontSize: '1rem' }}>Termin löschen</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>
                            „{deleteConfirm.title}“ am {new Date(deleteConfirm.event_date).toLocaleDateString('de-DE')}
                            {deleteConfirm.assigned_unit_name && <span> – {deleteConfirm.assigned_unit_name}</span>}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button onClick={() => executeDelete('single')} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 500 }}>
                                🗑️ Nur diesen Termin löschen
                            </button>
                            <button onClick={() => executeDelete('future')} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', cursor: 'pointer', textAlign: 'left', color: '#EF4444', fontSize: '0.88rem', fontWeight: 500 }}>
                                🗑️ Diesen + alle zukünftigen löschen
                            </button>
                            <button onClick={() => setDeleteConfirm(null)} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <DayDetail />
        </div>
    );
};

export default ObjectCalendar;
