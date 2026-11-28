import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import {
    Plus, Loader2, ChevronDown, ChevronRight, Edit2, Trash2,
    Download, ArrowLeft, ArrowRight, Save, Check, X, FileText,
    MoreVertical, RotateCcw, AlertTriangle, Info, RefreshCw, Gauge, Lock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { usePermission } from '../context/PermissionContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';
import {
    addDaysISO, buildCalculationSnapshot, buildLetterData, buildUnitOccupancy, centsToEuro,
    computeMeterConsumption, computeSettlement, convertLegacyUnitCosts, expandItemParts, formatCents, formatDateDE,
    formatEUR, formatNumberDE, HEATING_SPLIT_KEY_ID, HEATING_SPLIT_MAX_SHARE, HEATING_SPLIT_MIN_SHARE,
    isValidISODate, KEY_TYPE_INFO, localISODate, parseConsumptionShare, parseNumber, periodsOverlap,
    renderSettlementDocument, resolveDistributionKey, settlementDeadline, settlementYearLabel,
    toCents, validatePeriod
} from '../lib/utilitySettlement';
import { loadHtml2Pdf } from '../lib/htmlToPdf';

// Zeitstempel (created_at, finalized_at) als lokales Datum
const formatTimestamp = (ts) => (ts ? formatDateDE(localISODate(new Date(ts))) : '–');

const newId = () => (globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);

// Fehler "Tabelle/Spalte/Funktion existiert (noch) nicht" -> bisheriger Weg
const MISSING_FEATURE_CODES = new Set(['42P01', '42703', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205']);
const isMissingFeatureError = (error) => !!error && (
    MISSING_FEATURE_CODES.has(error.code) || /does not exist|could not find/i.test(error.message || '')
);

// Lädt alle Zeilen seitenweise (PostgREST liefert sonst höchstens 1000 Zeilen)
const fetchAllRows = async (makeQuery, pageSize = 1000) => {
    const all = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await makeQuery().range(from, from + pageSize - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }
    return all;
};

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

const parseSettlementData = (s) => {
    if (!s?.data) return {};
    if (typeof s.data === 'string') {
        try { return JSON.parse(s.data) || {}; } catch { return {}; }
    }
    return s.data;
};

// Festgeschriebene Rechengrundlagen: eigene Spalte (ab Migration 101300), sonst in data
const getSnapshot = (s) => s?.calculation_snapshot || parseSettlementData(s)?.calculation_snapshot || null;

const isBookedItem = (ci) => ci.source === 'expenses' || (!ci.source && !!ci.category_id);

// Buchungs-Positionen neu übernehmen: gleiche Kategorie/Einheit behält ID, Schlüssel
// und Verbrauchswerte; manuelle Positionen bleiben unverändert.
const mergeBookedCosts = (existing, fresh) => {
    const used = new Set();
    const result = [];
    const dropped = [];
    existing.forEach(ci => {
        if (!isBookedItem(ci)) { result.push(ci); return; }
        const match = fresh.find(f => !used.has(f.id) && f.category_id === (ci.category_id || 'other') && (f.unit_id || null) === (ci.unit_id || null));
        if (!match) { dropped.push(ci.category_name || 'Kostenart'); return; }
        used.add(match.id);
        result.push({ ...ci, amount: match.amount, unit_id: match.unit_id, source: 'expenses', booking_count: match.booking_count });
    });
    fresh.forEach(f => { if (!used.has(f.id)) result.push(f); });
    return { items: result, dropped };
};

const bookedTotalCents = (items) => items.filter(isBookedItem).reduce((s, ci) => s + toCents(ci.amount), 0);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Vor dem Rendern auf die Briefschrift warten (sonst Umbruch mit Ersatzschrift)
const waitForFonts = async () => {
    if (!document.fonts) return;
    try {
        await Promise.race([
            Promise.all(['400 11pt "Open Sans"', '600 11pt "Open Sans"', '700 11pt "Open Sans"'].map(f => document.fonts.load(f)))
                .then(() => document.fonts.ready),
            sleep(3000)
        ]);
    } catch { /* Schrift nicht verfügbar – Ersatzschrift */ }
};

// docHtml ist bereits bereinigt (Vorlage per sanitizeTemplateHtml, Werte als Text/escaped)
const renderPdf = async (docHtml, filename) => {
    const html2pdf = await loadHtml2Pdf();
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '210mm', backgroundColor: '#ffffff', pointerEvents: 'none' });
    host.innerHTML = docHtml;
    document.body.appendChild(host);
    try {
        await waitForFonts();
        await sleep(50);
        await html2pdf().set({
            margin: 0,
            filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css'] }
        }).from(host.firstElementChild).save();
    } finally {
        host.remove();
    }
};

const safeFilePart = (s) => String(s || '').trim()
    .replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

const KEY_ABBR = { area: 'Fläche', persons: 'Pers.', units: 'Einh.', equal: 'Gleich', custom: 'Verbr.', mea: 'MEA', direct: 'Direkt', heating_split: 'HeizkV' };
const keyOptionLabel = (k) => (k.name || KEY_ABBR[k.calculation_type] || 'Schlüssel');

const ISSUE_STYLE = {
    error: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b', Icon: AlertTriangle },
    warning: { bg: '#fffbeb', border: '#fde68a', color: '#92400e', Icon: AlertTriangle },
    info: { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af', Icon: Info }
};

const IssueList = ({ issues }) => {
    if (!issues || issues.length === 0) return null;
    return (
        <div style={{ display: 'grid', gap: '6px', marginBottom: '1rem' }}>
            {issues.map((iss, i) => {
                const st = ISSUE_STYLE[iss.level] || ISSUE_STYLE.info;
                const Icon = st.Icon;
                return (
                    <div key={i} style={{
                        display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 12px',
                        borderRadius: 'var(--radius-md)', fontSize: '0.8rem', lineHeight: 1.4,
                        border: `1px solid ${st.border}`, backgroundColor: st.bg, color: st.color
                    }}>
                        <Icon size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                        <span>{iss.text}</span>
                    </div>
                );
            })}
        </div>
    );
};

const StatusBadge = ({ status, frozen }) => {
    const map = {
        'done': { label: 'Fertig', variant: 'success' },
        'draft': { label: 'Entwurf', variant: 'default' },
        'in_progress': { label: 'In Bearbeitung', variant: 'warning' },
        'open': { label: 'Noch offen', variant: 'danger' }
    };
    const info = map[status] || map['open'];
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title={status === 'done' ? (frozen ? 'Rechengrundlagen festgeschrieben' : 'Abgeschlossen vor Einführung der Festschreibung') : undefined}>
            <Badge variant={info.variant}>{info.label}</Badge>
            {status === 'done' && frozen && <Lock size={12} style={{ color: 'var(--text-secondary)' }} />}
        </span>
    );
};

const smallLabel = { fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' };
const thStyle = { textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' };
const thRight = { ...thStyle, textAlign: 'right' };

const textareaStyle = (focused) => ({
    width: focused ? 'calc(100% + 200px)' : '100%',
    position: focused ? 'absolute' : 'static',
    zIndex: focused ? 20 : 'auto',
    boxShadow: focused ? '0 4px 24px rgba(0,0,0,0.18)' : 'none',
    padding: '6px 8px', borderRadius: '6px',
    border: `1px solid ${focused ? 'var(--primary-color)' : 'var(--border-color)'}`,
    fontWeight: 500, fontFamily: 'inherit', fontSize: '0.9rem', resize: 'none',
    color: 'var(--text-primary)', backgroundColor: 'var(--surface-color)',
    transition: 'all 0.2s ease', left: 0, top: 0
});

// ========== STEP INDICATOR ==========
const StepIndicator = ({ steps, currentStep, onStepClick }) => (
    <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', padding: '0 0.25rem' }}>
            {steps.map((step, i) => (
                <React.Fragment key={i}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: 0, cursor: onStepClick ? 'pointer' : 'default' }}
                        onClick={() => onStepClick && onStepClick(i)}>
                        <div style={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 600, fontSize: '0.8rem',
                            backgroundColor: i <= currentStep ? 'var(--primary-color)' : '#E5E7EB',
                            color: i <= currentStep ? '#fff' : '#6B7280',
                            transition: 'all 0.3s'
                        }}>
                            {i < currentStep ? <Check size={14} /> : i + 1}
                        </div>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: i === currentStep ? 700 : 400,
                            color: i <= currentStep ? 'var(--text-primary)' : 'var(--text-secondary)',
                            textAlign: 'center', lineHeight: 1.2, maxWidth: '80px',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                        }}>{step}</span>
                    </div>
                    {i < steps.length - 1 && (
                        <div style={{
                            flex: 1, height: 2, marginTop: '13px',
                            backgroundColor: i < currentStep ? 'var(--primary-color)' : '#E5E7EB',
                            transition: 'all 0.3s'
                        }} />
                    )}
                </React.Fragment>
            ))}
        </div>
    </div>
);

const EMPTY_OPTIONS = { includeHeatingPrepay: null, vacancyPersons: 1 };

// ========== MAIN COMPONENT ==========
const UtilityCosts = () => {
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const perm = usePermission();
    const { isMobile } = useViewMode();

    // Schreibrecht „Nebenkosten" im Portfolio des Objekts (Freigaben); die Datenbank prüft zusätzlich per RLS
    const canWriteNk = (portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId ? perm.canWrite('nebenkosten', portfolioId) : perm.canWrite('nebenkosten');
    };

    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [leases, setLeases] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [settlements, setSettlements] = useState([]);
    const [distributionKeys, setDistributionKeys] = useState([]);
    const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyDescription, setNewKeyDescription] = useState('');
    const [pendingKeyItemId, setPendingKeyItemId] = useState(null); // Kostenart, für die ein Schlüssel angelegt wird
    const [today] = useState(() => localISODate());

    // UI State
    const [expandedProperty, setExpandedProperty] = useState(null);
    const [openSettlementMenuId, setOpenSettlementMenuId] = useState(null);
    const [settlementMenuPos, setSettlementMenuPos] = useState(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [editingSettlement, setEditingSettlement] = useState(null);
    const [stepBusy, setStepBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pdfBusy, setPdfBusy] = useState(false);
    const [focusedField, setFocusedField] = useState(null);
    const [expandedValues, setExpandedValues] = useState({});
    const [meterTypeSel, setMeterTypeSel] = useState({});

    // Wizard Form State
    const [wizardPropertyId, setWizardPropertyId] = useState(null);
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [selectedUnitIds, setSelectedUnitIds] = useState([]);
    // Kostenarten: { id, category_id, category_name, amount, distribution_key, key_name, key_type,
    //                unit_id (Buchung mit Einheitenbezug), source, unit_values, consumption_unit, meter_type }
    const [costItems, setCostItems] = useState([]);
    // Manuelle Korrekturen je Einheit/Kostenart: { [unitId]: { [costItemId]: { amount?, label?, removed? } } }
    const [unitOverrides, setUnitOverrides] = useState({});
    // Zusätzliche Einzelpositionen je Einheit: { [unitId]: [{ id, label, amount, isCustom: true }] }
    const [customRows, setCustomRows] = useState({});
    // Überschriebene Vorauszahlungen je Mietvertrag: { [leaseId]: { svc?, heat? } }
    const [prepayOverrides, setPrepayOverrides] = useState({});
    const [settlementOptions, setSettlementOptions] = useState(EMPTY_OPTIONS);
    const [loadedFor, setLoadedFor] = useState(null);
    const [bookingInfo, setBookingInfo] = useState(null);
    const [meterInfo, setMeterInfo] = useState(null);
    const [prepayData, setPrepayData] = useState(null);
    const [reviewUnit, setReviewUnit] = useState(null);
    const [step3SelectedUnit, setStep3SelectedUnit] = useState(null);

    const stepLabels = ['Einheiten', 'Kosten', 'Verteilung', 'Abschluss'];

    // ===== FETCH DATA =====
    useEffect(() => {
        if (user) fetchData();
    }, [user, selectedPortfolioID]);
    // Menu close on outside click is handled by the backdrop overlay in JSX

    const fetchData = async () => {
        setLoading(true);
        setLoadError('');
        const problems = [];
        const safe = async (label, fn) => {
            try { return await fn(); } catch (error) {
                console.error(`UtilityCosts: ${label} nicht ladbar`, error);
                problems.push(label);
                return null;
            }
        };
        try {
            const props = (await safe('Objekte', () => fetchAllRows(() => {
                let q = supabase.from('properties').select('*').order('id');
                if (selectedPortfolioID) q = q.eq('portfolio_id', selectedPortfolioID);
                return q;
            }))) || [];
            const propIds = props.map(p => p.id);

            const [unitRows, leaseRows, tenantRows, settlementRows, keyRows] = await Promise.all([
                safe('Einheiten', async () => {
                    if (!selectedPortfolioID) return fetchAllRows(() => supabase.from('units').select('*, property:properties(*)').order('id'));
                    const out = [];
                    for (const ids of chunk(propIds, 100)) {
                        out.push(...await fetchAllRows(() => supabase.from('units').select('*, property:properties(*)').in('property_id', ids).order('id')));
                    }
                    return out;
                }),
                safe('Mietverträge', () => fetchAllRows(() => supabase.from('leases')
                    .select('*, unit:units(id, property_id, unit_name, property:properties(id, portfolio_id, economic_unit_id)), tenant:tenants(*)')
                    .order('id'))),
                safe('Mieter', () => fetchAllRows(() => supabase.from('tenants').select('*').order('id'))),
                safe('Abrechnungen', () => fetchAllRows(() => supabase.from('utility_settlements').select('*').order('created_at', { ascending: false }).order('id'))),
                // Kein Client-Filter: die RLS liefert eigene, Standard- und freigegebene Schlüssel des Inhabers
                safe('Verteilerschlüssel', () => fetchAllRows(() => supabase.from('distribution_keys').select('*').order('id')))
            ]);

            let allUnits = unitRows || [];
            let allLeases = leaseRows || [];
            let allSettlements = settlementRows || [];

            if (selectedPortfolioID) {
                allUnits = allUnits.filter(u => propIds.includes(u.property_id));
                allLeases = allLeases.filter(l => l.unit?.property?.portfolio_id === selectedPortfolioID);
                // Abrechnungen über Objekt ODER Wirtschaftseinheit zuordnen
                const economicUnitIds = Array.from(new Set(props.map(p => p.economic_unit_id).filter(Boolean)));
                allSettlements = allSettlements.filter(s => propIds.includes(s.property_id) || (s.economic_unit_id && economicUnitIds.includes(s.economic_unit_id)));
            }

            setProperties([...props].sort((a, b) => (a.street || '').localeCompare(b.street || '')));
            setUnits([...allUnits].sort((a, b) => (a.unit_name || '').localeCompare(b.unit_name || '')));
            setLeases(allLeases);
            setTenants(tenantRows || []);
            setSettlements(allSettlements);
            setDistributionKeys([...(keyRows || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
            if (problems.length) {
                setLoadError(`Folgende Daten konnten nicht geladen werden: ${problems.join(', ')}. Die Anzeige ist möglicherweise unvollständig – bitte Seite neu laden.`);
            }
        } finally {
            setLoading(false);
        }
    };

    // ===== DERIVED LOOKUPS =====
    const tenantsById = useMemo(() => Object.fromEntries(tenants.map(t => [t.id, t])), [tenants]);
    const propertiesById = useMemo(() => Object.fromEntries(properties.map(p => [p.id, p])), [properties]);
    const portfoliosById = useMemo(() => Object.fromEntries((portfolios || []).map(p => [p.id, p])), [portfolios]);

    // Portfolio einer Objektzeile (Einzelobjekt oder Wirtschaftseinheit) bzw. einer Abrechnung
    const groupPortfolioId = (group) => (group?.isGroup ? group.properties?.[0]?.portfolio_id : group?.portfolio_id) || null;
    const settlementPortfolioId = (s) => propertiesById[s?.property_id]?.portfolio_id
        || (s?.economic_unit_id ? properties.find(p => p.economic_unit_id === s.economic_unit_id)?.portfolio_id : null)
        || null;
    const canWriteSettlement = (s) => canWriteNk(settlementPortfolioId(s));
    const READ_ONLY_NOTICE = 'Für dieses Objekt haben Sie nur Leserechte (Freigabe). Nebenkostenabrechnungen können nur mit Schreibrecht „Nebenkosten“ angelegt, geändert oder gelöscht werden.';

    const houseUnitsFor = (propKey) => {
        if (!propKey) return [];
        if (propKey.startsWith('we_')) {
            const weId = propKey.replace('we_', '');
            return units.filter(u => u.property?.economic_unit_id === weId);
        }
        return units.filter(u => u.property_id === propKey);
    };

    const propertyIdsFor = (propKey) => {
        if (!propKey) return [];
        if (propKey.startsWith('we_')) {
            const weId = propKey.replace('we_', '');
            return properties.filter(p => p.economic_unit_id === weId).map(p => p.id);
        }
        return [propKey];
    };

    const leaseIdsInPeriod = (unitIds, start, end) => leases
        .filter(l => unitIds.includes(l.unit_id) && periodsOverlap(l.start_date, l.end_date || '9999-12-31', start, end))
        .map(l => l.id)
        .sort();

    // ===== WIZARD HELPERS =====
    const propertyUnits = useMemo(() => {
        if (!wizardPropertyId) return [];
        if (wizardPropertyId.startsWith('we_')) {
            const weId = wizardPropertyId.replace('we_', '');
            return units.filter(u => u.property?.economic_unit_id === weId);
        }
        return units.filter(u => u.property_id === wizardPropertyId);
    }, [units, wizardPropertyId]);

    const relevantLeaseIds = useMemo(() => leases
        .filter(l => selectedUnitIds.includes(l.unit_id) && periodsOverlap(l.start_date, l.end_date || '9999-12-31', periodStart, periodEnd))
        .map(l => l.id)
        .sort(), [leases, selectedUnitIds, periodStart, periodEnd]);
    const prepayKey = `${periodStart}|${periodEnd}|${relevantLeaseIds.join(',')}`;

    // Gesamte Berechnung als abgeleiteter Wert (keine kopierten Zwischenstände)
    const settlementResult = useMemo(() => {
        if (!wizardOpen) return null;
        return computeSettlement({
            periodStart, periodEnd, houseUnits: propertyUnits, selectedUnitIds, leases, tenantsById,
            distributionKeys, costItems, unitOverrides, customRows, prepayOverrides,
            options: settlementOptions,
            prepayData: prepayData && prepayData.key === prepayKey ? prepayData : null,
            today
        });
    }, [wizardOpen, periodStart, periodEnd, propertyUnits, selectedUnitIds, leases, tenantsById, distributionKeys,
        costItems, unitOverrides, customRows, prepayOverrides, settlementOptions, prepayData, prepayKey, today]);

    // Group properties into groupedProperties (including standalone properties)
    const groupedProperties = React.useMemo(() => {
        const groups = {};
        const result = [];

        properties.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = {
                        id: 'we_' + p.economic_unit_id,
                        isGroup: true,
                        economic_unit_id: p.economic_unit_id,
                        properties: []
                    };
                }
                groups[p.economic_unit_id].properties.push(p);
            } else {
                result.push({ ...p, isGroup: false });
            }
        });

        Object.values(groups).forEach(g => {
            if (g.properties.length > 0) {
                const uniqueProps = g.properties;
                if (uniqueProps.length === 1) {
                    result.push({ ...uniqueProps[0], isGroup: false });
                } else {
                    const streets = Array.from(new Set(uniqueProps.map(u => u.street).filter(Boolean)));
                    g.street = `Wirtschaftseinheit: ${streets.length > 0 ? streets.join(', ') : 'Diverse'}`;
                    g.house_number = Array.from(new Set(uniqueProps.map(u => u.house_number).filter(Boolean))).join(' & ');
                    const cities = Array.from(new Set(uniqueProps.map(u => u.city).filter(Boolean)));
                    g.city = cities.join(', ');
                    g.zip = uniqueProps[0].zip || '';
                    result.push(g);
                }
            }
        });

        return result.sort((a, b) => (a.street || '').localeCompare(b.street || ''));
    }, [properties]);

    const toggleUnit = (unitId) => {
        setSelectedUnitIds(prev =>
            prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]
        );
    };

    const toggleAllUnits = () => {
        if (selectedUnitIds.length === propertyUnits.length) {
            setSelectedUnitIds([]);
        } else {
            setSelectedUnitIds(propertyUnits.map(u => u.id));
        }
    };

    const resetWizardState = () => {
        setCostItems([]);
        setUnitOverrides({});
        setCustomRows({});
        setPrepayOverrides({});
        setSettlementOptions(EMPTY_OPTIONS);
        setLoadedFor(null);
        setBookingInfo(null);
        setMeterInfo(null);
        setPrepayData(null);
        setReviewUnit(null);
        setStep3SelectedUnit(null);
        setExpandedValues({});
        setMeterTypeSel({});
        setFocusedField(null);
    };

    const startNewSettlement = (propertyId) => {
        const group = groupedProperties.find(g => g.id === propertyId);
        if (!canWriteNk(group ? groupPortfolioId(group) : (propertiesById[propertyId]?.portfolio_id || null))) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        resetWizardState();
        setWizardPropertyId(propertyId);
        const year = new Date().getFullYear() - 1;
        setPeriodStart(`${year}-01-01`);
        setPeriodEnd(`${year}-12-31`);
        setSelectedUnitIds(houseUnitsFor(propertyId).map(u => u.id));
        setEditingSettlement(null);
        setWizardStep(0);
        setWizardOpen(true);
    };

    // Gespeicherte Abrechnung in den Arbeitsstand überführen (auch ältere Datenformate)
    const prepareSettlementState = (data, houseUnits) => {
        const preparedItems = (data.costItems || []).map(ci => ({
            ...ci,
            id: ci.id || newId(),
            source: ci.source || (ci.category_id ? 'expenses' : 'manual'),
            amount: parseNumber(ci.amount) ?? 0
        }));
        if ((data.version || 1) >= 2) {
            return {
                selectedUnitIds: data.selectedUnitIds || [],
                costItems: preparedItems,
                unitOverrides: data.unitOverrides || {},
                customRows: data.customRows || {}
            };
        }
        // Alte Entwürfe: abweichende Beträge gelten als Handkorrektur und bleiben erhalten
        const converted = convertLegacyUnitCosts({
            savedUnitCosts: data.unitCosts || {}, costItems: preparedItems, houseUnits, leases, distributionKeys, newId
        });
        return {
            selectedUnitIds: data.selectedUnitIds || [],
            costItems: preparedItems,
            unitOverrides: converted.unitOverrides,
            customRows: converted.customRows
        };
    };

    const editSettlement = (settlement) => {
        if (!canWriteSettlement(settlement)) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        if (settlement.status === 'done') {
            const msg = getSnapshot(settlement)
                ? 'Diese Abrechnung ist abgeschlossen und festgeschrieben.\n\nZur Bearbeitung wieder öffnen? Das festgeschriebene Ergebnis bleibt gültig, bis Sie die Abrechnung erneut fertigstellen. Beim Speichern als Entwurf wird die Festschreibung aufgehoben.'
                : 'Diese Abrechnung ist bereits abgeschlossen. Zur Bearbeitung wieder öffnen?';
            if (!confirm(msg)) return;
        }
        resetWizardState();
        const propKey = settlement.economic_unit_id ? `we_${settlement.economic_unit_id}` : settlement.property_id;
        const data = parseSettlementData(settlement);
        const prepared = prepareSettlementState(data, houseUnitsFor(propKey));
        setEditingSettlement(settlement);
        setWizardPropertyId(propKey);
        setPeriodStart(settlement.period_start);
        setPeriodEnd(settlement.period_end);
        setSelectedUnitIds(prepared.selectedUnitIds);
        setCostItems(prepared.costItems);
        setUnitOverrides(prepared.unitOverrides);
        setCustomRows(prepared.customRows);
        setPrepayOverrides(data.prepayOverrides || {});
        setSettlementOptions({ ...EMPTY_OPTIONS, ...(data.options || {}) });
        setLoadedFor(data.loadedFor || { key: propKey, start: settlement.period_start, end: settlement.period_end });
        setWizardStep(0);
        setWizardOpen(true);
    };

    // ===== BUCHUNGEN / ZÄHLER / ZAHLUNGEN LADEN =====
    // Nur umlagefähige Buchungen (Kategorie UND einzelne Buchung), Buchungen mit Einheitenbezug
    // werden direkt dieser Einheit zugeordnet statt auf das Haus verteilt.
    const loadBookedCosts = async (propKey, start, end) => {
        const pIds = propertyIdsFor(propKey);
        if (!pIds.length) return { items: [], excluded: [] };
        const rows = [];
        for (const ids of chunk(pIds, 100)) {
            rows.push(...await fetchAllRows(() => supabase.from('expenses')
                .select('id, amount, booking_date, category_id, property_id, unit_id, scope, is_allocatable, expense_categories(name, is_recoverable, distribution_key_id)')
                .in('property_id', ids)
                .gte('booking_date', start)
                .lte('booking_date', end)
                .order('id')));
        }
        const houseUnits = houseUnitsFor(propKey);
        const areaKey = distributionKeys.find(k => k.calculation_type === 'area');
        const groups = {};
        const excluded = [];
        rows.forEach(e => {
            const recoverable = e.expense_categories?.is_recoverable === true;
            if (!recoverable || e.is_allocatable !== true) {
                excluded.push({
                    cents: toCents(e.amount),
                    reason: !e.category_id ? 'ohne Kategorie' : (!recoverable ? 'Kategorie nicht umlagefähig' : 'als nicht umlagefähig markiert')
                });
                return;
            }
            const unitId = e.unit_id || null;
            const catId = e.category_id || 'other';
            const gk = `${catId}|${unitId || ''}`;
            if (!groups[gk]) {
                const catName = e.expense_categories?.name || 'Sonstige';
                const unit = unitId ? houseUnits.find(u => u.id === unitId) : null;
                groups[gk] = {
                    id: newId(), category_id: catId,
                    category_name: unitId ? `${catName} – ${unit?.unit_name || 'Einheit'}` : catName,
                    cents: 0,
                    distribution_key: e.expense_categories?.distribution_key_id || areaKey?.id || 'wohnflaeche',
                    unit_id: unitId, source: 'expenses', booking_count: 0
                };
            }
            groups[gk].cents += toCents(e.amount);
            groups[gk].booking_count += 1;
        });
        const items = Object.values(groups).map(({ cents, ...g }) => ({ ...g, amount: centsToEuro(cents) }));
        return { items, excluded };
    };

    const loadCostsForStep = async () => {
        const key = wizardPropertyId;
        const sameSource = !!loadedFor && loadedFor.key === key && loadedFor.start === periodStart && loadedFor.end === periodEnd;
        let res;
        try {
            res = await loadBookedCosts(key, periodStart, periodEnd);
        } catch (error) {
            setBookingInfo({ error: `Die Buchungen konnten nicht geladen werden: ${translateError(error)}` });
            return;
        }
        const reasons = {};
        res.excluded.forEach(x => { reasons[x.reason] = (reasons[x.reason] || 0) + 1; });
        const info = {
            excludedCount: res.excluded.length,
            excludedCents: res.excluded.reduce((s, x) => s + x.cents, 0),
            excludedReasons: reasons,
            freshItems: res.items,
            freshCents: bookedTotalCents(res.items),
            notice: '', differs: false
        };
        if (costItems.length === 0) {
            setCostItems(res.items);
            if (!res.items.length) info.notice = 'Für diesen Zeitraum wurden keine umlagefähigen Buchungen gefunden.';
            setLoadedFor({ key, start: periodStart, end: periodEnd });
        } else if (!sameSource) {
            const merged = mergeBookedCosts(costItems, res.items);
            setCostItems(merged.items);
            info.notice = 'Objekt oder Zeitraum wurde geändert – die Beträge wurden aus den Buchungen neu geladen (Verteilerschlüssel und manuelle Positionen bleiben erhalten).'
                + (merged.dropped.length ? ` Ohne Buchungen im neuen Zeitraum entfallen: ${merged.dropped.join(', ')}.` : '');
            setLoadedFor({ key, start: periodStart, end: periodEnd });
        } else {
            const current = bookedTotalCents(costItems);
            if (current !== info.freshCents) {
                info.differs = true;
                info.notice = `Die Buchungen im Zeitraum ergeben aktuell ${formatCents(info.freshCents)}, in dieser Abrechnung stehen ${formatCents(current)} aus Buchungen. Mit „Aus Buchungen neu laden" übernehmen Sie den aktuellen Stand.`;
            }
        }
        setBookingInfo(info);
    };

    const reloadFromBookings = () => {
        if (!bookingInfo?.freshItems) return;
        const merged = mergeBookedCosts(costItems, bookingInfo.freshItems);
        setCostItems(merged.items);
        setLoadedFor({ key: wizardPropertyId, start: periodStart, end: periodEnd });
        setBookingInfo({
            ...bookingInfo, differs: false,
            notice: 'Die Beträge wurden aus den Buchungen übernommen.' + (merged.dropped.length ? ` Entfallen: ${merged.dropped.join(', ')}.` : '')
        });
    };

    const loadMeterData = async (propKey, start, end) => {
        const key = `${propKey}|${start}|${end}`;
        try {
            const pIds = propertyIdsFor(propKey);
            const meters = [];
            for (const ids of chunk(pIds, 100)) {
                meters.push(...await fetchAllRows(() => supabase.from('meters')
                    .select('id, unit_id, property_id, meter_type, meter_number, meter_name, unit')
                    .in('property_id', ids).order('id')));
            }
            const unitMeters = meters.filter(m => m.unit_id);
            const readings = [];
            if (unitMeters.length) {
                const from = addDaysISO(start, -60);
                const to = addDaysISO(end, 60);
                for (const ids of chunk(unitMeters.map(m => m.id), 100)) {
                    readings.push(...await fetchAllRows(() => supabase.from('meter_readings')
                        .select('id, meter_id, reading_value, reading_date')
                        .in('meter_id', ids).gte('reading_date', from).lte('reading_date', to).order('id')));
                }
            }
            setMeterInfo({ key, meters: unitMeters, readings, error: '' });
        } catch (error) {
            setMeterInfo({ key, meters: [], readings: [], error: translateError(error) });
        }
    };

    // Zahlungseingänge (rent_payments) und Miethistorie (lease_rent_periods, ab Migration 100900)
    const loadPrepayData = async (leaseIds) => {
        const data = { loaded: true, historyAvailable: false, paymentsAvailable: false, rentPeriodsByLease: {}, paymentsByLease: {} };
        if (!leaseIds.length) return { ...data, historyAvailable: true, paymentsAvailable: true };
        try {
            for (const ids of chunk(leaseIds, 100)) {
                const rows = await fetchAllRows(() => supabase.from('rent_payments')
                    .select('id, lease_id, period_month, payment_date, amount')
                    .in('lease_id', ids).order('id'));
                rows.forEach(r => { (data.paymentsByLease[r.lease_id] = data.paymentsByLease[r.lease_id] || []).push(r); });
            }
            data.paymentsAvailable = true;
        } catch (error) {
            console.warn('Zahlungseingänge nicht ladbar:', error);
        }
        try {
            for (const ids of chunk(leaseIds, 100)) {
                const rows = await fetchAllRows(() => supabase.from('lease_rent_periods')
                    .select('id, lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs')
                    .in('lease_id', ids).order('id'));
                rows.forEach(r => { (data.rentPeriodsByLease[r.lease_id] = data.rentPeriodsByLease[r.lease_id] || []).push(r); });
            }
            data.historyAvailable = true;
        } catch (error) {
            if (!isMissingFeatureError(error)) console.warn('Miethistorie nicht ladbar:', error);
        }
        return data;
    };

    const ensurePrepayData = async () => {
        if (prepayData && prepayData.key === prepayKey && prepayData.loaded) return prepayData;
        const data = { ...(await loadPrepayData(relevantLeaseIds)), key: prepayKey };
        setPrepayData(data);
        return data;
    };

    // ===== KOSTENARTEN BEARBEITEN =====
    const updateCostItem = (id, fn) => setCostItems(prev => prev.map(ci => (ci.id === id ? fn(ci) : ci)));

    const setUnitValue = (itemId, unitId, value) => updateCostItem(itemId, ci => {
        const unit_values = { ...(ci.unit_values || {}) };
        const value_sources = { ...(ci.value_sources || {}) };
        if (value === null || value === undefined || Number.isNaN(value)) delete unit_values[unitId];
        else unit_values[unitId] = value;
        delete value_sources[unitId];
        return { ...ci, unit_values, value_sources };
    });

    const applyMeterValues = (itemId, meterType) => {
        if (!meterInfo || !meterType) return;
        const cons = computeMeterConsumption({ meters: meterInfo.meters, readings: meterInfo.readings, periodStart, periodEnd, meterType });
        const unitLabel = (meterInfo.meters.find(m => m.meter_type === meterType && m.unit) || {}).unit || '';
        const item = costItems.find(ci => ci.id === itemId);
        if (!item) return;
        // Außerhalb des State-Updaters rechnen (Updater laufen erst beim nächsten Rendern)
        const unit_values = { ...(item.unit_values || {}) };
        const value_sources = { ...(item.value_sources || {}) };
        let applied = 0;
        let incomplete = 0;
        propertyUnits.forEach(u => {
            const c = cons[u.id];
            if (!c) return;
            value_sources[u.id] = c.details.map(d => (d.error
                ? `${d.meter}: ${d.error}`
                : `${d.meter}: ${formatDateDE(d.start.date)} ${formatNumberDE(d.start.value, 3)} → ${formatDateDE(d.end.date)} ${formatNumberDE(d.end.value, 3)}`)).join('; ');
            if (c.complete) { unit_values[u.id] = c.value; applied += 1; } else { incomplete += 1; }
        });
        updateCostItem(itemId, ci => ({ ...ci, unit_values, value_sources, meter_type: meterType, consumption_unit: unitLabel || ci.consumption_unit || '' }));
        const missing = propertyUnits.length - applied;
        if (missing > 0) {
            alert(`Verbrauch aus Zählerständen für ${applied} von ${propertyUnits.length} Einheiten übernommen.${incomplete ? ` Bei ${incomplete} Einheit(en) fehlen Ablesungen am Anfang oder Ende des Zeitraums.` : ''} Fehlende Werte bitte manuell eintragen.`);
        }
    };

    const onKeyChange = (item, value) => {
        if (value === 'NEW_KEY') {
            setPendingKeyItemId(item.id);
            setNewKeyName('');
            setNewKeyDescription('');
            setIsCreateKeyModalOpen(true);
            return;
        }
        if (value === HEATING_SPLIT_KEY_ID) {
            updateCostItem(item.id, ci => ({ ...ci, distribution_key: value, key_name: KEY_TYPE_INFO.heating_split.label, key_type: 'heating_split' }));
            setExpandedValues(prev => ({ ...prev, [item.id]: true }));
            return;
        }
        const dk = distributionKeys.find(k => k.id === value);
        updateCostItem(item.id, ci => ({ ...ci, distribution_key: value, key_name: dk?.name || null, key_type: dk?.calculation_type || null }));
        if (dk && (dk.calculation_type === 'custom' || dk.calculation_type === 'direct')) {
            setExpandedValues(prev => ({ ...prev, [item.id]: true }));
        }
    };

    const handleCreateNewKey = async () => {
        if (!newKeyName.trim()) {
            alert('Bitte eine Bezeichnung für den Schlüssel eingeben.');
            return;
        }
        try {
            const { data, error } = await supabase.from('distribution_keys').insert([{
                user_id: user.id,
                name: newKeyName.trim(),
                calculation_type: 'custom',
                description: newKeyDescription || 'In Nebenkostenabrechnung erstellt'
            }]).select().single();
            if (error) throw error;

            const allKeys = await fetchAllRows(() => supabase.from('distribution_keys').select('*').order('id'));
            setDistributionKeys([...allKeys].sort((a, b) => (a.name || '').localeCompare(b.name || '')));

            if (pendingKeyItemId) {
                updateCostItem(pendingKeyItemId, ci => ({ ...ci, distribution_key: data.id, key_name: data.name, key_type: data.calculation_type }));
                setExpandedValues(prev => ({ ...prev, [pendingKeyItemId]: true }));
            }
            setIsCreateKeyModalOpen(false);
            setNewKeyName('');
            setNewKeyDescription('');
            setPendingKeyItemId(null);
        } catch (error) {
            console.error('Error creating key:', error);
            alert(`Fehler beim Erstellen des Schlüssels: ${translateError(error)}`);
        }
    };

    // ===== KORREKTUREN IN SCHRITT „VERTEILUNG" =====
    const setRowOverride = (uid, itemId, patch) => setUnitOverrides(prev => {
        const forUnit = { ...(prev[uid] || {}) };
        const cur = { ...(forUnit[itemId] || {}), ...patch };
        Object.keys(cur).forEach(k => { if (cur[k] === undefined || cur[k] === null) delete cur[k]; });
        if (Object.keys(cur).length) forUnit[itemId] = cur; else delete forUnit[itemId];
        return { ...prev, [uid]: forUnit };
    });

    const updateCustomRow = (uid, rowId, patch) => setCustomRows(prev => ({
        ...prev,
        [uid]: (prev[uid] || []).map(r => (r.id === rowId ? { ...r, ...patch } : r))
    }));

    const removeRow = (uid, row) => {
        if (row.isCustom) {
            setCustomRows(prev => ({ ...prev, [uid]: (prev[uid] || []).filter(r => r.id !== row.id) }));
        } else {
            setRowOverride(uid, row.cost_item_id, { removed: true });
        }
    };

    const setPrepayOverride = (leaseId, field, value) => setPrepayOverrides(prev => {
        const cur = { ...(prev[leaseId] || {}) };
        if (value === null || value === undefined) delete cur[field]; else cur[field] = value;
        const next = { ...prev };
        if (Object.keys(cur).length) next[leaseId] = cur; else delete next[leaseId];
        return next;
    });

    // ===== BRIEFDATEN =====
    const letterDataFor = (page) => {
        const prop = propertiesById[page.propertyId] || units.find(u => u.id === page.unitId)?.property || null;
        const portfolio = portfoliosById[prop?.portfolio_id] || null;
        const tenant = tenantsById[page.tenantId] || null;
        return buildLetterData({ property: prop, portfolio, tenant });
    };

    // ===== SAVE / DELETE =====
    const buildDataPayload = (result) => ({
        version: 2,
        selectedUnitIds,
        costItems: costItems.map(ci => {
            const d = result?.distribution?.[ci.id];
            const keyType = d?.key?.type && d.key.type !== 'unit_direct' ? d.key.type : (ci.key_type || null);
            return {
                ...ci,
                amount: centsToEuro(toCents(ci.amount)),
                key_name: (d?.key?.type !== 'unit_direct' ? d?.key?.name : null) || ci.key_name || null,
                key_type: keyType
            };
        }),
        // Kompatibel zum bisherigen Format (label/amount/isCustom je Einheit)
        unitCosts: Object.fromEntries(Object.entries(result?.unitRows || {}).map(([uid, rows]) => [uid, rows.map(r => ({
            id: r.id, cost_item_id: r.cost_item_id, label: r.label, amount: r.amount, isCustom: r.isCustom, overridden: r.overridden
        }))])),
        unitOverrides,
        customRows,
        prepayOverrides,
        options: settlementOptions,
        loadedFor
    });

    const saveSettlement = async (status = 'draft') => {
        if (saving) return;
        const pv = validatePeriod(periodStart, periodEnd);
        if (pv.errors.length) {
            alert(pv.errors.join('\n'));
            return;
        }

        let actualPropertyId = wizardPropertyId;
        let actualEconomicUnitId = null;
        if (wizardPropertyId?.startsWith('we_')) {
            actualEconomicUnitId = wizardPropertyId.replace('we_', '');
            const relatedProps = properties.filter(p => p.economic_unit_id === actualEconomicUnitId);
            actualPropertyId = relatedProps.length > 0 ? relatedProps[0].id : null;
            if (!actualPropertyId) {
                alert('Dieser Wirtschaftseinheit ist keine Liegenschaft zugeordnet – die Abrechnung kann nicht gespeichert werden.');
                return;
            }
        }
        if (!canWriteNk(propertiesById[actualPropertyId]?.portfolio_id || null)) {
            alert(READ_ONLY_NOTICE);
            return;
        }

        setSaving(true);
        try {
            let result = settlementResult;
            let snapshot = null;
            if (status === 'done') {
                const pd = await ensurePrepayData();
                result = computeSettlement({
                    periodStart, periodEnd, houseUnits: propertyUnits, selectedUnitIds, leases, tenantsById,
                    distributionKeys, costItems, unitOverrides, customRows, prepayOverrides,
                    options: settlementOptions, prepayData: pd, today
                });
                const errors = result.issues.filter(i => i.level === 'error');
                if (errors.length) {
                    alert(`Die Abrechnung kann noch nicht fertiggestellt werden:\n\n• ${errors.map(e => e.text).join('\n• ')}`);
                    return;
                }
                const warnings = result.issues.filter(i => i.level === 'warning');
                if (warnings.length && !confirm(`Bitte prüfen:\n\n• ${warnings.map(w => w.text).join('\n• ')}\n\nAbrechnung trotzdem fertigstellen und festschreiben?`)) return;
                if (!result.pages.length && !confirm('Im Abrechnungszeitraum gibt es keine Mietverhältnisse in den gewählten Einheiten. Trotzdem fertigstellen?')) return;
                snapshot = buildCalculationSnapshot({
                    result, costItems, periodStart, periodEnd, options: settlementOptions,
                    letterDataForPage: letterDataFor, finalizedAt: new Date().toISOString(), finalizedBy: user.id
                });
            }

            const data = buildDataPayload(result);
            const record = {
                property_id: actualPropertyId,
                economic_unit_id: actualEconomicUnitId,
                period_start: periodStart,
                period_end: periodEnd,
                status: status,
                data,
                year: parseInt(String(periodStart).slice(0, 4), 10) || null
            };

            // user_id nur beim Anlegen setzen (Inhaber des Portfolios), beim Ändern nie überschreiben
            const ownerId = portfoliosById[propertiesById[actualPropertyId]?.portfolio_id]?.user_id || user.id;
            const write = async (rec) => {
                if (editingSettlement) {
                    return supabase.from('utility_settlements').update(rec).eq('id', editingSettlement.id).select();
                }
                return supabase.from('utility_settlements').insert([{ ...rec, user_id: ownerId }]).select();
            };

            // Wieder geöffnete Abrechnung als Entwurf: Festschreibung in der Spalte aufheben
            // (sonst gälte nach erneutem Abschluss durch eine ältere App-Version der alte Stand)
            const clearSnapshot = !snapshot && !!editingSettlement?.calculation_snapshot;
            let response = await write(snapshot
                ? { ...record, calculation_snapshot: snapshot }
                : (clearSnapshot ? { ...record, calculation_snapshot: null } : record));
            if (response.error && (snapshot || clearSnapshot) && isMissingFeatureError(response.error)) {
                // Spalte calculation_snapshot noch nicht vorhanden -> in data ablegen
                response = await write(snapshot ? { ...record, data: { ...data, calculation_snapshot: snapshot } } : record);
            }
            if (response.error) throw response.error;
            if (!response.data || response.data.length === 0) {
                throw new Error('Die Abrechnung konnte nicht gespeichert werden (keine Berechtigung oder inzwischen gelöscht).');
            }
            setEditingSettlement(response.data[0]);
            setWizardOpen(false);
            fetchData();
        } catch (error) {
            alert(error?.code ? translateError(error) : (error?.message || translateError(error)));
        } finally {
            setSaving(false);
        }
    };

    const deleteSettlement = async (s) => {
        if (!canWriteSettlement(s)) {
            alert(READ_ONLY_NOTICE);
            return;
        }
        const msg = s.status === 'done'
            ? 'Diese Abrechnung ist abgeschlossen. Möchten Sie sie wirklich endgültig löschen?'
            : 'Möchten Sie diese Abrechnung wirklich löschen?';
        if (!confirm(msg)) return;
        try {
            const { error } = await supabase.from('utility_settlements').delete().eq('id', s.id);
            if (error) throw error;
            fetchData();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // ===== STEP NAVIGATION =====
    // Vorwärts (auch per Klick auf die Schrittanzeige) immer über dieselben Übergänge
    const runStepTransition = async (from) => {
        if (from === 0) {
            const pv = validatePeriod(periodStart, periodEnd);
            if (pv.errors.length) { alert(pv.errors.join('\n')); return false; }
            if (selectedUnitIds.length === 0) { alert('Bitte wählen Sie mindestens eine Einheit aus.'); return false; }
            const warnings = [...pv.warnings];
            const weId = wizardPropertyId?.startsWith('we_') ? wizardPropertyId.replace('we_', '') : null;
            const overlapping = settlements.filter(s => s.id !== editingSettlement?.id
                && (weId ? s.economic_unit_id === weId : (s.property_id === wizardPropertyId && !s.economic_unit_id))
                && periodsOverlap(s.period_start, s.period_end, periodStart, periodEnd));
            if (overlapping.length) {
                warnings.push(`Für dieses Objekt gibt es bereits eine Abrechnung mit überschneidendem Zeitraum (${overlapping.map(s => `${formatDateDE(s.period_start)} – ${formatDateDE(s.period_end)}`).join(', ')}).`);
            }
            if (warnings.length && !confirm(`${warnings.join('\n\n')}\n\nTrotzdem fortfahren?`)) return false;
            await Promise.all([loadCostsForStep(), loadMeterData(wizardPropertyId, periodStart, periodEnd)]);
            return true;
        }
        if (from === 1) {
            if (selectedUnitIds.length > 0 && !selectedUnitIds.includes(step3SelectedUnit)) {
                setStep3SelectedUnit(selectedUnitIds[0]);
            }
            ensurePrepayData().catch(err => console.warn('Vorauszahlungen nicht ladbar:', err));
            return true;
        }
        if (from === 2) {
            await ensurePrepayData();
            return true;
        }
        return true;
    };

    const goToStep = async (target) => {
        if (stepBusy || target === wizardStep) return;
        if (target < wizardStep) {
            setWizardStep(target);
            return;
        }
        setStepBusy(true);
        try {
            for (let s = wizardStep; s < target; s++) {
                const ok = await runStepTransition(s);
                if (!ok) { setWizardStep(s); return; }
            }
            setWizardStep(Math.min(target, 3));
        } catch (error) {
            alert(translateError(error));
        } finally {
            setStepBusy(false);
        }
    };

    const goNext = () => goToStep(Math.min(wizardStep + 1, 3));
    const goBack = () => setWizardStep(prev => Math.max(prev - 1, 0));

    // ===== PDF =====
    const fetchUtilityTemplate = async (portfolioId) => {
        const pick = async (query) => {
            const { data, error } = await query.order('updated_at', { ascending: false }).limit(1);
            if (error) throw error;
            return data?.[0]?.content_html || null;
        };
        try {
            if (portfolioId) {
                const html = await pick(supabase.from('document_templates').select('content_html, updated_at')
                    .eq('type', 'utility_costs').eq('portfolio_id', portfolioId));
                if (html) return { html };
            }
            const ownerId = portfoliosById[portfolioId]?.user_id;
            for (const uid of Array.from(new Set([ownerId, user?.id].filter(Boolean)))) {
                const html = await pick(supabase.from('document_templates').select('content_html, updated_at')
                    .eq('type', 'utility_costs').eq('user_id', uid).is('portfolio_id', null));
                if (html) return { html };
            }
            return { html: null };
        } catch (error) {
            console.error('Vorlage Nebenkostenabrechnung nicht ladbar:', error);
            return { html: null, warning: 'Ihre Vorlage für die Nebenkostenabrechnung konnte nicht geladen werden – das PDF wurde mit der Standardvorlage erstellt.' };
        }
    };

    // Entwürfe und alte Abschlüsse: aus den gespeicherten Daten + aktuellen Stammdaten berechnen
    const computeForSettlement = async (s) => {
        const data = parseSettlementData(s);
        const propKey = s.economic_unit_id ? `we_${s.economic_unit_id}` : s.property_id;
        const houseUnits = houseUnitsFor(propKey);
        const prepared = prepareSettlementState(data, houseUnits);
        const pd = await loadPrepayData(leaseIdsInPeriod(prepared.selectedUnitIds, s.period_start, s.period_end));
        return computeSettlement({
            periodStart: s.period_start, periodEnd: s.period_end, houseUnits,
            selectedUnitIds: prepared.selectedUnitIds, leases, tenantsById, distributionKeys,
            costItems: prepared.costItems, unitOverrides: prepared.unitOverrides, customRows: prepared.customRows,
            prepayOverrides: data.prepayOverrides || {}, options: data.options || {}, prepayData: pd, today
        });
    };

    const downloadSettlement = async (settlement, pageKey = null) => {
        if (pdfBusy) return;
        const snapshot = settlement.status === 'done' ? getSnapshot(settlement) : null;
        if (settlement.status === 'done' && !snapshot && !confirm('Diese Abrechnung wurde vor Einführung der Festschreibung abgeschlossen. Das PDF wird aus den aktuellen Daten berechnet und kann vom damals versandten Stand abweichen.\n\nZum dauerhaften Festschreiben die Abrechnung öffnen und erneut fertigstellen.\n\nPDF trotzdem erstellen?')) return;
        setPdfBusy(true);
        try {
            let pages;
            let letterDate;
            let pStart = settlement.period_start;
            let pEnd = settlement.period_end;
            if (snapshot) {
                pages = (snapshot.pages || []).map(p => ({ ...p, letter: p.letter || letterDataFor(p) }));
                letterDate = localISODate(new Date(snapshot.finalized_at || settlement.created_at));
                pStart = snapshot.period_start || pStart;
                pEnd = snapshot.period_end || pEnd;
            } else {
                const result = await computeForSettlement(settlement);
                pages = result.pages.map(p => ({ ...p, letter: letterDataFor(p) }));
                letterDate = today;
            }
            if (pageKey) pages = pages.filter(p => p.key === pageKey);
            if (!pages.length) {
                alert('Für diese Auswahl gibt es keine Mieterabrechnung.');
                return;
            }

            // Vorlage je Portfolio (Wirtschaftseinheit: je Seite die Liegenschaft der Einheit)
            const templates = {};
            let templateWarning = '';
            const portfolioOf = (p) => p.letter?.portfolioId || propertiesById[p.propertyId]?.portfolio_id || '';
            for (const pid of Array.from(new Set(pages.map(portfolioOf)))) {
                const r = await fetchUtilityTemplate(pid || null);
                templates[pid] = r.html;
                if (r.warning) templateWarning = r.warning;
            }

            const isDraft = settlement.status !== 'done';
            const html = renderSettlementDocument({
                pages, templateForPage: (p) => templates[portfolioOf(p)],
                periodStart: pStart, periodEnd: pEnd, letterDate, isDraft
            });
            const first = pages[0];
            const street = propertiesById[first.propertyId]?.street || first.letter?.propertyAddress || 'Objekt';
            const filename = [
                'Nebenkostenabrechnung',
                safeFilePart(settlementYearLabel(pStart, pEnd).replace('/', '-')),
                safeFilePart(street),
                pageKey ? safeFilePart(first.tenantLastName) : '',
                isDraft ? 'Entwurf' : ''
            ].filter(Boolean).join('_') + '.pdf';
            await renderPdf(html, filename);
            if (templateWarning) alert(templateWarning);
        } catch (error) {
            console.error('PDF-Erstellung fehlgeschlagen:', error);
            alert(error?.code ? translateError(error) : (error?.message || 'Das PDF konnte nicht erstellt werden.'));
        } finally {
            setPdfBusy(false);
        }
    };

    // PDF-Einträge je Mieter: fertige Abrechnung aus der Festschreibung, sonst aus der Belegung
    const pdfEntriesFor = (s) => {
        const snap = s.status === 'done' ? getSnapshot(s) : null;
        if (snap) return (snap.pages || []).map(p => ({ key: p.key, unitName: p.unitName, label: p.tenantDisplayName }));
        const data = parseSettlementData(s);
        return (data.selectedUnitIds || []).flatMap(uid => {
            const u = units.find(x => x.id === uid);
            const occ = buildUnitOccupancy({ unitId: uid, leases, tenantsById, periodStart: s.period_start, periodEnd: s.period_end });
            return occ.leaseCells.map(c => ({ key: `${uid}:${c.leaseId}`, unitName: u ? u.unit_name : 'Einheit', label: c.displayName }));
        });
    };

    // ===== LOADING =====
    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    // ===== WIZARD VIEW =====
    if (wizardOpen) {
        const header = groupedProperties.find(g => g.id === wizardPropertyId) || propertiesById[wizardPropertyId];
        const result = settlementResult;
        const occupancy = result?.occupancy || {};
        const busy = stepBusy || saving;

        const tenantSummary = (uid) => {
            const occ = occupancy[uid];
            if (!occ || !occ.cells.length) return isValidISODate(periodStart) && isValidISODate(periodEnd) ? 'Leerstand' : '';
            if (!occ.leaseCells.length) return 'Leerstand im gesamten Zeitraum';
            return occ.leaseCells.map(c => `${c.displayName} (${formatDateDE(c.start)}–${formatDateDE(c.end)})`).join(', ')
                + (occ.vacancyDays > 0 ? ` · ${occ.vacancyDays} Tage Leerstand` : '');
        };
        const shortTenantSummary = (uid) => {
            const occ = occupancy[uid];
            if (!occ || !occ.leaseCells.length) return 'Leerstand';
            return occ.leaseCells.map(c => {
                const first = c.tenant?.first_name ? c.tenant.first_name.charAt(0) + '.' : '';
                return `${c.lastName || c.displayName}${first ? ', ' + first : ''}`;
            }).join(' / ');
        };

        const meterTypes = Array.from(new Set((meterInfo?.meters || []).map(m => m.meter_type || '').filter(Boolean)));

        const renderKeySelect = (item, style) => {
            if (item.unit_id) {
                const u = propertyUnits.find(x => x.id === item.unit_id);
                return <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Direkt: {u?.unit_name || 'Einheit'}</span>;
            }
            const known = item.distribution_key === HEATING_SPLIT_KEY_ID || distributionKeys.some(k => k.id === item.distribution_key);
            const resolved = resolveDistributionKey(item, distributionKeys);
            return (
                <select value={item.distribution_key || ''} onChange={e => onKeyChange(item, e.target.value)} style={style}>
                    {!known && (
                        <option value={item.distribution_key || ''}>
                            {resolved.resolved ? `${resolved.name}${resolved.fromSaved ? ' (nicht mehr verfügbar)' : ''}` : 'Schlüssel nicht gefunden – bitte wählen'}
                        </option>
                    )}
                    {distributionKeys.map(k => <option key={k.id} value={k.id}>{keyOptionLabel(k)}</option>)}
                    <option value={HEATING_SPLIT_KEY_ID}>{KEY_TYPE_INFO.heating_split.label}</option>
                    <option disabled>─────</option>
                    <option value="NEW_KEY" style={{ fontWeight: 'bold' }}>+ Neu</option>
                </select>
            );
        };

        const renderItemStatus = (item) => {
            const d = result?.distribution?.[item.id];
            if (!d) return null;
            const t = d.key?.type;
            const needsValues = t === 'custom' || t === 'direct' || t === 'heating_split';
            return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                    {d.status === 'error' && <span style={{ fontSize: '0.75rem', color: 'var(--danger-color)' }}>{d.message}</span>}
                    {d.status === 'ok' && d.warning && <span style={{ fontSize: '0.75rem', color: '#92400e' }}>{d.warning}</span>}
                    {needsValues && (
                        <button type="button" onClick={() => setExpandedValues(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                            style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '0.75rem', padding: 0, textDecoration: 'underline' }}>
                            {expandedValues[item.id] ? 'Werte je Einheit ausblenden' : (t === 'direct' ? 'Beträge je Einheit eintragen' : (t === 'heating_split' ? 'Verbrauchsanteil und Verbrauchswerte eintragen' : 'Verbrauchswerte je Einheit eintragen'))}
                        </button>
                    )}
                    {item.booking_count > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{item.booking_count} Buchung(en)</span>}
                </div>
            );
        };

        const renderValuesPanel = (item) => {
            const d = result?.distribution?.[item.id];
            const t = d?.key?.type;
            if ((t !== 'custom' && t !== 'direct' && t !== 'heating_split') || !expandedValues[item.id]) return null;
            const isDirect = t === 'direct';
            const isHeatingSplit = t === 'heating_split';
            const share = parseConsumptionShare(item.consumption_share);
            const values = item.unit_values || {};
            const sum = propertyUnits.reduce((s, u) => s + (parseNumber(values[u.id]) || 0), 0);
            const sel = meterTypeSel[item.id] || item.meter_type || meterTypes[0] || '';
            return (
                <div style={{ marginTop: '8px', padding: '10px 12px', backgroundColor: 'var(--background-color)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px' }}>
                        {isDirect ? 'Beträge je Einheit (Direktzuordnung)' : (isHeatingSplit ? 'Aufteilung nach HeizkostenV' : 'Verbrauchswerte je Einheit')}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        {isDirect
                            ? 'Tragen Sie je Einheit den direkt zuzuordnenden Betrag ein. Die Summe sollte den Gesamtkosten entsprechen; eine Differenz wird in der Summenprobe angezeigt.'
                            : (isHeatingSplit
                                ? `Der Verbrauchsanteil wird nach dem Verbrauch jeder Einheit des Hauses verteilt, der Rest (Grundkosten) nach Wohnfläche. Nach §§ 7, 8 HeizkostenV muss der Verbrauchsanteil zwischen ${HEATING_SPLIT_MIN_SHARE} und ${HEATING_SPLIT_MAX_SHARE} % liegen.`
                                : 'Verteilt wird nach dem Verbrauch jeder Einheit des Hauses im Abrechnungszeitraum (auch nicht abgerechneter Einheiten). Werte aus Zählerständen übernehmen oder manuell eintragen.')}
                    </p>
                    {isHeatingSplit && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                            <label htmlFor={`consumption-share-${item.id}`} style={{ fontSize: '0.82rem', flex: '1 1 140px' }}>Verbrauchsanteil</label>
                            <input id={`consumption-share-${item.id}`} type="number" step="any" min={HEATING_SPLIT_MIN_SHARE} max={HEATING_SPLIT_MAX_SHARE}
                                placeholder={`${HEATING_SPLIT_MIN_SHARE}–${HEATING_SPLIT_MAX_SHARE}`}
                                value={item.consumption_share ?? ''}
                                onChange={e => updateCostItem(item.id, ci => ({ ...ci, consumption_share: e.target.value === '' ? null : parseFloat(e.target.value) }))}
                                style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${share === null ? 'var(--danger-color)' : 'var(--border-color)'}`, textAlign: 'right', fontSize: '0.85rem' }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '30px' }}>%</span>
                            {share !== null && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', flexBasis: '100%' }}>
                                    Grundkosten {formatNumberDE(100 - share, 2)} % nach Wohnfläche, Verbrauchskosten {formatNumberDE(share, 2)} % nach Verbrauch.
                                </span>
                            )}
                        </div>
                    )}
                    {!isDirect && (meterTypes.length > 0 ? (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
                            <select value={sel} onChange={e => setMeterTypeSel(prev => ({ ...prev, [item.id]: e.target.value }))}
                                style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                                {meterTypes.map(mt => <option key={mt} value={mt}>{mt}</option>)}
                            </select>
                            <Button size="sm" variant="secondary" icon={Gauge} onClick={() => applyMeterValues(item.id, sel)}>
                                Aus Zählerständen übernehmen
                            </Button>
                        </div>
                    ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            {meterInfo?.error
                                ? `Zähler konnten nicht geladen werden (${meterInfo.error}) – bitte Werte manuell eintragen.`
                                : 'Für die Einheiten dieses Objekts sind keine Zähler hinterlegt – bitte Werte manuell eintragen.'}
                        </div>
                    ))}
                    <div style={{ display: 'grid', gap: '6px' }}>
                        {propertyUnits.map(u => (
                            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ flex: '1 1 140px', fontSize: '0.82rem' }}>
                                    {u.unit_name}
                                    {!selectedUnitIds.includes(u.id) && <span style={{ color: 'var(--text-secondary)' }}> (nicht in dieser Abrechnung)</span>}
                                </span>
                                {isDirect ? (
                                    <CurrencyInput allowDecimals value={values[u.id] ?? ''}
                                        onValueChange={v => setUnitValue(item.id, u.id, v)}
                                        style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.85rem' }} />
                                ) : (
                                    <>
                                        <input type="number" step="any" min="0" value={values[u.id] ?? ''}
                                            onChange={e => setUnitValue(item.id, u.id, e.target.value === '' ? null : parseFloat(e.target.value))}
                                            style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${parseNumber(values[u.id]) === null ? 'var(--danger-color)' : 'var(--border-color)'}`, textAlign: 'right', fontSize: '0.85rem' }} />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '30px' }}>{item.consumption_unit || ''}</span>
                                    </>
                                )}
                                {item.value_sources?.[u.id] && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', flexBasis: '100%' }}>{item.value_sources[u.id]}</span>
                                )}
                            </div>
                        ))}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '0.8rem', fontWeight: 600 }}>
                        Summe: {isDirect ? `${formatEUR(sum)} von ${formatEUR(item.amount)}` : `${formatNumberDE(sum, 3)} ${item.consumption_unit || ''}`}
                    </div>
                </div>
            );
        };

        const addCostItem = () => {
            const defaultKey = distributionKeys.find(k => k.calculation_type === 'units' || k.calculation_type === 'equal') || distributionKeys[0];
            setCostItems([...costItems, {
                id: newId(),
                category_id: '',
                category_name: 'Neue Kostenart',
                amount: 0,
                distribution_key: defaultKey ? defaultKey.id : 'einheit',
                key_name: defaultKey?.name || null,
                key_type: defaultKey?.calculation_type || null,
                source: 'manual'
            }]);
        };

        const costTotal = costItems.reduce((sum, i) => sum + toCents(i.amount), 0);

        return (
            <>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: 'var(--spacing-lg)' }}>
                        <button onClick={() => setWizardOpen(false)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nebenkostenabrechnung</h1>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                {header ? `${header.street || ''} ${header.house_number || ''}, ${header.zip || ''} ${header.city || ''}` : ''}
                                {editingSettlement?.status === 'done' ? ' · wieder geöffnet' : ''}
                            </p>
                        </div>
                    </div>

                    <Card style={isMobile ? { overflow: 'visible', height: 'auto' } : {}}>
                        <StepIndicator steps={stepLabels} currentStep={wizardStep} onStepClick={(step) => goToStep(step)} />
                        {stepBusy && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                <Loader2 size={16} className="animate-spin" /> Daten werden geladen …
                            </div>
                        )}

                        {/* ===== STEP 1: Unit Selection ===== */}
                        {wizardStep === 0 && (
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Abrechnungszeitraum & Einheiten</h3>

                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <Input label="Von" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                                    <Input label="Bis" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                                </div>
                                {(() => {
                                    const pv = validatePeriod(periodStart, periodEnd);
                                    const list = [...pv.errors.map(text => ({ level: 'error', text })), ...pv.warnings.map(text => ({ level: 'warning', text }))];
                                    const deadline = settlementDeadline(periodEnd);
                                    if (!pv.errors.length && deadline) {
                                        list.push({ level: today > deadline ? 'warning' : 'info', text: `Abrechnungsfrist (§ 556 Abs. 3 BGB): Die Abrechnung muss dem Mieter spätestens am ${formatDateDE(deadline)} zugehen.` });
                                    }
                                    return <IssueList issues={list} />;
                                })()}

                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500, marginBottom: '0.5rem' }}>
                                        <input type="checkbox" checked={selectedUnitIds.length === propertyUnits.length && propertyUnits.length > 0} onChange={toggleAllUnits} style={{ width: 16, height: 16 }} />
                                        Alle Einheiten auswählen ({propertyUnits.length})
                                    </label>
                                </div>

                                <div style={{ display: 'grid', gap: '8px' }}>
                                    {propertyUnits.map(unit => {
                                        const tenant = tenantSummary(unit.id);
                                        return (
                                            <div key={unit.id}
                                                onClick={() => toggleUnit(unit.id)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '12px',
                                                    padding: '12px 16px', borderRadius: 'var(--radius-md)',
                                                    border: `2px solid ${selectedUnitIds.includes(unit.id) ? 'var(--primary-color)' : 'var(--border-color)'} `,
                                                    cursor: 'pointer', transition: 'all 0.2s',
                                                    backgroundColor: selectedUnitIds.includes(unit.id) ? '#EFF6FF' : 'transparent'
                                                }}>
                                                <input type="checkbox" checked={selectedUnitIds.includes(unit.id)} onChange={() => { }} style={{ width: 16, height: 16, pointerEvents: 'none' }} />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 500 }}>{unit.unit_name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        {tenant}
                                                        {parseNumber(unit.sqm) !== null
                                                            ? ` · ${formatNumberDE(parseNumber(unit.sqm), 2)} m²`
                                                            : <span style={{ color: 'var(--danger-color)' }}> · Wohnfläche fehlt</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ===== STEP 2: Cost Types & Distribution Keys ===== */}
                        {wizardStep === 1 && (
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Aufstellung Kosten & Verteilerschlüssel</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                    Übernommen werden umlagefähige Buchungen ({formatDateDE(periodStart)} – {formatDateDE(periodEnd)}): Kategorie umlagefähig und Buchung als „Umlagefähig" markiert. Buchungen mit Bezug auf eine Einheit werden dieser Einheit direkt zugeordnet.
                                </p>
                                {bookingInfo?.error && <IssueList issues={[{ level: 'error', text: bookingInfo.error }]} />}
                                {bookingInfo?.notice && <IssueList issues={[{ level: bookingInfo.differs ? 'warning' : 'info', text: bookingInfo.notice }]} />}
                                {bookingInfo?.excludedCount > 0 && (
                                    <IssueList issues={[{
                                        level: 'info',
                                        text: `Nicht übernommen: ${bookingInfo.excludedCount} Buchung(en) über ${formatCents(bookingInfo.excludedCents)} (${Object.entries(bookingInfo.excludedReasons).map(([r, n]) => `${n}× ${r}`).join(', ')}).`
                                    }]} />
                                )}
                                {bookingInfo?.freshItems && (
                                    <div style={{ marginBottom: '1rem' }}>
                                        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={reloadFromBookings}>Aus Buchungen neu laden</Button>
                                    </div>
                                )}

                                {!isMobile ? (
                                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                        <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                    <th style={thStyle}>Kostenart</th>
                                                    <th style={thRight}>Betrag (€)</th>
                                                    <th style={thStyle}>Verteiler</th>
                                                    <th style={{ textAlign: 'center', padding: '10px 12px', width: '50px' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {costItems.map(item => {
                                                    const valuesPanel = renderValuesPanel(item);
                                                    return (
                                                    <React.Fragment key={item.id}>
                                                        <tr className="table-row" style={{ borderBottom: valuesPanel ? 'none' : '1px solid var(--border-color)' }}>
                                                            <td style={{ padding: '10px 12px', fontWeight: 500, position: 'relative', verticalAlign: 'top' }}>
                                                                <textarea value={item.category_name}
                                                                    rows={focusedField === `ci-${item.id}` ? 3 : 1}
                                                                    onChange={e => updateCostItem(item.id, ci => ({ ...ci, category_name: e.target.value }))}
                                                                    onFocus={() => setFocusedField(`ci-${item.id}`)}
                                                                    onBlur={() => setFocusedField(null)}
                                                                    style={textareaStyle(focusedField === `ci-${item.id}`)}
                                                                />
                                                                {renderItemStatus(item)}
                                                            </td>
                                                            <td style={{ padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                                                                <CurrencyInput allowDecimals value={item.amount}
                                                                    onChange={e => updateCostItem(item.id, ci => ({ ...ci, amount: e.target.value }))}
                                                                    style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.85rem' }}
                                                                />
                                                            </td>
                                                            <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                                                                {renderKeySelect(item, { padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '160px', maxWidth: '220px', fontSize: '0.8rem' })}
                                                            </td>
                                                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'top' }}>
                                                                <button onClick={() => setCostItems(costItems.filter(ci => ci.id !== item.id))}
                                                                    style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {valuesPanel && (
                                                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                <td colSpan={4} style={{ padding: '0 12px 12px' }}>{valuesPanel}</td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                                    <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: '1.15rem' }}>Gesamt</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '1.15rem' }}>
                                                        {formatCents(costTotal)}
                                                    </td>
                                                    <td colSpan={2}></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                ) : (
                                    /* ===== MOBILE: Card Layout ===== */
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {costItems.map(item => (
                                            <div key={item.id} style={{
                                                border: '1px solid var(--border-color)', borderRadius: '10px',
                                                padding: '12px', backgroundColor: 'var(--surface-color)',
                                                position: 'relative'
                                            }}>
                                                <button onClick={() => setCostItems(costItems.filter(ci => ci.id !== item.id))}
                                                    style={{ position: 'absolute', top: '8px', right: '8px', color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                                    <Trash2 size={16} />
                                                </button>
                                                <div style={{ marginBottom: '8px' }}>
                                                    <label style={smallLabel}>Kostenart</label>
                                                    <input type="text" value={item.category_name}
                                                        onChange={e => updateCostItem(item.id, ci => ({ ...ci, category_name: e.target.value }))}
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)', backgroundColor: 'var(--background-color)', marginTop: '4px' }}
                                                    />
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                    <div>
                                                        <label style={smallLabel}>Betrag (€)</label>
                                                        <CurrencyInput allowDecimals value={item.amount}
                                                            onChange={e => updateCostItem(item.id, ci => ({ ...ci, amount: e.target.value }))}
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.9rem', marginTop: '4px' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={smallLabel}>Verteiler</label>
                                                        <div style={{ marginTop: '4px' }}>
                                                            {renderKeySelect(item, { width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', backgroundColor: 'var(--background-color)' })}
                                                        </div>
                                                    </div>
                                                </div>
                                                {renderItemStatus(item)}
                                                {renderValuesPanel(item)}
                                            </div>
                                        ))}
                                        {/* Mobile Total */}
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '12px 16px', borderTop: '2px solid var(--border-color)',
                                            fontWeight: 700, fontSize: '1.1rem', marginTop: '4px'
                                        }}>
                                            <span>Gesamt</span>
                                            <span>{formatCents(costTotal)}</span>
                                        </div>
                                    </div>
                                )}

                                <Button variant="secondary" size="sm" icon={Plus} style={{ marginTop: '1rem' }} onClick={addCostItem}>
                                    Kostenart hinzufügen
                                </Button>
                            </div>
                        )}

                        {/* ===== STEP 3: Costs per Unit ===== */}
                        {wizardStep === 2 && result && (() => {
                            const activeUid = selectedUnitIds.includes(step3SelectedUnit) ? step3SelectedUnit : selectedUnitIds[0];
                            const activeUnit = propertyUnits.find(u => u.id === activeUid);
                            const activeRows = result.unitRows[activeUid] || [];
                            const activeTotalCents = activeRows.reduce((sum, r) => sum + r.amountCents, 0);
                            const activeOcc = occupancy[activeUid];
                            const cells = activeOcc?.cells || [];
                            const removedItems = costItems.filter(ci => unitOverrides?.[activeUid]?.[ci.id]?.removed);
                            const cellHeader = (c) => (c.kind === 'vacancy'
                                ? `Leerstand (${Math.round(c.ratio * 100)}%)`
                                : `${c.lastName || c.displayName} (${Math.round(c.ratio * 100)}%${c.personsMissing ? '' : ` · ${c.persons} P.`})`);
                            const amountInputStyle = { width: '120px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'right' };

                            const renderRowHints = (row) => (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                    {row.keyName && <span>Schlüssel: {row.keyName}</span>}
                                    {row.status === 'error' && <span style={{ color: 'var(--danger-color)' }}>{row.message}</span>}
                                    {row.overridden && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#92400e' }}>
                                            manuell · berechnet {formatCents(row.computedCents)}
                                            <button type="button" title="Berechneten Wert übernehmen" onClick={() => setRowOverride(activeUid, row.cost_item_id, { amount: undefined })}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)', display: 'inline-flex', padding: 0 }}>
                                                <RotateCcw size={12} />
                                            </button>
                                        </span>
                                    )}
                                </div>
                            );
                            const onLabelChange = (row, value) => (row.isCustom
                                ? updateCustomRow(activeUid, row.id, { label: value })
                                : setRowOverride(activeUid, row.cost_item_id, { label: value }));
                            const onAmountChange = (row, value) => (row.isCustom
                                ? updateCustomRow(activeUid, row.id, { amount: value ?? 0 })
                                : setRowOverride(activeUid, row.cost_item_id, { amount: value === null ? undefined : value }));

                            return (
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Kosten je Einheit</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                        Wählen Sie eine Einheit aus, um die anteiligen Kosten zu prüfen. Geänderte Beträge bleiben als manuelle Korrektur erhalten, auch wenn Sie die Kosten erneut bearbeiten.
                                    </p>

                                    {/* Unit Selector Tabs */}
                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '4px' }}>
                                        {selectedUnitIds.map(uid => {
                                            const unit = propertyUnits.find(u => u.id === uid);
                                            if (!unit) return null;
                                            const isActive = uid === activeUid;
                                            return (
                                                <button key={uid}
                                                    onClick={() => setStep3SelectedUnit(uid)}
                                                    style={{
                                                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                                        padding: isMobile ? '8px 12px' : '10px 16px', borderRadius: 'var(--radius-md)',
                                                        border: `2px solid ${isActive ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                                        backgroundColor: isActive ? '#EFF6FF' : 'transparent',
                                                        cursor: 'pointer', transition: 'all 0.2s',
                                                        minWidth: isMobile ? '100px' : '140px',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                    <span style={{ fontWeight: 600, fontSize: isMobile ? '0.8rem' : '0.9rem', color: isActive ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                                        {unit.unit_name}
                                                    </span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                        {shortTenantSummary(uid)}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Active Unit Detail */}
                                    {activeUnit && (
                                        <Card>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{activeUnit.unit_name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        {tenantSummary(activeUid)}
                                                        {parseNumber(activeUnit.sqm) !== null ? ` · ${formatNumberDE(parseNumber(activeUnit.sqm), 2)} m²` : ' · Wohnfläche fehlt'}
                                                    </div>
                                                </div>
                                            </div>

                                            {!isMobile ? (
                                                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                                    <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                                <th style={thStyle}>Kostenart</th>
                                                                <th style={thRight}>Einheit gesamt (€)</th>
                                                                {cells.map(c => <th key={c.key} style={thRight}>{cellHeader(c)}</th>)}
                                                                <th style={{ textAlign: 'center', padding: '10px 12px', width: '50px' }}></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {activeRows.map(row => (
                                                                <tr key={row.id} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td style={{ padding: '10px 12px', position: 'relative', verticalAlign: 'top' }}>
                                                                        <textarea value={row.label}
                                                                            rows={focusedField === `row-${row.id}` ? 3 : 1}
                                                                            onChange={e => onLabelChange(row, e.target.value)}
                                                                            onFocus={() => setFocusedField(`row-${row.id}`)}
                                                                            onBlur={() => setFocusedField(null)}
                                                                            style={textareaStyle(focusedField === `row-${row.id}`)}
                                                                        />
                                                                        {renderRowHints(row)}
                                                                    </td>
                                                                    <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top' }}>
                                                                        <CurrencyInput allowDecimals value={row.amount}
                                                                            onValueChange={v => onAmountChange(row, v)}
                                                                            style={{ ...amountInputStyle, borderColor: row.status === 'error' ? 'var(--danger-color)' : 'var(--border-color)' }}
                                                                        />
                                                                    </td>
                                                                    {cells.map(c => (
                                                                        <td key={c.key} style={{ padding: '10px 12px', textAlign: 'right', color: '#666', fontSize: '0.9em', verticalAlign: 'top' }}>
                                                                            {formatCents(row.split?.[c.key] || 0)}
                                                                        </td>
                                                                    ))}
                                                                    <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'top' }}>
                                                                        <button onClick={() => removeRow(activeUid, row)} title="Position entfernen"
                                                                            style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                                                <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: '1.15rem' }}>Gesamt</td>
                                                                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '1.15rem' }}>
                                                                    {formatCents(activeTotalCents)}
                                                                </td>
                                                                {cells.map(c => (
                                                                    <td key={c.key} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '0.9em', color: '#666' }}>
                                                                        {formatCents(activeRows.reduce((s, r) => s + (r.split?.[c.key] || 0), 0))}
                                                                    </td>
                                                                ))}
                                                                <td></td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            ) : (
                                                /* ===== MOBILE: Card Layout for Step 3 ===== */
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                    {activeRows.map(row => (
                                                        <div key={row.id} style={{
                                                            border: '1px solid var(--border-color)', borderRadius: '10px',
                                                            padding: '12px', backgroundColor: 'var(--surface-color)',
                                                            position: 'relative'
                                                        }}>
                                                            <button onClick={() => removeRow(activeUid, row)} style={{ position: 'absolute', top: '8px', right: '8px', color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                                                <Trash2 size={16} />
                                                            </button>
                                                            <div style={{ marginBottom: '8px' }}>
                                                                <label style={smallLabel}>Kostenart</label>
                                                                <input type="text" value={row.label}
                                                                    onChange={e => onLabelChange(row, e.target.value)}
                                                                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)', backgroundColor: 'var(--background-color)', marginTop: '4px' }}
                                                                />
                                                                {renderRowHints(row)}
                                                            </div>
                                                            <div style={{ marginBottom: cells.length > 0 ? '8px' : 0 }}>
                                                                <label style={smallLabel}>Einheit gesamt (€)</label>
                                                                <CurrencyInput allowDecimals value={row.amount}
                                                                    onValueChange={v => onAmountChange(row, v)}
                                                                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.9rem', marginTop: '4px' }}
                                                                />
                                                            </div>
                                                            {cells.length > 0 && (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    {cells.map(c => (
                                                                        <div key={c.key} style={{
                                                                            padding: '6px 10px', borderRadius: '6px',
                                                                            backgroundColor: 'var(--background-color)', fontSize: '0.8rem', color: 'var(--text-secondary)',
                                                                            display: 'flex', justifyContent: 'space-between'
                                                                        }}>
                                                                            <span>{cellHeader(c)}</span>
                                                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatCents(row.split?.[c.key] || 0)}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                    <div style={{
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        padding: '12px 16px', borderTop: '2px solid var(--border-color)',
                                                        fontWeight: 700, fontSize: '1.1rem', marginTop: '4px'
                                                    }}>
                                                        <span>Gesamt</span>
                                                        <span>{formatCents(activeTotalCents)}</span>
                                                    </div>
                                                </div>
                                            )}
                                            {removedItems.length > 0 && (
                                                <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                                                    <span>Entfernt:</span>
                                                    {removedItems.map(ci => (
                                                        <button key={ci.id} type="button" onClick={() => setRowOverride(activeUid, ci.id, { removed: undefined })}
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border-color)', borderRadius: '999px', padding: '2px 8px', background: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                                                            <RotateCcw size={11} /> {ci.category_name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <Button variant="secondary" size="sm" icon={Plus} style={{ marginTop: '1rem' }} onClick={() => {
                                                setCustomRows(prev => ({ ...prev, [activeUid]: [...(prev[activeUid] || []), { id: newId(), label: 'Neue Kostenart', amount: 0, isCustom: true }] }));
                                            }}>
                                                Kostenart hinzufügen
                                            </Button>
                                        </Card>
                                    )}
                                </div>
                            );
                        })()}

                        {/* ===== STEP 4: Review ===== */}
                        {wizardStep === 3 && result && (() => {
                            const heatRelevant = result.heatingDetected || result.pages.some(p => p.prepay.sollHeat > 0 || p.prepay.istHeat > 0);
                            const personsUsed = result.sumCheck.some(sc => sc.keyType === 'persons');
                            const totals = result.sumCheck.reduce((acc, sc) => ({
                                total: acc.total + sc.totalCents, tenants: acc.tenants + sc.tenantsCents,
                                vacancy: acc.vacancy + sc.vacancyCents, other: acc.other + sc.otherUnitsCents, diff: acc.diff + sc.diffCents
                            }), { total: 0, tenants: 0, vacancy: 0, other: 0, diff: 0 });
                            const prepaySourceText = (p) => (p.prepay.source === 'manual' ? 'manuell' : (p.prepay.source === 'ist' ? 'lt. Mietkonto' : 'Soll lt. Vertrag'));
                            const balanceText = (p) => (p.balanceType === 'even' ? 'Ausgeglichen' : `${p.balanceType === 'nachzahlung' ? 'Nachzahlung' : 'Guthaben'}: ${formatCents(Math.abs(p.balanceCents))}`);

                            return (
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Prüfen & Abschließen</h3>
                                    {!result.pages.every(p => p.prepay.loaded) && result.pages.length > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                            <Loader2 size={16} className="animate-spin" /> Zahlungseingänge werden geladen …
                                        </div>
                                    )}

                                    <IssueList issues={result.issues} />

                                    {(heatRelevant || personsUsed) && (
                                        <div style={{ display: 'grid', gap: '8px', marginBottom: '1rem', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                                            {heatRelevant && (
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={result.includeHeating}
                                                        onChange={e => setSettlementOptions(o => ({ ...o, includeHeatingPrepay: e.target.checked }))}
                                                        style={{ width: 16, height: 16 }} />
                                                    Heizkosten-Vorauszahlungen anrechnen (nur wenn die Heizkosten in dieser Abrechnung enthalten sind)
                                                </label>
                                            )}
                                            {personsUsed && (
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                                                    Leerstand beim Personenschlüssel ansetzen mit
                                                    <input type="number" min="0" step="1" value={settlementOptions.vacancyPersons ?? 1}
                                                        onChange={e => setSettlementOptions(o => ({ ...o, vacancyPersons: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                                        style={{ width: '64px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                                    Person(en) (Anteil trägt der Vermieter)
                                                </label>
                                            )}
                                        </div>
                                    )}

                                    {/* Summenprobe */}
                                    <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Summenprobe: umgelegt + Leerstand + nicht abgerechnete Einheiten = Gesamtkosten</div>
                                        <table style={{ width: '100%', minWidth: '560px', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                    <th style={{ ...thStyle, padding: '6px 8px' }}>Kostenart</th>
                                                    <th style={{ ...thRight, padding: '6px 8px' }}>Gesamt</th>
                                                    <th style={{ ...thRight, padding: '6px 8px' }}>Mieter</th>
                                                    <th style={{ ...thRight, padding: '6px 8px' }}>Leerstand</th>
                                                    <th style={{ ...thRight, padding: '6px 8px' }}>andere Einheiten</th>
                                                    <th style={{ ...thRight, padding: '6px 8px' }}>Differenz</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.sumCheck.map(sc => (
                                                    <tr key={sc.itemId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <td style={{ padding: '6px 8px' }}>{sc.label}</td>
                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(sc.totalCents)}</td>
                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(sc.tenantsCents)}</td>
                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(sc.vacancyCents)}</td>
                                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(sc.otherUnitsCents)}</td>
                                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: sc.diffCents !== 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>
                                                            {sc.status === 'error' ? 'nicht verteilt' : formatCents(sc.diffCents)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
                                                    <td style={{ padding: '6px 8px' }}>Summe</td>
                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(totals.total)}</td>
                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(totals.tenants)}</td>
                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(totals.vacancy)}</td>
                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCents(totals.other)}</td>
                                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: totals.diff !== 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>{formatCents(totals.diff)}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>

                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                        Je Mietverhältnis eine eigene Abrechnung. Klicken Sie auf eine Einheit, um Rechenweg und Vorauszahlungen zu prüfen und zu ändern.
                                    </p>

                                    <div style={{ display: 'grid', gap: '8px' }}>
                                        {selectedUnitIds.map(uid => {
                                            const unit = propertyUnits.find(u => u.id === uid);
                                            if (!unit) return null;
                                            const unitPages = result.pages.filter(p => p.unitId === uid);
                                            const vac = result.vacancies.find(v => v.unitId === uid);
                                            return (
                                                <div key={uid}
                                                    onClick={() => setReviewUnit(uid)}
                                                    style={{
                                                        padding: isMobile ? '10px 12px' : '12px 16px', borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--border-color)', cursor: 'pointer',
                                                        transition: 'all 0.2s', backgroundColor: reviewUnit === uid ? '#EFF6FF' : 'transparent'
                                                    }}>
                                                    <div style={{ fontWeight: 600, fontSize: isMobile ? '0.85rem' : undefined, marginBottom: '4px' }}>{unit.unit_name}</div>
                                                    {unitPages.map(p => (
                                                        <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '4px 0', borderTop: '1px dashed var(--border-color)' }}>
                                                            <div style={{ minWidth: 0 }}>
                                                                <div style={{ fontSize: isMobile ? '0.78rem' : '0.85rem' }}>{p.tenantDisplayName}</div>
                                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                                                    {formatDateDE(p.start)} – {formatDateDE(p.end)} · Vorauszahlung {formatCents(p.prepay.totalCents)} ({prepaySourceText(p)})
                                                                </div>
                                                            </div>
                                                            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                                <div style={{ fontWeight: 700, fontSize: isMobile ? '0.85rem' : undefined }}>{formatCents(p.totalCents)}</div>
                                                                <div style={{
                                                                    fontSize: isMobile ? '0.7rem' : '0.8rem', fontWeight: 500,
                                                                    color: p.balanceType === 'nachzahlung' ? 'var(--danger-color)' : 'var(--success-color)'
                                                                }}>
                                                                    {balanceText(p)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {vac && (
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '4px 0', borderTop: '1px dashed var(--border-color)', fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                                            <span>Leerstand ({vac.days} Tage) – Vermieteranteil</span>
                                                            <span>{formatCents(vac.totalCents)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Unit Detail Modal */}
                                    {reviewUnit && (() => {
                                        const unit = propertyUnits.find(u => u.id === reviewUnit);
                                        const unitPages = result.pages.filter(p => p.unitId === reviewUnit);
                                        const vac = result.vacancies.find(v => v.unitId === reviewUnit);
                                        const cellStyle = { padding: '8px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                                        const numCell = { padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' };
                                        const basisText = (v, label) => (v > 0 ? `${formatNumberDE(v, 2)} ${label}`.trim() : '--');

                                        return (
                                            <Modal isOpen={true} onClose={() => setReviewUnit(null)}
                                                title={`Abrechnungsdetails: ${unit?.unit_name || ''}`} maxWidth="980px"
                                                footer={
                                                    <>
                                                        <Button variant="secondary" onClick={() => setReviewUnit(null)}>Schließen</Button>
                                                    </>
                                                }>
                                                <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '4px' }}>
                                                    {unitPages.length === 0 && (
                                                        <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                                            Kein Mietverhältnis im Abrechnungszeitraum – die Kosten dieser Einheit trägt der Vermieter{vac ? ` (${formatCents(vac.totalCents)})` : ''}.
                                                        </div>
                                                    )}
                                                    {unitPages.map(page => (
                                                        <div key={page.key} style={{ marginBottom: '2rem', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                                            <div style={{ backgroundColor: 'var(--background-color)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{page.tenantDisplayName}</div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                    {formatDateDE(page.start)} – {formatDateDE(page.end)} ({page.days} von {page.totalDays} Tagen)
                                                                    {` · ${page.persons} Person(en)${page.personsMissing ? ' (nicht hinterlegt)' : ''}`}
                                                                </div>
                                                            </div>

                                                            <div style={{ overflowX: 'auto' }}>
                                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed', minWidth: '760px' }}>
                                                                    <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                                                        <tr>
                                                                            <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600, width: '19%' }}>Kostenart</th>
                                                                            <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600, width: '13%' }}>Schlüssel</th>
                                                                            <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '11%' }}>Gesamt</th>
                                                                            <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Einheiten ges.</th>
                                                                            <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '10%' }}>Ko./Einh.</th>
                                                                            <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Ihre Einh.</th>
                                                                            <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '11%' }}>Zeitanteil</th>
                                                                            <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Anteil</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {expandItemParts(page.items).map(it => (
                                                                            <tr key={it.rowId} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                                <td style={cellStyle} title={it.label}>{it.label}{it.manual ? ' *' : ''}</td>
                                                                                <td style={{ ...cellStyle, color: it.status === 'error' ? 'var(--danger-color)' : undefined }} title={it.status === 'error' ? it.message : it.keyName}>
                                                                                    {it.status === 'error' ? `${it.keyName || 'Schlüssel'}: ${it.message}` : it.keyName}
                                                                                </td>
                                                                                <td style={numCell}>{it.totalCost ? formatEUR(it.totalCost) : '--'}</td>
                                                                                <td style={numCell}>{basisText(it.basisTotal, it.unitLabel)}</td>
                                                                                <td style={numCell}>{it.costPerBasis ? `${formatNumberDE(it.costPerBasis, 4)} €` : '--'}</td>
                                                                                <td style={numCell}>{basisText(it.basisUnit, it.unitLabel)}</td>
                                                                                <td style={numCell}>{it.timeText}</td>
                                                                                <td style={{ ...numCell, fontWeight: 600 }}>{formatEUR(it.share)}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                    <tfoot style={{ backgroundColor: 'var(--background-color)', fontWeight: 600 }}>
                                                                        <tr>
                                                                            <td colSpan={7} style={{ padding: '10px 12px' }}>Gesamtsumme (Ihr Anteil)</td>
                                                                            <td style={numCell}>{formatCents(page.totalCents)}</td>
                                                                        </tr>
                                                                        <tr>
                                                                            <td colSpan={7} style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>Vorauszahlungen ({prepaySourceText(page)})</td>
                                                                            <td style={{ ...numCell, color: 'var(--text-secondary)' }}>- {formatCents(page.prepay.totalCents)}</td>
                                                                        </tr>
                                                                        <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                                                            <td colSpan={7} style={{ padding: '10px 12px', color: page.balanceType === 'nachzahlung' ? 'var(--danger-color)' : 'var(--success-color)' }}>
                                                                                {page.balanceType === 'even' ? 'Ausgeglichen' : (page.balanceType === 'nachzahlung' ? 'Nachzahlung' : 'Guthaben')}
                                                                            </td>
                                                                            <td style={{ ...numCell, color: page.balanceType === 'nachzahlung' ? 'var(--danger-color)' : 'var(--success-color)' }}>
                                                                                {formatCents(Math.abs(page.balanceCents))}
                                                                            </td>
                                                                        </tr>
                                                                    </tfoot>
                                                                </table>
                                                            </div>
                                                            {page.items.some(it => it.manual) && (
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '6px 12px' }}>* Betrag manuell festgelegt bzw. direkt zugeordnet.</div>
                                                            )}

                                                            {/* Vorauszahlungen */}
                                                            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                                                                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                                                                    Vorauszahlungen ({formatNumberDE(page.prepay.months, 2)} Monate)
                                                                </div>
                                                                <div style={{ overflowX: 'auto' }}>
                                                                    <table style={{ width: '100%', minWidth: '520px', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                                                        <thead>
                                                                            <tr>
                                                                                <th style={{ textAlign: 'left', padding: '6px 8px' }}></th>
                                                                                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Soll lt. {page.prepay.historyUsed ? 'Miethistorie' : 'Vertrag'}</th>
                                                                                <th style={{ textAlign: 'right', padding: '6px 8px' }}>gezahlt lt. Mietkonto</th>
                                                                                <th style={{ textAlign: 'right', padding: '6px 8px' }}>angesetzt</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {[
                                                                                { field: 'svc', label: 'Betriebskosten', soll: page.prepay.sollSvc, ist: page.prepay.istSvc, cents: page.prepay.svcCents, overridden: page.prepay.svcOverridden, active: true },
                                                                                { field: 'heat', label: 'Heizkosten', soll: page.prepay.sollHeat, ist: page.prepay.istHeat, cents: page.prepay.heatCents, overridden: page.prepay.heatOverridden, active: page.prepay.includeHeating }
                                                                            ].map(r => (
                                                                                <tr key={r.field} style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                                    <td style={{ padding: '6px 8px' }}>{r.label}</td>
                                                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatEUR(r.soll)}</td>
                                                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{page.prepay.hasPaymentData ? formatEUR(r.ist) : '–'}</td>
                                                                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                                                                        {r.active ? (
                                                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                                                                <CurrencyInput allowDecimals value={centsToEuro(r.cents)}
                                                                                                    onValueChange={v => setPrepayOverride(page.leaseId, r.field, v)}
                                                                                                    style={{ width: '110px', padding: '4px 6px', borderRadius: '6px', border: `1px solid ${r.overridden ? '#f59e0b' : 'var(--border-color)'}`, textAlign: 'right', fontSize: '0.82rem' }} />
                                                                                                {r.overridden && (
                                                                                                    <button type="button" title="Automatischen Wert übernehmen" onClick={() => setPrepayOverride(page.leaseId, r.field, null)}
                                                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)', display: 'inline-flex', padding: 0 }}>
                                                                                                        <RotateCcw size={13} />
                                                                                                    </button>
                                                                                                )}
                                                                                            </span>
                                                                                        ) : <span style={{ color: 'var(--text-secondary)' }}>nicht angerechnet</span>}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                                                                    Automatisch angesetzt werden die laut Mietkonto gezahlten Vorauszahlungen (Zahlungen eines Monats zuerst auf die Vorauszahlungen angerechnet, höchstens das Soll), ohne Zahlungsdaten das Soll. Ein eingetragener Betrag ersetzt den automatischen Wert.
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {vac && unitPages.length > 0 && (
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                            Leerstand {vac.days} Tage – Vermieteranteil {formatCents(vac.totalCents)}.
                                                        </div>
                                                    )}
                                                </div>
                                            </Modal>
                                        );
                                    })()}
                                </div>
                            );
                        })()}

                        {/* ===== WIZARD FOOTER ===== */}
                        {isMobile ? (
                            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                                <div style={{ marginBottom: '8px' }}>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={ArrowLeft} onClick={goBack} disabled={busy} style={{ width: '100%' }}>Zurück</Button>
                                    )}
                                    {wizardStep === 0 && (
                                        <Button variant="secondary" onClick={() => setWizardOpen(false)} disabled={saving} style={{ width: '100%' }}>Abbrechen</Button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={Save} onClick={() => saveSettlement('draft')} disabled={busy} style={{ flex: 1 }}>{saving ? 'Speichert …' : 'Entwurf'}</Button>
                                    )}
                                    {wizardStep < 3 ? (
                                        <Button icon={ArrowRight} onClick={goNext} disabled={busy} style={{ flex: 1 }}>Weiter</Button>
                                    ) : (
                                        <Button icon={Check} onClick={() => saveSettlement('done')} disabled={busy} style={{ flex: 1, backgroundColor: 'var(--success-color)' }}>
                                            {saving ? 'Speichert …' : 'Fertigstellen'}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)'
                            }}>
                                <div>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={ArrowLeft} onClick={goBack} disabled={busy}>Zurück</Button>
                                    )}
                                    {wizardStep === 0 && (
                                        <Button variant="secondary" onClick={() => setWizardOpen(false)} disabled={saving}>Abbrechen</Button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={Save} onClick={() => saveSettlement('draft')} disabled={busy}>{saving ? 'Speichert …' : 'Entwurf speichern'}</Button>
                                    )}
                                    {wizardStep < 3 ? (
                                        <Button icon={ArrowRight} onClick={goNext} disabled={busy}>Weiter</Button>
                                    ) : (
                                        <Button icon={Check} onClick={() => saveSettlement('done')} disabled={busy} style={{ backgroundColor: 'var(--success-color)' }}>
                                            {saving ? 'Speichert …' : 'Abrechnung fertigstellen'}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </Card>
                </div>

                {/* Create Key Modal - MUST be inside wizard return block to render during wizard */}
                <Modal
                    isOpen={isCreateKeyModalOpen}
                    onClose={() => setIsCreateKeyModalOpen(false)}
                    title="Neuen Verteilerschlüssel erstellen"
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setIsCreateKeyModalOpen(false)}>Abbrechen</Button>
                            <Button onClick={handleCreateNewKey}>Speichern</Button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Dieser Schlüssel wird in den Einstellungen gespeichert und steht für zukünftige Abrechnungen zur Verfügung.
                            Er verteilt nach Einzelwerten je Einheit (z. B. Verbrauch): Die Werte tragen Sie bei der Kostenart ein oder übernehmen sie aus Zählerständen.
                        </p>
                        <Input
                            label="Bezeichnung"
                            value={newKeyName}
                            onChange={e => setNewKeyName(e.target.value)}
                            placeholder="z.B. Sonderumlage Garten"
                        />
                        <Input
                            label="Beschreibung (optional)"
                            value={newKeyDescription}
                            onChange={e => setNewKeyDescription(e.target.value)}
                            placeholder="Kurze Beschreibung des Schlüssels"
                        />
                    </div>
                </Modal>
            </>
        );
    }

    // ===== LIST VIEW =====
    const settlementsByGroup = {};
    groupedProperties.forEach(group => {
        if (group.isGroup) {
            settlementsByGroup[group.id] = settlements.filter(s => s.economic_unit_id === group.economic_unit_id);
        } else {
            settlementsByGroup[group.id] = settlements.filter(s => s.property_id === group.id && !s.economic_unit_id);
        }
    });

    const deadlineInfo = (s) => {
        if (s.status === 'done') return null;
        const deadline = settlementDeadline(s.period_end);
        if (!deadline) return null;
        const overdue = today > deadline;
        return (
            <div style={{ fontSize: '0.72rem', color: overdue ? 'var(--danger-color)' : 'var(--text-secondary)' }}>
                {overdue ? 'Abrechnungsfrist abgelaufen am ' : 'Frist bis '}{formatDateDE(deadline)}
            </div>
        );
    };

    const renderPdfMenuItems = (s, mobile) => {
        const entries = pdfEntriesFor(s);
        if (!entries.length) {
            return <div style={{ padding: mobile ? '10px 12px 10px 24px' : '6px 12px 6px 24px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Keine Mieter im Zeitraum</div>;
        }
        return entries.map(item => (
            <button key={`dl-${item.key}`} disabled={pdfBusy} onClick={() => { setOpenSettlementMenuId(null); downloadSettlement(s, item.key); }}
                style={mobile
                    ? { textAlign: 'left', padding: '10px 12px 10px 24px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid #eee' }
                    : { textAlign: 'left', padding: '6px 12px 6px 24px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                onMouseEnter={mobile ? undefined : (e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                onMouseLeave={mobile ? undefined : (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                <Download size={mobile ? 16 : 12} /> {item.unitName} – {item.label}
            </button>
        ));
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Nebenkostenabrechnung</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Erstellen und verwalten Sie Ihre Betriebskostenabrechnungen</p>
                </div>
                {pdfBusy && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <Loader2 size={16} className="animate-spin" /> PDF wird erstellt …
                    </div>
                )}
            </div>

            {loadError && <IssueList issues={[{ level: 'error', text: loadError }]} />}

            {groupedProperties.length === 0 ? (
                <Card>
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Immobilien gefunden. Erstellen Sie zunächst eine Immobilie.
                    </div>
                </Card>
            ) : (
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    {groupedProperties.map(prop => {
                        const propSettlements = settlementsByGroup[prop.id] || [];
                        const propUnits = prop.isGroup ? units.filter(u => u.property?.economic_unit_id === prop.economic_unit_id) : units.filter(u => u.property_id === prop.id);
                        const isExpanded = expandedProperty === prop.id;

                        return (
                            <Card key={prop.id}>
                                <div
                                    onClick={() => setExpandedProperty(isExpanded ? null : prop.id)}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        cursor: 'pointer', padding: '4px 0', flexWrap: 'wrap', gap: '10px'
                                    }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '1.05rem', color: prop.isGroup ? 'var(--accent-color)' : 'var(--text-primary)' }}>{prop.street} {prop.house_number}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                {prop.zip} {prop.city} · {propUnits.length} Einheiten
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{propSettlements.length} Abrechnung(en)</span>
                                        {canWriteNk(groupPortfolioId(prop)) ? (
                                            <Button size="sm" icon={Plus} onClick={(e) => { e.stopPropagation(); startNewSettlement(prop.id); }}>
                                                Neue Abrechnung
                                            </Button>
                                        ) : (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }} title="Freigabe nur zum Lesen">
                                                <Lock size={12} /> Nur lesen
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', overflow: 'visible' }}>
                                        {propSettlements.length === 0 ? (
                                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                                Noch keine Abrechnungen für dieses Objekt.
                                            </div>
                                        ) : !isMobile ? (
                                            <div>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Abrechnungsjahr</th>
                                                            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Zeitraum</th>
                                                            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Erstellt am</th>
                                                            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Status</th>
                                                            <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Aktionen</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {propSettlements.map(s => (
                                                            <tr key={s.id} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{s.year || settlementYearLabel(s.period_start, s.period_end)}</td>
                                                                <td style={{ padding: '10px 12px', fontSize: '0.85rem' }}>
                                                                    {formatDateDE(s.period_start)} – {formatDateDE(s.period_end)}
                                                                    {deadlineInfo(s)}
                                                                </td>
                                                                <td style={{ padding: '10px 12px', fontSize: '0.85rem' }}>
                                                                    {formatTimestamp(s.created_at)}
                                                                </td>
                                                                <td style={{ padding: '10px 12px' }}>
                                                                    <StatusBadge status={s.status} frozen={!!getSnapshot(s)} />
                                                                </td>
                                                                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                                                    <div style={{ position: 'relative', display: 'inline-block' }}>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (openSettlementMenuId === s.id) {
                                                                                    setOpenSettlementMenuId(null);
                                                                                } else {
                                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                                    setSettlementMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                                                                                    setOpenSettlementMenuId(s.id);
                                                                                }
                                                                            }}
                                                                            style={{
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                padding: '6px', border: 'none', background: 'none',
                                                                                cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                                                                                color: 'var(--text-secondary)', transition: 'all 0.15s'
                                                                            }}
                                                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--background-color)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                                                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                                                        >
                                                                            <MoreVertical size={18} />
                                                                        </button>

                                                                        {openSettlementMenuId === s.id && settlementMenuPos && createPortal(
                                                                            <>
                                                                                {/* Invisible backdrop to close menu on outside click */}
                                                                                <div onClick={() => setOpenSettlementMenuId(null)} style={{
                                                                                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998
                                                                                }} />
                                                                                <div style={{
                                                                                    position: 'fixed', zIndex: 9999,
                                                                                    top: settlementMenuPos.top,
                                                                                    right: settlementMenuPos.right,
                                                                                    backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                                                                    minWidth: '220px', maxHeight: '60vh', overflowY: 'auto',
                                                                                    display: 'flex',
                                                                                    flexDirection: 'column', padding: '4px'
                                                                                }}>
                                                                                    {canWriteSettlement(s) ? (
                                                                                        <button onClick={() => { setOpenSettlementMenuId(null); editSettlement(s); }}
                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                                                                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                                            <Edit2 size={14} /> {s.status === 'done' ? 'Wieder öffnen / bearbeiten' : 'Bearbeiten'}
                                                                                        </button>
                                                                                    ) : (
                                                                                        <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                                                            <Lock size={14} /> Nur lesen (Freigabe)
                                                                                        </div>
                                                                                    )}
                                                                                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                    <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                                                        PDF herunterladen{s.status !== 'done' ? ' (Entwurf)' : ''}
                                                                                    </div>
                                                                                    {renderPdfMenuItems(s, false)}
                                                                                    {canWriteSettlement(s) && (
                                                                                        <>
                                                                                            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                            <button onClick={() => { setOpenSettlementMenuId(null); deleteSettlement(s); }}
                                                                                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)', borderRadius: '4px' }}
                                                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                                                <Trash2 size={14} /> Löschen
                                                                                            </button>
                                                                                        </>
                                                                                    )}
                                                                                </div>
                                                                            </>,
                                                                            document.body
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                {propSettlements.map(s => (
                                                    <div key={s.id} style={{
                                                        border: '1px solid var(--border-color)',
                                                        borderRadius: 'var(--radius-md)',
                                                        padding: 'var(--spacing-md)',
                                                        backgroundColor: 'var(--surface-color)',
                                                        position: 'relative'
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                            <div>
                                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{s.year || settlementYearLabel(s.period_start, s.period_end)}</div>
                                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                                    {formatDateDE(s.period_start)} – {formatDateDE(s.period_end)}
                                                                </div>
                                                                {deadlineInfo(s)}
                                                            </div>
                                                            <StatusBadge status={s.status} frozen={!!getSnapshot(s)} />
                                                        </div>

                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                                            Erstellt: {formatTimestamp(s.created_at)}
                                                        </div>

                                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                                            <div style={{ position: 'relative', display: 'block', width: '100%' }}>
                                                                {canWriteSettlement(s) ? (
                                                                    <Button variant="secondary" size="sm" icon={Edit2} onClick={() => editSettlement(s)} style={{ width: '100%', justifyContent: 'center', marginBottom: '8px' }}>
                                                                        {s.status === 'done' ? 'Wieder öffnen' : 'Bearbeiten'}
                                                                    </Button>
                                                                ) : (
                                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                                        <Lock size={14} /> Nur lesen (Freigabe)
                                                                    </div>
                                                                )}

                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                    <Button variant="ghost" size="sm" icon={FileText} onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setOpenSettlementMenuId(openSettlementMenuId === s.id ? null : s.id);
                                                                    }} style={{ flex: 1 }}>
                                                                        Optionen
                                                                    </Button>
                                                                    {canWriteSettlement(s) && (
                                                                        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => deleteSettlement(s)} style={{ color: 'var(--danger-color)' }} />
                                                                    )}
                                                                </div>

                                                                {openSettlementMenuId === s.id && (
                                                                    <>
                                                                        <div onClick={() => setOpenSettlementMenuId(null)} style={{
                                                                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998,
                                                                            backgroundColor: 'rgba(15, 23, 42, 0.3)'
                                                                        }} />
                                                                        <div onClick={(e) => e.stopPropagation()} style={{
                                                                            position: 'fixed', zIndex: 9999,
                                                                            top: '50%', left: '50%', transform: 'translate(-50%, -50%)', // Center on mobile
                                                                            backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                                                                            width: '90%', maxWidth: '300px',
                                                                            display: 'flex', flexDirection: 'column', padding: '4px',
                                                                            maxHeight: '80vh', overflowY: 'auto'
                                                                        }}>
                                                                            <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                <span style={{ fontWeight: 600 }}>Optionen</span>
                                                                                <button onClick={() => setOpenSettlementMenuId(null)} style={{ border: 'none', background: 'none' }}><X size={16} /></button>
                                                                            </div>

                                                                            {canWriteSettlement(s) && (
                                                                                <button onClick={() => { setOpenSettlementMenuId(null); editSettlement(s); }}
                                                                                    style={{ textAlign: 'left', padding: '12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                                                                                    <Edit2 size={16} /> {s.status === 'done' ? 'Wieder öffnen / bearbeiten' : 'Bearbeiten'}
                                                                                </button>
                                                                            )}

                                                                            <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, backgroundColor: 'var(--bg-secondary)' }}>
                                                                                PDF herunterladen{s.status !== 'done' ? ' (Entwurf)' : ''}
                                                                            </div>
                                                                            {renderPdfMenuItems(s, true)}
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div >
            )}
        </div>
    );
};

export default UtilityCosts;
