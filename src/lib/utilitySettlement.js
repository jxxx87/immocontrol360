// =============================================================================
// Nebenkostenabrechnung – Rechenkern und Druckaufbereitung
//
// Reine Funktionen (kein React, kein Supabase). Assistent (Schritte „Verteilung"
// und „Abschluss"), Detailfenster und PDF rechnen alle mit denselben Funktionen,
// damit überall dieselben Zahlen stehen.
//
// Grundsätze:
//  - Datumsangaben als 'YYYY-MM-DD' ohne Zeitzonen-Umrechnung (kein new Date(iso)).
//  - Beträge in Cent; Restcents nach dem Größte-Reste-Verfahren, damit
//    „auf Mieter umgelegt + Leerstand + nicht abgerechnete Einheiten = Gesamtkosten".
//  - Belegung (Mietverhältnisse, Personen) wird für den Abrechnungszeitraum
//    ermittelt, nicht nach dem heutigen Stand.
//  - Fehlen Bezugsgrößen (Fläche, MEA, Verbrauch), wird nicht still mit 0 oder 1
//    gerechnet, sondern ein Fehler gemeldet.
// =============================================================================

import { DEFAULT_TEMPLATES } from './defaultTemplates';

const DAY_MS = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAR_FUTURE = '9999-12-31';

const isoPart = (v) => (v ? String(v).slice(0, 10) : '');
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const joinNonEmpty = (parts, sep = ' ') => parts.map(p => (p === null || p === undefined ? '' : String(p).trim())).filter(Boolean).join(sep);

// ── Datum ────────────────────────────────────────────────────────────────────
export const isValidISODate = (iso) => {
    const s = isoPart(iso);
    if (!ISO_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const isoToUTC = (iso) => {
    const [y, m, d] = isoPart(iso).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};
const utcToISO = (ms) => new Date(ms).toISOString().slice(0, 10);

export const daysInclusive = (startIso, endIso) => Math.round((isoToUTC(endIso) - isoToUTC(startIso)) / DAY_MS) + 1;
export const addDaysISO = (iso, n) => utcToISO(isoToUTC(iso) + n * DAY_MS);

export const addMonthsISO = (iso, n) => {
    const [y, m, d] = isoPart(iso).split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const ty = first.getUTCFullYear();
    const tm = first.getUTCMonth();
    const dim = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return utcToISO(Date.UTC(ty, tm, Math.min(d, dim)));
};

// Lokales Kalenderdatum (toISOString() wäre UTC und nachts in DE noch der Vortag)
export const localISODate = (date = new Date()) => {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatDateDE = (iso, fallback = '–') => {
    const s = isoPart(iso);
    if (!ISO_RE.test(s)) return fallback;
    const [y, m, d] = s.split('-');
    return `${d}.${m}.${y}`;
};

// Abrechnungsjahr: ein Kalenderjahr -> "2025", abweichender Zeitraum -> "2024/2025"
export const settlementYearLabel = (start, end) => {
    const y1 = isoPart(start).slice(0, 4);
    const y2 = isoPart(end).slice(0, 4);
    if (!y1) return '';
    return y2 && y2 !== y1 ? `${y1}/${y2}` : y1;
};

// Spätester Zugang beim Mieter: Ablauf des 12. Monats nach Ende des Zeitraums (§ 556 Abs. 3 BGB)
export const settlementDeadline = (periodEnd) => (isValidISODate(periodEnd) ? addMonthsISO(periodEnd, 12) : null);

export const validatePeriod = (start, end) => {
    const errors = [];
    const warnings = [];
    if (!isValidISODate(start) || !isValidISODate(end)) {
        errors.push('Bitte Beginn und Ende des Abrechnungszeitraums angeben.');
    } else if (isoPart(start) > isoPart(end)) {
        errors.push('Das Ende des Abrechnungszeitraums liegt vor dem Beginn.');
    } else {
        // 12 Monate enden am Vortag des gleichen Kalendertags im Folgejahr; fehlt dieser Tag
        // (Beginn 29.02.), mit dem Monatsletzten (§ 188 Abs. 2, 3 BGB) -> Folgebeginn 01.03.
        const sameDay = addMonthsISO(start, 12);
        const nextStart = sameDay.slice(8) === isoPart(start).slice(8) ? sameDay : addDaysISO(sameDay, 1);
        if (isoPart(end) >= nextStart) {
            warnings.push('Der Abrechnungszeitraum ist länger als 12 Monate. Nach § 556 Abs. 3 BGB ist über die Vorauszahlungen jährlich abzurechnen.');
        }
    }
    return { errors, warnings };
};

export const periodsOverlap = (aStart, aEnd, bStart, bEnd) =>
    isValidISODate(aStart) && isValidISODate(aEnd) && isValidISODate(bStart) && isValidISODate(bEnd) &&
    isoPart(aStart) <= isoPart(bEnd) && isoPart(bStart) <= isoPart(aEnd);

// Kalendermonate eines Zeitraums mit Anzahl der Tage im Zeitraum
export const monthsInRange = (startIso, endIso) => {
    const out = [];
    const s0 = isoPart(startIso);
    const e0 = isoPart(endIso);
    if (!isValidISODate(s0) || !isValidISODate(e0) || s0 > e0) return out;
    let [y, m] = s0.split('-').map(Number);
    const endKey = e0.slice(0, 7);
    for (let guard = 0; guard < 1200; guard++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        if (key > endKey) break;
        const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const first = `${key}-01`;
        const last = `${key}-${String(dim).padStart(2, '0')}`;
        const s = first < s0 ? s0 : first;
        const e = last > e0 ? e0 : last;
        out.push({ key, first, days: daysInclusive(s, e), daysInMonth: dim });
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return out;
};

// ── Zahlen / Geld ────────────────────────────────────────────────────────────
export const parseNumber = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

export const toCents = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(n) || n === 0) return 0;
    return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6);
};

export const centsToEuro = (cents) => (cents ? cents / 100 : 0);

export const formatEUR = (amount) => {
    const n = Number(amount) || 0;
    const v = Math.abs(n) < 0.005 ? 0 : n;
    return `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};
export const formatCents = (cents) => formatEUR(centsToEuro(cents));

export const formatNumberDE = (n, maxDigits = 2) =>
    (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: maxDigits });

// Verteilt einen Cent-Betrag exakt nach Gewichten (Größte-Reste-Verfahren)
export const allocateCents = (totalCents, weights) => {
    const w = weights.map(x => (Number.isFinite(x) && x > 0 ? x : 0));
    const sum = w.reduce((s, x) => s + x, 0);
    if (!(sum > 0) || !totalCents) return w.map(() => 0);
    const sign = totalCents < 0 ? -1 : 1;
    const abs = Math.abs(totalCents);
    const raw = w.map(x => (x / sum) * abs);
    const result = raw.map(r => Math.floor(r + 1e-9));
    let rest = abs - result.reduce((s, x) => s + x, 0);
    const order = raw.map((r, i) => ({ i, frac: r - result[i] }))
        .filter(o => w[o.i] > 0)
        .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
    for (let k = 0; rest > 0 && order.length > 0; k = (k + 1) % order.length) {
        result[order[k].i] += 1;
        rest -= 1;
    }
    return result.map(x => x * sign);
};

const splitByWeights = (cents, weights, fallbackWeights) => {
    let keys = Object.keys(weights || {});
    let vals = keys.map(k => weights[k]);
    if (!(vals.reduce((s, x) => s + (x > 0 ? x : 0), 0) > 0)) {
        keys = Object.keys(fallbackWeights || {});
        vals = keys.map(k => fallbackWeights[k]);
    }
    const alloc = allocateCents(cents, vals);
    const out = {};
    keys.forEach((k, i) => { out[k] = alloc[i]; });
    return out;
};

// ── HTML-Schutz ──────────────────────────────────────────────────────────────
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const BLOCKED_TAGS = new Set([
    'SCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE', 'STYLE',
    'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH'
]);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'srcset', 'data', 'lowsrc', 'dynsrc', 'ping', 'cite', 'longdesc']);

const isSafeUrl = (value, attrName) => {
    // eslint-disable-next-line no-control-regex
    const v = String(value || '').replace(/[\u0000- ]+/g, '').toLowerCase();
    if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false;
    if (v.startsWith('data:')) return attrName === 'src' && v.startsWith('data:image/') && !v.startsWith('data:image/svg');
    return true;
};

const sanitizeNodeTree = (root) => {
    Array.from(root.childNodes).forEach(child => {
        if (child.nodeType === 8) { child.remove(); return; }
        if (child.nodeType !== 1) return;
        if (BLOCKED_TAGS.has(String(child.tagName).toUpperCase())) { child.remove(); return; }
        Array.from(child.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
                child.removeAttribute(attr.name);
            } else if (URL_ATTRS.has(name) && !isSafeUrl(attr.value, name)) {
                child.removeAttribute(attr.name);
            } else if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:|@import|url\s*\(\s*['"]?\s*javascript:/i.test(attr.value)) {
                child.removeAttribute(attr.name);
            }
        });
        sanitizeNodeTree(child);
    });
};

const parseHtmlDocument = (html) =>
    new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${html || ''}</body></html>`, 'text/html');

// Entfernt aktive Inhalte (Skripte, Event-Handler, javascript:-URLs, eingebettete Objekte)
// aus Vorlagen-HTML. Wichtig, weil das PDF im Hauptdokument der App gerendert wird.
export const sanitizeTemplateHtml = (html) => {
    if (!html) return '';
    if (typeof DOMParser === 'undefined') return '';
    const doc = parseHtmlDocument(html);
    sanitizeNodeTree(doc.body);
    return doc.body.innerHTML;
};

// ── Verteilerschlüssel ──────────────────────────────────────────────────────
export const KEY_TYPE_INFO = {
    area: { label: 'Wohnfläche', short: 'Fläche', unit: 'm²' },
    persons: { label: 'Personen', short: 'Pers.', unit: 'Pers.-Tage' },
    units: { label: 'Wohneinheiten', short: 'Einh.', unit: 'Einh.' },
    equal: { label: 'Gleichverteilung', short: 'Gleich', unit: 'Einh.' },
    mea: { label: 'Miteigentumsanteile', short: 'MEA', unit: 'MEA' },
    custom: { label: 'Verbrauch / Einzelwerte', short: 'Verbr.', unit: 'Verbr.' },
    direct: { label: 'Direktzuordnung', short: 'Direkt', unit: '€' },
    heating_split: { label: 'HeizkostenV (Grund-/Verbrauchskosten)', short: 'HeizkV', unit: '' }
};

// Eingebauter Schlüssel für Heiz- und Warmwasserkosten (kein Datensatz in distribution_keys):
// Grundkosten nach Wohnfläche, Verbrauchskosten nach erfasstem Verbrauch je Einheit.
// Der Verbrauchsanteil (consumption_share am Kostenposten) muss nach §§ 7, 8 HeizkostenV
// zwischen 50 und 70 % liegen und wird ausdrücklich eingetragen (kein stiller Standardwert).
export const HEATING_SPLIT_KEY_ID = 'heizkostenv';
export const HEATING_SPLIT_MIN_SHARE = 50;
export const HEATING_SPLIT_MAX_SHARE = 70;

export const parseConsumptionShare = (value) => {
    const n = parseNumber(value);
    if (n === null || n < HEATING_SPLIT_MIN_SHARE || n > HEATING_SPLIT_MAX_SHARE) return null;
    return n;
};

const LEGACY_KEYS = {
    wohnflaeche: { type: 'area', name: 'Wohnfläche' },
    personenanzahl: { type: 'persons', name: 'Personen' },
    einheit: { type: 'units', name: 'Einheit' },
    anteil: { type: 'equal', name: 'Anteil' },
    verbrauch: { type: 'custom', name: 'Verbrauch' }
};

// Liefert { id, name, type, resolved }. Nicht auflösbare Schlüssel werden NICHT mehr
// still als Wohnfläche gerechnet.
export const resolveDistributionKey = (item, distributionKeys = []) => {
    const keyVal = item?.distribution_key || null;
    if (item?.unit_id) return { id: keyVal, name: 'Direkt (Einheit)', type: 'unit_direct', resolved: true };
    if (keyVal === HEATING_SPLIT_KEY_ID) return { id: keyVal, name: KEY_TYPE_INFO.heating_split.label, type: 'heating_split', resolved: true };
    const dk = (distributionKeys || []).find(k => k.id === keyVal);
    if (dk) {
        if (KEY_TYPE_INFO[dk.calculation_type]) return { id: dk.id, name: dk.name, type: dk.calculation_type, resolved: true };
        return { id: dk.id, name: dk.name, type: null, resolved: false, reason: `Schlüsseltyp „${dk.calculation_type}" wird nicht unterstützt.` };
    }
    if (keyVal && LEGACY_KEYS[keyVal]) return { id: keyVal, ...LEGACY_KEYS[keyVal], resolved: true };
    // Beim Speichern mitgeschriebener Name/Typ (z. B. Schlüssel inzwischen gelöscht)
    if (item?.key_type && KEY_TYPE_INFO[item.key_type]) {
        return { id: keyVal, name: item.key_name || KEY_TYPE_INFO[item.key_type].label, type: item.key_type, resolved: true, fromSaved: true };
    }
    return {
        id: keyVal, name: item?.key_name || null, type: null, resolved: false,
        reason: keyVal ? 'Verteilerschlüssel nicht gefunden (gelöscht oder nicht freigegeben).' : 'Kein Verteilerschlüssel gewählt.'
    };
};

export const isHeatingCostName = (name) =>
    /(heiz|wärme|waerme|warmwasser|brennstoff|pellet|\bgas\b)/i.test(String(name || ''));

// ── Mieter / Belegung ───────────────────────────────────────────────────────
export const tenantDisplayName = (t) => (t ? (joinNonEmpty([t.last_name, t.first_name], ', ') || 'Unbekannt') : 'Unbekannt');
export const tenantFullName = (t) => (t ? (joinNonEmpty([t.first_name, t.last_name], ' ') || 'Unbekannt') : 'Unbekannt');

// Belegung einer Einheit im Abrechnungszeitraum: je Mietvertrag ein Abschnitt („Zelle"),
// dazu ein zusammengefasster Leerstands-Abschnitt. Personen je Vertrag (Personentage).
export const buildUnitOccupancy = ({ unitId, leases, tenantsById, periodStart, periodEnd, vacancyPersons = 1 }) => {
    const ps = isoPart(periodStart);
    const pe = isoPart(periodEnd);
    const empty = { unitId, totalDays: 0, cells: [], leaseCells: [], overlap: false, vacancyDays: 0, personDays: 0, missingPersons: [] };
    if (!isValidISODate(ps) || !isValidISODate(pe) || ps > pe) return empty;
    const totalDays = daysInclusive(ps, pe);

    const leaseCells = [];
    (leases || []).forEach(l => {
        if (!l || l.unit_id !== unitId || !isValidISODate(l.start_date)) return;
        const ls = isoPart(l.start_date);
        const le = isValidISODate(l.end_date) ? isoPart(l.end_date) : FAR_FUTURE;
        if (ls > pe || le < ps || le < ls) return;
        const start = ls > ps ? ls : ps;
        const end = le < pe ? le : pe;
        const tenant = (l.tenant_id && tenantsById?.[l.tenant_id]) || l.tenant || null;
        const occ = parseInt(tenant?.occupants, 10);
        const personsMissing = !(occ > 0);
        leaseCells.push({
            key: l.id, kind: 'lease', leaseId: l.id, lease: l,
            tenantId: tenant?.id || l.tenant_id || null, tenant,
            displayName: tenantDisplayName(tenant), fullName: tenantFullName(tenant),
            lastName: tenant?.last_name || '',
            start, end, days: daysInclusive(start, end),
            persons: personsMissing ? 1 : occ, personsMissing
        });
    });
    leaseCells.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    // Leerstandslücken = nicht durch einen Vertrag abgedeckte Tage
    const gaps = [];
    let cursor = ps;
    leaseCells.forEach(c => {
        if (c.start > cursor) gaps.push({ start: cursor, end: addDaysISO(c.start, -1) });
        const next = addDaysISO(c.end, 1);
        if (next > cursor) cursor = next;
    });
    if (cursor <= pe) gaps.push({ start: cursor, end: pe });
    const vacancyDays = gaps.reduce((s, g) => s + daysInclusive(g.start, g.end), 0);
    const covered = totalDays - vacancyDays;
    const leaseDaySum = leaseCells.reduce((s, c) => s + c.days, 0);

    const cells = [...leaseCells];
    if (vacancyDays > 0) {
        cells.push({
            key: 'vacancy', kind: 'vacancy', leaseId: null, lease: null, tenantId: null, tenant: null,
            displayName: 'Leerstand', fullName: 'Leerstand', lastName: '',
            start: gaps[0].start, end: gaps[gaps.length - 1].end, gaps, days: vacancyDays,
            persons: Math.max(0, parseNumber(vacancyPersons) ?? 0), personsMissing: false
        });
    }
    // Bei überschneidenden Verträgen werden die Tagesanteile normiert (Summe = 100 %)
    const daySum = cells.reduce((s, c) => s + c.days, 0);
    cells.forEach(c => {
        c.ratio = daySum > 0 ? c.days / daySum : 0;
        c.personDays = c.persons * c.days;
    });
    return {
        unitId, totalDays, cells, leaseCells, overlap: leaseDaySum > covered, leaseDaySum,
        vacancyDays, personDays: cells.reduce((s, c) => s + c.personDays, 0),
        missingPersons: leaseCells.filter(c => c.personsMissing)
    };
};

// ── Verteilung der Kostenarten ──────────────────────────────────────────────
const unitName = (u) => u?.unit_name || 'Einheit';

export const computeDistribution = ({ costItems = [], houseUnits = [], occupancy = {}, distributionKeys = [] }) => {
    const byItem = {};
    costItems.forEach(item => {
        const key = resolveDistributionKey(item, distributionKeys);
        const totalCents = toCents(item.amount);
        const res = {
            itemId: item.id, key, totalCents, status: 'ok', message: '', warning: '',
            unitCents: {}, cellCents: {}, cellWeights: {},
            basis: { total: null, unitValues: {}, unitLabel: '' }
        };
        byItem[item.id] = res;
        const fail = (msg) => { res.status = 'error'; res.message = msg; };

        if (!houseUnits.length) return fail('Keine Einheiten im Objekt.');
        if (!key.resolved) return fail(key.reason || 'Verteilerschlüssel nicht gefunden.');

        const t = key.type;
        const dayWeightsFor = (uid) => Object.fromEntries((occupancy[uid]?.cells || []).map(c => [c.key, c.days]));
        const personWeightsFor = (uid) => Object.fromEntries((occupancy[uid]?.cells || []).map(c => [c.key, c.personDays]));

        // Direktzuordnung: feste Beträge je Einheit (Rest bleibt als Differenz sichtbar)
        if (t === 'direct') {
            const values = item.unit_values || {};
            res.basis.unitLabel = '€';
            houseUnits.forEach(u => {
                const v = parseNumber(values[u.id]);
                if (v === null || v === 0) return;
                const cents = toCents(v);
                res.unitCents[u.id] = cents;
                res.basis.unitValues[u.id] = v;
                const cw = dayWeightsFor(u.id);
                res.cellWeights[u.id] = cw;
                res.cellCents[u.id] = splitByWeights(cents, cw, cw);
            });
            return;
        }

        // HeizkostenV: Grundkosten nach Wohnfläche + Verbrauchskosten nach Verbrauch, je Teil
        // cent-genau verteilt (Größte-Reste-Verfahren); Summe beider Teile = Gesamtkosten.
        if (t === 'heating_split') {
            const share = parseConsumptionShare(item.consumption_share);
            if (share === null) return fail(`Verbrauchsanteil fehlt oder liegt nicht zwischen ${HEATING_SPLIT_MIN_SHARE} und ${HEATING_SPLIT_MAX_SHARE} % (§§ 7, 8 HeizkostenV) – bitte in Schritt „Kosten" eintragen.`);
            const missingArea = houseUnits.filter(u => parseNumber(u.sqm) === null);
            if (missingArea.length) return fail(`Wohnfläche fehlt für: ${missingArea.map(unitName).join(', ')} (die Grundkosten werden nach Wohnfläche verteilt; bitte in den Einheiten hinterlegen).`);
            const values = item.unit_values || {};
            const missingCons = houseUnits.filter(u => parseNumber(values[u.id]) === null);
            if (missingCons.length) return fail(`Verbrauchswerte fehlen für: ${missingCons.map(unitName).join(', ')} (in Schritt „Kosten" eintragen oder aus Zählerständen übernehmen).`);
            const negative = houseUnits.filter(u => parseNumber(values[u.id]) < 0);
            if (negative.length) return fail(`Negative Verbrauchswerte bei: ${negative.map(unitName).join(', ')}.`);
            const areaWeights = {};
            const consWeights = {};
            houseUnits.forEach(u => {
                areaWeights[u.id] = Math.max(0, parseNumber(u.sqm) || 0);
                consWeights[u.id] = parseNumber(values[u.id]);
            });
            const areaTotal = Object.values(areaWeights).reduce((s, x) => s + x, 0);
            const consTotal = Object.values(consWeights).reduce((s, x) => s + x, 0);
            if (!(areaTotal > 0)) return fail('Die Summe der Wohnflächen ist 0 – die Grundkosten können nicht verteilt werden.');
            if (!(consTotal > 0)) return fail('Die Summe der Verbrauchswerte ist 0 – die Verbrauchskosten können nicht verteilt werden.');
            const zero = houseUnits.filter(u => !(areaWeights[u.id] > 0));
            if (zero.length) res.warning = `Ohne Fläche (0 m²), tragen keine Grundkosten: ${zero.map(unitName).join(', ')}.`;

            const sign = totalCents < 0 ? -1 : 1;
            const consCents = sign * Math.round((Math.abs(totalCents) * share) / 100);
            const baseCents = totalCents - consCents;
            const allocatePart = (cents, weights) => {
                const part = { unitCents: {}, cellCents: {} };
                const flat = [];
                houseUnits.forEach(u => {
                    part.unitCents[u.id] = 0;
                    part.cellCents[u.id] = {};
                    const w = weights[u.id] || 0;
                    if (!(w > 0)) return;
                    const cw = dayWeightsFor(u.id);
                    const cwSum = Object.values(cw).reduce((s, x) => s + x, 0);
                    Object.keys(cw).forEach(k => {
                        if (cw[k] > 0) flat.push({ uid: u.id, cell: k, weight: (w * cw[k]) / cwSum });
                    });
                });
                const alloc = allocateCents(cents, flat.map(f => f.weight));
                flat.forEach((f, i) => {
                    part.unitCents[f.uid] += alloc[i];
                    part.cellCents[f.uid][f.cell] = (part.cellCents[f.uid][f.cell] || 0) + alloc[i];
                });
                return part;
            };
            const basePart = allocatePart(baseCents, areaWeights);
            const consPart = allocatePart(consCents, consWeights);
            houseUnits.forEach(u => {
                res.unitCents[u.id] = basePart.unitCents[u.id] + consPart.unitCents[u.id];
                const cells = {};
                [basePart.cellCents[u.id], consPart.cellCents[u.id]].forEach(src => {
                    Object.entries(src).forEach(([k, c]) => { cells[k] = (cells[k] || 0) + c; });
                });
                res.cellCents[u.id] = cells;
                if (areaWeights[u.id] > 0 || consWeights[u.id] > 0) res.cellWeights[u.id] = dayWeightsFor(u.id);
            });
            res.basis.unitLabel = '';
            res.split = {
                consumptionShare: share,
                baseShare: 100 - share,
                baseCents,
                consumptionCents: consCents,
                area: { total: areaTotal, unitValues: areaWeights, unitLabel: 'm²', unitCents: basePart.unitCents, cellCents: basePart.cellCents },
                consumption: { total: consTotal, unitValues: consWeights, unitLabel: item.consumption_unit || 'Verbr.', unitCents: consPart.unitCents, cellCents: consPart.cellCents }
            };
            return;
        }

        const unitWeights = {};
        if (t === 'unit_direct') {
            if (!houseUnits.some(u => u.id === item.unit_id)) return fail('Die gebuchte Einheit gehört nicht zu diesem Objekt.');
            unitWeights[item.unit_id] = 1;
        } else if (t === 'area') {
            const missing = houseUnits.filter(u => parseNumber(u.sqm) === null);
            if (missing.length) return fail(`Wohnfläche fehlt für: ${missing.map(unitName).join(', ')} (bitte in den Einheiten hinterlegen).`);
            const zero = houseUnits.filter(u => !(parseNumber(u.sqm) > 0));
            if (zero.length) res.warning = `Ohne Fläche (0 m²), tragen keine Flächenkosten: ${zero.map(unitName).join(', ')}.`;
            houseUnits.forEach(u => { unitWeights[u.id] = Math.max(0, parseNumber(u.sqm) || 0); });
            res.basis.unitLabel = 'm²';
        } else if (t === 'units' || t === 'equal') {
            houseUnits.forEach(u => { unitWeights[u.id] = 1; });
            res.basis.unitLabel = 'Einh.';
        } else if (t === 'mea') {
            const zero = houseUnits.filter(u => !(parseNumber(u.ownership_share) > 0));
            if (zero.length === houseUnits.length) return fail('Miteigentumsanteile sind für keine Einheit hinterlegt (bitte in den Einheiten erfassen).');
            if (zero.length) res.warning = `Ohne Miteigentumsanteil, tragen keine Kosten: ${zero.map(unitName).join(', ')}.`;
            houseUnits.forEach(u => { unitWeights[u.id] = Math.max(0, parseNumber(u.ownership_share) || 0); });
            res.basis.unitLabel = 'MEA';
        } else if (t === 'persons') {
            houseUnits.forEach(u => { unitWeights[u.id] = occupancy[u.id]?.personDays || 0; });
            res.basis.unitLabel = 'Pers.-Tage';
        } else if (t === 'custom') {
            const values = item.unit_values || {};
            const missing = houseUnits.filter(u => parseNumber(values[u.id]) === null);
            if (missing.length) return fail(`Verbrauchswerte fehlen für: ${missing.map(unitName).join(', ')} (in Schritt „Kosten" eintragen oder aus Zählerständen übernehmen).`);
            const negative = houseUnits.filter(u => parseNumber(values[u.id]) < 0);
            if (negative.length) return fail(`Negative Verbrauchswerte bei: ${negative.map(unitName).join(', ')}.`);
            houseUnits.forEach(u => { unitWeights[u.id] = parseNumber(values[u.id]); });
            res.basis.unitLabel = item.consumption_unit || 'Verbr.';
        } else {
            return fail('Schlüsseltyp wird nicht unterstützt.');
        }

        const totalWeight = Object.values(unitWeights).reduce((s, x) => s + (x > 0 ? x : 0), 0);
        res.basis.total = t === 'unit_direct' ? null : totalWeight;
        res.basis.unitValues = { ...unitWeights };
        if (!(totalWeight > 0)) {
            return fail(t === 'persons' ? 'Im Abrechnungszeitraum sind keine Personen erfasst.' : 'Die Summe der Bezugsgrößen ist 0.');
        }

        // Alle Einheiten des Hauses und ihre Abschnitte gemeinsam runden -> Summe exakt
        const flat = [];
        houseUnits.forEach(u => {
            const w = unitWeights[u.id] || 0;
            res.unitCents[u.id] = 0;
            res.cellCents[u.id] = {};
            if (!(w > 0)) return;
            const cw = t === 'persons' ? personWeightsFor(u.id) : dayWeightsFor(u.id);
            res.cellWeights[u.id] = cw;
            const cwSum = Object.values(cw).reduce((s, x) => s + x, 0);
            Object.keys(cw).forEach(k => {
                if (!(cw[k] > 0)) return;
                flat.push({ uid: u.id, cell: k, weight: t === 'persons' ? cw[k] : (w * cw[k]) / cwSum });
            });
        });
        const alloc = allocateCents(totalCents, flat.map(f => f.weight));
        flat.forEach((f, i) => {
            res.unitCents[f.uid] += alloc[i];
            res.cellCents[f.uid][f.cell] = (res.cellCents[f.uid][f.cell] || 0) + alloc[i];
        });
    });
    return byItem;
};

// Zeilen je ausgewählter Einheit: berechnete Anteile + manuelle Korrekturen + Zusatzpositionen.
// unitOverrides[uid][costItemId] = { amount?, label?, removed? }
export const buildUnitRows = ({ costItems = [], selectedUnitIds = [], distribution = {}, occupancy = {}, unitOverrides = {}, customRows = {} }) => {
    const out = {};
    selectedUnitIds.forEach(uid => {
        const rows = [];
        const dayWeights = Object.fromEntries((occupancy[uid]?.cells || []).map(c => [c.key, c.days]));
        costItems.forEach(item => {
            const d = distribution[item.id];
            if (!d) return;
            if (d.key.type === 'unit_direct' && item.unit_id !== uid) return;
            const ov = unitOverrides?.[uid]?.[item.id] || {};
            if (ov.removed) return;
            const hasAmountOverride = ov.amount !== undefined && ov.amount !== null && parseNumber(ov.amount) !== null;
            const computedCents = d.status === 'ok' ? (d.unitCents[uid] || 0) : 0;
            // Ohne Anteil nur anzeigen, wenn ein Fehler vorliegt (Hinweis statt stiller 0)
            if (!hasAmountOverride && d.status === 'ok' && computedCents === 0) return;
            const amountCents = hasAmountOverride ? toCents(ov.amount) : computedCents;
            const split = (!hasAmountOverride && d.status === 'ok')
                ? { ...(d.cellCents[uid] || {}) }
                : splitByWeights(amountCents, d.cellWeights[uid] || dayWeights, dayWeights);
            const hasLabelOverride = typeof ov.label === 'string';
            rows.push({
                id: item.id, cost_item_id: item.id,
                label: hasLabelOverride ? ov.label : (item.category_name || ''),
                amount: centsToEuro(amountCents), amountCents, computedCents,
                overridden: hasAmountOverride, labelOverridden: hasLabelOverride,
                split, status: d.status, message: d.message,
                keyType: d.key.type, keyName: d.key.name, isCustom: false
            });
        });
        (customRows?.[uid] || []).forEach(cr => {
            const amountCents = toCents(cr.amount);
            rows.push({
                id: cr.id, cost_item_id: null, label: cr.label || '',
                amount: centsToEuro(amountCents), amountCents, computedCents: amountCents,
                overridden: false, labelOverridden: false,
                split: splitByWeights(amountCents, dayWeights, dayWeights), status: 'ok', message: '',
                keyType: 'manual', keyName: 'Direktzuordnung (manuell)', isCustom: true
            });
        });
        out[uid] = rows;
    });
    return out;
};

// ── Vorauszahlungen ──────────────────────────────────────────────────────────
// Miethistorie: letzter Zeitraum mit Monat(valid_from) <= Monat; davor gilt der erste.
const pickRentPeriod = (sortedPeriods, monthKey) => {
    if (!sortedPeriods || !sortedPeriods.length) return null;
    let chosen = sortedPeriods[0];
    for (const p of sortedPeriods) {
        if (isoPart(p.valid_from).slice(0, 7) <= monthKey) chosen = p;
        else break;
    }
    return chosen;
};

// Soll = Vorauszahlung des jeweiligen Monats (Miethistorie, sonst Vertrag) taggenau anteilig.
// Ist  = gebuchte Zahlungen des Monats, vorrangig auf die Vorauszahlungen angerechnet
//        (erst Betriebskosten, dann Heizkosten), je Monat höchstens das Soll.
//        Keine Quote gegen die heutige Gesamtmiete: ohne Miethistorie würde eine spätere
//        Kaltmieterhöhung sonst voll gezahlte Vorauszahlungen zu niedrig ansetzen.
export const computeLeasePrepayment = ({ lease, start, end, rentPeriods = null, payments = null }) => {
    const months = monthsInRange(start, end);
    const sortedPeriods = (rentPeriods || []).slice().sort((a, b) => isoPart(a.valid_from).localeCompare(isoPart(b.valid_from)));
    const paidByMonth = {};
    (payments || []).forEach(p => {
        const ref = isoPart(p.period_month) || isoPart(p.payment_date);
        if (!ref) return;
        const k = ref.slice(0, 7);
        paidByMonth[k] = (paidByMonth[k] || 0) + (parseFloat(p.amount) || 0);
    });
    let sollSvc = 0; let sollHeat = 0; let istSvc = 0; let istHeat = 0; let monthsCount = 0;
    months.forEach(m => {
        const src = pickRentPeriod(sortedPeriods, m.key) || lease || {};
        const svc = parseFloat(src.service_charge) || 0;
        const heat = parseFloat(src.heating_cost) || 0;
        const frac = m.days / m.daysInMonth;
        const svcDue = Math.max(0, svc * frac);
        const heatDue = Math.max(0, heat * frac);
        const paid = Math.max(0, paidByMonth[m.key] || 0);
        const svcPaid = Math.min(svcDue, paid);
        const heatPaid = Math.min(heatDue, paid - svcPaid);
        sollSvc += svc * frac;
        sollHeat += heat * frac;
        istSvc += svcPaid;
        istHeat += heatPaid;
        monthsCount += frac;
    });
    return {
        sollSvc: centsToEuro(toCents(sollSvc)), sollHeat: centsToEuro(toCents(sollHeat)),
        istSvc: centsToEuro(toCents(istSvc)), istHeat: centsToEuro(toCents(istHeat)),
        months: Math.round(monthsCount * 100) / 100,
        hasPaymentData: Array.isArray(payments) && payments.length > 0,
        historyUsed: sortedPeriods.length > 0
    };
};

// ── Zählerstände ─────────────────────────────────────────────────────────────
// Verbrauch je Einheit = Summe (Endstand − Anfangsstand) der Einheitenzähler der gewählten Art.
// Als Stand gilt jeweils die Ablesung, die dem Stichtag am nächsten liegt (max. windowDays entfernt).
export const computeMeterConsumption = ({ meters = [], readings = [], periodStart, periodEnd, meterType, windowDays = 45 }) => {
    const byUnit = {};
    const pickClosest = (list, target) => {
        let best = null;
        list.forEach(r => {
            if (!isValidISODate(r.reading_date)) return;
            const dist = Math.abs(daysInclusive(target, r.reading_date) - 1);
            if (dist > windowDays) return;
            if (!best || dist < best.dist) best = { ...r, dist };
        });
        return best;
    };
    meters.filter(m => m.unit_id && (m.meter_type || '') === (meterType || '')).forEach(m => {
        const list = readings.filter(r => r.meter_id === m.id);
        const s = pickClosest(list, periodStart);
        const e = pickClosest(list, periodEnd);
        const entry = byUnit[m.unit_id] || { value: 0, complete: true, details: [] };
        if (!s || !e || s.id === e.id || isoPart(e.reading_date) <= isoPart(s.reading_date)) {
            entry.complete = false;
            entry.details.push({ meter: m.meter_number || m.meter_name || 'Zähler', error: 'Ablesung am Anfang oder Ende des Zeitraums fehlt' });
        } else {
            const diff = (parseFloat(e.reading_value) || 0) - (parseFloat(s.reading_value) || 0);
            if (diff < 0) {
                entry.complete = false;
                entry.details.push({ meter: m.meter_number || m.meter_name || 'Zähler', error: 'Endstand kleiner als Anfangsstand' });
            } else {
                entry.value += diff;
                entry.details.push({ meter: m.meter_number || m.meter_name || 'Zähler', start: { date: s.reading_date, value: s.reading_value }, end: { date: e.reading_date, value: e.reading_value }, consumption: diff });
            }
        }
        byUnit[m.unit_id] = entry;
    });
    Object.values(byUnit).forEach(e => { e.value = Math.round(e.value * 1000) / 1000; });
    return byUnit;
};

// ── Anzeige der Bezugsgrößen je Mieterabschnitt ─────────────────────────────
const describeItemForCell = (row, cell, occ, d) => {
    const base = {
        rowId: row.id, cost_item_id: row.cost_item_id, label: row.label,
        keyName: row.keyName || '', keyType: row.keyType || '',
        status: row.status, message: row.message || '', manual: !!(row.overridden || row.isCustom),
        totalCost: (d && !row.isCustom) ? centsToEuro(d.totalCents) : null,
        basisTotal: null, basisUnit: null, unitLabel: '', costPerBasis: null,
        timeText: occ?.totalDays ? `${cell.days}/${occ.totalDays} Tage` : ''
    };
    if (!d || row.isCustom || d.status !== 'ok') return base;
    const t = d.key.type;
    if (t === 'heating_split' && d.split) {
        // Ohne Handkorrektur: Grund- und Verbrauchskosten als eigene Zeilen ausweisen
        if (!row.overridden) {
            const s = d.split;
            const part = (kind, share, keyName, cents, info) => {
                const shareCents = info.cellCents?.[occ.unitId]?.[cell.key] || 0;
                const totalCost = centsToEuro(cents);
                return {
                    kind, label: `${row.label} – ${kind === 'base' ? 'Grundkosten' : 'Verbrauchskosten'} (${formatNumberDE(share, 2)} %)`,
                    keyName, totalCost, basisTotal: info.total, basisUnit: info.unitValues?.[occ.unitId] ?? null,
                    unitLabel: info.unitLabel, costPerBasis: info.total > 0 ? totalCost / info.total : null,
                    timeText: base.timeText, shareCents, share: centsToEuro(shareCents)
                };
            };
            base.parts = [
                part('base', s.baseShare, 'Wohnfläche', s.baseCents, s.area),
                part('consumption', s.consumptionShare, 'Verbrauch', s.consumptionCents, s.consumption)
            ];
        }
        return base;
    }
    if (t === 'persons') {
        base.basisTotal = d.basis.total;
        base.basisUnit = cell.personDays;
        base.unitLabel = 'Pers.-Tage';
        base.timeText = `${cell.persons} P. × ${cell.days} T.`;
    } else if (t !== 'direct' && t !== 'unit_direct') {
        base.basisTotal = d.basis.total;
        base.basisUnit = d.basis.unitValues?.[occ.unitId] ?? null;
        base.unitLabel = d.basis.unitLabel || '';
    }
    base.costPerBasis = base.basisTotal > 0 ? base.totalCost / base.basisTotal : null;
    return base;
};

// ── Gesamtberechnung ─────────────────────────────────────────────────────────
// prepayData = { loaded, historyAvailable, paymentsAvailable, rentPeriodsByLease, paymentsByLease }
export const computeSettlement = ({
    periodStart, periodEnd, houseUnits = [], selectedUnitIds = [], leases = [], tenantsById = {},
    distributionKeys = [], costItems = [], unitOverrides = {}, customRows = {}, prepayOverrides = {},
    options = {}, prepayData = null, today = localISODate()
}) => {
    const opts = { includeHeatingPrepay: null, vacancyPersons: 1, ...(options || {}) };
    const unitsById = Object.fromEntries(houseUnits.map(u => [u.id, u]));
    const selected = selectedUnitIds.filter(uid => unitsById[uid]);
    const occupancy = {};
    houseUnits.forEach(u => {
        occupancy[u.id] = buildUnitOccupancy({ unitId: u.id, leases, tenantsById, periodStart, periodEnd, vacancyPersons: opts.vacancyPersons });
    });
    const distribution = computeDistribution({ costItems, houseUnits, occupancy, distributionKeys });
    const unitRows = buildUnitRows({ costItems, selectedUnitIds: selected, distribution, occupancy, unitOverrides, customRows });

    const heatingDetected = costItems.some(ci => isHeatingCostName(ci.category_name));
    const includeHeating = (opts.includeHeatingPrepay === null || opts.includeHeatingPrepay === undefined)
        ? heatingDetected : !!opts.includeHeatingPrepay;

    const pages = [];
    const vacancies = [];
    let heatPrepayAvailable = 0;
    selected.forEach(uid => {
        const unit = unitsById[uid];
        const occ = occupancy[uid];
        const rows = unitRows[uid] || [];
        occ.cells.forEach(cell => {
            const items = rows.map(row => {
                const shareCents = row.split?.[cell.key] || 0;
                return { ...describeItemForCell(row, cell, occ, distribution[row.cost_item_id]), shareCents, share: centsToEuro(shareCents) };
            }).filter(it => it.shareCents !== 0 || it.status === 'error' || it.manual);
            const totalCents = items.reduce((s, it) => s + it.shareCents, 0);
            if (cell.kind === 'vacancy') {
                vacancies.push({ unitId: uid, unitName: unit.unit_name, days: cell.days, gaps: cell.gaps, totalCents });
                return;
            }
            const pp = computeLeasePrepayment({
                lease: cell.lease, start: cell.start, end: cell.end,
                rentPeriods: prepayData?.historyAvailable ? (prepayData.rentPeriodsByLease?.[cell.leaseId] || []) : null,
                payments: prepayData?.paymentsAvailable ? (prepayData.paymentsByLease?.[cell.leaseId] || []) : null
            });
            heatPrepayAvailable += Math.max(pp.sollHeat, pp.istHeat);
            const ov = prepayOverrides?.[cell.leaseId] || {};
            const auto = pp.hasPaymentData ? 'ist' : 'soll';
            const svcOverride = parseNumber(ov.svc);
            const heatOverride = parseNumber(ov.heat);
            const svcCents = toCents(svcOverride !== null ? svcOverride : (auto === 'ist' ? pp.istSvc : pp.sollSvc));
            const heatCents = includeHeating ? toCents(heatOverride !== null ? heatOverride : (auto === 'ist' ? pp.istHeat : pp.sollHeat)) : 0;
            const prepayCents = svcCents + heatCents;
            const balanceCents = totalCents - prepayCents;
            pages.push({
                key: `${uid}:${cell.leaseId}`, unitId: uid, unitName: unit.unit_name, propertyId: unit.property_id,
                leaseId: cell.leaseId, tenantId: cell.tenantId,
                tenantDisplayName: cell.displayName, tenantFullName: cell.fullName, tenantLastName: cell.lastName,
                start: cell.start, end: cell.end, days: cell.days, totalDays: occ.totalDays, ratio: cell.ratio,
                persons: cell.persons, personsMissing: cell.personsMissing,
                sqm: parseNumber(unit.sqm),
                items, totalCents,
                prepay: {
                    svcCents, heatCents, totalCents: prepayCents, includeHeating,
                    source: (svcOverride !== null || heatOverride !== null) ? 'manual' : auto,
                    svcOverridden: svcOverride !== null, heatOverridden: heatOverride !== null,
                    sollSvc: pp.sollSvc, sollHeat: pp.sollHeat, istSvc: pp.istSvc, istHeat: pp.istHeat,
                    months: pp.months, hasPaymentData: pp.hasPaymentData, historyUsed: pp.historyUsed,
                    loaded: !!prepayData?.loaded
                },
                balanceCents,
                balanceType: balanceCents === 0 ? 'even' : (balanceCents > 0 ? 'nachzahlung' : 'guthaben')
            });
        });
    });

    // Summenprobe je Kostenart: umgelegt + Leerstand + nicht abgerechnete Einheiten = Gesamtkosten
    const sumCheck = costItems.map(item => {
        const d = distribution[item.id];
        const totalCents = toCents(item.amount);
        let tenantsCents = 0; let vacancyCents = 0; let otherUnitsCents = 0;
        selected.forEach(uid => {
            const row = (unitRows[uid] || []).find(r => r.cost_item_id === item.id);
            if (!row) return;
            Object.entries(row.split || {}).forEach(([k, c]) => {
                if (k === 'vacancy') vacancyCents += c; else tenantsCents += c;
            });
        });
        if (d && d.status === 'ok') {
            houseUnits.forEach(u => { if (!selected.includes(u.id)) otherUnitsCents += d.unitCents[u.id] || 0; });
        }
        return {
            itemId: item.id, label: item.category_name || 'Kostenart', totalCents, tenantsCents, vacancyCents, otherUnitsCents,
            diffCents: totalCents - tenantsCents - vacancyCents - otherUnitsCents,
            status: d?.status || 'error', message: d?.message || '', warning: d?.warning || '', keyType: d?.key?.type || null
        };
    });
    const customCents = selected.reduce((s, uid) => s + (unitRows[uid] || []).filter(r => r.isCustom).reduce((a, r) => a + r.amountCents, 0), 0);

    // Hinweise / Fehler
    const issues = [];
    const pv = validatePeriod(periodStart, periodEnd);
    pv.errors.forEach(text => issues.push({ level: 'error', text }));
    pv.warnings.forEach(text => issues.push({ level: 'warning', text }));
    const lostUnits = selectedUnitIds.length - selected.length;
    if (lostUnits > 0) issues.push({ level: 'warning', text: `${lostUnits} ausgewählte Einheit(en) gehören nicht mehr zu diesem Objekt und werden nicht abgerechnet.` });
    sumCheck.forEach(sc => {
        if (sc.status === 'error') {
            if (sc.totalCents !== 0) issues.push({ level: 'error', text: `${sc.label}: ${sc.message} ${formatCents(sc.totalCents)} werden derzeit nicht verteilt.` });
        } else if (sc.diffCents !== 0) {
            issues.push({ level: 'warning', text: `${sc.label}: Die Anteile ergeben ${formatCents(sc.totalCents - sc.diffCents)} statt ${formatCents(sc.totalCents)} (Differenz ${formatCents(sc.diffCents)}), z. B. durch manuelle Änderungen.` });
        }
        if (sc.warning) issues.push({ level: 'warning', text: `${sc.label}: ${sc.warning}` });
    });
    if (customCents !== 0) issues.push({ level: 'info', text: `Zusätzlich manuell erfasste Einzelpositionen: ${formatCents(customCents)} (nicht Teil der Gesamtkosten).` });
    selected.forEach(uid => {
        const occ = occupancy[uid];
        if (occ.overlap) issues.push({ level: 'warning', text: `${unitsById[uid].unit_name}: Mietverträge überschneiden sich im Zeitraum (${occ.leaseDaySum} Vertragstage bei ${occ.totalDays} Tagen). Die Kosten wurden nach Tagen anteilig aufgeteilt – bitte Vertragsdaten prüfen.` });
    });
    const personsUsed = sumCheck.some(sc => sc.keyType === 'persons' && sc.status === 'ok');
    if (personsUsed) {
        const missing = houseUnits.flatMap(u => occupancy[u.id].missingPersons.map(c => `${c.displayName} (${u.unit_name})`));
        if (missing.length) issues.push({ level: 'warning', text: `Personenzahl nicht hinterlegt, mit 1 Person angesetzt: ${missing.join(', ')}.` });
        if (houseUnits.some(u => occupancy[u.id].vacancyDays > 0)) {
            issues.push({ level: 'info', text: `Leerstand wird beim Personenschlüssel mit ${opts.vacancyPersons} Person(en) angesetzt; dieser Anteil trägt der Vermieter.` });
        }
    }
    if (!includeHeating && heatPrepayAvailable > 0) {
        issues.push({ level: 'warning', text: 'Heizkosten-Vorauszahlungen werden nicht angerechnet, weil in dieser Abrechnung keine Heizkosten enthalten sind. Falls doch, bitte „Heizkosten-Vorauszahlungen anrechnen" aktivieren.' });
    }
    if (includeHeating && !heatingDetected && heatPrepayAvailable > 0) {
        issues.push({ level: 'warning', text: 'Heizkosten-Vorauszahlungen werden angerechnet, es wurde aber keine Heizkosten-Position erkannt. Bitte prüfen.' });
    }
    costItems.forEach(ci => {
        const d = distribution[ci.id];
        if (isHeatingCostName(ci.category_name) && d?.status === 'ok' && !['custom', 'unit_direct', 'heating_split'].includes(d.key.type)) {
            issues.push({ level: 'info', text: `${ci.category_name}: Heiz- und Warmwasserkosten sind nach der HeizkostenV überwiegend (50–70 %) nach Verbrauch zu verteilen. Gewählt ist „${d.key.name}". Für die Aufteilung in Grund- und Verbrauchskosten steht der Schlüssel „${KEY_TYPE_INFO.heating_split.label}" zur Verfügung.` });
        }
    });
    const deadline = settlementDeadline(periodEnd);
    if (deadline && today > deadline) {
        issues.push({ level: 'warning', text: `Die Abrechnungsfrist (§ 556 Abs. 3 BGB) ist am ${formatDateDE(deadline)} abgelaufen; Nachforderungen sind dann in der Regel ausgeschlossen.` });
    }
    if (prepayData?.loaded) {
        if (!prepayData.paymentsAvailable) {
            issues.push({ level: 'warning', text: 'Zahlungseingänge konnten nicht geladen werden – als Vorauszahlung ist das Soll laut Vertrag angesetzt. Bitte prüfen und ggf. je Mieter anpassen.' });
        } else {
            const noPay = pages.filter(p => !p.prepay.hasPaymentData && p.prepay.source !== 'manual').map(p => p.tenantDisplayName);
            if (noPay.length) issues.push({ level: 'info', text: `Keine Zahlungen im Mietkonto gefunden, Soll-Vorauszahlung angesetzt: ${noPay.join(', ')}.` });
        }
        if (!prepayData.historyAvailable) {
            issues.push({ level: 'info', text: 'Die Miethistorie ist noch nicht verfügbar – das Soll der Vorauszahlungen entspricht dem heutigen Vertragsstand. Bitte bei geänderten Vorauszahlungen je Mieter prüfen.' });
        }
    }

    return {
        occupancy, distribution, unitRows, pages, vacancies, sumCheck, customCents, issues,
        includeHeating, heatingDetected, totalDays: isValidISODate(periodStart) && isValidISODate(periodEnd) ? daysInclusive(periodStart, periodEnd) : 0,
        hasErrors: issues.some(i => i.level === 'error')
    };
};

// ── Alte Entwürfe (vor 11/2026) ─────────────────────────────────────────────
// Rechnet den Einheitenanteil wie die frühere Version, nur um Handkorrekturen in
// gespeicherten Entwürfen zu erkennen (abweichender Betrag = manuelle Änderung).
export const legacyUnitAmount = ({ item, unit, houseUnits, leases, distributionKeys = [] }) => {
    const dk = distributionKeys.find(k => k.id === item.distribution_key);
    const type = dk ? dk.calculation_type : (LEGACY_KEYS[item.distribution_key]?.type || 'area');
    const amount = parseFloat(item.amount) || 0;
    const occOf = (u) => {
        const l = (leases || []).find(x => x.unit_id === u.id && x.status === 'active');
        return l?.tenant?.occupants || 1;
    };
    if (type === 'units' || type === 'equal') return houseUnits.length ? amount / houseUnits.length : 0;
    if (type === 'area') {
        const tot = houseUnits.reduce((s, u) => s + (parseFloat(u.sqm) || 1), 0);
        return tot ? (amount * (parseFloat(unit.sqm) || 1)) / tot : 0;
    }
    if (type === 'persons') {
        const tot = houseUnits.reduce((s, u) => s + occOf(u), 0);
        return tot ? (amount * occOf(unit)) / tot : 0;
    }
    return 0;
};

export const convertLegacyUnitCosts = ({ savedUnitCosts = {}, costItems = [], houseUnits = [], leases = [], distributionKeys = [], newId }) => {
    const unitOverrides = {};
    const customRows = {};
    Object.entries(savedUnitCosts || {}).forEach(([uid, rows]) => {
        const unit = houseUnits.find(u => u.id === uid);
        const used = new Set();
        (rows || []).forEach(row => {
            const amount = parseNumber(row.amount) ?? 0;
            const match = !row.isCustom && unit
                ? costItems.find(ci => !used.has(ci.id) && (row.cost_item_id ? ci.id === row.cost_item_id : ci.category_name === row.label))
                : null;
            if (!match) {
                (customRows[uid] = customRows[uid] || []).push({ id: newId(), label: row.label || 'Position', amount, isCustom: true });
                return;
            }
            used.add(match.id);
            const expected = legacyUnitAmount({ item: match, unit, houseUnits, leases, distributionKeys });
            if (Math.abs(expected - amount) > 0.005) {
                (unitOverrides[uid] = unitOverrides[uid] || {})[match.id] = { amount };
            }
        });
    });
    return { unitOverrides, customRows };
};

// ── Brief / PDF ──────────────────────────────────────────────────────────────
// Briefdaten je Seite (Empfänger, Objekt, Vermieter) – wird beim Festschreiben mitgespeichert.
export const buildLetterData = ({ property, portfolio, tenant }) => {
    const propStreet = joinNonEmpty([property?.street, property?.house_number]);
    const propCity = joinNonEmpty([property?.zip, property?.city]);
    const tenantStreet = joinNonEmpty([tenant?.street, tenant?.house_number]);
    const tenantCity = joinNonEmpty([tenant?.postal_code, tenant?.city]);
    const useTenantAddress = !!(tenantStreet && tenantCity);
    const landlordName = (portfolio?.company_name || '').trim() || (portfolio?.name || '').trim() || '';
    return {
        portfolioId: portfolio?.id || property?.portfolio_id || null,
        propertyName: property?.name || propStreet || '',
        propertyAddress: joinNonEmpty([propStreet, propCity], ', '),
        recipientLines: useTenantAddress ? [tenantStreet, tenantCity] : [propStreet, propCity].filter(Boolean),
        recipientSource: useTenantAddress ? 'tenant' : 'property',
        landlordName,
        landlordAddressLines: [joinNonEmpty([portfolio?.street, portfolio?.house_number]), joinNonEmpty([portfolio?.zip, portfolio?.city])].filter(Boolean),
        landlordEmail: (portfolio?.email || '').trim(),
        landlordPhone: (portfolio?.phone || '').trim(),
        bankLines: [
            (portfolio?.bank_name || '').trim(),
            portfolio?.iban ? `IBAN: ${String(portfolio.iban).trim()}` : '',
            portfolio?.bic ? `BIC: ${String(portfolio.bic).trim()}` : ''
        ].filter(Boolean)
    };
};

const saldoLabel = (balanceType) => (balanceType === 'nachzahlung' ? 'Nachzahlung' : balanceType === 'guthaben' ? 'Gutschrift' : 'ausgeglichen');

const TD = 'padding: 6px; border-bottom: 1px solid #cbd5e1;';

const buildSummaryTableHtml = (page) => {
    const p = page.prepay || {};
    const resultLabel = page.balanceType === 'even' ? 'Ihr Ergebnis: ausgeglichen' : `Ihre ${saldoLabel(page.balanceType)} (Brutto):`;
    const resultColor = page.balanceType === 'nachzahlung' ? '#dc2626' : '#16a34a';
    const heatRow = (p.includeHeating || p.heatCents)
        ? `<tr><td style="${TD}">Ihre Heizkosten-Vorauszahlung:</td><td style="${TD} text-align: right;">${escapeHtml(formatCents(p.heatCents))}</td></tr>`
        : '';
    return `<table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
<thead><tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;"><th style="padding: 6px; text-align: left;">Kostenart / Position</th><th style="padding: 6px; text-align: right; width: 30%;">Betrag</th></tr></thead>
<tbody>
<tr><td style="${TD}">Ihre Gesamtkosten (Brutto):</td><td style="${TD} text-align: right; font-weight: bold;">${escapeHtml(formatCents(page.totalCents))}</td></tr>
<tr><td style="${TD}">Ihre Betriebskosten-Vorauszahlung:</td><td style="${TD} text-align: right;">${escapeHtml(formatCents(p.svcCents))}</td></tr>
${heatRow}
<tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;"><td style="padding: 8px; font-weight: bold; font-size: 11pt;">${escapeHtml(resultLabel)}</td><td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: ${resultColor};">${escapeHtml(formatCents(Math.abs(page.balanceCents)))}</td></tr>
</tbody></table>`;
};

const fmtBasis = (v, label) => (v === null || v === undefined || !(v > 0) ? '--' : `${formatNumberDE(v, 2)} ${label}`.trim());

// Zeilen für Detailblatt und Detailansicht: HeizkostenV-Positionen erscheinen als
// Grund- und Verbrauchskosten (Summe beider Zeilen = Anteil der Position)
export const expandItemParts = (items) => (items || []).flatMap(it => (Array.isArray(it.parts) && it.parts.length
    ? it.parts.map(p => ({ ...it, ...p, rowId: `${it.rowId ?? it.label}:${p.kind}`, parts: null, isPart: true }))
    : [it]));

const buildDetailTableHtml = (page) => {
    const hasManual = (page.items || []).some(it => it.manual);
    const hasHeatingSplit = (page.items || []).some(it => Array.isArray(it.parts) && it.parts.length);
    const rows = expandItemParts(page.items).map(it => {
        const keyText = it.status === 'error' ? `${it.keyName || 'Schlüssel'} – ${it.message}` : (it.keyName || '');
        return `<tr>
<td style="${TD} font-weight: bold;">${escapeHtml(it.label)}${it.manual ? ' *' : ''}</td>
<td style="${TD}">${escapeHtml(keyText)}</td>
<td style="${TD} text-align: right;">${it.totalCost ? escapeHtml(formatEUR(it.totalCost)) : '--'}</td>
<td style="${TD} text-align: right;">${escapeHtml(fmtBasis(it.basisTotal, it.unitLabel))}</td>
<td style="${TD} text-align: right;">${it.costPerBasis ? escapeHtml(formatNumberDE(it.costPerBasis, 4)) + ' €' : '--'}</td>
<td style="${TD} text-align: right;">${escapeHtml(fmtBasis(it.basisUnit, it.unitLabel))}</td>
<td style="${TD} text-align: right;">${escapeHtml(it.timeText || '')}</td>
<td style="${TD} text-align: right; font-weight: bold;">${escapeHtml(formatEUR(it.share))}</td>
</tr>`;
    }).join('');
    const footnote = (hasManual
        ? '<p style="font-size: 8pt; margin-top: 6px;">* Betrag manuell festgelegt bzw. direkt zugeordnet.</p>'
        : '')
        + (hasHeatingSplit
            ? '<p style="font-size: 8pt; margin-top: 6px;">Heiz-/Warmwasserkosten nach HeizkostenV aufgeteilt: Grundkosten nach Wohnfläche, Verbrauchskosten nach dem erfassten Verbrauch der Einheiten (Anteile in Prozent je Zeile).</p>'
            : '');
    return `<table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 8pt;">
<thead><tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
<th style="padding: 6px; text-align: left; width: 19%;">Kostenart</th>
<th style="padding: 6px; text-align: left; width: 13%;">Schlüssel</th>
<th style="padding: 6px; text-align: right; width: 11%;">Gesamtkosten</th>
<th style="padding: 6px; text-align: right; width: 12%;">Gesamt-Einheiten</th>
<th style="padding: 6px; text-align: right; width: 10%;">Kosten/Einheit</th>
<th style="padding: 6px; text-align: right; width: 11%;">Ihre Einheiten</th>
<th style="padding: 6px; text-align: right; width: 12%;">Zeitanteil</th>
<th style="padding: 6px; text-align: right; width: 12%; font-weight: bold;">Ihr Anteil</th>
</tr></thead>
<tbody>${rows}
<tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;"><td colspan="7" style="padding: 8px;">Gesamtsumme Ihr Anteil (${escapeHtml(formatDateDE(page.start))} – ${escapeHtml(formatDateDE(page.end))}):</td><td style="padding: 8px; text-align: right;">${escapeHtml(formatCents(page.totalCents))}</td></tr>
</tbody></table>${footnote}`;
};

// Standardvorlage: gemeinsame Quelle mit dem Vorlagen-Editor (lib/defaultTemplates.js)
export const DEFAULT_UTILITY_TEMPLATE = DEFAULT_TEMPLATES.utility_costs.content_html;

// Nur Druck-Anpassungen; die Briefgeometrie kommt aus index.css (.letter-page usw.),
// weil das PDF im Hauptdokument gerendert wird – dieselben Regeln wie im Vorlagen-Editor.
// Seitenhöhe 295 mm statt 297 mm: die PDF-Erzeugung (lib/htmlToPdf) rundet die Blatthöhe auf 1122 px ab und
// würde sonst einen Streifen auf eine zusätzliche Leerseite schneiden; der Umbruch
// vor jeder Folgeseite (Abstandshalter ≈ 7 px) setzt jede Seite exakt an den Blattanfang.
export const SETTLEMENT_DOC_CSS = `
.nk-doc { width: 210mm; background: #ffffff; color: #000000; }
.nk-doc * { transition: none !important; }
.nk-doc .letter-page { height: 295mm !important; min-height: 295mm !important; max-height: 295mm !important; margin: 0 !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; page-break-inside: avoid; break-inside: avoid; }
.nk-doc .letter-page ~ .letter-page { page-break-before: always; break-before: page; }
.nk-doc table { background: transparent !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; border: none; }
.nk-doc th, .nk-doc td { color: #000000; background-color: transparent; font-size: inherit; }
.nk-doc.is-draft .letter-page::after { content: 'ENTWURF'; position: absolute; left: 0; right: 0; top: 42%; text-align: center; font-size: 72pt; font-weight: 700; letter-spacing: 6mm; color: rgba(220, 38, 38, 0.12); transform: rotate(-30deg); pointer-events: none; z-index: 5; }
`;

const val = {
    text: (t) => ({ text: t === null || t === undefined ? '' : String(t) }),
    lines: (arr) => ({ lines: (arr || []).filter(Boolean).map(String) }),
    html: (h) => ({ html: h })
};

export const buildTemplateVariables = (page, { periodStart, periodEnd, letterDate }) => {
    const L = page.letter || {};
    const contactLines = [
        L.landlordEmail ? `E-Mail: ${L.landlordEmail}` : '',
        L.landlordPhone ? `Tel.: ${L.landlordPhone}` : ''
    ].filter(Boolean);
    const dateText = formatDateDE(letterDate);
    const name = page.tenantFullName && page.tenantFullName !== 'Unbekannt' ? page.tenantFullName : '';
    return {
        mieter_name: val.text(name),
        mieter_nachname: val.text(page.tenantLastName || ''),
        mieter_anrede: val.text(name ? `Sehr geehrte/r ${name}` : 'Sehr geehrte Damen und Herren'),
        __anrede_name: val.text(name || 'Damen und Herren'),
        mieter_adresse: val.lines(L.recipientLines),
        objekt_name: val.text(L.propertyName),
        objekt_adresse: val.text(L.propertyAddress),
        einheit_name: val.text(page.unitName),
        abrechnungsjahr: val.text(settlementYearLabel(periodStart, periodEnd)),
        abrechnungszeitraum: val.text(`${formatDateDE(periodStart)} - ${formatDateDE(periodEnd)}`),
        nutzungszeitraum: val.text(`${formatDateDE(page.start)} - ${formatDateDE(page.end)}`),
        gesamtkosten_mieter: val.text(formatCents(page.totalCents)),
        vorauszahlungs_betrag: val.text(formatCents(page.prepay?.totalCents)),
        saldo_betrag: val.text(formatCents(Math.abs(page.balanceCents || 0))),
        saldo_art: val.text(saldoLabel(page.balanceType)),
        vermieter_name: val.text(L.landlordName),
        vermieter_adresse: val.lines(L.landlordAddressLines),
        vermieter_email: val.text(L.landlordEmail),
        vermieter_telefon: val.text(L.landlordPhone),
        vermieter_kontakt: val.lines(contactLines),
        vermieter_bankverbindung: val.lines(L.bankLines),
        erstellungsdatum: val.text(dateText),
        rechnungsdatum: val.text(dateText),
        rechnungs_datum: val.text(dateText),
        nebenkosten_tabelle: val.html(buildSummaryTableHtml(page)),
        nebenkosten_detail_tabelle: val.html(buildDetailTableHtml(page))
    };
};

const SALUTATION_BEFORE = /sehr\s+geehrte\S*\s*$/i;
const precededBySalutation = (el) => {
    let node = el;
    for (let depth = 0; depth < 3 && node; depth++) {
        let prev = node.previousSibling;
        while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev = prev.previousSibling;
        if (prev) return prev.nodeType === 3 ? SALUTATION_BEFORE.test(prev.nodeValue) : SALUTATION_BEFORE.test(prev.textContent || '');
        node = node.parentNode;
        if (!node || node.nodeName === 'P' || node.nodeName === 'DIV' || node.nodeName === 'BODY') break;
    }
    return false;
};

// Setzt die Werte per DOM ein (keine Regex-Ersetzung: kein $-Muster-Problem, keine
// verschachtelten Chips, eingesetzte Werte werden nicht erneut durchsucht).
// Textwerte werden als Textknoten eingesetzt; HTML nur für die selbst erzeugten Tabellen.
export const fillTemplate = (templateHtml, vars) => {
    const doc = parseHtmlDocument(sanitizeTemplateHtml(templateHtml));
    const makeNodes = (v) => {
        const frag = doc.createDocumentFragment();
        if (!v) return frag;
        if (v.html !== undefined) {
            const tmp = doc.createElement('div');
            tmp.innerHTML = v.html;
            while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        } else if (v.lines) {
            v.lines.forEach((l, i) => {
                if (i) frag.appendChild(doc.createElement('br'));
                frag.appendChild(doc.createTextNode(l));
            });
        } else {
            frag.appendChild(doc.createTextNode(v.text ?? ''));
        }
        return frag;
    };

    // 1. Geschweifte Platzhalter {schluessel} und fremde Kontaktadresse aus alten Vorlagen.
    //    Zuerst, damit später eingesetzte Werte nicht erneut durchsucht werden.
    const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const ownEmail = vars.vermieter_email?.text || '';
    textNodes.forEach(node => {
        let s = node.nodeValue || '';
        if (/info@immocontrol\.de/i.test(s)) {
            s = s.replace(/E-Mail:\s*info@immocontrol\.de/gi, ownEmail ? `E-Mail: ${ownEmail}` : '')
                .replace(/info@immocontrol\.de/gi, ownEmail);
            node.nodeValue = s;
        }
        if (s.indexOf('{') === -1) return;
        const re = /\{([a-z0-9_]+)\}/gi;
        const frag = doc.createDocumentFragment();
        let last = 0;
        let changed = false;
        let m;
        while ((m = re.exec(s))) {
            const key = m[1];
            if (!hasOwn(vars, key) || key.startsWith('__')) continue;
            changed = true;
            frag.appendChild(doc.createTextNode(s.slice(last, m.index)));
            frag.appendChild(makeNodes(vars[key]));
            last = m.index + m[0].length;
        }
        if (!changed) return;
        frag.appendChild(doc.createTextNode(s.slice(last)));
        node.replaceWith(frag);
    });

    // 2. Variablen-Chips (data-id); die Liste wird vorher ermittelt, eingesetzte Werte
    //    (Textknoten bzw. eigene Tabellen ohne data-id) werden nicht erneut ersetzt.
    Array.from(doc.body.querySelectorAll('[data-id]')).forEach(el => {
        if (!el.isConnected) return; // lag in einem bereits ersetzten Chip
        const key = el.getAttribute('data-id');
        if (!hasOwn(vars, key) || key.startsWith('__')) return;
        let v = vars[key];
        if (key === 'mieter_anrede' && precededBySalutation(el)) v = vars.__anrede_name;
        const parent = el.parentNode;
        // Tabelle als einziger Inhalt eines Absatzes: Absatz ersetzen (kein <table> in <p>)
        if (v?.html !== undefined && parent && parent.nodeName === 'P' && parent.textContent.trim() === el.textContent.trim()) {
            parent.replaceWith(makeNodes(v));
        } else {
            el.replaceWith(makeNodes(v));
        }
    });
    return doc.body.innerHTML;
};

// Komplettes Druckdokument (bereinigt) für alle übergebenen Seiten
export const renderSettlementDocument = ({ pages, templateForPage, periodStart, periodEnd, letterDate, isDraft }) => {
    const parts = (pages || []).map(page => fillTemplate(
        (templateForPage && templateForPage(page)) || DEFAULT_UTILITY_TEMPLATE,
        buildTemplateVariables(page, { periodStart, periodEnd, letterDate })
    ));
    return `<div class="nk-doc${isDraft ? ' is-draft' : ''}"><style>${SETTLEMENT_DOC_CSS}</style>${parts.join('')}</div>`;
};

// ── Festschreibung ───────────────────────────────────────────────────────────
// Alle Rechengrundlagen und Ergebnisse je Mieter; das PDF einer fertigen Abrechnung
// wird ausschließlich hieraus erzeugt.
export const buildCalculationSnapshot = ({ result, costItems, periodStart, periodEnd, options, letterDataForPage, finalizedAt, finalizedBy }) => ({
    version: 1,
    finalized_at: finalizedAt,
    finalized_by: finalizedBy || null,
    period_start: periodStart,
    period_end: periodEnd,
    total_days: result.totalDays,
    year_label: settlementYearLabel(periodStart, periodEnd),
    options: { includeHeatingPrepay: result.includeHeating, vacancyPersons: options?.vacancyPersons ?? 1 },
    cost_items: costItems.map(ci => {
        const d = result.distribution[ci.id];
        return {
            id: ci.id, name: ci.category_name, amount: centsToEuro(toCents(ci.amount)),
            key_name: d?.key?.name || null, key_type: d?.key?.type || null, unit_id: ci.unit_id || null,
            basis_total: d?.basis?.total ?? null, unit_label: d?.basis?.unitLabel || '',
            basis_by_unit: d?.basis?.unitValues || {}, status: d?.status || null,
            ...(d?.split ? {
                heating_split: {
                    consumption_share: d.split.consumptionShare, base_cents: d.split.baseCents,
                    consumption_cents: d.split.consumptionCents,
                    area_total: d.split.area.total, area_by_unit: d.split.area.unitValues,
                    consumption_total: d.split.consumption.total, consumption_by_unit: d.split.consumption.unitValues,
                    consumption_unit: d.split.consumption.unitLabel
                }
            } : {})
        };
    }),
    sum_check: result.sumCheck.map(sc => ({
        label: sc.label, total_cents: sc.totalCents, tenants_cents: sc.tenantsCents,
        vacancy_cents: sc.vacancyCents, other_units_cents: sc.otherUnitsCents, diff_cents: sc.diffCents
    })),
    vacancies: result.vacancies.map(v => ({ unit_id: v.unitId, unit_name: v.unitName, days: v.days, gaps: v.gaps, total_cents: v.totalCents })),
    warnings: result.issues.filter(i => i.level !== 'info').map(i => i.text),
    pages: result.pages.map(p => ({
        key: p.key, unitId: p.unitId, unitName: p.unitName, propertyId: p.propertyId,
        leaseId: p.leaseId, tenantId: p.tenantId,
        tenantDisplayName: p.tenantDisplayName, tenantFullName: p.tenantFullName, tenantLastName: p.tenantLastName,
        start: p.start, end: p.end, days: p.days, totalDays: p.totalDays,
        persons: p.persons, personsMissing: p.personsMissing, sqm: p.sqm,
        items: p.items.map(it => ({
            label: it.label, keyName: it.keyName, keyType: it.keyType, status: it.status, message: it.message,
            manual: it.manual, totalCost: it.totalCost, basisTotal: it.basisTotal, basisUnit: it.basisUnit,
            unitLabel: it.unitLabel, costPerBasis: it.costPerBasis, timeText: it.timeText,
            share: it.share, shareCents: it.shareCents,
            ...(Array.isArray(it.parts) && it.parts.length ? {
                parts: it.parts.map(pt => ({
                    kind: pt.kind, label: pt.label, keyName: pt.keyName, totalCost: pt.totalCost,
                    basisTotal: pt.basisTotal, basisUnit: pt.basisUnit, unitLabel: pt.unitLabel,
                    costPerBasis: pt.costPerBasis, timeText: pt.timeText, share: pt.share, shareCents: pt.shareCents
                }))
            } : {})
        })),
        totalCents: p.totalCents,
        prepay: {
            svcCents: p.prepay.svcCents, heatCents: p.prepay.heatCents, totalCents: p.prepay.totalCents,
            includeHeating: p.prepay.includeHeating, source: p.prepay.source,
            sollSvc: p.prepay.sollSvc, sollHeat: p.prepay.sollHeat, istSvc: p.prepay.istSvc, istHeat: p.prepay.istHeat,
            months: p.prepay.months
        },
        balanceCents: p.balanceCents, balanceType: p.balanceType,
        letter: letterDataForPage ? letterDataForPage(p) : null
    }))
});
