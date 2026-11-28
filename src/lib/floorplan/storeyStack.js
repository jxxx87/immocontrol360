// ─── Geschoss-Stapelung (3D-Ansicht) ───────────────────────────────
// Reine Hilfsfunktionen ohne Three.js, damit sie mit Vitest prüfbar sind.
//
// Ein Geschoss ist im Modell so hoch wie seine lichte Raumhöhe (height_mm).
// Deckenplatten liegen auf ihrer Referenzhöhe (ref_height_mm, standardmäßig die
// Geschosshöhe) und wachsen mit thickness_mm nach oben. Das nächste Geschoss
// beginnt deshalb erst oberhalb der Decke – sonst würden Deckenplatte und Boden
// des nächsten Geschosses ineinander liegen.
//
// Die Referenzhöhe des Geschosses selbst (ref_height_mm am Geschoss, 0 = Standard)
// ist nur informativ und fließt bewusst nicht in die Stapelung ein.

export const DEFAULT_STOREY_HEIGHT_MM = 2600;
// Gleiche Vorgabe wie die 3D-Darstellung einer Platte ohne gültige Dicke
export const DEFAULT_SLAB_THICKNESS_MM = 200;

const arr = (v) => (Array.isArray(v) ? v : []);

/** Lichte Geschosshöhe in mm (ungültig/fehlend → Standardhöhe). */
export const storeyHeightMm = (storey) => (
    Number.isFinite(storey?.height_mm) && storey.height_mm > 0 ? storey.height_mm : DEFAULT_STOREY_HEIGHT_MM
);

/**
 * Dicke der Geschossdecke in mm: größte Dicke aller Platten, deren Referenzhöhe
 * auf Geschosshöhe (Toleranz 1 mm) oder darüber liegt. Bodenplatten (unterhalb)
 * zählen nicht. Keine Deckenplatte → 0.
 */
export const ceilingThicknessMm = (storey) => {
    const height = storeyHeightMm(storey);
    let max = 0;
    for (const slab of arr(storey?.slabs)) {
        const ref = slab?.ref_height_mm;
        if (!Number.isFinite(ref) || ref < height - 1) continue;
        const thickness = Number.isFinite(slab?.thickness_mm) && slab.thickness_mm > 0
            ? slab.thickness_mm
            : DEFAULT_SLAB_THICKNESS_MM;
        if (thickness > max) max = thickness;
    }
    return max;
};

/** Platzbedarf eines Geschosses im Stapel: lichte Höhe + Deckenstärke (mm). */
export const storeyStackHeightMm = (storey) => storeyHeightMm(storey) + ceilingThicknessMm(storey);

/** Unterkante (Boden) jedes Geschosses in mm, von unten nach oben in Listenreihenfolge. */
export const storeyBaseOffsetsMm = (storeys) => {
    let y = 0;
    return arr(storeys).map((storey) => {
        const base = y;
        y += storeyStackHeightMm(storey);
        return base;
    });
};

/** Gesamthöhe des Stapels in mm (Summe aller Geschosse inkl. Decken). */
export const totalStackHeightMm = (storeys) => arr(storeys).reduce((sum, s) => sum + storeyStackHeightMm(s), 0);
