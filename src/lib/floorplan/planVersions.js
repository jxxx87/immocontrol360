// ─── Einfache Versionierung von Grundrissen (floor_plans.version_history) ───
// Der Editor legt beim ersten Speichern einer Sitzung den zuvor geladenen Stand als
// Version ab (höchstens MAX_PLAN_VERSIONS Einträge, neuester zuerst). Hintergrundbilder
// gehören nicht zur Version: Sie sind groß und bleiben beim Wiederherstellen erhalten.

export const MAX_PLAN_VERSIONS = 5;

/** plan_data ohne Hintergrundbilder (bgImage je Geschoss). Ungültige Eingabe → []. */
export const stripBackgrounds = (planData) => (
    Array.isArray(planData)
        ? planData.map((storey) => {
            if (!storey || typeof storey !== 'object') return storey;
            const { bgImage: _bgImage, ...rest } = storey;
            return rest;
        })
        : []
);

/** Gültiger Versions-Eintrag? (Altbestand oder fremde Formen werden ignoriert) */
export const isValidVersionEntry = (entry) => !!entry && typeof entry === 'object' && Array.isArray(entry.plan_data);

/** Geordnete, gültige Einträge einer gespeicherten version_history. */
export const normalizeVersionHistory = (history) => (Array.isArray(history) ? history.filter(isValidVersionEntry) : []);

/**
 * Neuer Versions-Eintrag.
 * stand      = Zeitpunkt, zu dem dieser Stand gespeichert war (updated_at des Plans)
 * archivedAt = Zeitpunkt der Ablage als Version
 */
export const createVersionEntry = (planData, { stand = null, name = null, archivedAt = null } = {}) => ({
    archived_at: archivedAt || new Date().toISOString(),
    stand: stand || null,
    name: name || null,
    plan_data: stripBackgrounds(planData),
});

/** Eintrag vorn einfügen, höchstens `max` Einträge behalten. */
export const addVersionEntry = (history, entry, max = MAX_PLAN_VERSIONS) => (
    [entry, ...normalizeVersionHistory(history)].slice(0, Math.max(1, max))
);

/**
 * plan_data aus einer Version wiederherstellen. Hintergrundbilder des aktuellen Stands
 * bleiben je Geschoss (gleiche Geschoss-ID) erhalten; Geschosse, die es nur in der
 * Version gibt, bekommen kein Bild.
 */
export const restoreVersionPlanData = (currentPlanData, versionPlanData) => {
    const current = Array.isArray(currentPlanData) ? currentPlanData : [];
    const bgById = new Map();
    for (const s of current) {
        if (s && typeof s === 'object' && s.id && s.bgImage) bgById.set(s.id, s.bgImage);
    }
    return stripBackgrounds(versionPlanData).map((storey) => {
        if (!storey || typeof storey !== 'object') return storey;
        const bg = storey.id ? bgById.get(storey.id) : undefined;
        return bg ? { ...storey, bgImage: bg } : storey;
    });
};

/** Kurzbeschreibung eines Stands für die Auswahl (Geschosse / Räume). */
export const summarizePlanData = (planData) => {
    const storeys = Array.isArray(planData) ? planData.filter(s => s && typeof s === 'object') : [];
    const rooms = storeys.reduce((n, s) => n + (Array.isArray(s.rooms) ? s.rooms.length : 0), 0);
    const walls = storeys.reduce((n, s) => n + (Array.isArray(s.walls) ? s.walls.length : 0), 0);
    return { storeys: storeys.length, rooms, walls };
};
