// ─── Furniture Catalog ──────────────────────────────────────────────
// Parametric furniture items for the floor plan editor.
// All dimensions in mm. Each item has min/max for width and depth.

export const FURNITURE_CATEGORIES = [
    { id: 'wohnen', label: 'Wohnen', icon: '🛋️' },
    { id: 'schlafen', label: 'Schlafen', icon: '🛏️' },
    { id: 'essen', label: 'Essen', icon: '🍽️' },
    { id: 'kueche', label: 'Küche', icon: '🍳' },
    { id: 'bad', label: 'Bad', icon: '🚿' },
    { id: 'sanitaer', label: 'Sanitär', icon: '🚽' },
    { id: 'buero', label: 'Büro', icon: '💼' },
];

export const FURNITURE_ITEMS = [
    // ── Wohnen ──
    { id: 'sofa_2er', name: '2er-Sofa', category: 'wohnen', defaultWidth: 1600, defaultDepth: 900, defaultHeight: 850, minWidth: 1200, maxWidth: 2000, minDepth: 800, maxDepth: 1000, snapType: 'wall', color: '#bfdbfe' },
    { id: 'sofa_3er', name: '3er-Sofa', category: 'wohnen', defaultWidth: 2200, defaultDepth: 900, defaultHeight: 850, minWidth: 1800, maxWidth: 3200, minDepth: 800, maxDepth: 1000, snapType: 'wall', color: '#bfdbfe' },
    { id: 'sofa_eck', name: 'Ecksofa', category: 'wohnen', defaultWidth: 2600, defaultDepth: 2000, defaultHeight: 850, minWidth: 2200, maxWidth: 3500, minDepth: 1600, maxDepth: 2400, snapType: 'corner', color: '#bfdbfe' },
    { id: 'sessel', name: 'Sessel', category: 'wohnen', defaultWidth: 800, defaultDepth: 850, defaultHeight: 900, minWidth: 700, maxWidth: 1000, minDepth: 750, maxDepth: 950, snapType: 'free', color: '#bfdbfe' },
    { id: 'couchtisch', name: 'Couchtisch', category: 'wohnen', defaultWidth: 1100, defaultDepth: 600, defaultHeight: 450, minWidth: 600, maxWidth: 1400, minDepth: 400, maxDepth: 800, snapType: 'free', color: '#e0f2fe' },
    { id: 'tv_board', name: 'TV-Board', category: 'wohnen', defaultWidth: 1600, defaultDepth: 400, defaultHeight: 500, minWidth: 1000, maxWidth: 2500, minDepth: 350, maxDepth: 500, snapType: 'wall', color: '#93c5fd' },
    { id: 'regal_wand', name: 'Wandregal', category: 'wohnen', defaultWidth: 1200, defaultDepth: 300, defaultHeight: 2000, minWidth: 600, maxWidth: 2400, minDepth: 250, maxDepth: 400, snapType: 'wall', color: '#93c5fd' },

    // ── Schlafen ──
    { id: 'bett_einzel', name: 'Einzelbett', category: 'schlafen', defaultWidth: 1000, defaultDepth: 2100, defaultHeight: 500, minWidth: 800, maxWidth: 1200, minDepth: 2000, maxDepth: 2200, snapType: 'wall', color: '#bfdbfe' },
    { id: 'bett_doppel', name: 'Doppelbett', category: 'schlafen', defaultWidth: 1800, defaultDepth: 2100, defaultHeight: 500, minWidth: 1400, maxWidth: 2200, minDepth: 2000, maxDepth: 2200, snapType: 'wall', color: '#bfdbfe' },
    { id: 'kleiderschrank', name: 'Kleiderschrank', category: 'schlafen', defaultWidth: 2000, defaultDepth: 600, defaultHeight: 2200, minWidth: 800, maxWidth: 3000, minDepth: 550, maxDepth: 650, snapType: 'wall', color: '#93c5fd' },
    { id: 'kommode', name: 'Kommode', category: 'schlafen', defaultWidth: 1000, defaultDepth: 450, defaultHeight: 900, minWidth: 600, maxWidth: 1600, minDepth: 400, maxDepth: 500, snapType: 'wall', color: '#93c5fd' },
    { id: 'nachttisch', name: 'Nachttisch', category: 'schlafen', defaultWidth: 500, defaultDepth: 400, defaultHeight: 550, minWidth: 350, maxWidth: 600, minDepth: 350, maxDepth: 500, snapType: 'free', color: '#a5d8ff' },

    // ── Essen ──
    { id: 'esstisch_4', name: 'Esstisch (4 Pers.)', category: 'essen', defaultWidth: 1200, defaultDepth: 800, defaultHeight: 750, minWidth: 800, maxWidth: 1600, minDepth: 700, maxDepth: 1000, snapType: 'free', color: '#e0f2fe' },
    { id: 'esstisch_6', name: 'Esstisch (6 Pers.)', category: 'essen', defaultWidth: 1800, defaultDepth: 900, defaultHeight: 750, minWidth: 1500, maxWidth: 2400, minDepth: 800, maxDepth: 1100, snapType: 'free', color: '#e0f2fe' },
    { id: 'stuhl', name: 'Stuhl', category: 'essen', defaultWidth: 450, defaultDepth: 500, defaultHeight: 900, minWidth: 400, maxWidth: 550, minDepth: 450, maxDepth: 550, snapType: 'free', color: '#bfdbfe' },

    // ── Küche ──
    { id: 'kueche_zeile', name: 'Küchenzeile', category: 'kueche', defaultWidth: 2600, defaultDepth: 600, defaultHeight: 900, minWidth: 1800, maxWidth: 4800, minDepth: 580, maxDepth: 650, snapType: 'wall', color: '#bae6fd' },
    { id: 'kuehlschrank', name: 'Kühlschrank', category: 'kueche', defaultWidth: 600, defaultDepth: 650, defaultHeight: 1850, minWidth: 550, maxWidth: 900, minDepth: 600, maxDepth: 700, snapType: 'wall', color: '#bae6fd' },
    { id: 'spuele', name: 'Spüle', category: 'kueche', defaultWidth: 600, defaultDepth: 600, defaultHeight: 900, minWidth: 450, maxWidth: 900, minDepth: 500, maxDepth: 650, snapType: 'wall', color: '#bae6fd' },
    { id: 'herd', name: 'Herd / Kochfeld', category: 'kueche', defaultWidth: 600, defaultDepth: 600, defaultHeight: 900, minWidth: 500, maxWidth: 900, minDepth: 500, maxDepth: 650, snapType: 'wall', color: '#7dd3fc' },

    // ── Bad ──
    { id: 'wc', name: 'WC', category: 'bad', defaultWidth: 380, defaultDepth: 650, defaultHeight: 400, minWidth: 350, maxWidth: 450, minDepth: 600, maxDepth: 750, snapType: 'wall', color: '#e0f2fe' },
    { id: 'waschtisch', name: 'Waschtisch', category: 'bad', defaultWidth: 600, defaultDepth: 500, defaultHeight: 850, minWidth: 400, maxWidth: 1200, minDepth: 400, maxDepth: 600, snapType: 'wall', color: '#e0f2fe' },
    { id: 'dusche', name: 'Dusche', category: 'bad', defaultWidth: 900, defaultDepth: 900, defaultHeight: 2200, minWidth: 700, maxWidth: 1200, minDepth: 700, maxDepth: 1200, snapType: 'corner', color: '#bae6fd' },
    { id: 'badewanne', name: 'Badewanne', category: 'bad', defaultWidth: 1700, defaultDepth: 750, defaultHeight: 600, minWidth: 1400, maxWidth: 1800, minDepth: 700, maxDepth: 800, snapType: 'wall', color: '#e0f2fe' },

    // ── Sanitär ──
    { id: 'san_toilette', name: 'Wand-WC', category: 'sanitaer', defaultWidth: 360, defaultDepth: 540, defaultHeight: 400, minWidth: 340, maxWidth: 400, minDepth: 480, maxDepth: 600, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_toilette_stand', name: 'Stand-WC', category: 'sanitaer', defaultWidth: 380, defaultDepth: 680, defaultHeight: 400, minWidth: 350, maxWidth: 420, minDepth: 620, maxDepth: 720, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_bidet', name: 'Bidet', category: 'sanitaer', defaultWidth: 360, defaultDepth: 540, defaultHeight: 380, minWidth: 340, maxWidth: 400, minDepth: 480, maxDepth: 600, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_urinal', name: 'Urinal', category: 'sanitaer', defaultWidth: 340, defaultDepth: 340, defaultHeight: 600, minWidth: 300, maxWidth: 400, minDepth: 300, maxDepth: 380, snapType: 'wall', color: '#bae6fd' },
    { id: 'san_waschbecken', name: 'Waschbecken (Einzel)', category: 'sanitaer', defaultWidth: 500, defaultDepth: 420, defaultHeight: 850, minWidth: 350, maxWidth: 650, minDepth: 350, maxDepth: 500, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_doppelwaschtisch', name: 'Doppelwaschtisch', category: 'sanitaer', defaultWidth: 1200, defaultDepth: 500, defaultHeight: 850, minWidth: 900, maxWidth: 1500, minDepth: 450, maxDepth: 550, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_handwaschbecken', name: 'Handwaschbecken', category: 'sanitaer', defaultWidth: 350, defaultDepth: 280, defaultHeight: 850, minWidth: 250, maxWidth: 450, minDepth: 250, maxDepth: 350, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_duschkabine', name: 'Duschkabine', category: 'sanitaer', defaultWidth: 900, defaultDepth: 900, defaultHeight: 2000, minWidth: 700, maxWidth: 1200, minDepth: 700, maxDepth: 1200, snapType: 'corner', color: '#bae6fd' },
    { id: 'san_dusche_eck', name: 'Eckdusche (Viertelkreis)', category: 'sanitaer', defaultWidth: 900, defaultDepth: 900, defaultHeight: 2000, minWidth: 800, maxWidth: 1000, minDepth: 800, maxDepth: 1000, snapType: 'corner', color: '#bae6fd' },
    { id: 'san_dusche_boden', name: 'Bodengl. Dusche', category: 'sanitaer', defaultWidth: 1200, defaultDepth: 900, defaultHeight: 20, minWidth: 800, maxWidth: 1800, minDepth: 700, maxDepth: 1200, snapType: 'free', color: '#bae6fd' },
    { id: 'san_badewanne', name: 'Badewanne', category: 'sanitaer', defaultWidth: 1700, defaultDepth: 750, defaultHeight: 600, minWidth: 1400, maxWidth: 1900, minDepth: 700, maxDepth: 800, snapType: 'wall', color: '#e0f2fe' },
    { id: 'san_badewanne_frei', name: 'Freistehende Wanne', category: 'sanitaer', defaultWidth: 1700, defaultDepth: 800, defaultHeight: 580, minWidth: 1500, maxWidth: 1900, minDepth: 750, maxDepth: 850, snapType: 'free', color: '#e0f2fe' },
    { id: 'san_waschmaschine', name: 'Waschmaschine', category: 'sanitaer', defaultWidth: 600, defaultDepth: 600, defaultHeight: 850, minWidth: 550, maxWidth: 650, minDepth: 550, maxDepth: 650, snapType: 'wall', color: '#93c5fd' },
    { id: 'san_trockner', name: 'Trockner', category: 'sanitaer', defaultWidth: 600, defaultDepth: 600, defaultHeight: 850, minWidth: 550, maxWidth: 650, minDepth: 550, maxDepth: 650, snapType: 'wall', color: '#93c5fd' },

    // ── Büro ──
    { id: 'schreibtisch', name: 'Schreibtisch', category: 'buero', defaultWidth: 1400, defaultDepth: 700, defaultHeight: 750, minWidth: 800, maxWidth: 2000, minDepth: 600, maxDepth: 800, snapType: 'wall', color: '#e0f2fe' },
    { id: 'buero_stuhl', name: 'Bürostuhl', category: 'buero', defaultWidth: 550, defaultDepth: 550, defaultHeight: 1100, minWidth: 500, maxWidth: 650, minDepth: 500, maxDepth: 650, snapType: 'free', color: '#93c5fd' },
    { id: 'buecherregal', name: 'Bücherregal', category: 'buero', defaultWidth: 1000, defaultDepth: 350, defaultHeight: 2100, minWidth: 600, maxWidth: 2000, minDepth: 300, maxDepth: 400, snapType: 'wall', color: '#93c5fd' },
];

/**
 * Get items by category
 */
export const getItemsByCategory = (categoryId) =>
    FURNITURE_ITEMS.filter(i => i.category === categoryId);

/**
 * Get item by ID
 */
export const getFurnitureItem = (itemId) =>
    FURNITURE_ITEMS.find(i => i.id === itemId);

/**
 * Clamp dimensions to min/max
 */
export const clampDimensions = (item, width, depth) => ({
    width: Math.max(item.minWidth, Math.min(item.maxWidth, width)),
    depth: Math.max(item.minDepth, Math.min(item.maxDepth, depth)),
});
