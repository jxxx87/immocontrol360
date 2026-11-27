import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    ArrowLeft, Save, Undo2, Redo2, FileText, Lock,
    ZoomIn, ZoomOut, Loader2, Image,
    Move, Trash2, RotateCcw, AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useViewMode } from '../../context/ViewModeContext';
import { REPORT_CONFIGS } from '../../lib/reportConfigs';
import { generateClientPdf, sanitizeLogoUrl, normalizeHexColor } from '../../lib/pdfGenerator';
import {
    HEADER_H, FOOTER_H, MM_TO_PX,
    MARGIN_OPTIONS, DEFAULT_MARGIN, SNAP_GRID, DEFAULT_ACCENT, PDF_FONT_STACK,
    ZOOM_LEVELS, EL_TYPES, MAX_FREETEXT, MAX_LINES,
    getPresetElements, elementDefaults, getPageDims, getSizeLimits,
    clampElementToPage, fitElementsToOrientation, hasElementCollision, getTemplateOrientation,
} from './constants';

// ─── Helpers ────────────────────────────────────────────────────────
const snap = (v) => Math.round(v / SNAP_GRID) * SNAP_GRID;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round1 = (v) => Math.round(v * 10) / 10;
const uid = () => `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const parseInputNumber = (raw) => {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
};
const pointerXY = (e) => {
    const t = e.touches?.[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: e.clientX, y: e.clientY };
};

const labelForType = (type) => {
    const map = {
        logo: 'Logo', title: 'Reporttitel', subtitle: 'Subtitel',
        portfolio_name: 'Portfolio-Name', date: 'Datum',
        page_number: 'Seitenzahl', line: 'Linie', freetext: 'Freitext',
    };
    return map[type] || type;
};

// Kollision eines Elements mit anderen sichtbaren Elementen derselben Zone (Logos ausgenommen)
const collides = (el, allElements) => {
    for (const other of allElements) {
        if (other.id === el.id || !other.visible) continue;
        if (other.zone !== el.zone) continue;
        if (el.type === EL_TYPES.LOGO || other.type === EL_TYPES.LOGO) continue;
        const ax1 = el.x, ay1 = el.y, ax2 = el.x + el.w, ay2 = el.y + (el.h || 0.5);
        const bx1 = other.x, by1 = other.y, bx2 = other.x + other.w, by2 = other.y + (other.h || 0.5);
        if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
    }
    return false;
};

// Ein Verlaufsschritt umfasst Elemente, Seitenrand und Orientierung
const snapshotOf = (elements, margin, orientation) => JSON.stringify({ elements, margin, orientation });

// ─── Logo-Upload ────────────────────────────────────────────────────
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const LOGO_PUBLIC_PATH = '/storage/v1/object/public/pdf-assets/';

// Prüft die Datei-Signatur (PNG/JPEG), nicht nur Endung bzw. MIME-Angabe des Browsers
const hasImageSignature = async (file, ext) => {
    try {
        const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        if (ext === 'png') return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
        if (ext === 'jpg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
        return false;
    } catch {
        return false;
    }
};

// Pfad im Bucket pdf-assets zu einer öffentlichen Logo-URL (nur eigener Storage)
const logoStoragePath = (url) => {
    const safe = sanitizeLogoUrl(url);
    if (!safe) return null;
    const { pathname } = new URL(safe);
    if (!pathname.startsWith(LOGO_PUBLIC_PATH)) return null;
    try {
        return decodeURIComponent(pathname.slice(LOGO_PUBLIC_PATH.length));
    } catch {
        return null;
    }
};

// ─── Test-PDF (Beispieldaten, klar als Muster erkennbar) ────────────
const TEST_COLUMNS = ['adresse', 'einheiten', 'kaufpreis', 'marktpreis', 'miete_monat'];
const TEST_ROWS = [
    { adresse: 'Musterstraße 1, 12345 Musterstadt', einheiten: 4, kaufpreis: 250000, marktpreis: 265000, miete_monat: 1450 },
    { adresse: 'Beispielweg 5, 54321 Beispielort', einheiten: 2, kaufpreis: 180000, marktpreis: 182000, miete_monat: 980 },
    { adresse: 'Testgasse 10, 99999 Testheim', einheiten: 6, kaufpreis: 320000, marktpreis: 335000, miete_monat: 2100 },
];

const NO_ROW_SAVED = 'Die Vorlage wurde nicht gespeichert – keine Berechtigung oder die Vorlage existiert nicht mehr. Bitte die Seite neu laden.';
const describeSaveError = (err) => {
    const msg = err?.message || String(err || 'Unbekannter Fehler');
    if (err?.code === '42501' || /row-level security/i.test(msg)) {
        return 'Keine Berechtigung, die PDF-Vorlage dieses Portfolios zu speichern.';
    }
    return msg;
};

// ─── Main Component ─────────────────────────────────────────────────
// Der Editor wird bei Nutzer- oder Portfoliowechsel neu eingehängt. So kann
// kein Zustand (Vorlagen-ID, Logo, Subtitel, Verlauf) in ein anderes
// Portfolio „mitwandern" und beim Speichern eine fremde Vorlage überschreiben.
const PdfTemplateEditor = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    return (
        <PdfTemplateEditorInner
            key={`${user?.id || '-'}:${selectedPortfolioID || '-'}`}
            portfolioId={selectedPortfolioID || ''}
        />
    );
};

function PdfTemplateEditorInner({ portfolioId }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const userId = user?.id || null;
    const { portfolios } = usePortfolio();
    const { isMobile } = useViewMode();

    // Where to go back to (from ExportDropdown or Settings)
    const backPath = location.state?.from || '/settings';

    // State
    const [loading, setLoading] = useState(() => Boolean(userId && portfolioId));
    const [loadError, setLoadError] = useState(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [saving, setSaving] = useState(false);
    const [saveNotice, setSaveNotice] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [templateId, setTemplateId] = useState(null);

    // Template data
    const [margin, setMargin] = useState(DEFAULT_MARGIN);
    const [elements, setElements] = useState([]);
    const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
    const [subtitlesByReport, setSubtitlesByReport] = useState({});
    const [logoUrl, setLogoUrl] = useState(null);

    // Global orientation (one for all reports)
    const [currentOrientation, setCurrentOrientation] = useState('portrait');
    const [collisionWarning, setCollisionWarning] = useState(false);

    // UI state
    const [selectedId, setSelectedId] = useState(null);
    const [activeZone, setActiveZone] = useState('header');
    const [zoom, setZoom] = useState(isMobile ? 0.6 : 1);
    const [rightTab, setRightTab] = useState('elements'); // 'elements' | 'properties'
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [todayStr] = useState(() => new Date().toLocaleDateString('de-DE'));

    // History (Undo/Redo) – Stapel im Ref, Position als State für die Buttons
    const historyRef = useRef({ stack: [], idx: -1 });
    const [historyPos, setHistoryPos] = useState({ idx: -1, len: 0 });

    // Immer aktuelle Werte für Event-Handler (keine Seiteneffekte in setState-Updatern)
    const elementsRef = useRef([]);
    const marginRef = useRef(DEFAULT_MARGIN);
    const orientationRef = useRef('portrait');
    const changeCountRef = useRef(0);
    const savingRef = useRef(false);
    const handleSaveRef = useRef(null);
    const savedLogoUrlRef = useRef(null);
    const uploadedLogoPathsRef = useRef([]);
    const dragRef = useRef(null);
    const collisionTimerRef = useRef(null);
    const noticeTimerRef = useRef(null);

    // Drag state
    const [dragging, setDragging] = useState(null);
    const previewRef = useRef(null);

    const selectedPortfolio = portfolios.find(p => p.id === portfolioId);

    const pageDims = getPageDims(currentOrientation);
    const pageW = pageDims.w;
    const pageH = pageDims.h;

    // ─── Dirty-Tracking ────────────────────────
    const markDirty = useCallback(() => {
        changeCountRef.current += 1;
        setDirty(true);
        setSaveNotice(null);
    }, []);

    // ─── Layout-State + Refs gemeinsam setzen ──
    const applyLayout = useCallback(({ elements: els, margin: mrg, orientation: ori }) => {
        if (els !== undefined) { elementsRef.current = els; setElements(els); }
        if (mrg !== undefined) { marginRef.current = mrg; setMargin(mrg); }
        if (ori !== undefined) { orientationRef.current = ori; setCurrentOrientation(ori); }
    }, []);

    // ─── History Management ────────────────────────
    const pushHistory = useCallback(() => {
        const snapshot = snapshotOf(elementsRef.current, marginRef.current, orientationRef.current);
        const h = historyRef.current;
        if (h.idx >= 0 && h.stack[h.idx] === snapshot) return; // keine echte Änderung
        const stack = [...h.stack.slice(0, h.idx + 1), snapshot];
        while (stack.length > 50) stack.shift();
        historyRef.current = { stack, idx: stack.length - 1 };
        setHistoryPos({ idx: stack.length - 1, len: stack.length });
    }, []);

    const resetHistory = useCallback(() => {
        historyRef.current = { stack: [snapshotOf(elementsRef.current, marginRef.current, orientationRef.current)], idx: 0 };
        setHistoryPos({ idx: 0, len: 1 });
    }, []);

    const restoreHistory = useCallback((idx) => {
        const h = historyRef.current;
        if (idx < 0 || idx >= h.stack.length || idx === h.idx) return;
        historyRef.current = { ...h, idx };
        setHistoryPos({ idx, len: h.stack.length });
        const snapshot = JSON.parse(h.stack[idx]);
        applyLayout({
            elements: Array.isArray(snapshot.elements) ? snapshot.elements : [],
            margin: Number(snapshot.margin) > 0 ? Number(snapshot.margin) : DEFAULT_MARGIN,
            orientation: snapshot.orientation === 'landscape' ? 'landscape' : 'portrait',
        });
        markDirty();
    }, [applyLayout, markDirty]);

    const undo = useCallback(() => restoreHistory(historyRef.current.idx - 1), [restoreHistory]);
    const redo = useCallback(() => restoreHistory(historyRef.current.idx + 1), [restoreHistory]);

    // Änderung übernehmen: State + Verlaufsschritt + ungespeichert
    const commitLayout = useCallback((changes) => {
        applyLayout(changes);
        pushHistory();
        markDirty();
    }, [applyLayout, pushHistory, markDirty]);

    const flashCollisionWarning = useCallback((hasCollision) => {
        setCollisionWarning(hasCollision);
        clearTimeout(collisionTimerRef.current);
        if (hasCollision) collisionTimerRef.current = setTimeout(() => setCollisionWarning(false), 4000);
    }, []);

    useEffect(() => () => {
        clearTimeout(collisionTimerRef.current);
        clearTimeout(noticeTimerRef.current);
    }, []);

    const layoutOptions = useCallback(() => ({ orientation: orientationRef.current, margin: marginRef.current }), []);

    // ─── Move element ──────────────────────────
    const moveElement = useCallback((id, dx, dy) => {
        const prev = elementsRef.current;
        const idx = prev.findIndex(e => e.id === id);
        if (idx < 0) return;
        const el = prev[idx];
        const newEl = clampElementToPage({ ...el, x: round1(el.x + dx), y: round1(el.y + dy) }, layoutOptions());
        if (newEl.x === el.x && newEl.y === el.y) return; // am Rand – keine Bewegung, kein Verlaufsschritt
        const next = prev.map((e, i) => i === idx ? newEl : e);
        if (collides(newEl, next)) return; // blocked
        commitLayout({ elements: next });
    }, [commitLayout, layoutOptions]);

    // ─── Update single element property ────────
    const updateElement = useCallback((id, updates) => {
        const prev = elementsRef.current;
        const idx = prev.findIndex(e => e.id === id);
        if (idx < 0) return;
        let newEl = { ...prev[idx], ...updates };
        // If logo aspect locked
        if (newEl.type === EL_TYPES.LOGO && updates.w !== undefined && newEl.aspectRatio) {
            newEl.h = Math.round(newEl.w / newEl.aspectRatio * 10) / 10;
        }
        newEl = clampElementToPage(newEl, layoutOptions());
        const next = prev.map((e, i) => i === idx ? newEl : e);
        if (updates.x !== undefined || updates.y !== undefined || updates.w !== undefined || updates.h !== undefined) {
            if (collides(newEl, next)) return;
        }
        commitLayout({ elements: next });
    }, [commitLayout, layoutOptions]);

    // ─── Add element (orientation-aware) ────────
    const addElement = useCallback((type) => {
        const prev = elementsRef.current;
        if (type === EL_TYPES.FREETEXT && prev.filter(e => e.type === EL_TYPES.FREETEXT).length >= MAX_FREETEXT) return;
        if (type === EL_TYPES.LINE && prev.filter(e => e.type === EL_TYPES.LINE).length >= MAX_LINES) return;
        const def = elementDefaults(type, marginRef.current, orientationRef.current);
        const el = clampElementToPage({ ...def, id: uid(), zone: activeZone }, layoutOptions());
        commitLayout({ elements: [...prev, el] });
        setSelectedId(el.id);
        setRightTab('properties');
    }, [activeZone, commitLayout, layoutOptions]);

    // ─── Remove element ────────────────────────
    const removeElement = useCallback((id) => {
        const prev = elementsRef.current;
        if (!prev.some(e => e.id === id)) return;
        commitLayout({ elements: prev.filter(e => e.id !== id) });
        setSelectedId(cur => (cur === id ? null : cur));
    }, [commitLayout]);

    // ─── Reset to standard layout ──────────────
    const resetToStandard = useCallback(() => {
        if (!window.confirm('Layout auf den Standard zurücksetzen? Alle Elemente und der Seitenrand werden ersetzt (mit „Rückgängig" wiederherstellbar).')) return;
        commitLayout({ elements: getPresetElements('standard', orientationRef.current), margin: DEFAULT_MARGIN });
        setSelectedId(null);
    }, [commitLayout]);

    // ─── Switch Orientation (global) ──────────────
    const switchOrientation = useCallback((newOri) => {
        const oldOri = orientationRef.current;
        if (oldOri === newOri) return;
        // Proportionale Umrechnung + Begrenzung (dieselbe Logik nutzt der PDF-Generator)
        const newEls = fitElementsToOrientation(elementsRef.current, { from: oldOri, to: newOri, margin: marginRef.current });
        flashCollisionWarning(hasElementCollision(newEls));
        commitLayout({ elements: newEls, orientation: newOri });
        setSelectedId(null);
    }, [commitLayout, flashCollisionWarning]);

    // ─── Change margin (Elemente neu begrenzen, per Undo umkehrbar) ──
    const changeMargin = useCallback((value) => {
        const newMargin = Number(value);
        if (!MARGIN_OPTIONS.includes(newMargin) || newMargin === marginRef.current) return;
        const newEls = elementsRef.current.map(el => clampElementToPage(el, { orientation: orientationRef.current, margin: newMargin }));
        flashCollisionWarning(hasElementCollision(newEls));
        commitLayout({ elements: newEls, margin: newMargin });
    }, [commitLayout, flashCollisionWarning]);

    // ─── Load Template ─────────────────────────
    useEffect(() => {
        if (!userId || !portfolioId) return undefined;
        let cancelled = false;
        const load = async () => {
            const { data, error } = await supabase
                .from('pdf_templates')
                .select('*')
                .eq('portfolio_id', portfolioId)
                .maybeSingle();
            if (cancelled) return;
            if (error) throw error;

            if (data) {
                const safeLogo = sanitizeLogoUrl(data.logo_url);
                const subs = data.subtitles_by_report_type;
                setTemplateId(data.id);
                setAccentColor(normalizeHexColor(data.accent_color) || DEFAULT_ACCENT);
                setSubtitlesByReport(subs && typeof subs === 'object' && !Array.isArray(subs) ? subs : {});
                setLogoUrl(safeLogo);
                savedLogoUrlRef.current = safeLogo;
                applyLayout({
                    elements: Array.isArray(data.elements) ? data.elements : [],
                    margin: Number(data.margin_mm) > 0 ? Number(data.margin_mm) : DEFAULT_MARGIN,
                    // Use the stored (global) orientation, or default to portrait
                    orientation: getTemplateOrientation(data.orientation_by_report_type),
                });
            } else {
                // Noch keine Vorlage: Standard-Layout anzeigen (zählt nicht als Änderung)
                setTemplateId(null);
                applyLayout({ elements: getPresetElements('standard', 'portrait'), margin: DEFAULT_MARGIN, orientation: 'portrait' });
            }
            resetHistory();
            changeCountRef.current = 0;
            setDirty(false);
            setLoadError(null);
            setLoading(false);
        };
        load().catch(err => {
            if (cancelled) return;
            // Nicht stillschweigend auf den Standard ausweichen – sonst würde beim
            // Speichern eine bestehende Vorlage überschrieben.
            setLoadError(err?.message || 'Unbekannter Fehler');
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [userId, portfolioId, reloadToken, applyLayout, resetHistory]);

    const retryLoad = () => {
        setLoadError(null);
        setLoading(true);
        setReloadToken(t => t + 1);
    };

    // ─── Save Template ─────────────────────────
    const cleanupReplacedLogos = (currentUrl) => {
        const keepPath = logoStoragePath(currentUrl);
        const candidates = [...uploadedLogoPathsRef.current, logoStoragePath(savedLogoUrlRef.current)];
        const toRemove = [...new Set(candidates)]
            .filter(p => p && p !== keepPath && p.startsWith(`logos/${portfolioId}/`));
        uploadedLogoPathsRef.current = [];
        savedLogoUrlRef.current = currentUrl;
        if (toRemove.length === 0) return;
        // Best effort: nicht mehr verwendete Logos aus dem öffentlichen Bucket entfernen
        supabase.storage.from('pdf-assets').remove(toRemove)
            .then(({ error }) => { if (error) console.warn('Altes Logo konnte nicht gelöscht werden:', error.message); })
            .catch(err => console.warn('Altes Logo konnte nicht gelöscht werden:', err));
    };

    const updateTemplateRow = async (payload, id) => {
        let query = supabase.from('pdf_templates').update(payload).eq('portfolio_id', portfolioId);
        if (id) query = query.eq('id', id);
        const { data, error } = await query.select('id').maybeSingle();
        if (error) throw error;
        return data?.id || null;
    };

    const handleSave = async () => {
        if (!userId || !portfolioId || loading || loadError || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        const changeAtStart = changeCountRef.current;
        try {
            // Eine globale Orientierung für alle Report-Typen (Liste aus den Report-Konfigurationen)
            const orientation = orientationRef.current;
            const orientationMap = {};
            Object.keys(REPORT_CONFIGS).forEach(rt => { orientationMap[rt] = orientation; });
            orientationMap.global = orientation;
            const safeLogo = sanitizeLogoUrl(logoUrl);
            const payload = {
                margin_mm: marginRef.current,
                header_height_mm: HEADER_H,
                footer_height_mm: FOOTER_H,
                accent_color: normalizeHexColor(accentColor) || DEFAULT_ACCENT,
                elements: elementsRef.current,
                orientation_by_report_type: orientationMap,
                subtitles_by_report_type: subtitlesByReport,
                logo_url: safeLogo,
                updated_at: new Date().toISOString(),
                updated_by: userId,
            };

            let savedId = null;
            if (templateId) {
                // user_id bleibt beim Aktualisieren unverändert (kein Besitzwechsel)
                savedId = await updateTemplateRow(payload, templateId);
            } else {
                // Neue Vorlage gehört dem Eigentümer des Portfolios
                const ownerId = selectedPortfolio?.user_id || userId;
                const { data, error } = await supabase
                    .from('pdf_templates')
                    .insert({ ...payload, portfolio_id: portfolioId, user_id: ownerId })
                    .select('id')
                    .single();
                if (error?.code === '23505') {
                    // Inzwischen existiert eine Vorlage für dieses Portfolio → diese aktualisieren
                    savedId = await updateTemplateRow(payload, null);
                } else if (error) {
                    throw error;
                } else {
                    savedId = data?.id || null;
                }
            }
            if (!savedId) throw new Error(NO_ROW_SAVED);

            setTemplateId(savedId);
            cleanupReplacedLogos(safeLogo);
            // Nur als gespeichert markieren, wenn währenddessen nichts geändert wurde
            if (changeCountRef.current === changeAtStart) {
                setDirty(false);
                setSaveNotice('Gespeichert');
                clearTimeout(noticeTimerRef.current);
                noticeTimerRef.current = setTimeout(() => setSaveNotice(null), 3000);
            }
        } catch (err) {
            alert('Fehler beim Speichern: ' + describeSaveError(err));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    // Strg+S ruft immer die aktuelle Speicherfunktion auf (kein veralteter Closure-Stand)
    useEffect(() => { handleSaveRef.current = handleSave; });

    // ─── Logo Upload ───────────────────────────
    const handleLogoUpload = async (file) => {
        if (!file || !portfolioId) return;
        const ext = LOGO_TYPES[file.type];
        if (!ext) {
            alert('Bitte ein Logo im Format PNG oder JPG hochladen.');
            return;
        }
        if (file.size > LOGO_MAX_BYTES) {
            alert('Das Logo ist zu groß (maximal 2 MB).');
            return;
        }
        setUploadingLogo(true);
        try {
            if (!(await hasImageSignature(file, ext))) {
                throw new Error('Die Datei ist kein gültiges PNG- bzw. JPG-Bild.');
            }
            const path = `logos/${portfolioId}/logo_${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('pdf-assets')
                .upload(path, file, { contentType: file.type, upsert: false });
            if (upErr) throw upErr;
            const { data: urlData } = supabase.storage.from('pdf-assets').getPublicUrl(path);
            const safeUrl = sanitizeLogoUrl(urlData?.publicUrl);
            if (!safeUrl) throw new Error('Ungültige Logo-Adresse.');
            uploadedLogoPathsRef.current = [...uploadedLogoPathsRef.current, path];
            setLogoUrl(safeUrl);
            markDirty();
        } catch (err) {
            alert('Logo-Upload fehlgeschlagen: ' + (err?.message || err));
        } finally {
            setUploadingLogo(false);
        }
    };

    // ─── Test PDF ──────────────────────────────
    // Nutzt denselben (abgesicherten) Generator wie der echte Export, damit
    // die Vorschau exakt dem späteren Druck entspricht.
    const handleTestPdf = () => {
        generateClientPdf({
            reportType: 'immobilien',
            data: TEST_ROWS,
            selectedColumns: TEST_COLUMNS,
            orientation: orientationRef.current,
            showSums: false,
            portfolioName: selectedPortfolio?.name || 'Mein Portfolio',
            template: {
                accentColor,
                logoUrl,
                subtitle: subtitlesByReport['global'] || '',
                elements: elementsRef.current,
                margin: marginRef.current,
                headerHeight: HEADER_H,
                footerHeight: FOOTER_H,
                orientationByReport: { global: orientationRef.current },
            },
            autoPrint: false,
        });
    };

    // ─── Back (mit Rückfrage bei ungespeicherten Änderungen) ──
    const handleBack = () => {
        if (dirty && !window.confirm('Es gibt ungespeicherte Änderungen an der PDF-Vorlage. Trotzdem verlassen?')) return;
        navigate(backPath);
    };

    // ─── Drag Handling ─────────────────────────
    const handlePointerDown = useCallback((e, elId) => {
        e.preventDefault();
        e.stopPropagation();
        const el = elementsRef.current.find(x => x.id === elId);
        if (!el || el.zone !== activeZone) return;
        setSelectedId(elId);
        setRightTab('properties');
        const rect = previewRef.current?.getBoundingClientRect();
        if (!rect) return;
        const p = pointerXY(e);
        dragRef.current = { moved: false };
        setDragging({
            id: elId,
            startX: p.x - rect.left,
            startY: p.y - rect.top,
            origX: el.x,
            origY: el.y,
        });
    }, [activeZone]);

    useEffect(() => {
        if (!dragging) return undefined;
        const scale = zoom * MM_TO_PX;
        const onMove = (e) => {
            const rect = previewRef.current?.getBoundingClientRect();
            if (!rect) return;
            const p = pointerXY(e);
            const dxMm = (p.x - rect.left - dragging.startX) / scale;
            const dyMm = (p.y - rect.top - dragging.startY) / scale;
            // Raster nur beim Ziehen mit der Maus
            const newX = snap(dragging.origX + dxMm);
            const newY = snap(dragging.origY + dyMm);

            const prev = elementsRef.current;
            const idx = prev.findIndex(x => x.id === dragging.id);
            if (idx < 0) return;
            const el = prev[idx];
            const clamped = clampElementToPage({ ...el, x: newX, y: newY }, { orientation: orientationRef.current, margin: marginRef.current });
            if (clamped.x === el.x && clamped.y === el.y) return;
            const next = prev.map((x, i) => i === idx ? clamped : x);
            if (collides(clamped, next)) return;
            applyLayout({ elements: next });
            if (dragRef.current) dragRef.current.moved = true;
        };
        const onUp = () => {
            // Verlaufsschritt/„ungespeichert" nur bei tatsächlicher Bewegung
            if (dragRef.current?.moved) {
                pushHistory();
                markDirty();
            }
            dragRef.current = null;
            setDragging(null);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };
    }, [dragging, zoom, applyLayout, pushHistory, markDirty]);

    // ─── Unsaved changes warning ───────────────
    useEffect(() => {
        const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    // ─── Keyboard shortcuts ────────────────────
    useEffect(() => {
        const isEditable = (node) => !!node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
        const handler = (e) => {
            const key = (e.key || '').toLowerCase();
            const mod = e.ctrlKey || e.metaKey;
            if (mod && key === 's') { e.preventDefault(); handleSaveRef.current?.(); return; }
            // In Eingabefeldern gelten die normalen Tasten (Cursor, Text-Undo, Löschen)
            if (isEditable(e.target) || isEditable(document.activeElement)) return;
            if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
            if (mod && key === 'y') { e.preventDefault(); redo(); return; }
            if (selectedId && !mod && !e.altKey) {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowLeft') { e.preventDefault(); moveElement(selectedId, -step, 0); }
                if (e.key === 'ArrowRight') { e.preventDefault(); moveElement(selectedId, step, 0); }
                if (e.key === 'ArrowUp') { e.preventDefault(); moveElement(selectedId, 0, -step); }
                if (e.key === 'ArrowDown') { e.preventDefault(); moveElement(selectedId, 0, step); }
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeElement(selectedId); }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedId, undo, redo, moveElement, removeElement]);

    const selectedEl = elements.find(e => e.id === selectedId);
    const currentTitle = 'Reporttitel';
    const currentSubtitle = subtitlesByReport['global'] || '';
    const portfolioName = selectedPortfolio?.name || 'Portfolio';
    const orientationLabel = currentOrientation === 'landscape' ? 'Querformat' : 'Hochformat';
    const canUndo = historyPos.idx > 0;
    const canRedo = historyPos.idx < historyPos.len - 1;

    // ─── Count helpers ─────────────────────────
    const freetextCount = elements.filter(e => e.type === EL_TYPES.FREETEXT).length;
    const lineCount = elements.filter(e => e.type === EL_TYPES.LINE).length;

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '100px' }}>
            <Loader2 className="animate-spin" size={32} />
        </div>
    );

    if (!portfolioId) return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
            <FileText size={48} style={{ color: 'var(--text-secondary)', marginBottom: '16px' }} />
            <h2 style={{ marginBottom: '8px' }}>Kein Portfolio ausgewählt</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Bitte wähle ein Portfolio aus, um die PDF-Vorlage zu bearbeiten.</p>
        </div>
    );

    if (loadError) return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
            <FileText size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
            <h2 style={{ marginBottom: '8px' }}>PDF-Vorlage konnte nicht geladen werden</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                {loadError}<br />
                Um eine bestehende Vorlage nicht versehentlich zu überschreiben, ist das Bearbeiten erst nach erfolgreichem Laden möglich.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(backPath)}>Zurück</Button>
                <Button icon={RotateCcw} onClick={retryLoad}>Erneut laden</Button>
            </div>
        </div>
    );

    // ─── Scale factor for preview ──────────────
    const scale = zoom * MM_TO_PX;

    // ─── Render element on canvas ──────────────
    const renderElement = (el) => {
        if (!el.visible) return null;
        const isSelected = el.id === selectedId;
        const inActiveZone = el.zone === activeZone;
        const left = el.x * scale;
        const top = el.y * scale;
        const width = el.w * scale;
        const height = (el.h || 0.5) * scale;

        const boxStyle = {
            position: 'absolute', left, top, width, height,
            cursor: inActiveZone ? 'move' : 'default',
            outline: isSelected ? `2px solid ${accentColor}` : (inActiveZone ? '1px dashed rgba(0,0,0,0.15)' : 'none'),
            borderRadius: '1px',
            opacity: inActiveZone ? 1 : 0.4,
            userSelect: 'none', touchAction: 'none',
            zIndex: isSelected ? 100 + (el.zIndex || 1) : (el.zIndex || 1),
            boxSizing: 'border-box',
            overflow: 'hidden',
        };

        // Gleiche Schrift und Zeilenhöhe wie im Druck (lib/pdfGenerator.js)
        const textStyle = {
            fontFamily: PDF_FONT_STACK,
            fontSize: `${(el.fontSize || 10) * zoom}pt`,
            fontWeight: el.fontWeight || 'normal',
            color: el.color || '#333',
            textAlign: el.align || 'left',
            lineHeight: 1.2,
            width: '100%',
        };

        let content;
        switch (el.type) {
            case EL_TYPES.LOGO:
                content = logoUrl
                    ? <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
                    : <div style={{ width: '100%', height: '100%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', fontSize: `${9 * zoom}pt`, color: '#aaa' }}>Logo</div>;
                break;
            case EL_TYPES.TITLE:
                content = <div style={textStyle}>{currentTitle}</div>;
                break;
            case EL_TYPES.SUBTITLE:
                content = <div style={textStyle}>{currentSubtitle || 'Subtitel…'}</div>;
                break;
            case EL_TYPES.PORTFOLIO_NAME:
                content = <div style={textStyle}>{portfolioName}</div>;
                break;
            case EL_TYPES.DATE:
                content = <div style={textStyle}>Stichtag: {todayStr}</div>;
                break;
            case EL_TYPES.PAGE_NUMBER:
                content = <div style={textStyle}>Seite 1 von 1</div>;
                break;
            case EL_TYPES.LINE:
                content = <div style={{ width: '100%', borderTop: `1px solid ${el.color || '#ccc'}` }} />;
                break;
            case EL_TYPES.FREETEXT:
                content = <div style={textStyle}>{el.text || 'Freitext'}</div>;
                break;
            default: content = null;
        }

        return (
            <div
                key={el.id}
                style={boxStyle}
                onPointerDown={inActiveZone ? (e) => handlePointerDown(e, el.id) : undefined}
                onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); setRightTab('properties'); }}
            >
                {content}
            </div>
        );
    };

    // ─── TOOLBAR ─────────────────────────────────
    const toolbarStyle = {
        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
        padding: '10px 16px', background: 'var(--glass-bg)', backdropFilter: 'blur(12px)',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)',
        boxShadow: 'var(--shadow-sm)', marginBottom: '16px',
    };

    const selectStyle = {
        padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
        background: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.8rem',
        cursor: 'pointer',
    };

    const toggleBtnStyle = (active) => ({
        padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)',
        background: active ? accentColor : 'var(--surface-color)',
        color: active ? '#fff' : 'var(--text-primary)',
        fontSize: '0.78rem', fontWeight: active ? 600 : 400, cursor: 'pointer',
        transition: 'all 0.15s',
    });

    const iconBtnStyle = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '32px', height: '32px', borderRadius: '6px',
        border: '1px solid var(--border-color)', background: 'var(--surface-color)',
        cursor: 'pointer', color: 'var(--text-primary)',
    };

    // ─── PROPERTIES PANEL ──────────────────────
    const renderPropertiesPanel = () => {
        if (!selectedEl) return (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Klicke auf ein Element, um es zu bearbeiten.
            </div>
        );

        const inputRow = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' };
        const labelSt = { fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '55px' };
        const inputSt = {
            flex: 1, padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border-color)',
            background: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.82rem',
            width: '60px',
        };
        // Grenzen für Breite/Höhe an einer Stelle (constants.getSizeLimits)
        const limits = getSizeLimits(selectedEl, { orientation: currentOrientation, margin });

        return (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {labelForType(selectedEl.type)}
                    <button onClick={() => removeElement(selectedEl.id)}
                        style={{ ...iconBtnStyle, width: '24px', height: '24px', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}
                        title="Element löschen"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>

                {/* Position */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '4px', marginBottom: '4px' }}>Position</div>
                <div style={inputRow}>
                    <span style={labelSt}>X (mm)</span>
                    <input type="number" step={1} value={selectedEl.x}
                        onChange={e => { const v = parseInputNumber(e.target.value); if (v !== null) updateElement(selectedEl.id, { x: v }); }}
                        style={inputSt} />
                    <span style={labelSt}>Y (mm)</span>
                    <input type="number" step={1} value={selectedEl.y}
                        onChange={e => { const v = parseInputNumber(e.target.value); if (v !== null) updateElement(selectedEl.id, { y: v }); }}
                        style={inputSt} />
                </div>

                {/* Size */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '4px', marginBottom: '4px' }}>Größe</div>
                <div style={inputRow}>
                    <span style={labelSt}>B (mm)</span>
                    <input type="number" step={1}
                        value={selectedEl.w}
                        min={limits.minW}
                        max={limits.maxW}
                        onChange={e => { const v = parseInputNumber(e.target.value); if (v !== null) updateElement(selectedEl.id, { w: clamp(v, limits.minW, limits.maxW) }); }}
                        style={inputSt}
                    />
                    {selectedEl.type !== EL_TYPES.LINE && (
                        <>
                            <span style={labelSt}>H (mm)</span>
                            <input type="number" step={1} value={Math.round((selectedEl.h || 5) * 10) / 10}
                                min={limits.minH}
                                max={limits.maxH}
                                disabled={selectedEl.type === EL_TYPES.LOGO}
                                onChange={e => { const v = parseInputNumber(e.target.value); if (v !== null) updateElement(selectedEl.id, { h: clamp(v, limits.minH, limits.maxH) }); }}
                                style={{ ...inputSt, opacity: selectedEl.type === EL_TYPES.LOGO ? 0.5 : 1 }}
                            />
                        </>
                    )}
                </div>

                {/* Ebene (Layer) */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Ebene (Layer)</div>
                <div style={inputRow}>
                    <span style={labelSt}>Ebene</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, marginRight: '12px', minWidth: '20px', display: 'inline-block', textAlign: 'center' }}>
                        {selectedEl.zIndex || 1}
                    </span>
                    <button
                        type="button"
                        onClick={() => updateElement(selectedEl.id, { zIndex: Math.max(1, (selectedEl.zIndex || 1) - 1) })}
                        style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: '0.72rem',
                            fontWeight: 500,
                            marginRight: '4px'
                        }}
                        title="Ebene runter"
                    >
                        Ebene runter
                    </button>
                    <button
                        type="button"
                        onClick={() => updateElement(selectedEl.id, { zIndex: Math.min(999, (selectedEl.zIndex || 1) + 1) })}
                        style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: '0.72rem',
                            fontWeight: 500
                        }}
                        title="Ebene darüber"
                    >
                        Ebene darüber
                    </button>
                </div>

                {/* Typography (not for logo/line) */}
                {![EL_TYPES.LOGO, EL_TYPES.LINE].includes(selectedEl.type) && (
                    <>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Typografie</div>
                        <div style={inputRow}>
                            <span style={labelSt}>Größe</span>
                            <input type="number" step={1} min={6} max={28} value={selectedEl.fontSize || 10}
                                onChange={e => { const v = parseInputNumber(e.target.value); if (v !== null) updateElement(selectedEl.id, { fontSize: clamp(v, 6, 28) }); }}
                                style={{ ...inputSt, width: '50px' }} />
                            <span style={labelSt}>pt</span>
                        </div>
                        <div style={inputRow}>
                            <span style={labelSt}>Stil</span>
                            <button onClick={() => updateElement(selectedEl.id, { fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                                style={{ ...iconBtnStyle, fontWeight: 'bold', background: selectedEl.fontWeight === 'bold' ? accentColor : 'var(--surface-color)', color: selectedEl.fontWeight === 'bold' ? '#fff' : 'var(--text-primary)' }}>
                                B
                            </button>
                            <button onClick={() => updateElement(selectedEl.id, { align: 'left' })} style={{ ...iconBtnStyle, background: selectedEl.align === 'left' ? 'var(--background-color)' : 'transparent' }}><AlignLeft size={14} /></button>
                            <button onClick={() => updateElement(selectedEl.id, { align: 'center' })} style={{ ...iconBtnStyle, background: selectedEl.align === 'center' ? 'var(--background-color)' : 'transparent' }}><AlignCenter size={14} /></button>
                            <button onClick={() => updateElement(selectedEl.id, { align: 'right' })} style={{ ...iconBtnStyle, background: selectedEl.align === 'right' ? 'var(--background-color)' : 'transparent' }}><AlignRight size={14} /></button>
                        </div>
                    </>
                )}

                {/* Color */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Farbe</div>
                <div style={inputRow}>
                    <span style={labelSt}>{selectedEl.type === EL_TYPES.LINE ? 'Linie' : 'Text'}</span>
                    <input type="color" value={normalizeHexColor(selectedEl.color) || '#333333'}
                        onChange={e => updateElement(selectedEl.id, { color: normalizeHexColor(e.target.value) || '#333333' })}
                        style={{ width: '36px', height: '28px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', padding: '2px' }}
                    />
                </div>

                {/* Freetext content */}
                {selectedEl.type === EL_TYPES.FREETEXT && (
                    <>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Inhalt</div>
                        <textarea
                            value={selectedEl.text || ''}
                            onChange={e => updateElement(selectedEl.id, { text: e.target.value })}
                            rows={3}
                            style={{ ...inputSt, width: '100%', resize: 'vertical', fontFamily: PDF_FONT_STACK, fontSize: '0.82rem' }}
                        />
                    </>
                )}

                {/* Subtitle content (global) */}
                {selectedEl.type === EL_TYPES.SUBTITLE && (
                    <>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>
                            Subtitel-Text
                        </div>
                        <input
                            value={subtitlesByReport['global'] || ''}
                            onChange={e => { const v = e.target.value; setSubtitlesByReport(prev => ({ ...prev, global: v })); markDirty(); }}
                            placeholder="Subtitel eingeben…"
                            style={{ ...inputSt, width: '100%' }}
                        />
                    </>
                )}

                {/* Nudge Controls */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Verschieben</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    {[
                        { label: '← 1mm', dx: -1, dy: 0 },
                        { label: '→ 1mm', dx: 1, dy: 0 },
                        { label: '↑ 1mm', dx: 0, dy: -1 },
                        { label: '↓ 1mm', dx: 0, dy: 1 },
                        { label: '← 5mm', dx: -5, dy: 0 },
                        { label: '→ 5mm', dx: 5, dy: 0 },
                        { label: '↑ 5mm', dx: 0, dy: -5 },
                        { label: '↓ 5mm', dx: 0, dy: 5 },
                    ].map(n => (
                        <button key={n.label} onClick={() => moveElement(selectedEl.id, n.dx, n.dy)}
                            style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                            {n.label}
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    // ─── ELEMENTS PANEL ────────────────────────
    const renderElementsPanel = () => {
        const checkRow = (el, label) => (
            <div key={el?.id || label} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                <input type="checkbox" checked={el?.visible ?? false}
                    onChange={e => { if (el) updateElement(el.id, { visible: e.target.checked }); }}
                />
                <span style={{ flex: 1, fontSize: '0.82rem' }}>{label}</span>
                {el && (
                    <button onClick={() => { setSelectedId(el.id); setRightTab('properties'); }}
                        style={{ ...iconBtnStyle, width: '24px', height: '24px' }}>
                        <Move size={11} />
                    </button>
                )}
            </div>
        );

        const renderStandardRow = (type, label) => {
            const el = elements.find(e => e.type === type);
            if (el) {
                return checkRow(el, label);
            }
            return (
                <div key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{label}</span>
                    <button
                        onClick={() => addElement(type)}
                        style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: '1px dashed var(--border-color)',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: '0.72rem',
                            color: accentColor,
                            fontWeight: 600
                        }}
                    >
                        + Hinzufügen
                    </button>
                </div>
            );
        };

        const lineEls = elements.filter(e => e.type === EL_TYPES.LINE);
        const freetextEls = elements.filter(e => e.type === EL_TYPES.FREETEXT);

        return (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Standard-Elemente</div>
                {renderStandardRow(EL_TYPES.LOGO, 'Logo')}
                {renderStandardRow(EL_TYPES.TITLE, 'Reporttitel (auto)')}
                {renderStandardRow(EL_TYPES.SUBTITLE, 'Subtitel')}
                {renderStandardRow(EL_TYPES.PORTFOLIO_NAME, 'Portfolio-Name')}
                {renderStandardRow(EL_TYPES.DATE, 'Datum')}
                {renderStandardRow(EL_TYPES.PAGE_NUMBER, 'Seitenzahl')}

                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Linien ({lineCount}/{MAX_LINES})</div>
                {lineEls.map((l, i) => checkRow(l, `Linie ${i + 1}`))}
                {lineCount < MAX_LINES && (
                    <button onClick={() => addElement(EL_TYPES.LINE)}
                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: accentColor, fontWeight: 500, marginTop: '4px' }}>
                        + Linie hinzufügen
                    </button>
                )}

                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Freitext ({freetextCount}/{MAX_FREETEXT})</div>
                {freetextEls.map((f, i) => checkRow(f, f.text?.slice(0, 20) || `Freitext ${i + 1}`))}
                {freetextCount < MAX_FREETEXT && (
                    <button onClick={() => addElement(EL_TYPES.FREETEXT)}
                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: accentColor, fontWeight: 500, marginTop: '4px' }}>
                        + Freitext hinzufügen
                    </button>
                )}

                {/* Logo Upload */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '16px', marginBottom: '6px' }}>Logo hochladen</div>
                <label style={{ padding: '8px 12px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-primary)', textAlign: 'center', display: 'block' }}>
                    {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <><Image size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />PNG / JPG (max. 2 MB)</>}
                    <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleLogoUpload(f); }} />
                </label>
                {logoUrl && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>✓ Logo hochgeladen</div>}

                {/* Accent Color */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '16px', marginBottom: '6px' }}>Akzentfarbe</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={accentColor}
                        onChange={e => { setAccentColor(normalizeHexColor(e.target.value) || DEFAULT_ACCENT); markDirty(); }}
                        style={{ width: '36px', height: '28px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', padding: '2px' }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{accentColor}</span>
                </div>

                {/* Reset */}
                <button onClick={resetToStandard}
                    style={{ marginTop: '20px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                    <RotateCcw size={13} /> Auf Standard zurücksetzen
                </button>
            </div>
        );
    };

    // ─── RENDER ──────────────────────────────────
    return (
        <div>
            {/* Back */}
            <button onClick={handleBack}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px', padding: 0 }}>
                <ArrowLeft size={16} /> Zurück
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <FileText size={isMobile ? 22 : 28} color={accentColor} />
                <h1 style={{ fontSize: isMobile ? '1.3rem' : '1.6rem', fontWeight: 700 }}>
                    PDF-Vorlage – {portfolioName}
                </h1>
                <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(14,165,233,0.08)', color: '#0ea5e9', fontWeight: 500 }}>{orientationLabel}</span>
                {dirty && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', color: '#dc2626', fontWeight: 500 }}>Ungespeichert</span>}
                {!dirty && saveNotice && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(34,197,94,0.12)', color: '#15803d', fontWeight: 500 }}>✓ {saveNotice}</span>}
                {collisionWarning && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(245,158,11,0.12)', color: '#d97706', fontWeight: 500 }}>⚠ Layout kollidiert – bitte Elemente anpassen</span>}
            </div>

            {/* TOOLBAR */}
            <div style={toolbarStyle}>

                <div style={{ display: 'flex', gap: '2px' }}>
                    <button style={toggleBtnStyle(currentOrientation === 'portrait')} onClick={() => switchOrientation('portrait')} title="Hochformat">⬜ Hoch</button>
                    <button style={toggleBtnStyle(currentOrientation === 'landscape')} onClick={() => switchOrientation('landscape')} title="Querformat">⬕ Quer</button>
                </div>

                <select value={margin} onChange={e => changeMargin(e.target.value)} style={selectStyle}>
                    {MARGIN_OPTIONS.map(m => <option key={m} value={m}>Rand {m}mm</option>)}
                </select>

                <div style={{ display: 'flex', gap: '2px' }}>
                    <button style={toggleBtnStyle(activeZone === 'header')} onClick={() => setActiveZone('header')}>Header</button>
                    <button style={toggleBtnStyle(activeZone === 'footer')} onClick={() => setActiveZone('footer')}>Footer</button>
                </div>

                <div style={{ flex: 1 }} />

                <button style={{ ...iconBtnStyle, opacity: canUndo ? 1 : 0.3 }} onClick={undo} disabled={!canUndo} title="Rückgängig (Strg+Z)"><Undo2 size={15} /></button>
                <button style={{ ...iconBtnStyle, opacity: canRedo ? 1 : 0.3 }} onClick={redo} disabled={!canRedo} title="Wiederholen (Strg+Umschalt+Z)"><Redo2 size={15} /></button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <button style={iconBtnStyle} onClick={() => setZoom(z => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)] || z)} title="Verkleinern"><ZoomOut size={14} /></button>
                    <span style={{ fontSize: '0.72rem', minWidth: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>{Math.round(zoom * 100)}%</span>
                    <button style={iconBtnStyle} onClick={() => setZoom(z => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)] || z)} title="Vergrößern"><ZoomIn size={14} /></button>
                </div>

                <Button icon={saving ? Loader2 : Save} onClick={handleSave} disabled={saving} style={{ fontSize: '0.8rem' }}>
                    {saving ? 'Speichert…' : 'Speichern'}
                </Button>
                <Button variant="secondary" icon={FileText} onClick={handleTestPdf} style={{ fontSize: '0.8rem' }}>
                    Test-PDF
                </Button>
            </div>

            {/* MAIN LAYOUT */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: '16px' }}>

                {/* A4 PREVIEW */}
                <div style={{ overflow: 'auto', padding: '20px', background: 'var(--background-color)', borderRadius: 'var(--radius-lg)', minHeight: isMobile ? '400px' : '600px', display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-start' : 'center' }}>
                    <div
                        ref={previewRef}
                        style={{
                            width: pageW * scale, height: pageH * scale,
                            background: '#fff', position: 'relative',
                            boxShadow: '0 4px 30px rgba(0,0,0,0.12)', borderRadius: '2px',
                            flexShrink: 0,
                        }}
                        onClick={() => setSelectedId(null)}
                    >
                        {/* Margin guides */}
                        <div style={{
                            position: 'absolute',
                            left: margin * scale, top: 0,
                            right: margin * scale, bottom: 0,
                            border: '1px dashed rgba(0,0,0,0.08)',
                            pointerEvents: 'none',
                        }} />

                        {/* Header zone */}
                        <div style={{
                            position: 'absolute', left: 0, top: 0, right: 0, height: HEADER_H * scale,
                            background: activeZone === 'header' ? 'rgba(245,158,11,0.04)' : 'transparent',
                            borderBottom: `1px ${activeZone === 'header' ? 'solid' : 'dashed'} ${activeZone === 'header' ? accentColor + '40' : 'rgba(0,0,0,0.06)'}`,
                            pointerEvents: 'none',
                        }} />

                        {/* Content zone (locked) */}
                        <div style={{
                            position: 'absolute', left: margin * scale, right: margin * scale,
                            top: HEADER_H * scale, bottom: FOOTER_H * scale,
                            background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.015) 10px, rgba(0,0,0,0.015) 20px)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            gap: '8px', pointerEvents: 'none',
                        }}>
                            <Lock size={20 * zoom} color="#ccc" />
                            <span style={{ fontSize: `${9 * zoom}pt`, color: '#bbb', fontFamily: PDF_FONT_STACK }}>Inhalt wird automatisch gefüllt</span>
                        </div>

                        {/* Footer zone */}
                        <div style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, height: FOOTER_H * scale,
                            background: activeZone === 'footer' ? 'rgba(245,158,11,0.04)' : 'transparent',
                            borderTop: `1px ${activeZone === 'footer' ? 'solid' : 'dashed'} ${activeZone === 'footer' ? accentColor + '40' : 'rgba(0,0,0,0.06)'}`,
                            pointerEvents: 'none',
                        }} />

                        {/* Render elements sorted by zIndex */}
                        {[...elements].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1)).map(renderElement)}
                    </div>
                </div>

                {/* RIGHT PANEL */}
                <Card style={{ padding: 0, height: 'fit-content', overflow: 'hidden', position: isMobile ? 'static' : 'sticky', top: '16px' }}>
                    {/* Panel tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                        {[
                            { id: 'elements', label: 'Elemente' },
                            { id: 'properties', label: 'Eigenschaften' },
                        ].map(t => (
                            <button key={t.id} onClick={() => setRightTab(t.id)}
                                style={{
                                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
                                    background: rightTab === t.id ? 'var(--background-color)' : 'transparent',
                                    borderBottom: rightTab === t.id ? `2px solid ${accentColor}` : '2px solid transparent',
                                    fontWeight: rightTab === t.id ? 600 : 400, fontSize: '0.82rem',
                                    color: rightTab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                                }}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ maxHeight: isMobile ? '400px' : 'calc(100vh - 260px)', overflowY: 'auto' }}>
                        {rightTab === 'elements' ? renderElementsPanel() : renderPropertiesPanel()}
                    </div>
                </Card>
            </div>
        </div>
    );
}

export default PdfTemplateEditor;
