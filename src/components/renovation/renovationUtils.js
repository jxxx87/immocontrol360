/**
 * Gemeinsame Hilfsfunktionen für den Sanierungsmanager
 * (Projekte, Wizard, Aufgaben, Bauzeitenplan, Sanierungsrechner, Grundriss-Bibliothek).
 */

const pad2 = (n) => String(n).padStart(2, '0');

/* ─── Datum ─────────────────────────────── */

// Lokales Kalenderdatum als 'YYYY-MM-DD'. toISOString() liefert UTC und damit in
// Deutschland zwischen 0 und 1/2 Uhr noch den Vortag.
export const localDateStr = (date = new Date()) =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// 'YYYY-MM-DD' (auch mit Zeitanteil) -> lokales Datum 00:00 Uhr; null bei ungültigem Wert.
// new Date('YYYY-MM-DD') würde dagegen UTC-Mitternacht liefern.
export const parseLocalDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
};

// Anzahl Kalendertage von a nach b (b - a), unabhängig von Uhrzeit und Sommerzeit
export const calendarDayDiff = (a, b) =>
    Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

// 'YYYY-MM-DD' -> 'TT.MM.JJJJ'
export const formatDateDE = (value, fallback = '—') => {
    const d = parseLocalDate(value);
    return d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : fallback;
};

/* ─── Geld ─────────────────────────────── */

export const round2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;

const eurFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eurFormatter0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

// Geldbetrag mit zwei Nachkommastellen (Rechnungen, Buchungen, Ist-Kosten)
export const fmtEUR = (v) => eurFormatter.format(Number(v) || 0);
// Gerundeter Betrag für Planwerte/Übersichten
export const fmtEUR0 = (v) => eurFormatter0.format(Number(v) || 0);

/* ─── Navigation ─────────────────────────────── */

// Rücksprungziel aus der URL nur als internen Pfad zulassen (genau ein führendes '/',
// kein '//' bzw. '/\' und keine Steuerzeichen), sonst Fallback.
export const safeInternalPath = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    const v = value.trim();
    if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback;
    for (let i = 0; i < v.length; i++) {
        if (v.charCodeAt(i) < 32) return fallback;
    }
    return v;
};

/* ─── Supabase ─────────────────────────────── */

// Ergebnis eines Schreibzugriffs prüfen. Supabase wirft nicht, sondern liefert { error };
// ein UPDATE/DELETE, das per RLS keine Zeile trifft, liefert zudem einfach 0 Zeilen.
// Daher bei Schreibzugriffen immer .select('id') anhängen und hier prüfen.
export const assertWrite = (res, what = 'Speichern') => {
    if (res?.error) throw res.error;
    if (Array.isArray(res?.data) && res.data.length === 0) {
        throw new Error(`${what} nicht möglich: keine Berechtigung oder Datensatz nicht gefunden.`);
    }
    return res?.data;
};
