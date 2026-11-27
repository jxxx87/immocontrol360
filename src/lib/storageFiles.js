// Gemeinsame Helfer für Datei-Uploads und -Downloads in Supabase Storage
// (Komplett-Check 2026-11-27, Paket SEC-STORAGE).
//
// - Supabase Storage lehnt Objekt-Schlüssel mit Umlauten, Leerzeichen und vielen
//   Sonderzeichen ab ("Invalid key"). Der Schlüssel besteht deshalb nur aus einer
//   Zufalls-ID und der geprüften Dateiendung; der Originalname bleibt in der
//   Datenbank (z. B. documents.file_name, announcements.attachments[].name).
// - Größe und Dateityp werden schon im Browser geprüft (gleiche Grenzen wie die
//   Bucket-Einstellungen), damit der Nutzer eine verständliche Meldung erhält.
// - Signierte Download-Links werden in einem Fenster geöffnet, das noch im Klick
//   entsteht – sonst blockieren iOS Safari und Popup-Blocker das Fenster.

const MIME_BY_EXTENSION = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    csv: 'text/csv'
};

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB (entspricht file_size_limit der Buckets)

export const FILE_RULES = {
    documents: {
        label: 'PDF, Bilder, Word oder Excel',
        maxBytes: MAX_UPLOAD_BYTES,
        extensions: ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'doc', 'docx', 'xls', 'xlsx']
    },
    ticketImages: {
        label: 'Bilder (JPG, PNG, GIF, WEBP, HEIC)',
        maxBytes: MAX_UPLOAD_BYTES,
        maxFiles: 10,
        extensions: IMAGE_EXTENSIONS
    },
    announcements: {
        label: 'Bilder oder PDF',
        maxBytes: MAX_UPLOAD_BYTES,
        maxFiles: 10,
        extensions: [...IMAGE_EXTENSIONS, 'pdf']
    },
    chat: {
        label: 'Bilder, PDF, Word, Excel oder Text',
        maxBytes: MAX_UPLOAD_BYTES,
        extensions: [...IMAGE_EXTENSIONS, 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv']
    }
};

export const getFileExtension = (name) => {
    const match = /\.([a-z0-9]{1,8})$/i.exec(name || '');
    return match ? match[1].toLowerCase() : '';
};

export const isImageName = (name) => IMAGE_EXTENSIONS.includes(getFileExtension(name));

export const acceptAttribute = (rule) => rule.extensions.map(ext => `.${ext}`).join(',');

const formatMegabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

// Liefert null, wenn die Datei erlaubt ist, sonst eine Fehlermeldung auf Deutsch.
export const validateUploadFile = (file, rule) => {
    if (!file) return 'Keine Datei ausgewählt.';
    const ext = getFileExtension(file.name);
    if (!ext || !rule.extensions.includes(ext)) {
        return `„${file.name}“: Dateityp nicht erlaubt (erlaubt: ${rule.label}).`;
    }
    if (file.size === 0) return `„${file.name}“ ist leer.`;
    if (file.size > rule.maxBytes) {
        return `„${file.name}“ ist zu groß (max. ${formatMegabytes(rule.maxBytes)}).`;
    }
    return null;
};

const randomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

// Sicherer Objektname (letztes Pfadsegment): <zufalls-id>.<endung>
export const buildStorageObjectName = (fileOrName) => {
    const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
    const ext = getFileExtension(name);
    return ext ? `${randomId()}.${ext}` : randomId();
};

// Datei mit dem zur Endung passenden Content-Type hochladen. Browser melden für
// Office-Dateien oft '' oder 'application/octet-stream'; die Buckets erlauben aber
// nur bestimmte Typen. supabase-js übernimmt bei Blobs deren type-Feld.
export const prepareUploadBody = (file) => {
    const contentType = MIME_BY_EXTENSION[getFileExtension(file.name)] || file.type || 'application/octet-stream';
    const body = file.type === contentType ? file : new Blob([file], { type: contentType });
    return { body, contentType };
};

// Wandelt einen gespeicherten Wert (Pfad oder alte, vollständige Storage-URL) in einen
// Objektpfad des angegebenen Buckets um. Fremde Adressen ergeben null und werden nicht
// angezeigt (kein Tracking-Pixel/Phishing-Link über frei setzbare Felder).
export const extractStoragePath = (value, bucket) => {
    if (!value || typeof value !== 'string') return null;
    if (!/^https?:\/\//i.test(value)) return value;
    const markers = [
        `/storage/v1/object/public/${bucket}/`,
        `/storage/v1/object/sign/${bucket}/`,
        `/storage/v1/object/authenticated/${bucket}/`
    ];
    let supabaseOrigin = null;
    try {
        supabaseOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
    } catch {
        supabaseOrigin = null;
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (supabaseOrigin && url.origin !== supabaseOrigin) return null;
    for (const marker of markers) {
        const idx = url.pathname.indexOf(marker);
        if (idx !== -1) {
            try {
                return decodeURIComponent(url.pathname.substring(idx + marker.length));
            } catch {
                return null;
            }
        }
    }
    return null;
};

const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();

// Öffnet eine signierte URL in einem neuen Tab. createUrl: async () => string.
// Gibt null bei Erfolg zurück, sonst den Fehler (Aufrufer zeigt die Meldung an).
export const openSignedUrlInNewTab = async (createUrl) => {
    if (isNativeApp()) {
        // In der Android-App wie bisher: erst URL holen, dann öffnen.
        try {
            const url = await createUrl();
            if (!url) throw new Error('Keine Download-Adresse erhalten.');
            window.open(url, '_blank');
            return null;
        } catch (err) {
            return err;
        }
    }

    const win = window.open('', '_blank');
    if (win) {
        try {
            win.opener = null;
        } catch {
            // ignorieren
        }
    }
    try {
        const url = await createUrl();
        if (!url) throw new Error('Keine Download-Adresse erhalten.');
        if (win && !win.closed) {
            win.location.href = url;
        } else {
            window.location.assign(url);
        }
        return null;
    } catch (err) {
        if (win && !win.closed) win.close();
        return err;
    }
};
