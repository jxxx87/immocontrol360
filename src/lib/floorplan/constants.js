// ─── Floor Plan Editor Constants ────────────────────────────────────
// All internal units in millimeters (integer)

// Grid & Snap
export const SNAP_GRID = 10;           // mm (1 cm)
export const ANGLE_SNAP = 45;          // degrees
export const SNAP_TOLERANCE = 20;      // mm
export const MIN_WALL_SEGMENT = 250;   // mm (25 cm)
export const MIN_ROOM_AREA = 250000;   // mm² (0.25 m²)

// Wall thickness
export const WALL_THICKNESS = {
    min: 50,
    max: 500,
    outerDefault: 365,      // 36.5 cm
    innerLoadDefault: 240,  // 24 cm (tragend)
    innerNonloadDefault: 115, // 11.5 cm (nichttragend)
};

// Storey heights
export const STOREY_HEIGHT = {
    default: 2600,
    min: 2400,
    max: 3500,
};

// Default storey labels
export const STOREY_LABELS = ['KG', 'EG', 'OG', '2. OG', 'DG'];

// Door presets (mm)
export const DOOR_PRESETS = [
    { label: '61 cm', width: 610, height: 2010 },
    { label: '73,5 cm', width: 735, height: 2010 },
    { label: '86 cm', width: 860, height: 2010 },
    { label: '98,5 cm', width: 985, height: 2010 },
    { label: '110 cm (Doppel)', width: 1100, height: 2010 },
];

// Window presets (mm)
export const WINDOW_PRESETS = [
    { label: '60 × 80 cm', width: 600, height: 800, sill: 900 },
    { label: '80 × 100 cm', width: 800, height: 1000, sill: 800 },
    { label: '100 × 120 cm', width: 1000, height: 1200, sill: 700 },
    { label: '120 × 120 cm', width: 1200, height: 1200, sill: 700 },
    { label: '140 × 140 cm', width: 1400, height: 1400, sill: 600 },
    { label: '180 × 140 cm', width: 1800, height: 1400, sill: 600 },
    { label: '240 × 140 cm', width: 2400, height: 1400, sill: 600 },
];

// Opening constraints
export const OPENING_MIN_EDGE_DIST = 50; // mm from wall corner

// Canvas rendering
export const GRID_COLOR = '#e5e7eb';
export const GRID_COLOR_MAJOR = '#d1d5db';
export const OUTER_WALL_COLOR = '#1e293b';
export const INNER_WALL_COLOR = '#475569';
export const OPENING_COLOR = '#f8fafc';
export const DOOR_ARC_COLOR = '#94a3b8';
export const WINDOW_STROKE_COLOR = '#0ea5e9';
export const ROOM_LABEL_COLOR = '#64748b';
export const FURNITURE_FILL = '#dbeafe';
export const FURNITURE_STROKE = '#3b82f6';
export const SELECTION_COLOR = '#0ea5e9';
export const SNAP_INDICATOR_COLOR = '#f97316';
export const DIMENSION_COLOR = '#ef4444';

// Tool modes
export const TOOLS = {
    SELECT: 'select',
    OUTER_WALL: 'outer_wall',
    INNER_WALL: 'inner_wall',
    DOOR: 'door',
    WINDOW: 'window',
    FURNITURE: 'furniture',
    DELETE: 'delete',
    CALIBRATE: 'calibrate',
    SLAB: 'slab',
    ROOF: 'roof',
    ANNOTATE_POLYLINE: 'annotate_polyline',
    ANNOTATE_CIRCLE: 'annotate_circle',
    ANNOTATE_AREA: 'annotate_area',
    ANNOTATE_TEXT: 'annotate_text',
};

// Roof types and defaults
export const ROOF_TYPES = {
    gable: { label: 'Satteldach', kneeWall_mm: 1000, pitch_deg: 35, overhang_mm: 500 },
    hip: { label: 'Walmdach', pitch_deg: 25, overhang_mm: 500 },
    flat: { label: 'Flachdach', parapet_mm: 500 },
};

// Tool status messages (German)
export const TOOL_HINTS = {
    [TOOLS.SELECT]: 'Klicke auf ein Element um es auszuwählen. Ziehe zum Verschieben.',
    [TOOLS.OUTER_WALL]: 'Außenwand: Punkte setzen. Winkel-Snap 45°. Zum Startpunkt klicken zum Schließen. ESC abbrechen.',
    [TOOLS.INNER_WALL]: 'Innenwand: Start- und Endpunkt setzen. Dockt an Innenkante der Außenwand. ESC abbrechen.',
    [TOOLS.DOOR]: 'Tür: Auf eine Wand klicken um die Tür zu platzieren.',
    [TOOLS.WINDOW]: 'Fenster: Auf eine Wand klicken um das Fenster zu platzieren.',
    [TOOLS.FURNITURE]: 'Möbel: Aus dem Katalog wählen und auf den Grundriss klicken.',
    [TOOLS.DELETE]: 'Löschen: Klicke auf ein Element um es zu entfernen.',
    [TOOLS.CALIBRATE]: 'Referenzmaß: Zwei Punkte auf dem Hintergrundbild setzen, dann die reale Strecke eingeben.',
    [TOOLS.SLAB]: 'Decke/Bodenplatte: Erstellt eine horizontale Platte über dem Außenwandpolygon.',
    [TOOLS.ROOF]: 'Dach: Dachform wählen und Parameter einstellen.',
    [TOOLS.ANNOTATE_POLYLINE]: 'Polylinie: Klicken für Punkte, Doppelklick zum Beenden. ESC abbrechen.',
    [TOOLS.ANNOTATE_CIRCLE]: 'Kreis: Mittelpunkt klicken, dann Radius ziehen.',
    [TOOLS.ANNOTATE_AREA]: 'Fläche: Punkte setzen, Doppelklick zum Schließen. ESC abbrechen.',
    [TOOLS.ANNOTATE_TEXT]: 'Textfeld: Klicken um ein Textfeld zu platzieren.',
};

// Helper: mm → m string
export const mmToM = (mm) => (mm / 1000).toFixed(2).replace('.', ',');
// Helper: mm² → m² string
export const mm2ToM2 = (mm2) => (mm2 / 1000000).toFixed(2).replace('.', ',');
// Helper: m → mm
export const mToMm = (m) => Math.round(m * 1000);
