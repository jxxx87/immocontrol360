import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Check, Trash2, Plus, Upload, Settings as SettingsIcon, Clock, AlertTriangle, FileText, Droplets, Sparkles, X, Eye, RefreshCw } from 'lucide-react';
import Button from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { useViewMode } from '../context/ViewModeContext';
import { supabase } from '../lib/supabase';
import { usePdfTemplate, fetchPdfTemplate } from '../lib/usePdfTemplate';
import { translateError } from '../lib/errorTranslator';
import { openSansFontFaceCss } from '../lib/fontFaces';

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
// Welche Vorkommen des Wochentags im Kalendermonat je Frequenz belegt werden
// (1× = 1., 2× = 1. + 3., 4× = 1.–4., wöchentlich = jedes Vorkommen).
const CLEANING_OCCURRENCES = { monthly: [1], bimonthly: [1, 3], weekly4: [1, 2, 3, 4], weekly: [1, 2, 3, 4, 5] };
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
const DEFAULT_SETTINGS = { cleaning_active: false, cleaning_performer: 'tenant', cleaning_frequency: 'monthly', cleaning_weekday: 1, waste_active: false, waste_performer: 'tenant' };
const HISTORY_STATUS = { done: { label: 'Erledigt', color: EC.done } };
const ICS_MAX_BYTES = 2 * 1024 * 1024;
const ICS_MAX_EVENTS = 2000;
const INSERT_CHUNK = 500;
const PLAN_HINT_DAYS = 60;

// ── Helpers ──────────────────────────────────────────────────
const toIso = (d) => { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
// 'YYYY-MM-DD' als lokales Datum lesen (new Date('YYYY-MM-DD') wäre UTC-Mitternacht)
const parseIsoLocal = (iso) => { const [y, m, d] = String(iso || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const isIsoDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && toIso(parseIsoLocal(iso)) === iso;
const fmtIso = (iso, opts) => parseIsoLocal(iso).toLocaleDateString('de-DE', opts);
const getMondayOfWeek = (d) => { const date = new Date(d); const day = date.getDay(); date.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); return date; };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
// Gleicher Tag n Monate später; fehlt der Tag im Zielmonat (29.–31.), wird der Monatsletzte genommen
const addMonthsClamped = (base, n) => { const y = base.getFullYear(); const m = base.getMonth() + n; const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(base.getDate(), last)); };
const isOverdue = (eventDate) => { const end = parseIsoLocal(eventDate); end.setDate(end.getDate() + 2); end.setHours(0, 0, 0, 0); return new Date() >= end; };
const normalizeWeekday = (v) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1; };
// Serien und Reinigungsplan werden rollierend bis Ende des Folgejahres angelegt
const planHorizonIso = (baseYear) => `${baseYear + 1}-12-31`;

// Farbwerte kommen aus der DB (Mieter/Teammitglieder können sie ändern) und landen in
// style-Attributen des Druckfensters bzw. werden mit Alpha-Suffix kombiniert → nur #rrggbb.
const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const safeColor = (c, fallback) => {
    const s = typeof c === 'string' ? c.trim() : '';
    if (!HEX_COLOR.test(s)) return fallback;
    const hex = s.slice(1);
    return hex.length <= 4 ? `#${hex.slice(0, 3).split('').map(ch => ch + ch).join('')}` : `#${hex.slice(0, 6)}`;
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Logo im Druckfenster nur als https-URL oder eingebettetes Rasterbild
const safeImageUrl = (url) => {
    const s = typeof url === 'string' ? url.trim() : '';
    if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(s)) return s;
    return '';
};
const evColor = (e) => e.status === 'done' ? EC.done : (e.event_type === 'cleaning' ? EC.cleaning : e.event_type === 'waste' ? safeColor(e.color, EC.waste) : safeColor(e.color, EC.custom));
const byEventDate = (a, b) => a.event_date.localeCompare(b.event_date);
const eventKey = (date, title) => `${date}|${String(title || '').trim().toLowerCase()}`;
const emptyTaskForm = () => ({ title: '', color: '#8B5CF6', recurring: false, recurrence_rule: 'weekly', assigned_unit_id: '', push_enabled: false, event_date: toIso(new Date()) });

const normalizeSettings = (row) => {
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
        ...row,
        cleaning_active: !!row.cleaning_active,
        cleaning_performer: row.cleaning_performer === 'janitor' ? 'janitor' : 'tenant',
        cleaning_frequency: CLEANING_OCCURRENCES[row.cleaning_frequency] ? row.cleaning_frequency : 'monthly',
        cleaning_weekday: normalizeWeekday(row.cleaning_weekday),
        waste_active: !!row.waste_active,
        waste_performer: row.waste_performer === 'janitor' ? 'janitor' : 'tenant',
    };
};

const unescapeIcsText = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

const parseIcs = (text) => {
    // Gefaltete Zeilen (RFC 5545, Fortsetzung beginnt mit Leerzeichen/Tab) entfalten
    const unfolded = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
    const events = []; let withRule = 0;
    const blocks = unfolded.split('BEGIN:VEVENT');
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0].replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '');
        const summary = unescapeIcsText(block.match(/^SUMMARY(?:;[^:\n]*)?:(.*)$/m)?.[1] || '').slice(0, 200);
        const dt = block.match(/^DTSTART(?:;[^:\n]*)?:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/m);
        if (!dt) continue;
        // UTC-Zeitpunkte (…Z) in das lokale Datum umrechnen, sonst Datum unverändert übernehmen
        const date = dt[7]
            ? toIso(new Date(Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +dt[6])))
            : `${dt[1]}-${dt[2]}-${dt[3]}`;
        if (!isIsoDate(date)) continue;
        if (/^RRULE[;:]/m.test(block)) withRule++;
        let wt = 'sonstiger'; const l = summary.toLowerCase();
        if (l.includes('rest')) wt = 'restmuell'; else if (l.includes('bio')) wt = 'bio'; else if (l.includes('papier')) wt = 'papier'; else if (l.includes('gelb') || l.includes('wertstoff')) wt = 'gelbe_tonne';
        events.push({ date, title: summary || 'Mülltermin', wasteType: wt });
    }
    return { events, withRule };
};

// Reinigungstermine im Zeitraum [fromIso, toIsoDate] mit Mieter-Rotation ab startUnitIdx
const generateCleaningEvents = (fromIso, toIsoDate, units, settings, startUnitIdx = 0) => {
    if (!settings?.cleaning_active || settings.cleaning_performer === 'janitor' || !units.length) return [];
    const weekday = normalizeWeekday(settings.cleaning_weekday);
    const occurrences = CLEANING_OCCURRENCES[settings.cleaning_frequency] || CLEANING_OCCURRENCES.monthly;
    const from = parseIsoLocal(fromIso); const to = parseIsoLocal(toIsoDate);
    const events = []; let unitIdx = Math.max(0, startUnitIdx);
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= to) {
        const y = cursor.getFullYear(); const m = cursor.getMonth();
        const firstMatch = 1 + ((weekday - new Date(y, m, 1).getDay() + 7) % 7);
        occurrences.forEach(n => {
            const date = new Date(y, m, firstMatch + (n - 1) * 7);
            if (date.getMonth() !== m || date < from || date > to) return;
            const unit = units[unitIdx % units.length];
            events.push({ event_type: 'cleaning', title: 'Treppenhausreinigung', event_date: toIso(date), assigned_unit_id: unit.id, assigned_unit_name: unit.unit_name, color: EC.cleaning, status: 'pending' });
            unitIdx++;
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return events;
};

// Termine einer wiederkehrenden Aufgabe vom Start bis endIso
const buildRecurringDates = (startIso, rule, endIso) => {
    const start = parseIsoLocal(startIso); const end = parseIsoLocal(endIso);
    const dates = [];
    for (let i = 0; i < 1000; i++) {
        const d = rule === 'weekly' ? addDays(start, 7 * i) : rule === 'biweekly' ? addDays(start, 14 * i) : addMonthsClamped(start, i);
        if (d > end) break;
        dates.push(toIso(d));
    }
    return dates;
};

const fetchHistoryRows = (propertyId) => supabase.from('objektkalender_history').select('*').eq('property_id', propertyId).order('event_date', { ascending: false }).limit(100);
const fetchCleaningPlanEnd = (propertyId) => supabase.from('objektkalender_events').select('event_date').eq('property_id', propertyId).eq('event_type', 'cleaning').order('event_date', { ascending: false }).limit(1);

// ── Glass style helpers ──────────────────────────────────────
const glass = { background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--glass-shadow)' };
const glassCard = (extra = {}) => ({ ...glass, padding: '20px', ...extra });
const glassBlue = (extra = {}) => ({ ...glass, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)', ...extra });

// ══════════════════════════════════════════════════════════════
const ObjectCalendar = () => {
    const { user, userRole, roleData } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const { isMobile } = useViewMode();
    const pdfTemplate = usePdfTemplate('immobilien');
    const isInvestor = userRole !== 'tenant';

    const thisYear = new Date().getFullYear();
    const today = toIso(new Date());
    const tenantUnitId = roleData?.unit_id || null;

    const [properties, setProperties] = useState([]);
    const [propertiesLoaded, setPropertiesLoaded] = useState(false);
    const [selectedPropertyId, setSelectedPropertyId] = useState(null);
    const [units, setUnits] = useState([]);
    const [settings, setSettings] = useState(null); // Formularzustand
    const [savedSettings, setSavedSettings] = useState(null); // zuletzt geladener/gespeicherter Stand
    const [events, setEvents] = useState([]);
    const [history, setHistory] = useState([]);
    const [cleaningPlanEnd, setCleaningPlanEnd] = useState(undefined);
    const [loading, setLoading] = useState(true);
    const [eventsLoading, setEventsLoading] = useState(true);
    const [propsError, setPropsError] = useState(null);
    const [dataError, setDataError] = useState(null);
    const [eventsError, setEventsError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [eventsReloadKey, setEventsReloadKey] = useState(0);
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    const [addingTask, setAddingTask] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [markingId, setMarkingId] = useState(null);
    const [tab, setTab] = useState('year');
    const [showSettings, setShowSettings] = useState(false);
    const [weekOffset, setWeekOffset] = useState(0);
    const [viewYear, setViewYear] = useState(thisYear);
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [taskForm, setTaskForm] = useState(emptyTaskForm);
    const [selectedMonth, setSelectedMonth] = useState(null); // expanded month in year view
    const [selectedDay, setSelectedDay] = useState(null); // clicked day ISO string
    const [deleteConfirm, setDeleteConfirm] = useState(null); // event to confirm delete
    const [mobileMonth, setMobileMonth] = useState(new Date().getMonth()); // 0-11 for mobile month nav
    const fileInputRef = useRef(null);

    // ── Week Data / geladener Zeitraum ───────────────────────
    const weekStart = useMemo(() => addDays(getMondayOfWeek(new Date()), weekOffset * 7), [weekOffset]);
    const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
    // Geladen werden ganze Jahre: das angezeigte Jahr und ggf. das Jahr der angezeigten Woche
    const rangeFrom = `${Math.min(viewYear, weekDays[0].getFullYear())}-01-01`;
    const rangeTo = `${Math.max(viewYear, weekDays[6].getFullYear())}-12-31`;

    // ── Fetch Properties ─────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        const go = async () => {
            let list = []; let error = null;
            if (isInvestor) {
                let q = supabase.from('properties').select('id, street, house_number, portfolio_id').order('street');
                if (selectedPortfolioID) q = q.eq('portfolio_id', selectedPortfolioID);
                const res = await q;
                list = res.data || []; error = res.error;
            } else {
                // Tenant: use roleData property
                const pid = roleData?.property_id;
                if (pid) {
                    const res = await supabase.from('properties').select('id, street, house_number, portfolio_id').eq('id', pid).maybeSingle();
                    list = res.data ? [res.data] : []; error = res.error;
                }
            }
            if (cancelled) return;
            setPropsError(error ? `Die Immobilien konnten nicht geladen werden: ${translateError(error)}` : null);
            setProperties(list);
            // Auswahl nur behalten, wenn das Objekt noch in der (neuen) Liste steht
            setSelectedPropertyId(prev => (list.some(p => p.id === prev) ? prev : (list[0]?.id || null)));
            setPropertiesLoaded(true);
        };
        go();
        return () => { cancelled = true; };
    }, [user, selectedPortfolioID, roleData, isInvestor, reloadKey]);

    // ── Load property data (Einheiten, Einstellungen, Historie) ──
    useEffect(() => {
        if (!user) return;
        if (!selectedPropertyId) {
            // Kein Objekt (mehr) gewählt → keine Daten eines fremden Objekts stehen lassen
            setUnits([]); setSettings(null); setSavedSettings(null); setHistory([]); setCleaningPlanEnd(undefined);
            return;
        }
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            const [uRes, sRes, hRes, pRes] = await Promise.all([
                supabase.from('units').select('id, unit_name, floor').eq('property_id', selectedPropertyId).order('unit_name'),
                // Eigentümer und Teammitglied können je eine Zeile haben → deterministisch die zuletzt geänderte nehmen
                supabase.from('objektkalender_settings').select('*').eq('property_id', selectedPropertyId).order('updated_at', { ascending: false, nullsFirst: false }).limit(1),
                fetchHistoryRows(selectedPropertyId),
                fetchCleaningPlanEnd(selectedPropertyId),
            ]);
            if (cancelled) return;
            const failed = [];
            setUnits(uRes.data || []);
            if (uRes.error) failed.push('Einheiten');
            if (sRes.error) {
                failed.push('Einstellungen');
                setSettings(null); setSavedSettings(null); // keine Defaults speichern, die echte Einstellungen überschreiben
            } else {
                const s = normalizeSettings(sRes.data?.[0]);
                setSettings(s); setSavedSettings(s);
            }
            setHistory(hRes.data || []);
            if (hRes.error) failed.push('Historie');
            setCleaningPlanEnd(pRes.error ? undefined : (pRes.data?.[0]?.event_date || null));
            setDataError(failed.length ? `Folgende Daten konnten nicht geladen werden: ${failed.join(', ')}. ${translateError(uRes.error || sRes.error || hRes.error)}` : null);
            setLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [user, selectedPropertyId, reloadKey]);

    // ── Load events for the visible range ────────────────────
    useEffect(() => {
        if (!user) return;
        if (!selectedPropertyId) { setEvents([]); return; }
        let cancelled = false;
        const load = async () => {
            setEventsLoading(true);
            const { data, error } = await supabase.from('objektkalender_events').select('*').eq('property_id', selectedPropertyId).gte('event_date', rangeFrom).lte('event_date', rangeTo).order('event_date');
            if (cancelled) return;
            if (error) { setEvents([]); setEventsError(`Die Termine konnten nicht geladen werden: ${translateError(error)}`); }
            else { setEvents(data || []); setEventsError(null); }
            setEventsLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [user, selectedPropertyId, rangeFrom, rangeTo, reloadKey, eventsReloadKey]);

    const refreshHistory = async () => {
        if (!selectedPropertyId) return;
        const { data, error } = await fetchHistoryRows(selectedPropertyId);
        if (!error) setHistory(data || []);
    };
    const refreshCleaningPlanEnd = async () => {
        if (!selectedPropertyId) return;
        const { data, error } = await fetchCleaningPlanEnd(selectedPropertyId);
        if (!error) setCleaningPlanEnd(data?.[0]?.event_date || null);
    };
    const inLoadedRange = (ev) => ev.event_date >= rangeFrom && ev.event_date <= rangeTo;

    // ── Reinigungsplan neu erzeugen ──────────────────────────
    // Nur offene, künftige Reinigungstermine werden ersetzt; erledigte und vergangene bleiben.
    // Erst neue Termine anlegen, dann die alten entfernen: scheitert das Anlegen, bleibt der
    // bisherige Plan vollständig erhalten. Die Rotation setzt beim zuletzt zuständigen Mieter fort.
    const regenerateCleaningPlan = async (cfg) => {
        const pid = selectedPropertyId;
        const wantsPlan = cfg.cleaning_active && cfg.cleaning_performer !== 'janitor';
        // Ohne Einheiten keine Rotation – dann auch den bestehenden Plan nicht löschen
        if (wantsPlan && !units.length) return { error: true, userMessage: 'Für dieses Objekt sind keine Einheiten geladen bzw. angelegt; ohne Einheiten kann keine Mieter-Rotation geplant werden.' };
        const { data: oldRows, error: oldErr } = await supabase.from('objektkalender_events').select('id').eq('property_id', pid).eq('event_type', 'cleaning').eq('status', 'pending').gte('event_date', today);
        if (oldErr) return { error: oldErr };
        const oldIds = (oldRows || []).map(r => r.id);
        let created = 0;
        if (wantsPlan) {
            // Bereits ab heute erledigte Termine bleiben stehen → Plan beginnt danach
            const { data: keptDone, error: keptErr } = await supabase.from('objektkalender_events').select('event_date, assigned_unit_id').eq('property_id', pid).eq('event_type', 'cleaning').eq('status', 'done').gte('event_date', today).order('event_date', { ascending: false }).limit(1);
            if (keptErr) return { error: keptErr };
            let anchorUnitId = keptDone?.[0]?.assigned_unit_id || null;
            const startIso = keptDone?.[0] ? toIso(addDays(parseIsoLocal(keptDone[0].event_date), 1)) : today;
            if (!keptDone?.[0]) {
                const { data: lastPast, error: lastErr } = await supabase.from('objektkalender_events').select('assigned_unit_id').eq('property_id', pid).eq('event_type', 'cleaning').lt('event_date', today).order('event_date', { ascending: false }).limit(1);
                if (lastErr) return { error: lastErr };
                anchorUnitId = lastPast?.[0]?.assigned_unit_id || null;
            }
            const anchorIdx = units.findIndex(u => u.id === anchorUnitId);
            const planned = generateCleaningEvents(startIso, planHorizonIso(thisYear), units, cfg, anchorIdx + 1);
            for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
                const chunk = planned.slice(i, i + INSERT_CHUNK).map(ev => ({ ...ev, user_id: user.id, property_id: pid }));
                const { error: insErr } = await supabase.from('objektkalender_events').insert(chunk);
                if (insErr) return { error: insErr, created };
                created += chunk.length;
            }
        }
        for (let i = 0; i < oldIds.length; i += 100) {
            const { error: delErr } = await supabase.from('objektkalender_events').delete().in('id', oldIds.slice(i, i + 100));
            if (delErr) return { error: delErr, created, partial: true };
        }
        return { error: null, created, removed: oldIds.length };
    };

    // ── Save Settings ────────────────────────────────────────
    const handleSaveSettings = async () => {
        // Während ein anderes Objekt lädt, gehören settings/units noch zum vorherigen Objekt
        if (!user || !selectedPropertyId || !settings || saving || loading) return;
        setSaving(true);
        try {
            const values = {
                cleaning_active: !!settings.cleaning_active,
                cleaning_performer: settings.cleaning_performer === 'janitor' ? 'janitor' : 'tenant',
                cleaning_frequency: CLEANING_OCCURRENCES[settings.cleaning_frequency] ? settings.cleaning_frequency : 'monthly',
                cleaning_weekday: normalizeWeekday(settings.cleaning_weekday),
                waste_active: !!settings.waste_active,
                waste_performer: settings.waste_performer === 'janitor' ? 'janitor' : 'tenant',
                updated_at: new Date().toISOString(),
            };
            let saved = null; let error = null;
            if (settings.id) {
                // Bestehende Zeile (ggf. die des Eigentümers) aktualisieren – id und user_id bleiben erhalten
                ({ data: saved, error } = await supabase.from('objektkalender_settings').update(values).eq('id', settings.id).select().maybeSingle());
                if (!error && !saved) { alert('Die Einstellungen konnten nicht gespeichert werden (keine Berechtigung für dieses Objekt).'); return; }
            } else {
                ({ data: saved, error } = await supabase.from('objektkalender_settings').upsert({ ...values, user_id: user.id, property_id: selectedPropertyId }, { onConflict: 'user_id,property_id' }).select().maybeSingle());
            }
            if (error) { alert(`Die Einstellungen konnten nicht gespeichert werden: ${translateError(error)}`); return; } // Panel bleibt offen
            const s = normalizeSettings(saved || { ...settings, ...values });
            setSettings(s); setSavedSettings(s);

            const res = await regenerateCleaningPlan(values);
            setEventsReloadKey(k => k + 1);
            await refreshCleaningPlanEnd();
            setShowSettings(false);
            if (res.error) {
                const reason = res.userMessage || translateError(res.error);
                alert(res.partial
                    ? `Die Einstellungen wurden gespeichert. Alte Reinigungstermine konnten nicht vollständig entfernt werden – bitte prüfen: ${reason}`
                    : `Die Einstellungen wurden gespeichert, der Reinigungsplan konnte aber nicht aktualisiert werden: ${reason}`);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleExtendPlan = async () => {
        if (!savedSettings || saving || loading) return;
        setSaving(true);
        try {
            const res = await regenerateCleaningPlan(savedSettings);
            setEventsReloadKey(k => k + 1);
            await refreshCleaningPlanEnd();
            if (res.error) alert(`Der Reinigungsplan konnte nicht fortgeschrieben werden: ${res.userMessage || translateError(res.error)}`);
        } finally {
            setSaving(false);
        }
    };

    const handleMarkDone = async (event) => {
        if (markingId) return;
        setMarkingId(event.id);
        try {
            const now = new Date().toISOString();
            const { data: upd, error } = await supabase.from('objektkalender_events').update({ status: 'done', completed_at: now, completed_by: user.id }).eq('id', event.id).select('id');
            if (error || !upd?.length) {
                alert(error ? `Der Termin konnte nicht als erledigt markiert werden: ${translateError(error)}` : 'Der Termin konnte nicht als erledigt markiert werden (keine Berechtigung).');
                return;
            }
            setEvents(prev => prev.map(e => e.id === event.id ? { ...e, status: 'done', completed_at: now, completed_by: user.id } : e));
            const { error: hErr } = await supabase.from('objektkalender_history').insert({ user_id: user.id, property_id: selectedPropertyId, event_id: event.id, event_type: event.event_type, title: event.title, event_date: event.event_date, assigned_unit_name: event.assigned_unit_name, status: 'done', completed_at: now, completed_by: user.id });
            if (hErr) alert(`Der Termin ist als erledigt markiert, der Eintrag in der Historie konnte aber nicht gespeichert werden: ${translateError(hErr)}`);
            else refreshHistory();
        } finally {
            setMarkingId(null);
        }
    };

    const handleDeleteEvent = (event) => {
        setDeleteConfirm(event);
    };

    const executeDelete = async (mode) => {
        const event = deleteConfirm;
        if (!event || deleting) return;
        setDeleting(true);
        try {
            let q = supabase.from('objektkalender_events').delete({ count: 'exact' });
            if (mode === 'single') q = q.eq('id', event.id);
            // Delete this + all future events with same title & type
            else q = q.eq('property_id', selectedPropertyId).eq('event_type', event.event_type).eq('title', event.title).gte('event_date', event.event_date);
            const { error, count } = await q;
            if (error) { alert(`Der Termin konnte nicht gelöscht werden: ${translateError(error)}`); return; }
            if (!count) { alert('Es wurde kein Termin gelöscht (keine Berechtigung).'); return; }
            if (mode === 'single') setEvents(prev => prev.filter(e => e.id !== event.id));
            else setEventsReloadKey(k => k + 1);
            if (event.event_type === 'cleaning') refreshCleaningPlanEnd();
            setDeleteConfirm(null);
        } finally {
            setDeleting(false);
        }
    };

    const handleAddTask = async () => {
        if (addingTask) return;
        const title = taskForm.title.trim();
        if (!title) { alert('Bitte einen Titel eingeben.'); return; }
        if (!isIsoDate(taskForm.event_date)) { alert('Bitte ein gültiges Datum wählen.'); return; }
        const unit = units.find(u => u.id === taskForm.assigned_unit_id);
        const payload = { user_id: user.id, property_id: selectedPropertyId, event_type: 'custom', title, color: safeColor(taskForm.color, EC.custom), event_date: taskForm.event_date, recurring: taskForm.recurring, recurrence_rule: taskForm.recurring ? taskForm.recurrence_rule : null, assigned_unit_id: taskForm.assigned_unit_id || null, assigned_unit_name: unit?.unit_name || null, push_enabled: taskForm.push_enabled, status: 'pending' };
        const startYear = parseIsoLocal(taskForm.event_date).getFullYear();
        const dates = taskForm.recurring
            ? buildRecurringDates(taskForm.event_date, taskForm.recurrence_rule, planHorizonIso(Math.max(startYear - 1, thisYear)))
            : [taskForm.event_date];
        if (!dates.length) { alert('Für diese Angaben ergeben sich keine Termine.'); return; }
        const toInsert = dates.map(d => ({ ...payload, event_date: d, recurring: taskForm.recurring }));
        setAddingTask(true);
        try {
            const inserted = [];
            for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
                const { data, error } = await supabase.from('objektkalender_events').insert(toInsert.slice(i, i + INSERT_CHUNK)).select();
                if (error) {
                    alert(`Die Aufgabe konnte nicht gespeichert werden: ${translateError(error)}`); // Modal bleibt offen
                    if (inserted.length) setEvents(prev => [...prev, ...inserted.filter(inLoadedRange)].sort(byEventDate));
                    return;
                }
                inserted.push(...(data || []));
            }
            setEvents(prev => [...prev, ...inserted.filter(inLoadedRange)].sort(byEventDate));
            setShowTaskModal(false);
            setTaskForm(emptyTaskForm());
        } finally {
            setAddingTask(false);
        }
    };

    const handleIcsImport = async (e) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = ''; // dieselbe Datei kann erneut gewählt werden
        if (!file || importing || loading) return;
        if (file.size > ICS_MAX_BYTES) { alert('Die ICS-Datei ist zu groß (maximal 2 MB).'); return; }
        setImporting(true);
        try {
            let text;
            try { text = await file.text(); } catch { alert('Die Datei konnte nicht gelesen werden.'); return; }
            const { events: parsed, withRule } = parseIcs(text);
            if (!parsed.length) { alert('Keine Termine gefunden.'); return; }
            // Vergangene Termine würden sofort als „überfällig“ erscheinen → nicht übernehmen
            const upcoming = parsed.filter(p => p.date >= today);
            const skippedPast = parsed.length - upcoming.length;
            const seen = new Set(); const unique = [];
            upcoming.forEach(p => { const k = eventKey(p.date, p.title); if (!seen.has(k)) { seen.add(k); unique.push(p); } });
            if (unique.length > ICS_MAX_EVENTS) { alert(`Die Datei enthält zu viele Termine (${unique.length}, maximal ${ICS_MAX_EVENTS}).`); return; }
            let fresh = unique;
            if (unique.length) {
                const minDate = unique.reduce((m, p) => (p.date < m ? p.date : m), unique[0].date);
                const maxDate = unique.reduce((m, p) => (p.date > m ? p.date : m), unique[0].date);
                const { data: existing, error: exErr } = await supabase.from('objektkalender_events').select('event_date, title').eq('property_id', selectedPropertyId).eq('event_type', 'waste').gte('event_date', minDate).lte('event_date', maxDate);
                if (exErr) { alert(`Vorhandene Termine konnten nicht geprüft werden, der Import wurde abgebrochen: ${translateError(exErr)}`); return; }
                const existingKeys = new Set((existing || []).map(x => eventKey(x.event_date, x.title)));
                fresh = unique.filter(p => !existingKeys.has(eventKey(p.date, p.title)));
            }
            const duplicates = upcoming.length - fresh.length;
            const notes = [];
            if (skippedPast) notes.push(`${skippedPast} vergangene Termine übersprungen`);
            if (duplicates) notes.push(`${duplicates} bereits vorhandene/doppelte Termine übersprungen`);
            if (withRule) notes.push(`${withRule} Termine mit Wiederholungsregel wurden nur einmal übernommen`);
            const noteText = notes.length ? `\n\nHinweis: ${notes.join('; ')}.` : '';
            if (!fresh.length) { alert(`Keine neuen Mülltermine importiert.${noteText}`); return; }

            const rows = fresh.map((p, idx) => {
                const unit = units.length ? units[idx % units.length] : null;
                return { user_id: user.id, property_id: selectedPropertyId, event_type: 'waste', title: p.title, event_date: p.date, waste_type: p.wasteType, color: WASTE_TYPES.find(w => w.key === p.wasteType)?.color || EC.waste, status: 'pending', push_enabled: true, assigned_unit_id: unit?.id || null, assigned_unit_name: unit?.unit_name || null };
            });
            const inserted = []; let insErr = null;
            for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
                const { data, error } = await supabase.from('objektkalender_events').insert(rows.slice(i, i + INSERT_CHUNK)).select();
                if (error) { insErr = error; break; }
                inserted.push(...(data || []));
            }
            if (inserted.length) setEvents(prev => [...prev, ...inserted.filter(inLoadedRange)].sort(byEventDate));
            if (insErr) alert(`${inserted.length} von ${rows.length} Mülltermine importiert. Fehler: ${translateError(insErr)}${noteText}`);
            else alert(`${inserted.length} Mülltermine importiert.${noteText}`);
        } finally {
            setImporting(false);
        }
    };

    // ── Week Data ────────────────────────────────────────────
    const weekEvents = useMemo(() => { const s = toIso(weekDays[0]), e = toIso(weekDays[6]); return events.filter(ev => ev.event_date >= s && ev.event_date <= e); }, [events, weekDays]);

    // ── Year Grid ────────────────────────────────────────────
    const yearGrid = useMemo(() => {
        const grid = [];
        for (let m = 0; m < 12; m++) {
            const firstDay = new Date(viewYear, m, 1); const lastDay = new Date(viewYear, m + 1, 0);
            const startOffset = (firstDay.getDay() + 6) % 7; const days = [];
            for (let i = 0; i < startOffset; i++) days.push(null);
            for (let d = 1; d <= lastDay.getDate(); d++) {
                const iso = `${viewYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                days.push({ day: d, iso, events: events.filter(e => e.event_date === iso) });
            }
            grid.push({ month: m, days });
        }
        return grid;
    }, [events, viewYear]);

    // ── Mobile Month Data ────────────────────────────────────
    const mobileMonthDays = useMemo(() => {
        const firstDay = new Date(viewYear, mobileMonth, 1);
        const lastDay = new Date(viewYear, mobileMonth + 1, 0);
        const startOffset = (firstDay.getDay() + 6) % 7;
        const days = [];
        for (let i = 0; i < startOffset; i++) days.push(null);
        for (let d = 1; d <= lastDay.getDate(); d++) {
            const iso = `${viewYear}-${String(mobileMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            days.push({ day: d, iso, events: events.filter(e => e.event_date === iso) });
        }
        return days;
    }, [events, viewYear, mobileMonth]);

    const mobileAgendaEvents = useMemo(() => {
        if (selectedDay) return events.filter(e => e.event_date === selectedDay);
        // Default: show upcoming events for the shown month
        const prefix = `${viewYear}-${String(mobileMonth + 1).padStart(2, '0')}-`;
        return events.filter(e => e.event_date.startsWith(prefix) && e.event_date >= today).sort(byEventDate);
    }, [events, selectedDay, viewYear, mobileMonth, today]);

    const shiftMobileMonth = (delta) => {
        const next = mobileMonth + delta;
        if (next < 0) { setMobileMonth(11); setViewYear(y => y - 1); }
        else if (next > 11) { setMobileMonth(0); setViewYear(y => y + 1); }
        else setMobileMonth(next);
        setSelectedDay(null);
    };

    // ── Mobile Google Calendar View ──────────────────────────
    const renderMobileView = () => {
        const selDayDate = selectedDay ? parseIsoLocal(selectedDay) : null;
        return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Month Header - Compact like Google Calendar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', marginBottom: '2px' }}>
                    <button className="cal-nav" onClick={() => shiftMobileMonth(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-primary)', borderRadius: '50%', minHeight: 'auto' }}><ChevronLeft size={18} /></button>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>{MONTHS[mobileMonth]} {viewYear}</div>
                    </div>
                    <button className="cal-nav" onClick={() => shiftMobileMonth(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: 'var(--text-primary)', borderRadius: '50%', minHeight: 'auto' }}><ChevronRight size={18} /></button>
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
                                {showDate && <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '2px', fontWeight: 600 }}>{fmtIso(e.event_date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>}
                                {renderEventBadge(e)}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // ── PDF Export (opens in new tab) ────────────────────────
    const handleExportPdf = async () => {
        // Fenster sofort (innerhalb der Klick-Geste) öffnen – nach einem await blockt der Popup-Blocker
        const w = window.open('', '_blank');
        if (!w) { alert('Das Druckfenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.'); return; }
        try { w.opener = null; } catch { /* ignore */ }
        w.document.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Objektkalender</title></head><body style="font-family:sans-serif;padding:24px;color:#64748b">PDF wird vorbereitet…</body></html>');
        w.document.close();
        try {
            const prop = properties.find(p => p.id === selectedPropertyId);
            const propLabel = prop ? `${prop.street || ''} ${prop.house_number || ''}`.trim() : '';
            // Resolve the correct PDF template for this property's portfolio
            let tpl = pdfTemplate;
            if (prop?.portfolio_id) {
                try { tpl = await fetchPdfTemplate(prop.portfolio_id, 'immobilien'); } catch { tpl = pdfTemplate; }
            }
            const logoUrl = safeImageUrl(tpl?.logoUrl);
            const accent = safeColor(tpl?.accentColor, '#0ea5e9');
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
            const docTitle = escapeHtml(`Objektkalender ${viewYear}${propLabel ? ` – ${propLabel}` : ''}`);
            const headHtml = `<div class="head"><h1>Objektkalender ${viewYear}${propLabel ? `<span class="sub">${escapeHtml(propLabel)}</span>` : ''}</h1>${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : ''}</div>`;
            const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${docTitle}</title><style>${openSansFontFaceCss()}</style><style>@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:'Open Sans',Arial,sans-serif;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{.no-print{display:none!important}}@media screen{body{padding:20px;background:#f1f5f9}}.head{display:flex;align-items:center;justify-content:space-between;gap:6mm;margin-bottom:3mm;padding-bottom:1.5mm;border-bottom:0.6mm solid ${accent}}.head h1{margin:0;font-size:11pt;font-weight:700}.head .sub{margin-left:3mm;font-size:8pt;font-weight:400;color:#64748b}.head img{max-height:9mm;max-width:45mm;object-fit:contain}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.legend{display:flex;gap:12px;margin-top:3mm;font-size:7pt;color:#64748b}.legend-item{display:flex;align-items:center;gap:3px}.dot{width:6px;height:6px;border-radius:50%;display:inline-block}</style></head><body><div class="no-print" style="text-align:center;padding:12px 0 20px"><button onclick="window.print()" style="padding:10px 28px;font-size:14px;font-weight:600;background:#0ea5e9;color:white;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15)">🖨️ Als PDF drucken / speichern</button><p style="margin-top:8px;font-size:12px;color:#94a3b8">Drücke Strg+P oder klicke den Button. Wähle "Als PDF speichern" im Druckdialog.</p></div>${headHtml}<div class="grid">${monthsHtml}</div><div class="legend"><div class="legend-item"><span class="dot" style="background:${EC.cleaning}"></span> Reinigung</div><div class="legend-item"><span class="dot" style="background:${EC.waste}"></span> Müll</div><div class="legend-item"><span class="dot" style="background:${EC.custom}"></span> Zusatzaufgabe</div></div></body></html>`;
            if (w.closed) return;
            w.document.open(); w.document.write(html); w.document.close();
            setTimeout(() => { try { if (!w.closed) w.print(); } catch { /* Fenster bereits geschlossen */ } }, 600);
        } catch (err) {
            try { w.close(); } catch { /* ignore */ }
            alert(`Der PDF-Export ist fehlgeschlagen: ${err?.message || err}`);
        }
    };

    // ── Styles ───────────────────────────────────────────────
    const labelSt = { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' };
    const selectSt = { padding: '8px 12px', borderRadius: '8px', border: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', width: '100%' };
    const inputSt = { ...selectSt };
    const tabSt = (a) => ({ padding: '8px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: a ? 600 : 400, background: a ? 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(14,165,233,0.08))' : 'transparent', color: a ? 'var(--primary-color)' : 'var(--text-secondary)', transition: 'all 0.25s', ...(a ? { boxShadow: '0 0 0 1px rgba(14,165,233,0.2)' } : {}) });
    const toggleSt = (on) => ({ width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer', background: on ? 'var(--primary-color)' : '#D1D5DB', position: 'relative', transition: 'background 0.2s', flexShrink: 0 });
    const toggleDot = (on) => ({ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', left: on ? '20px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' });
    const navBtnSt = { ...glass, padding: '8px 12px', cursor: 'pointer', color: 'var(--text-primary)', borderRadius: '10px' };

    // ── Event Badge ──────────────────────────────────────────
    const renderEventBadge = (event, key) => {
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
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: isMyUnit ? '12px 16px' : '10px 14px', borderRadius: '12px', background: `${bgColor}10`, borderLeft: `3px solid ${bgColor}`, marginBottom: '6px', fontSize: '0.82rem', ...myUnitStyle }}>
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
                    {!isDone && canMarkDone && <button onClick={() => handleMarkDone(event)} disabled={!!markingId} style={{ background: EC.done, color: '#fff', border: 'none', borderRadius: '8px', padding: '5px 12px', cursor: markingId ? 'wait' : 'pointer', opacity: markingId === event.id ? 0.6 : 1, fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}><Check size={12} /> Erledigt</button>}
                    {isInvestor && <button onClick={() => handleDeleteEvent(event)} style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '5px 7px', cursor: 'pointer', color: 'var(--text-secondary)' }}><Trash2 size={12} /></button>}
                </div>
            </div>
        );
    };

    // ── Day Detail Overlay ───────────────────────────────────
    const renderDayDetail = () => {
        if (!selectedDay) return null;
        const dayEvents = events.filter(e => e.event_date === selectedDay);
        const d = parseIsoLocal(selectedDay);
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setSelectedDay(null)}>
                <div style={{ ...glassCard({ padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }), background: 'var(--surface-color)' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>{WEEKDAY_FULL[(d.getDay() + 6) % 7]}, {d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}</h3>
                        <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}><X size={18} /></button>
                    </div>
                    {dayEvents.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px', fontSize: '0.88rem' }}>Keine Termine an diesem Tag.</div>}
                    {dayEvents.map(e => renderEventBadge(e, e.id))}
                </div>
            </div>
        );
    };

    // ── Delete Confirm Dialog ────────────────────────────────
    const renderDeleteConfirm = () => deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => { if (!deleting) setDeleteConfirm(null); }}>
            <div style={{ background: 'var(--surface-color)', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)' }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontWeight: 700, marginBottom: '8px', fontSize: '1rem' }}>Termin löschen</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>
                    „{deleteConfirm.title}“ am {fmtIso(deleteConfirm.event_date)}
                    {deleteConfirm.assigned_unit_name && <span> – {deleteConfirm.assigned_unit_name}</span>}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button disabled={deleting} onClick={() => executeDelete('single')} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', cursor: deleting ? 'wait' : 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 500 }}>
                        🗑️ Nur diesen Termin löschen
                    </button>
                    <button disabled={deleting} onClick={() => executeDelete('future')} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', cursor: deleting ? 'wait' : 'pointer', textAlign: 'left', color: '#EF4444', fontSize: '0.88rem', fontWeight: 500 }}>
                        🗑️ Diesen + alle zukünftigen löschen
                    </button>
                    <button disabled={deleting} onClick={() => setDeleteConfirm(null)} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                        {deleting ? 'Wird gelöscht…' : 'Abbrechen'}
                    </button>
                </div>
            </div>
        </div>
    );

    // ── Fehler- und Hinweisleisten ───────────────────────────
    const renderErrors = () => {
        const msgs = [propsError, dataError, eventsError].filter(Boolean);
        if (!msgs.length) return null;
        return (
            <div style={{ ...glassCard({ padding: '12px 16px', marginBottom: '16px' }), background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.83rem', color: 'var(--text-primary)', flexWrap: 'wrap' }}>
                <AlertTriangle size={16} color={EC.overdue} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: '200px' }}>{msgs.map((m, i) => <div key={i}>{m}</div>)}</div>
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setReloadKey(k => k + 1)}>Erneut laden</Button>
            </div>
        );
    };

    const renderPlanHint = () => {
        if (!isInvestor || loading || !savedSettings?.cleaning_active || savedSettings.cleaning_performer === 'janitor' || !units.length || cleaningPlanEnd === undefined) return null;
        if (cleaningPlanEnd && cleaningPlanEnd >= toIso(addDays(new Date(), PLAN_HINT_DAYS))) return null;
        return (
            <div style={{ ...glassBlue({ padding: '12px 16px', marginBottom: '16px' }), display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.83rem', flexWrap: 'wrap' }}>
                <Sparkles size={16} color={EC.cleaning} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: '200px' }}>
                    {cleaningPlanEnd
                        ? `Der Reinigungsplan ist nur bis ${fmtIso(cleaningPlanEnd, { day: '2-digit', month: '2-digit', year: 'numeric' })} angelegt.`
                        : 'Für die Treppenhausreinigung sind noch keine Termine angelegt.'}
                </span>
                <Button size="sm" onClick={handleExtendPlan} disabled={saving}>{saving ? 'Wird erstellt…' : 'Plan fortschreiben'}</Button>
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
                        <Button size="sm" onClick={() => { setSettings(savedSettings); setShowSettings(false); }} variant="secondary" disabled={saving}>Abbrechen</Button>
                        <Button size="sm" onClick={handleSaveSettings} disabled={saving || loading}>{saving ? 'Speichern…' : 'Speichern'}</Button>
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
                            <div><label style={labelSt}>Wochentag</label><select style={selectSt} value={settings.cleaning_weekday} onChange={e => u('cleaning_weekday', normalizeWeekday(e.target.value))}>{WEEKDAY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                        </div>
                    )}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '10px' }}>
                        Beim Speichern werden die offenen, künftigen Reinigungstermine bis 31.12.{thisYear + 1} neu geplant; erledigte Termine bleiben erhalten.
                    </div>
                </div>
                <div style={{ ...glassBlue(), padding: '16px', borderRadius: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <h4 style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Droplets size={16} color={EC.waste} /> Mülltermine</h4>
                        <button style={toggleSt(settings.waste_active)} onClick={() => u('waste_active', !settings.waste_active)}><div style={toggleDot(settings.waste_active)} /></button>
                    </div>
                    {settings.waste_active && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                            <div><label style={labelSt}>Durchführung</label><select style={selectSt} value={settings.waste_performer} onChange={e => u('waste_performer', e.target.value)}><option value="tenant">Mieter (Rotation)</option><option value="janitor">Hausmeisterdienst</option></select></div>
                            <div><label style={labelSt}>ICS importieren</label><input ref={fileInputRef} type="file" accept=".ics,text/calendar" onChange={handleIcsImport} style={{ display: 'none' }} /><Button size="sm" variant="secondary" icon={Upload} disabled={importing || loading} onClick={() => fileInputRef.current?.click()}>{importing ? 'Importiere…' : 'ICS importieren'}</Button></div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ── Task Modal ───────────────────────────────────────────
    const renderTaskModal = () => (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => { if (!addingTask) setShowTaskModal(false); }}>
            <div style={{ background: 'var(--surface-color)', borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)' }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontWeight: 700, marginBottom: '16px', fontSize: '1rem' }}>Neue Zusatzaufgabe</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div><label style={labelSt}>Titel *</label><input style={inputSt} value={taskForm.title} maxLength={200} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="z.B. Winterdienst" /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div><label style={labelSt}>Datum</label><input type="date" style={inputSt} value={taskForm.event_date} onChange={e => setTaskForm(p => ({ ...p, event_date: e.target.value }))} /></div>
                        <div><label style={labelSt}>Farbe</label><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><input type="color" value={taskForm.color} onChange={e => setTaskForm(p => ({ ...p, color: e.target.value }))} style={{ width: '36px', height: '36px', border: 'none', cursor: 'pointer', borderRadius: '8px' }} /><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{taskForm.color}</span></div></div>
                    </div>
                    <div><label style={labelSt}>Einheit</label><select style={selectSt} value={taskForm.assigned_unit_id} onChange={e => setTaskForm(p => ({ ...p, assigned_unit_id: e.target.value }))}><option value="">– Keine –</option>{units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}</select></div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: '0.85rem' }}>Wiederkehrend</span><button style={toggleSt(taskForm.recurring)} onClick={() => setTaskForm(p => ({ ...p, recurring: !p.recurring }))}><div style={toggleDot(taskForm.recurring)} /></button></div>
                    {taskForm.recurring && <div><label style={labelSt}>Frequenz</label><select style={selectSt} value={taskForm.recurrence_rule} onChange={e => setTaskForm(p => ({ ...p, recurrence_rule: e.target.value }))}><option value="weekly">Wöchentlich</option><option value="biweekly">Alle 2 Wochen</option><option value="monthly">Monatlich</option></select><div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Termine werden bis Ende des Folgejahres angelegt.</div></div>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: '0.85rem' }}>Push-Erinnerung</span><button style={toggleSt(taskForm.push_enabled)} onClick={() => setTaskForm(p => ({ ...p, push_enabled: !p.push_enabled }))}><div style={toggleDot(taskForm.push_enabled)} /></button></div>
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <Button variant="secondary" onClick={() => setShowTaskModal(false)} disabled={addingTask}>Abbrechen</Button>
                    <Button onClick={handleAddTask} disabled={addingTask}>{addingTask ? 'Wird erstellt…' : 'Erstellen'}</Button>
                </div>
            </div>
        </div>
    );

    // ── Week View ────────────────────────────────────────────
    const renderWeekView = () => (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <button onClick={() => setWeekOffset(p => p - 1)} style={navBtnSt}><ChevronLeft size={16} /></button>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {weekDays[0].toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} – {weekDays[6].toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background: 'rgba(14,165,233,0.1)', border: 'none', cursor: 'pointer', fontSize: '0.73rem', color: 'var(--primary-color)', fontWeight: 600, padding: '3px 10px', borderRadius: '6px' }}>Heute</button>}
                </div>
                <button onClick={() => setWeekOffset(p => p + 1)} style={navBtnSt}><ChevronRight size={16} /></button>
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
                        {dayEv.map(e => renderEventBadge(e, e.id))}
                        {dayEv.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Termine</div>}
                    </div>
                );
            })}
        </div>
    );

    // ── Year View with Clickable Months & Days ───────────────
    const renderYearView = () => (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
                <button onClick={() => { setViewYear(y => y - 1); setSelectedMonth(null); }} style={navBtnSt} title="Vorheriges Jahr"><ChevronLeft size={16} /></button>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', minWidth: '48px', textAlign: 'center' }}>{viewYear}</div>
                <button onClick={() => { setViewYear(y => y + 1); setSelectedMonth(null); }} style={navBtnSt} title="Nächstes Jahr"><ChevronRight size={16} /></button>
                {viewYear !== thisYear && <button onClick={() => { setViewYear(thisYear); setSelectedMonth(null); }} style={{ background: 'rgba(14,165,233,0.1)', border: 'none', cursor: 'pointer', fontSize: '0.73rem', color: 'var(--primary-color)', fontWeight: 600, padding: '3px 10px', borderRadius: '6px' }}>Aktuelles Jahr</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: isMobile ? '12px' : '16px' }}>
                {yearGrid.map(({ month, days }) => {
                    const isExpanded = selectedMonth === month;
                    const monthPrefix = `${viewYear}-${String(month + 1).padStart(2, '0')}-`;
                    const monthEvents = events.filter(e => e.event_date.startsWith(monthPrefix)).sort(byEventDate);
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
                                    {monthEvents.map(e => (
                                        <div key={e.id} style={{ marginBottom: '4px' }}>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{fmtIso(e.event_date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
                                            {renderEventBadge(e)}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {isExpanded && monthEvents.length === 0 && <div style={{ marginTop: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem', fontStyle: 'italic', padding: '12px 0' }}>Keine Termine im {MONTHS[month]}.</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    // ── History View ─────────────────────────────────────────
    const renderHistory = () => (
        <div>
            {history.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px', fontSize: '0.9rem' }}>Noch keine Historie.</div>}
            {history.map(h => {
                const st = HISTORY_STATUS[h.status] || { label: h.status || '–', color: 'var(--text-secondary)' };
                return (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '12px', ...glass, marginBottom: '6px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: st.color, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>{h.title}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{fmtIso(h.event_date)} {h.assigned_unit_name && `· ${h.assigned_unit_name}`}</div>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: st.color }}>{st.label}</span>
                    </div>
                );
            })}
        </div>
    );

    // ── Render ────────────────────────────────────────────────
    const contentLoading = loading || eventsLoading;
    if (!propertiesLoaded) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Objektkalender…</div>;
    if (!properties.length) return (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {renderErrors()}
            {isInvestor ? 'Keine Immobilie vorhanden. Legen Sie zuerst eine Immobilie an, um den Objektkalender zu nutzen.' : 'Ihrem Zugang ist keine Immobilie zugeordnet.'}
        </div>
    );

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
            {renderErrors()}
            {renderPlanHint()}
            {showSettings && isInvestor && renderSettings()}
            <div style={glassCard()}>
                {contentLoading ? <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Termine…</div> : renderMobileView()}
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
            {renderDeleteConfirm()}
        </div>
    );

    // ── Desktop Render ────────────────────────────────────────
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

            {renderErrors()}
            {renderPlanHint()}
            {showSettings && isInvestor && renderSettings()}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap', ...glassCard({ padding: '6px', display: 'inline-flex' }), borderRadius: '14px' }}>
                <button style={tabSt(tab === 'week')} onClick={() => setTab('week')}>Diese Woche</button>
                <button style={tabSt(tab === 'year')} onClick={() => setTab('year')}>Jahr {viewYear}</button>
                <button style={tabSt(tab === 'history')} onClick={() => setTab('history')}><Clock size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} /> Historie</button>
            </div>

            {/* Content */}
            <div style={glassCard()}>
                {contentLoading ? <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Termine…</div> : <>
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
            {renderDeleteConfirm()}
            {renderDayDetail()}
        </div>
    );
};

export default ObjectCalendar;
