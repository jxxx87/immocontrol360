import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Save, Undo2, Redo2, Download, MousePointer2, PenTool,
    DoorOpen, Square, Sofa, Trash2, Loader2, ChevronDown, Plus,
    RotateCcw, FlipHorizontal2, Copy, Box, Image, FileText, Ruler,
    List, FileSpreadsheet, BoxSelect, SeparatorHorizontal, AppWindow, Armchair, Search,
    Upload, Eye, EyeOff, X, Scaling, Layers, Maximize, Minimize, Home,
    Spline, CircleDot, Pentagon, Type, AlertTriangle, RefreshCw, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import {
    TOOLS, TOOL_HINTS, WALL_THICKNESS, STOREY_HEIGHT,
    mmToM, mm2ToM2, STOREY_LABELS, ROOF_TYPES,
    DOOR_PRESETS, WINDOW_PRESETS, OPENING_MIN_EDGE_DIST,
} from '../../lib/floorplan/constants';
import {
    createStorey, duplicateStorey, addPoint, getPoint,
    addOuterWallSegment, closeOuterWalls, addInnerWallSegment,
    computeRooms, placeOpening, deleteWall, deleteOpening, deleteFurniture,
    placeFurniture, flipWallSide, findWallAtPoint,
    findFurnitureAtPoint, findOpeningAtPoint, findRoomAtPoint,
    snapToGrid, snapAngle, findSnapPoint, dist, getPointSide, genId, pointToSegmentDist,
    getWallPolygon,
    splitWallAtPoint,
} from '../../lib/floorplan/geometryKernel';
import {
    createViewport, render, screenToWorld, worldToScreen, zoomAtPoint, zoomToFit,
} from '../../lib/floorplan/canvasRenderer';
import { createCommandStack } from '../../lib/floorplan/commandStack';
import { constrainPointToHostWall, projectPointOntoHostWall } from '../../lib/floorplan/hostWallConstraint';
import {
    MAX_BG_UPLOAD_BYTES, isStoredBackground, isInlineBackground, extForMime, parseDataUrl,
    dataUrlByteLength, dataUrlToBlob, buildBackgroundPath, collectBackgroundPaths, toStoredBackground,
    uploadBackgroundBlob, downloadBackgroundBlob, removeBackgroundObjects,
} from '../../lib/floorplan/planBackgrounds';
import { stripBackgrounds, createVersionEntry, addVersionEntry } from '../../lib/floorplan/planVersions';
import { FURNITURE_CATEGORIES, FURNITURE_ITEMS, getItemsByCategory, getFurnitureItem, clampDimensions } from '../../lib/floorplan/furnitureCatalog';
import { exportToPNG, exportToPDF, exportQuantityListCSV, exportQuantityListPDF, generateQuantityList, downloadBlob } from '../../lib/floorplan/floorplanExport';

// Lazy load 3D viewer to avoid loading Three.js unless needed
const FloorPlan3DView = lazy(() => import('./FloorPlan3DView'));

// ─── Helpers ────────────────────────────────────────────────────

// Fokus in einem Eingabefeld? Dann dürfen Editor-Tastenkürzel (Entf, Strg+C/V/Z, Leertaste) nicht greifen.
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];
const isEditableTarget = (el) => {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.includes(String(el.type || 'text').toLowerCase());
    return false;
};

// Laufzeitfelder des Renderers gehören weder in Undo-Snapshots noch in den Vergleich "geändert?"
const TRANSIENT_KEYS = new Set(['_hitBox', '_labelHitBox']);
const snapshotReplacer = (key, value) => (TRANSIENT_KEYS.has(key) ? undefined : value);

// Undo-Snapshot eines Geschosses als JSON-String. Das (große) Hintergrundbild ist bewusst
// nicht Teil der Bearbeitungshistorie und bleibt beim Rückgängig machen unverändert.
const snapshotStorey = (storey) => {
    if (!storey) return null;
    const { bgImage: _bgImage, ...rest } = storey;
    return JSON.stringify(rest, snapshotReplacer);
};

// Sucht nicht-endliche Zahlen (NaN/Infinity) in den vom Nutzer bearbeitbaren Maßen.
// Solche Stände werden nicht gespeichert (JSON würde sie still zu null machen).
// Berechnete Felder (Räume, Außenkontur) werden bewusst nicht geprüft.
const isBadNumber = (v) => typeof v === 'number' && !Number.isFinite(v);
const hasBadField = (obj, fields) => !!obj && fields.some(f => isBadNumber(obj[f]));
const INVALID_FIELDS = {
    storey: ['height_mm', 'ref_height_mm'],
    point: ['x', 'y'],
    wall: ['thickness_mm', 'height_mm', 'ref_height_mm'],
    opening: ['position_mm', 'width_mm', 'height_mm', 'sill_mm'],
    furniture: ['x', 'y', 'width_mm', 'depth_mm', 'height_mm', 'rotation'],
    slab: ['thickness_mm', 'ref_height_mm'],
    roof: ['kneeWall_mm', 'pitch_deg', 'overhang_mm', 'parapet_mm'],
    annotation: ['x', 'y', 'cx', 'cy', 'radius'],
};
const findInvalidGeometry = (storeys) => {
    for (const s of storeys || []) {
        const where = `Geschoss „${s?.label || '?'}“`;
        if (hasBadField(s, INVALID_FIELDS.storey) || hasBadField(s?.roof, INVALID_FIELDS.roof)) return where;
        if ((s.points || []).some(p => hasBadField(p, INVALID_FIELDS.point))) return `${where} (Wandpunkt)`;
        if ((s.walls || []).some(w => hasBadField(w, INVALID_FIELDS.wall))) return `${where} (Wand)`;
        if ((s.openings || []).some(o => hasBadField(o, INVALID_FIELDS.opening))) return `${where} (Tür/Fenster)`;
        if ((s.furniture || []).some(f => hasBadField(f, INVALID_FIELDS.furniture))) return `${where} (Möbel)`;
        if ((s.slabs || []).some(sl => hasBadField(sl, INVALID_FIELDS.slab)
            || (sl.polygon || []).some(p => hasBadField(p, INVALID_FIELDS.point)))) return `${where} (Decke)`;
        if ((s.annotations || []).some(a => hasBadField(a, INVALID_FIELDS.annotation)
            || (a.points || []).some(p => hasBadField(p, INVALID_FIELDS.point)))) return `${where} (Anmerkung)`;
    }
    return null;
};

// Geladene Plandaten absichern (ältere/teilweise gespeicherte Pläne ohne alle Arrays)
const STOREY_ARRAY_KEYS = ['points', 'walls', 'openings', 'furniture', 'rooms', 'slabs', 'annotations'];
const normalizeStorey = (raw, idx) => {
    const storey = raw && typeof raw === 'object' ? raw : {};
    for (const key of STOREY_ARRAY_KEYS) {
        if (!Array.isArray(storey[key])) storey[key] = [];
    }
    if (!storey.id) storey.id = genId();
    if (!storey.label) storey.label = `Geschoss ${idx + 1}`;
    if (!Number.isFinite(storey.height_mm) || storey.height_mm <= 0) storey.height_mm = STOREY_HEIGHT.default;
    if (storey.roof === undefined) storey.roof = null;
    return storey;
};

// Außenwand-Polygon (Innen- und Außenkante) nach Geometrieänderungen neu berechnen.
// Nur für bereits geschlossene Außenwände; closeOuterWalls des Geometriekerns rechnet die
// Außenkontur mit der Dicke JE Wand (statt pauschal mit der Dicke der ersten Außenwand).
const refreshOuterPolygon = (storey) => {
    if (!storey.outerClosed) return;
    closeOuterWalls(storey);
};

// Achsparallele Hülle eines Möbelstücks für die Rahmenauswahl. Ursprung (x, y) ist die obere
// linke Ecke, gedreht wird um diesen Punkt (wie Zeichnung und findFurnitureAtPoint).
const furnitureBounds = (f) => {
    const w = Number(f?.width_mm) || 500;
    const d = Number(f?.depth_mm) || 500;
    const rad = ((Number(f?.rotation) || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const x = Number(f?.x) || 0, y = Number(f?.y) || 0;
    const xs = [0, w * cos, w * cos - d * sin, -d * sin].map(v => x + v);
    const ys = [0, w * sin, w * sin + d * cos, d * cos].map(v => y + v);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

// Wandlänge setzen: Endpunkt p2 entlang der (gemerkten oder aktuellen) Wandrichtung verschieben
const applyWallLength = (storey, wall, newLenMm, dir) => {
    if (!wall || !Number.isFinite(newLenMm) || newLenMm <= 0) return false;
    const p1 = getPoint(storey, wall.p1);
    const p2 = getPoint(storey, wall.p2);
    if (!p1 || !p2) return false;
    let ux, uy;
    if (dir && Number.isFinite(dir.x) && Number.isFinite(dir.y) && (dir.x !== 0 || dir.y !== 0)) {
        ux = dir.x; uy = dir.y;
    } else {
        const cur = dist(p1, p2);
        if (!(cur >= 1)) return false;
        ux = (p2.x - p1.x) / cur;
        uy = (p2.y - p1.y) / cur;
    }
    const nx = snapToGrid(p1.x + ux * newLenMm);
    const ny = snapToGrid(p1.y + uy * newLenMm);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
    p2.x = nx;
    p2.y = ny;
    refreshOuterPolygon(storey);
    computeRooms(storey);
    return true;
};

// Öffnungsbreite setzen und die Öffnung vollständig innerhalb der Wand halten
const applyOpeningWidth = (storey, opening, widthMm) => {
    if (!opening || !Number.isFinite(widthMm) || widthMm <= 0) return false;
    const wallId = opening.wall_id ?? opening.wallId;
    const wall = storey.walls.find(w => w.id === wallId);
    const p1 = wall ? getPoint(storey, wall.p1) : null;
    const p2 = wall ? getPoint(storey, wall.p2) : null;
    if (!p1 || !p2) { opening.width_mm = Math.round(widthMm); return true; }
    const wallLen = dist(p1, p2);
    const width = Math.min(Math.round(widthMm), Math.floor(wallLen - 2 * OPENING_MIN_EDGE_DIST));
    if (!(width > 0)) return false;
    opening.width_mm = width;
    const minPos = width / 2 + OPENING_MIN_EDGE_DIST;
    const maxPos = wallLen - width / 2 - OPENING_MIN_EDGE_DIST;
    if (Number.isFinite(opening.position_mm)) {
        opening.position_mm = Math.max(minPos, Math.min(maxPos, opening.position_mm));
    } else {
        opening.position_mm = wallLen / 2;
    }
    return true;
};

// Zahleneingabe: Komma als Dezimaltrenner zulassen, leer/ungültig = NaN
const parseNumberInput = (raw) => {
    if (raw === null || raw === undefined) return NaN;
    const s = String(raw).trim().replace(',', '.');
    if (s === '') return NaN;
    return Number(s);
};
const formatNumberInput = (v) => (Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : '');

const sanitizeFileName = (name) => {
    const cleaned = String(name || '')
        .split('').filter(ch => ch.charCodeAt(0) >= 32).join('')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    return cleaned || 'Grundriss';
};

const zoomToPercent = (zoom) => Math.round(zoom * 100 / 0.15);

// WebGL-Unterstützung prüfen, bevor die 3D-Ansicht gemountet wird
const isWebGLAvailable = () => {
    try {
        if (typeof window === 'undefined' || !window.WebGLRenderingContext) return false;
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch {
        return false;
    }
};

// Hintergrundbild: Grenzen, damit plan_data nicht durch riesige Base64-Bilder unbenutzbar wird
const MAX_BG_FILE_BYTES = 30 * 1024 * 1024;     // 30 MB Eingangsdatei
const MAX_BG_EDGE_PX = 4096;                     // max. Kantenlänge des gespeicherten Bildes
const MAX_BG_DATAURL_CHARS = 6 * 1024 * 1024;    // ab hier JPEG statt PNG

const encodeBgCanvas = (canvas) => {
    let url = canvas.toDataURL('image/png');
    if (url.length > MAX_BG_DATAURL_CHARS) url = canvas.toDataURL('image/jpeg', 0.85);
    return url;
};

// Bild auf MAX_BG_EDGE_PX herunterrechnen; liefert neue dataUrl und den Skalierungsfaktor
const downscaleBgImage = (img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const factor = Math.min(1, MAX_BG_EDGE_PX / Math.max(w, h, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * factor));
    canvas.height = Math.max(1, Math.round(h * factor));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: encodeBgCanvas(canvas), factor: canvas.width / w };
};

// ─── Hintergrundbild im Dateispeicher (Bucket floorplan-backgrounds) ───
const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => {
    try {
        canvas.toBlob(blob => resolve(blob), type, quality);
    } catch {
        resolve(null);
    }
});

const loadImageFromUrl = (url) => new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
    img.src = url;
});

const randomToken = () => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* kein sicherer Kontext */ }
    return genId();
};

// Bild für den Upload vorbereiten: PNG/JPEG, höchstens MAX_BG_EDGE_PX Kantenlänge und
// MAX_BG_UPLOAD_BYTES. Passt die data-URL schon, wird sie unverändert übernommen.
// factor = neue Breite / bisherige Breite (der Maßstab wird damit umgerechnet).
const prepareBgUpload = async (dataUrl, img) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const parsed = parseDataUrl(dataUrl);
    if (parsed && extForMime(parsed.mime) && Math.max(w, h) <= MAX_BG_EDGE_PX && dataUrlByteLength(dataUrl) <= MAX_BG_UPLOAD_BYTES) {
        const blob = dataUrlToBlob(dataUrl);
        if (blob && blob.size > 0) return { blob, factor: 1 };
    }
    const scale = Math.min(1, MAX_BG_EDGE_PX / Math.max(w, h, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = await canvasToBlob(canvas, 'image/png');
    if (!blob || blob.size > MAX_BG_DATAURL_CHARS) blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    if (blob && blob.size > MAX_BG_UPLOAD_BYTES) blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    if (!blob) throw new Error('Das Bild konnte nicht umgewandelt werden.');
    return { blob, factor: canvas.width / Math.max(1, w) };
};

const DRAG_LABELS = {
    furniture: 'Möbel verschieben',
    opening: 'Öffnung verschieben',
    corner: 'Wandecke verschieben',
    wall_perp: 'Wand verschieben',
    wall_body: 'Wand verschieben',
    multi: 'Auswahl verschieben',
    slab_corner: 'Deckenpunkt verschieben',
    room_label: 'Raumbeschriftung verschieben',
    annotation_drag: 'Anmerkung verschieben',
    annotation_point: 'Anmerkung bearbeiten',
    annotation_resize_circle: 'Anmerkung bearbeiten',
};
const GEOMETRY_DRAG_TYPES = ['corner', 'wall_perp', 'wall_body', 'multi'];

// Fängt Fehler der 3D-Ansicht ab (WebGL, Chunk-Download, Renderfehler), statt die ganze Seite abzureißen
class ViewErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error) {
        console.error('3D-Ansicht fehlgeschlagen:', error);
        if (this.props.onError) this.props.onError(error);
    }

    render() {
        if (this.state.error) return this.props.fallback ?? null;
        return this.props.children;
    }
}

// ─── Main Component ─────────────────────────────────────────────

const FloorPlanEditor = () => {
    const { id: planId } = useParams();
    const isNew = planId === 'new';
    const navigate = useNavigate();
    const { user } = useAuth();
    const userId = user?.id || null;
    const { isMobile } = useViewMode();

    // ─── State ──────────────────────────────────────────────────
    const [planName, setPlanName] = useState('Neuer Grundriss');
    const [storeys, setStoreys] = useState(() => [createStorey('EG', 2600)]);
    const [activeStoreyIdx, setActiveStoreyIdx] = useState(0);
    const [loading, setLoading] = useState(!isNew);
    const [loadError, setLoadError] = useState(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    // Speicherstatus: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
    const [saveState, setSaveState] = useState('idle');
    const [saveError, setSaveError] = useState(null);
    const saving = saveState === 'saving';
    const [viewNotice, setViewNotice] = useState(null);
    const [zoomPct, setZoomPct] = useState(() => zoomToPercent(0.15));

    // Tool state
    const [activeTool, setActiveTool] = useState(TOOLS.SELECT);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedType, setSelectedType] = useState(null); // 'wall' | 'opening' | 'furniture' | 'room' | 'point'
    const [selectedIds, setSelectedIds] = useState([]); // [{id, type}] for multi-selection
    const [selectedRoomId, setSelectedRoomId] = useState(null); // for room label dragging
    const [editingLength, setEditingLength] = useState(null); // { wallId, value } when editing wall length

    // View mode: '2d' or '3d'
    const [viewMode, setViewMode] = useState('2d');
    const [rightPanel, setRightPanel] = useState('properties'); // 'properties' | 'quantities'
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [slabContextMenu, setSlabContextMenu] = useState(null); // { x, y, worldX, worldY, slabId, edgeIdx }
    const [showDimensions, setShowDimensions] = useState(true); // normgerechte Bemaßung

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            const el = editorContainerRef.current || document.documentElement;
            el.requestFullscreen().catch(() => { });
        } else {
            document.exitFullscreen().catch(() => { });
        }
    }, []);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    // Measurement tool state
    const [measurePoints, setMeasurePoints] = useState([]);
    const [measureResult, setMeasureResult] = useState(null);

    // Drawing state
    const [drawPoints, setDrawPoints] = useState([]); // point IDs for current polygon
    const [innerWallType, setInnerWallType] = useState('inner_nonload');
    const [innerWallThickness, setInnerWallThickness] = useState(WALL_THICKNESS.innerNonloadDefault);
    const [outerWallThickness, setOuterWallThickness] = useState(WALL_THICKNESS.outerDefault);

    // Annotation drawing state
    const [annotationColor, setAnnotationColor] = useState('#ef4444'); // default red
    const [annotationLineWidth, setAnnotationLineWidth] = useState(2);
    const [annotationPoints, setAnnotationPoints] = useState([]); // {x,y}[] for current polyline/area
    const [annotationCircleCenter, setAnnotationCircleCenter] = useState(null); // {x,y}
    const [activeAnnotationId, setActiveAnnotationId] = useState(null); // live-editing polyline/area id
    const clipboardRef = useRef(null); // { type, data } for copy/paste

    // Furniture placing
    const [placingFurniture, setPlacingFurniture] = useState(null);
    const [furnitureCategory, setFurnitureCategory] = useState('wohnen');

    // Next opening preset (editable in right panel when door/window tool is active)
    const [nextOpeningPreset, setNextOpeningPreset] = useState({
        door: { width: 860, height: 2010, sill: 0 },
        window: { width: 1200, height: 1200, sill: 700 },
    });

    // Background image
    const [bgImage, setBgImage] = useState(null); // { dataUrl, scale, offsetX, offsetY, opacity, visible }
    const [bgImageObj, setBgImageObj] = useState(null); // HTMLImageElement
    const [calibPoints, setCalibPoints] = useState([]); // [{x,y}, {x,y}] world coords
    const [showCalibDialog, setShowCalibDialog] = useState(false);
    const [calibDistMm, setCalibDistMm] = useState('');
    const bgFileRef = useRef(null);
    const editorContainerRef = useRef(null);

    // Viewport & canvas
    const canvasRef = useRef(null);
    const vpRef = useRef(createViewport());
    const cmdStackRef = useRef(createCommandStack());
    const [, forceRender] = useState(0);
    const animFrameRef = useRef(null);

    // Preview state for rendering
    const previewRef = useRef(null);
    const snapPointRef = useRef(null);
    const mouseWorldRef = useRef({ x: 0, y: 0 });

    // Autosave / Speicherstand
    const autosaveTimerRef = useRef(null);
    const isDirtyRef = useRef(false);
    const revisionRef = useRef(0);            // wird bei jeder Änderung erhöht
    const saveInFlightRef = useRef(null);     // Promise des laufenden Speichervorgangs
    const pendingSaveRef = useRef(false);     // während eines Speicherns angefordert → danach nachholen
    const saveFailedRef = useRef(false);
    const saveRef = useRef(null);             // immer aktuelle handleSave-Funktion (für Timer/Listener)
    const loadedOkRef = useRef(isNew);        // Speichern erst nach erfolgreichem Laden erlaubt
    const savedIdRef = useRef(null);
    // Versionierung: beim ersten Speichern einer Sitzung den geladenen Stand ablegen
    const versionHistoryRef = useRef([]);     // version_history wie geladen/zuletzt gespeichert
    const pendingVersionRef = useRef(null);   // { json, stand, name } – noch abzulegender Ladestand
    // Hintergrundbilder im Dateispeicher
    const bgUrlCacheRef = useRef(new Map());  // Pfad → Objekt-URL (Blob)
    const bgUploadTokensRef = useRef(new Map()); // Geschoss-ID → laufende Änderung (verwirft veraltete Uploads)
    const pendingBgDeletesRef = useRef(new Set()); // ersetzte/entfernte Dateien, nach dem Speichern löschen
    const bgMigrationRunningRef = useRef(false);
    const bgMigrationFailedRef = useRef(false);
    const afterSaveRef = useRef(null);         // Nacharbeiten nach erfolgreichem Speichern
    const migrateBgRef = useRef(null);         // eingebettete Bilder in den Dateispeicher verschieben
    const [bgUploading, setBgUploading] = useState(false);

    // Interaktions-Refs (auch vom Autosave genutzt, um nicht mitten im Ziehen zu speichern)
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const dragStartRef = useRef(null);
    const spaceHeldRef = useRef(false);
    const dragHandleRef = useRef(null);     // which handle is being dragged: p1Id, p2Id, or 'mid'
    const dimensionLineRef = useRef(null);  // active dimension line during drag
    const selectedIdRef = useRef(null);     // always-current selectedId for closures
    selectedIdRef.current = selectedId;
    const hoverPointRef = useRef(null);     // world point near cursor for corner hover
    const marqueeRef = useRef(null);        // { sx1, sy1, sx2, sy2 } screen coords for selection rectangle
    const hoverIdRef = useRef(null);         // ID of element currently hovered
    const pendingDrawRef = useRef(null);    // { storeyId, before, last } – Zeichenschritte, die noch nicht in der Historie stehen
    const textEditRef = useRef(null);       // { storeyId, before, label } – laufende Texteingabe im Panel
    const lengthEditDoneRef = useRef(false);
    const planNameFocusRef = useRef(null);
    const canvasSizeRef = useRef({ w: 0, h: 0, dpr: 1 }); // CSS-Größe der Zeichenfläche
    const needsCenterRef = useRef(true);

    // ─── Active Storey ──────────────────────────────────────────
    const activeStorey = storeys[activeStoreyIdx] || storeys[0];

    // Immer aktuelle Werte für Callbacks, Timer und Fenster-Listener
    const storeysRef = useRef(storeys);
    storeysRef.current = storeys;
    const activeStoreyRef = useRef(activeStorey);
    activeStoreyRef.current = activeStorey;
    const planNameRef = useRef(planName);
    planNameRef.current = planName;
    const userRef = useRef(user);
    userRef.current = user;
    const drawPointsRef = useRef(drawPoints);
    drawPointsRef.current = drawPoints;

    // ─── Load ───────────────────────────────────────────────────
    useEffect(() => {
        if (isNew) { loadedOkRef.current = true; setLoading(false); return; }
        if (!userId) return; // warten, bis die Anmeldung feststeht
        let cancelled = false;
        loadedOkRef.current = false;
        savedIdRef.current = null;
        setLoading(true);
        setLoadError(null);
        (async () => {
            try {
                const { data, error } = await supabase.from('floor_plans').select('*').eq('id', planId).single();
                if (cancelled) return;
                if (error || !data) {
                    const notFound = !data && (!error || error.code === 'PGRST116');
                    setLoadError(notFound
                        ? 'Der Grundriss wurde nicht gefunden oder Sie haben keinen Zugriff darauf.'
                        : `Der Grundriss konnte nicht geladen werden${error?.message ? ` (${error.message})` : ''}.`);
                    setLoading(false);
                    return;
                }
                setPlanName(data.name || 'Grundriss');
                versionHistoryRef.current = Array.isArray(data.version_history) ? data.version_history : [];
                // Geladener Stand (ohne Hintergrundbilder) als JSON – wird beim ersten Speichern
                // dieser Sitzung als Version abgelegt (der Editor ändert die Objekte danach in-place)
                pendingVersionRef.current = Array.isArray(data.plan_data) && data.plan_data.length > 0
                    ? { json: JSON.stringify(stripBackgrounds(data.plan_data)), stand: data.updated_at || null, name: data.name || null }
                    : null;
                if (Array.isArray(data.plan_data) && data.plan_data.length > 0) {
                    const loaded = data.plan_data.map((s, i) => normalizeStorey(s, i));
                    storeysRef.current = loaded;
                    setStoreys(loaded);
                    setActiveStoreyIdx(0);
                }
                savedIdRef.current = data.id;
                loadedOkRef.current = true;
                isDirtyRef.current = false;
                cmdStackRef.current.clear();
                setSaveState('idle');
                setLoading(false);
                // Eingebettete Hintergrundbilder (Altbestand) einmalig in den Dateispeicher verschieben
                setTimeout(() => { if (!cancelled) migrateBgRef.current?.(); }, 0);
            } catch (err) {
                if (cancelled) return;
                setLoadError(`Der Grundriss konnte nicht geladen werden (${err?.message || err}).`);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [planId, userId, isNew, loadAttempt]);

    // ─── Save ───────────────────────────────────────────────────
    // Liest alle Daten über Refs, damit Autosave-Timer nie mit veralteten Closures arbeiten.
    const handleSave = useCallback((silent = false) => {
        const currentUser = userRef.current;
        if (!currentUser || !loadedOkRef.current) return Promise.resolve(false);
        if (saveInFlightRef.current) {
            // Läuft bereits ein Speichervorgang: danach mit dem dann aktuellen Stand erneut speichern
            pendingSaveRef.current = true;
            return saveInFlightRef.current;
        }
        if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
        const revisionAtStart = revisionRef.current;

        const run = (async () => {
            setSaveState('saving');
            try {
                // Recompute rooms before saving
                const updated = storeysRef.current.map(s => {
                    computeRooms(s);
                    // Clean up temporary render data from annotations
                    if (s.annotations) {
                        for (const ann of s.annotations) { delete ann._hitBox; }
                    }
                    return { ...s };
                });

                const invalidAt = findInvalidGeometry(updated);
                if (invalidAt) {
                    throw new Error(`Der Plan enthält ungültige Maße – ${invalidAt}. Bitte korrigieren oder mit Strg+Z rückgängig machen; der zuletzt gespeicherte Stand bleibt erhalten.`);
                }

                const payload = {
                    name: (planNameRef.current || '').trim() || 'Grundriss',
                    plan_data: updated,
                    updated_at: new Date().toISOString(),
                };

                if (savedIdRef.current) {
                    // Erstes Speichern dieser Sitzung: den geladenen Stand als Version ablegen
                    // (höchstens 5, ohne Hintergrundbilder) – Wiederherstellen in der Grundriss-Übersicht.
                    // Unveränderte Stände (z. B. nur Bild-Umzug in den Dateispeicher) werden nicht abgelegt.
                    let nextHistory = null;
                    const pendingVersion = pendingVersionRef.current;
                    if (pendingVersion && JSON.stringify(stripBackgrounds(updated)) !== pendingVersion.json) {
                        nextHistory = addVersionEntry(
                            versionHistoryRef.current,
                            createVersionEntry(JSON.parse(pendingVersion.json), { stand: pendingVersion.stand, name: pendingVersion.name }),
                        );
                        payload.version_history = nextHistory;
                    }
                    // user_id bleibt beim Update unverändert (kein Besitzerwechsel bei geteiltem Zugriff)
                    const { data, error } = await supabase.from('floor_plans').update(payload).eq('id', savedIdRef.current).select('id');
                    if (error) throw error;
                    if (!data || data.length === 0) {
                        throw new Error('Der Grundriss wurde nicht gefunden oder Sie haben keine Berechtigung, ihn zu ändern.');
                    }
                    if (nextHistory) {
                        versionHistoryRef.current = nextHistory;
                        pendingVersionRef.current = null;
                    }
                } else {
                    const { data, error } = await supabase.from('floor_plans').insert({ ...payload, user_id: currentUser.id }).select('id').single();
                    if (error) throw error;
                    if (!data?.id) throw new Error('Der Grundriss konnte nicht angelegt werden.');
                    savedIdRef.current = data.id;
                    window.history.replaceState(window.history.state, '', `/renovation/floorplan/${data.id}`);
                }

                saveFailedRef.current = false;
                setSaveError(null);
                // Nacharbeiten: ersetzte Hintergrundbilder löschen, eingebettete Bilder verschieben
                try { afterSaveRef.current?.(updated); } catch { /* Nacharbeiten dürfen das Speichern nicht scheitern lassen */ }
                if (revisionRef.current === revisionAtStart) {
                    isDirtyRef.current = false;
                    setSaveState('saved');
                } else {
                    // Während des Speicherns geändert → sofort nachspeichern
                    pendingSaveRef.current = true;
                    setSaveState('dirty');
                }
                return true;
            } catch (err) {
                const msg = err?.message || String(err);
                console.error('Grundriss speichern fehlgeschlagen:', err);
                saveFailedRef.current = true;
                setSaveError(msg);
                setSaveState('error');
                if (!silent) alert('Fehler beim Speichern: ' + msg);
                return false;
            } finally {
                saveInFlightRef.current = null;
                if (pendingSaveRef.current) {
                    pendingSaveRef.current = false;
                    // Nach einem Fehler nicht in Endlosschleife erneut senden – die nächste Änderung versucht es wieder
                    if (isDirtyRef.current && !saveFailedRef.current) {
                        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
                        autosaveTimerRef.current = setTimeout(() => { autosaveTimerRef.current = null; saveRef.current?.(true); }, 0);
                    }
                }
            }
        })();
        saveInFlightRef.current = run;
        return run;
    }, []);
    saveRef.current = handleSave;

    // Autosave: jede Änderung erhöht die Revision; gespeichert wird 2 s nach der letzten Änderung
    const markDirty = useCallback(() => {
        revisionRef.current += 1;
        isDirtyRef.current = true;
        setSaveState(prev => (prev === 'saving' || prev === 'error' ? prev : 'dirty'));
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        const schedule = (delay) => {
            autosaveTimerRef.current = setTimeout(() => {
                autosaveTimerRef.current = null;
                if (!isDirtyRef.current) return;
                // Nicht mitten in einem Zieh-Vorgang speichern
                if (dragStartRef.current || isPanningRef.current) { schedule(1000); return; }
                saveRef.current?.(true);
            }, delay);
        };
        schedule(2000);
    }, []);

    // Beim Verlassen (Tab schließen/ausblenden, Navigation in der App) ausstehende Änderungen sofort speichern
    useEffect(() => {
        const flush = () => { if (isDirtyRef.current) saveRef.current?.(true); };
        const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
        const onBeforeUnload = (e) => {
            if (isDirtyRef.current || saveInFlightRef.current) {
                flush();
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('beforeunload', onBeforeUnload);
            if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
            flush();
        };
    }, []);

    // ─── Undo/Redo subscription ─────────────────────────────────
    useEffect(() => {
        const unsub = cmdStackRef.current.subscribe(() => forceRender(v => v + 1));
        return unsub;
    }, []);

    // Keep selection refs in sync so requestRender never uses stale selection
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;
    const selectedRoomIdRef = useRef(selectedRoomId);
    selectedRoomIdRef.current = selectedRoomId;

    // Keep bg refs in sync so requestRender always uses current values
    const bgImageRef = useRef(bgImage);
    bgImageRef.current = bgImage;
    const bgImageObjRef = useRef(bgImageObj);
    bgImageObjRef.current = bgImageObj;
    const calibPointsRef = useRef(calibPoints);
    calibPointsRef.current = calibPoints;
    const bgLoadTokenRef = useRef(0);

    // ─── Render Loop ────────────────────────────────────────────
    const isPrintingRef = useRef(false);
    const showDimensionsRef = useRef(true);

    const requestRender = useCallback(() => {
        // Cancel any pending stale frame so we always render with fresh state
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
        }
        animFrameRef.current = requestAnimationFrame(() => {
            animFrameRef.current = null;
            const canvas = canvasRef.current;
            const storey = activeStoreyRef.current;
            if (!canvas || !storey) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            // Zeichenfläche ist in Gerätepixeln angelegt (HiDPI) – gezeichnet wird in CSS-Pixeln
            const dpr = canvasSizeRef.current.dpr || 1;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const bg = bgImageRef.current;
            render(ctx, canvas, vpRef.current, storey, {
                selectedId: selectedIdRef.current,
                selectedIds: selectedIdsRef.current,
                preview: previewRef.current,
                snapPoint: snapPointRef.current,
                dimensionLine: dimensionLineRef.current,
                dragHandle: dragHandleRef.current,
                hoverPoint: hoverPointRef.current,
                marquee: marqueeRef.current,
                hoverId: hoverIdRef.current,
                bgImage: bg && bg.visible !== false ? bg : null,
                bgImageObj: bgImageObjRef.current,
                calibPoints: calibPointsRef.current,
                isPrinting: isPrintingRef.current,
                showDimensions: showDimensionsRef.current,
                selectedRoomId: selectedRoomIdRef.current,
                // Neuere Renderer-Versionen setzen die Transformation selbst anhand von pixelRatio
                pixelRatio: dpr,
            });
        });
    }, []);

    // Nach jedem React-Render die Zeichenfläche nachziehen (In-Place-Änderungen + forceRender)
    useEffect(() => { requestRender(); });

    // ─── Hintergrundbilder im Dateispeicher ─────────────────────
    // Objekt-URL zu einem gespeicherten Bild (einmal laden, dann aus dem Zwischenspeicher)
    const getBgObjectUrl = useCallback(async (path) => {
        const cached = bgUrlCacheRef.current.get(path);
        if (cached) return cached;
        const blob = await downloadBackgroundBlob(supabase.storage, path);
        const url = URL.createObjectURL(blob);
        bgUrlCacheRef.current.set(path, url);
        return url;
    }, []);

    const forgetBgObjectUrl = useCallback((path) => {
        const url = bgUrlCacheRef.current.get(path);
        if (url) {
            URL.revokeObjectURL(url);
            bgUrlCacheRef.current.delete(path);
        }
    }, []);

    // Nie gespeicherte Datei sofort löschen (verworfener Upload)
    const discardUploadedBg = useCallback((path) => {
        forgetBgObjectUrl(path);
        removeBackgroundObjects(supabase.storage, [path]).catch(() => { /* bleibt als verwaiste Datei im Plan-Ordner */ });
    }, [forgetBgObjectUrl]);

    // Neue Änderung am Hintergrund eines Geschosses → laufende Uploads dafür sind veraltet
    const bumpBgToken = useCallback((storeyId) => {
        const next = (bgUploadTokensRef.current.get(storeyId) || 0) + 1;
        bgUploadTokensRef.current.set(storeyId, next);
        return next;
    }, []);

    // Bild hochladen und Hintergrund-Daten mit Pfad liefern: { bgData, img }
    const storeBackground = useCallback(async (planId, storeyId, bgData, dataUrl, img) => {
        const prepared = await prepareBgUpload(dataUrl, img);
        const ext = extForMime(prepared.blob.type);
        if (!ext) throw new Error('Nur PNG- oder JPG-Bilder können gespeichert werden.');
        const path = buildBackgroundPath(planId, storeyId, ext, randomToken());
        await uploadBackgroundBlob(supabase.storage, path, prepared.blob);
        const url = URL.createObjectURL(prepared.blob);
        bgUrlCacheRef.current.set(path, url);
        // Verkleinert → Bildobjekt aus der hochgeladenen Datei, Maßstab umrechnen (gleiche Weltgröße)
        const finalImg = prepared.factor === 1 ? img : await loadImageFromUrl(url);
        const stored = toStoredBackground(bgData, path, {
            scale: (Number(bgData?.scale) || 1) * prepared.factor,
            imgWidth: finalImg.width,
            imgHeight: finalImg.height,
        });
        return { bgData: stored, img: finalImg };
    }, []);

    // Eingebettete Hintergrundbilder (Altbestand, data-URL in plan_data) in den Dateispeicher
    // verschieben. Nur für gespeicherte Pläne; scheitert es (z. B. keine Schreibrechte oder
    // Speicher nicht verfügbar), bleibt das Bild eingebettet und es gibt keinen neuen Versuch
    // in dieser Sitzung.
    const migrateInlineBackgrounds = async () => {
        const planId = savedIdRef.current;
        if (!planId || !loadedOkRef.current || bgMigrationRunningRef.current || bgMigrationFailedRef.current) return;
        const pending = storeysRef.current.filter(s => isInlineBackground(s?.bgImage));
        if (pending.length === 0) return;
        bgMigrationRunningRef.current = true;
        let changed = false;
        try {
            for (const storey of pending) {
                const original = storey.bgImage;
                if (!isInlineBackground(original)) continue;
                const token = bgUploadTokensRef.current.get(storey.id) || 0;
                const img = await loadImageFromUrl(original.dataUrl);
                const { bgData: stored, img: storedImg } = await storeBackground(planId, storey.id, original, original.dataUrl, img);
                const current = storeysRef.current.find(s => s.id === storey.id);
                // Inzwischen ersetzt, entfernt oder anderer Plan → hochgeladene Datei verwerfen
                if (!current || current.bgImage !== original || (bgUploadTokensRef.current.get(storey.id) || 0) !== token || savedIdRef.current !== planId) {
                    discardUploadedBg(stored.path);
                    continue;
                }
                current.bgImage = stored;
                if (activeStoreyRef.current?.id === storey.id) {
                    bgLoadTokenRef.current++;
                    setBgImage(stored);
                    setBgImageObj(storedImg);
                }
                changed = true;
            }
        } catch {
            bgMigrationFailedRef.current = true;
        } finally {
            bgMigrationRunningRef.current = false;
        }
        if (changed) {
            markDirty();
            requestRender();
        }
    };
    migrateBgRef.current = migrateInlineBackgrounds;

    // Nach erfolgreichem Speichern: ersetzte/entfernte Bilder löschen, sobald weder der
    // gespeicherte noch der aktuelle Stand auf sie verweist; eingebettete Bilder verschieben.
    afterSaveRef.current = (savedStoreys) => {
        const pendingDeletes = [...pendingBgDeletesRef.current];
        if (pendingDeletes.length > 0) {
            const referencedSaved = new Set(collectBackgroundPaths(savedStoreys));
            const referencedNow = new Set(collectBackgroundPaths(storeysRef.current));
            const toDelete = [];
            for (const path of pendingDeletes) {
                if (referencedNow.has(path)) { pendingBgDeletesRef.current.delete(path); continue; }
                if (referencedSaved.has(path)) continue; // erst nach dem nächsten Speichern
                pendingBgDeletesRef.current.delete(path);
                forgetBgObjectUrl(path);
                toDelete.push(path);
            }
            if (toDelete.length > 0) {
                removeBackgroundObjects(supabase.storage, toDelete).catch(() => { /* verwaiste Datei, wird mit dem Plan gelöscht */ });
            }
        }
        if (storeysRef.current.some(s => isInlineBackground(s?.bgImage))) {
            setTimeout(() => migrateBgRef.current?.(), 0);
        }
    };

    // Objekt-URLs beim Verlassen freigeben (die Map selbst wird nie ersetzt)
    useEffect(() => {
        const cache = bgUrlCacheRef.current;
        return () => {
            for (const url of cache.values()) URL.revokeObjectURL(url);
            cache.clear();
        };
    }, []);

    // Hintergrundbild immer aus dem aktiven Geschoss ableiten (beim Geschosswechsel neu laden)
    useEffect(() => {
        const saved = activeStorey?.bgImage || null;
        const token = ++bgLoadTokenRef.current;
        setBgImage(saved);
        setBgImageObj(null);
        const showImage = (src) => {
            const img = new window.Image();
            img.onload = () => { if (bgLoadTokenRef.current === token) { setBgImageObj(img); requestRender(); } };
            img.onerror = () => { if (bgLoadTokenRef.current === token) setBgImageObj(null); };
            img.src = src;
        };
        if (saved?.dataUrl) {
            showImage(saved.dataUrl);
        } else if (isStoredBackground(saved)) {
            getBgObjectUrl(saved.path)
                .then((url) => { if (bgLoadTokenRef.current === token) showImage(url); })
                .catch((err) => {
                    if (bgLoadTokenRef.current !== token) return;
                    setBgImageObj(null);
                    setViewNotice(`Das Hintergrundbild dieses Geschosses konnte nicht geladen werden${err?.message ? ` (${err.message})` : ''}.`);
                });
        }
    }, [activeStorey?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Canvas Setup ───────────────────────────────────────────
    // Größe folgt dem Container (ResizeObserver, auch bei ein-/ausgeblendeten Seitenleisten), HiDPI-scharf.
    useEffect(() => {
        if (viewMode !== '2d' || loading || loadError) return; // canvas not mounted
        const canvas = canvasRef.current;
        const parent = canvas?.parentElement;
        if (!canvas || !parent) return;
        const resize = () => {
            const rect = parent.getBoundingClientRect();
            const w = Math.max(1, Math.round(rect.width));
            const h = Math.max(1, Math.round(rect.height));
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            canvasSizeRef.current = { w, h, dpr };
            const bw = Math.round(w * dpr);
            const bh = Math.round(h * dpr);
            if (canvas.width !== bw) canvas.width = bw;
            if (canvas.height !== bh) canvas.height = bh;
            // Erstes Zentrieren erst, wenn die echte Größe bekannt ist
            if (needsCenterRef.current && rect.width > 1 && rect.height > 1) {
                needsCenterRef.current = false;
                vpRef.current.offsetX = w / 2;
                vpRef.current.offsetY = h / 2;
            }
            requestRender();
        };
        resize();
        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => resize());
            ro.observe(parent);
        }
        window.addEventListener('resize', resize);
        return () => {
            if (ro) ro.disconnect();
            window.removeEventListener('resize', resize);
        };
    }, [loading, loadError, viewMode, requestRender]);

    // ─── Änderungshistorie (Undo/Redo) ──────────────────────────
    // Jede Bearbeitung wird als Vorher-/Nachher-Snapshot des betroffenen Geschosses erfasst.
    const applyStoreySnapshot = useCallback((storeyId, snap) => {
        const target = storeysRef.current.find(s => s.id === storeyId);
        if (!target || !snap) return false;
        const keepBg = target.bgImage;
        for (const key of Object.keys(target)) delete target[key];
        Object.assign(target, JSON.parse(snap));
        if (keepBg) target.bgImage = keepBg;
        return true;
    }, []);

    const focusStoreyById = useCallback((storeyId) => {
        const idx = storeysRef.current.findIndex(s => s.id === storeyId);
        if (idx >= 0 && storeysRef.current[idx] !== activeStoreyRef.current) setActiveStoreyIdx(idx);
    }, []);

    const pushHistory = useCallback((label, storeyId, before, after) => {
        let firstRun = true;
        cmdStackRef.current.execute({
            label,
            do: () => {
                if (firstRun) { firstRun = false; return; } // Änderung ist bereits ausgeführt
                applyStoreySnapshot(storeyId, after);
                focusStoreyById(storeyId);
            },
            undo: () => {
                applyStoreySnapshot(storeyId, before);
                focusStoreyById(storeyId);
            },
        });
    }, [applyStoreySnapshot, focusStoreyById]);

    // Änderung übernehmen: nur wenn sich wirklich etwas geändert hat → Historie + Autosave
    const commitChange = useCallback((label, storey, before) => {
        if (!storey || before == null) return null;
        const after = snapshotStorey(storey);
        if (after === before) return null;
        pushHistory(label, storey.id, before, after);
        markDirty();
        forceRender(v => v + 1);
        requestRender();
        return after;
    }, [pushHistory, markDirty, requestRender]);

    // Mutation am aktiven Geschoss ausführen und als ein Undo-Schritt erfassen
    const applyChange = useCallback((label, mutate) => {
        const storey = activeStoreyRef.current;
        if (!storey) return null;
        const before = snapshotStorey(storey);
        mutate(storey);
        return commitChange(label, storey, before);
    }, [commitChange]);

    // Geschoss-Liste ersetzen (Hinzufügen/Duplizieren/Löschen) – auch für Undo/Redo
    const commitStoreys = useCallback((next, nextActiveIdx) => {
        storeysRef.current = next;
        setStoreys(next);
        if (nextActiveIdx !== undefined) setActiveStoreyIdx(Math.max(0, Math.min(next.length - 1, nextActiveIdx)));
    }, []);

    const pushStoreysHistory = useCallback((label, beforeList, afterList, beforeIdx, afterIdx) => {
        let firstRun = true;
        cmdStackRef.current.execute({
            label,
            do: () => {
                if (firstRun) { firstRun = false; return; }
                commitStoreys(afterList, afterIdx);
            },
            undo: () => commitStoreys(beforeList, beforeIdx),
        });
    }, [commitStoreys]);

    // Texteingaben im Panel: live ins Modell schreiben, beim Verlassen des Feldes als ein Undo-Schritt erfassen
    const beginTextEdit = useCallback((label) => {
        const storey = activeStoreyRef.current;
        textEditRef.current = storey ? { storeyId: storey.id, before: snapshotStorey(storey), label } : null;
    }, []);
    const endTextEdit = useCallback(() => {
        const te = textEditRef.current;
        textEditRef.current = null;
        if (!te) return;
        const storey = storeysRef.current.find(s => s.id === te.storeyId);
        if (storey) commitChange(te.label, storey, te.before);
    }, [commitChange]);
    const liveTextChange = useCallback(() => {
        markDirty();
        forceRender(v => v + 1);
        requestRender();
    }, [markDirty, requestRender]);

    // Laufende Zeichenaktion abbrechen; noch nicht übernommene Zwischenschritte (Startpunkt,
    // geteilte Wirtswand) werden zurückgerollt, sofern seitdem nichts anderes geändert wurde.
    const cancelDrawing = useCallback(() => {
        const pd = pendingDrawRef.current;
        pendingDrawRef.current = null;
        let rolledBack = false;
        if (pd && pd.last) {
            const storey = storeysRef.current.find(s => s.id === pd.storeyId);
            if (storey && snapshotStorey(storey) === pd.last) {
                applyStoreySnapshot(pd.storeyId, pd.before);
                rolledBack = true;
            }
        }
        if (!rolledBack) {
            // Fallback: einzelnen, von keiner Wand genutzten Startpunkt entfernen
            const dp = drawPointsRef.current;
            const storey = activeStoreyRef.current;
            if (storey && dp.length === 1 && typeof dp[0] === 'string') {
                const ptId = dp[0];
                const usedByWall = storey.walls.some(w => w.p1 === ptId || w.p2 === ptId);
                if (!usedByWall && storey.points.some(p => p.id === ptId)) {
                    storey.points = storey.points.filter(p => p.id !== ptId);
                    rolledBack = true;
                }
            }
        }
        setDrawPoints([]);
        drawPointsRef.current = [];
        previewRef.current = null;
        snapPointRef.current = null;
        if (rolledBack) {
            markDirty();
            forceRender(v => v + 1);
        }
        requestRender();
        return rolledBack;
    }, [applyStoreySnapshot, markDirty, requestRender]);

    // Gemeinsamer Ablauf für Undo/Redo (Tastatur und Buttons)
    const afterHistoryStep = useCallback(() => {
        setEditingLength(null);
        setActiveAnnotationId(null);
        setAnnotationPoints([]);
        setAnnotationCircleCenter(null);
        dragStartRef.current = null;
        marqueeRef.current = null;
        dimensionLineRef.current = null;
        dragHandleRef.current = null;
        setSelectedId(null);
        setSelectedType(null);
        setSelectedIds([]);
        setSelectedRoomId(null);
        markDirty();
        forceRender(v => v + 1);
        requestRender();
    }, [markDirty, requestRender]);

    const handleUndo = useCallback(() => {
        // Erst eine angefangene Zeichnung zurücknehmen (Startpunkt / offene Decke), sonst den letzten Schritt
        const dp = drawPointsRef.current;
        if (dp.length > 0 || pendingDrawRef.current) {
            const onlyStarted = dp.length === 1 || (dp.length > 0 && typeof dp[0] !== 'string');
            const rolledBack = cancelDrawing();
            if (rolledBack || onlyStarted) return;
        }
        if (!cmdStackRef.current.canUndo()) return;
        cmdStackRef.current.undo();
        afterHistoryStep();
    }, [cancelDrawing, afterHistoryStep]);

    const handleRedo = useCallback(() => {
        if (!cmdStackRef.current.canRedo()) return;
        cancelDrawing();
        cmdStackRef.current.redo();
        afterHistoryStep();
    }, [cancelDrawing, afterHistoryStep]);

    // Hide grid during printing
    useEffect(() => {
        const beforePrint = () => { isPrintingRef.current = true; requestRender(); };
        const afterPrint = () => { isPrintingRef.current = false; requestRender(); };
        window.addEventListener('beforeprint', beforePrint);
        window.addEventListener('afterprint', afterPrint);
        return () => {
            window.removeEventListener('beforeprint', beforePrint);
            window.removeEventListener('afterprint', afterPrint);
        };
    }, [requestRender]);

    // ─── Background Image Upload ─────────────────────────────────
    // Hintergrundbild am aktiven Geschoss ändern (Sichtbarkeit, Transparenz, Maßstab) und speichern
    const updateBgImage = useCallback((patch) => {
        const storey = activeStoreyRef.current;
        if (!storey?.bgImage) return;
        const next = { ...storey.bgImage, ...patch };
        storey.bgImage = next;
        setBgImage(next);
        markDirty();
        requestRender();
    }, [markDirty, requestRender]);

    const handleBgUpload = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > MAX_BG_FILE_BYTES) {
            alert(`Die Datei ist zu groß (${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB). Bitte eine Datei bis 30 MB verwenden.`);
            return;
        }
        // Ziel-Geschoss beim Start festhalten – das Bild landet dort, auch wenn inzwischen gewechselt wurde
        const targetStoreyId = activeStoreyRef.current?.id;

        const applyLoadedBg = (dataUrl, pxPerMm, img) => {
            if (!storeysRef.current.some(s => s.id === targetStoreyId)) return;
            // pxPerMm = how many image pixels per 1 mm of real-world space
            const finalScale = pxPerMm || 5;
            const bgData = {
                dataUrl,
                scale: finalScale,
                offsetX: 0,
                offsetY: 0,
                opacity: 0.35,
                visible: true,
                imgWidth: img.width,
                imgHeight: img.height,
            };
            const token = bumpBgToken(targetStoreyId);

            // Am Geschoss übernehmen (wird mit dem Plan gespeichert); ein ersetztes Bild aus dem
            // Dateispeicher wird nach dem nächsten erfolgreichen Speichern gelöscht.
            const commit = (data, image) => {
                if ((bgUploadTokensRef.current.get(targetStoreyId) || 0) !== token) return false;
                const target = storeysRef.current.find(s => s.id === targetStoreyId);
                if (!target) return false;
                const previous = target.bgImage;
                target.bgImage = data;
                if (isStoredBackground(previous) && previous.path !== data.path) pendingBgDeletesRef.current.add(previous.path);
                if (activeStoreyRef.current?.id === targetStoreyId) {
                    bgLoadTokenRef.current++;
                    setBgImage(data);
                    setBgImageObj(image);
                }
                markDirty();
                requestRender();
                return true;
            };

            // Neuer, noch nie gespeicherter Plan: Bild vorerst einbetten; nach dem ersten
            // Speichern wird es in den Dateispeicher verschoben.
            const planId = savedIdRef.current;
            if (!planId) { commit(bgData, img); return; }

            setBgUploading(true);
            storeBackground(planId, targetStoreyId, bgData, dataUrl, img)
                .then(({ bgData: stored, img: storedImg }) => {
                    if (!commit(stored, storedImg)) discardUploadedBg(stored.path);
                })
                .catch((err) => {
                    // Rückfall: wie bisher im Grundriss einbetten (z. B. Dateispeicher nicht verfügbar)
                    if (commit(bgData, img)) {
                        setViewNotice(`Das Hintergrundbild konnte nicht im Dateispeicher abgelegt werden${err?.message ? ` (${err.message})` : ''}. Es wird vorerst direkt im Grundriss gespeichert.`);
                    }
                })
                .finally(() => setBgUploading(false));
        };

        const loadImage = (dataUrl, pxPerMm) => {
            const img = new window.Image();
            img.onload = () => applyLoadedBg(dataUrl, pxPerMm, img);
            img.onerror = () => alert('Das Hintergrundbild konnte nicht geladen werden. Bitte eine PNG-, JPG- oder PDF-Datei verwenden.');
            img.src = dataUrl;
        };

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            // PDF: render first page to canvas using pdfjsLib
            const loadPdf = async () => {
                let loadingTask = null;
                let pdf = null;
                try {
                    const pdfjsLib = await import('pdfjs-dist');

                    // pdfjs-dist v5+ worker setup for Vite
                    try {
                        const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
                        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;
                    } catch (workerErr) {
                        console.warn('PDF worker import failed, using workerless mode:', workerErr);
                        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
                    }

                    const arrayBuffer = await file.arrayBuffer();
                    loadingTask = pdfjsLib.getDocument({
                        data: new Uint8Array(arrayBuffer),
                        useWorkerFetch: false,
                        isEvalSupported: false,
                        useSystemFonts: true,
                    });
                    pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1);

                    // Get physical page size (1 PDF point = 1/72 inch = 0.352778 mm)
                    const baseViewport = page.getViewport({ scale: 1 });
                    const pageWidthMm = baseViewport.width * 0.352778;

                    // Render-Auflösung begrenzen (max. MAX_BG_EDGE_PX Kantenlänge, höchstens 4-fach)
                    const renderScale = Math.min(4, MAX_BG_EDGE_PX / Math.max(baseViewport.width, baseViewport.height, 1));
                    const viewport = page.getViewport({ scale: renderScale });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.floor(viewport.width));
                    canvas.height = Math.max(1, Math.floor(viewport.height));
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    await page.render({ canvasContext: ctx, viewport }).promise;

                    // pxPerMm = rendered pixels / physical mm on paper
                    // Architectural plans are typically 1:100, so 1mm paper = 100mm real
                    // Divide by 100 to get real-world scale
                    const drawingScale = 100; // default: 1:100
                    const pxPerMm = viewport.width / (pageWidthMm * drawingScale);

                    const dataUrl = encodeBgCanvas(canvas);
                    loadImage(dataUrl, pxPerMm);
                } catch (err) {
                    console.error('PDF load error:', err);
                    alert('PDF konnte nicht geladen werden: ' + (err.message || err) + '\nBitte verwende ein Bild (PNG/JPG) oder versuche es erneut.');
                } finally {
                    try {
                        if (pdf) await pdf.destroy();
                        else if (loadingTask) await loadingTask.destroy();
                    } catch { /* ignore */ }
                }
            };
            loadPdf();
        } else {
            // Regular image — assume 150 DPI scanned plan at 1:100 scale
            // 150 DPI = 5.906 px/mm on paper; at 1:100 → 0.05906 px/mm in real world
            const basePxPerMm = 5.906 / 100;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const original = ev.target.result;
                const img = new window.Image();
                img.onload = () => {
                    const maxEdge = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
                    if (maxEdge > MAX_BG_EDGE_PX || String(original).length > MAX_BG_DATAURL_CHARS) {
                        // Zu groß für plan_data → verkleinern, Maßstab entsprechend anpassen
                        const { dataUrl, factor } = downscaleBgImage(img);
                        loadImage(dataUrl, basePxPerMm * factor);
                    } else {
                        applyLoadedBg(original, basePxPerMm, img);
                    }
                };
                img.onerror = () => alert('Das Bild konnte nicht gelesen werden. Bitte eine PNG- oder JPG-Datei verwenden.');
                img.src = original;
            };
            reader.onerror = () => alert('Die Datei konnte nicht gelesen werden.');
            reader.readAsDataURL(file);
        }
    };

    const handleCalibApply = () => {
        const storey = activeStoreyRef.current;
        if (calibPoints.length < 2 || !calibDistMm || !storey?.bgImage) return;
        const distMm = parseNumberInput(calibDistMm);
        if (!Number.isFinite(distMm) || distMm <= 0) return;

        // Distance in current world coords between the two calibration points
        const dx = calibPoints[1].x - calibPoints[0].x;
        const dy = calibPoints[1].y - calibPoints[0].y;
        const worldDist = Math.sqrt(dx * dx + dy * dy);
        if (worldDist < 1) return;

        // Current scale: pxPerMm. worldDist mm in current scale = worldDist mm
        // Real distance = distMm mm.
        // New scale = old scale * (worldDist / distMm)
        const oldScale = storey.bgImage.scale || 1;
        const newScale = oldScale * (worldDist / distMm);
        if (!Number.isFinite(newScale) || newScale <= 0) return;

        updateBgImage({ scale: newScale });
        setCalibPoints([]);
        setShowCalibDialog(false);
        setCalibDistMm('');
        setActiveTool(TOOLS.SELECT);
    };

    const removeBgImage = () => {
        bgLoadTokenRef.current++;
        setBgImage(null);
        setBgImageObj(null);
        setCalibPoints([]);
        if (bgFileRef.current) bgFileRef.current.value = '';
        const storey = activeStoreyRef.current;
        if (storey) bumpBgToken(storey.id); // laufenden Upload für dieses Geschoss verwerfen
        if (storey?.bgImage) {
            const previous = storey.bgImage;
            delete storey.bgImage;
            // Datei erst löschen, wenn der Plan ohne sie gespeichert ist
            if (isStoredBackground(previous)) pendingBgDeletesRef.current.add(previous.path);
            markDirty();
        }
        requestRender();
    };

    // ─── Mouse Handlers ─────────────────────────────────────────
    showDimensionsRef.current = showDimensions;

    // Track Space key for pan mode (nicht in Eingabefeldern – dort ist die Leertaste ein Leerzeichen)
    useEffect(() => {
        const down = (e) => {
            if (e.code !== 'Space' || e.repeat || isEditableTarget(e.target)) return;
            spaceHeldRef.current = true;
            e.preventDefault();
        };
        const up = (e) => { if (e.code === 'Space') { spaceHeldRef.current = false; } };
        const reset = () => { spaceHeldRef.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', reset);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', reset);
        };
    }, []);

    const handleMouseDown = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // Middle button / Right button / Space+Left = pan
        // BUT: right-click during wall drawing = cancel drawing
        if (e.button === 2 && (activeTool === TOOLS.OUTER_WALL || activeTool === TOOLS.INNER_WALL) && drawPoints.length > 0) {
            e.preventDefault();
            // Cancel current drawing operation (inkl. Rücknahme von Startpunkt/Wandteilung)
            cancelDrawing();
            return;
        }
        if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeldRef.current)) {
            isPanningRef.current = true;
            panStartRef.current = { x: sx, y: sy };
            canvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return;

        const world = screenToWorld(vpRef.current, sx, sy);
        const wx = snapToGrid(world.x);
        const wy = snapToGrid(world.y);

        // Tool-specific click behavior
        if (activeTool === TOOLS.OUTER_WALL) {
            handleOuterWallClick(wx, wy);
        } else if (activeTool === TOOLS.INNER_WALL) {
            handleInnerWallClick(wx, wy);
        } else if (activeTool === TOOLS.DOOR || activeTool === TOOLS.WINDOW) {
            handleOpeningClick(wx, wy, activeTool === TOOLS.DOOR ? 'door' : 'window');
        } else if (activeTool === TOOLS.FURNITURE && placingFurniture) {
            handleFurnitureClick(wx, wy);
        } else if (activeTool === TOOLS.DELETE) {
            handleDeleteClick(wx, wy);
        } else if (activeTool === TOOLS.CALIBRATE) {
            // Calibration: place two points on the background image
            if (calibPoints.length < 2) {
                const newPts = [...calibPoints, { x: world.x, y: world.y }];
                setCalibPoints(newPts);
                if (newPts.length === 2) {
                    setShowCalibDialog(true);
                }
                requestRender();
            }
        } else if (activeTool === TOOLS.SELECT) {
            // Stand vor einem möglichen Ziehen merken – beim Loslassen wird nur bei echter Änderung gespeichert
            const before = snapshotStorey(activeStorey);
            dragStartRef.current = null;
            handleSelectClick(wx, wy, sx, sy);
            if (dragStartRef.current) {
                dragStartRef.current.before = before;
                dragStartRef.current.storeyId = activeStorey.id;
            }
        } else if (activeTool === TOOLS.SLAB) {
            // Polygon drawing for slabs
            let clickX = wx, clickY = wy;
            if (snapPointRef.current) {
                clickX = snapPointRef.current.x;
                clickY = snapPointRef.current.y;
            }
            // Snap to wall endpoints and outer wall edges
            const snapRadius = 20 / vpRef.current.zoom;
            const snapTargets = [...activeStorey.points];
            if (activeStorey.outerBoundary) snapTargets.push(...activeStorey.outerBoundary);
            if (activeStorey.outerPolygon) snapTargets.push(...activeStorey.outerPolygon);
            for (const pt of snapTargets) {
                if (dist({ x: clickX, y: clickY }, pt) < snapRadius) {
                    clickX = pt.x; clickY = pt.y;
                    break;
                }
            }
            // Close polygon if near start point
            if (drawPoints.length >= 3) {
                const startPt = drawPoints[0];
                if (dist({ x: clickX, y: clickY }, startPt) < 30 / vpRef.current.zoom) {
                    // Create slab with polygon
                    const newSlab = {
                        id: genId(),
                        name: 'Decke',
                        thickness_mm: 200,
                        ref_height_mm: activeStorey.height_mm || 2600,
                        polygon: drawPoints.map(p => ({ x: p.x, y: p.y })),
                    };
                    applyChange('Decke erstellen', st => {
                        if (!st.slabs) st.slabs = [];
                        st.slabs.push(newSlab);
                    });
                    setDrawPoints([]);
                    previewRef.current = null;
                    snapPointRef.current = null;
                    setSelectedId(newSlab.id);
                    setSelectedType('slab');
                    setActiveTool(TOOLS.SELECT);
                    return;
                }
            }
            // Add point to polygon (with angle snap)
            let snapX = snapToGrid(clickX), snapY = snapToGrid(clickY);
            if (drawPoints.length > 0) {
                const lastPt = drawPoints[drawPoints.length - 1];
                const snapped = snapAngle(lastPt.x, lastPt.y, snapX, snapY);
                snapX = snapped.x;
                snapY = snapped.y;
            }
            setDrawPoints(prev => [...prev, { x: snapX, y: snapY }]);
            requestRender();
        }

        // ── Annotation Tools ──────────────────────────────────────────
        const isAnnotTool = [TOOLS.ANNOTATE_POLYLINE, TOOLS.ANNOTATE_CIRCLE, TOOLS.ANNOTATE_AREA, TOOLS.ANNOTATE_TEXT].includes(activeTool);
        if (isAnnotTool) {
            const world = screenToWorld(vpRef.current, sx, sy);
            let ax = snapToGrid(world.x), ay = snapToGrid(world.y);

            // Snap to existing elements
            const snapResult = findSnapPoint(ax, ay, activeStorey.points, []);
            if (snapResult) { ax = snapResult.x; ay = snapResult.y; }
            const genAnnId = () => 'ann_' + Math.random().toString(36).substr(2, 9);

            // Jede Anmerkungs-Aktion ist ein eigener Undo-Schritt
            if (activeTool === TOOLS.ANNOTATE_POLYLINE || activeTool === TOOLS.ANNOTATE_AREA) {
                const annType = activeTool === TOOLS.ANNOTATE_POLYLINE ? 'polyline' : 'area';
                if (!activeAnnotationId) {
                    if (annotationPoints.length >= 1) {
                        // After 2nd point: create the annotation object immediately
                        const newAnn = {
                            id: genAnnId(), type: annType,
                            points: [...annotationPoints, { x: ax, y: ay }],
                            color: annotationColor,
                            lineWidth: annotationLineWidth,
                            fillColor: annType === 'area' ? (annotationColor + '33') : undefined,
                        };
                        applyChange('Anmerkung erstellen', st => {
                            if (!st.annotations) st.annotations = [];
                            st.annotations.push(newAnn);
                        });
                        setActiveAnnotationId(newAnn.id);
                        setAnnotationPoints([...annotationPoints, { x: ax, y: ay }]);
                        setSelectedId(newAnn.id);
                        setSelectedType('annotation');
                    } else {
                        // First click — just store the first point
                        setAnnotationPoints([{ x: ax, y: ay }]);
                    }
                } else {
                    // Subsequent clicks — add point to the live annotation
                    const ann = (activeStorey.annotations || []).find(a => a.id === activeAnnotationId);
                    if (ann) {
                        applyChange('Anmerkung erweitern', () => { ann.points.push({ x: ax, y: ay }); });
                        setAnnotationPoints(prev => [...prev, { x: ax, y: ay }]);
                    }
                }
                requestRender();
            } else if (activeTool === TOOLS.ANNOTATE_CIRCLE) {
                if (!annotationCircleCenter) {
                    setAnnotationCircleCenter({ x: ax, y: ay });
                } else {
                    // Second click → commit circle
                    const radius = dist(annotationCircleCenter, { x: ax, y: ay });
                    if (radius > 10) {
                        const newAnn = {
                            id: genAnnId(), type: 'circle',
                            cx: annotationCircleCenter.x, cy: annotationCircleCenter.y,
                            radius, color: annotationColor, lineWidth: annotationLineWidth,
                        };
                        applyChange('Anmerkung erstellen', st => {
                            if (!st.annotations) st.annotations = [];
                            st.annotations.push(newAnn);
                        });
                        setSelectedId(newAnn.id);
                        setSelectedType('annotation');
                    }
                    setAnnotationCircleCenter(null);
                    requestRender();
                }
            } else if (activeTool === TOOLS.ANNOTATE_TEXT) {
                const newAnn = {
                    id: genAnnId(), type: 'text',
                    x: ax, y: ay, text: 'Text',
                    color: annotationColor, fontSize: 14,
                };
                applyChange('Anmerkung erstellen', st => {
                    if (!st.annotations) st.annotations = [];
                    st.annotations.push(newAnn);
                });
                setSelectedId(newAnn.id);
                setSelectedType('annotation');
            }
        }
    };

    const handleMouseMove = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // Maustaste wurde außerhalb losgelassen → Ziehen/Pan/Auswahlrahmen beenden
        if (e.buttons === 0 && (isPanningRef.current || dragStartRef.current || marqueeRef.current?.dragging)) {
            handleMouseUp();
            return;
        }

        // Pan
        if (isPanningRef.current) {
            const vp = vpRef.current;
            vp.offsetX += sx - panStartRef.current.x;
            vp.offsetY += sy - panStartRef.current.y;
            panStartRef.current = { x: sx, y: sy };
            requestRender();
            return;
        }

        // Drag (select tool)
        if (dragStartRef.current) {
            const world = screenToWorld(vpRef.current, sx, sy);
            const wx = snapToGrid(world.x);
            const wy = snapToGrid(world.y);
            const { type, id, startX, startY } = dragStartRef.current;
            if (type === 'furniture') {
                const dx = wx - startX;
                const dy = wy - startY;
                const furn = activeStorey.furniture.find(f => f.id === id);
                if (furn) {
                    furn.x = dragStartRef.current.origX + dx;
                    furn.y = dragStartRef.current.origY + dy;
                }
                requestRender();
            } else if (type === 'opening') {
                // Slide opening along its wall
                const opening = activeStorey.openings.find(o => o.id === id);
                if (opening) {
                    const hostWall = activeStorey.walls.find(w => w.id === opening.wall_id);
                    if (hostWall) {
                        const wp1 = getPoint(activeStorey, hostWall.p1);
                        const wp2 = getPoint(activeStorey, hostWall.p2);
                        const wallLen = wp1 && wp2 ? dist(wp1, wp2) : 0;
                        // Degenerierte oder zu kurze Wand: Öffnung nicht verschieben (keine Division durch 0)
                        if (wallLen >= 1 && wallLen >= opening.width_mm + 2 * OPENING_MIN_EDGE_DIST) {
                            const wallDx = (wp2.x - wp1.x) / wallLen;
                            const wallDy = (wp2.y - wp1.y) / wallLen;
                            // Project mouse position onto wall axis
                            const relX = world.x - wp1.x;
                            const relY = world.y - wp1.y;
                            let newPos = relX * wallDx + relY * wallDy;
                            // Clamp to valid range
                            const halfW = opening.width_mm / 2;
                            newPos = Math.max(halfW + OPENING_MIN_EDGE_DIST, Math.min(wallLen - halfW - OPENING_MIN_EDGE_DIST, snapToGrid(newPos)));
                            if (Number.isFinite(newPos)) opening.position_mm = newPos;
                        }
                    }
                }
                requestRender();
            } else if (type === 'corner') {
                // Endpoint drag: move single point (resize wall)
                const pt = getPoint(activeStorey, dragStartRef.current.pointId);
                if (pt) {
                    const wall = activeStorey.walls.find(w => w.id === id);
                    let newX = snapToGrid(world.x);
                    let newY = snapToGrid(world.y);

                    // For inner wall endpoints, constrain to host wall (Mausposition auf die Host-Wand projiziert)
                    if (wall && wall.type !== 'outer') {
                        const origPt = { x: dragStartRef.current.origX, y: dragStartRef.current.origY };
                        const onHost = projectPointOntoHostWall(activeStorey, id, origPt, newX, newY, { snap: snapToGrid });
                        if (onHost) {
                            newX = onHost.x;
                            newY = onHost.y;
                        }
                    }

                    pt.x = newX;
                    pt.y = newY;
                    if (wall) {
                        const p1 = getPoint(activeStorey, wall.p1);
                        const p2 = getPoint(activeStorey, wall.p2);
                        if (p1 && p2) {
                            dimensionLineRef.current = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
                        }
                    }
                }
                requestRender();
            } else if (type === 'wall_perp') {
                const dx = wx - startX;
                const dy = wy - startY;
                const { nx, ny, origP1, origP2, p1Id, p2Id } = dragStartRef.current;
                const projDist = dx * nx + dy * ny;
                const snapProj = snapToGrid(projDist);
                const p1 = getPoint(activeStorey, p1Id);
                const p2 = getPoint(activeStorey, p2Id);
                if (p1 && p2) {
                    // Compute desired new positions
                    let newP1x = origP1.x + nx * snapProj;
                    let newP1y = origP1.y + ny * snapProj;
                    let newP2x = origP2.x + nx * snapProj;
                    let newP2y = origP2.y + ny * snapProj;

                    // Find the wall being dragged
                    const draggedWall = activeStorey.walls.find(w => w.id === id);

                    // Constrain endpoints to their host walls (if attached)
                    if (draggedWall && draggedWall.type !== 'outer') {
                        // Endpunkt auf einer Host-Wand: Bewegung auf die Wand projizieren und rasten
                        const constrainToHost = (origPt, newX, newY) => (
                            constrainPointToHostWall(activeStorey, id, origPt, newX - origPt.x, newY - origPt.y, { snapProj: snapToGrid })
                            || { x: newX, y: newY, constrained: false }
                        );

                        const c1 = constrainToHost(origP1, newP1x, newP1y);
                        const c2 = constrainToHost(origP2, newP2x, newP2y);
                        newP1x = c1.x; newP1y = c1.y;
                        newP2x = c2.x; newP2y = c2.y;
                    }

                    p1.x = newP1x; p1.y = newP1y;
                    p2.x = newP2x; p2.y = newP2y;
                    dimensionLineRef.current = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
                }
                requestRender();
            } else if (type === 'wall_body') {
                // Move entire wall body — constrained to host walls if inner wall
                const dx = snapToGrid(wx - startX);
                const dy = snapToGrid(wy - startY);
                const { origP1, origP2, p1Id, p2Id } = dragStartRef.current;
                const p1 = getPoint(activeStorey, p1Id);
                const p2 = getPoint(activeStorey, p2Id);
                if (p1 && p2) {
                    const draggedWall = activeStorey.walls.find(w => w.id === id);

                    if (draggedWall && draggedWall.type !== 'outer') {
                        // For inner walls, constrain each endpoint to slide along its host wall
                        // (Bewegung ist bereits gerastet, daher ohne zusätzliches Rasten der Projektion)
                        const constrainToHost = (origPt, moveX, moveY) => (
                            constrainPointToHostWall(activeStorey, id, origPt, moveX, moveY)
                            || { x: origPt.x + moveX, y: origPt.y + moveY }
                        );

                        const c1 = constrainToHost(origP1, dx, dy);
                        const c2 = constrainToHost(origP2, dx, dy);
                        p1.x = c1.x; p1.y = c1.y;
                        p2.x = c2.x; p2.y = c2.y;
                    } else {
                        // Outer walls: free movement
                        p1.x = origP1.x + dx;
                        p1.y = origP1.y + dy;
                        p2.x = origP2.x + dx;
                        p2.y = origP2.y + dy;
                    }
                    dimensionLineRef.current = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
                }
                requestRender();
            } else if (type === 'slab_corner') {
                const { slabId, cornerIdx, origX, origY } = dragStartRef.current;
                const slab = (activeStorey.slabs || []).find(s => s.id === slabId);
                if (slab && slab.polygon[cornerIdx]) {
                    const dx = snapToGrid(wx - startX);
                    const dy = snapToGrid(wy - startY);
                    slab.polygon[cornerIdx].x = origX + dx;
                    slab.polygon[cornerIdx].y = origY + dy;
                }
                requestRender();
            } else if (type === 'room_label') {
                // Drag room label to reposition it
                const dx = wx - startX;
                const dy = wy - startY;
                const room = activeStorey.rooms.find(r => r.id === dragStartRef.current.roomId);
                if (room) {
                    room.labelOffsetX = dragStartRef.current.origOffsetX + dx;
                    room.labelOffsetY = dragStartRef.current.origOffsetY + dy;
                }
                requestRender();
            } else if (type === 'annotation_drag') {
                const dx = wx - startX;
                const dy = wy - startY;
                const ann = (activeStorey.annotations || []).find(a => a.id === dragStartRef.current.annId);
                if (ann) {
                    if (dragStartRef.current.annType === 'text') {
                        ann.x = dragStartRef.current.origX + dx;
                        ann.y = dragStartRef.current.origY + dy;
                    } else if (dragStartRef.current.annType === 'circle') {
                        ann.cx = dragStartRef.current.origCx + dx;
                        ann.cy = dragStartRef.current.origCy + dy;
                    } else if (dragStartRef.current.origPoints) {
                        for (let i = 0; i < ann.points.length; i++) {
                            ann.points[i].x = dragStartRef.current.origPoints[i].x + dx;
                            ann.points[i].y = dragStartRef.current.origPoints[i].y + dy;
                        }
                    }
                }
                requestRender();
            } else if (type === 'annotation_point') {
                // Drag individual point of polyline/area
                const ann = (activeStorey.annotations || []).find(a => a.id === dragStartRef.current.annId);
                if (ann && ann.points && ann.points[dragStartRef.current.pointIdx]) {
                    ann.points[dragStartRef.current.pointIdx].x = dragStartRef.current.origX + (wx - startX);
                    ann.points[dragStartRef.current.pointIdx].y = dragStartRef.current.origY + (wy - startY);
                }
                requestRender();
            } else if (type === 'annotation_resize_circle') {
                // Resize circle radius
                const ann = (activeStorey.annotations || []).find(a => a.id === dragStartRef.current.annId);
                if (ann) {
                    const newRadius = dist({ x: wx, y: wy }, { x: ann.cx, y: ann.cy });
                    if (newRadius > 5) ann.radius = newRadius;
                }
                requestRender();
            } else if (type === 'multi') {
                const dx = snapToGrid(wx - startX);
                const dy = snapToGrid(wy - startY);
                const { origPositions, items } = dragStartRef.current;
                const movedPoints = new Set();
                for (const item of items) {
                    if (item.type === 'wall') {
                        const w = activeStorey.walls.find(w => w.id === item.id);
                        if (!w) continue;
                        for (const ptId of [w.p1, w.p2]) {
                            if (movedPoints.has(ptId)) continue;
                            const orig = origPositions[ptId];
                            const pt = getPoint(activeStorey, ptId);
                            if (orig && pt) {
                                pt.x = orig.x + dx;
                                pt.y = orig.y + dy;
                                movedPoints.add(ptId);
                            }
                        }
                    } else if (item.type === 'furniture') {
                        const f = activeStorey.furniture.find(f => f.id === item.id);
                        const orig = origPositions[item.id];
                        if (f && orig) {
                            f.x = orig.x + dx;
                            f.y = orig.y + dy;
                        }
                    }
                }
                requestRender();
            }
            return;
        }

        const world = screenToWorld(vpRef.current, sx, sy);
        mouseWorldRef.current = { x: world.x, y: world.y };

        // Preview
        if (activeTool === TOOLS.OUTER_WALL && drawPoints.length > 0) {
            const lastPtId = drawPoints[drawPoints.length - 1];
            const lastPt = getPoint(activeStorey, lastPtId);
            if (lastPt) {
                const snapped = snapAngle(lastPt.x, lastPt.y, snapToGrid(world.x), snapToGrid(world.y));

                // Find the real start of the entire wall chain (trace backward through existing walls)
                let chainStartId = drawPoints[0];
                const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                for (let i = 0; i < outerWalls.length; i++) {
                    const prev = outerWalls.find(w => w.p2 === chainStartId || w.p1 === chainStartId);
                    if (prev) {
                        const otherEnd = prev.p1 === chainStartId ? prev.p2 : prev.p1;
                        // Only trace back if this wall is not in our current drawPoints
                        if (!drawPoints.includes(otherEnd)) {
                            chainStartId = otherEnd;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                const chainStartPt = getPoint(activeStorey, chainStartId);

                // Check close to chain start (needs at least 3 walls total to close)
                const totalWallsInChain = drawPoints.length; // walls drawn in this session
                const existingConnectedWalls = outerWalls.filter(w => {
                    // Count walls not created by current drawPoints
                    const inDraw = drawPoints.some((dp, idx) => idx < drawPoints.length - 1 &&
                        ((dp === w.p1 && drawPoints[idx + 1] === w.p2) || (dp === w.p2 && drawPoints[idx + 1] === w.p1)));
                    return !inDraw;
                }).length;
                const canClose = (totalWallsInChain + existingConnectedWalls) >= 3;

                if (canClose && chainStartPt && dist(snapped, chainStartPt) < 30 / vpRef.current.zoom) {
                    previewRef.current = {
                        type: 'close_indicator',
                        x: chainStartPt.x, y: chainStartPt.y,
                        x1: lastPt.x, y1: lastPt.y,
                        // gleiche Stärke wie die Wand, die beim Klick entsteht
                        thickness: outerWallThickness,
                    };
                    snapPointRef.current = { ...chainStartPt, id: chainStartId };
                    requestRender();
                    return;
                }

                // Alignment snap: snap to same X/Y as existing wall endpoints
                const alignThreshold = 15; // mm
                let alignX = snapped.x, alignY = snapped.y;
                for (const pt of activeStorey.points) {
                    if (drawPoints.includes(pt.id) && pt.id === drawPoints[drawPoints.length - 1]) continue;
                    if (Math.abs(pt.y - snapped.y) < alignThreshold) {
                        alignY = pt.y; // snap Y to align horizontally
                    }
                    if (Math.abs(pt.x - snapped.x) < alignThreshold) {
                        alignX = pt.x; // snap X to align vertically
                    }
                }

                previewRef.current = {
                    type: 'wall_segment',
                    x1: lastPt.x, y1: lastPt.y,
                    x2: alignX, y2: alignY,
                    wallType: 'outer',
                    thickness: outerWallThickness,
                };
                // Add previous point for angle display
                if (drawPoints.length >= 2) {
                    const prevPt = getPoint(activeStorey, drawPoints[drawPoints.length - 2]);
                    if (prevPt) {
                        previewRef.current.prevX = prevPt.x;
                        previewRef.current.prevY = prevPt.y;
                    }
                }
                // Enhanced snap: check all wall endpoints AND wall edges
                let bestSnap = findSnapPoint(alignX, alignY, activeStorey.points, [lastPtId]);
                // Also snap to wall edges (closest point on any wall segment)
                if (!bestSnap) {
                    let bestEdgeDist = 20 / vpRef.current.zoom;
                    for (const w of activeStorey.walls) {
                        const wp1 = getPoint(activeStorey, w.p1);
                        const wp2 = getPoint(activeStorey, w.p2);
                        if (!wp1 || !wp2) continue;
                        const segRes = pointToSegmentDist(alignX, alignY, wp1.x, wp1.y, wp2.x, wp2.y);
                        if (segRes.dist < bestEdgeDist) {
                            bestEdgeDist = segRes.dist;
                            bestSnap = { x: snapToGrid(segRes.cx), y: snapToGrid(segRes.cy), wallP1: { x: wp1.x, y: wp1.y }, wallP2: { x: wp2.x, y: wp2.y } };
                        }
                    }
                }
                if (bestSnap) {
                    previewRef.current.x2 = bestSnap.x;
                    previewRef.current.y2 = bestSnap.y;
                }
                snapPointRef.current = bestSnap;
            }
            requestRender();
        } else if (activeTool === TOOLS.OUTER_WALL && drawPoints.length === 0) {
            // Before first point: show snap to existing outer wall endpoints
            const gx = snapToGrid(world.x), gy = snapToGrid(world.y);
            const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
            if (outerWalls.length > 0) {
                // Find outer wall endpoints that are chain ends (only connected to one wall)
                const ptUsage = {};
                for (const w of outerWalls) {
                    ptUsage[w.p1] = (ptUsage[w.p1] || 0) + 1;
                    ptUsage[w.p2] = (ptUsage[w.p2] || 0) + 1;
                }
                // Chain endpoints are those used by exactly one wall
                const chainEndpoints = Object.entries(ptUsage)
                    .filter(([, count]) => count === 1)
                    .map(([id]) => activeStorey.points.find(p => p.id === id))
                    .filter(Boolean);

                let bestSnap = null;
                let bestDist = 30 / vpRef.current.zoom;
                for (const pt of chainEndpoints) {
                    const d = dist({ x: gx, y: gy }, pt);
                    if (d < bestDist) {
                        bestDist = d;
                        bestSnap = { x: pt.x, y: pt.y, id: pt.id };
                    }
                }
                snapPointRef.current = bestSnap;
                hoverPointRef.current = bestSnap ? { x: bestSnap.x, y: bestSnap.y } : null;
            }
            requestRender();
        } else if (activeTool === TOOLS.INNER_WALL && drawPoints.length === 1) {
            const lastPtId = drawPoints[0];
            const lastPt = getPoint(activeStorey, lastPtId);
            if (lastPt) {
                const snapped = snapAngle(lastPt.x, lastPt.y, snapToGrid(world.x), snapToGrid(world.y));

                // Alignment snap for inner walls too
                const alignThreshold = 15;
                let endX = snapped.x, endY = snapped.y;
                for (const pt of activeStorey.points) {
                    if (pt.id === lastPtId) continue;
                    if (Math.abs(pt.y - snapped.y) < alignThreshold) endY = pt.y;
                    if (Math.abs(pt.x - snapped.x) < alignThreshold) endX = pt.x;
                }

                let snapFound = null;
                let bestDist = 20 / vpRef.current.zoom;

                // 1. Snap to ALL wall endpoints (outer + inner)
                const ptSnap = findSnapPoint(snapped.x, snapped.y, activeStorey.points, [lastPtId]);
                if (ptSnap) {
                    const d = dist({ x: snapped.x, y: snapped.y }, ptSnap);
                    if (d < bestDist) {
                        bestDist = d;
                        endX = ptSnap.x; endY = ptSnap.y;
                        snapFound = ptSnap;
                    }
                }

                // 2. Snap to outer polygon vertices (inner edge of outer walls)
                if (activeStorey.outerPolygon && activeStorey.outerPolygon.length > 0) {
                    for (const ip of activeStorey.outerPolygon) {
                        const d = dist({ x: snapped.x, y: snapped.y }, ip);
                        if (d < bestDist) {
                            bestDist = d;
                            endX = ip.x; endY = ip.y;
                            snapFound = ip;
                        }
                    }
                    // Snap to inner edge line segments — include wall info for measurement display
                    for (let i = 0; i < activeStorey.outerPolygon.length; i++) {
                        const a = activeStorey.outerPolygon[i];
                        const b = activeStorey.outerPolygon[(i + 1) % activeStorey.outerPolygon.length];
                        const segRes = pointToSegmentDist(snapped.x, snapped.y, a.x, a.y, b.x, b.y);
                        if (segRes.dist < bestDist) {
                            bestDist = segRes.dist;
                            endX = snapToGrid(segRes.cx); endY = snapToGrid(segRes.cy);
                            // Find the corresponding outer wall for this polygon edge
                            let closestWallId = null;
                            let closestWallDist = Infinity;
                            for (const ow of activeStorey.walls.filter(w => w.type === 'outer')) {
                                const owp1 = getPoint(activeStorey, ow.p1);
                                const owp2 = getPoint(activeStorey, ow.p2);
                                if (!owp1 || !owp2) continue;
                                const d = pointToSegmentDist(endX, endY, owp1.x, owp1.y, owp2.x, owp2.y);
                                if (d.dist < closestWallDist) {
                                    closestWallDist = d.dist;
                                    closestWallId = ow.id;
                                }
                            }
                            snapFound = { x: endX, y: endY, wallP1: { x: a.x, y: a.y }, wallP2: { x: b.x, y: b.y }, snapWallId: closestWallId };
                        }
                    }
                }

                // 3. Snap to ALL wall edges (inner walls too) — both surfaces
                for (const w of activeStorey.walls) {
                    const wp1 = getPoint(activeStorey, w.p1);
                    const wp2 = getPoint(activeStorey, w.p2);
                    if (!wp1 || !wp2) continue;

                    // Reference edge
                    const segRes = pointToSegmentDist(snapped.x, snapped.y, wp1.x, wp1.y, wp2.x, wp2.y);
                    if (segRes.dist < bestDist) {
                        bestDist = segRes.dist;
                        endX = snapToGrid(segRes.cx); endY = snapToGrid(segRes.cy);
                        snapFound = { x: endX, y: endY, wallP1: { x: wp1.x, y: wp1.y }, wallP2: { x: wp2.x, y: wp2.y }, snapWallId: w.id };
                    }

                    // Opposite edge (outer surface)
                    const poly = getWallPolygon(w, activeStorey);
                    if (poly && poly.length >= 4) {
                        let outerP1, outerP2;
                        if (w.type === 'outer') {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        } else if (w.ref_edge === 'left') {
                            outerP1 = poly[2]; outerP2 = poly[3];
                        } else {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        }
                        const segRes2 = pointToSegmentDist(snapped.x, snapped.y, outerP1.x, outerP1.y, outerP2.x, outerP2.y);
                        if (segRes2.dist < bestDist) {
                            bestDist = segRes2.dist;
                            endX = snapToGrid(segRes2.cx); endY = snapToGrid(segRes2.cy);
                            snapFound = { x: endX, y: endY, wallP1: { x: outerP1.x, y: outerP1.y }, wallP2: { x: outerP2.x, y: outerP2.y }, snapWallId: w.id };
                        }
                    }
                }

                previewRef.current = {
                    type: 'wall_segment',
                    x1: lastPt.x, y1: lastPt.y,
                    x2: endX, y2: endY,
                    wallType: 'inner',
                    // Stärke und Seite wie beim Anlegen (Seite = Cursorposition zur Wandachse)
                    thickness: innerWallThickness,
                    refEdge: getPointSide(world.x, world.y, lastPt.x, lastPt.y, endX, endY),
                };
                snapPointRef.current = snapFound;
            }
            requestRender();
        } else if ((activeTool === TOOLS.DOOR || activeTool === TOOLS.WINDOW) && activeStorey.walls.length > 0) {
            const wx = snapToGrid(world.x);
            const wy = snapToGrid(world.y);
            const hit = findWallAtPoint(activeStorey, wx, wy, 50 / vpRef.current.zoom);
            if (hit) {
                const pt1 = getPoint(activeStorey, hit.wall.p1);
                const pt2 = getPoint(activeStorey, hit.wall.p2);
                const wallLenHit = pt1 && pt2 ? dist(pt1, pt2) : 0;
                const presetHit = nextOpeningPreset[activeTool === TOOLS.DOOR ? 'door' : 'window'];
                // Wand zu kurz (oder degeneriert) für diese Öffnung → keine Vorschau
                if (!(wallLenHit >= 1 && wallLenHit >= presetHit.width + 2 * OPENING_MIN_EDGE_DIST)) {
                    previewRef.current = null;
                } else {
                    const wallLen = wallLenHit;
                    const pos = hit.t * wallLen;
                    const width = presetHit.width;
                    const halfW = width / 2;
                    // Clamp to valid range
                    const clampedPos = Math.max(halfW + OPENING_MIN_EDGE_DIST, Math.min(wallLen - halfW - OPENING_MIN_EDGE_DIST, pos));
                    const dx = (pt2.x - pt1.x) / wallLen;
                    const dy = (pt2.y - pt1.y) / wallLen;
                    previewRef.current = {
                        type: 'opening_ghost',
                        x1: pt1.x + dx * (clampedPos - halfW),
                        y1: pt1.y + dy * (clampedPos - halfW),
                        x2: pt1.x + dx * (clampedPos + halfW),
                        y2: pt1.y + dy * (clampedPos + halfW),
                        openingType: activeTool === TOOLS.DOOR ? 'door' : 'window',
                        wallP1: { x: pt1.x, y: pt1.y },
                        wallP2: { x: pt2.x, y: pt2.y },
                        position_mm: clampedPos,
                        width_mm: width,
                        wall_len: wallLen,
                        thickness: hit.wall.thickness_mm,
                        wallType: hit.wall.type,
                        refEdge: hit.wall.ref_edge,
                    };
                }
            } else {
                previewRef.current = null;
            }
            requestRender();
        } else if (activeTool === TOOLS.FURNITURE && placingFurniture) {
            const wx = snapToGrid(world.x);
            const wy = snapToGrid(world.y);
            previewRef.current = {
                type: 'furniture_ghost',
                x: wx - placingFurniture.defaultWidth / 2,
                y: wy - placingFurniture.defaultDepth / 2,
                width: placingFurniture.defaultWidth,
                depth: placingFurniture.defaultDepth,
                rotation: 0,
                catalogId: placingFurniture.id,
            };
            requestRender();
        } else if (activeTool === TOOLS.SLAB && drawPoints.length > 0) {
            const lastPt = drawPoints[drawPoints.length - 1];
            let endX = snapToGrid(world.x), endY = snapToGrid(world.y);
            const snapped = snapAngle(lastPt.x, lastPt.y, endX, endY);
            endX = snapped.x; endY = snapped.y;

            // Snap to wall endpoints and outer wall edges
            let snapFound = null;
            const snapRadius = 20 / vpRef.current.zoom;
            // Collect all snap-able points: wall endpoints + outer boundary + outer polygon
            const snapTargets = [...activeStorey.points];
            if (activeStorey.outerBoundary) snapTargets.push(...activeStorey.outerBoundary);
            if (activeStorey.outerPolygon) snapTargets.push(...activeStorey.outerPolygon);
            for (const pt of snapTargets) {
                const d = dist({ x: endX, y: endY }, pt);
                if (d < snapRadius) {
                    endX = pt.x; endY = pt.y;
                    snapFound = { x: pt.x, y: pt.y };
                    break;
                }
            }

            // Check if hovering near start point (close indicator)
            if (drawPoints.length >= 3) {
                const startPt = drawPoints[0];
                if (dist({ x: endX, y: endY }, startPt) < 30 / vpRef.current.zoom) {
                    previewRef.current = {
                        type: 'slab_close_indicator',
                        x: startPt.x, y: startPt.y,
                        x1: lastPt.x, y1: lastPt.y,
                        polygon: drawPoints,
                    };
                    snapPointRef.current = startPt;
                    requestRender();
                    return;
                }
            }

            previewRef.current = {
                type: 'slab_segment',
                x1: lastPt.x, y1: lastPt.y,
                x2: endX, y2: endY,
                polygon: drawPoints,
            };
            snapPointRef.current = snapFound;
            requestRender();
        } else if ((activeTool === TOOLS.ANNOTATE_POLYLINE || activeTool === TOOLS.ANNOTATE_AREA) && annotationPoints.length > 0) {
            // Preview line from last annotation point to cursor
            let ax = snapToGrid(world.x), ay = snapToGrid(world.y);
            const snapResult = findSnapPoint(ax, ay, activeStorey.points, []);
            if (snapResult) { ax = snapResult.x; ay = snapResult.y; }
            previewRef.current = {
                type: 'annotation_line',
                points: annotationPoints,
                x2: ax, y2: ay,
                color: annotationColor,
                lineWidth: annotationLineWidth,
                closed: activeTool === TOOLS.ANNOTATE_AREA,
            };
            snapPointRef.current = snapResult;
            requestRender();
        } else if (activeTool === TOOLS.ANNOTATE_CIRCLE && annotationCircleCenter) {
            // Preview circle radius
            let ax = snapToGrid(world.x), ay = snapToGrid(world.y);
            const snapResult = findSnapPoint(ax, ay, activeStorey.points, []);
            if (snapResult) { ax = snapResult.x; ay = snapResult.y; }
            const radius = dist(annotationCircleCenter, { x: ax, y: ay });
            previewRef.current = {
                type: 'annotation_circle',
                cx: annotationCircleCenter.x, cy: annotationCircleCenter.y,
                radius, color: annotationColor, lineWidth: annotationLineWidth,
            };
            snapPointRef.current = snapResult;
            requestRender();
        } else {
            previewRef.current = null;
            snapPointRef.current = null;

            // In SELECT mode: detect wall corner hover + element hover + update marquee
            if (activeTool === TOOLS.SELECT) {
                // Corner hover: find nearest wall endpoint
                const hoverRadius = 15 / vpRef.current.zoom;
                let nearestPt = null;
                let nearestDist = hoverRadius;
                for (const wall of activeStorey.walls) {
                    for (const ptId of [wall.p1, wall.p2]) {
                        const pt = getPoint(activeStorey, ptId);
                        if (!pt) continue;
                        const d = dist({ x: world.x, y: world.y }, pt);
                        if (d < nearestDist) {
                            nearestDist = d;
                            nearestPt = pt;
                        }
                    }
                }
                hoverPointRef.current = nearestPt;

                // Element hover detection (wall, furniture, opening)
                let newHoverId = null;
                const hitWall = findWallAtPoint(activeStorey, world.x, world.y, 20 / vpRef.current.zoom);
                if (hitWall) {
                    newHoverId = hitWall.wall.id;
                } else {
                    const hitFurn = findFurnitureAtPoint(activeStorey, world.x, world.y, 20 / vpRef.current.zoom);
                    if (hitFurn) {
                        newHoverId = hitFurn.id;
                    } else {
                        const hitOpen = findOpeningAtPoint(activeStorey, world.x, world.y, 20 / vpRef.current.zoom);
                        if (hitOpen) newHoverId = hitOpen.id;
                    }
                }
                if (hoverIdRef.current !== newHoverId) {
                    hoverIdRef.current = newHoverId;
                    // Change cursor to indicate clickable element
                    if (canvasRef.current) {
                        canvasRef.current.style.cursor = newHoverId ? 'pointer' : '';
                    }
                    requestRender();
                }

                // Marquee drag update with live selection preview
                if (marqueeRef.current && marqueeRef.current.dragging) {
                    marqueeRef.current.sx2 = sx;
                    marqueeRef.current.sy2 = sy;

                    // Compute live preview of elements that would be selected
                    const vp = vpRef.current;
                    const w1m = screenToWorld(vp, Math.min(marqueeRef.current.sx1, sx), Math.min(marqueeRef.current.sy1, sy));
                    const w2m = screenToWorld(vp, Math.max(marqueeRef.current.sx1, sx), Math.max(marqueeRef.current.sy1, sy));
                    const minX = Math.min(w1m.x, w2m.x), maxX = Math.max(w1m.x, w2m.x);
                    const minY = Math.min(w1m.y, w2m.y), maxY = Math.max(w1m.y, w2m.y);

                    const preselected = new Set();
                    for (const w of activeStorey.walls) {
                        const p1w = getPoint(activeStorey, w.p1);
                        const p2w = getPoint(activeStorey, w.p2);
                        if (!p1w || !p2w) continue;
                        const p1In = p1w.x >= minX && p1w.x <= maxX && p1w.y >= minY && p1w.y <= maxY;
                        const p2In = p2w.x >= minX && p2w.x <= maxX && p2w.y >= minY && p2w.y <= maxY;
                        if (p1In || p2In) {
                            preselected.add(w.id);
                            // Also add openings on this wall
                            for (const op of activeStorey.openings) {
                                if (op.wallId === w.id || op.wall_id === w.id) preselected.add(op.id);
                            }
                        }
                    }
                    for (const f of activeStorey.furniture) {
                        const fb = furnitureBounds(f);
                        if (fb.maxX >= minX && fb.minX <= maxX && fb.maxY >= minY && fb.minY <= maxY) {
                            preselected.add(f.id);
                        }
                    }
                    marqueeRef.current.preselected = preselected;
                }
            } else if (activeTool === TOOLS.INNER_WALL && drawPoints.length === 0) {
                // Show snap indicator before first click (Außenwand ohne Punkt wird bereits oben behandelt)
                const gx = snapToGrid(world.x), gy = snapToGrid(world.y);
                let bestDist = 20 / vpRef.current.zoom;
                let snap = null;

                // Snap to wall endpoints
                for (const pt of activeStorey.points) {
                    const d = dist({ x: gx, y: gy }, pt);
                    if (d < bestDist) {
                        bestDist = d;
                        snap = pt;
                    }
                }
                // Snap to outer polygon vertices
                if (activeStorey.outerPolygon) {
                    for (const ip of activeStorey.outerPolygon) {
                        const d = dist({ x: gx, y: gy }, ip);
                        if (d < bestDist) {
                            bestDist = d;
                            snap = ip;
                        }
                    }
                    // Snap to outer polygon edges
                    for (let i = 0; i < activeStorey.outerPolygon.length; i++) {
                        const a = activeStorey.outerPolygon[i];
                        const b = activeStorey.outerPolygon[(i + 1) % activeStorey.outerPolygon.length];
                        const segRes = pointToSegmentDist(gx, gy, a.x, a.y, b.x, b.y);
                        if (segRes.dist < bestDist) {
                            bestDist = segRes.dist;
                            // Find the corresponding outer wall
                            let closestWallId = null;
                            let closestWallDist = Infinity;
                            for (const ow of activeStorey.walls.filter(w => w.type === 'outer')) {
                                const owp1 = getPoint(activeStorey, ow.p1);
                                const owp2 = getPoint(activeStorey, ow.p2);
                                if (!owp1 || !owp2) continue;
                                const d = pointToSegmentDist(segRes.cx, segRes.cy, owp1.x, owp1.y, owp2.x, owp2.y);
                                if (d.dist < closestWallDist) {
                                    closestWallDist = d.dist;
                                    closestWallId = ow.id;
                                }
                            }
                            snap = { x: snapToGrid(segRes.cx), y: snapToGrid(segRes.cy), wallP1: { x: a.x, y: a.y }, wallP2: { x: b.x, y: b.y }, snapWallId: closestWallId };
                        }
                    }
                }
                // Snap to wall edges (both inner and outer surfaces)
                for (const w of activeStorey.walls) {
                    const wp1 = getPoint(activeStorey, w.p1);
                    const wp2 = getPoint(activeStorey, w.p2);
                    if (!wp1 || !wp2) continue;

                    // Reference edge (p1→p2)
                    const segRes = pointToSegmentDist(gx, gy, wp1.x, wp1.y, wp2.x, wp2.y);
                    if (segRes.dist < bestDist) {
                        bestDist = segRes.dist;
                        snap = { x: snapToGrid(segRes.cx), y: snapToGrid(segRes.cy), wallP1: { x: wp1.x, y: wp1.y }, wallP2: { x: wp2.x, y: wp2.y }, snapWallId: w.id };
                    }

                    // Opposite edge (outer surface of wall)
                    const poly = getWallPolygon(w, activeStorey);
                    if (poly && poly.length >= 4) {
                        // poly = [p1_left, p2_left, p2_right, p1_right]
                        // For outer walls: indices 0,1 are the outer edge
                        // For inner walls (ref_edge=right): indices 0,1 are the outer edge
                        // For inner walls (ref_edge=left): indices 2,3 (reversed) are the outer edge
                        let outerP1, outerP2;
                        if (w.type === 'outer') {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        } else if (w.ref_edge === 'left') {
                            outerP1 = poly[2]; outerP2 = poly[3];
                        } else {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        }
                        const segRes2 = pointToSegmentDist(gx, gy, outerP1.x, outerP1.y, outerP2.x, outerP2.y);
                        if (segRes2.dist < bestDist) {
                            bestDist = segRes2.dist;
                            snap = { x: snapToGrid(segRes2.cx), y: snapToGrid(segRes2.cy), wallP1: { x: outerP1.x, y: outerP1.y }, wallP2: { x: outerP2.x, y: outerP2.y }, snapWallId: w.id };
                        }
                    }
                }
                snapPointRef.current = snap;
                hoverPointRef.current = null;
            } else {
                hoverPointRef.current = null;
            }

            requestRender();
        }
    };

    const handleMouseUp = () => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            if (canvasRef.current) canvasRef.current.style.cursor = '';
            return;
        }
        if (dragStartRef.current) {
            const drag = dragStartRef.current;
            dragStartRef.current = null;
            dragHandleRef.current = null;
            dimensionLineRef.current = null;
            const storey = storeysRef.current.find(s => s.id === drag.storeyId) || activeStorey;
            // Nur bei tatsächlicher Änderung (nicht beim reinen Anklicken) neu berechnen, erfassen und speichern
            if (storey && drag.before != null && snapshotStorey(storey) !== drag.before) {
                if (GEOMETRY_DRAG_TYPES.includes(drag.type)) {
                    // Recompute both boundaries for outer walls
                    refreshOuterPolygon(storey);
                }
                computeRooms(storey);
                commitChange(DRAG_LABELS[drag.type] || 'Verschieben', storey, drag.before);
            }
            requestRender();
        }

        // Finalize marquee selection
        if (marqueeRef.current && marqueeRef.current.dragging) {
            const m = marqueeRef.current;
            const dragDist = Math.sqrt((m.sx2 - m.sx1) ** 2 + (m.sy2 - m.sy1) ** 2);

            if (dragDist < 5) {
                // Tiny drag = simple deselect click
                setSelectedId(null);
                setSelectedType(null);
                setSelectedIds([]);
            } else {
                // Convert screen rectangle to world coords for hit detection
                const vp = vpRef.current;
                const w1 = screenToWorld(vp, Math.min(m.sx1, m.sx2), Math.min(m.sy1, m.sy2));
                const w2 = screenToWorld(vp, Math.max(m.sx1, m.sx2), Math.max(m.sy1, m.sy2));
                const minX = Math.min(w1.x, w2.x), maxX = Math.max(w1.x, w2.x);
                const minY = Math.min(w1.y, w2.y), maxY = Math.max(w1.y, w2.y);

                // Collect ALL elements inside the marquee
                const selected = [];

                // Walls: select if ANY endpoint overlaps the marquee (partial selection)
                for (const wall of activeStorey.walls) {
                    const p1 = getPoint(activeStorey, wall.p1);
                    const p2 = getPoint(activeStorey, wall.p2);
                    if (!p1 || !p2) continue;
                    const p1Inside = p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY;
                    const p2Inside = p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY;
                    if (p1Inside || p2Inside) {
                        selected.push({ id: wall.id, type: 'wall' });
                    }
                }

                // Openings on selected walls or inside marquee
                for (const opening of activeStorey.openings) {
                    const openingWallId = opening.wall_id ?? opening.wallId;
                    const wall = activeStorey.walls.find(w => w.id === openingWallId);
                    if (wall && selected.some(s => s.id === wall.id)) {
                        selected.push({ id: opening.id, type: 'opening' });
                    }
                }

                // Furniture: select if its (rotated) bounding box overlaps the marquee
                for (const furn of activeStorey.furniture) {
                    const fb = furnitureBounds(furn);
                    // Check if bounding boxes overlap
                    if (fb.maxX >= minX && fb.minX <= maxX && fb.maxY >= minY && fb.minY <= maxY) {
                        selected.push({ id: furn.id, type: 'furniture' });
                    }
                }

                if (selected.length > 0) {
                    setSelectedId(selected[0].id);
                    setSelectedType(selected[0].type);
                    setSelectedIds(selected);
                } else {
                    setSelectedId(null);
                    setSelectedType(null);
                    setSelectedIds([]);
                }
            }
            marqueeRef.current = null;
            requestRender();
        }
    };

    // Loslassen auch außerhalb der Zeichenfläche (Seitenleiste, Topbar, außerhalb des Fensters) erkennen
    const mouseUpRef = useRef(null);
    mouseUpRef.current = handleMouseUp;
    useEffect(() => {
        const onUp = () => {
            if (isPanningRef.current || dragStartRef.current || marqueeRef.current) mouseUpRef.current?.();
        };
        window.addEventListener('mouseup', onUp);
        window.addEventListener('blur', onUp);
        return () => {
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('blur', onUp);
        };
    }, []);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();

        if (e.ctrlKey) {
            // Ctrl + Wheel = Zoom
            zoomAtPoint(vpRef.current, e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
            setZoomPct(zoomToPercent(vpRef.current.zoom));
        } else {
            // Normal scroll = Pan
            const vp = vpRef.current;
            vp.offsetX -= e.deltaX || (e.shiftKey ? e.deltaY : 0);
            vp.offsetY -= e.shiftKey ? 0 : e.deltaY;
        }
        requestRender();
    }, [requestRender]);

    // ─── Tool Click Handlers ────────────────────────────────────

    // Ausgangsstand für den nächsten Zeichenschritt: noch offener Stand aus dem laufenden Zug oder aktueller Stand
    const pendingBeforeFor = (storey) => {
        const current = snapshotStorey(storey);
        const pd = pendingDrawRef.current;
        // Nur übernehmen, wenn seit dem letzten Zeichenschritt nichts anderes geändert wurde
        if (pd && pd.storeyId === storey.id && current === (pd.last ?? pd.before)) return pd.before;
        return current;
    };

    const handleOuterWallClick = (wx, wy) => {
        const before = pendingBeforeFor(activeStorey);

        // Apply active snap point if available
        let clickX = wx, clickY = wy;
        if (snapPointRef.current) {
            clickX = snapPointRef.current.x;
            clickY = snapPointRef.current.y;
        }

        // Find the real start of the entire wall chain (trace backward through existing walls)
        const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
        let chainStartId = drawPoints.length > 0 ? drawPoints[0] : null;
        if (chainStartId) {
            for (let i = 0; i < outerWalls.length; i++) {
                const prev = outerWalls.find(w => w.p2 === chainStartId || w.p1 === chainStartId);
                if (prev) {
                    const otherEnd = prev.p1 === chainStartId ? prev.p2 : prev.p1;
                    if (!drawPoints.includes(otherEnd)) {
                        chainStartId = otherEnd;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
        const chainStartPt = chainStartId ? getPoint(activeStorey, chainStartId) : null;

        // Check if clicking near chain start → close polygon
        if (drawPoints.length >= 1 && chainStartPt) {
            // Count total walls: existing connected ones + walls from drawPoints
            const totalWalls = outerWalls.length + (drawPoints.length > 0 ? 1 : 0); // +1 for the closing wall
            if (totalWalls >= 3 && dist({ x: clickX, y: clickY }, chainStartPt) < 30 / vpRef.current.zoom) {
                // Close polygon
                const lastPtId = drawPoints[drawPoints.length - 1];

                addOuterWallSegment(activeStorey, lastPtId, chainStartId, outerWallThickness);
                closeOuterWalls(activeStorey);
                computeRooms(activeStorey);
                commitChange('Außenwand schließen', activeStorey, before);
                pendingDrawRef.current = null;

                setDrawPoints([]);
                previewRef.current = null;
                snapPointRef.current = null;
                forceRender(v => v + 1);
                return;
            }
        }

        // If snapping to an existing point, reuse it instead of creating a new one
        let pt;
        let createdPoint = false;
        const existingSnap = snapPointRef.current && snapPointRef.current.id
            ? activeStorey.points.find(p => p.id === snapPointRef.current.id)
            : null;
        if (existingSnap) {
            pt = existingSnap;
        } else {
            const countBefore = activeStorey.points.length;
            pt = addPoint(activeStorey, clickX, clickY);
            createdPoint = activeStorey.points.length > countBefore;
        }

        if (drawPoints.length > 0) {
            const lastPtId = drawPoints[drawPoints.length - 1];
            const lastPt = getPoint(activeStorey, lastPtId);
            // Nur neu angelegte Punkte ausrichten – vorhandene (evtl. geteilte) Punkte nicht verschieben
            if (lastPt && !existingSnap && createdPoint) {
                // Only snap angle if very close to axis alignment (within 2°)
                const dx = pt.x - lastPt.x, dy = pt.y - lastPt.y;
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                const nearAxis = [0, 90, 180, -90, -180].some(a => Math.abs(((angle - a + 180) % 360) - 180) < 2);
                if (nearAxis) {
                    const snapped = snapAngle(lastPt.x, lastPt.y, pt.x, pt.y);
                    pt.x = snapped.x;
                    pt.y = snapped.y;
                }
            }
            const wall = addOuterWallSegment(activeStorey, lastPtId, pt.id, outerWallThickness);
            if (!wall) {
                // too short – gerade angelegten Punkt wieder entfernen (kein verwaistes Snap-Ziel)
                if (createdPoint) activeStorey.points = activeStorey.points.filter(p => p.id !== pt.id);
                requestRender();
                return;
            }
            // Jedes Segment sofort als Undo-Schritt erfassen und automatisch speichern
            const after = commitChange('Außenwand zeichnen', activeStorey, before);
            pendingDrawRef.current = { storeyId: activeStorey.id, before: after || snapshotStorey(activeStorey), last: null };
        } else {
            // Startpunkt: noch kein Undo-Schritt – bei Abbruch (ESC/Rechtsklick) wird er zurückgenommen
            const last = snapshotStorey(activeStorey);
            pendingDrawRef.current = { storeyId: activeStorey.id, before, last: last !== before ? last : null };
        }
        setDrawPoints([...drawPoints, pt.id]);
        forceRender(v => v + 1);
        requestRender(); // Immediate canvas refresh
    };

    const handleInnerWallClick = (wx, wy) => {
        if (!activeStorey.outerClosed) return;
        // Stand vor dem ersten Klick (inkl. evtl. Teilung der Wirtswand) für Undo bzw. Abbruch
        const before = pendingBeforeFor(activeStorey);
        const pointIdsBefore = new Set(activeStorey.points.map(p => p.id));

        // Apply active snap point if available
        let clickX = wx, clickY = wy;
        if (snapPointRef.current) {
            clickX = snapPointRef.current.x;
            clickY = snapPointRef.current.y;
        }

        // If snapping to an existing point, reuse it
        let pt;
        const existingSnap = snapPointRef.current && snapPointRef.current.id
            ? activeStorey.points.find(p => p.id === snapPointRef.current.id)
            : null;
        if (existingSnap) {
            pt = existingSnap;
        } else if (snapPointRef.current && snapPointRef.current.snapWallId) {
            const hostWall = activeStorey.walls.find(w => w.id === snapPointRef.current.snapWallId);
            if (hostWall && hostWall.type === 'outer') {
                // Outer wall: DON'T split; just create an independent point at the projected position
                // Project click position onto the outer wall's center line
                const wPt1 = getPoint(activeStorey, hostWall.p1);
                const wPt2 = getPoint(activeStorey, hostWall.p2);
                if (wPt1 && wPt2) {
                    const dx = wPt2.x - wPt1.x, dy = wPt2.y - wPt1.y;
                    const wLen = Math.sqrt(dx * dx + dy * dy);
                    if (wLen > 1) {
                        const t = Math.max(0, Math.min(1, ((clickX - wPt1.x) * dx + (clickY - wPt1.y) * dy) / (wLen * wLen)));
                        const px = snapToGrid(wPt1.x + t * dx);
                        const py = snapToGrid(wPt1.y + t * dy);
                        // Check if very close to an endpoint — if so, reuse it
                        const d1 = dist({ x: px, y: py }, wPt1);
                        const d2 = dist({ x: px, y: py }, wPt2);
                        if (d1 < 50) {
                            pt = wPt1;
                        } else if (d2 < 50) {
                            pt = wPt2;
                        } else {
                            // Create new independent point (NOT linked to outer wall)
                            const newPt = { id: genId(), x: px, y: py };
                            activeStorey.points.push(newPt);
                            pt = newPt;
                        }
                    } else {
                        pt = addPoint(activeStorey, clickX, clickY);
                    }
                } else {
                    pt = addPoint(activeStorey, clickX, clickY);
                }
            } else {
                // Inner wall: split for T-junction (as before)
                const splitResult = splitWallAtPoint(activeStorey, snapPointRef.current.snapWallId, clickX, clickY);
                if (splitResult) {
                    pt = splitResult;
                } else {
                    if (hostWall) {
                        const ep1 = getPoint(activeStorey, hostWall.p1);
                        const ep2 = getPoint(activeStorey, hostWall.p2);
                        if (ep1 && ep2) {
                            const d1 = dist({ x: clickX, y: clickY }, ep1);
                            const d2 = dist({ x: clickX, y: clickY }, ep2);
                            pt = d1 < d2 ? ep1 : ep2;
                        } else {
                            pt = addPoint(activeStorey, clickX, clickY);
                        }
                    } else {
                        pt = addPoint(activeStorey, clickX, clickY);
                    }
                }
            }
        } else {
            pt = addPoint(activeStorey, clickX, clickY);
        }

        if (drawPoints.length === 0) {
            // If an inner wall was split, recompute outer boundary
            const hostWall = snapPointRef.current && snapPointRef.current.snapWallId
                ? activeStorey.walls.find(w => w.id === snapPointRef.current.snapWallId)
                : null;
            if (hostWall && hostWall.type !== 'outer' && activeStorey.outerClosed) {
                refreshOuterPolygon(activeStorey);
            }
            // Erster Klick ist noch kein Undo-Schritt; bei Abbruch werden Punkt/Teilung zurückgenommen
            const last = snapshotStorey(activeStorey);
            pendingDrawRef.current = { storeyId: activeStorey.id, before, last: last !== before ? last : null };
            setDrawPoints([pt.id]);
            requestRender();
            return;
        }

        const lastPtId = drawPoints[0];
        const lastPt = getPoint(activeStorey, lastPtId);
        if (!lastPt) {
            // Startpunkt existiert nicht mehr (z. B. nach Rückgängig) → Zeichnen sauber abbrechen
            if (snapshotStorey(activeStorey) !== before) { applyStoreySnapshot(activeStorey.id, before); markDirty(); }
            pendingDrawRef.current = null;
            setDrawPoints([]);
            previewRef.current = null;
            snapPointRef.current = null;
            forceRender(v => v + 1);
            requestRender();
            return;
        }
        // Only apply angle snap if NOT snapping to an existing point/wall surface
        // AND only for short-distance alignment (not forced); vorhandene Punkte nie verschieben
        const skipAngleSnap = existingSnap || (snapPointRef.current && snapPointRef.current.snapWallId) || pointIdsBefore.has(pt.id);
        if (lastPt && !skipAngleSnap) {
            // Check if very close to axis alignment (within 2°), only then snap
            const dx = pt.x - lastPt.x, dy = pt.y - lastPt.y;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const nearAxis = [0, 90, 180, -90, -180].some(a => Math.abs(((angle - a + 180) % 360) - 180) < 2);
            if (nearAxis) {
                const snapped = snapAngle(lastPt.x, lastPt.y, pt.x, pt.y);
                pt.x = snapped.x;
                pt.y = snapped.y;
            }
        }

        // Determine side from cursor
        const side = getPointSide(mouseWorldRef.current.x, mouseWorldRef.current.y, lastPt.x, lastPt.y, pt.x, pt.y);

        const wall = addInnerWallSegment(activeStorey, lastPtId, pt.id, innerWallType, innerWallThickness, side);

        if (wall) {
            // Recompute outer boundary in case a wall was split
            // (Match closeOuterWalls: outerPolygon = inner edge, outerBoundary = outer edge)
            refreshOuterPolygon(activeStorey);
            computeRooms(activeStorey);
            // Ein Undo-Schritt inkl. Startpunkt und evtl. geteilter Wirtswände
            commitChange('Innenwand hinzufügen', activeStorey, before);
        } else if (snapshotStorey(activeStorey) !== before) {
            // Wand zu kurz: angelegte Punkte/Teilungen nicht als Waisen zurücklassen
            applyStoreySnapshot(activeStorey.id, before);
            markDirty();
        }
        pendingDrawRef.current = null;

        setDrawPoints([]);
        setActiveTool(TOOLS.SELECT); // Reset to select mode after drawing
        previewRef.current = null;
        snapPointRef.current = null;
        forceRender(v => v + 1);
        // Immediate canvas refresh — don't wait for React re-render cycle
        requestRender();
    };

    const handleOpeningClick = (wx, wy, type) => {
        const hit = findWallAtPoint(activeStorey, wx, wy, 50 / vpRef.current.zoom);
        if (!hit) return;

        const pt1 = getPoint(activeStorey, hit.wall.p1);
        const pt2 = getPoint(activeStorey, hit.wall.p2);
        if (!pt1 || !pt2) return;

        const wallLen = dist(pt1, pt2);
        if (wallLen < 1) return; // degenerierte Wand
        const pos = hit.t * wallLen;

        // Snapshot VOR dem Platzieren, damit Undo die Öffnung wirklich entfernt
        const before = snapshotStorey(activeStorey);
        const preset = nextOpeningPreset[type === 'door' ? 'door' : 'window'];
        const opening = placeOpening(activeStorey, hit.wall.id, type, pos, {
            width_mm: preset.width,
            height_mm: preset.height,
            sill_mm: preset.sill || 0,
        });

        if (opening) {
            commitChange(`${type === 'door' ? 'Tür' : 'Fenster'} platzieren`, activeStorey, before);
            setSelectedId(opening.id);
            setSelectedType('opening');
        }
    };

    const handleFurnitureClick = (wx, wy) => {
        if (!placingFurniture) return;
        const item = placingFurniture;
        // Place with mouse as center of object
        const fx = wx - item.defaultWidth / 2;
        const fy = wy - item.defaultDepth / 2;
        const before = snapshotStorey(activeStorey);
        const furn = placeFurniture(activeStorey, item.id, fx, fy, item.defaultWidth, item.defaultDepth, item.defaultHeight, 0);
        if (furn) {
            commitChange(`${item.name} platzieren`, activeStorey, before);
            setSelectedId(furn.id);
            setSelectedType('furniture');
        }
    };

    const handleDeleteClick = (wx, wy) => {
        const before = snapshotStorey(activeStorey);
        let deletedId = null;

        const furn = findFurnitureAtPoint(activeStorey, wx, wy);
        if (furn) { deleteFurniture(activeStorey, furn.id); deletedId = furn.id; }
        else {
            const opening = findOpeningAtPoint(activeStorey, wx, wy);
            if (opening) { deleteOpening(activeStorey, opening.id); deletedId = opening.id; }
            else {
                const hit = findWallAtPoint(activeStorey, wx, wy, 30 / vpRef.current.zoom);
                if (hit && hit.wall.type !== 'outer') {
                    deleteWall(activeStorey, hit.wall.id);
                    deletedId = hit.wall.id;
                } else if (activeStorey.annotations) {
                    // Check annotations for delete
                    for (let i = activeStorey.annotations.length - 1; i >= 0; i--) {
                        const ann = activeStorey.annotations[i];
                        let hitAnn = false;
                        if (ann.type === 'circle') {
                            const d = dist({ x: wx, y: wy }, { x: ann.cx, y: ann.cy });
                            if (Math.abs(d - ann.radius) < 20 / vpRef.current.zoom || d < ann.radius) hitAnn = true;
                        } else if (ann.type === 'text') {
                            if (dist({ x: wx, y: wy }, { x: ann.x, y: ann.y }) < 50 / vpRef.current.zoom) hitAnn = true;
                        } else if ((ann.type === 'polyline' || ann.type === 'area') && ann.points) {
                            for (let j = 0; j < ann.points.length - 1; j++) {
                                const a = ann.points[j], b = ann.points[j + 1];
                                const dx = b.x - a.x, dy = b.y - a.y;
                                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                                const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / (len * len)));
                                const px = a.x + t * dx, py = a.y + t * dy;
                                if (dist({ x: wx, y: wy }, { x: px, y: py }) < 15 / vpRef.current.zoom) { hitAnn = true; break; }
                            }
                        }
                        if (hitAnn) {
                            deletedId = ann.id;
                            activeStorey.annotations.splice(i, 1);
                            break;
                        }
                    }
                }
            }
        }

        // Nur bei einem echten Treffer: Räume neu berechnen, Undo-Schritt anlegen, speichern
        if (!deletedId) return;
        computeRooms(activeStorey);
        commitChange('Löschen', activeStorey, before);
        if (selectedIdRef.current === deletedId) {
            setSelectedId(null);
            setSelectedType(null);
        }
    };

    // Schwebende Längeneingabe öffnen (seq erzwingt ein frisches Eingabefeld je Wand)
    const openLengthEditor = (info) => {
        lengthEditDoneRef.current = false;
        setEditingLength({ ...info, seq: Date.now() });
    };

    const handleSelectClick = (wx, wy, sx, sy) => {
        // If multi-selected items exist, check if click is on one of them → initiate multi-drag
        if (selectedIds.length > 1) {
            // Check if click is on any of the selected items
            const clickedFurn = findFurnitureAtPoint(activeStorey, wx, wy);
            const clickedWall = findWallAtPoint(activeStorey, wx, wy, 30 / vpRef.current.zoom);

            const isInSelection = (clickedFurn && selectedIds.some(s => s.id === clickedFurn.id)) ||
                (clickedWall && selectedIds.some(s => s.id === clickedWall.wall.id));

            if (isInSelection) {
                // Start multi-drag: save original positions for all selected elements
                const origPositions = {};
                for (const item of selectedIds) {
                    if (item.type === 'furniture') {
                        const f = activeStorey.furniture.find(f => f.id === item.id);
                        if (f) origPositions[item.id] = { x: f.x, y: f.y };
                    } else if (item.type === 'wall') {
                        const w = activeStorey.walls.find(w => w.id === item.id);
                        if (w) {
                            const p1 = getPoint(activeStorey, w.p1);
                            const p2 = getPoint(activeStorey, w.p2);
                            if (p1 && p2) {
                                origPositions[w.p1] = origPositions[w.p1] || { x: p1.x, y: p1.y };
                                origPositions[w.p2] = origPositions[w.p2] || { x: p2.x, y: p2.y };
                            }
                        }
                    }
                }
                dragStartRef.current = {
                    type: 'multi', startX: wx, startY: wy,
                    origPositions, items: selectedIds,
                };
                return;
            }
        }

        // Clear multi-selection on single click
        setSelectedIds([]);
        setSelectedRoomId(null);

        // Check room labels (they render on top, so check first)
        for (const room of activeStorey.rooms) {
            if (room._labelHitBox) {
                const hb = room._labelHitBox;
                if (sx >= hb.x && sx <= hb.x + hb.w && sy >= hb.y && sy <= hb.y + hb.h) {
                    setSelectedId(room.id);
                    setSelectedType('room');
                    setSelectedRoomId(room.id);
                    dragStartRef.current = {
                        type: 'room_label',
                        roomId: room.id,
                        startX: wx, startY: wy,
                        origOffsetX: room.labelOffsetX || 0,
                        origOffsetY: room.labelOffsetY || 0,
                    };
                    requestRender();
                    return;
                }
            }
        }

        // Check furniture
        const furn = findFurnitureAtPoint(activeStorey, wx, wy);
        if (furn) {
            setSelectedId(furn.id);
            setSelectedType('furniture');
            dragStartRef.current = { type: 'furniture', id: furn.id, startX: wx, startY: wy, origX: furn.x, origY: furn.y };
            return;
        }

        // Check openings
        const opening = findOpeningAtPoint(activeStorey, wx, wy);
        if (opening) {
            setSelectedId(opening.id);
            setSelectedType('opening');
            dragStartRef.current = {
                type: 'opening', id: opening.id,
                startX: wx, startY: wy,
                origPosition: opening.position_mm,
            };
            return;
        }

        // Check walls — first check for dimension label click, then CAD handles, then wall body
        const curSelectedId = selectedIdRef.current;
        if (curSelectedId) {
            const selWall = activeStorey.walls.find(w => w.id === curSelectedId);
            if (selWall) {
                const p1 = getPoint(activeStorey, selWall.p1);
                const p2 = getPoint(activeStorey, selWall.p2);
                if (p1 && p2) {
                    // Check dimension label click (midpoint area, offset perpendicular)
                    const s1 = worldToScreen(vpRef.current, p1.x, p1.y);
                    const s2 = worldToScreen(vpRef.current, p2.x, p2.y);
                    const smx = (s1.x + s2.x) / 2;
                    const smy = (s1.y + s2.y) / 2;
                    const sdx = s2.x - s1.x, sdy = s2.y - s1.y;
                    const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
                    const snx = -sdy / slen, sny = sdx / slen;
                    const dimLabelX = smx + snx * 18;
                    const dimLabelY = smy + sny * 18;
                    const dimDist = Math.sqrt((sx - dimLabelX) ** 2 + (sy - dimLabelY) ** 2);
                    if (dimDist < 28) {
                        // Show length editing overlay at this screen position
                        const wLen = dist(p1, p2);
                        const wDx = (p2.x - p1.x) / wLen;
                        const wDy = (p2.y - p1.y) / wLen;
                        openLengthEditor({
                            wallId: selWall.id,
                            value: +(wLen / 1000).toFixed(3),
                            dirX: wDx, dirY: wDy,
                            p1x: p1.x, p1y: p1.y,
                            overlayX: smx + snx * 20 - 45,
                            overlayY: smy + sny * 20 - 16,
                        });
                        return;
                    }

                    const handleRadius = 12 / vpRef.current.zoom; // screen px -> world
                    // Check endpoint handles
                    if (dist({ x: wx, y: wy }, p1) < handleRadius) {
                        dragHandleRef.current = selWall.p1;
                        dragStartRef.current = {
                            type: 'corner', id: selWall.id, pointId: selWall.p1,
                            startX: wx, startY: wy, origX: p1.x, origY: p1.y,
                        };
                        return;
                    }
                    if (dist({ x: wx, y: wy }, p2) < handleRadius) {
                        dragHandleRef.current = selWall.p2;
                        dragStartRef.current = {
                            type: 'corner', id: selWall.id, pointId: selWall.p2,
                            startX: wx, startY: wy, origX: p2.x, origY: p2.y,
                        };
                        return;
                    }
                    // Check midpoint handle (perpendicular move)
                    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                    // (degenerierte Wand ohne Länge: keine Normale berechenbar → kein Senkrecht-Ziehen)
                    if (dist({ x: wx, y: wy }, mid) < handleRadius && dist(p1, p2) >= 1) {
                        const wallLen = dist(p1, p2);
                        const wallDx = (p2.x - p1.x) / wallLen;
                        const wallDy = (p2.y - p1.y) / wallLen;
                        // Normal perpendicular to wall
                        const nx = -wallDy;
                        const ny = wallDx;
                        dragHandleRef.current = 'mid';
                        dragStartRef.current = {
                            type: 'wall_perp', id: selWall.id,
                            startX: wx, startY: wy,
                            origP1: { x: p1.x, y: p1.y },
                            origP2: { x: p2.x, y: p2.y },
                            p1Id: selWall.p1, p2Id: selWall.p2,
                            nx, ny,
                        };
                        return;
                    }
                }
            }
        }

        // Check dimension label click on ANY wall (not just selected)
        for (const wall of activeStorey.walls) {
            const wp1 = getPoint(activeStorey, wall.p1);
            const wp2 = getPoint(activeStorey, wall.p2);
            if (!wp1 || !wp2 || dist(wp1, wp2) < 200) continue;
            const ws1 = worldToScreen(vpRef.current, wp1.x, wp1.y);
            const ws2 = worldToScreen(vpRef.current, wp2.x, wp2.y);
            const wmx = (ws1.x + ws2.x) / 2;
            const wmy = (ws1.y + ws2.y) / 2;
            const wdx = ws2.x - ws1.x, wdy = ws2.y - ws1.y;
            const wlen = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
            const wnx = -wdy / wlen, wny = wdx / wlen;
            const dlx = wmx + wnx * 18;
            const dly = wmy + wny * 18;
            const dd = Math.sqrt((sx - dlx) ** 2 + (sy - dly) ** 2);
            if (dd < 28) {
                setSelectedId(wall.id);
                setSelectedType('wall');
                const wLen = dist(wp1, wp2);
                const wDirX = (wp2.x - wp1.x) / wLen;
                const wDirY = (wp2.y - wp1.y) / wLen;
                openLengthEditor({
                    wallId: wall.id,
                    value: +(wLen / 1000).toFixed(3),
                    dirX: wDirX, dirY: wDirY,
                    p1x: wp1.x, p1y: wp1.y,
                    overlayX: wmx + wnx * 20 - 45,
                    overlayY: wmy + wny * 20 - 16,
                });
                return;
            }
        }

        // Check walls (body click = select + drag)
        const hit = findWallAtPoint(activeStorey, wx, wy, 30 / vpRef.current.zoom);
        if (hit) {
            setSelectedId(hit.wall.id);
            setSelectedType('wall');
            const w = hit.wall;
            const p1 = getPoint(activeStorey, w.p1);
            const p2 = getPoint(activeStorey, w.p2);
            if (p1 && p2) {
                // Gemeinsame Eckpunkte bleiben verbunden: angeschlossene Wände werden beim Ziehen mitgeführt.
                // (Der frühere "Duplizieren"-Versuch war wirkungslos, da addPoint den vorhandenen Punkt
                // zurückgibt, und konnte die Wand still auf einen deckungsgleichen Punkt umhängen.)
                dragStartRef.current = {
                    type: 'wall_body', id: w.id,
                    startX: wx, startY: wy,
                    origP1: { x: p1.x, y: p1.y },
                    origP2: { x: p2.x, y: p2.y },
                    p1Id: w.p1, p2Id: w.p2,
                };
            }
            return;
        }

        // Check annotations — first check handles on currently selected annotation
        // (Anmerkungen und Decken liegen über den Räumen und werden daher vor dem Raum geprüft)
        const curSelAnn = (selectedType === 'annotation' && activeStorey.annotations)
            ? activeStorey.annotations.find(a => a.id === selectedIdRef.current) : null;
        if (curSelAnn) {
            const handleRad = 10 / vpRef.current.zoom;
            // Polyline/Area point handles
            if ((curSelAnn.type === 'polyline' || curSelAnn.type === 'area') && curSelAnn.points) {
                for (let pi = 0; pi < curSelAnn.points.length; pi++) {
                    const pt = curSelAnn.points[pi];
                    if (dist({ x: wx, y: wy }, pt) < handleRad) {
                        dragStartRef.current = {
                            type: 'annotation_point', annId: curSelAnn.id,
                            pointIdx: pi, startX: wx, startY: wy,
                            origX: pt.x, origY: pt.y,
                        };
                        return;
                    }
                }
            }
            // Circle radius handle (right edge)
            if (curSelAnn.type === 'circle') {
                const edgePt = { x: curSelAnn.cx + curSelAnn.radius, y: curSelAnn.cy };
                if (dist({ x: wx, y: wy }, edgePt) < handleRad) {
                    dragStartRef.current = {
                        type: 'annotation_resize_circle', annId: curSelAnn.id,
                        startX: wx, startY: wy, origRadius: curSelAnn.radius,
                    };
                    return;
                }
            }
        }

        // Check annotations body click
        if (activeStorey.annotations) {
            for (let i = activeStorey.annotations.length - 1; i >= 0; i--) {
                const ann = activeStorey.annotations[i];
                let hitAnn = false;
                if (ann.type === 'text' && ann._hitBox) {
                    const hb = ann._hitBox;
                    if (sx >= hb.sx && sx <= hb.sx + hb.sw && sy >= hb.sy && sy <= hb.sy + hb.sh) hitAnn = true;
                } else if (ann.type === 'circle') {
                    const d = dist({ x: wx, y: wy }, { x: ann.cx, y: ann.cy });
                    if (Math.abs(d - ann.radius) < 20 / vpRef.current.zoom || d < ann.radius) hitAnn = true;
                } else if ((ann.type === 'polyline' || ann.type === 'area') && ann.points && ann.points.length >= 2) {
                    // Check proximity to any line segment
                    for (let j = 0; j < ann.points.length - 1; j++) {
                        const a = ann.points[j], b = ann.points[j + 1];
                        const dx = b.x - a.x, dy = b.y - a.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / (len * len)));
                        const px = a.x + t * dx, py = a.y + t * dy;
                        if (dist({ x: wx, y: wy }, { x: px, y: py }) < 15 / vpRef.current.zoom) { hitAnn = true; break; }
                    }
                    if (!hitAnn && ann.type === 'area') {
                        // Also check inside polygon
                        let inside = false;
                        const poly = ann.points;
                        for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
                            if (((poly[j].y > wy) !== (poly[k].y > wy)) &&
                                (wx < (poly[k].x - poly[j].x) * (wy - poly[j].y) / (poly[k].y - poly[j].y) + poly[j].x)) {
                                inside = !inside;
                            }
                        }
                        if (inside) hitAnn = true;
                    }
                }
                if (hitAnn) {
                    setSelectedId(ann.id);
                    setSelectedType('annotation');
                    // Start drag for annotation repositioning
                    if (ann.type === 'text') {
                        dragStartRef.current = {
                            type: 'annotation_drag', annId: ann.id, annType: 'text',
                            startX: wx, startY: wy, origX: ann.x, origY: ann.y,
                        };
                    } else if (ann.type === 'circle') {
                        dragStartRef.current = {
                            type: 'annotation_drag', annId: ann.id, annType: 'circle',
                            startX: wx, startY: wy, origCx: ann.cx, origCy: ann.cy,
                        };
                    } else if (ann.type === 'polyline' || ann.type === 'area') {
                        dragStartRef.current = {
                            type: 'annotation_drag', annId: ann.id, annType: ann.type,
                            startX: wx, startY: wy,
                            origPoints: ann.points.map(p => ({ x: p.x, y: p.y })),
                        };
                    }
                    requestRender();
                    return;
                }
            }
        }

        // Check slabs — first check corner handles on selected slab, then body
        const curSelSlab = selectedType === 'slab' ? (activeStorey.slabs || []).find(s => s.id === selectedIdRef.current) : null;
        if (curSelSlab && curSelSlab.polygon) {
            const handleRadius = 10 / vpRef.current.zoom;
            // Check corner handles
            for (let i = 0; i < curSelSlab.polygon.length; i++) {
                const pt = curSelSlab.polygon[i];
                if (dist({ x: wx, y: wy }, pt) < handleRadius) {
                    dragStartRef.current = {
                        type: 'slab_corner', slabId: curSelSlab.id, cornerIdx: i,
                        startX: wx, startY: wy, origX: pt.x, origY: pt.y,
                    };
                    return;
                }
            }
            // Check midpoint handles (insert new point)
            for (let i = 0; i < curSelSlab.polygon.length; i++) {
                const a = curSelSlab.polygon[i];
                const b = curSelSlab.polygon[(i + 1) % curSelSlab.polygon.length];
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                if (dist({ x: wx, y: wy }, { x: mx, y: my }) < handleRadius) {
                    // Insert new point at midpoint (Erfassung/Speichern beim Loslassen in handleMouseUp)
                    curSelSlab.polygon.splice(i + 1, 0, { x: mx, y: my });
                    // Start dragging the new point
                    dragStartRef.current = {
                        type: 'slab_corner', slabId: curSelSlab.id, cornerIdx: i + 1,
                        startX: mx, startY: my, origX: mx, origY: my,
                    };
                    requestRender();
                    return;
                }
            }
        }
        for (const slab of (activeStorey.slabs || [])) {
            if (slab.polygon && slab.polygon.length >= 3) {
                let inside = false;
                const poly = slab.polygon;
                for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                    const xi = poly[i].x, yi = poly[i].y;
                    const xj = poly[j].x, yj = poly[j].y;
                    if (((yi > wy) !== (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi) + xi)) {
                        inside = !inside;
                    }
                }
                if (inside) {
                    setSelectedId(slab.id);
                    setSelectedType('slab');
                    return;
                }
            }
        }

        // Check rooms (letzter Treffer-Fallback; Räume sind zusätzlich über ihre Beschriftung wählbar)
        const room = findRoomAtPoint(activeStorey, wx, wy);
        if (room) {
            setSelectedId(room.id);
            setSelectedType('room');
            return;
        }

        // Start marquee selection (deselect happens on mouseUp if no drag)
        setEditingLength(null);
        marqueeRef.current = {
            dragging: true,
            sx1: sx, sy1: sy,
            sx2: sx, sy2: sy,
            wx1: wx, wy1: wy,
        };
    };

    // ─── Measure Tool ───────────────────────────────────────────
    const handleMeasureClick = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(vpRef.current, sx, sy);
        const wx = snapToGrid(world.x);
        const wy = snapToGrid(world.y);

        if (measurePoints.length === 0) {
            setMeasurePoints([{ x: wx, y: wy }]);
            setMeasureResult(null);
            // Show preview line on next move
            previewRef.current = { type: 'measure_start', x: wx, y: wy };
            requestRender();
        } else {
            const p1 = measurePoints[0];
            const d = dist(p1, { x: wx, y: wy });
            setMeasureResult(Math.round(d));
            // Show dimension line
            previewRef.current = {
                type: 'wall_segment',
                x1: p1.x, y1: p1.y,
                x2: wx, y2: wy,
                wallType: 'measure',
            };
            requestRender();
            setMeasurePoints([]);
        }
    }, [measurePoints, requestRender]);

    // ─── Delete selected element (by type) ───────────────────────
    const handleDeleteSelected = useCallback(() => {
        const itemsToDelete = selectedIds.length > 0 ? selectedIds : (selectedId ? [{ id: selectedId, type: selectedType }] : []);
        if (itemsToDelete.length === 0) return;

        const before = snapshotStorey(activeStorey);
        let deleted = false;

        for (const item of itemsToDelete) {
            if (item.type === 'furniture') {
                if (activeStorey.furniture.find(f => f.id === item.id)) {
                    deleteFurniture(activeStorey, item.id);
                    deleted = true;
                }
            } else if (item.type === 'opening') {
                if (activeStorey.openings.find(o => o.id === item.id)) {
                    deleteOpening(activeStorey, item.id);
                    deleted = true;
                }
            } else if (item.type === 'wall') {
                const wall = activeStorey.walls.find(w => w.id === item.id);
                if (wall) {
                    if (wall.type === 'outer' && activeStorey.outerClosed) {
                        activeStorey.outerClosed = false;
                        activeStorey.outerPolygon = null;
                        activeStorey.outerBoundary = null;
                    }
                    deleteWall(activeStorey, item.id);
                    deleted = true;
                }
            } else if (item.type === 'slab') {
                activeStorey.slabs = (activeStorey.slabs || []).filter(s => s.id !== item.id);
                deleted = true;
            } else if (item.type === 'annotation') {
                activeStorey.annotations = (activeStorey.annotations || []).filter(a => a.id !== item.id);
                deleted = true;
            }
        }

        if (deleted) {
            computeRooms(activeStorey);
            commitChange('Löschen', activeStorey, before);
            setSelectedId(null);
            setSelectedType(null);
            setSelectedIds([]);
        }
    }, [selectedId, selectedType, selectedIds, activeStorey, commitChange]);

    // ─── Keyboard ───────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            const key = String(e.key || '').toLowerCase();
            const inField = isEditableTarget(e.target);

            // Strg/Cmd+S speichert immer – vorher eine laufende Feldeingabe übernehmen
            if (mod && key === 's') {
                e.preventDefault();
                if (inField && typeof e.target.blur === 'function') e.target.blur();
                handleSave(false);
                return;
            }

            if (e.key === 'Escape') {
                cancelDrawing();
                setMeasurePoints([]);
                setMeasureResult(null);
                setPlacingFurniture(null);
                setShowExportMenu(false);
                setShowStoreyDialog(false);
                setSlabContextMenu(null);
                // Finalize active annotation (polyline/area)
                setActiveAnnotationId(null);
                setAnnotationPoints([]);
                setAnnotationCircleCenter(null);
                setActiveTool(TOOLS.SELECT);
                setSelectedIds([]);
                setSelectedRoomId(null);
                requestRender();
                return;
            }

            // Alle weiteren Kürzel nicht in Eingabefeldern (Entf, Strg+Z/C/V gehören dort dem Feld)
            if (inField) return;

            if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
            if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); return; }
            if (e.key === 'Delete' && (selectedId || selectedIds.length > 0)) {
                e.preventDefault();
                handleDeleteSelected();
                return;
            }

            // ── Copy (Ctrl+C) ────────────────────────────────────
            if (mod && key === 'c' && selectedId && activeStorey) {
                let copied = null;
                if (selectedType === 'annotation') {
                    const ann = (activeStorey.annotations || []).find(a => a.id === selectedId);
                    if (ann) copied = { type: 'annotation', data: JSON.parse(JSON.stringify(ann, snapshotReplacer)) };
                } else if (selectedType === 'furniture') {
                    const furn = (activeStorey.furniture || []).find(f => f.id === selectedId);
                    if (furn) copied = { type: 'furniture', data: JSON.parse(JSON.stringify(furn)) };
                } else if (selectedType === 'opening') {
                    const op = (activeStorey.openings || []).find(o => o.id === selectedId);
                    if (op) copied = { type: 'opening', data: JSON.parse(JSON.stringify(op)) };
                } else if (selectedType === 'slab') {
                    const slab = (activeStorey.slabs || []).find(s => s.id === selectedId);
                    if (slab) copied = { type: 'slab', data: JSON.parse(JSON.stringify(slab)) };
                }
                if (copied) {
                    e.preventDefault();
                    clipboardRef.current = copied;
                }
                return;
            }

            // ── Paste (Ctrl+V) – als ein Undo-Schritt ──────────────
            if (mod && key === 'v' && clipboardRef.current && activeStorey) {
                e.preventDefault();
                const cb = clipboardRef.current;
                const offset = 50; // offset pasted element slightly
                let pasted = null;

                applyChange('Einfügen', st => {
                    if (cb.type === 'annotation') {
                        if (!st.annotations) st.annotations = [];
                        const copy = JSON.parse(JSON.stringify(cb.data));
                        copy.id = 'ann_' + genId();
                        // Offset the pasted element
                        if (copy.type === 'polyline' || copy.type === 'area') {
                            copy.points = (copy.points || []).map(p => ({ x: p.x + offset, y: p.y + offset }));
                        } else if (copy.type === 'circle') {
                            copy.cx += offset; copy.cy += offset;
                        } else if (copy.type === 'text') {
                            copy.x += offset; copy.y += offset;
                        }
                        delete copy._hitBox;
                        st.annotations.push(copy);
                        pasted = { id: copy.id, type: 'annotation' };
                    } else if (cb.type === 'furniture') {
                        if (!st.furniture) st.furniture = [];
                        const copy = JSON.parse(JSON.stringify(cb.data));
                        copy.id = 'furn_' + genId();
                        copy.x += offset; copy.y += offset;
                        st.furniture.push(copy);
                        pasted = { id: copy.id, type: 'furniture' };
                    } else if (cb.type === 'slab') {
                        if (!st.slabs) st.slabs = [];
                        const copy = JSON.parse(JSON.stringify(cb.data));
                        copy.id = 'slab_' + genId();
                        copy.polygon = (copy.polygon || []).map(p => ({ x: p.x + offset, y: p.y + offset }));
                        st.slabs.push(copy);
                        pasted = { id: copy.id, type: 'slab' };
                    } else if (cb.type === 'opening') {
                        // Öffnung versetzt auf derselben Wand einfügen (rechts daneben, sonst links)
                        const src = cb.data;
                        const hostId = src.wall_id ?? src.wallId;
                        if (st.walls.some(w => w.id === hostId)) {
                            const gap = (src.width_mm || 0) + 100;
                            for (const pos of [src.position_mm + gap, src.position_mm - gap]) {
                                const op = placeOpening(st, hostId, src.type, pos, {
                                    width_mm: src.width_mm, height_mm: src.height_mm, sill_mm: src.sill_mm,
                                    swing: src.swing, direction: src.direction,
                                });
                                if (op) { pasted = { id: op.id, type: 'opening' }; break; }
                            }
                        }
                    }
                });
                if (pasted) {
                    setSelectedId(pasted.id);
                    setSelectedType(pasted.type);
                    setSelectedIds([]);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, selectedId, selectedIds, selectedType, activeStorey, handleDeleteSelected, requestRender, handleUndo, handleRedo, cancelDrawing, applyChange]);

    // ─── Canvas event attachment ────────────────────────────────
    // Auch nach 3D→2D-Wechsel und nach dem Laden neu am (neu erzeugten) Canvas registrieren
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        const preventContext = (e) => e.preventDefault();
        canvas.addEventListener('contextmenu', preventContext);
        return () => {
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('contextmenu', preventContext);
        };
    }, [handleWheel, viewMode, loading, loadError]);

    const [showStoreyDialog, setShowStoreyDialog] = useState(false);

    const addStoreyAt = (position) => {
        cancelDrawing();
        const current = storeysRef.current;
        const usedLabels = current.map(s => s.label);
        const nextLabel = STOREY_LABELS.find(l => !usedLabels.includes(l)) || `${current.length + 1}. OG`;
        const newStorey = createStorey(nextLabel, STOREY_HEIGHT.default);
        const insertIdx = position === 'above' ? activeStoreyIdx + 1 : activeStoreyIdx;
        const newStoreys = [...current];
        newStoreys.splice(insertIdx, 0, newStorey);
        pushStoreysHistory('Geschoss hinzufügen', current, newStoreys, activeStoreyIdx, insertIdx);
        commitStoreys(newStoreys, insertIdx);
        setSelectedId(null);
        setSelectedType(null);
        setSelectedIds([]);
        setShowStoreyDialog(false);
        markDirty();
    };

    const duplicateCurrentStorey = () => {
        cancelDrawing();
        const current = storeysRef.current;
        const dupe = duplicateStorey(activeStorey, `${activeStorey.label} (Kopie)`);
        const newStoreys = [...current, dupe];
        pushStoreysHistory('Geschoss duplizieren', current, newStoreys, activeStoreyIdx, current.length);
        commitStoreys(newStoreys, current.length);
        setSelectedId(null);
        setSelectedType(null);
        setSelectedIds([]);
        markDirty();
    };

    const deleteCurrentStorey = () => {
        const current = storeysRef.current;
        if (current.length <= 1) return; // mindestens 1 Geschoss behalten
        const idx = activeStoreyIdx;
        const storey = current[idx];
        if (!storey) return;
        const parts = [
            storey.walls?.length ? `${storey.walls.length} Wände` : null,
            storey.openings?.length ? `${storey.openings.length} Öffnungen` : null,
            storey.furniture?.length ? `${storey.furniture.length} Möbel` : null,
            storey.annotations?.length ? `${storey.annotations.length} Anmerkungen` : null,
        ].filter(Boolean);
        const contents = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        if (!window.confirm(`Geschoss „${storey.label}“${contents} wirklich entfernen?\n\nDas Entfernen kann mit „Rückgängig“ (Strg+Z) zurückgenommen werden.`)) return;
        cancelDrawing();
        const newStoreys = current.filter((_, i) => i !== idx);
        const nextIdx = Math.max(0, idx - 1);
        pushStoreysHistory(`Geschoss „${storey.label}“ entfernen`, current, newStoreys, idx, nextIdx);
        commitStoreys(newStoreys, nextIdx);
        setSelectedId(null);
        setSelectedType(null);
        setSelectedIds([]);
        setSelectedRoomId(null);
        setEditingLength(null);
        markDirty();
    };

    // Zurück zur Übersicht: ausstehende Änderungen vorher speichern
    const handleBack = async () => {
        if (document.activeElement && isEditableTarget(document.activeElement)) document.activeElement.blur();
        let ok = true;
        for (let i = 0; i < 3 && (isDirtyRef.current || saveInFlightRef.current); i++) {
            ok = await handleSave(true);
            if (!ok) break;
        }
        if ((!ok || isDirtyRef.current) && loadedOkRef.current) {
            const leave = window.confirm('Die letzten Änderungen konnten nicht gespeichert werden.\n\nTrotzdem zur Übersicht wechseln? Nicht gespeicherte Änderungen gehen dann verloren.');
            if (!leave) return;
        }
        navigate('/renovation?tab=floorplan');
    };

    // Exporte mit Fehlerbehandlung
    const runExport = async (fn) => {
        setShowExportMenu(false);
        try {
            await fn();
        } catch (err) {
            console.error('Export fehlgeschlagen:', err);
            alert('Export fehlgeschlagen: ' + (err?.message || err));
        }
    };

    const toggleViewMode = () => {
        if (viewMode === '2d') {
            if (!isWebGLAvailable()) {
                setViewNotice('Die 3D-Ansicht benötigt WebGL, das in diesem Browser bzw. auf diesem Gerät nicht verfügbar ist.');
                return;
            }
            setViewNotice(null);
            setViewMode('3d');
        } else {
            setViewMode('2d');
        }
    };

    // Dachparameter: neues roof-Objekt erzeugen (damit auch die 3D-Ansicht die Änderung erkennt)
    const setRoofParam = (key, value) => {
        if (!Number.isFinite(value)) return;
        applyChange('Dach ändern', st => { if (st.roof) st.roof = { ...st.roof, [key]: value }; });
    };

    const handle3DError = useCallback((error) => {
        setViewMode('2d');
        setViewNotice(`Die 3D-Ansicht konnte nicht angezeigt werden${error?.message ? ` (${error.message})` : ''}. Es wird wieder die 2D-Ansicht gezeigt.`);
    }, []);

    // ─── Selected Element Details ───────────────────────────────
    const selectedWall = selectedType === 'wall' ? activeStorey.walls.find(w => w.id === selectedId) : null;
    const selectedOpening = selectedType === 'opening' ? activeStorey.openings.find(o => o.id === selectedId) : null;
    const selectedFurniture = selectedType === 'furniture' ? activeStorey.furniture.find(f => f.id === selectedId) : null;
    const selectedRoom = selectedType === 'room' ? activeStorey.rooms.find(r => r.id === selectedId) : null;
    const selectedSlab = selectedType === 'slab' ? (activeStorey.slabs || []).find(s => s.id === selectedId) : null;

    // ─── Render ─────────────────────────────────────────────────
    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    // Laden fehlgeschlagen: Editor sperren, damit kein leerer Stand über den echten Plan gespeichert wird
    if (loadError) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 16px' }}>
                <div style={{
                    maxWidth: '460px', width: '100%', background: 'var(--surface-color)',
                    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
                    padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: '#dc2626', fontWeight: 700 }}>
                        <AlertTriangle size={18} /> Grundriss nicht geladen
                    </div>
                    <p style={{ margin: '0 0 18px', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{loadError}</p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button onClick={() => setLoadAttempt(a => a + 1)} style={{ ...topBtnStyle, color: '#0ea5e9', fontWeight: 600, gap: '6px' }}>
                            <RefreshCw size={14} /> Erneut laden
                        </button>
                        <button onClick={() => navigate('/renovation?tab=floorplan')} style={{ ...topBtnStyle, gap: '6px' }}>
                            <ArrowLeft size={14} /> Zur Übersicht
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const saveStatusInfo = {
        dirty: { text: 'Nicht gespeichert', color: 'var(--text-secondary)' },
        saving: { text: 'Speichert …', color: '#0ea5e9' },
        saved: { text: 'Gespeichert', color: '#16a34a' },
        error: { text: 'Speichern fehlgeschlagen', color: '#dc2626' },
    }[saveState];

    return (
        <div ref={editorContainerRef} style={{ display: 'flex', flexDirection: 'column', height: isFullscreen ? '100vh' : 'calc(100vh - 64px)', overflow: 'hidden', position: 'relative', background: 'var(--bg-color, #fff)' }}>
            {/* ─── Topbar ──────────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px',
                borderBottom: '1px solid var(--border-color)', background: 'var(--surface-color)',
                flexWrap: 'wrap', minHeight: '48px',
            }}>
                <button onClick={handleBack} style={topBtnStyle} title="Zur Übersicht">
                    <ArrowLeft size={16} />
                </button>

                <input
                    type="text"
                    value={planName}
                    onChange={e => setPlanName(e.target.value)}
                    onBlur={() => { if (planNameFocusRef.current !== planName) markDirty(); }}
                    style={{
                        border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px', fontSize: '0.95rem', fontWeight: 600,
                        background: 'transparent', minWidth: '120px', maxWidth: '300px',
                    }}
                    onFocus={e => { planNameFocusRef.current = planName; e.target.style.borderColor = 'var(--border-color)'; }}
                />

                {saveStatusInfo && (
                    <span
                        title={saveState === 'error' && saveError ? saveError : undefined}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: saveStatusInfo.color, whiteSpace: 'nowrap' }}
                    >
                        {saveState === 'saved' && <Check size={13} />}
                        {saveState === 'error' && <AlertTriangle size={13} />}
                        {!isMobile && saveStatusInfo.text}
                    </span>
                )}

                <div style={{ flex: 1 }} />

                {/* Storey selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <select
                        value={activeStoreyIdx}
                        onChange={e => { cancelDrawing(); setActiveStoreyIdx(Number(e.target.value)); setSelectedIds([]); }}
                        style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.82rem', background: 'var(--surface-color)' }}
                    >
                        {storeys.map((s, i) => (
                            <option key={s.id} value={i}>{s.label}</option>
                        ))}
                    </select>
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowStoreyDialog(!showStoreyDialog)} title="Geschoss hinzufügen" style={topBtnStyle}><Plus size={14} /></button>
                        {showStoreyDialog && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                zIndex: 100, overflow: 'hidden', minWidth: '170px',
                            }}>
                                <button
                                    onClick={() => addStoreyAt('above')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-color, #f1f5f9)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    Darüber einfügen
                                </button>
                                <button
                                    onClick={() => addStoreyAt('below')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-color, #f1f5f9)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    Darunter einfügen
                                </button>
                            </div>
                        )}
                    </div>
                    <button onClick={duplicateCurrentStorey} title="Geschoss duplizieren" style={topBtnStyle}><Copy size={14} /></button>
                    <button
                        onClick={deleteCurrentStorey}
                        disabled={storeys.length <= 1}
                        title="Geschoss entfernen"
                        style={{ ...topBtnStyle, color: storeys.length > 1 ? '#ef4444' : '#d1d5db', opacity: storeys.length <= 1 ? 0.4 : 1 }}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>

                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />

                <button onClick={handleUndo} disabled={!cmdStackRef.current.canUndo() && drawPoints.length === 0} style={topBtnStyle} title="Rückgängig (Strg+Z)">
                    <Undo2 size={16} />
                </button>
                <button onClick={handleRedo} disabled={!cmdStackRef.current.canRedo()} style={topBtnStyle} title="Wiederholen (Strg+Y / Strg+Umschalt+Z)">
                    <Redo2 size={16} />
                </button>
                <button onClick={() => handleSave(false)} disabled={saving} style={{ ...topBtnStyle, color: '#0ea5e9', fontWeight: 600 }} title="Speichern (Strg+S)">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Speichern</span>}
                </button>

                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />

                {/* ── Background Image Controls ── */}
                <input
                    ref={bgFileRef}
                    type="file"
                    accept="image/*,.pdf"
                    style={{ display: 'none' }}
                    onChange={handleBgUpload}
                />
                <button
                    onClick={() => bgFileRef.current?.click()}
                    disabled={bgUploading}
                    style={topBtnStyle}
                    title={bgUploading ? 'Hintergrundbild wird hochgeladen …' : 'Hintergrundbild hochladen (PNG/JPG)'}
                >
                    {bgUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Hintergrund</span>}
                </button>

                {bgImage && (
                    <>
                        <button
                            onClick={() => updateBgImage({ visible: bgImage.visible === false })}
                            style={{ ...topBtnStyle, color: bgImage.visible !== false ? '#0ea5e9' : 'var(--text-secondary)' }}
                            title={bgImage.visible !== false ? 'Hintergrund ausblenden' : 'Hintergrund einblenden'}
                        >
                            {bgImage.visible !== false ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <input
                            type="range"
                            min="5" max="90" step="5"
                            value={(bgImage.opacity || 0.35) * 100}
                            onChange={e => updateBgImage({ opacity: Number(e.target.value) / 100 })}
                            title={`Transparenz: ${Math.round((bgImage.opacity || 0.35) * 100)}%`}
                            style={{ width: '60px', accentColor: '#0ea5e9' }}
                        />
                        <button
                            onClick={() => {
                                cancelDrawing();
                                setActiveTool(TOOLS.CALIBRATE);
                                setCalibPoints([]);
                            }}
                            style={{ ...topBtnStyle, color: activeTool === TOOLS.CALIBRATE ? '#ef4444' : 'var(--text-secondary)', background: activeTool === TOOLS.CALIBRATE ? '#fef2f2' : 'transparent' }}
                            title="Referenzmaß setzen (2 Punkte klicken, Strecke eingeben)"
                        >
                            <Scaling size={16} />
                            {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Maßstab</span>}
                        </button>
                        <button onClick={removeBgImage} style={{ ...topBtnStyle, color: '#ef4444' }} title="Hintergrund entfernen">
                            <X size={14} />
                        </button>
                    </>
                )}

                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />

                {/* Bemaßung toggle */}
                <button
                    onClick={() => { setShowDimensions(v => !v); requestRender(); }}
                    style={{ ...topBtnStyle, background: showDimensions ? '#e0f2fe' : 'var(--surface-color)', color: showDimensions ? '#0ea5e9' : 'var(--text-secondary)' }}
                    title={showDimensions ? 'Bemaßung ausblenden' : 'Bemaßung einblenden'}
                >
                    <Ruler size={16} />
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Maße</span>}
                </button>

                {/* 2D/3D toggle */}
                <button
                    onClick={toggleViewMode}
                    style={{ ...topBtnStyle, background: viewMode === '3d' ? '#e0f2fe' : 'var(--surface-color)', color: viewMode === '3d' ? '#0ea5e9' : 'var(--text-secondary)' }}
                    title={viewMode === '2d' ? '3D-Ansicht' : '2D-Ansicht'}
                >
                    <Box size={16} />
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>{viewMode === '2d' ? '3D' : '2D'}</span>}
                </button>

                {/* Export dropdown */}
                <button
                    onClick={toggleFullscreen}
                    style={topBtnStyle}
                    title={isFullscreen ? 'Vollbild beenden' : 'Vollbild'}
                >
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>{isFullscreen ? 'Beenden' : 'Vollbild'}</span>}
                </button>

                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        style={topBtnStyle}
                        title="Exportieren"
                    >
                        <Download size={16} />
                        {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Export</span>}
                        <ChevronDown size={12} />
                    </button>
                    {showExportMenu && (
                        <div style={{
                            position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                            background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            minWidth: '200px', zIndex: 100, overflow: 'hidden',
                        }}>
                            <ExportMenuItem
                                icon={Image} label="Als PNG exportieren" sublabel="Hochauflösendes Bild"
                                onClick={() => runExport(async () => {
                                    const blob = await exportToPNG(activeStorey, planName);
                                    if (!blob) throw new Error('Das Bild konnte nicht erzeugt werden (Zeichenfläche zu groß?).');
                                    downloadBlob(blob, `${sanitizeFileName(`${planName}_${activeStorey.label}`)}.png`);
                                })}
                            />
                            <ExportMenuItem
                                icon={FileText} label="Als PDF exportieren" sublabel="Alle Geschosse"
                                onClick={() => runExport(() => exportToPDF(storeys, planName))}
                            />
                            <div style={{ height: '1px', background: 'var(--border-color)' }} />
                            <ExportMenuItem
                                icon={FileSpreadsheet} label="Massenermittlung CSV" sublabel="Für Excel"
                                onClick={() => runExport(() => exportQuantityListCSV(storeys, planName))}
                            />
                            <ExportMenuItem
                                icon={FileText} label="Massenermittlung PDF" sublabel="Druckfertig"
                                onClick={() => runExport(() => exportQuantityListPDF(storeys, planName))}
                            />
                        </div>
                    )}
                </div>

                <button
                    onClick={() => {
                        const canvas = canvasRef.current;
                        if (!canvas) return;
                        const { w, h } = canvasSizeRef.current;
                        zoomToFit(vpRef.current, activeStorey, w || canvas.clientWidth, h || canvas.clientHeight);
                        setZoomPct(zoomToPercent(vpRef.current.zoom));
                        requestRender();
                    }}
                    style={topBtnStyle}
                    title="Grundriss einpassen (Zoom auf alles)"
                >
                    <Search size={16} />
                </button>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'center' }}>
                    {zoomPct}%
                </div>
            </div>

            {/* ── Hinweise: Speicherfehler / 3D nicht verfügbar ── */}
            {saveState === 'error' && (
                <div role="alert" style={{
                    display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                    padding: '8px 16px', background: '#fef2f2', borderBottom: '1px solid #fecaca',
                    color: '#991b1b', fontSize: '0.8rem',
                }}>
                    <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: '200px' }}>
                        <strong>Änderungen nicht gespeichert.</strong> {saveError || 'Unbekannter Fehler.'}
                    </span>
                    <button onClick={() => handleSave(false)} disabled={saving} style={{ ...topBtnStyle, color: '#dc2626', borderColor: '#fecaca', gap: '6px', fontSize: '0.78rem' }}>
                        <RefreshCw size={13} /> Erneut speichern
                    </button>
                </div>
            )}
            {viewNotice && (
                <div role="status" style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a',
                    color: '#92400e', fontSize: '0.8rem',
                }}>
                    <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{viewNotice}</span>
                    <button onClick={() => setViewNotice(null)} style={{ ...topBtnStyle, padding: '4px 6px' }} title="Hinweis schließen">
                        <X size={13} />
                    </button>
                </div>
            )}

            {/* ── Calibration Dialog ── */}
            {showCalibDialog && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
                }} onClick={() => { setShowCalibDialog(false); setCalibPoints([]); setActiveTool(TOOLS.SELECT); }}>
                    <div style={{
                        background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                        padding: '24px', minWidth: '320px', boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem' }}>Referenzmaß eingeben</h3>
                        <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            Geben Sie die reale Länge der markierten Strecke ein:
                        </p>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
                            <input
                                type="text"
                                value={calibDistMm}
                                onChange={e => setCalibDistMm(e.target.value)}
                                placeholder="z.B. 5000"
                                autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') handleCalibApply(); }}
                                style={{
                                    flex: 1, padding: '8px 12px', border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-sm)', fontSize: '0.95rem',
                                }}
                            />
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>mm</span>
                        </div>
                        <p style={{ margin: '0 0 16px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Tipp: 1m = 1000mm, 5m = 5000mm
                        </p>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => { setShowCalibDialog(false); setCalibPoints([]); setActiveTool(TOOLS.SELECT); }}
                                style={{ padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer' }}
                            >Abbrechen</button>
                            <button
                                onClick={handleCalibApply}
                                disabled={!calibDistMm}
                                style={{
                                    padding: '8px 16px', border: 'none', borderRadius: 'var(--radius-sm)',
                                    background: '#0ea5e9', color: '#fff', cursor: 'pointer', fontWeight: 600,
                                    opacity: calibDistMm ? 1 : 0.5,
                                }}
                            >Anwenden</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Main Area ──────────────────────────────────────── */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                {/* Left Toolbar */}
                <div style={{
                    width: '52px', borderRight: '1px solid var(--border-color)',
                    background: 'var(--surface-color)', display: 'flex', flexDirection: 'column',
                    padding: '8px 0', gap: '2px', alignItems: 'center',
                }}>
                    {[
                        { tool: TOOLS.SELECT, icon: MousePointer2, label: 'Auswahl' },
                        { tool: TOOLS.OUTER_WALL, icon: BoxSelect, label: 'Außenwand' },
                        { tool: TOOLS.INNER_WALL, icon: SeparatorHorizontal, label: 'Innenwand', disabled: !activeStorey.outerClosed },
                        { tool: TOOLS.DOOR, icon: DoorOpen, label: 'Tür', disabled: activeStorey.walls.length === 0 },
                        { tool: TOOLS.WINDOW, icon: AppWindow, label: 'Fenster', disabled: activeStorey.walls.length === 0 },
                        { tool: TOOLS.FURNITURE, icon: Armchair, label: 'Möbel' },
                        { tool: TOOLS.SLAB, icon: Layers, label: 'Decke' },
                        { tool: TOOLS.ROOF, icon: Home, label: 'Dach' },
                        { tool: 'measure', icon: Ruler, label: 'Messen' },
                        { tool: TOOLS.DELETE, icon: Trash2, label: 'Löschen' },
                        { separator: true },
                        { tool: TOOLS.ANNOTATE_POLYLINE, icon: Spline, label: 'Polylinie' },
                        { tool: TOOLS.ANNOTATE_CIRCLE, icon: CircleDot, label: 'Kreis' },
                        { tool: TOOLS.ANNOTATE_AREA, icon: Pentagon, label: 'Fläche' },
                        { tool: TOOLS.ANNOTATE_TEXT, icon: Type, label: 'Textfeld' },
                    ].map((t, idx) => t.separator ? (
                        <div key={`sep-${idx}`} style={{ width: '30px', height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />
                    ) : (
                        <button
                            key={t.tool}
                            onClick={() => {
                                cancelDrawing();
                                setActiveTool(t.tool);
                                setMeasurePoints([]);
                                setMeasureResult(null);
                                setAnnotationPoints([]);
                                setAnnotationCircleCenter(null);
                                setActiveAnnotationId(null);
                                if (t.tool !== TOOLS.FURNITURE) setPlacingFurniture(null);
                            }}
                            disabled={t.disabled}
                            title={t.label}
                            style={{
                                width: '40px', height: '40px', borderRadius: 'var(--radius-sm)',
                                border: 'none', cursor: t.disabled ? 'not-allowed' : 'pointer',
                                background: activeTool === t.tool ? '#e0f2fe' : 'transparent',
                                color: t.disabled ? '#d1d5db' : (activeTool === t.tool ? '#0ea5e9' : 'var(--text-secondary)'),
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                                opacity: t.disabled ? 0.4 : 1,
                            }}
                        >
                            <t.icon size={18} />
                        </button>
                    ))}

                </div>

                {/* Furniture sidebar (when tool = furniture) */}
                {activeTool === TOOLS.FURNITURE && (
                    <div style={{
                        width: '200px', borderRight: '1px solid var(--border-color)',
                        background: 'var(--surface-color)', overflowY: 'auto', padding: '8px',
                    }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Möbelkatalog</div>

                        {/* Category tabs */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                            {FURNITURE_CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setFurnitureCategory(cat.id)}
                                    style={{
                                        padding: '4px 8px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                        fontSize: '0.72rem', fontWeight: 600,
                                        background: furnitureCategory === cat.id ? '#e0f2fe' : '#f1f5f9',
                                        color: furnitureCategory === cat.id ? '#0ea5e9' : '#64748b',
                                    }}
                                >
                                    {cat.icon} {cat.label}
                                </button>
                            ))}
                        </div>

                        {/* Items */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {getItemsByCategory(furnitureCategory).map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setPlacingFurniture(item)}
                                    style={{
                                        padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                                        border: placingFurniture?.id === item.id ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                        background: placingFurniture?.id === item.id ? '#f0f9ff' : 'var(--surface-color)',
                                        cursor: 'pointer', textAlign: 'left', fontSize: '0.8rem',
                                    }}
                                >
                                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                        {mmToM(item.defaultWidth)} × {mmToM(item.defaultDepth)} m
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Roof sidebar (when tool = roof) */}
                {activeTool === TOOLS.ROOF && (
                    <div style={{
                        width: '220px', borderRight: '1px solid var(--border-color)',
                        background: 'var(--surface-color)', overflowY: 'auto', padding: '12px',
                    }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Dach</div>

                        {/* Roof type selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                            {Object.entries(ROOF_TYPES).map(([key, rt]) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        const defaults = { type: key };
                                        if (key === 'gable') { defaults.kneeWall_mm = rt.kneeWall_mm; defaults.pitch_deg = rt.pitch_deg; defaults.overhang_mm = rt.overhang_mm; }
                                        if (key === 'hip') { defaults.pitch_deg = rt.pitch_deg; defaults.overhang_mm = rt.overhang_mm; }
                                        if (key === 'flat') { defaults.parapet_mm = rt.parapet_mm; }
                                        // Merge with existing values if type matches
                                        applyChange('Dachform ändern', st => {
                                            const existing = st.roof?.type === key ? st.roof : {};
                                            st.roof = { ...defaults, ...existing, type: key };
                                        });
                                    }}
                                    style={{
                                        padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                                        border: activeStorey.roof?.type === key ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                        background: activeStorey.roof?.type === key ? '#f0f9ff' : 'var(--surface-color)',
                                        cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem', fontWeight: 600,
                                    }}
                                >
                                    {rt.label}
                                </button>
                            ))}
                        </div>

                        {/* Roof parameters */}
                        {activeStorey.roof && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {/* Satteldach */}
                                {/* Werte mit ?? statt ||, damit 0 (kein Kniestock/Überstand) erhalten bleibt; Vorgaben wie in der 3D-Ansicht */}
                                {activeStorey.roof.type === 'gable' && (
                                    <>
                                        <PropField label="Kniestockhöhe" value={(activeStorey.roof.kneeWall_mm ?? ROOF_TYPES.gable.kneeWall_mm) / 10} unit="cm" min={0} max={200} step={5}
                                            onChange={v => setRoofParam('kneeWall_mm', Math.round(v * 10))} />
                                        <PropField label="Dachneigung" value={activeStorey.roof.pitch_deg ?? ROOF_TYPES.gable.pitch_deg} unit="°" min={10} max={60} step={1}
                                            onChange={v => setRoofParam('pitch_deg', Math.round(v))} />
                                        <PropField label="Dachüberstand" value={(activeStorey.roof.overhang_mm ?? ROOF_TYPES.gable.overhang_mm) / 10} unit="cm" min={0} max={150} step={5}
                                            onChange={v => setRoofParam('overhang_mm', Math.round(v * 10))} />
                                    </>
                                )}
                                {/* Walmdach */}
                                {activeStorey.roof.type === 'hip' && (
                                    <>
                                        <PropField label="Dachneigung" value={activeStorey.roof.pitch_deg ?? ROOF_TYPES.hip.pitch_deg} unit="°" min={10} max={60} step={1}
                                            onChange={v => setRoofParam('pitch_deg', Math.round(v))} />
                                        <PropField label="Dachüberstand" value={(activeStorey.roof.overhang_mm ?? ROOF_TYPES.hip.overhang_mm) / 10} unit="cm" min={0} max={150} step={5}
                                            onChange={v => setRoofParam('overhang_mm', Math.round(v * 10))} />
                                    </>
                                )}
                                {/* Flachdach */}
                                {activeStorey.roof.type === 'flat' && (
                                    <PropField label="Attikahöhe" value={(activeStorey.roof.parapet_mm ?? ROOF_TYPES.flat.parapet_mm) / 10} unit="cm" min={10} max={150} step={5}
                                        onChange={v => setRoofParam('parapet_mm', Math.round(v * 10))} />
                                )}

                                {/* Delete roof */}
                                <button
                                    onClick={() => applyChange('Dach entfernen', st => { st.roof = null; })}
                                    style={{
                                        marginTop: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                                        border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                                        cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                                    }}
                                >
                                    <Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    Dach entfernen
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Canvas / 3D View */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: viewMode === '3d' ? 'default' : getCursor(activeTool) }}>
                    {viewMode === '2d' ? (
                        <canvas
                            ref={canvasRef}
                            onMouseMove={handleMouseMove}
                            onMouseDown={(e) => {
                                setSlabContextMenu(null); // close on any click
                                // Offene Eingabe im Panel zuerst übernehmen (blur → Commit), dann Klick verarbeiten
                                if (document.activeElement && isEditableTarget(document.activeElement)) document.activeElement.blur();
                                if (activeTool === 'measure') {
                                    handleMeasureClick(e);
                                } else {
                                    handleMouseDown(e);
                                }
                            }}
                            onDoubleClick={() => {
                                // Finish polyline or area on double-click — finalize the live annotation
                                if ((activeTool === TOOLS.ANNOTATE_POLYLINE || activeTool === TOOLS.ANNOTATE_AREA) && activeAnnotationId) {
                                    // The annotation already exists (each point is already saved) — just finalize
                                    setActiveAnnotationId(null);
                                    setAnnotationPoints([]);
                                    forceRender(v => v + 1);
                                    requestRender();
                                }
                            }}
                            style={{ display: 'block', width: '100%', height: '100%' }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                // Slab right-click context menu
                                if (selectedType === 'slab') {
                                    const slab = (activeStorey.slabs || []).find(s => s.id === selectedId);
                                    if (slab && slab.polygon && slab.polygon.length >= 3) {
                                        const rect = canvasRef.current.getBoundingClientRect();
                                        const sx = e.clientX - rect.left;
                                        const sy = e.clientY - rect.top;
                                        // Viewport rechnet in CSS-Pixeln (Canvas-Bitmap ist ggf. HiDPI-skaliert)
                                        const world = screenToWorld(vpRef.current, sx, sy);
                                        // Find nearest edge to insert a point
                                        let bestEdge = 0, bestDist = Infinity;
                                        for (let i = 0; i < slab.polygon.length; i++) {
                                            const a = slab.polygon[i];
                                            const b = slab.polygon[(i + 1) % slab.polygon.length];
                                            const d = pointToSegmentDist(world.x, world.y, a.x, a.y, b.x, b.y);
                                            if (d.dist < bestDist) { bestDist = d.dist; bestEdge = i; }
                                        }
                                        // Find nearest corner to possibly delete
                                        let nearestCornerIdx = -1, nearestCornerDist = Infinity;
                                        for (let i = 0; i < slab.polygon.length; i++) {
                                            const d = dist({ x: world.x, y: world.y }, slab.polygon[i]);
                                            if (d < nearestCornerDist) { nearestCornerDist = d; nearestCornerIdx = i; }
                                        }
                                        // "Punkt entfernen" nur anbieten, wenn wirklich nahe an einer Ecke geklickt wurde (15 px)
                                        const cornerInReach = nearestCornerDist * vpRef.current.zoom <= 15;
                                        setSlabContextMenu({
                                            x: e.clientX, y: e.clientY,
                                            worldX: snapToGrid(world.x), worldY: snapToGrid(world.y),
                                            slabId: slab.id, edgeIdx: bestEdge,
                                            nearCornerIdx: slab.polygon.length > 3 && cornerInReach ? nearestCornerIdx : -1,
                                        });
                                    }
                                }
                            }}
                        />
                    ) : (
                        <ViewErrorBoundary
                            onError={handle3DError}
                            fallback={
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f8fafc', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    3D-Ansicht nicht verfügbar
                                </div>
                            }
                        >
                            <Suspense fallback={
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f8fafc' }}>
                                    <Loader2 className="animate-spin" size={32} color="#0ea5e9" />
                                </div>
                            }>
                                <FloorPlan3DView storeys={storeys} />
                            </Suspense>
                        </ViewErrorBoundary>
                    )}

                    {/* Slab right-click context menu */}
                    {slabContextMenu && (
                        <div
                            style={{
                                position: 'fixed', left: slabContextMenu.x, top: slabContextMenu.y,
                                background: '#fff', border: '1px solid var(--border-color)',
                                borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                                zIndex: 9999, minWidth: '180px', overflow: 'hidden',
                            }}
                            onMouseLeave={() => setSlabContextMenu(null)}
                        >
                            <button
                                onClick={() => {
                                    const menu = slabContextMenu;
                                    applyChange('Deckenpunkt einfügen', st => {
                                        const slab = (st.slabs || []).find(s => s.id === menu.slabId);
                                        if (slab) slab.polygon.splice(menu.edgeIdx + 1, 0, { x: menu.worldX, y: menu.worldY });
                                    });
                                    setSlabContextMenu(null);
                                }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                                    padding: '10px 14px', border: 'none', background: 'none',
                                    cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500, textAlign: 'left',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                                <Plus size={14} style={{ color: '#0ea5e9' }} /> Knotenpunkt einfügen
                            </button>
                            {slabContextMenu.nearCornerIdx >= 0 && (
                                <button
                                    onClick={() => {
                                        const menu = slabContextMenu;
                                        applyChange('Deckenpunkt entfernen', st => {
                                            const slab = (st.slabs || []).find(s => s.id === menu.slabId);
                                            if (slab && slab.polygon.length > 3) slab.polygon.splice(menu.nearCornerIdx, 1);
                                        });
                                        setSlabContextMenu(null);
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                                        padding: '10px 14px', border: 'none', background: 'none',
                                        cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500, textAlign: 'left',
                                        color: '#dc2626',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                >
                                    <Trash2 size={14} /> Punkt entfernen
                                </button>
                            )}
                        </div>
                    )}

                    {/* Measure result overlay */}
                    {activeTool === 'measure' && measureResult && (
                        <div style={{
                            position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(14,165,233,0.9)', color: '#fff', padding: '8px 20px',
                            borderRadius: '8px', fontSize: '0.9rem', fontWeight: 700,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)', pointerEvents: 'none',
                        }}>
                            📏 {mmToM(measureResult)} m
                        </div>
                    )}

                    {/* Floating length editing input */}
                    {editingLength && (() => {
                        const wall = activeStorey.walls.find(w => w.id === editingLength.wallId);
                        if (!wall) return null;
                        const p1 = getPoint(activeStorey, wall.p1);
                        const p2 = getPoint(activeStorey, wall.p2);
                        if (!p1 || !p2) return null;

                        // Use stored original direction for stable length changes
                        const origDir = { x: editingLength.dirX, y: editingLength.dirY };

                        // Position overlay from the STORED screen position (doesn't jump)
                        const ox = editingLength.overlayX;
                        const oy = editingLength.overlayY;

                        // Erst bei Enter/Verlassen anwenden (ein Undo-Schritt); ESC verwirft die Eingabe
                        const commitLength = (raw) => {
                            if (lengthEditDoneRef.current) return;
                            lengthEditDoneRef.current = true;
                            setEditingLength(null);
                            const val = parseNumberInput(raw);
                            if (!Number.isFinite(val) || val <= 0) return;
                            if (Math.abs(val - editingLength.value) < 1e-9) return; // unverändert
                            const newLen = Math.max(100, val * 1000);
                            applyChange('Wandlänge ändern', st => { applyWallLength(st, wall, newLen, origDir); });
                        };

                        return (
                            <div style={{
                                position: 'absolute', left: ox + 'px', top: oy + 'px',
                                zIndex: 100, display: 'flex', gap: '2px', alignItems: 'center',
                            }}>
                                <input
                                    key={`${editingLength.wallId}_${editingLength.seq || 0}`}
                                    type="number"
                                    autoFocus
                                    defaultValue={editingLength.value}
                                    step="0.01"
                                    min="0.10"
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitLength(e.currentTarget.value);
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            lengthEditDoneRef.current = true;
                                            setEditingLength(null);
                                        }
                                    }}
                                    onBlur={e => commitLength(e.currentTarget.value)}
                                    style={{
                                        width: '70px', padding: '4px 8px',
                                        border: '2px solid #0ea5e9', borderRadius: '6px',
                                        fontSize: '0.85rem', fontWeight: 700,
                                        background: '#fff', color: '#0c4a6e',
                                        outline: 'none', boxShadow: '0 2px 10px rgba(14,165,233,0.4)',
                                        textAlign: 'center',
                                    }}
                                    onFocus={e => e.target.select()}
                                />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0ea5e9' }}>m</span>
                            </div>
                        );
                    })()}

                    {/* Mobile hint */}
                    {isMobile && (
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '20px 30px', borderRadius: '12px',
                            textAlign: 'center', fontSize: '0.9rem',
                        }}>
                            Der Grundrisseditor ist für Desktop optimiert.
                        </div>
                    )}
                </div>

                {/* Right Properties / Quantities Panel */}
                <div style={{
                    width: '260px', borderLeft: '1px solid var(--border-color)',
                    background: 'var(--surface-color)', overflowY: 'auto',
                    display: isMobile ? 'none' : 'flex', flexDirection: 'column',
                }}>
                    {/* Panel tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                        <button
                            onClick={() => setRightPanel('properties')}
                            style={{
                                flex: 1, padding: '8px', border: 'none', cursor: 'pointer',
                                fontSize: '0.78rem', fontWeight: 600, background: 'none',
                                color: rightPanel === 'properties' ? '#0ea5e9' : 'var(--text-secondary)',
                                borderBottom: rightPanel === 'properties' ? '2px solid #0ea5e9' : '2px solid transparent',
                            }}
                        >
                            Eigenschaften
                        </button>
                        <button
                            onClick={() => setRightPanel('quantities')}
                            style={{
                                flex: 1, padding: '8px', border: 'none', cursor: 'pointer',
                                fontSize: '0.78rem', fontWeight: 600, background: 'none',
                                color: rightPanel === 'quantities' ? '#0ea5e9' : 'var(--text-secondary)',
                                borderBottom: rightPanel === 'quantities' ? '2px solid #0ea5e9' : '2px solid transparent',
                            }}
                        >
                            <List size={13} style={{ marginRight: '4px', verticalAlign: '-2px' }} />Massen
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                        {rightPanel === 'properties' && (<>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Eigenschaften
                            </div>

                            {/* Storey height + reference */}
                            <PropGroup label="Geschoss">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '0.78rem', width: '80px' }}>Raumhöhe:</span>
                                    {/* Übernahme erst bei Enter/Verlassen; Klemmen auf den zulässigen Bereich erst dann */}
                                    <NumberInput
                                        value={activeStorey.height_mm / 1000}
                                        onCommit={v => applyChange('Raumhöhe ändern', st => { st.height_mm = Math.round(v * 1000); })}
                                        step={0.05}
                                        min={STOREY_HEIGHT.min / 1000}
                                        max={STOREY_HEIGHT.max / 1000}
                                        style={inputStyle}
                                    />
                                    <span style={unitStyle}>m</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '0.78rem', width: '80px' }}>Ref.-Höhe:</span>
                                    <NumberInput
                                        value={(activeStorey.ref_height_mm || 0) / 1000}
                                        onCommit={v => applyChange('Bezugshöhe ändern', st => { st.ref_height_mm = Math.round(v * 1000); })}
                                        step={0.01}
                                        style={inputStyle}
                                    />
                                    <span style={unitStyle}>m</span>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    Bezugshöhe des Geschosses (0,00 = Erdniveau) – nur zur Information, fließt derzeit nicht in 3D-Ansicht und Massen ein
                                </div>
                            </PropGroup>

                            {/* Wall tool: thickness selector */}
                            {(activeTool === TOOLS.OUTER_WALL || activeTool === TOOLS.INNER_WALL) && (
                                <PropGroup label={activeTool === TOOLS.OUTER_WALL ? 'Außenwand' : 'Innenwand'}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '0.78rem', width: '80px' }}>Wandstärke:</span>
                                        {activeTool === TOOLS.OUTER_WALL ? (
                                            <select
                                                value={outerWallThickness}
                                                onChange={e => setOuterWallThickness(Number(e.target.value))}
                                                style={{ ...inputStyle, width: '100px', padding: '4px 6px' }}
                                            >
                                                <option value={175}>17,5 cm</option>
                                                <option value={240}>24 cm</option>
                                                <option value={300}>30 cm</option>
                                                <option value={365}>36,5 cm</option>
                                                <option value={425}>42,5 cm</option>
                                                <option value={490}>49 cm</option>
                                            </select>
                                        ) : (
                                            <select
                                                value={innerWallType}
                                                onChange={e => {
                                                    setInnerWallType(e.target.value);
                                                    setInnerWallThickness(e.target.value === 'inner_load' ? WALL_THICKNESS.innerLoadDefault : WALL_THICKNESS.innerNonloadDefault);
                                                }}
                                                style={{ ...inputStyle, width: '100px', padding: '4px 6px' }}
                                            >
                                                <option value="inner_nonload">11,5 cm</option>
                                                <option value="inner_load">24 cm</option>
                                            </select>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                        {activeTool === TOOLS.OUTER_WALL
                                            ? 'Steinbreite für neue Außenwände'
                                            : innerWallType === 'inner_load' ? 'Tragende Innenwand (24 cm)' : 'Nichttragende Innenwand (11,5 cm)'
                                        }
                                    </div>
                                </PropGroup>
                            )}

                            {/* Annotation tool properties */}
                            {[TOOLS.ANNOTATE_POLYLINE, TOOLS.ANNOTATE_CIRCLE, TOOLS.ANNOTATE_AREA, TOOLS.ANNOTATE_TEXT].includes(activeTool) && (
                                <PropGroup label="Zeichenwerkzeug">
                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px' }}>
                                        {activeTool === TOOLS.ANNOTATE_POLYLINE ? 'Polylinie' :
                                            activeTool === TOOLS.ANNOTATE_CIRCLE ? 'Kreis' :
                                                activeTool === TOOLS.ANNOTATE_AREA ? 'Fläche' : 'Textfeld'}
                                    </div>
                                    <div style={{ marginBottom: '8px' }}>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Farbe</div>
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                            {['#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899', '#64748b', '#1e293b'].map(c => (
                                                <button
                                                    key={c}
                                                    onClick={() => setAnnotationColor(c)}
                                                    style={{
                                                        width: '24px', height: '24px', borderRadius: '4px',
                                                        background: c, border: annotationColor === c ? '2px solid #0ea5e9' : '2px solid transparent',
                                                        cursor: 'pointer', padding: 0,
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <input
                                            type="color"
                                            value={annotationColor}
                                            onChange={e => setAnnotationColor(e.target.value)}
                                            style={{ width: '100%', height: '28px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                        />
                                    </div>
                                    {activeTool !== TOOLS.ANNOTATE_TEXT && (
                                        <div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Linienstärke</div>
                                            <select
                                                value={annotationLineWidth}
                                                onChange={e => setAnnotationLineWidth(Number(e.target.value))}
                                                style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                                            >
                                                <option value={1}>1 px — dünn</option>
                                                <option value={2}>2 px — normal</option>
                                                <option value={3}>3 px — breit</option>
                                                <option value={5}>5 px — extra breit</option>
                                            </select>
                                        </div>
                                    )}
                                    {annotationPoints.length > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                            {activeAnnotationId
                                                ? `${annotationPoints.length} Punkte — Doppelklick oder ESC zum Beenden`
                                                : `${annotationPoints.length} Punkt gesetzt — klicke für nächsten Punkt`}
                                        </div>
                                    )}
                                    {annotationCircleCenter && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                            Mittelpunkt gesetzt — klicke für Radius
                                        </div>
                                    )}
                                </PropGroup>
                            )}

                            {/* Selected annotation properties */}
                            {selectedType === 'annotation' && selectedId && (() => {
                                const ann = (activeStorey.annotations || []).find(a => a.id === selectedId);
                                if (!ann) return null;
                                return (
                                    <PropGroup label={ann.type === 'polyline' ? 'Polylinie' : ann.type === 'circle' ? 'Kreis' : ann.type === 'area' ? 'Fläche' : 'Textfeld'}>
                                        {ann.type === 'text' && (
                                            <div style={{ marginBottom: '6px' }}>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Text</div>
                                                <input
                                                    type="text"
                                                    value={ann.text}
                                                    onFocus={() => beginTextEdit('Anmerkungstext ändern')}
                                                    onChange={e => { ann.text = e.target.value; liveTextChange(); }}
                                                    onBlur={endTextEdit}
                                                    style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                                                />
                                            </div>
                                        )}
                                        <div style={{ marginBottom: '6px' }}>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Farbe</div>
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                                {['#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899', '#64748b', '#1e293b'].map(c => (
                                                    <button
                                                        key={c}
                                                        onClick={() => applyChange('Anmerkungsfarbe ändern', () => { ann.color = c; if (ann.type === 'area') ann.fillColor = c + '33'; })}
                                                        style={{
                                                            width: '24px', height: '24px', borderRadius: '4px',
                                                            background: c, border: ann.color === c ? '2px solid #0ea5e9' : '2px solid transparent',
                                                            cursor: 'pointer', padding: 0,
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                        {ann.type !== 'text' && (
                                            <div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Linienstärke</div>
                                                <select
                                                    value={ann.lineWidth || 2}
                                                    onChange={e => { const lw = Number(e.target.value); applyChange('Linienstärke ändern', () => { ann.lineWidth = lw; }); }}
                                                    style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                                                >
                                                    <option value={1}>1 px</option>
                                                    <option value={2}>2 px</option>
                                                    <option value={3}>3 px</option>
                                                    <option value={5}>5 px</option>
                                                </select>
                                            </div>
                                        )}
                                    </PropGroup>
                                );
                            })()}

                            {/* Multi-selection info */}
                            {selectedIds.length > 1 && (
                                <PropGroup label="Mehrfachauswahl">
                                    <div style={{ fontSize: '0.82rem', marginBottom: '8px' }}>
                                        <strong>{selectedIds.length}</strong> Elemente ausgewählt
                                        {(() => {
                                            const walls = selectedIds.filter(s => s.type === 'wall').length;
                                            const openings = selectedIds.filter(s => s.type === 'opening').length;
                                            const furniture = selectedIds.filter(s => s.type === 'furniture').length;
                                            const parts = [];
                                            if (walls > 0) parts.push(`${walls} Wände`);
                                            if (openings > 0) parts.push(`${openings} Öffnungen`);
                                            if (furniture > 0) parts.push(`${furniture} Möbel`);
                                            return parts.length > 0 ? <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{parts.join(', ')}</div> : null;
                                        })()}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button
                                            onClick={handleDeleteSelected}
                                            style={{
                                                ...topBtnStyle, gap: '4px', fontSize: '0.78rem', flex: 1,
                                                background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                            }}
                                        >
                                            <Trash2 size={14} /> Alle löschen
                                        </button>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
                                        Klicke und ziehe zum Verschieben. <kbd style={{ padding: '1px 4px', borderRadius: '3px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}>Entf</kbd> zum Löschen.
                                    </div>
                                </PropGroup>
                            )}

                            {/* Wall properties */}
                            {selectedWall && selectedIds.length <= 1 && (
                                <>
                                    <PropGroup label="Wand">
                                        <div style={{ fontSize: '0.82rem', marginBottom: '6px' }}>
                                            Typ: <strong>{selectedWall.type === 'outer' ? 'Außenwand' : selectedWall.type === 'inner_load' ? 'Tragend' : 'Nichttragend'}</strong>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Dicke:</span>
                                            {/* Übernahme bei Enter/Verlassen; leer/ungültig wird verworfen, Bereich 5–50 cm */}
                                            <NumberInput
                                                value={selectedWall.thickness_mm / 10}
                                                onCommit={v => applyChange('Wanddicke ändern', st => {
                                                    selectedWall.thickness_mm = Math.round(v * 10);
                                                    if (selectedWall.type === 'outer') refreshOuterPolygon(st);
                                                    computeRooms(st);
                                                })}
                                                step={0.5}
                                                min={WALL_THICKNESS.min / 10}
                                                max={WALL_THICKNESS.max / 10}
                                                style={inputStyle}
                                            />
                                            <span style={unitStyle}>cm</span>
                                        </div>
                                        {(() => {
                                            const pt1 = getPoint(activeStorey, selectedWall.p1);
                                            const pt2 = getPoint(activeStorey, selectedWall.p2);
                                            const len = pt1 && pt2 ? dist(pt1, pt2) : 0;
                                            return (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                                    <span style={{ fontSize: '0.78rem', width: '48px' }}>Länge:</span>
                                                    {/* Einmalige Anwendung bei Enter/Verlassen entlang der aktuellen Richtung (kein Winkeldrift) */}
                                                    <NumberInput
                                                        value={Number.isFinite(len) ? +(len / 1000).toFixed(3) : NaN}
                                                        onCommit={v => applyChange('Wandlänge ändern', st => { applyWallLength(st, selectedWall, v * 1000); })}
                                                        step={0.01}
                                                        min={0.1}
                                                        style={inputStyle}
                                                    />
                                                    <span style={unitStyle}>m</span>
                                                </div>
                                            );
                                        })()}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Höhe:</span>
                                            <NumberInput
                                                value={(selectedWall.height_mm || activeStorey.height_mm) / 1000}
                                                onCommit={v => applyChange('Wandhöhe ändern', () => { selectedWall.height_mm = Math.round(v * 1000); })}
                                                step={0.05}
                                                min={0.1}
                                                style={inputStyle}
                                            />
                                            <span style={unitStyle}>m</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }} title="Nur zur Information – fließt derzeit nicht in 3D-Ansicht und Massen ein">
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Ref.:</span>
                                            <NumberInput
                                                value={(selectedWall.ref_height_mm || 0) / 1000}
                                                onCommit={v => applyChange('Bezugshöhe ändern', () => { selectedWall.ref_height_mm = Math.round(v * 1000); })}
                                                step={0.01}
                                                style={inputStyle}
                                            />
                                            <span style={unitStyle}>m</span>
                                        </div>
                                        {selectedWall.type !== 'outer' && (
                                            <button
                                                onClick={() => applyChange('Wandseite wechseln', st => { flipWallSide(selectedWall); computeRooms(st); })}
                                                style={{ ...topBtnStyle, marginTop: '6px', gap: '4px', fontSize: '0.78rem' }}
                                            >
                                                <FlipHorizontal2 size={14} /> Seite wechseln
                                            </button>
                                        )}
                                        <button
                                            onClick={handleDeleteSelected}
                                            style={{
                                                ...topBtnStyle, marginTop: '6px', gap: '4px', fontSize: '0.78rem',
                                                background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                            }}
                                        >
                                            <Trash2 size={14} /> Wand löschen
                                        </button>
                                    </PropGroup>
                                </>
                            )}

                            {/* Opening preset (when door/window tool active) */}
                            {(activeTool === TOOLS.DOOR || activeTool === TOOLS.WINDOW) && (
                                <PropGroup label={activeTool === TOOLS.DOOR ? 'Nächste Tür' : 'Nächstes Fenster'}>
                                    <PropField label="Breite" value={nextOpeningPreset[activeTool === TOOLS.DOOR ? 'door' : 'window'].width / 10} unit="cm" min={10}
                                        onChange={v => {
                                            const key = activeTool === TOOLS.DOOR ? 'door' : 'window';
                                            setNextOpeningPreset(prev => ({ ...prev, [key]: { ...prev[key], width: Math.round(v * 10) } }));
                                        }} />
                                    <PropField label="Höhe" value={nextOpeningPreset[activeTool === TOOLS.DOOR ? 'door' : 'window'].height / 10} unit="cm" min={10}
                                        onChange={v => {
                                            const key = activeTool === TOOLS.DOOR ? 'door' : 'window';
                                            setNextOpeningPreset(prev => ({ ...prev, [key]: { ...prev[key], height: Math.round(v * 10) } }));
                                        }} />
                                    {activeTool === TOOLS.WINDOW && (
                                        <PropField label="Brüstung" value={nextOpeningPreset.window.sill / 10} unit="cm" min={0}
                                            onChange={v => {
                                                setNextOpeningPreset(prev => ({ ...prev, window: { ...prev.window, sill: Math.round(v * 10) } }));
                                            }} />
                                    )}
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        Klicke auf eine Wand um {activeTool === TOOLS.DOOR ? 'die Tür' : 'das Fenster'} zu platzieren.
                                    </div>
                                </PropGroup>
                            )}

                            {/* Opening properties */}
                            {selectedOpening && (
                                <PropGroup label={selectedOpening.type === 'door' ? 'Tür' : 'Fenster'}>
                                    {/* Breite wird auf die Wandlänge begrenzt, die Öffnung bleibt vollständig in der Wand */}
                                    <PropField label="Breite" value={selectedOpening.width_mm / 10} unit="cm" min={10}
                                        onChange={v => applyChange('Öffnungsbreite ändern', st => { applyOpeningWidth(st, selectedOpening, v * 10); })} />
                                    <PropField label="Höhe" value={selectedOpening.height_mm / 10} unit="cm" min={10}
                                        onChange={v => applyChange('Öffnungshöhe ändern', () => { selectedOpening.height_mm = Math.round(v * 10); })} />
                                    {selectedOpening.type === 'window' && (
                                        <PropField label="Brüstung" value={selectedOpening.sill_mm / 10} unit="cm" min={0}
                                            onChange={v => applyChange('Brüstungshöhe ändern', () => { selectedOpening.sill_mm = Math.round(v * 10); })} />
                                    )}
                                    {selectedOpening.type === 'door' && (
                                        <>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '8px', marginBottom: '2px' }}>Anschlag</div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="swing" checked={selectedOpening.swing === 'left'} onChange={() => applyChange('Türanschlag ändern', () => { selectedOpening.swing = 'left'; })} /> Links
                                                </label>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="swing" checked={selectedOpening.swing === 'right'} onChange={() => applyChange('Türanschlag ändern', () => { selectedOpening.swing = 'right'; })} /> Rechts
                                                </label>
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px', marginBottom: '2px' }}>Öffnungsrichtung</div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="dir" checked={selectedOpening.direction === 'inward'} onChange={() => applyChange('Öffnungsrichtung ändern', () => { selectedOpening.direction = 'inward'; })} /> Innen
                                                </label>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="dir" checked={selectedOpening.direction === 'outward'} onChange={() => applyChange('Öffnungsrichtung ändern', () => { selectedOpening.direction = 'outward'; })} /> Außen
                                                </label>
                                            </div>
                                        </>
                                    )}
                                    <button
                                        onClick={handleDeleteSelected}
                                        style={{
                                            ...topBtnStyle, marginTop: '8px', gap: '4px', fontSize: '0.78rem',
                                            background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                        }}
                                    >
                                        <Trash2 size={14} /> {selectedOpening.type === 'door' ? 'Tür' : 'Fenster'} löschen
                                    </button>
                                </PropGroup>
                            )}

                            {/* Furniture properties */}
                            {selectedFurniture && (() => {
                                const catItem = getFurnitureItem(selectedFurniture.catalog_id);
                                return (
                                    <PropGroup label={catItem?.name || 'Möbel'}>
                                        {/* Maße werden auf die Katalog-Grenzen geklemmt (clampDimensions), nie 0/negativ */}
                                        <PropField label="Breite" value={selectedFurniture.width_mm / 10} unit="cm"
                                            min={catItem ? catItem.minWidth / 10 : 10} max={catItem ? catItem.maxWidth / 10 : 1000}
                                            onChange={v => applyChange('Möbelbreite ändern', () => {
                                                const w = Math.round(v * 10);
                                                selectedFurniture.width_mm = catItem ? clampDimensions(catItem, w, selectedFurniture.depth_mm).width : w;
                                            })} />
                                        <PropField label="Tiefe" value={selectedFurniture.depth_mm / 10} unit="cm"
                                            min={catItem ? catItem.minDepth / 10 : 10} max={catItem ? catItem.maxDepth / 10 : 1000}
                                            onChange={v => applyChange('Möbeltiefe ändern', () => {
                                                const d = Math.round(v * 10);
                                                selectedFurniture.depth_mm = catItem ? clampDimensions(catItem, selectedFurniture.width_mm, d).depth : d;
                                            })} />
                                        <PropField label="Höhe" value={selectedFurniture.height_mm / 10} unit="cm" min={1}
                                            onChange={v => applyChange('Möbelhöhe ändern', () => { selectedFurniture.height_mm = Math.round(v * 10); })} />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Rotation:</span>
                                            <select
                                                value={selectedFurniture.rotation}
                                                onChange={e => { const rot = Number(e.target.value); applyChange('Möbel drehen', () => { selectedFurniture.rotation = rot; }); }}
                                                style={inputStyle}
                                            >
                                                {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
                                                    <option key={a} value={a}>{a}°</option>
                                                ))}
                                            </select>
                                        </div>
                                        <button
                                            onClick={handleDeleteSelected}
                                            style={{
                                                ...topBtnStyle, marginTop: '8px', gap: '4px', fontSize: '0.78rem',
                                                background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                            }}
                                        >
                                            <Trash2 size={14} /> Möbel löschen
                                        </button>
                                    </PropGroup>
                                );
                            })()}

                            {/* Room properties */}
                            {selectedRoom && (
                                <PropGroup label="Raum">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                        <input
                                            type="text"
                                            value={selectedRoom.name}
                                            onFocus={() => beginTextEdit('Raum umbenennen')}
                                            onChange={e => { selectedRoom.name = e.target.value; liveTextChange(); }}
                                            onBlur={endTextEdit}
                                            style={{ ...inputStyle, flex: 1 }}
                                        />
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                        Fläche: <strong>{mm2ToM2(selectedRoom.area_mm2)} m²</strong>
                                    </div>
                                </PropGroup>
                            )}

                            {/* Slab properties */}
                            {selectedSlab && (
                                <PropGroup label="Decke / Bodenplatte">
                                    <div style={{ marginBottom: '6px' }}>
                                        <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Bezeichnung</label>
                                        <input
                                            type="text" value={selectedSlab.name || ''}
                                            onFocus={() => beginTextEdit('Decke umbenennen')}
                                            onChange={e => { selectedSlab.name = e.target.value; liveTextChange(); }}
                                            onBlur={endTextEdit}
                                            style={{
                                                width: '100%', padding: '4px 8px', fontSize: '0.82rem',
                                                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                                                background: 'var(--surface-color)', color: 'var(--text-primary)',
                                            }}
                                        />
                                    </div>
                                    <PropField label="Dicke" value={selectedSlab.thickness_mm / 10} unit="cm" min={1}
                                        onChange={v => applyChange('Deckendicke ändern', () => { selectedSlab.thickness_mm = Math.round(v * 10); })} />
                                    <PropField label="Referenzhöhe" value={selectedSlab.ref_height_mm / 1000} unit="m"
                                        onChange={v => applyChange('Deckenhöhe ändern', () => { selectedSlab.ref_height_mm = Math.round(v * 1000); })} />
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        {selectedSlab.ref_height_mm >= 0
                                            ? `↑ ${(selectedSlab.ref_height_mm / 1000).toFixed(2)} m über 0,00 (Decke)`
                                            : `↓ ${Math.abs(selectedSlab.ref_height_mm / 1000).toFixed(2)} m unter 0,00 (Bodenplatte)`}
                                    </div>
                                    <button
                                        onClick={() => {
                                            const slabId = selectedSlab.id;
                                            applyChange('Decke löschen', st => { st.slabs = (st.slabs || []).filter(s => s.id !== slabId); });
                                            setSelectedId(null); setSelectedType(null);
                                        }}
                                        style={{
                                            marginTop: '10px', width: '100%', padding: '6px', fontSize: '0.78rem',
                                            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                                            background: '#fef2f2', color: '#ef4444', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                        }}
                                    >
                                        <Trash2 size={14} /> Löschen
                                    </button>
                                </PropGroup>
                            )}

                            {/* Slab list */}
                            {(activeStorey.slabs || []).length > 0 && !selectedSlab && (
                                <PropGroup label="Decken / Bodenplatten">
                                    {(activeStorey.slabs || []).map(s => (
                                        <button key={s.id}
                                            onClick={() => { setSelectedId(s.id); setSelectedType('slab'); }}
                                            style={{
                                                width: '100%', padding: '6px 8px', marginBottom: '4px',
                                                fontSize: '0.78rem', textAlign: 'left',
                                                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                                                background: selectedId === s.id ? '#e0f2fe' : 'var(--surface-color)',
                                                color: 'var(--text-primary)', cursor: 'pointer',
                                            }}
                                        >
                                            {s.name || 'Platte'} — {(s.ref_height_mm / 1000).toFixed(2)} m · {s.thickness_mm / 10} cm
                                        </button>
                                    ))}
                                </PropGroup>
                            )}

                            {/* No selection */}
                            {!selectedWall && !selectedOpening && !selectedFurniture && !selectedRoom && !selectedSlab && (
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                    Wähle ein Element aus um seine Eigenschaften zu bearbeiten.
                                </div>
                            )}
                        </>)}

                        {/* Quantities Panel */}
                        {rightPanel === 'quantities' && (
                            <QuantitiesPanel storeys={storeys} activeStoreyIdx={activeStoreyIdx} />
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Status Bar ─────────────────────────────────────── */}
            <div style={{
                borderTop: '1px solid var(--border-color)', padding: '6px 16px',
                background: 'var(--surface-color)', fontSize: '0.78rem',
                color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between',
            }}>
                <span>{activeTool === 'measure' ? 'Klicke 2 Punkte um den Abstand zu messen' : (TOOL_HINTS[activeTool] || '')}</span>
                <span>
                    {[activeStorey.walls.length > 0 && `${activeStorey.walls.length} Wände`, activeStorey.rooms.length > 0 && `${activeStorey.rooms.length} Räume`, activeStorey.openings.length > 0 && `${activeStorey.openings.length} Öffnungen`, (activeStorey.slabs || []).length > 0 && `${(activeStorey.slabs || []).length} Decken`].filter(Boolean).join(' · ') || 'Keine Elemente'}
                </span>
            </div>
        </div>
    );
};

// ─── Sub-components ─────────────────────────────────────────────

const PropGroup = ({ label, children }) => (
    <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>{label}</div>
        {children}
    </div>
);

// Zahleneingabe mit Zwischenpuffer: Tippen ändert das Modell nicht; übernommen wird erst bei
// Enter oder Verlassen des Feldes – nur endliche Werte, auf min/max geklemmt. ESC verwirft.
const NumberInput = ({ value, onCommit, min, max, step, style }) => {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState('');
    const skipBlurRef = useRef(false);

    const commit = (raw) => {
        // Unverändert (nur fokussiert/verlassen) → nichts schreiben, auch keine Klemmung von Altwerten
        if (String(raw).trim() === formatNumberInput(value)) return;
        const n = parseNumberInput(raw);
        if (!Number.isFinite(n)) return; // leer/ungültig → alter Wert bleibt
        let v = n;
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        setText(formatNumberInput(v));
        if (!Number.isFinite(value) || Math.abs(v - value) > 1e-9) onCommit(v);
    };

    return (
        <input
            type="number"
            value={editing ? text : formatNumberInput(value)}
            onFocus={() => { setText(formatNumberInput(value)); setEditing(true); }}
            onChange={e => setText(e.target.value)}
            onBlur={e => {
                setEditing(false);
                if (skipBlurRef.current) { skipBlurRef.current = false; return; }
                commit(e.target.value);
            }}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                    skipBlurRef.current = true;
                    setText(formatNumberInput(value));
                    e.currentTarget.blur();
                }
            }}
            step={step}
            min={min}
            max={max}
            style={style}
        />
    );
};

const PropField = ({ label, value, unit, onChange, min, max, step = 0.5 }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.78rem', width: '54px', flexShrink: 0 }}>{label}:</span>
        <NumberInput value={value} onCommit={onChange} step={step} min={min} max={max} style={inputStyle} />
        <span style={unitStyle}>{unit}</span>
    </div>
);

// ─── Styles ─────────────────────────────────────────────────────

const topBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: '2px',
    padding: '6px 10px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)', background: 'var(--surface-color)',
    cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.82rem',
    transition: 'all 0.15s',
};

const inputStyle = {
    width: '72px', padding: '4px 6px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)', fontSize: '0.82rem',
    background: 'var(--surface-color)',
};

const unitStyle = {
    fontSize: '0.72rem', color: 'var(--text-secondary)', flexShrink: 0,
};

// Pan-Cursor ('grabbing') wird direkt am Canvas gesetzt, da der Pan-Zustand ein Ref ist
const getCursor = (tool) => {
    switch (tool) {
        case TOOLS.SELECT: return 'default';
        case TOOLS.OUTER_WALL:
        case TOOLS.INNER_WALL:
        case TOOLS.SLAB: return 'crosshair';
        case TOOLS.DOOR:
        case TOOLS.WINDOW: return 'copy';
        case TOOLS.FURNITURE: return 'cell';
        case TOOLS.DELETE: return 'not-allowed';
        case 'measure': return 'crosshair';
        case TOOLS.ROOF: return 'default';
        case TOOLS.ANNOTATE_POLYLINE:
        case TOOLS.ANNOTATE_CIRCLE:
        case TOOLS.ANNOTATE_AREA:
        case TOOLS.ANNOTATE_TEXT: return 'crosshair';
        default: return 'default';
    }
};

// ─── Export Menu Item ───────────────────────────────────────────

const ExportMenuItem = (props) => {
    // Icon über Destrukturierung im Rumpf (als Komponente genutzt, ESLint erkennt JSX-Nutzung
    // von Parametern sonst nicht)
    const { icon: Icon, label, sublabel, onClick } = props;
    return (
    <button
        onClick={onClick}
        style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 14px', border: 'none', cursor: 'pointer',
            background: 'none', width: '100%', textAlign: 'left',
            transition: 'background 0.1s', fontSize: '0.85rem',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
        <Icon size={16} style={{ color: '#64748b', flexShrink: 0 }} />
        <div>
            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{label}</div>
            {sublabel && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{sublabel}</div>}
        </div>
    </button>
    );
};

// ─── Quantities Panel ───────────────────────────────────────────

const QuantitiesPanel = ({ storeys, activeStoreyIdx }) => {
    // Bewusst ohne useMemo: Geschosse werden in-place geändert, die Array-Referenz bleibt gleich
    const data = generateQuantityList(storeys);
    const activeSt = data.storeys[activeStoreyIdx];

    return (
        <div>
            {/* Totals */}
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>Gesamtübersicht</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '16px' }}>
                <QStatCard label="Räume" value={data.totals.roomCount} />
                <QStatCard label="Fläche" value={`${data.totals.floorArea_m2} m²`} />
                <QStatCard label="Wandlänge" value={`${data.totals.wallLength_m} m`} />
                <QStatCard label="Wandfläche" value={`${data.totals.wallArea_m2} m²`} />
                <QStatCard label="Türen" value={data.totals.doorCount} />
                <QStatCard label="Fenster" value={data.totals.windowCount} />
            </div>

            {/* Active storey details */}
            {activeSt && (
                <>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>{activeSt.label}</div>

                    {activeSt.rooms.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', color: '#0ea5e9' }}>Räume</div>
                            {activeSt.rooms.map((r, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '2px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <span>{r.name}</span>
                                    <span style={{ fontWeight: 600 }}>{r.area_m2} m²</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeSt.walls.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', color: '#0ea5e9' }}>Wände</div>
                            {activeSt.walls.map((w, i) => (
                                <div key={i} style={{ fontSize: '0.75rem', padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>{w.type}</span>
                                        <span style={{ fontWeight: 600 }}>{w.length_m} m</span>
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                        {w.thickness_cm} cm × {w.height_m} m = {w.area_m2} m²
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeSt.openings.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', color: '#0ea5e9' }}>Öffnungen</div>
                            {activeSt.openings.map((o, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '2px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <span>{o.type}</span>
                                    <span style={{ fontWeight: 600 }}>{o.width_cm}×{o.height_cm} cm</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const QStatCard = ({ label, value }) => (
    <div style={{
        background: '#f8fafc', borderRadius: '6px', padding: '6px 8px',
        border: '1px solid #e2e8f0', textAlign: 'center',
    }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{label}</div>
    </div>
);

export default FloorPlanEditor;
