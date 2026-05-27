// ─── PDF Template Constants ─────────────────────────────────────────
// All measurements in mm. UI converts to px for display only.

// ─── A4 Dimensions ──────────────────────────────────────────────────
export const A4_PORTRAIT = { w: 210, h: 297 };
export const A4_LANDSCAPE = { w: 297, h: 210 };

// Legacy exports (portrait defaults, used as fallback)
export const A4_W = 210;
export const A4_H = 297;

export const HEADER_H = 50;
export const FOOTER_H = 20;
export const MM_TO_PX = 3.78; // 1mm ≈ 3.78px at 96dpi

export const MARGIN_OPTIONS = [10, 15, 20];
export const DEFAULT_MARGIN = 15;
export const SNAP_GRID = 5; // mm

// ─── Helper: get page dimensions by orientation ─────────────────────
export const getPageDims = (orientation = 'portrait') =>
    orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;

// ─── Report Types ───────────────────────────────────────────────────
export const REPORT_TYPES = [
    { id: 'immobilien', label: 'Immobilien' },
    { id: 'mietverhaeltnisse', label: 'Mietverhältnisse' },
    { id: 'bankaufstellung', label: 'Bankaufstellung' },
    { id: 'offene_mieten', label: 'Offene Mieten' },
    { id: 'buchhaltung', label: 'Buchhaltung' },
    { id: 'kpi', label: 'KPI' },
    { id: 'deals', label: 'Deals' },
    { id: 'sanierung', label: 'Sanierung' },
    { id: 'mahnwesen', label: 'Mahnwesen & Forderungen' },
];

export const REPORT_TITLE_MAP = {
    immobilien: 'Immobilienübersicht',
    mietverhaeltnisse: 'Mietverhältnisse',
    bankaufstellung: 'Bankaufstellung',
    offene_mieten: 'Offene Mieten',
    buchhaltung: 'Buchhaltungsreport',
    kpi: 'KPI-Report',
    deals: 'Deal-Übersicht',
    sanierung: 'Sanierungsreport',
    mahnwesen: 'Mahnwesen & Forderungsübersicht',
};

// ─── Default Orientation per Report Type ────────────────────────────
export const DEFAULT_ORIENTATION_BY_REPORT = {
    immobilien: 'landscape',
    mietverhaeltnisse: 'portrait',
    bankaufstellung: 'landscape',
    offene_mieten: 'portrait',
    buchhaltung: 'landscape',
    kpi: 'portrait',
    deals: 'landscape',
    sanierung: 'landscape',
    mahnwesen: 'landscape',
};

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
export const MAX_LOGOS = 1;

export const DEFAULT_ACCENT = '#0ea5e9';

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

// ─── Preset Builder (creates elements for a given orientation) ──────
const buildPresetElements = (presetId, orientation = 'portrait') => {
    const page = getPageDims(orientation);
    const m = 15; // preset margin
    const maxW = page.w - 2 * m;
    const footerY = page.h - FOOTER_H + 3;

    const base = {
        standard: [
            { id: 'logo', type: EL_TYPES.LOGO, zone: 'header', x: page.w - m - 40, y: 18, w: 40, h: 15, visible: true, aspectRatio: 40 / 15 },
            { id: 'title', type: EL_TYPES.TITLE, zone: 'header', x: m, y: 18, w: Math.min(130, maxW - 50), h: 8, visible: true, fontSize: 16, fontWeight: 'bold', align: 'left', color: '#1a1a1a' },
            { id: 'portfolio_name', type: EL_TYPES.PORTFOLIO_NAME, zone: 'header', x: m, y: 27, w: Math.min(130, maxW), h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#555555' },
            { id: 'date_header', type: EL_TYPES.DATE, zone: 'header', x: m, y: 34, w: 60, h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#888888' },
            { id: 'subtitle', type: EL_TYPES.SUBTITLE, zone: 'header', x: m, y: 27, w: Math.min(140, maxW), h: 6, visible: false, fontSize: 11, fontWeight: 'normal', align: 'left', color: '#555555' },
            { id: 'line_1', type: EL_TYPES.LINE, zone: 'header', x: m, y: 44, w: maxW, h: 0.5, visible: true, color: '#cccccc' },
            { id: 'date_footer', type: EL_TYPES.DATE, zone: 'footer', x: m, y: footerY, w: 60, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'left', color: '#888888' },
            { id: 'page_number', type: EL_TYPES.PAGE_NUMBER, zone: 'footer', x: page.w - m - 45, y: footerY, w: 45, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'right', color: '#888888' },
        ],
        kompakt: [
            { id: 'logo', type: EL_TYPES.LOGO, zone: 'header', x: page.w - m - 30, y: 16, w: 30, h: 11, visible: true, aspectRatio: 30 / 11 },
            { id: 'title', type: EL_TYPES.TITLE, zone: 'header', x: m, y: 16, w: Math.min(140, maxW - 40), h: 7, visible: true, fontSize: 14, fontWeight: 'bold', align: 'left', color: '#1a1a1a' },
            { id: 'portfolio_name', type: EL_TYPES.PORTFOLIO_NAME, zone: 'header', x: m, y: 27, w: Math.min(130, maxW), h: 5, visible: false, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#555555' },
            { id: 'date_header', type: EL_TYPES.DATE, zone: 'header', x: m, y: 24, w: 60, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'left', color: '#888888' },
            { id: 'subtitle', type: EL_TYPES.SUBTITLE, zone: 'header', x: m, y: 27, w: Math.min(140, maxW), h: 6, visible: false, fontSize: 11, fontWeight: 'normal', align: 'left', color: '#555555' },
            { id: 'line_1', type: EL_TYPES.LINE, zone: 'header', x: m, y: 36, w: maxW, h: 0.5, visible: true, color: '#cccccc' },
            { id: 'date_footer', type: EL_TYPES.DATE, zone: 'footer', x: m, y: footerY, w: 60, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'left', color: '#888888' },
            { id: 'page_number', type: EL_TYPES.PAGE_NUMBER, zone: 'footer', x: page.w - m - 45, y: footerY, w: 45, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'right', color: '#888888' },
        ],
        bank: [
            { id: 'logo', type: EL_TYPES.LOGO, zone: 'header', x: page.w - m - 45, y: 16, w: 45, h: 17, visible: true, aspectRatio: 45 / 17 },
            { id: 'title', type: EL_TYPES.TITLE, zone: 'header', x: m, y: 16, w: Math.min(130, maxW - 55), h: 8, visible: true, fontSize: 16, fontWeight: 'bold', align: 'left', color: '#1a1a1a' },
            { id: 'subtitle', type: EL_TYPES.SUBTITLE, zone: 'header', x: m, y: 26, w: Math.min(140, maxW), h: 6, visible: true, fontSize: 11, fontWeight: 'normal', align: 'left', color: '#555555' },
            { id: 'portfolio_name', type: EL_TYPES.PORTFOLIO_NAME, zone: 'header', x: m, y: 27, w: Math.min(130, maxW), h: 5, visible: false, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#555555' },
            { id: 'date_header', type: EL_TYPES.DATE, zone: 'header', x: m, y: 34, w: 60, h: 5, visible: true, fontSize: 10, fontWeight: 'normal', align: 'left', color: '#888888' },
            { id: 'line_1', type: EL_TYPES.LINE, zone: 'header', x: m, y: 44, w: maxW, h: 0.5, visible: true, color: '#cccccc' },
            { id: 'date_footer', type: EL_TYPES.DATE, zone: 'footer', x: m, y: footerY, w: 60, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'left', color: '#888888' },
            { id: 'page_number', type: EL_TYPES.PAGE_NUMBER, zone: 'footer', x: page.w - m - 45, y: footerY, w: 45, h: 5, visible: true, fontSize: 9, fontWeight: 'normal', align: 'right', color: '#888888' },
        ],
    };
    return base[presetId] || base.standard;
};

// ─── Presets (orientation-aware) ─────────────────────────────────────
// getPresetElements(presetKey, orientation) returns elements[]
export const getPresetElements = (presetKey, orientation = 'portrait') =>
    buildPresetElements(presetKey, orientation).map(e => ({ ...e }));

export const PRESET_OPTIONS = [
    { key: 'standard', label: 'Standard' },
    { key: 'kompakt', label: 'Kompakt' },
    { key: 'bank', label: 'Bank' },
];

// ─── Proportional Conversion (Portrait <-> Landscape) ───────────────
export const convertElements = (elements, fromOrientation, toOrientation) => {
    if (fromOrientation === toOrientation) return elements;
    const fromPage = getPageDims(fromOrientation);
    const toPage = getPageDims(toOrientation);
    const scaleX = toPage.w / fromPage.w;
    const scaleY = toPage.h / fromPage.h;

    return elements.map(el => {
        let newEl = { ...el };
        // Scale position
        newEl.x = Math.round(el.x * scaleX / SNAP_GRID) * SNAP_GRID;

        // Y: for footer elements, compute relative to page bottom
        if (el.zone === 'footer') {
            const relY = el.y - (fromPage.h - FOOTER_H);
            newEl.y = (toPage.h - FOOTER_H) + relY;
        } else {
            // Header elements: Y stays the same (same header height)
            newEl.y = el.y;
        }

        // Scale width (but NOT logo — logo stays same size)
        if (el.type !== EL_TYPES.LOGO) {
            newEl.w = Math.round(el.w * scaleX / SNAP_GRID) * SNAP_GRID;
            // Ensure min width
            if (newEl.w < 10) newEl.w = 10;
        }
        // Height stays same for text/logo; lines stay same

        // Snap
        newEl.x = Math.round(newEl.x / SNAP_GRID) * SNAP_GRID;
        newEl.y = Math.round(newEl.y / SNAP_GRID) * SNAP_GRID;

        return newEl;
    });
};
