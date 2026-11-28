// ─── Hintergrundbilder von Grundrissen im Storage ─────────────────
// Neue Hintergrundbilder liegen im privaten Bucket „floorplan-backgrounds“ unter
// <floor_plan_id>/<geschoss-id>-<zufall>.<png|jpg>. In plan_data steht je Geschoss nur
// noch { path, scale, offsetX, offsetY, opacity, visible, imgWidth, imgHeight }.
// Ältere Pläne mit eingebettetem Bild ({ dataUrl, … }) werden weiter unterstützt und
// vom Editor beim Öffnen in den Storage verschoben.
//
// Die Storage-Funktionen erhalten den Storage-Client (supabase.storage) als Parameter,
// damit dieses Modul ohne Supabase-Konfiguration testbar bleibt.

export const FLOORPLAN_BG_BUCKET = 'floorplan-backgrounds';
/** Gleiche Grenze wie file_size_limit des Buckets (15 MB). */
export const MAX_BG_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Erlaubte Bildtypen (wie allowed_mime_types des Buckets) und ihre Dateiendung. */
export const BG_UPLOAD_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg' };

const SAFE_SEGMENT = /[^A-Za-z0-9_-]+/g;

/** Hintergrund liegt im Storage (Pfad statt eingebettetem Bild). */
export const isStoredBackground = (bg) => !!bg && typeof bg === 'object' && typeof bg.path === 'string' && bg.path !== '';

/** Hintergrund ist noch als data-URL in plan_data eingebettet (Altbestand). */
export const isInlineBackground = (bg) => !!bg && typeof bg === 'object' && typeof bg.dataUrl === 'string' && bg.dataUrl.startsWith('data:');

/** Dateiendung für einen erlaubten Bildtyp, sonst null. */
export const extForMime = (mime) => BG_UPLOAD_MIME[String(mime || '').toLowerCase()] || null;

/** data-URL zerlegen → { mime, base64, data } oder null. */
export const parseDataUrl = (dataUrl) => {
    const s = String(dataUrl || '');
    const comma = s.indexOf(',');
    if (!s.startsWith('data:') || comma < 0) return null;
    const parts = s.slice(5, comma).split(';');
    return {
        mime: (parts[0] || 'text/plain').toLowerCase(),
        base64: parts.slice(1).some(p => p.toLowerCase() === 'base64'),
        data: s.slice(comma + 1),
    };
};

/** Anzahl Bytes, die eine data-URL enthält (ohne sie zu dekodieren). */
export const dataUrlByteLength = (dataUrl) => {
    const p = parseDataUrl(dataUrl);
    if (!p) return 0;
    if (!p.base64) return p.data.length;
    const padding = p.data.endsWith('==') ? 2 : (p.data.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((p.data.length * 3) / 4) - padding);
};

/** data-URL in einen Blob umwandeln (ohne fetch, unabhängig von der CSP). Ungültig → null. */
export const dataUrlToBlob = (dataUrl) => {
    const p = parseDataUrl(dataUrl);
    if (!p) return null;
    let bytes;
    if (p.base64) {
        const bin = atob(p.data);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
        bytes = new TextEncoder().encode(decodeURIComponent(p.data));
    }
    return new Blob([bytes], { type: p.mime });
};

/** Objektpfad <planId>/<geschoss>-<eindeutig>.<ext> (nur sichere Zeichen). */
export const buildBackgroundPath = (planId, storeyId, ext, unique) => {
    const storeyPart = String(storeyId || '').replace(SAFE_SEGMENT, '_').slice(0, 60) || 'geschoss';
    const uniquePart = String(unique || '').replace(SAFE_SEGMENT, '').slice(0, 40) || Date.now().toString(36);
    return `${planId}/${storeyPart}-${uniquePart}.${ext}`;
};

/** Gleiche Datei im Ordner eines anderen Plans (Duplizieren). */
export const retargetBackgroundPath = (path, newPlanId) => {
    const s = String(path || '');
    const slash = s.indexOf('/');
    return `${newPlanId}/${slash >= 0 ? s.slice(slash + 1) : s}`;
};

/** Alle Storage-Pfade, auf die plan_data verweist. */
export const collectBackgroundPaths = (planData) => (
    Array.isArray(planData)
        ? planData.map(s => (s && typeof s === 'object' ? s.bgImage : null)).filter(isStoredBackground).map(bg => bg.path)
        : []
);

/** Hintergrund-Daten nach dem Hochladen: ohne data-URL, mit Pfad (übrige Felder bleiben). */
export const toStoredBackground = (bg, path, overrides = {}) => {
    const { dataUrl: _dataUrl, ...rest } = bg || {};
    return { ...rest, ...overrides, path };
};

// ─── Storage-Zugriffe (Client wird übergeben) ─────────────────────

const bucketOf = (storage) => storage.from(FLOORPLAN_BG_BUCKET);

/** Blob hochladen (kein Überschreiben). Wirft bei Fehler. */
export const uploadBackgroundBlob = async (storage, path, blob) => {
    if (!blob || !(blob.size > 0)) throw new Error('Das Hintergrundbild ist leer.');
    if (blob.size > MAX_BG_UPLOAD_BYTES) {
        throw new Error(`Das Hintergrundbild ist zu groß (${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB, höchstens 15 MB).`);
    }
    if (!extForMime(blob.type)) throw new Error('Nur PNG- oder JPG-Bilder können gespeichert werden.');
    const { error } = await bucketOf(storage).upload(path, blob, {
        contentType: blob.type,
        upsert: false,
        cacheControl: '31536000',
    });
    if (error) throw error;
    return path;
};

/** Bild als Blob laden. Wirft bei Fehler. */
export const downloadBackgroundBlob = async (storage, path) => {
    const { data, error } = await bucketOf(storage).download(path);
    if (error) throw error;
    if (!data) throw new Error('Das Hintergrundbild wurde nicht gefunden.');
    return data;
};

/** Dateien löschen (doppelte/leere Pfade werden übergangen). Wirft bei Fehler. */
export const removeBackgroundObjects = async (storage, paths) => {
    const list = [...new Set((paths || []).filter(p => typeof p === 'string' && p !== ''))];
    if (list.length === 0) return 0;
    const { error } = await bucketOf(storage).remove(list);
    if (error) throw error;
    return list.length;
};

/** Alle Dateien im Ordner eines Plans (Löschen des Plans). Wirft bei Fehler. */
export const listPlanBackgroundPaths = async (storage, planId) => {
    const { data, error } = await bucketOf(storage).list(String(planId), { limit: 1000 });
    if (error) throw error;
    return (data || [])
        .filter(o => o && typeof o.name === 'string' && o.name !== '' && o.id !== null)
        .map(o => `${planId}/${o.name}`);
};

/** Datei serverseitig kopieren (Duplizieren). Wirft bei Fehler. */
export const copyBackgroundObject = async (storage, fromPath, toPath) => {
    const { error } = await bucketOf(storage).copy(fromPath, toPath);
    if (error) throw error;
    return toPath;
};
