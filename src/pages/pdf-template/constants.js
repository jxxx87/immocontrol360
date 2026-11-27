// ─── PDF Template Constants ─────────────────────────────────────────
// All measurements in mm. UI converts to px for display only.
// Wird von Editor (PdfTemplateEditor.jsx) UND Generator (lib/pdfGenerator.js)
// genutzt – Geometrie-/Umrechnungslogik daher nur hier pflegen.

// ─── A4 Dimensions ──────────────────────────────────────────────────
export const A4_PORTRAIT = { w: 210, h: 297 };
export const A4_LANDSCAPE = { w: 297, h: 210 };

export const HEADER_H = 50;
export const FOOTER_H = 20;
export const MM_TO_PX = 3.78; // 1mm ≈ 3.78px at 96dpi

export const MARGIN_OPTIONS = [10, 15, 20];
export const DEFAULT_MARGIN = 15;
export const SNAP_GRID = 5; // mm – nur beim Ziehen mit der Maus

// Gemeinsame Schrift für Editor-Vorschau und Druck. Bewusst ohne Nachladen
// von externen Servern (kein Google Fonts → keine IP-Übertragung, kein
// Warten auf Webfonts): Inter wird genutzt, wenn lokal installiert, sonst
// die Systemschrift.
export const PDF_FONT_STACK = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// ─── Helper: get page dimensions by orientation ─────────────────────
export const getPageDims = (orientation = 'portrait') =>
    orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;

export const ZOOM_LEVELS = [0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5];

// ─── Element Types ──────────────────────────────────────────────────
export const EL_TYPES = {
    LOGO: 'logo',
    TITLE: 'title',
    SUBTITLE: 'subtitle',
    PORTFOLIO_NAME: 'portfolio_name',
    DATE: 'date',
    PAGE_NUMBER: 'page_number',
    LINE: 'line',
    FREETEXT: 'freetext',
};

// ─── Max counts ─────────────────────────────────────────────────────
export const MAX_FREETEXT = 5;
export const MAX_LINES = 2;

// App-weiter Standard der Akzentfarbe (Editor, Hook und Generator).
// Hinweis: Der Spalten-Default accent_color in der DB weicht ab ('#f59e0b');
// die App schreibt die Farbe aber immer explizit mit.
export const DEFAULT_ACCENT = '#0ea5e9';

// ─── Size limits per element (eine Quelle für Eingabefelder + Clamping) ─
export const getSizeLimits = (el, { orientation = 'portrait', margin = DEFAULT_MARGIN, headerH = HEADER_H, footerH = FOOTER_H } = {}) => {
    const page = getPageDims(orientation);
    const maxContentW = Math.max(10, page.w - 2 * margin);
    const zoneH = el?.zone === 'footer' ? footerH : headerH;
    if (el?.type === EL_TYPES.LOGO) {
        return { minW: 20, maxW: Math.min(60, maxContentW), minH: 3, maxH: zoneH };
    }
    if (el?.type === EL_TYPES.LINE) {
        return { minW: 10, maxW: maxContentW, minH: 0.5, maxH: 0.5 };
    }
    return { minW: 10, maxW: maxContentW, minH: 3, maxH: zoneH };
};

// ─── Zone boundaries (orientation-aware) ────────────────────────────
export const getZoneBounds = (zone, pageH, headerH = HEADER_H, footerH = FOOTER_H) => {
    if (zone === 'header') return { minY: 0, maxY: headerH };
    if (zone === 'footer') return { minY: pageH - footerH, maxY: pageH };
    return { minY: 0, maxY: pageH };
};

const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));
const toFinite = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Hält ein Element innerhalb der Seitenränder und seiner Zone (Header/Footer).
 * Rastet NICHT ein – Feinjustierung in 1-mm-Schritten bleibt erhalten.
 * Begrenzt nur auf die Seitengeometrie; die typabhängigen Eingabegrenzen
 * (getSizeLimits) wendet der Editor bei Benutzereingaben an.
 */
export const clampElementToPage = (el, { orientation = 'portrait', margin = DEFAULT_MARGIN, headerH = HEADER_H, footerH = FOOTER_H } = {}) => {
    const page = getPageDims(orientation);
    const bounds = getZoneBounds(el.zone, page.h, headerH, footerH);
    const zoneH = Math.max(0.5, bounds.maxY - bounds.minY);
    const maxContentW = Math.max(1, page.w - 2 * margin);
    const w = clampNum(toFinite(el.w, 10), 1, maxContentW);
    const rawH = el.type === EL_TYPES.LINE ? (toFinite(el.h, 0) || 0.5) : toFinite(el.h, 5);
    const h = clampNum(rawH, 0.5, zoneH);
    const x = clampNum(toFinite(el.x, margin), margin, Math.max(margin, page.w - margin - w));
    const y = clampNum(toFinite(el.y, bounds.minY), bounds.minY, Math.max(bounds.minY, bounds.maxY - h));
    return { ...el, x, y, w, h };
};

// ─── Element defaults for creation (orientation-aware) ──────────────
export const elementDefaults = (type, margin = 15, orientation = 'portrait') => {
    const page = getPageDims(orientation);
    const safe = margin;
    const maxW = page.w - 2 * safe;
    const footerY = page.h - FOOTER_H + 3;

    switch (type) {
        case EL_TYPES.LOGO:
            return { type, zone: 'header', x: safe + maxW - 40, y: 18, w: 40, h: 15, visible: true, aspectRatio: 40 / 15 };
        case EL_TYPES.TITLE:
            return { type, zone: 'header', x: safe, y: 18, w: Math.min(130, maxW - 50), h: 8, visible: true, fontSize: 16, fontWeight: 'bold', align: 'left', color: '#1a1a1a' };
        case EL_TYPES.SUBTITLE:
            return { type, zone: 'header', x: safe, y: 27, w: Math.min(140, maxW), h: 6, visible: false, fontSize: 11, fontWeight: 'normal', align: 'left', color: '#555555' };
        case EL_TYPES.PORTFOLIO_NAME:
            return { type, zone: 'header', x: safe, y: 27, w: Math.min(130, maxW), h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#555555' };
        case EL_TYPES.DATE:
            return { type, zone: 'header', x: safe, y: 34, w: 60, h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#888888' };
        case EL_TYPES.PAGE_NUMBER:
            return { type, zone: 'footer', x: page.w - safe - 45, y: footerY, w: 45, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'right', color: '#888888' };
        case EL_TYPES.LINE:
            return { type, zone: 'header', x: safe, y: 44, w: maxW, h: 0.5, visible: true, color: '#cccccc' };
        case EL_TYPES.FREETEXT:
            return { type, zone: 'header', x: safe, y: 38, w: 80, h: 6, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#333333', text: 'Freitext' };
        default:
            return {};
    }
};

// ─── Standard-Layout (orientation-aware) ────────────────────────────
// Aktuell gibt es nur das Layout 'standard' (die früheren, nirgends
// angebotenen Varianten 'kompakt'/'bank' wurden entfernt).
const buildStandardPreset = (orientation) => {
    const page = getPageDims(orientation);
    const m = 15; // preset margin
    const maxW = page.w - 2 * m;
    const footerY = page.h - FOOTER_H + 3;
    return [
        { id: 'logo', type: EL_TYPES.LOGO, zone: 'header', x: page.w - m - 40, y: 18, w: 40, h: 15, visible: true, aspectRatio: 40 / 15 },
        { id: 'title', type: EL_TYPES.TITLE, zone: 'header', x: m, y: 18, w: Math.min(130, maxW - 50), h: 8, visible: true, fontSize: 16, fontWeight: 'bold', align: 'left', color: '#1a1a1a' },
        { id: 'portfolio_name', type: EL_TYPES.PORTFOLIO_NAME, zone: 'header', x: m, y: 27, w: Math.min(130, maxW), h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#555555' },
        { id: 'date_header', type: EL_TYPES.DATE, zone: 'header', x: m, y: 34, w: 60, h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#888888' },
        { id: 'subtitle', type: EL_TYPES.SUBTITLE, zone: 'header', x: m, y: 27, w: Math.min(140, maxW), h: 6, visible: false, fontSize: 11, fontWeight: 'normal', align: 'left', color: '#555555' },
        { id: 'line_1', type: EL_TYPES.LINE, zone: 'header', x: m, y: 44, w: maxW, h: 0.5, visible: true, color: '#cccccc' },
        { id: 'date_footer', type: EL_TYPES.DATE, zone: 'footer', x: m, y: footerY, w: 60, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'left', color: '#888888' },
        { id: 'page_number', type: EL_TYPES.PAGE_NUMBER, zone: 'footer', x: page.w - m - 45, y: footerY, w: 45, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'right', color: '#888888' },
    ];
};

const PRESETS = { standard: buildStandardPreset };

// getPresetElements(presetKey, orientation) returns elements[] (unbekannter Schlüssel → Standard)
export const getPresetElements = (presetKey = 'standard', orientation = 'portrait') =>
    (PRESETS[presetKey] || PRESETS.standard)(orientation);

// ─── Gespeicherte Vorlagen-Orientierung ─────────────────────────────
// Die Vorlage speichert EINE globale Orientierung (in jedem Eintrag von
// orientation_by_report_type derselbe Wert).
export const getTemplateOrientation = (orientationByReport) => {
    const map = orientationByReport && typeof orientationByReport === 'object' ? orientationByReport : {};
    const value = map.global || Object.values(map)[0];
    return value === 'landscape' ? 'landscape' : 'portrait';
};

// ─── Proportional Conversion (Portrait <-> Landscape) ───────────────
// Rundet auf 1 mm (kein 5-mm-Raster), damit Feinjustierungen erhalten bleiben.
export const convertElements = (elements, fromOrientation, toOrientation, { footerH = FOOTER_H } = {}) => {
    if (!Array.isArray(elements)) return [];
    if (fromOrientation === toOrientation) return elements.map(el => ({ ...el }));
    const fromPage = getPageDims(fromOrientation);
    const toPage = getPageDims(toOrientation);
    const scaleX = toPage.w / fromPage.w;

    return elements.map(el => {
        const newEl = { ...el };
        // Scale position
        newEl.x = Math.round(toFinite(el.x, 0) * scaleX);

        // Y: for footer elements, compute relative to page bottom
        if (el.zone === 'footer') {
            const relY = toFinite(el.y, fromPage.h - footerH) - (fromPage.h - footerH);
            newEl.y = (toPage.h - footerH) + relY;
        } else {
            // Header elements: Y stays the same (same header height)
            newEl.y = toFinite(el.y, 0);
        }

        // Scale width (but NOT logo — logo stays same size)
        if (el.type !== EL_TYPES.LOGO) {
            newEl.w = Math.max(10, Math.round(toFinite(el.w, 10) * scaleX));
        }
        // Height stays same for text/logo; lines stay same
        return newEl;
    });
};

/**
 * Bringt gespeicherte Vorlagen-Elemente auf die tatsächliche Seitenorientierung
 * (proportionale Umrechnung + Begrenzung auf Ränder/Zonen). Wird vom Editor
 * (Orientierungswechsel) und vom Generator (Export in anderer Orientierung)
 * gemeinsam benutzt, damit Vorschau und Druck übereinstimmen.
 */
export const fitElementsToOrientation = (elements, { from = 'portrait', to = 'portrait', margin = DEFAULT_MARGIN, headerH = HEADER_H, footerH = FOOTER_H } = {}) =>
    convertElements((Array.isArray(elements) ? elements : []).filter(el => el && typeof el === 'object'), from, to, { footerH })
        .map(el => clampElementToPage(el, { orientation: to, margin, headerH, footerH }));

/** Prüft, ob sich sichtbare Elemente (außer Logos) in derselben Zone überlappen. */
export const hasElementCollision = (elements) => {
    const list = Array.isArray(elements) ? elements : [];
    for (const el of list) {
        for (const other of list) {
            if (other.id === el.id || !other.visible || !el.visible || other.zone !== el.zone) continue;
            if (el.type === EL_TYPES.LOGO || other.type === EL_TYPES.LOGO) continue;
            if (el.x < other.x + other.w && el.x + el.w > other.x && el.y < other.y + (other.h || 0.5) && el.y + (el.h || 0.5) > other.y) {
                return true;
            }
        }
    }
    return false;
};
