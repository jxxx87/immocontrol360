// Gemeinsame Mietkonto-/Rückstandslogik für Finanzen (Finance.jsx) und Dashboard.
//
// Grundlage ist das Mietkonto (rent_ledger), das per DB-Trigger je Vertrag und Monat gepflegt wird
// (Soll, gezahlter Betrag, Fälligkeitsdatum, Status). Fehlt für einen Monat eine Ledger-Zeile
// (z. B. Monate ohne Zahlung nach der letzten Vertragsänderung), wird der Sollbetrag aus dem
// Mietvertrag berechnet (tagesanteilig bei Ein-/Auszug im Monat).
//
// Bewusst ohne React, damit beide Seiten exakt dieselben Zahlen liefern.

import { supabase } from './supabase';

// € – identisch mit der Schwelle für Status 'paid' im Mietkonto (recalculate_rent_ledger_entry: paid >= expected - 1)
export const RENT_TOLERANCE = 1;

// Liegt der Mietbeginn mehr als so viele Monate vor der Erfassung des Vertrags in der App, gilt er als
// Bestandsmietvertrag (z. B. Excel-Import mit echtem Einzugsdatum): Rückstände werden dann standardmäßig
// erst ab dem Buchungsbeginn (Monat der Erfassung) gezählt. Ältere Monate bleiben per Schalter einblendbar.
export const BESTAND_THRESHOLD_MONTHS = 3;

const pad2 = (n) => String(n).padStart(2, '0');

export const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

// Lokales Datum als 'YYYY-MM-DD' (nicht UTC wie toISOString)
export const toLocalDateStr = (date = new Date()) =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const toMonthStr = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

// 'YYYY-MM-DD' (auch mit Zeitanteil) -> lokales Datum 00:00; null bei ungültigem Wert
export const parseDateOnly = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
};

// 'YYYY-MM' + n Monate
export const addMonths = (monthStr, n) => {
    const [y, m] = monthStr.split('-').map(Number);
    return toMonthStr(new Date(y, m - 1 + n, 1));
};

// Anzahl Monate von a nach b ('YYYY-MM')
export const monthDiff = (a, b) => {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return (by - ay) * 12 + (bm - am);
};

// Alle Monate ('YYYY-MM') zwischen zwei Datumsangaben (inklusive), begrenzt auf 100 Jahre
export const monthsBetween = (startStr, endStr) => {
    const start = parseDateOnly(startStr);
    const end = parseDateOnly(endStr);
    if (!start || !end || start > end) return [];
    const months = [];
    const last = toMonthStr(end);
    for (let m = toMonthStr(start); m <= last && months.length < 1200; m = addMonths(m, 1)) months.push(m);
    return months;
};

export const leaseMonthlyRent = (lease) =>
    num(lease?.cold_rent) + num(lease?.service_charge) + num(lease?.heating_cost) + num(lease?.other_costs);

// Anteil (0..1) der Tage eines Monats, an denen der Vertrag läuft
export const leaseActiveRatio = (lease, monthStr) => {
    const start = parseDateOnly(lease?.start_date);
    if (!start) return 0;
    const end = parseDateOnly(lease?.end_date);
    const [y, m] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m - 1, daysInMonth);
    if (start > monthEnd) return 0;
    if (end && end < monthStart) return 0;
    const from = start > monthStart ? start.getDate() : 1;
    const to = end && end < monthEnd ? end.getDate() : daysInMonth;
    const days = to - from + 1;
    return days <= 0 ? 0 : Math.min(1, days / daysInMonth);
};

// Fälligkeit: payment_due_day (Standard 3) als Kalendertag, begrenzt auf das Monatsende
export const dueDateForMonth = (lease, monthStr) => {
    const [y, m] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const day = Math.min(Math.max(parseInt(lease?.payment_due_day, 10) || 3, 1), daysInMonth);
    return `${monthStr}-${pad2(day)}`;
};

export const ledgerKey = (leaseId, monthStr) => `${leaseId}_${monthStr}`;

// Indizes über Mietkonto und Zahlungen (Zuordnung je Vertrag und Leistungsmonat)
export const buildRentIndex = ({ ledgerRows = [], payments = [] } = {}) => {
    const ledgerByKey = new Map();
    const paidByKey = new Map();

    (ledgerRows || []).forEach(r => {
        if (!r || !r.lease_id || !r.period_month) return;
        ledgerByKey.set(ledgerKey(r.lease_id, String(r.period_month).slice(0, 7)), r);
    });

    (payments || []).forEach(p => {
        if (!p || !p.lease_id || !p.period_month) return;
        const key = ledgerKey(p.lease_id, String(p.period_month).slice(0, 7));
        paidByKey.set(key, round2((paidByKey.get(key) || 0) + num(p.amount)));
    });

    return { ledgerByKey, paidByKey };
};

// Gezahlter Betrag für Vertrag + Monat. Das Mietkonto wird per Trigger aus den Zahlungen gepflegt;
// das Maximum deckt sowohl unvollständig geladene Zahlungen (Dashboard) als auch eine fehlende Ledger-Zeile ab.
export const paidForMonth = (index, leaseId, monthStr) => {
    const key = ledgerKey(leaseId, monthStr);
    const row = index?.ledgerByKey?.get(key);
    const fromLedger = row ? num(row.paid_amount) : 0;
    const fromPayments = index?.paidByKey?.get(key) || 0;
    return round2(Math.max(fromLedger, fromPayments));
};

// Soll für Vertrag + Monat: Mietkonto, sonst Vertrag (tagesanteilig)
export const expectedRentForMonth = (lease, monthStr, ledgerRow) => {
    const ratio = leaseActiveRatio(lease, monthStr);
    if (ratio <= 0) return 0;
    const full = leaseMonthlyRent(lease);
    if (ledgerRow) {
        const ledgerExpected = num(ledgerRow.expected_rent);
        // Das Mietkonto führt volle Monatsmieten (heute die aktuelle Vertragsmiete, mit Miethistorie die im
        // Monat gültige Miete). Angebrochene Monate werden daher tagesanteilig gekürzt – außer die Zeile
        // enthält erkennbar bereits den Tagesanteil der Vertragsmiete (nie doppelt kürzen).
        if (ratio < 1 && Math.abs(ledgerExpected - full * ratio) >= 0.02) return round2(ledgerExpected * ratio);
        return round2(ledgerExpected);
    }
    return round2(full * ratio);
};

// Erster Monat, ab dem Rückstände gezählt werden ('YYYY-MM')
export const leaseBookingStartMonth = (lease) => {
    const start = parseDateOnly(lease?.start_date);
    if (!start) return null;
    const startM = toMonthStr(start);

    // Künftige Spalte (falls in der DB angelegt): ausdrücklicher Buchungsbeginn je Vertrag
    const explicit = parseDateOnly(lease?.booking_start_date);
    if (explicit) {
        const explicitM = toMonthStr(explicit);
        return explicitM > startM ? explicitM : startM;
    }

    const created = lease?.created_at ? new Date(lease.created_at) : null;
    if (!created || isNaN(created.getTime())) return startM;
    const createdM = toMonthStr(created);
    if (monthDiff(startM, createdM) <= BESTAND_THRESHOLD_MONTHS) return startM;
    return createdM > startM ? createdM : startM;
};

/**
 * Überfällige Monate je Vertrag.
 * - nur Monate, deren Fälligkeitstag (Mietkonto bzw. payment_due_day) vor heute liegt
 * - Status 'loss' (ausgebucht) zählt nicht
 * - Monate im Mahnverfahren werden geliefert (isMahn), aber nicht in totalOverdue summiert
 * - Monate vor dem Buchungsbeginn (Bestandsmieter) werden standardmäßig nur gezählt (hidden), nicht geliefert
 */
export const computeArrears = ({ leases = [], index, mahnKeys, today = new Date(), includeBeforeBookingStart = false }) => {
    const todayStr = toLocalDateStr(today);
    const currentMonth = todayStr.slice(0, 7);
    const mahn = mahnKeys || new Set();
    const entries = [];
    const hiddenEntries = [];

    (leases || []).forEach(lease => {
        const start = parseDateOnly(lease?.start_date);
        if (!lease?.id || !start) return;
        const startM = toMonthStr(start);
        const end = parseDateOnly(lease.end_date);
        const endM = end ? toMonthStr(end) : null;
        const lastM = endM && endM < currentMonth ? endM : currentMonth;
        if (startM > lastM) return;

        // Buchungsbeginn: Heuristik bzw. ausdrückliche Spalte – aber nie später als der erste Monat,
        // für den schon eine Zahlung erfasst ist (ab dort wird das Mietkonto nachweislich geführt).
        let bookingStartM = leaseBookingStartMonth(lease) || startM;
        for (let m = startM; m < bookingStartM && m <= lastM; m = addMonths(m, 1)) {
            if (paidForMonth(index, lease.id, m) > 0) { bookingStartM = m; break; }
        }

        for (let m = startM; m <= lastM; m = addMonths(m, 1)) {
            const key = ledgerKey(lease.id, m);
            const row = index?.ledgerByKey?.get(key);
            if (row && row.status === 'loss') continue;

            const expected = expectedRentForMonth(lease, m, row);
            if (expected <= 0) continue;

            const dueDate = (row && row.due_date ? String(row.due_date).slice(0, 10) : null) || dueDateForMonth(lease, m);
            if (dueDate >= todayStr) continue; // am Fälligkeitstag selbst noch fristgerecht

            const paid = paidForMonth(index, lease.id, m);
            const open = round2(expected - paid);
            if (open <= RENT_TOLERANCE) continue;

            const isMahn = mahn.has(key);
            const beforeBookingStart = m < bookingStartM;
            // Monate im Mahnverfahren werden nachweislich verfolgt und nie ausgeblendet
            if (beforeBookingStart && !includeBeforeBookingStart && !isMahn) {
                hiddenEntries.push({ leaseId: lease.id, lease, monthStr: m, open, isMahn });
                continue;
            }

            entries.push({
                id: `${lease.id}_${m}-01`,
                key,
                leaseId: lease.id,
                lease,
                monthStr: m,
                periodMonth: `${m}-01`,
                dueDate,
                expected,
                paid,
                open,
                isMahn,
                beforeBookingStart,
                bookingStartMonth: bookingStartM
            });
        }
    });

    const totalOverdue = round2(entries.reduce((s, e) => s + (e.isMahn ? 0 : e.open), 0));
    return { entries, totalOverdue, hiddenEntries, hidden: summarizeHidden(hiddenEntries) };
};

// Zusammenfassung ausgeblendeter Monate vor dem Buchungsbeginn
export const summarizeHidden = (hiddenEntries = []) => ({
    count: hiddenEntries.length,
    amount: round2(hiddenEntries.reduce((s, e) => s + (e.isMahn ? 0 : e.open), 0)),
    leases: new Set(hiddenEntries.map(e => e.leaseId)).size
});

// Ausgaben einem Portfolio zuordnen. Ausgaben ohne Objekt gehören zu keinem Portfolio: sie zählen nur unter
// "Alle Portfolios" bzw. wenn das gewählte Portfolio das einzige eigene ist.
export const filterExpensesByPortfolio = (expenses, { selectedPortfolioID, propertyPortfolio, includeUnassigned }) => {
    if (!selectedPortfolioID) return { list: expenses || [], hiddenUnassigned: 0 };
    let hiddenUnassigned = 0;
    const list = (expenses || []).filter(e => {
        if (!e.property_id) {
            if (includeUnassigned) return true;
            hiddenUnassigned++;
            return false;
        }
        return propertyPortfolio.get(e.property_id) === selectedPortfolioID;
    });
    return { list, hiddenUnassigned };
};

export const isMissingRelationError = (error) =>
    !!error && ['42P01', 'PGRST205', 'PGRST200'].includes(error.code);

/**
 * Lädt alle Zeilen einer Tabelle seitenweise (.range), damit die PostgREST-Zeilengrenze (Standard 1000)
 * nichts abschneidet. applyQuery setzt Filter/Sortierung; als Tiebreaker wird immer nach id sortiert.
 */
export const fetchAllRows = async (table, columns, applyQuery = (q) => q, pageSize = 1000) => {
    const rows = [];
    let total = null;
    for (let page = 0; page < 500; page++) {
        const from = rows.length;
        let query = supabase.from(table).select(columns, page === 0 ? { count: 'exact' } : undefined);
        query = applyQuery(query).order('id', { ascending: true });
        const { data, error, count } = await query.range(from, from + pageSize - 1);
        if (error) return { data: rows, error };
        const chunk = data || [];
        if (page === 0 && typeof count === 'number') total = count;
        rows.push(...chunk);
        if (chunk.length === 0) break;
        if (total !== null ? rows.length >= total : chunk.length < pageSize) break;
    }
    return { data: rows, error: null };
};

/**
 * Monate in laufenden Forderungsakten (Mahnverfahren). Schlüssel: `${lease_id}_${YYYY-MM}`.
 * Ledger-IDs werden über die bereits geladenen Mietkonto-Zeilen aufgelöst; nur fehlende IDs werden
 * blockweise nachgeladen (keine überlangen .in()-Listen).
 */
export const loadMahnverfahren = async (ledgerRows = []) => {
    const keys = new Set();
    const claimByKey = new Map();

    const { data: items, error } = await fetchAllRows(
        'claim_items',
        'id, rent_ledger_ids, rent_ledger_id, claims!inner(id, status, lease_id)',
        q => q.not('claims.status', 'in', '("settled","cancelled","archived")')
    );
    if (error) return { keys, claimByKey, error };

    const ledgerById = new Map((ledgerRows || []).map(r => [r.id, r]));
    const ledgerToClaim = new Map();
    (items || []).forEach(ci => {
        const ids = [...(Array.isArray(ci.rent_ledger_ids) ? ci.rent_ledger_ids : []), ...(ci.rent_ledger_id ? [ci.rent_ledger_id] : [])];
        ids.forEach(id => { if (id && !ledgerToClaim.has(id)) ledgerToClaim.set(id, ci.claims?.id || null); });
    });

    const missing = [...ledgerToClaim.keys()].filter(id => !ledgerById.has(id));
    for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const { data: rows, error: rlError } = await supabase.from('rent_ledger').select('id, lease_id, period_month').in('id', chunk);
        if (rlError) return { keys, claimByKey, error: rlError };
        (rows || []).forEach(r => ledgerById.set(r.id, r));
    }

    ledgerToClaim.forEach((claimId, ledgerId) => {
        const rl = ledgerById.get(ledgerId);
        if (!rl || !rl.lease_id || !rl.period_month) return;
        const key = ledgerKey(rl.lease_id, String(rl.period_month).slice(0, 7));
        keys.add(key);
        if (claimId && !claimByKey.has(key)) claimByKey.set(key, claimId);
    });

    return { keys, claimByKey, error: null };
};
