// Reine Datums- und Serienlogik des Objektkalenders (ohne React/Supabase, mit Unit-Tests).
// Alle Datumswerte sind lokale Kalendertage im Format 'YYYY-MM-DD'.

// ── Datum ────────────────────────────────────────────────────
export const toIso = (d) => { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
// 'YYYY-MM-DD' als lokales Datum lesen (new Date('YYYY-MM-DD') wäre UTC-Mitternacht)
export const parseIsoLocal = (iso) => { const [y, m, d] = String(iso || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const isIsoDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && toIso(parseIsoLocal(iso)) === iso;
export const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
// Gleicher Tag n Monate später; fehlt der Tag im Zielmonat (29.–31.), wird der Monatsletzte genommen
export const addMonthsClamped = (base, n) => { const y = base.getFullYear(); const m = base.getMonth() + n; const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(base.getDate(), last)); };
// Serien und Reinigungsplan werden rollierend bis Ende des Folgejahres angelegt
export const planHorizonIso = (baseYear) => `${baseYear + 1}-12-31`;

// ── Wiederkehrende Zusatzaufgaben (eigene Regeln der App) ────
export const TASK_RULES = ['weekly', 'biweekly', 'monthly'];

// Termine einer wiederkehrenden Aufgabe vom Start bis endIso (Start eingeschlossen)
export const buildRecurringDates = (startIso, rule, endIso) => {
    const start = parseIsoLocal(startIso); const end = parseIsoLocal(endIso);
    const dates = [];
    for (let i = 0; i < 1000; i++) {
        const d = rule === 'weekly' ? addDays(start, 7 * i) : rule === 'biweekly' ? addDays(start, 14 * i) : addMonthsClamped(start, i);
        if (d > end) break;
        dates.push(toIso(d));
    }
    return dates;
};

export const nextRecurringDate = (iso, rule) => {
    const d = parseIsoLocal(iso);
    if (rule === 'weekly') return toIso(addDays(d, 7));
    if (rule === 'biweekly') return toIso(addDays(d, 14));
    return toIso(addMonthsClamped(d, 1));
};

const dayNumber = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

// Termine derselben Serie haben denselben Titel, dieselbe Regel, dieselbe Einheit und denselben
// „Takt" (Wochentag bzw. 14-Tage-Raster bzw. Tag im Monat) – so werden zwei Serien mit gleichem
// Titel an verschiedenen Wochentagen nicht vermischt.
const seriesPhase = (iso, rule) => {
    if (rule === 'weekly') return parseIsoLocal(iso).getDay();
    if (rule === 'biweekly') return ((dayNumber(iso) % 14) + 14) % 14;
    return Number(iso.slice(8, 10));
};

export const seriesKeyOf = (row) => [
    String(row.title || '').trim().toLowerCase(),
    row.recurrence_rule,
    row.assigned_unit_id || '',
    seriesPhase(row.event_date, row.recurrence_rule),
].join('|');

/**
 * Fasst Termine wiederkehrender Zusatzaufgaben zu Serien zusammen (je Serie der letzte Termin).
 * rows: objektkalender_events (event_type 'custom', recurring true).
 */
export const summarizeRecurringSeries = (rows) => {
    const byKey = new Map();
    (rows || []).forEach(row => {
        if (!TASK_RULES.includes(row?.recurrence_rule) || !isIsoDate(row.event_date) || !String(row.title || '').trim()) return;
        const key = seriesKeyOf(row);
        const cur = byKey.get(key);
        if (!cur || row.event_date > cur.lastDate) {
            byKey.set(key, {
                key,
                title: String(row.title).trim(),
                rule: row.recurrence_rule,
                assignedUnitId: row.assigned_unit_id || null,
                assignedUnitName: row.assigned_unit_name || null,
                color: row.color || null,
                pushEnabled: !!row.push_enabled,
                lastDate: row.event_date,
            });
        }
    });
    return Array.from(byKey.values()).sort((a, b) => a.lastDate.localeCompare(b.lastDate) || a.title.localeCompare(b.title));
};

// Eine Serie endete am Planungshorizont (Jahresende), wenn ihr nächster Termin im Folgejahr läge.
// Endet sie mitten im Jahr, wurde sie bewusst beendet („Diesen + alle zukünftigen löschen") und
// wird nicht fortgeschrieben.
export const endsAtYearEnd = (series) => nextRecurringDate(series.lastDate, series.rule).slice(0, 4) > series.lastDate.slice(0, 4);

/**
 * Folgetermine einer Serie bis horizonIso, im bisherigen Takt; nur Termine ab todayIso
 * (Lücken in der Vergangenheit werden nicht nachträglich als „überfällig" angelegt).
 */
export const planSeriesExtension = (series, { horizonIso, todayIso }) => {
    if (!series || !endsAtYearEnd(series) || series.lastDate >= horizonIso) return [];
    return buildRecurringDates(series.lastDate, series.rule, horizonIso)
        .slice(1)
        .filter(d => d >= todayIso);
};

// Serien, die fortgeschrieben werden können und vor limitIso enden
export const seriesEndingBefore = (seriesList, limitIso, horizonIso) =>
    (seriesList || []).filter(s => endsAtYearEnd(s) && s.lastDate < horizonIso && s.lastDate < limitIso);

// ── ICS-Import (RFC 5545, vereinfacht) ───────────────────────
const unescapeIcsText = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// Wert wie 20271231, 20271231T070000 oder 20271231T070000Z → lokales ISO-Datum
// (UTC-Zeitpunkte werden umgerechnet; TZID-/Ortszeiten gelten als lokaler Kalendertag)
const icsValueToIso = (value) => {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
    if (!m) return null;
    const iso = m[7]
        ? toIso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))))
        : `${m[1]}-${m[2]}-${m[3]}`;
    return isIsoDate(iso) ? iso : null;
};

const propertyValues = (block, name) => {
    const re = new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'gm');
    const out = [];
    let m;
    while ((m = re.exec(block)) !== null) out.push(m[1].trim());
    return out;
};

// Datumswerte: alles bis zum letzten Doppelpunkt gehört noch zu den Parametern
// (TZID-Namen wie „(GMT+01:00) Amsterdam" enthalten selbst Doppelpunkte)
const dateValuesOf = (block, name) => propertyValues(block, name).map(v => v.replace(/^.*:/, '').trim());

// Alle Datumswerte einer (ggf. mehrfach vorhandenen) Liste wie EXDATE/RDATE
const dateListOf = (block, name) => {
    const out = new Set();
    dateValuesOf(block, name).forEach(v => v.split(',').forEach(part => {
        const iso = icsValueToIso(part);
        if (iso) out.add(iso);
    }));
    return out;
};

const WEEKDAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPPORTED_FREQ = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const IGNORED_PARTS = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY'];

/** RRULE-Text → { freq, interval, count, untilIso, byDay } oder { unsupported: true } */
export const parseRrule = (text) => {
    const parts = {};
    String(text || '').split(';').forEach(p => {
        const idx = p.indexOf('=');
        if (idx > 0) parts[p.slice(0, idx).trim().toUpperCase()] = p.slice(idx + 1).trim();
    });
    const freq = (parts.FREQ || '').toUpperCase();
    if (!SUPPORTED_FREQ.includes(freq)) return { unsupported: true };
    if (Object.keys(parts).some(k => !IGNORED_PARTS.includes(k))) return { unsupported: true };
    const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
    if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return { unsupported: true };
    let count = null;
    if (parts.COUNT) {
        count = Number(parts.COUNT);
        if (!Number.isInteger(count) || count < 1) return { unsupported: true };
    }
    let untilIso = null;
    if (parts.UNTIL) {
        untilIso = icsValueToIso(parts.UNTIL);
        if (!untilIso) return { unsupported: true };
    }
    let byDay = null;
    if (parts.BYDAY) {
        // Nur bei WEEKLY und nur reine Wochentage (kein „2MO" o. Ä.)
        if (freq !== 'WEEKLY') return { unsupported: true };
        const codes = parts.BYDAY.split(',').map(s => s.trim().toUpperCase());
        if (!codes.length || codes.some(c => !(c in WEEKDAY_CODES))) return { unsupported: true };
        byDay = Array.from(new Set(codes.map(c => WEEKDAY_CODES[c])));
    }
    return { freq, interval, count, untilIso, byDay };
};

/**
 * Termine einer Regel ab startIso (DTSTART) bis endIso; COUNT zählt ab DTSTART.
 * Ausgelassene Termine (EXDATE) zählen bei COUNT mit (wie RFC 5545).
 * Ungültige Tage (31.02., 29.02. außerhalb von Schaltjahren) werden übersprungen.
 */
export const expandRrule = (startIso, rule, { endIso, fromIso = null, exdates = new Set(), maxDates = 5000 } = {}) => {
    const out = [];
    if (!rule || rule.unsupported || !isIsoDate(startIso)) return { dates: out, truncated: false };
    const limitIso = rule.untilIso && rule.untilIso < endIso ? rule.untilIso : endIso;
    const start = parseIsoLocal(startIso);
    let produced = 0;
    let truncated = false;
    const emit = (iso) => {
        produced += 1;
        if (exdates.has(iso) || (fromIso && iso < fromIso)) return true;
        if (out.length >= maxDates) { truncated = true; return false; }
        out.push(iso);
        return true;
    };
    const reachedCount = () => rule.count !== null && produced >= rule.count;
    const MAX_STEPS = 100000;

    if (rule.freq === 'WEEKLY' && rule.byDay) {
        // Woche beginnt montags (WKST=MO); je Intervall-Woche alle genannten Wochentage
        const monday = addDays(start, -((start.getDay() + 6) % 7));
        const offsets = rule.byDay.map(d => (d + 6) % 7).sort((a, b) => a - b);
        for (let w = 0; w < MAX_STEPS; w++) {
            const weekStart = addDays(monday, 7 * rule.interval * w);
            for (const off of offsets) {
                const iso = toIso(addDays(weekStart, off));
                if (iso < startIso) continue;
                if (iso > limitIso || reachedCount()) return { dates: out, truncated };
                if (!emit(iso)) return { dates: out, truncated };
            }
        }
        return { dates: out, truncated };
    }

    for (let i = 0; i < MAX_STEPS; i++) {
        let d;
        if (rule.freq === 'DAILY') d = addDays(start, i * rule.interval);
        else if (rule.freq === 'WEEKLY') d = addDays(start, 7 * i * rule.interval);
        else {
            const months = rule.freq === 'MONTHLY' ? i * rule.interval : 12 * i * rule.interval;
            const y = start.getFullYear(); const m = start.getMonth() + months;
            d = new Date(y, m, start.getDate());
            if (d.getDate() !== start.getDate()) {
                // Tag gibt es in diesem Monat nicht → kein Termin; Abbruch, sobald der Monat hinter dem Ende liegt
                if (toIso(new Date(y, m, 1)) > limitIso) break;
                continue;
            }
        }
        const iso = toIso(d);
        if (iso > limitIso || reachedCount()) break;
        if (!emit(iso)) break;
    }
    return { dates: out, truncated };
};

const classifyWaste = (summary) => {
    const l = summary.toLowerCase();
    if (l.includes('rest')) return 'restmuell';
    if (l.includes('bio')) return 'bio';
    if (l.includes('papier')) return 'papier';
    if (l.includes('gelb') || l.includes('wertstoff')) return 'gelbe_tonne';
    return 'sonstiger';
};

/**
 * Liest Mülltermine aus einer ICS-Datei.
 * Einfache Wiederholungsregeln (FREQ=DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL, COUNT oder UNTIL,
 * BYDAY nur bei WEEKLY mit reinen Wochentagen) werden bis untilIso aufgelöst, EXDATE/RDATE und
 * geänderte Einzeltermine (RECURRENCE-ID) beachtet. Serientermine vor fromIso entfallen.
 * Nicht unterstützte Regeln: nur der erste Termin (DTSTART), gezählt in unsupportedRules.
 */
export const parseIcs = (text, { fromIso = null, untilIso, maxEvents = 2000 } = {}) => {
    // Gefaltete Zeilen (RFC 5545, Fortsetzung beginnt mit Leerzeichen/Tab) entfalten
    const unfolded = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
    const blocks = unfolded.split('BEGIN:VEVENT').slice(1)
        .map(b => b.split('END:VEVENT')[0].replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, ''));

    // Geänderte/abgesagte Einzeltermine einer Serie: Original-Datum aus der Serie herausnehmen
    const overriddenByUid = new Map();
    blocks.forEach(block => {
        const uid = propertyValues(block, 'UID')[0];
        const rid = icsValueToIso(dateValuesOf(block, 'RECURRENCE-ID')[0]);
        if (!uid || !rid) return;
        if (!overriddenByUid.has(uid)) overriddenByUid.set(uid, new Set());
        overriddenByUid.get(uid).add(rid);
    });

    const events = [];
    let expandedRules = 0; let unsupportedRules = 0; let truncated = false;
    // Obergrenze für künftige Termine (vergangene Einzeltermine zählen nicht mit, der Aufrufer überspringt sie);
    // 2 × maxEvents reicht, damit der Aufrufer „zu viele Termine" nach dem Dublettenabgleich erkennt
    const hardLimit = maxEvents * 2;
    let relevant = 0;
    const pushEvent = (ev) => {
        events.push(ev);
        if (!fromIso || ev.date >= fromIso) relevant += 1;
    };
    for (const block of blocks) {
        if (relevant > hardLimit) { truncated = true; break; }
        if (/^STATUS(?:;[^:\n]*)?:\s*CANCELLED\s*$/im.test(block)) continue;
        const summary = unescapeIcsText(propertyValues(block, 'SUMMARY')[0] || '').slice(0, 200);
        const startIso = icsValueToIso(dateValuesOf(block, 'DTSTART')[0]);
        if (!startIso) continue;
        const base = { title: summary || 'Mülltermin', wasteType: classifyWaste(summary) };
        const rruleText = propertyValues(block, 'RRULE')[0];
        const isOverride = propertyValues(block, 'RECURRENCE-ID').length > 0;

        if (!rruleText || isOverride) {
            pushEvent({ ...base, date: startIso });
            continue;
        }
        const rule = parseRrule(rruleText);
        if (rule.unsupported || !untilIso) {
            unsupportedRules += 1;
            pushEvent({ ...base, date: startIso });
            continue;
        }
        expandedRules += 1;
        const uid = propertyValues(block, 'UID')[0];
        const exdates = new Set([...dateListOf(block, 'EXDATE'), ...(uid && overriddenByUid.get(uid) ? overriddenByUid.get(uid) : [])]);
        const { dates, truncated: cut } = expandRrule(startIso, rule, { endIso: untilIso, fromIso, exdates, maxDates: hardLimit + 1 });
        if (cut) truncated = true;
        dates.forEach(date => pushEvent({ ...base, date }));
        dateListOf(block, 'RDATE').forEach(date => {
            if (date <= untilIso && (!fromIso || date >= fromIso) && !exdates.has(date)) pushEvent({ ...base, date });
        });
    }
    return { events, expandedRules, unsupportedRules, truncated };
};
