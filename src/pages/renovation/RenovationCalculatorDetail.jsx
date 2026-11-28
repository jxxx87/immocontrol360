import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, ArrowRight, Calculator, ChevronDown, ChevronRight,
    Plus, Trash2, Loader2, Save, CheckCircle2, Building2,
    Home, Building, Layers, Bath, PanelTop, Info, FileText, AlertTriangle
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { generateCalcLines } from './calcEngine';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { usePermission } from '../../context/PermissionContext';
import { useViewMode } from '../../context/ViewModeContext';
import { generateClientPdf } from '../../lib/pdfGenerator';
import { usePdfTemplate, fetchPdfTemplate } from '../../lib/usePdfTemplate';
import { translateError } from '../../lib/errorTranslator';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import { fmtEUR, fmtEUR0 as fmt0, round2, safeInternalPath, assertWrite } from '../../components/renovation/renovationUtils';

/* ─── Building type icons ───────── */
const BUILDING_TYPES = [
    { key: 'wohnung', label: 'Wohnung', icon: Home, description: 'Einzelne Wohnung' },
    { key: 'efh', label: 'Einfamilienhaus', icon: Building2, description: 'Freistehendes Haus' },
    { key: 'mfh', label: 'Mehrfamilienhaus', icon: Building, description: 'Mehrere Einheiten' },
];

const ROOF_TYPES = [
    { key: 'satteldach', label: 'Satteldach' },
    { key: 'walmdach', label: 'Walmdach' },
    { key: 'flachdach', label: 'Flachdach' },
];

const FLOOR_OPTIONS = ['Fliesen', 'Parkett', 'Vinyl', 'Laminat'];
const CURRENT_FLOOR_OPTIONS = ['Fliesen', 'Laminat/Vinyl/Parkett'];

const STEP_LABELS = ['Gebäude', 'Räume & Ausstattung', 'Kalkulation'];

const DEFAULT_RETURN = '/renovation?tab=calculator';
const UNSAVED_MESSAGE = 'Es gibt ungespeicherte Eingaben. Seite trotzdem verlassen? Die Änderungen gehen verloren.';

/* ─── Strukturhilfen (außerhalb der Komponente) ───── */
let idSeq = 0;
const newId = (prefix) => `${prefix}_${Date.now()}_${idSeq++}`;

const createDefaultWhg = (name) => ({
    id: newId('whg'),
    name,
    rooms: [],
    bathrooms: [],
    balcony: false,
    windows: [],
});

const floorLabel = (fi) => (fi === 0 ? 'Erdgeschoss' : `${fi}. OG`);

// Etagenstruktur an Gebäudetyp/Etagenzahl anpassen. Vorhandene Etagen bleiben unverändert,
// fehlende werden ergänzt: Wohnung = eine WHG, Einfamilienhaus = ein Wohnbereich je Etage
// (damit dort Zimmer erfasst werden können), Mehrfamilienhaus = Wohnungen fügt der Nutzer hinzu.
const buildFloorStructure = (prevFloors, type, count) => {
    const fc = type === 'wohnung' ? 1 : Math.max(1, count);
    return Array.from({ length: fc }, (_, fi) => {
        const existing = prevFloors[fi];
        if (existing) return existing;
        const label = floorLabel(fi);
        return {
            id: newId(`floor_${fi}`),
            label,
            whgs: type === 'mfh' ? [] : [createDefaultWhg(type === 'efh' ? `Wohnbereich ${label}` : 'WHG 1')],
        };
    });
};

const whgHasContent = (w) => (w.rooms || []).length > 0 || (w.bathrooms || []).length > 0 || (w.windows || []).length > 0;

// "Nur leere füllen": Abgleich über Gewerk + Untergewerk + Position; nur Zeilen ohne Menge
// werden gefüllt (eigene Preise bleiben), neu hinzugekommene Positionen werden angehängt.
const lineKey = (l) => `${l.trade}\u0001${l.subtrade}\u0001${l.position}`;
const mergeEmptyLines = (existingLines, newLines) => {
    const freshByKey = new Map(newLines.map(n => [lineKey(n), n]));
    const existingKeys = new Set(existingLines.filter(l => !l.isCustom).map(lineKey));
    const merged = existingLines.map(existing => {
        if (existing.isCustom || (existing.qty || 0) > 0) return existing;
        const fresh = freshByKey.get(lineKey(existing));
        if (!fresh) return existing;
        const qty = fresh.qty || 0;
        const ep = (existing.ep || 0) > 0 ? existing.ep : (fresh.ep || 0);
        // Aktiv-Status bei neuer Menge von der Engine übernehmen (berücksichtigt gewählte Alternativen)
        return { ...existing, qty, ep, gp: round2(qty * ep), enabled: qty > 0 ? !!fresh.enabled : existing.enabled };
    });
    const additions = newLines.filter(n => !existingKeys.has(lineKey(n)));
    return [...merged, ...additions];
};

const RenovationCalculatorDetail = () => {
    const { id } = useParams();
    const isNew = id === 'new';
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const perm = usePermission();
    const { isMobile } = useViewMode();
    const [searchParams] = useSearchParams();
    const pdfTemplate = usePdfTemplate('sanierung_rechner');

    // Rücksprungziel nur als interner Pfad (kein fremdes Ziel per präpariertem Link)
    const returnTo = safeInternalPath(searchParams.get('returnTo'), null);

    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(!isNew);
    const [loadError, setLoadError] = useState(null);
    const [dataWarning, setDataWarning] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [calcId, setCalcId] = useState(isNew ? null : id);
    // Gespeicherter Stand (Konto + Objekt): Wird das Objekt entfernt, ordnet die Datenbank die Kalkulation
    // dem Bearbeiter zu (Trigger trg_renovation_calculations_owner) – dafür die Rückfrage in handleSave
    const [savedOwner, setSavedOwner] = useState({ userId: null, propertyId: null });
    const [dirty, setDirty] = useState(false);
    const markDirty = () => setDirty(true);

    // ─── Step 0: Meta + Grunddaten ─────────
    const [name, setName] = useState('');
    const [calcType, setCalcType] = useState('buy_and_hold');
    const [propertyId, setPropertyId] = useState('');
    const [unitId, setUnitId] = useState('');
    const [dealId, setDealId] = useState('');
    const [properties, setProperties] = useState([]);
    const [extraProperties, setExtraProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [deals, setDeals] = useState([]);

    // ─── Step 1: Building ─────────
    const [buildingType, setBuildingType] = useState('wohnung');
    const [floorHeight, setFloorHeight] = useState(2.5);
    const [unitCount, setUnitCount] = useState(1);
    const [unitCountInput, setUnitCountInput] = useState('1');
    const [floorCount, setFloorCount] = useState(1);
    const [floorCountInput, setFloorCountInput] = useState('1');
    const [roofType, setRoofType] = useState('satteldach');
    const [houseWidth, setHouseWidth] = useState(0);
    const [houseLength, setHouseLength] = useState(0);
    const [roofAngle, setRoofAngle] = useState(35);
    const [gaubenCount, setGaubenCount] = useState(0);

    // ─── Step 2: Floors & Rooms ─────────
    // Neue Kalkulation: Startstruktur für den Standardtyp "Wohnung"
    const [floors, setFloors] = useState(() => (isNew ? buildFloorStructure([], 'wohnung', 1) : []));

    // ─── Step 3: Kalkulation ─────────
    // workItems: Altbestand früherer Versionen (nur noch Fallback für die Summe, wird mitgespeichert)
    const [workItems, setWorkItems] = useState([]);
    const [calcLines, setCalcLines] = useState([]);
    const [expandedTrades, setExpandedTrades] = useState({});
    const [showRecalcDialog, setShowRecalcDialog] = useState(false);
    const [calcGenerated, setCalcGenerated] = useState(false);
    const [loadingCalc, setLoadingCalc] = useState(false);
    // Herkunft der Preisliste der letzten Berechnung: 'own' | 'owner' | 'fallback'
    const [catalogSource, setCatalogSource] = useState(null);
    // Ziel für die Navigation nach erfolgreichem Speichern (erst nach dem Abschalten der Rückfrage)
    const [pendingNav, setPendingNav] = useState(null);

    // ─── WM Tooltip ─────────
    const [showWmInfo, setShowWmInfo] = useState(null); // bath id

    /* ─── Total WHG count across all floors ───── */
    const totalWhgCount = useMemo(() => {
        return floors.reduce((sum, f) => sum + f.whgs.length, 0);
    }, [floors]);

    /* ─── Immobilien-Auswahl inkl. gespeicherter Immobilie aus anderem Portfolio ───── */
    const propertyOptions = useMemo(
        () => [...properties, ...extraProperties.filter(e => !properties.some(p => p.id === e.id))],
        [properties, extraProperties]
    );

    /* ─── Lesemodus: gespeicherte Kalkulation eines Objekts ohne Schreibrecht ───── */
    // Wie die RLS (renovation_calculations_update prüft das gespeicherte Objekt): Schreibrecht „Immobilien“
    // oder „Investorportal“ im Portfolio des Objekts. Neue Kalkulationen und solche ohne Objekt (nur das
    // eigene Konto sieht sie) bleiben bearbeitbar; die Datenbank prüft beim Speichern zusätzlich.
    const savedProperty = savedOwner.propertyId ? propertyOptions.find(p => p.id === savedOwner.propertyId) : null;
    const canEdit = isNew || !savedOwner.propertyId || !savedProperty || !perm || perm.loadingPermissions
        || perm.canWrite('immobilien', savedProperty.portfolio_id) || perm.canWrite('investorportal', savedProperty.portfolio_id);

    // Rückfrage bei ungespeicherten Eingaben – auch bei Klicks in Seitenleiste/Topbar und beim Schließen des Tabs
    useUnsavedChangesGuard(dirty && canEdit ? UNSAVED_MESSAGE : null);
    // Navigation nach erfolgreichem Speichern erst, wenn die Rückfrage abgeschaltet ist (dirty = false)
    useEffect(() => {
        if (!pendingNav || dirty) return;
        navigate(pendingNav);
    }, [pendingNav, dirty, navigate]);

    /* ─── Auto-select deal from URL param ?dealId=xxx ───── */
    useEffect(() => {
        if (!isNew || !user) return;
        const urlDealId = searchParams.get('dealId');
        // searchParams.get() liefert bereits dekodierte Werte (kein zweites decodeURIComponent)
        const urlDealName = searchParams.get('dealName');
        // Immediately set name from URL (available before deals load)
        if (urlDealId && !dealId) {
            setDealId(urlDealId);
            if (urlDealName) setName(urlDealName);
        }
        // Once deals are loaded, set type and update name if not already set from URL
        if (urlDealId && deals.length > 0) {
            const deal = deals.find(d => d.id === urlDealId);
            if (deal) {
                setCalcType(deal.deal_type === 'fix_flip' ? 'fix_and_flip' : 'buy_and_hold');
                if (!urlDealName && !name) setName(deal.name || '');
            }
        }
    }, [isNew, user, searchParams, deals]);

    /* ─── Max/Min WHG ───── */
    // Mehrfamilienhaus: genau "Anzahl Einheiten"; Einfamilienhaus: ein Wohnbereich je Etage; Wohnung: eine WHG
    const maxWhg = buildingType === 'mfh' ? unitCount : buildingType === 'efh' ? floors.length : 1;
    const minWhg = buildingType === 'mfh' ? unitCount : 1;
    const structureComplete = totalWhgCount >= minWhg;
    const isEfhMfh = buildingType === 'efh' || buildingType === 'mfh';

    /* ─── Load data ───── */
    const loadProperties = async () => {
        let q = supabase.from('properties').select('id, street, house_number, city, zip, portfolio_id');
        if (selectedPortfolioID) q = q.eq('portfolio_id', selectedPortfolioID);
        const { data, error } = await q;
        if (error) {
            console.error('Error loading properties:', error);
            setDataWarning('Immobilien konnten nicht geladen werden: ' + translateError(error));
            return;
        }
        setProperties(data || []);
    };

    const loadUnits = async (propId) => {
        if (!propId) { setUnits([]); return; }
        const { data, error } = await supabase.from('units').select('id, unit_name').eq('property_id', propId);
        if (error) {
            console.error('Error loading units:', error);
            setDataWarning('Einheiten konnten nicht geladen werden: ' + translateError(error));
            return;
        }
        setUnits(data || []);
    };

    // Deals wie im Investorportal: gewähltes Portfolio plus eigene ohne Portfolio, sonst alle lesbaren
    // (auch die des Eigentümers bzw. von Mitnutzern im geteilten Portfolio – die RLS begrenzt)
    const loadDeals = async () => {
        let q = supabase.from('deals').select('id, name, deal_type, deal_data').order('updated_at', { ascending: false });
        if (selectedPortfolioID) q = q.or(`portfolio_id.eq.${selectedPortfolioID},portfolio_id.is.null`);
        const { data, error } = await q;
        if (error) {
            console.error('Error loading deals:', error);
            setDataWarning('Deals konnten nicht geladen werden: ' + translateError(error));
            return;
        }
        setDeals(data || []);
    };

    const loadCalculation = async () => {
        try {
            const { data, error } = await supabase
                .from('renovation_calculations')
                .select('*')
                .eq('id', id).single();
            if (error) throw error;
            setName(data.name);
            setCalcType(data.calc_type);
            setPropertyId(data.property_id || '');
            setUnitId(data.unit_id || '');
            setSavedOwner({ userId: data.user_id || null, propertyId: data.property_id || null });
            if (data.property_id) loadUnits(data.property_id);

            // Load building config from JSON
            const cfg = data.building_config || {};
            const type = cfg.buildingType || 'wohnung';
            setBuildingType(type);
            if (cfg.floorHeight) setFloorHeight(cfg.floorHeight);
            if (cfg.unitCount) { setUnitCount(cfg.unitCount); setUnitCountInput(String(cfg.unitCount)); }
            if (cfg.floorCount) { setFloorCount(cfg.floorCount); setFloorCountInput(String(cfg.floorCount)); }
            if (cfg.roofType) setRoofType(cfg.roofType);
            if (cfg.houseWidth) setHouseWidth(cfg.houseWidth);
            if (cfg.houseLength) setHouseLength(cfg.houseLength);
            if (cfg.roofAngle) setRoofAngle(cfg.roofAngle);
            if (cfg.gaubenCount) setGaubenCount(cfg.gaubenCount);
            // Ältere Datensätze ohne Etagen: Struktur aus Gebäudetyp/Etagenzahl aufbauen
            setFloors(Array.isArray(cfg.floors) && cfg.floors.length > 0 ? cfg.floors : buildFloorStructure([], type, cfg.floorCount || 1));
            if (cfg.workItems) setWorkItems(cfg.workItems);
            if (cfg.calcLines) { setCalcLines(cfg.calcLines); setCalcGenerated(true); }
            if (cfg.dealId) setDealId(cfg.dealId);
            setLoadError(null);
        } catch (err) {
            console.error(err);
            // Formular NICHT mit Standardwerten anzeigen – sonst würde Speichern den Datensatz überschreiben
            setLoadError(translateError(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!user) return;
        if (!isNew) loadCalculation();
    }, [user]);

    // Objekt- und Deal-Liste folgen der Portfolio-Auswahl
    useEffect(() => {
        if (!user) return;
        loadProperties();
        loadDeals();
    }, [user, selectedPortfolioID]);

    // Gespeicherte Immobilie immer in der Auswahl anbieten (z. B. aus anderem Portfolio)
    useEffect(() => {
        if (!propertyId || propertyOptions.some(p => p.id === propertyId)) return;
        let cancelled = false;
        supabase.from('properties').select('id, street, house_number, city, zip, portfolio_id').eq('id', propertyId).maybeSingle()
            .then(({ data, error }) => {
                if (cancelled) return;
                if (error) { console.error('Error loading assigned property:', error); return; }
                if (data) setExtraProperties(prev => (prev.some(p => p.id === data.id) ? prev : [...prev, data]));
            });
        return () => { cancelled = true; };
    }, [propertyId, propertyOptions]);

    /* ─── On deal selection: auto-set calc type + name, clear property ───── */
    const handleDealChange = (selectedId) => {
        setDealId(selectedId);
        // Mutual exclusivity: clear property when deal is selected
        if (selectedId) {
            setPropertyId('');
            setUnitId('');
            setUnits([]);
        }
        const deal = deals.find(d => d.id === selectedId);
        if (deal) {
            setCalcType(deal.deal_type === 'fix_flip' ? 'fix_and_flip' : 'buy_and_hold');
            setName(deal.name);
        } else if (!propertyId) {
            // Cleared deal and no property -> clear name only if it was deal-derived
            setName('');
        }
    };

    /* ─── On property selection: auto-set name, clear deal ───── */
    const handlePropertyChange = (selectedId) => {
        setPropertyId(selectedId);
        setUnitId('');
        loadUnits(selectedId);
        // Mutual exclusivity: clear deal when property is selected
        if (selectedId) {
            setDealId('');
            const prop = propertyOptions.find(p => p.id === selectedId);
            if (prop) setName(`${prop.street} ${prop.house_number || ''}, ${prop.city}`.trim());
        } else if (!dealId) {
            setName('');
        }
    };

    /* ─── Gebäudetyp / Etagenzahl: Etagenstruktur anpassen (auch bei gespeicherten Kalkulationen) ───── */
    // Liefert false, wenn der Nutzer das Entfernen befüllter Etagen ablehnt.
    const applyStructure = (nextType, nextCount) => {
        const fc = nextType === 'wohnung' ? 1 : Math.max(1, Math.min(6, nextCount));
        const removed = floors.slice(fc);
        const lostContent = removed.some(f => (f.whgs || []).some(whgHasContent));
        if (lostContent && !window.confirm(
            `Dadurch werden ${removed.length === 1 ? 'eine Etage' : `${removed.length} Etagen`} mit erfassten Räumen, Bädern bzw. Fenstern entfernt (${removed.map(f => f.label).join(', ')}). Fortfahren?`
        )) return false;
        setFloors(prev => buildFloorStructure(prev, nextType, fc));
        setDirty(true);
        return true;
    };

    const handleBuildingTypeChange = (nextType) => {
        if (nextType === buildingType) return;
        if (!applyStructure(nextType, floorCount)) return;
        setBuildingType(nextType);
        // Mehrfamilienhaus hat mindestens 2 Einheiten
        if (nextType === 'mfh' && unitCount < 2) { setUnitCount(2); setUnitCountInput('2'); }
    };

    const commitFloorCount = () => {
        const n = parseInt(floorCountInput, 10);
        if (!Number.isFinite(n)) { setFloorCountInput(String(floorCount)); return; }
        const clamped = Math.max(1, Math.min(6, n));
        if (clamped === floorCount) { setFloorCountInput(String(floorCount)); return; }
        if (applyStructure(buildingType, clamped)) {
            setFloorCount(clamped);
            setFloorCountInput(String(clamped));
        } else {
            setFloorCountInput(String(floorCount));
        }
    };

    // Einheitenzahl erst beim Verlassen des Feldes auf den Mindestwert klemmen (freie Eingabe möglich)
    const commitUnitCount = () => {
        const n = parseInt(unitCountInput, 10);
        const clamped = Number.isFinite(n) ? Math.max(2, n) : Math.max(2, unitCount);
        setUnitCount(clamped);
        setUnitCountInput(String(clamped));
        if (clamped !== unitCount) setDirty(true);
    };

    /* ─── Room/Bathroom/Window Management ───── */
    const updateFloor = (floorIdx, updater) => {
        setFloors(prev => prev.map((f, i) => i === floorIdx ? updater(f) : f));
        setDirty(true);
    };

    const updateFloorLabel = (floorIdx, newLabel) => {
        setFloors(prev => prev.map((f, i) => i === floorIdx ? { ...f, label: newLabel } : f));
        setDirty(true);
    };

    const addRoom = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                rooms: [...w.rooms, { id: `room_${Date.now()}`, name: `Zimmer ${w.rooms.length + 1}`, sqm: 0, currentFlooring: 'Laminat/Vinyl/Parkett', flooring: 'Parkett' }],
            } : w),
        }));
    };

    const addBathroom = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                bathrooms: [...w.bathrooms, {
                    id: `bath_${Date.now()}`, sqm: 0, wallTiles: '1.2m',
                    shower: false, bathtub: false, sinkCount: 1, urinalBidetCount: 0,
                    washingMachine: false,
                }],
            } : w),
        }));
    };

    const addWindow = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => {
                if (wi !== whgIdx) return w;
                return {
                    ...w,
                    windows: [...(w.windows || []), {
                        id: `win_${Date.now()}`, width: 100, height: 120, rollladen: true,
                    }],
                };
            }),
        }));
    };

    const addWhg = (floorIdx) => {
        if (totalWhgCount >= maxWhg) return;
        const floor = floors[floorIdx];
        const whgName = buildingType === 'efh' ? `Wohnbereich ${floor?.label || floorLabel(floorIdx)}` : `WHG ${totalWhgCount + 1}`;
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: [...f.whgs, createDefaultWhg(whgName)],
        }));
    };

    const removeWhg = (floorIdx, whgIdx) => {
        const whg = floors[floorIdx]?.whgs?.[whgIdx];
        if (whg && whgHasContent(whg) && !window.confirm(`„${whg.name}" mit allen erfassten Zimmern, Bädern und Fenstern entfernen?`)) return;
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.filter((_, wi) => wi !== whgIdx),
        }));
    };

    const updateWhgField = (floorIdx, whgIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? { ...w, [field]: value } : w),
        }));
    };

    const updateRoom = (floorIdx, whgIdx, roomIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                rooms: w.rooms.map((r, ri) => ri === roomIdx ? { ...r, [field]: value } : r),
            } : w),
        }));
    };

    const removeRoom = (floorIdx, whgIdx, roomIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w, rooms: w.rooms.filter((_, ri) => ri !== roomIdx),
            } : w),
        }));
    };

    const updateBathroom = (floorIdx, whgIdx, bathIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                bathrooms: w.bathrooms.map((b, bi) => bi === bathIdx ? { ...b, [field]: value } : b),
            } : w),
        }));
    };

    const removeBathroom = (floorIdx, whgIdx, bathIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w, bathrooms: w.bathrooms.filter((_, bi) => bi !== bathIdx),
            } : w),
        }));
    };

    const updateWindow = (floorIdx, whgIdx, winIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                windows: (w.windows || []).map((win, wii) => wii === winIdx ? { ...win, [field]: value } : win),
            } : w),
        }));
    };

    const removeWindow = (floorIdx, whgIdx, winIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w, windows: (w.windows || []).filter((_, wii) => wii !== winIdx),
            } : w),
        }));
    };

    /* ─── Grand total from work items ───── */
    const grandTotal = useMemo(() => {
        if (calcLines.length > 0) {
            return round2(calcLines.filter(l => l.enabled).reduce((sum, l) => sum + (l.gp || 0), 0));
        }
        return round2(workItems.filter(w => w.enabled).reduce((sum, w) => sum + (Number(w.total) || 0), 0));
    }, [workItems, calcLines]);

    /* ─── Verknüpften Deal aktualisieren ───── */
    // Deal unmittelbar vorher frisch laden und nur den Sanierungswert ändern (keine veralteten
    // deal_data aus dem Seitenaufruf zurückschreiben). total_investment enthält die Sanierung
    // linear (Kaufpreis + Nebenkosten [+ Finanzierung/Haltekosten] + Sanierung) und wird um die
    // Differenz angepasst, damit die Dealliste nicht bis zum nächsten Deal-Speichern alte Werte zeigt.
    const updateLinkedDeal = async (totalCost) => {
        const { data: fresh, error } = await supabase.from('deals')
            .select('id, deal_type, deal_data, total_investment')
            .eq('id', dealId).single();
        if (error) throw error;
        const key = fresh.deal_type === 'fix_flip' ? 'renovation' : fresh.deal_type === 'buy_hold' ? 'renovationCosts' : null;
        if (!key) return;
        const oldDealData = fresh.deal_data || {};
        const oldRenovation = parseFloat(oldDealData[key]) || 0;
        const payload = {
            deal_data: { ...oldDealData, [key]: totalCost },
            updated_at: new Date().toISOString(),
        };
        const oldTotal = Number(fresh.total_investment);
        if (Number.isFinite(oldTotal) && oldTotal > 0) {
            payload.total_investment = round2(oldTotal - oldRenovation + totalCost);
        }
        assertWrite(await supabase.from('deals').update(payload).eq('id', dealId).select('id'), 'Deal aktualisieren');
    };

    /* ─── Save ───── */
    const handleSave = async () => {
        if (saving || loadError || !canEdit) return;
        if (!name.trim()) { alert('Bitte Name der Kalkulation eingeben.'); return; }
        // Objekt entfernt (oder statt Objekt ein Deal gewählt) bei einer Kalkulation eines anderen Kontos:
        // Ohne Objekt sieht sie nur ihr user_id-Konto, die Datenbank ordnet sie deshalb dem Bearbeiter zu.
        if (calcId && savedOwner.propertyId && !propertyId && savedOwner.userId && savedOwner.userId !== user?.id
            && !window.confirm('Diese Kalkulation gehört einem anderen Konto (meist dem Eigentümer des Objekts). Ohne zugeordnetes Objekt – auch bei Verknüpfung mit einem Deal – wird sie beim Speichern Ihrem Konto zugeordnet und ist danach nur noch für Sie sichtbar, nicht mehr für den Eigentümer bzw. das bisherige Konto und andere Mitnutzer.\n\nFortfahren?')) return;
        setSaving(true);
        try {
            // Summe auf Cent gerundet speichern (keine Float-Reste in total_cost / deal_data)
            const totalCost = round2(grandTotal);
            const buildingConfig = {
                buildingType, floorHeight, unitCount, floorCount,
                roofType, houseWidth, houseLength, roofAngle, gaubenCount,
                floors, workItems, calcLines, dealId,
            };

            if (calcId) {
                // Fehler und "0 Zeilen geändert" (RLS/gelöscht) erkennen – sonst wäre die Eingabe still verloren
                const savedRows = assertWrite(await supabase.from('renovation_calculations').update({
                    name: name.trim(), calc_type: calcType,
                    property_id: propertyId || null, unit_id: unitId || null,
                    building_config: buildingConfig,
                    total_cost: totalCost,
                }).eq('id', calcId).select('id, user_id, property_id'), 'Kalkulation speichern');
                // user_id kann die Datenbank beim Objektwechsel angepasst haben
                const savedRow = Array.isArray(savedRows) ? savedRows[0] : null;
                if (savedRow) setSavedOwner({ userId: savedRow.user_id || null, propertyId: savedRow.property_id || null });
            } else {
                // Kalkulation zu einem Objekt gehört dem Portfolio-Eigentümer (wie Sanierungsprojekte,
                // G29-13), damit sie nicht am Konto eines Teammitglieds hängt. Die Datenbank lässt als
                // user_id das eigene Konto oder den Portfolio-Eigentümer zu (rls_user_ok); ohne Objekt
                // bzw. ohne lesbares Portfolio bleibt es das eigene Konto.
                const assignedProperty = propertyId ? propertyOptions.find(p => p.id === propertyId) : null;
                const dataOwner = (assignedProperty && (portfolios || []).find(pf => pf.id === assignedProperty.portfolio_id)?.user_id) || user.id;
                const { data, error } = await supabase.from('renovation_calculations').insert({
                    user_id: dataOwner, name: name.trim(), calc_type: calcType,
                    property_id: propertyId || null, unit_id: unitId || null,
                    building_config: buildingConfig,
                    total_cost: totalCost,
                }).select().single();
                if (error) throw error;
                setCalcId(data.id);
                setSavedOwner({ userId: data.user_id || null, propertyId: data.property_id || null });
                // Preserve query params (returnTo, dealId) when updating URL
                const currentParams = new URLSearchParams(window.location.search);
                const qs = currentParams.toString();
                window.history.replaceState(null, '', `/renovation/calculator/${data.id}${qs ? '?' + qs : ''}`);
            }
            setDirty(false);

            // Update deal if linked
            if (dealId) {
                try {
                    await updateLinkedDeal(totalCost);
                } catch (dealErr) {
                    console.error('Error updating linked deal:', dealErr);
                    alert('Die Kalkulation wurde gespeichert, aber der verknüpfte Deal konnte nicht aktualisiert werden: ' + translateError(dealErr) + '\nBitte erneut speichern.');
                    return;
                }
            }

            // Show success, then navigate back to the deal
            if (returnTo) {
                setSaveSuccess(true);
                setTimeout(() => {
                    setSaveSuccess(false);
                    navigate(returnTo);
                }, 800);
            } else {
                // Nicht sofort navigieren: die Rückfrage (dirty) ist in diesem Moment noch aktiv
                setPendingNav(DEFAULT_RETURN);
            }
        } catch (err) {
            alert('Fehler beim Speichern: ' + translateError(err));
        } finally {
            setSaving(false);
        }
    };

    /* ─── Zurück (die Rückfrage bei ungespeicherten Eingaben stellt useUnsavedChangesGuard) ───── */
    const handleBack = () => {
        navigate(returnTo || DEFAULT_RETURN);
    };

    /* ─── Schrittleiste: nach vorn nur mit derselben Bedingung wie "Weiter" ───── */
    const canGoToStep = (i) => i <= 1 || structureComplete;

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    if (loadError) {
        return (
            <div>
                <button onClick={() => navigate(returnTo || DEFAULT_RETURN)} style={backBtnStyle}>
                    <ArrowLeft size={16} /> {returnTo ? 'Zurück zum Deal' : 'Zurück zur Übersicht'}
                </button>
                <div style={{ maxWidth: '560px', margin: '20px auto', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#b91c1c' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, marginBottom: '8px' }}>
                        <AlertTriangle size={18} /> Kalkulation konnte nicht geladen werden
                    </div>
                    <p style={{ fontSize: '0.88rem', marginBottom: '16px' }}>{loadError}</p>
                    <Button size="sm" onClick={() => { setLoadError(null); setLoading(true); loadCalculation(); }}>Erneut laden</Button>
                </div>
            </div>
        );
    }

    /* ═══════════════════════════════════════
       RENDER
       ═══════════════════════════════════════ */
    return (
        <div onChangeCapture={markDirty}>
            {/* Back */}
            <button onClick={handleBack} style={backBtnStyle}>
                <ArrowLeft size={16} /> {returnTo ? 'Zurück zum Deal' : 'Zurück zur Übersicht'}
            </button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <Calculator size={isMobile ? 22 : 28} color="#f59e0b" />
                <h1 style={{ fontSize: isMobile ? '1.3rem' : '1.6rem', fontWeight: 700 }}>
                    {isNew ? 'Neuer Sanierungsrechner' : (name || 'Sanierungsrechner')}
                </h1>
            </div>

            {!canEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', marginBottom: '16px', borderRadius: 'var(--radius-md)', background: 'var(--background-color)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    <Info size={15} /> Nur Lesezugriff: Diese Kalkulation gehört zu einem Objekt, für das Sie kein Schreibrecht haben. Ansehen und PDF-Export sind möglich, Änderungen nicht.
                </div>
            )}

            {dataWarning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', marginBottom: '16px', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e', fontSize: '0.82rem' }}>
                    <AlertTriangle size={15} /> <span style={{ flex: 1 }}>{dataWarning}</span>
                    <button onClick={() => setDataWarning(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: '0.8rem' }}>Ausblenden</button>
                </div>
            )}

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
                {STEP_LABELS.map((label, i) => {
                    const allowed = canGoToStep(i);
                    return (
                        <button key={i} onClick={() => { if (allowed) setStep(i); }} disabled={!allowed}
                            title={allowed ? undefined : 'Bitte zuerst alle Wohnungen/Wohnbereiche anlegen'}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: isMobile ? '8px 10px' : '8px 16px', borderRadius: 'var(--radius-md)',
                                background: step === i ? '#0ea5e9' : 'var(--surface-color)',
                                color: step === i ? '#fff' : 'var(--text-secondary)',
                                border: step === i ? 'none' : '1px solid var(--border-color)',
                                fontSize: isMobile ? '0.75rem' : '0.85rem', fontWeight: 600,
                                cursor: allowed ? 'pointer' : 'not-allowed', opacity: allowed ? 1 : 0.5,
                                transition: 'all 0.15s', flex: isMobile ? 1 : undefined,
                            }}>
                            <span style={{
                                width: '22px', height: '22px', borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: step === i ? 'rgba(255,255,255,0.25)' : 'var(--border-color)',
                                fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
                            }}>{i + 1}</span>
                            {!isMobile ? label : label.split(' ')[0]}
                        </button>
                    );
                })}
            </div>

            {/* ═══ STEP 1: BUILDING ═══ */}
            {step === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <fieldset disabled={!canEdit} style={{ ...readOnlyFieldset, gap: '16px' }}>
                    {/* Deal / Property selection (mutual exclusive) */}
                    <Card>
                        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '12px' }}>Zuordnung & Name</h3>
                        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
                            <div>
                                <label style={labelStyle}>Verknüpfter Deal</label>
                                <select
                                    value={dealId}
                                    onChange={e => handleDealChange(e.target.value)}
                                    disabled={!!propertyId}
                                    style={{ ...inputStyle, opacity: propertyId ? 0.5 : 1 }}
                                >
                                    <option value="">— Kein Deal —</option>
                                    {dealId && !deals.some(d => d.id === dealId) && (
                                        <option value={dealId}>Verknüpfter Deal (nicht in Ihrer Liste)</option>
                                    )}
                                    {deals.map(d => (
                                        <option key={d.id} value={d.id}>
                                            {d.name} ({d.deal_type === 'fix_flip' ? 'Fix & Flip' : 'Buy & Hold'})
                                        </option>
                                    ))}
                                </select>
                                {propertyId && <span style={hintStyle}>Immobilie ist ausgewählt – Deal nicht verfügbar</span>}
                            </div>
                            <div>
                                <label style={labelStyle}>Immobilie</label>
                                <select
                                    value={propertyId}
                                    onChange={e => handlePropertyChange(e.target.value)}
                                    disabled={!!dealId}
                                    style={{ ...inputStyle, opacity: dealId ? 0.5 : 1 }}
                                >
                                    <option value="">— Keine Immobilie —</option>
                                    {propertyId && !propertyOptions.some(p => p.id === propertyId) && (
                                        <option value={propertyId}>Zugeordnete Immobilie (nicht verfügbar)</option>
                                    )}
                                    {propertyOptions.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.zip} {p.city}</option>)}
                                </select>
                                {dealId && <span style={hintStyle}>Deal ist ausgewählt – Immobilie nicht verfügbar</span>}
                            </div>
                            {propertyId && units.length > 0 && (
                                <div>
                                    <label style={labelStyle}>Einheit (optional)</label>
                                    <select value={unitId} onChange={e => setUnitId(e.target.value)} style={inputStyle}>
                                        <option value="">— Gesamtes Projekt —</option>
                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label style={labelStyle}>Kalkulationstyp</label>
                                <select value={calcType} onChange={e => setCalcType(e.target.value)} style={inputStyle}>
                                    <option value="buy_and_hold">Buy & Hold</option>
                                    <option value="fix_and_flip">Fix & Flip</option>
                                </select>
                            </div>
                        </div>

                        {/* Name – shown when neither deal nor property selected */}
                        <div style={{ marginTop: '12px' }}>
                            <label style={labelStyle}>
                                Name der Kalkulation *
                                {(dealId || propertyId) && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}> (automatisch übernommen)</span>}
                            </label>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={dealId || propertyId ? '' : 'z.B. Sanierung Musterstraße 12'}
                                readOnly={!!(dealId || propertyId)}
                                style={{
                                    ...inputStyle, fontWeight: 600, fontSize: '0.95rem', maxWidth: '500px',
                                    background: (dealId || propertyId) ? 'var(--background-color)' : 'var(--surface-color)',
                                }}
                            />
                        </div>
                    </Card>

                    {/* Building Type Selection */}
                    <Card>
                        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '16px' }}>Gebäudetyp</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                            {BUILDING_TYPES.map(bt => (
                                <button key={bt.key} onClick={() => handleBuildingTypeChange(bt.key)} style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                                    padding: '20px 16px', borderRadius: 'var(--radius-lg)',
                                    border: buildingType === bt.key ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                    background: buildingType === bt.key ? 'rgba(14,165,233,0.08)' : 'var(--surface-color)',
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }}>
                                    <bt.icon size={36} color={buildingType === bt.key ? '#0ea5e9' : 'var(--text-secondary)'} />
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: buildingType === bt.key ? '#0ea5e9' : 'var(--text-primary)' }}>{bt.label}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{bt.description}</span>
                                </button>
                            ))}
                        </div>

                        {/* Building dimensions */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '12px' }}>
                            <div>
                                <label style={labelStyle}>Geschosshöhe (m)</label>
                                <input type="number" step="0.1" value={floorHeight} onChange={e => setFloorHeight(Number(e.target.value))} style={inputStyle} />
                            </div>
                            {buildingType === 'mfh' && (
                                <div>
                                    <label style={labelStyle}>Anzahl Einheiten</label>
                                    <input type="number" min="2" value={unitCountInput}
                                        onChange={e => setUnitCountInput(e.target.value)}
                                        onBlur={commitUnitCount}
                                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        style={inputStyle} />
                                </div>
                            )}
                            {(buildingType === 'efh' || buildingType === 'mfh') && (
                                <div>
                                    <label style={labelStyle}>Anzahl Etagen</label>
                                    <input type="number" min="1" max="6" value={floorCountInput}
                                        onChange={e => setFloorCountInput(e.target.value)}
                                        onBlur={commitFloorCount}
                                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        style={inputStyle} />
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Roof & Dimensions */}
                    {(buildingType === 'efh' || buildingType === 'mfh') && (
                        <Card>
                            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '16px' }}>Dach & Abmessungen</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                {ROOF_TYPES.map(rt => (
                                    <button key={rt.key} onClick={() => { setRoofType(rt.key); markDirty(); }} style={{
                                        padding: '12px', borderRadius: 'var(--radius-md)', textAlign: 'center',
                                        border: roofType === rt.key ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                        background: roofType === rt.key ? 'rgba(14,165,233,0.08)' : 'var(--surface-color)',
                                        cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                                        color: roofType === rt.key ? '#0ea5e9' : 'var(--text-primary)',
                                    }}>
                                        {rt.label}
                                    </button>
                                ))}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={labelStyle}>Breite (Giebelseite) m</label>
                                    <input type="number" step="0.1" value={houseWidth} onChange={e => setHouseWidth(Number(e.target.value))} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Länge (Traufseite) m</label>
                                    <input type="number" step="0.1" value={houseLength} onChange={e => setHouseLength(Number(e.target.value))} style={inputStyle} />
                                </div>
                                {roofType !== 'flachdach' && (
                                    <div>
                                        <label style={labelStyle}>Dachneigung (°)</label>
                                        <input type="number" min="0" max="60" value={roofAngle} onChange={e => setRoofAngle(Number(e.target.value))} style={inputStyle} />
                                    </div>
                                )}
                                <div>
                                    <label style={labelStyle}>Anzahl Gauben</label>
                                    <input type="number" min="0" value={gaubenCount} onChange={e => setGaubenCount(Number(e.target.value))} style={inputStyle} />
                                </div>
                            </div>
                        </Card>
                    )}
                    </fieldset>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <Button onClick={() => setStep(1)}>
                            Weiter <ArrowRight size={15} style={{ marginLeft: '4px' }} />
                        </Button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 2: ROOMS & UNITS ═══ */}
            {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* WHG counter info */}
                    {buildingType === 'mfh' && (
                        <div style={{
                            padding: '10px 16px', borderRadius: 'var(--radius-md)',
                            background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)',
                            fontSize: '0.82rem', color: 'var(--text-secondary)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <span>Wohnungen zugewiesen</span>
                            <span style={{ fontWeight: 700, color: totalWhgCount >= maxWhg ? '#0ea5e9' : 'var(--text-primary)' }}>
                                {totalWhgCount} / {maxWhg}
                            </span>
                        </div>
                    )}

                    <fieldset disabled={!canEdit} style={{ ...readOnlyFieldset, gap: '12px' }}>
                    {floors.map((floor, fi) => (
                        <Card key={floor.id}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                <Layers size={18} color="#0ea5e9" />
                                <input
                                    value={floor.label}
                                    onChange={e => updateFloorLabel(fi, e.target.value)}
                                    style={{ ...inputStyle, fontWeight: 700, fontSize: '0.95rem', maxWidth: '220px', padding: '6px 10px' }}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    ({floor.whgs.length} {buildingType === 'efh'
                                        ? (floor.whgs.length === 1 ? 'Wohnbereich' : 'Wohnbereiche')
                                        : (floor.whgs.length === 1 ? 'Wohnung' : 'Wohnungen')})
                                </span>
                            </div>

                            {floor.whgs.map((whg, wi) => (
                                <div key={whg.id} style={{ marginBottom: '16px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--background-color)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                        <Home size={16} color="#f59e0b" />
                                        <input value={whg.name} onChange={e => updateWhgField(fi, wi, 'name', e.target.value)} style={{ ...inputStyle, fontWeight: 700, maxWidth: '200px' }} />
                                        <button onClick={() => removeWhg(fi, wi)} style={deleteBtnStyle} title="Entfernen"><Trash2 size={14} /></button>
                                        <div style={{ flex: 1 }} />
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                                            title="Nur Notiz – fließt nicht in die Kalkulation ein. Balkonflächen bitte in Schritt 3 unter Metallbau (Balkon-Stahlkonstruktion, WPC Balkonbelag in m²) eintragen.">
                                            <input type="checkbox" checked={whg.balcony} onChange={e => updateWhgField(fi, wi, 'balcony', e.target.checked)} />
                                            Balkon <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>(Notiz)</span>
                                        </label>
                                    </div>

                                    {/* Rooms */}
                                    <div style={{ marginBottom: '8px' }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Zimmer</div>
                                        {whg.rooms.length > 0 && !isMobile && (
                                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 130px 110px 28px', gap: '6px', marginBottom: '4px' }}>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Name</span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textAlign: 'right' }}>m²</span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Ist-Zustand</span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Neuer Belag</span>
                                                <span></span>
                                            </div>
                                        )}
                                        {whg.rooms.map((room, ri) => (
                                            <div key={room.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 60px 90px 90px 28px' : '2fr 80px 130px 110px 28px', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
                                                <input value={room.name} onChange={e => updateRoom(fi, wi, ri, 'name', e.target.value)} style={inputStyleSm} placeholder="Name" />
                                                <input type="number" step="0.1" value={room.sqm || ''} onChange={e => updateRoom(fi, wi, ri, 'sqm', Number(e.target.value))} style={{ ...inputStyleSm, textAlign: 'right' }} placeholder="m²" />
                                                <select value={room.currentFlooring || 'Laminat/Vinyl/Parkett'} onChange={e => updateRoom(fi, wi, ri, 'currentFlooring', e.target.value)} style={inputStyleSm} title="Ist-Zustand">
                                                    {CURRENT_FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                                                </select>
                                                <select value={room.flooring} onChange={e => updateRoom(fi, wi, ri, 'flooring', e.target.value)} style={inputStyleSm} title="Neuer Bodenbelag">
                                                    {FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                                                </select>
                                                <button onClick={() => removeRoom(fi, wi, ri)} style={deleteBtnStyle}><Trash2 size={12} /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => addRoom(fi, wi)} style={addBtnStyle}><Plus size={12} /> Zimmer</button>
                                    </div>

                                    {/* Bathrooms */}
                                    <div style={{ marginBottom: '8px' }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                                            <Bath size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Badezimmer
                                        </div>
                                        {whg.bathrooms.map((bath, bi) => (
                                            <div key={bath.id} style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '6px', background: 'var(--surface-color)' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '80px 120px 1fr 1fr 1fr 1fr 1fr 28px', gap: '6px', alignItems: 'center' }}>
                                                    <div>
                                                        <span style={miniLabel}>m²</span>
                                                        <input type="number" step="0.1" value={bath.sqm || ''} onChange={e => updateBathroom(fi, wi, bi, 'sqm', Number(e.target.value))} style={inputStyleSm} />
                                                    </div>
                                                    <div>
                                                        <span style={miniLabel}>Wandfliesen</span>
                                                        <select value={bath.wallTiles} onChange={e => updateBathroom(fi, wi, bi, 'wallTiles', e.target.value)} style={inputStyleSm}>
                                                            <option value="raumhoch">Raumhoch</option>
                                                            <option value="1.2m">1,2m Spiegel</option>
                                                        </select>
                                                    </div>
                                                    <label style={checkboxLabel}>
                                                        <input type="checkbox" checked={bath.shower} onChange={e => updateBathroom(fi, wi, bi, 'shower', e.target.checked)} /> Dusche
                                                    </label>
                                                    <label style={checkboxLabel}>
                                                        <input type="checkbox" checked={bath.bathtub} onChange={e => updateBathroom(fi, wi, bi, 'bathtub', e.target.checked)} /> Badewanne
                                                    </label>
                                                    <div>
                                                        <span style={miniLabel}>Waschbecken</span>
                                                        <input type="number" min="0" value={bath.sinkCount} onChange={e => updateBathroom(fi, wi, bi, 'sinkCount', Number(e.target.value))} style={inputStyleSm} />
                                                    </div>
                                                    <div>
                                                        <span style={miniLabel}>Urinal/Bidet</span>
                                                        <input type="number" min="0" value={bath.urinalBidetCount} onChange={e => updateBathroom(fi, wi, bi, 'urinalBidetCount', Number(e.target.value))} style={inputStyleSm} />
                                                    </div>
                                                    <div style={{ position: 'relative' }}>
                                                        <label style={checkboxLabel}>
                                                            <input type="checkbox" checked={bath.washingMachine} onChange={e => updateBathroom(fi, wi, bi, 'washingMachine', e.target.checked)} />
                                                            WM
                                                            <Info
                                                                size={13}
                                                                color="var(--text-secondary)"
                                                                style={{ cursor: 'pointer', flexShrink: 0 }}
                                                                onMouseEnter={() => setShowWmInfo(bath.id)}
                                                                onMouseLeave={() => setShowWmInfo(null)}
                                                            />
                                                        </label>
                                                        {showWmInfo === bath.id && (
                                                            <div style={{
                                                                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                                                                background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                borderRadius: '8px', padding: '8px 12px', fontSize: '0.72rem',
                                                                boxShadow: '0 4px 16px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
                                                                zIndex: 50, marginBottom: '4px', color: 'var(--text-primary)',
                                                            }}>
                                                                Vorbereitung eines Waschmaschinenanschlusses<br />
                                                                (Wasser, Abwasser, Strom)
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button onClick={() => removeBathroom(fi, wi, bi)} style={deleteBtnStyle}><Trash2 size={12} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        <button onClick={() => addBathroom(fi, wi)} style={addBtnStyle}><Plus size={12} /> Badezimmer</button>
                                    </div>

                                    {/* Windows */}
                                    <div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                                            <PanelTop size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Fenster
                                        </div>
                                        {(whg.windows || []).map((win, wii) => (
                                            <div key={win.id} style={{ display: 'grid', gridTemplateColumns: '80px 10px 80px 100px 28px', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
                                                <div>
                                                    <span style={miniLabel}>Breite cm</span>
                                                    <input type="number" value={win.width} onChange={e => updateWindow(fi, wi, wii, 'width', Number(e.target.value))} style={inputStyleSm} />
                                                </div>
                                                <span style={{ textAlign: 'center', fontWeight: 700 }}>×</span>
                                                <div>
                                                    <span style={miniLabel}>Höhe cm</span>
                                                    <input type="number" value={win.height} onChange={e => updateWindow(fi, wi, wii, 'height', Number(e.target.value))} style={inputStyleSm} />
                                                </div>
                                                <label style={checkboxLabel}
                                                    title="Nur Notiz – fließt nicht in die Kalkulation ein (keine Rollladen-Position im Katalog). Bei Bedarf in Schritt 3 als eigene Position ergänzen.">
                                                    <input type="checkbox" checked={win.rollladen} onChange={e => updateWindow(fi, wi, wii, 'rollladen', e.target.checked)} /> Rollladen <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>(Notiz)</span>
                                                </label>
                                                <button onClick={() => removeWindow(fi, wi, wii)} style={deleteBtnStyle}><Trash2 size={12} /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => addWindow(fi, wi)} style={addBtnStyle}><Plus size={12} /> Fenster</button>
                                    </div>
                                </div>
                            ))}

                            {/* Add WHG – MFH up to unitCount; Wohnung/EFH: leere Etage wieder befüllbar */}
                            {buildingType === 'mfh' && totalWhgCount < maxWhg && (
                                <button onClick={() => addWhg(fi)} style={{ ...addBtnStyle, marginTop: '8px' }}>
                                    <Plus size={13} /> Wohnung hinzufügen ({totalWhgCount}/{maxWhg})
                                </button>
                            )}
                            {buildingType === 'mfh' && totalWhgCount >= maxWhg && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                                    Maximale Anzahl Wohnungen erreicht ({maxWhg})
                                </div>
                            )}
                            {buildingType !== 'mfh' && floor.whgs.length === 0 && totalWhgCount < maxWhg && (
                                <button onClick={() => addWhg(fi)} style={{ ...addBtnStyle, marginTop: '8px' }}>
                                    <Plus size={13} /> {buildingType === 'efh' ? 'Wohnbereich hinzufügen' : 'Wohnung hinzufügen'}
                                </button>
                            )}
                        </Card>
                    ))}
                    </fieldset>

                    {!structureComplete && (
                        <div style={{
                            padding: '10px 16px', borderRadius: 'var(--radius-md)',
                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                            fontSize: '0.82rem', color: '#b91c1c',
                            display: 'flex', alignItems: 'center', gap: '8px',
                        }}>
                            <Info size={16} />
                            {buildingType === 'mfh' ? (
                                <span>Bitte alle <strong>{minWhg}</strong> Wohnungen anlegen. Aktuell: <strong>{totalWhgCount}</strong> von {minWhg}.</span>
                            ) : (
                                <span>Bitte mindestens {buildingType === 'efh' ? 'einen Wohnbereich' : 'eine Wohnung'} anlegen.</span>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <Button variant="secondary" onClick={() => setStep(0)}>
                            <ArrowLeft size={15} style={{ marginRight: '4px' }} /> Zurück
                        </Button>
                        <Button onClick={() => setStep(2)} disabled={!structureComplete} style={{ opacity: structureComplete ? 1 : 0.5 }}>
                            Kalkulation <ArrowRight size={15} style={{ marginLeft: '4px' }} />
                        </Button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 3: KALKULATION ═══ */}
            {step === 2 && (() => {
                /* ─── Generate Calculation ───── */
                const doGenerateCalc = async (mode = 'all') => {
                    if (!canEdit) return;
                    setLoadingCalc(true);
                    try {
                        // Preisliste wie im Projekt-Assistenten: die des Portfolio-Eigentümers des Objekts bzw. des
                        // Kontos, dem die Kalkulation gehört; ohne (lesbare) Einträge die eigene Preisliste
                        const assignedProperty = propertyId ? propertyOptions.find(p => p.id === propertyId) : null;
                        const portfolioOwner = assignedProperty
                            ? (portfolios || []).find(pf => pf.id === assignedProperty.portfolio_id)?.user_id
                            : null;
                        // Ohne Objekt gehört die Kalkulation dem eigenen Konto → eigene Preisliste
                        const catalogOwner = assignedProperty ? (portfolioOwner || savedOwner.userId || user.id) : user.id;
                        const loadTrades = (uid) => supabase
                            .from('renovation_trades')
                            .select('*, subtrades:renovation_subtrades(*)')
                            .eq('user_id', uid)
                            .order('sort_order');
                        let { data: tData, error: tErr } = await loadTrades(catalogOwner);
                        let source = catalogOwner === user.id ? 'own' : 'owner';
                        if (catalogOwner !== user.id && (tErr || (tData || []).length === 0)) {
                            ({ data: tData, error: tErr } = await loadTrades(user.id));
                            source = 'fallback';
                        }
                        // Ohne erfolgreich geladene Stammdaten die vorhandene Kalkulation NICHT ersetzen
                        if (tErr) throw tErr;

                        const userTrades = (tData || []).map(t => ({
                            ...t,
                            subtrades: (t.subtrades || []).map(s => ({
                                ...s,
                                positions: Array.isArray(s.positions)
                                    ? s.positions
                                    : (typeof s.positions === 'string' ? JSON.parse(s.positions) : []),
                            })),
                        }));

                        if (userTrades.length === 0) {
                            alert('Es sind keine Gewerke/Preislisten hinterlegt. Bitte zuerst in den Einstellungen des Sanierungsmanagers den Standard-Katalog laden.');
                            return;
                        }

                        const newLines = generateCalcLines({
                            buildingType, floorHeight, unitCount, floorCount,
                            roofType, houseWidth, houseLength, roofAngle, gaubenCount,
                            floors, userTrades,
                        });

                        if (mode === 'all' || calcLines.length === 0) {
                            setCalcLines(newLines);
                        } else if (mode === 'empty') {
                            setCalcLines(prev => mergeEmptyLines(prev, newLines));
                        }
                        setDirty(true);
                        setCatalogSource(source);

                        setCalcGenerated(true);
                        // Auto-expand all trades
                        const expanded = {};
                        userTrades.forEach(t => { expanded[t.name] = true; });
                        setExpandedTrades(expanded);
                    } catch (err) {
                        alert('Fehler beim Berechnen – die bisherige Kalkulation bleibt unverändert: ' + translateError(err));
                    } finally {
                        setLoadingCalc(false);
                        setShowRecalcDialog(false);
                    }
                };

                /* ─── Update a single calc line ───── */
                const updateCalcLine = (idx, field, value) => {
                    setCalcLines(prev => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], [field]: value };
                        if (field === 'qty' || field === 'ep') {
                            next[idx].gp = Math.round(((next[idx].qty || 0) * (next[idx].ep || 0)) * 100) / 100;
                        }
                        return next;
                    });
                    setDirty(true);
                };

                /* ─── Add custom position to a trade ───── */
                const addCalcLine = (tradeName) => {
                    // Find the last line of this trade to insert after it
                    const lastIdx = calcLines.reduce((last, l, i) => l.trade === tradeName ? i : last, -1);
                    const insertAt = lastIdx + 1;
                    const newLine = {
                        id: `custom_${Date.now()}`,
                        trade: tradeName,
                        subtrade: 'Sonstige',
                        position: 'Neue Position',
                        unit: 'Stk.',
                        ep: 0,
                        qty: 0,
                        gp: 0,
                        enabled: true,
                        isCustom: true,
                    };
                    setCalcLines(prev => [
                        ...prev.slice(0, insertAt),
                        newLine,
                        ...prev.slice(insertAt),
                    ]);
                    setDirty(true);
                };

                /* ─── Remove custom position ───── */
                const removeCalcLine = (idx) => {
                    setCalcLines(prev => prev.filter((_, i) => i !== idx));
                    setDirty(true);
                };

                /* ─── Group calc lines by trade ───── */
                const groupedByTrade = calcLines.reduce((acc, line, idx) => {
                    if (!acc[line.trade]) acc[line.trade] = [];
                    acc[line.trade].push({ ...line, _idx: idx });
                    return acc;
                }, {});

                /* ─── Summary stats ───── */
                const allRoomsCount = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.rooms || []).length, 0), 0);
                const allBathsCount = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.bathrooms || []).length, 0), 0);
                const allWindowsCount = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.windows || []).length, 0), 0);
                const allWhgCount = floors.reduce((s, f) => s + f.whgs.length, 0);
                const totalRoomSqm = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.rooms || []).reduce((s3, r) => s3 + (r.sqm || 0), 0), 0), 0);
                const totalBathSqm = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.bathrooms || []).reduce((s3, b) => s3 + (b.sqm || 0), 0), 0), 0);

                const enabledTotal = calcLines.filter(l => l.enabled).reduce((s, l) => s + (l.gp || 0), 0);
                const tradeTotal = (tradeName) => calcLines.filter(l => l.trade === tradeName && l.enabled).reduce((s, l) => s + (l.gp || 0), 0);

                /* ─── PDF-Export (Fehler abfangen, Vorlage notfalls Standard) ───── */
                const exportPdf = async () => {
                    const prop = propertyId ? propertyOptions.find(p => p.id === propertyId) : null;
                    const needsTemplateFetch = !!prop?.portfolio_id;
                    // Muss vor dem Druck noch die Vorlage geladen werden, das Fenster synchron im Klick
                    // öffnen – nach einem await blockieren Browser das Pop-up sonst.
                    const targetWindow = needsTemplateFetch ? window.open('', '_blank') : null;
                    try {
                        const pdfData = Object.entries(groupedByTrade).map(([tradeName, lines]) => ({
                            gewerk: tradeName,
                            summe: lines.filter(l => l.enabled).reduce((s, l) => s + (l.gp || 0), 0),
                            // Deutsche Schreibweise wie im übrigen PDF (Menge mit Komma, Beträge „1.250,00 €“)
                            positionen: lines.filter(l => l.enabled).map(l => `${l.position}: ${(Number(l.qty) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${l.unit || 'Stk'} × ${fmtEUR(l.ep)} = ${fmtEUR(l.gp)}`).join('\n'),
                        }));
                        // Resolve the correct PDF template based on the property's portfolio
                        let tpl = pdfTemplate;
                        if (needsTemplateFetch) {
                            try {
                                tpl = await fetchPdfTemplate(prop.portfolio_id, 'sanierung_rechner');
                            } catch (tplErr) {
                                console.error('PDF template could not be loaded, using default:', tplErr);
                                tpl = pdfTemplate;
                            }
                        }
                        const opened = await generateClientPdf({
                            reportType: 'sanierung_rechner',
                            data: pdfData,
                            selectedColumns: ['gewerk', 'summe', 'positionen'],
                            showSums: true,
                            portfolioName: name || 'Kalkulation',
                            template: tpl,
                            subtitle: `Gesamt: ${enabledTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`,
                            targetWindow,
                        });
                        if (opened === false && targetWindow && !targetWindow.closed) targetWindow.close();
                    } catch (err) {
                        console.error('PDF export failed:', err);
                        if (targetWindow && !targetWindow.closed) targetWindow.close();
                        alert('PDF-Export fehlgeschlagen: ' + translateError(err));
                    }
                };

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Summary Card */}
                        <Card>
                            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Info size={16} color="#0ea5e9" /> Zusammenfassung Eingaben
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '10px' }}>
                                {[
                                    { label: 'Gebäudetyp', value: BUILDING_TYPES.find(b => b.key === buildingType)?.label },
                                    { label: 'Etagen', value: buildingType === 'wohnung' ? '–' : floorCount },
                                    { label: 'Geschosshöhe', value: `${floorHeight} m` },
                                    { label: 'Einheiten', value: buildingType === 'mfh' ? unitCount : 1 },
                                    { label: buildingType === 'efh' ? 'Wohnbereiche' : 'Wohnungen', value: allWhgCount },
                                    { label: 'Zimmer', value: allRoomsCount },
                                    { label: 'Bäder', value: allBathsCount },
                                    { label: 'Fenster', value: allWindowsCount },
                                    { label: 'Wohnfläche', value: `${totalRoomSqm.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²` },
                                    { label: 'Badfläche', value: `${totalBathSqm.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²` },
                                    { label: 'Dachform', value: ROOF_TYPES.find(r => r.key === roofType)?.label || '–' },
                                    isEfhMfh ? { label: 'Gebäude', value: `${houseWidth}×${houseLength} m` } : { label: 'Gauben', value: gaubenCount },
                                ].map((item, i) => (
                                    <div key={i} style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--background-color)', border: '1px solid var(--border-color)' }}>
                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>{item.label}</div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </Card>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {!calcGenerated ? (
                                canEdit && (
                                    <Button onClick={() => doGenerateCalc('all')} disabled={loadingCalc} style={{ flex: 1 }}>
                                        {loadingCalc ? <Loader2 size={16} className="animate-spin" /> : <><Calculator size={15} style={{ marginRight: '6px' }} /> Kalkulation erstellen</>}
                                    </Button>
                                )
                            ) : (
                                <>
                                    {canEdit && (
                                        <Button variant="secondary" onClick={() => setShowRecalcDialog(true)} style={{ flex: 1 }}>
                                            <Calculator size={15} style={{ marginRight: '6px' }} /> Neu berechnen
                                        </Button>
                                    )}
                                    <Button variant="secondary" onClick={exportPdf}>
                                        <FileText size={15} style={{ marginRight: '6px' }} /> PDF Export
                                    </Button>
                                </>
                            )}
                        </div>
                        {catalogSource && catalogSource !== 'own' && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {catalogSource === 'owner'
                                    ? 'Preise aus der Preisliste des Portfolio-Eigentümers.'
                                    : 'Die Preisliste des Portfolio-Eigentümers ist leer oder nicht lesbar – es wurde Ihre eigene Preisliste verwendet.'}
                            </div>
                        )}

                        {/* Recalc Dialog */}
                        {showRecalcDialog && (
                            <Card style={{ border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.05)' }}>
                                <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px', color: '#92400e' }}>Mengen neu berechnen?</h4>
                                <p style={{ fontSize: '0.82rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                    Wählen Sie, ob alle Mengen überschrieben oder nur leere Felder gefüllt werden sollen.
                                    „Nur leere füllen" ergänzt außerdem neu hinzugekommene Positionen und behält eigene Preise.
                                </p>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <Button onClick={() => doGenerateCalc('all')} disabled={loadingCalc}>
                                        {loadingCalc ? <Loader2 size={14} className="animate-spin" /> : 'Alle überschreiben'}
                                    </Button>
                                    <Button variant="secondary" onClick={() => doGenerateCalc('empty')} disabled={loadingCalc}>
                                        Nur leere füllen
                                    </Button>
                                    <Button variant="secondary" onClick={() => setShowRecalcDialog(false)}>
                                        Abbrechen
                                    </Button>
                                </div>
                            </Card>
                        )}

                        {/* Calc Table */}
                        {calcGenerated && calcLines.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {Object.entries(groupedByTrade).map(([tradeName, lines]) => {
                                    const isExpanded = expandedTrades[tradeName];
                                    const tTotal = tradeTotal(tradeName);
                                    return (
                                        <Card key={tradeName} style={{ padding: '0', overflow: 'hidden' }}>
                                            {/* Trade Header */}
                                            <button
                                                onClick={() => setExpandedTrades(prev => ({ ...prev, [tradeName]: !prev[tradeName] }))}
                                                style={{
                                                    width: '100%', display: 'flex', justifyContent: 'space-between',
                                                    alignItems: 'center', padding: '12px 16px', border: 'none',
                                                    background: 'var(--surface-color)', cursor: 'pointer', color: 'var(--text-primary)',
                                                }}
                                            >
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{tradeName}</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>({lines.length} Pos.)</span>
                                                </span>
                                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: tTotal > 0 ? '#0ea5e9' : 'var(--text-secondary)' }}>
                                                    {fmt0(tTotal)}
                                                </span>
                                            </button>

                                            {/* Lines */}
                                            {isExpanded && (
                                                <div style={{ padding: '0 12px 12px' }}>
                                                    {/* Column headers */}
                                                    {!isMobile && (
                                                        <div style={{
                                                            display: 'grid', gridTemplateColumns: '28px 2fr 1fr 70px 80px 80px 90px 24px',
                                                            gap: '6px', padding: '6px 4px', borderBottom: '1px solid var(--border-color)',
                                                            fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase',
                                                        }}>
                                                            <span></span>
                                                            <span>Position</span>
                                                            <span>Untergewerk</span>
                                                            <span style={{ textAlign: 'right' }}>Menge</span>
                                                            <span>Einheit</span>
                                                            <span style={{ textAlign: 'right' }}>EP €</span>
                                                            <span style={{ textAlign: 'right' }}>GP €</span>
                                                            <span></span>
                                                        </div>
                                                    )}

                                                    {lines.map((line) => {
                                                        const idx = line._idx;
                                                        return (
                                                            <div key={idx} style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: isMobile
                                                                    ? '24px 1fr 60px 55px 70px 24px'
                                                                    : '28px 2fr 1fr 70px 80px 80px 90px 24px',
                                                                gap: '6px', padding: '5px 4px', alignItems: 'center',
                                                                borderBottom: '1px solid var(--border-color)',
                                                                opacity: line.enabled ? 1 : 0.4,
                                                                background: line.enabled && line.qty > 0 ? 'transparent' : 'var(--background-color)',
                                                            }}>
                                                                <input
                                                                    type="checkbox" checked={line.enabled} disabled={!canEdit}
                                                                    onChange={e => updateCalcLine(idx, 'enabled', e.target.checked)}
                                                                />
                                                                {line.isCustom ? (
                                                                    <input
                                                                        value={line.position} disabled={!canEdit}
                                                                        onChange={e => updateCalcLine(idx, 'position', e.target.value)}
                                                                        style={{ ...inputStyleSm, fontWeight: 500 }}
                                                                        placeholder="Positionsname"
                                                                    />
                                                                ) : (
                                                                    <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{line.position}</span>
                                                                )}
                                                                {!isMobile && (
                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{line.subtrade}</span>
                                                                )}
                                                                <input
                                                                    type="number" step="0.01" min="0"
                                                                    value={line.qty || ''} disabled={!canEdit}
                                                                    onChange={e => updateCalcLine(idx, 'qty', Number(e.target.value))}
                                                                    style={{ ...inputStyleSm, textAlign: 'right', fontWeight: 600 }}
                                                                />
                                                                {!isMobile && (
                                                                    line.isCustom ? (
                                                                        <select
                                                                            value={line.unit} disabled={!canEdit}
                                                                            onChange={e => updateCalcLine(idx, 'unit', e.target.value)}
                                                                            style={{ ...inputStyleSm, fontSize: '0.75rem' }}
                                                                        >
                                                                            {['Stk.', 'm²', 'lfm.', 'm³', 'psch.', 'Wo.', 'kg'].map(u => (
                                                                                <option key={u} value={u}>{u}</option>
                                                                            ))}
                                                                        </select>
                                                                    ) : (
                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{line.unit}</span>
                                                                    )
                                                                )}
                                                                <input
                                                                    type="number" step="0.01" min="0"
                                                                    value={line.ep || ''} disabled={!canEdit}
                                                                    onChange={e => updateCalcLine(idx, 'ep', Number(e.target.value))}
                                                                    style={{ ...inputStyleSm, textAlign: 'right' }}
                                                                />
                                                                <span style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.82rem', color: line.gp > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                                                    {fmt0(line.gp)}
                                                                </span>
                                                                {line.isCustom ? (
                                                                    <button onClick={() => removeCalcLine(idx)} disabled={!canEdit} style={deleteBtnStyle} title="Eigene Position entfernen"><Trash2 size={12} /></button>
                                                                ) : <span />}
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Add custom position */}
                                                    {canEdit && (
                                                        <div style={{ padding: '6px 4px 0' }}>
                                                            <button onClick={() => addCalcLine(tradeName)} style={addBtnStyle}>
                                                                <Plus size={12} /> Position
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        )}

                        {/* Grand Total */}
                        <div style={{
                            padding: '16px 20px', borderRadius: 'var(--radius-lg)',
                            background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                            color: '#fff',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '1rem', fontWeight: 600 }}>Gesamtkosten (aktive Positionen)</span>
                                <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmt0(grandTotal)}</span>
                            </div>
                            <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: '4px' }}>
                                Summe aus Menge × Einheitspreis ohne USt-Aufschlag – ob netto oder brutto, richtet sich nach den Preisen Ihrer Preisliste.
                            </div>
                        </div>

                        {/* Deal info */}
                        {dealId && (
                            <div style={{ padding: '10px 16px', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.82rem', color: '#92400e' }}>
                                <strong>Deal-Verknüpfung:</strong> Beim Speichern wird der Gesamtbetrag ({fmt0(grandTotal)}) im verknüpften Deal als{' '}
                                Sanierungskosten übernommen.
                            </div>
                        )}

                        {/* Navigation + Save */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                            <Button variant="secondary" onClick={() => setStep(1)}>
                                <ArrowLeft size={15} style={{ marginRight: '4px' }} /> Zurück
                            </Button>
                            {canEdit && (
                                <Button onClick={handleSave} disabled={saving || saveSuccess}>
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : saveSuccess ? <><CheckCircle2 size={15} style={{ marginRight: '4px', color: '#16a34a' }} /> Gespeichert</> : <><Save size={15} style={{ marginRight: '4px' }} /> Speichern</>}
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

/* ─── Styles ───── */
const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)', background: 'var(--surface-color)',
    fontSize: '0.875rem', outline: 'none', color: 'var(--text-primary)',
};

const inputStyleSm = {
    width: '100%', padding: '5px 8px', borderRadius: '6px',
    border: '1px solid var(--border-color)', fontSize: '0.8rem',
    outline: 'none', background: 'var(--surface-color)', color: 'var(--text-primary)',
};

const labelStyle = {
    display: 'block', fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', color: 'var(--text-secondary)',
};

const miniLabel = {
    display: 'block', fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '2px',
};

const checkboxLabel = {
    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

const deleteBtnStyle = {
    background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px',
};

const addBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px', fontSize: '0.78rem', color: '#0ea5e9',
    background: 'none', border: '1px dashed #0ea5e9', borderRadius: '6px', cursor: 'pointer',
};

const backBtnStyle = {
    display: 'flex', alignItems: 'center', gap: '4px', background: 'none',
    border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
    fontSize: '0.85rem', marginBottom: '16px',
};

const hintStyle = {
    display: 'block', fontSize: '0.7rem', color: '#f59e0b', marginTop: '4px', fontStyle: 'italic',
};

// Rahmenloses fieldset: sperrt im Lesemodus alle Eingaben eines Schritts, ohne das Layout zu ändern
const readOnlyFieldset = {
    border: 'none', padding: 0, margin: 0, minWidth: 0,
    display: 'flex', flexDirection: 'column',
};

// Beim Wechsel der Route-ID (z. B. Browser-Zurück zwischen zwei Kalkulationen) die Seite komplett
// neu aufbauen, damit calcId und alle Eingaben zur angezeigten Kalkulation gehören.
const RenovationCalculatorDetailPage = () => {
    const { id } = useParams();
    return <RenovationCalculatorDetail key={id} />;
};

export default RenovationCalculatorDetailPage;
