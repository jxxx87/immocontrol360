import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import CurrencyInput from '../components/ui/CurrencyInput';
import {
    Loader2, Check, X, AlertCircle, Sparkles, Building2, CreditCard, RefreshCw,
    Trash2, HelpCircle, Save, Settings, FlaskConical, RotateCcw, TriangleAlert, Info
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';

// ─────────────────────────────────────────────────────────────────────────────
// DEMO-MODUS
// Es gibt noch KEINEN echten Bankimport (weder CSV/CAMT.053/MT940 noch eine
// FinAPI-Anbindung über eine Edge Function). Die Seite läuft deshalb nur als
// lokale Vorschau: Beispiel-Umsätze, Zuordnungen und gelernte Regeln existieren
// ausschließlich im Browser. Es werden KEINE Bankkonten, Umsätze, Regeln,
// Mietzahlungen oder Ausgaben angelegt oder geändert.
// Gelesen werden nur Stammdaten (Objekte, Einheiten, Mietverträge, Kostenarten),
// vorhandene Buchungen im Zeitfenster der Demo (Duplikat-Hinweise) und der
// Altbestand der früheren Testversion (bank_connections / bank_transactions /
// bank_matching_rules). Einzige Schreibaktionen: Löschen dieses Altbestands bzw.
// einzelner alter Regeln – auf ausdrücklichen Wunsch des Nutzers.
// Ein echter Import braucht später: stabile transaction_id + Upsert, Buchung per
// RPC in einer Transaktion (Status 'pending' sperren, Buchungs-ID am Umsatz).
// Vertrag für bank_transactions.matched_target_id (Welle 3, M2-16): bei
// matched_type 'income' die ID der Mietzahlung (rent_payments.id), bei 'expense'
// die ID der Ausgabe (expenses.id) – nie Vertrags- oder Kostenart-IDs. Wird die
// Buchung gelöscht, setzt der DB-Trigger trigger_bank_tx_unmatch_on_delete den
// Umsatz wieder auf 'pending'. (Altbestand der früheren Testversion trägt teils
// Vertrags- bzw. Kostenart-IDs; die Seite zeigt ihn nur an.)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_DAYS = 10;          // "bereits erfasst": gleicher Vertrag/Kostenart, gleicher Betrag
const POSSIBLE_RENT_DUPLICATE_DAYS = 5;    // nur Hinweis: gleicher Betrag ohne Mieterbezug
const POSSIBLE_EXPENSE_DUPLICATE_DAYS = 3; // nur Hinweis: gleicher Betrag ohne Kostenart-/Empfängerbezug
const DEMO_MAX_AGE_DAYS = 5;               // ältester Demo-Umsatz liegt so viele Tage zurück
const AMOUNT_EPSILON = 0.005;
const RENT_AMOUNT_TOLERANCE = 1;           // Abweichung zur Soll-Miete, die noch als "Betrag passt" gilt

// Beispiel-Umsätze der Demo. Bewusst neutrale Musternamen und ungültige Platzhalter-IBANs
// (Prüfziffer 00), damit sie nie mit echten Konten, Banken oder Mietern verwechselt werden.
const DEMO_TRANSACTIONS = [
    { daysAgo: 0, amount: 600.00, purpose: 'Miete EG Musterstraße 1 - Max Mustermann', counterpart_name: 'Max Mustermann', counterpart_iban: 'DE00 0000 0000 0000 0000 01' },
    { daysAgo: 1, amount: -128.50, purpose: 'Rechn. 0001 - Abschlag Wasser Musterstraße 1', counterpart_name: 'Stadtwerke Musterstadt (Demo)', counterpart_iban: 'DE00 0000 0000 0000 0000 02' },
    { daysAgo: 2, amount: 850.00, purpose: 'MIETE MUSTERFRAU 1. OG RECHTS', counterpart_name: 'Erika Musterfrau', counterpart_iban: 'DE00 0000 0000 0000 0000 03' },
    { daysAgo: 3, amount: -340.00, purpose: 'Gebaeudeversicherung Police DEMO-0001', counterpart_name: 'Muster Versicherung (Demo)', counterpart_iban: 'DE00 0000 0000 0000 0000 04' },
    { daysAgo: DEMO_MAX_AGE_DAYS, amount: 450.00, purpose: 'Miete - WE 101 Beispiel', counterpart_name: 'Hans Beispiel', counterpart_iban: 'DE00 0000 0000 0000 0000 05' }
];

// Schlagwort-Heuristik für Ausgaben (erste passende Zeile gewinnt)
const EXPENSE_HEURISTICS = [
    { test: (s, p) => s.includes('stadtwerke') || p.includes('wasser') || p.includes('abwasser'), categoryKeys: ['wasser', 'betriebskosten'], score: 80, reason: 'Absender weist auf Stadtwerke/Wasser hin' },
    { test: (s, p) => s.includes('energie') || s.includes('strom') || p.includes('strom') || s.includes('e.on'), categoryKeys: ['strom', 'energie'], score: 80, reason: 'Absender weist auf Energieversorger hin' },
    { test: (s, p) => s.includes('schornsteinfeger') || p.includes('schornstein') || p.includes('kehrer'), categoryKeys: ['schornstein', 'wartung'], score: 90, reason: 'Schlagwort im Absender / Verwendungszweck' },
    { test: (s, p) => s.includes('versicherung') || p.includes('gebäudeversicherung') || p.includes('gebaeudeversicherung'), categoryKeys: ['versicherung'], score: 85, reason: 'Schlagwort Versicherung' },
    { test: (s, p) => s.includes('müll') || p.includes('abfall') || p.includes('entsorgung'), categoryKeys: ['müll', 'abfall'], score: 80, reason: 'Entsorgungsschlagwort gefunden' }
];

// Gelernte Regeln: IBAN exakt > Zahlungspartner > Schlüsselwort (Schlüsselwort nie als sicherer Treffer)
const RULE_STRENGTH = { iban: 3, name: 2, keyword: 1 };
const RULE_CONFIDENCE = { 3: 100, 2: 90, 1: 60 };
const RULE_REASON = {
    3: 'Gelernt aus Ihren Zuordnungen: gleiche IBAN',
    2: 'Gelernt aus Ihren Zuordnungen: gleicher Zahlungspartner',
    1: 'Nur Schlüsselwort im Verwendungszweck – bitte genau prüfen'
};

const EMPTY_INCOME_FORM = { payment_date: '', period_month: '', property_id: '', lease_id: '', amount: '', note: '' };
const EMPTY_EXPENSE_FORM = {
    booking_date: '', payee: '', category_id: '', category_custom: '', scope: 'general',
    property_id: '', unit_id: '', amount: '', is_allocatable: true, note: ''
};

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const parseDateStr = (str) => {
    const [y, m, d] = String(str || '').slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return Date.UTC(y, m - 1, d);
};
const addDays = (dateStr, days) => {
    const t = parseDateStr(dateStr);
    if (t === null) return dateStr;
    const d = new Date(t + days * DAY_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
const daysBetween = (a, b) => {
    const ta = parseDateStr(a);
    const tb = parseDateStr(b);
    if (ta === null || tb === null) return Infinity;
    return Math.abs(ta - tb) / DAY_MS;
};
const formatDate = (str) => {
    const t = parseDateStr(str);
    if (t === null) return '–';
    const d = new Date(t);
    return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
const formatMonth = (monthStr) => {
    const [y, m] = String(monthStr || '').split('-');
    return y && m ? `${m}/${y}` : '–';
};
const formatCurrency = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(val) || 0);
const toNumber = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
};
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const normalizeIban = (iban) => String(iban || '').replace(/\s+/g, '').toUpperCase();
const normalizeText = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Ganzes Wort bzw. ganze Wortfolge (Unicode-fähig): "Ott" trifft nicht "Otto", "May" nicht "Mayr"
const containsWord = (haystack, needle) => {
    const n = normalizeText(needle);
    if (n.length < 2 || !haystack) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?=$|[^\\p{L}\\p{N}])`, 'u');
    return re.test(normalizeText(haystack));
};

const leaseMonthlyTotal = (lease) =>
    ['cold_rent', 'service_charge', 'heating_cost', 'other_costs'].reduce((sum, key) => sum + (Number(lease?.[key]) || 0), 0);
const leaseCoversDate = (lease, dateStr) =>
    !!lease?.start_date && lease.start_date <= dateStr && (!lease.end_date || lease.end_date >= dateStr);
const isLeaseEnded = (lease, todayStr) => lease.status !== 'active' || (!!lease.end_date && lease.end_date < todayStr);
const tenantLabel = (tenant) => [tenant?.last_name, tenant?.first_name].filter(Boolean).join(', ') || 'Unbekannter Mieter';
const propertyLabel = (p) => (p ? `${p.street || ''} ${p.house_number || ''}`.trim() : '');
const leaseLabel = (lease) => {
    const unit = lease?.unit?.unit_name || 'Einheit';
    const prop = propertyLabel(lease?.unit?.property);
    return `${tenantLabel(lease?.tenant)} – ${unit}${prop ? ` (${prop})` : ''}`;
};

const allocatedAmount = (tx) => round2((tx.allocations || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0));
const remainingAmount = (tx) => round2(Math.abs(Number(tx.amount)) - allocatedAmount(tx));

const isMissingTableError = (error) => !!error && ['42P01', 'PGRST205'].includes(error.code);

// Lädt alle Zeilen seitenweise (.range), damit die PostgREST-Grenze (Standard 1000 Zeilen) nichts abschneidet
const fetchAllPages = async (table, columns, applyQuery = (q) => q, pageSize = 1000) => {
    const rows = [];
    let total = null;
    for (let page = 0; page < 200; page++) {
        const from = rows.length;
        const query = applyQuery(supabase.from(table).select(columns, page === 0 ? { count: 'exact' } : undefined))
            .order('id', { ascending: true });
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

const buildDemoTransactions = () => {
    const today = toDateStr(new Date());
    return DEMO_TRANSACTIONS.map((t, i) => {
        const date = addDays(today, -t.daysAgo);
        return {
            id: `demo-tx-${i + 1}`,
            booking_date: date,
            value_date: date,
            amount: t.amount,
            purpose: t.purpose,
            counterpart_name: t.counterpart_name,
            counterpart_iban: t.counterpart_iban,
            status: 'pending',
            allocations: []
        };
    });
};

// ── Abgleich ────────────────────────────────────────────────────────────────

// Stärke, mit der eine Regel auf einen Umsatz passt (0 = gar nicht).
// - Typ und Vorzeichen müssen zusammenpassen: Mieteingang nur bei Gutschrift, Ausgabe nur bei Abbuchung
//   (sonst würde z. B. eine Kautionsrückzahlung an den Mieter als Mietzahlung vorgeschlagen).
// - Haben Regel und Umsatz eine IBAN, muss sie übereinstimmen; Name/Schlüsselwort zählen dann nicht.
const ruleMatchStrength = (rule, tx) => {
    const isCredit = Number(tx.amount) > 0;
    if (rule.target_type === 'income' ? !isCredit : rule.target_type === 'expense' ? isCredit : true) return 0;
    const ruleIban = normalizeIban(rule.counterpart_iban);
    const txIban = normalizeIban(tx.counterpart_iban);
    if (ruleIban && txIban) return ruleIban === txIban ? RULE_STRENGTH.iban : 0;
    if (rule.counterpart_name && containsWord(tx.counterpart_name, rule.counterpart_name)) return RULE_STRENGTH.name;
    if (rule.purpose_keyword && containsWord(tx.purpose, rule.purpose_keyword)) return RULE_STRENGTH.keyword;
    return 0;
};

// Beste Regel: höchste Stärke gewinnt; bei gleicher Stärke die zuerst gelistete (in der Demo gelernte
// Korrekturen stehen vor älteren gespeicherten Regeln). Regeln mit nicht (mehr) vorhandenem Ziel zählen nicht.
const findRule = (tx, rules, isValidRule) => {
    let best = null;
    let bestStrength = 0;
    for (const rule of rules) {
        const strength = ruleMatchStrength(rule, tx);
        if (strength > bestStrength && isValidRule(rule)) {
            best = rule;
            bestStrength = strength;
        }
    }
    return best ? { rule: best, strength: bestStrength } : null;
};

// Mietvertrag per Heuristik. Ohne Nachnamen-Treffer (ganzes Wort) gibt es keinen Vorschlag – ein passender
// Betrag allein ist kein Beleg. Passen mehrere Verträge gleich gut, wird nichts vorgeschlagen.
const suggestLease = (tx, leases) => {
    const sender = tx.counterpart_name || '';
    const purpose = tx.purpose || '';
    let best = [];
    let bestScore = 0;
    let bestParts = [];
    leases.forEach(lease => {
        if (!(lease.status === 'active' || leaseCoversDate(lease, tx.booking_date))) return;
        const lastName = lease.tenant?.last_name;
        if (!lastName || !(containsWord(sender, lastName) || containsWord(purpose, lastName))) return;
        let score = 50;
        const parts = ['Nachname'];
        const firstName = lease.tenant?.first_name;
        if (firstName && (containsWord(sender, firstName) || containsWord(purpose, firstName))) { score += 20; parts.push('Vorname'); }
        if (Math.abs(leaseMonthlyTotal(lease) - Number(tx.amount)) < RENT_AMOUNT_TOLERANCE) { score += 30; parts.push('Betrag = Soll-Miete'); }
        const street = lease.unit?.property?.street;
        if (street && normalizeText(street).length > 3 && containsWord(purpose, street)) { score += 15; parts.push('Straße'); }
        if (score > bestScore) {
            bestScore = score;
            best = [lease];
            bestParts = parts;
        } else if (score === bestScore) {
            best.push(lease);
        }
    });
    if (best.length === 0) return null;
    if (best.length > 1) return { ambiguous: true, count: best.length };
    return { lease: best[0], score: bestScore, reason: `Übereinstimmung: ${bestParts.join(', ')}` };
};

// Objekt über die Straße im Verwendungszweck erkennen – nur eindeutige Treffer zählen
const detectProperty = (purpose, properties) => {
    const candidates = properties.filter(p => normalizeText(p.street).length > 3 && containsWord(purpose, p.street));
    if (candidates.length <= 1) return candidates[0] || null;
    const withNumber = candidates.filter(p => p.house_number && containsWord(purpose, `${p.street} ${p.house_number}`));
    return withNumber.length === 1 ? withNumber[0] : null;
};

const suggestExpense = (tx, categories, properties) => {
    const sender = normalizeText(tx.counterpart_name);
    const purpose = normalizeText(tx.purpose);
    const heuristic = EXPENSE_HEURISTICS.find(h => h.test(sender, purpose));
    if (!heuristic) return null;
    const category = categories.find(c => heuristic.categoryKeys.some(k => normalizeText(c.name).includes(k)));
    if (!category) return null;
    const property = detectProperty(tx.purpose, properties);
    return {
        category,
        property,
        score: Math.min(heuristic.score + (property ? 10 : 0), 95),
        reason: heuristic.reason + (property ? ` • Immobilie ${propertyLabel(property)} erkannt` : '')
    };
};

const sameAmount = (a, b) => Math.abs(Math.abs(Number(a)) - Math.abs(Number(b))) < 0.01;

// Vorschlag für einen offenen Umsatz. ctx enthält die (portfolio-gefilterten) Stammdaten.
const recommendFor = (tx, ctx) => {
    const amount = Number(tx.amount);
    const none = (reason) => ({ type: null, targetId: null, confidence: 0, label: 'Kein eindeutiger Treffer', reason });

    if (amount > 0) {
        let suggestion = null;
        let noneReason = 'Keine passende Regel und kein Mietername (ganzes Wort) gefunden.';
        const hit = findRule(tx, ctx.rules, ctx.isValidRule);
        if (hit) {
            const lease = ctx.leaseById.get(hit.rule.target_id);
            suggestion = {
                type: 'income', targetId: lease.id, propertyId: lease.unit?.property_id || null, unitId: lease.unit_id || null,
                confidence: RULE_CONFIDENCE[hit.strength], label: `Miete: ${leaseLabel(lease)}`, reason: RULE_REASON[hit.strength], rule: hit.rule
            };
        } else {
            const h = suggestLease(tx, ctx.leases);
            if (h?.ambiguous) {
                noneReason = `${h.count} Mietverträge passen gleich gut (z. B. gleicher Nachname) – bitte manuell zuordnen.`;
            } else if (h) {
                suggestion = {
                    type: 'income', targetId: h.lease.id, propertyId: h.lease.unit?.property_id || null, unitId: h.lease.unit_id || null,
                    confidence: Math.min(h.score, 95), label: `Miete: ${leaseLabel(h.lease)}`, reason: h.reason
                };
            }
        }

        if (suggestion) {
            const booked = ctx.rentPayments.find(p =>
                p.lease_id === suggestion.targetId && !ctx.linkedKeys.has(`rent:${p.id}`) &&
                sameAmount(p.amount, amount) && daysBetween(p.payment_date, tx.booking_date) <= DUPLICATE_WINDOW_DAYS);
            if (booked) {
                const lease = ctx.leaseById.get(booked.lease_id);
                return {
                    ...suggestion, confidence: 100, alreadyBooked: true, linkedKey: `rent:${booked.id}`,
                    label: `Erfasste Miete: ${tenantLabel(lease?.tenant)}`,
                    reason: `Eine Zahlung über ${formatCurrency(booked.amount)} für ${leaseLabel(lease)} wurde bereits am ${formatDate(booked.payment_date)} erfasst.`
                };
            }
        }

        // Gleicher Betrag ohne Mieterbezug: nur Hinweis, keine 1-Klick-Verknüpfung
        const possible = ctx.rentPayments.find(p =>
            !ctx.linkedKeys.has(`rent:${p.id}`) && p.lease_id !== suggestion?.targetId &&
            sameAmount(p.amount, amount) && daysBetween(p.payment_date, tx.booking_date) <= POSSIBLE_RENT_DUPLICATE_DAYS);
        const possibleDuplicate = possible
            ? `Hinweis: Am ${formatDate(possible.payment_date)} wurde bereits eine Mietzahlung über ${formatCurrency(possible.amount)} erfasst (${ctx.leaseById.has(possible.lease_id) ? tenantLabel(ctx.leaseById.get(possible.lease_id).tenant) : 'anderer Mietvertrag'}). Bitte prüfen, ob es dieselbe Zahlung ist.`
            : null;

        return suggestion ? { ...suggestion, possibleDuplicate } : { ...none(noneReason), possibleDuplicate };
    }

    if (amount < 0) {
        let suggestion = null;
        const hit = findRule(tx, ctx.rules, ctx.isValidRule);
        if (hit) {
            const cat = ctx.categoryById.get(hit.rule.target_id);
            const prop = hit.rule.property_id ? ctx.propertyById.get(hit.rule.property_id) : null;
            suggestion = {
                type: 'expense', targetId: cat.id, propertyId: prop?.id || null, unitId: prop ? (hit.rule.unit_id || null) : null,
                confidence: RULE_CONFIDENCE[hit.strength], label: `Ausgabe: ${cat.name} (${prop ? propertyLabel(prop) : 'ohne Objekt'})`,
                reason: RULE_REASON[hit.strength], rule: hit.rule
            };
        } else {
            const h = suggestExpense(tx, ctx.categories, ctx.properties);
            if (h) {
                suggestion = {
                    type: 'expense', targetId: h.category.id, propertyId: h.property?.id || null, unitId: null,
                    confidence: h.score, label: `Betriebskosten: ${h.category.name} (${h.property ? propertyLabel(h.property) : 'ohne Objekt'})`,
                    reason: h.reason
                };
            }
        }

        const sender = normalizeText(tx.counterpart_name);
        const booked = ctx.expenses.find(e => {
            if (ctx.linkedKeys.has(`expense:${e.id}`) || !sameAmount(e.amount, amount)) return false;
            if (daysBetween(e.booking_date, tx.booking_date) > DUPLICATE_WINDOW_DAYS) return false;
            // Ausgabe eines anderen Objekts ist kein Duplikat (z. B. gleich hoher Abschlag für zwei Häuser)
            if (suggestion?.propertyId && e.property_id && e.property_id !== suggestion.propertyId) return false;
            if (suggestion?.targetId && e.category_id === suggestion.targetId) return true;
            const payee = normalizeText(e.payee);
            return payee.length >= 3 && sender.length >= 3 && (sender.includes(payee) || payee.includes(sender));
        });
        if (booked) {
            const cat = ctx.categoryById.get(booked.category_id);
            return {
                type: 'expense', targetId: booked.category_id || null, propertyId: booked.property_id || null, unitId: booked.unit_id || null,
                confidence: 100, alreadyBooked: true, linkedKey: `expense:${booked.id}`,
                label: `Erfasste Ausgabe (${cat?.name || booked.category_custom || 'Kategorie'})`,
                reason: `Ausgabe über ${formatCurrency(booked.amount)} (${booked.payee || 'Unbekannt'}) am ${formatDate(booked.booking_date)} wurde bereits erfasst.`
            };
        }

        const possible = ctx.expenses.find(e =>
            !ctx.linkedKeys.has(`expense:${e.id}`) && sameAmount(e.amount, amount) &&
            daysBetween(e.booking_date, tx.booking_date) <= POSSIBLE_EXPENSE_DUPLICATE_DAYS);
        const possibleDuplicate = possible
            ? `Hinweis: Am ${formatDate(possible.booking_date)} wurde bereits eine Ausgabe über ${formatCurrency(possible.amount)} erfasst (${possible.payee || 'Unbekannt'}). Bitte prüfen, ob es dieselbe Zahlung ist.`
            : null;

        return suggestion
            ? { ...suggestion, possibleDuplicate }
            : { ...none('Keine passende Regel und kein bekanntes Schlagwort gefunden.'), possibleDuplicate };
    }

    return none('Umsatz ohne Betrag');
};

// ── Vorschau-Buchungen (werden NICHT gespeichert) ───────────────────────────
// record zeigt, wie die Buchung bei einer echten Anbindung aussähe – inkl. Leistungsmonat (period_month),
// ohne den das Mietkonto den Monat nicht als bezahlt führen würde.
const buildRentAllocation = ({ lease, amount, paymentDate, periodMonth, note }) => ({
    kind: 'rent_payment',
    amount,
    record: { lease_id: lease.id, payment_date: paymentDate, period_month: `${periodMonth}-01`, amount, note: note || null },
    text: `Mietzahlung ${formatCurrency(amount)} · ${leaseLabel(lease)} · Leistungsmonat ${formatMonth(periodMonth)} · Zahldatum ${formatDate(paymentDate)}`
});

const buildExpenseAllocation = ({ amount, category, customCategory, property, unit, scope, isAllocatable, bookingDate, payee, note }) => ({
    kind: 'expense',
    amount,
    record: {
        booking_date: bookingDate, payee: payee || null, category_id: category?.id || null,
        category_custom: category ? null : customCategory, scope, property_id: property?.id || null,
        unit_id: unit?.id || null, amount, is_allocatable: !!isAllocatable, note: note || null
    },
    text: `Ausgabe ${formatCurrency(amount)} · ${category?.name || customCategory} · ${property ? propertyLabel(property) : 'ohne Objekt'}${unit ? ` / ${unit.unit_name}` : ''} · ${isAllocatable ? 'umlagefähig' : 'nicht umlagefähig'}`
});

const buildLinkAllocation = ({ amount, linkedKey, description }) => ({
    kind: 'link',
    amount,
    linkedKey,
    text: `Mit vorhandener Buchung verknüpft – keine neue Buchung (${description})`
});

const ruleCriteria = (rule) => {
    const parts = [];
    if (rule.counterpart_iban) parts.push(`IBAN ${rule.counterpart_iban}`);
    if (rule.counterpart_name) parts.push(`Name „${rule.counterpart_name}“`);
    if (rule.purpose_keyword) parts.push(`Schlüsselwort „${rule.purpose_keyword}“ (nur schwacher Hinweis)`);
    return parts.join(' · ') || 'ohne Merkmal';
};

// Kleine Aktionsknöpfe in der Umsatzliste
const actionBtn = (variant, disabled) => {
    const base = {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
        padding: '4px 8px', fontSize: '0.75rem', fontWeight: 600, borderRadius: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1
    };
    switch (variant) {
        case 'success': return { ...base, flex: 1, border: 'none', backgroundColor: 'var(--success-color)', color: 'white' };
        case 'warning': return { ...base, flex: 1, border: 'none', backgroundColor: '#d97706', color: 'white' };
        case 'primary': return { ...base, flex: 1, border: 'none', backgroundColor: 'var(--primary-color)', color: 'white' };
        case 'icon': return { ...base, padding: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)' };
        default: return { ...base, fontWeight: 500, border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-secondary)' };
    }
};

const TOAST_COLORS = { info: '#38bdf8', success: '#4ade80', error: '#f87171', learned: '#38bdf8' };

const BankReconciliation = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const userId = user?.id;

    const [todayStr] = useState(() => toDateStr(new Date()));
    const [initialLoading, setInitialLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [loadErrors, setLoadErrors] = useState([]); // Bezeichnungen der Daten, die nicht geladen werden konnten
    const [legacyError, setLegacyError] = useState(false);

    // Stammdaten und vorhandene Buchungen (nur gelesen)
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [leases, setLeases] = useState([]);
    const [categories, setCategories] = useState([]);
    const [rentPayments, setRentPayments] = useState([]);
    const [expenses, setExpenses] = useState([]);

    // Altbestand der früheren Testversion (Mock-Daten in der Datenbank)
    const [legacyConnections, setLegacyConnections] = useState([]);
    const [legacyTransactions, setLegacyTransactions] = useState([]);
    const [dbRules, setDbRules] = useState([]);

    // Lokale Demo (nur im Browser)
    const [transactions, setTransactions] = useState([]);
    const [localRules, setLocalRules] = useState([]);
    const localIdRef = useRef(0);

    // UI
    const [activeTab, setActiveTab] = useState('transactions'); // transactions, rules
    const [manualMapTx, setManualMapTx] = useState(null);
    const [incomeForm, setIncomeForm] = useState(EMPTY_INCOME_FORM);
    const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE_FORM);
    const [toast, setToast] = useState(null); // { title, message, tone }
    const toastTimerRef = useRef(null);

    const showToast = (title, message, tone = 'info') => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ title, message, tone });
        toastTimerRef.current = setTimeout(() => {
            setToast(null);
            toastTimerRef.current = null;
        }, 5000);
    };

    useEffect(() => () => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    }, []);

    const loadData = useCallback(async () => {
        if (!userId) return;
        // Zeitfenster der Demo-Umsätze ± Duplikatfenster – mehr Buchungen braucht der Abgleich nicht
        const today = toDateStr(new Date());
        const windowFrom = addDays(today, -(DEMO_MAX_AGE_DAYS + DUPLICATE_WINDOW_DAYS));
        const windowTo = addDays(today, DUPLICATE_WINDOW_DAYS);

        try {
            const [propsRes, unitsRes, leasesRes, catsRes, paymentsRes, expensesRes, connRes, txRes, rulesRes] = await Promise.all([
                fetchAllPages('properties', 'id, street, house_number, portfolio_id', q => q.order('street')),
                fetchAllPages('units', 'id, unit_name, property_id', q => q.order('unit_name')),
                // Alle Verträge (auch beendete) – Nachzahlungen ausgezogener Mieter müssen zuordenbar sein
                fetchAllPages('leases', '*, unit:units(id, unit_name, property_id, property:properties(id, street, house_number, portfolio_id)), tenant:tenants(id, first_name, last_name)'),
                fetchAllPages('expense_categories', 'id, name, is_allocatable, is_recoverable', q => q.order('name')),
                // Ohne user_id-Filter: RLS liefert auch Buchungen von Mitnutzern geteilter Portfolios
                fetchAllPages('rent_payments', 'id, lease_id, payment_date, period_month, amount', q => q.gte('payment_date', windowFrom).lte('payment_date', windowTo)),
                fetchAllPages('expenses', 'id, booking_date, payee, category_id, category_custom, property_id, unit_id, amount', q => q.gte('booking_date', windowFrom).lte('booking_date', windowTo)),
                fetchAllPages('bank_connections', 'id, bank_name, created_at', q => q.eq('user_id', userId)),
                fetchAllPages('bank_transactions', 'id, booking_date, amount, counterpart_name, status, matched_type', q => q.eq('user_id', userId).order('booking_date', { ascending: false })),
                fetchAllPages('bank_matching_rules', 'id, created_at, counterpart_name, counterpart_iban, purpose_keyword, target_type, target_id, property_id, unit_id', q => q.eq('user_id', userId).order('created_at', { ascending: false }))
            ]);

            const errors = [];
            const take = (res, label, setter) => {
                if (res.error) {
                    errors.push(label);
                    console.error(`Bankabgleich: ${label} konnten nicht geladen werden`, res.error);
                }
                setter(res.data || []);
            };
            take(propsRes, 'Objekte', setProperties);
            take(unitsRes, 'Einheiten', setUnits);
            take(leasesRes, 'Mietverträge', setLeases);
            take(catsRes, 'Kostenarten', setCategories);
            take(paymentsRes, 'Mietzahlungen', setRentPayments);
            take(expensesRes, 'Ausgaben', setExpenses);
            setLoadErrors(errors);

            const legacy = [connRes, txRes, rulesRes];
            legacy.filter(r => r.error && !isMissingTableError(r.error)).forEach(r => console.error('Bankabgleich: Altbestand konnte nicht geladen werden', r.error));
            setLegacyError(legacy.some(r => r.error && !isMissingTableError(r.error)));
            setLegacyConnections(connRes.error ? [] : connRes.data);
            setLegacyTransactions(txRes.error ? [] : txRes.data);
            setDbRules(rulesRes.error ? [] : rulesRes.data);
        } catch (error) {
            console.error('Error loading bank reconciliation data:', error);
            setLoadErrors(['alle Daten']);
        } finally {
            setInitialLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await loadData();
        } finally {
            setRefreshing(false);
        }
    };

    // Stammdaten auf das gewählte Portfolio eingrenzen ('' = alle Portfolios)
    const scoped = useMemo(() => {
        if (!selectedPortfolioID) return { properties, units, leases, rentPayments };
        const propIds = new Set(properties.filter(p => p.portfolio_id === selectedPortfolioID).map(p => p.id));
        const scopedLeases = leases.filter(l => propIds.has(l.unit?.property_id));
        const leaseIds = new Set(scopedLeases.map(l => l.id));
        return {
            properties: properties.filter(p => propIds.has(p.id)),
            units: units.filter(u => propIds.has(u.property_id)),
            leases: scopedLeases,
            rentPayments: rentPayments.filter(p => leaseIds.has(p.lease_id))
        };
    }, [selectedPortfolioID, properties, units, leases, rentPayments]);

    const scopedLeaseById = useMemo(() => new Map(scoped.leases.map(l => [l.id, l])), [scoped.leases]);
    const scopedPropertyById = useMemo(() => new Map(scoped.properties.map(p => [p.id, p])), [scoped.properties]);
    const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
    const allLeaseById = useMemo(() => new Map(leases.map(l => [l.id, l])), [leases]);
    const allPropertyById = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties]);

    // In der Demo gelernte Korrekturen zuerst, dann gespeicherte Regeln der früheren Version (neueste zuerst)
    const allRules = useMemo(() => [...localRules, ...dbRules], [localRules, dbRules]);

    const dataComplete = loadErrors.length === 0;
    const actionsLocked = !dataComplete || actionLoading || refreshing;

    // Vorschläge nur für offene, noch nicht (teil-)zugeordnete Umsätze
    const recommendations = useMemo(() => {
        const linkedKeys = new Set();
        transactions.forEach(t => (t.allocations || []).forEach(a => { if (a.linkedKey) linkedKeys.add(a.linkedKey); }));
        const ctx = {
            rules: allRules,
            leases: scoped.leases,
            leaseById: scopedLeaseById,
            properties: scoped.properties,
            propertyById: scopedPropertyById,
            categories,
            categoryById,
            rentPayments: scoped.rentPayments,
            expenses,
            linkedKeys,
            isValidRule: (rule) => rule.target_type === 'income'
                ? scopedLeaseById.has(rule.target_id)
                : categoryById.has(rule.target_id) && (!rule.property_id || scopedPropertyById.has(rule.property_id))
        };
        const map = new Map();
        transactions.forEach(tx => {
            if (tx.status === 'pending' && (tx.allocations || []).length === 0) map.set(tx.id, recommendFor(tx, ctx));
        });
        return map;
    }, [transactions, allRules, scoped, scopedLeaseById, scopedPropertyById, categories, categoryById, expenses]);

    // ── Lokale Aktionen (Vorschau, nichts wird gespeichert) ─────────────────

    const applyAllocation = (txId, allocation) => {
        setTransactions(prev => prev.map(t => {
            if (t.id !== txId) return t;
            const allocations = [...(t.allocations || []), allocation];
            const done = remainingAmount({ ...t, allocations }) <= AMOUNT_EPSILON;
            return { ...t, allocations, status: done ? 'matched' : 'pending' };
        }));
    };

    // Regel nur lokal merken. "Upsert": eine frühere Demo-Regel für denselben Zahlungspartner
    // (gleiche IBAN bzw. ohne IBAN gleicher Name) wird ersetzt, damit Korrekturen gewinnen.
    // Kein Schlüsselwort aus dem Verwendungszweck ableiten (würde fremde Umsätze treffen).
    const learnLocalRule = (tx, { type, targetId, propertyId, unitId }) => {
        const iban = normalizeIban(tx.counterpart_iban);
        const name = String(tx.counterpart_name || '').trim();
        if (!targetId || (!iban && !name)) return false;
        localIdRef.current += 1;
        const rule = {
            id: `demo-rule-${localIdRef.current}`,
            isLocal: true,
            counterpart_name: name || null,
            counterpart_iban: tx.counterpart_iban || null,
            purpose_keyword: null,
            target_type: type,
            target_id: targetId,
            property_id: propertyId || null,
            unit_id: unitId || null
        };
        const samePartner = (r) => (iban
            ? normalizeIban(r.counterpart_iban) === iban
            : !normalizeIban(r.counterpart_iban) && normalizeText(r.counterpart_name) === normalizeText(name));
        setLocalRules(prev => [rule, ...prev.filter(r => !samePartner(r))]);
        return true;
    };

    const toastAfterAllocation = (tx, learned, rest) => {
        const partner = tx.counterpart_name || 'Zahlungspartner';
        const parts = [];
        if (rest > AMOUNT_EPSILON) parts.push(`Noch offen: ${formatCurrency(rest)}.`);
        if (learned) parts.push(`Regel für „${partner}“ gemerkt (nur in dieser Demo).`);
        parts.push('Nichts gespeichert.');
        showToast('Zuordnung übernommen (Vorschau)', parts.join(' '), learned ? 'learned' : 'success');
    };

    const handleStartDemo = () => {
        setTransactions(buildDemoTransactions());
        setActiveTab('transactions');
        showToast('Demo gestartet', 'Beispiel-Umsätze geladen – nur in diesem Browserfenster, es wird nichts gespeichert.', 'info');
    };

    const handleEndDemo = () => {
        const hasWork = localRules.length > 0 || transactions.some(t => t.status !== 'pending' || (t.allocations || []).length > 0);
        if (hasWork && !window.confirm('Demo beenden? Die Beispiel-Umsätze, alle Vorschau-Zuordnungen und die in der Demo gemerkten Regeln werden verworfen.')) return;
        setTransactions([]);
        setLocalRules([]);
        setManualMapTx(null);
        showToast('Demo beendet', 'Alle Demo-Daten wurden verworfen.', 'info');
    };

    // Mit vorhandener Buchung verknüpfen (1:1 – eine Buchung kann nur mit einem Umsatz verknüpft werden)
    const handleLinkExisting = (tx, rec) => {
        if (actionsLocked || !rec?.linkedKey) return;
        applyAllocation(tx.id, buildLinkAllocation({ amount: remainingAmount(tx), linkedKey: rec.linkedKey, description: rec.label }));
        showToast('Verknüpft (Vorschau)', 'Der Umsatz würde mit der vorhandenen Buchung verknüpft – es entsteht keine zweite Buchung. Nichts gespeichert.', 'success');
    };

    // Vorschlag übernehmen (nur Vorschau)
    const handleConfirmMatch = (tx, rec) => {
        if (actionsLocked || !rec?.type || !rec.targetId) return;
        const isCredit = Number(tx.amount) > 0;
        if ((rec.type === 'income') !== isCredit) {
            showToast('Nicht übernommen', 'Art der Zuordnung und Vorzeichen des Umsatzes passen nicht zusammen.', 'error');
            return;
        }
        const amount = remainingAmount(tx);
        let allocation;
        if (rec.type === 'income') {
            const lease = scopedLeaseById.get(rec.targetId);
            if (!lease) {
                openManualMap(tx, rec);
                return;
            }
            // Leistungsmonat = Monat der Gutschrift; abweichende Monate über "Anders zuordnen" festlegen
            allocation = buildRentAllocation({ lease, amount, paymentDate: tx.booking_date, periodMonth: tx.booking_date.slice(0, 7), note: tx.purpose });
        } else {
            const category = categoryById.get(rec.targetId);
            const property = rec.propertyId ? scopedPropertyById.get(rec.propertyId) : null;
            // Ohne erkanntes Objekt keine Schnellbuchung: Objekt und Kostenart im Dialog bewusst wählen
            if (!category || !property) {
                openManualMap(tx, rec);
                return;
            }
            const unit = rec.unitId ? scoped.units.find(u => u.id === rec.unitId) || null : null;
            allocation = buildExpenseAllocation({
                amount, category, property, unit, scope: unit ? 'unit' : 'general',
                isAllocatable: category.is_recoverable ?? true, bookingDate: tx.booking_date,
                payee: tx.counterpart_name, note: tx.purpose
            });
        }
        applyAllocation(tx.id, allocation);
        const learned = learnLocalRule(tx, { type: rec.type, targetId: rec.targetId, propertyId: rec.propertyId, unitId: rec.unitId });
        toastAfterAllocation(tx, learned, 0);
    };

    const handleIgnoreTransaction = (tx) => {
        if (actionsLocked) return;
        setTransactions(prev => prev.map(t => (t.id === tx.id ? { ...t, status: 'ignored', allocations: [] } : t)));
        showToast('Umsatz ignoriert (Vorschau)', 'Über „Zurücksetzen“ wieder als offen markieren. Nichts gespeichert.', 'info');
    };

    const handleResetTransaction = (tx) => {
        setTransactions(prev => prev.map(t => (t.id === tx.id ? { ...t, status: 'pending', allocations: [] } : t)));
        showToast('Zurückgesetzt', 'Der Umsatz ist wieder offen.', 'info');
    };

    // Dialog mit Vorschlag vorbelegen
    const openManualMap = (tx, recOverride) => {
        const rec = recOverride || recommendations.get(tx.id) || null;
        const remaining = remainingAmount(tx);
        if (Number(tx.amount) > 0) {
            // Restbetrag eines teilweise zugeordneten Umsatzes: zuletzt gewählten Mietvertrag vorbelegen
            const previousLeaseId = [...(tx.allocations || [])].reverse().find(a => a.kind === 'rent_payment')?.record?.lease_id;
            const leaseId = rec?.type === 'income' && rec.targetId ? rec.targetId : previousLeaseId;
            const lease = leaseId ? scopedLeaseById.get(leaseId) : null;
            setIncomeForm({
                payment_date: tx.booking_date,
                period_month: tx.booking_date.slice(0, 7),
                property_id: lease?.unit?.property_id || '',
                lease_id: lease?.id || '',
                amount: remaining,
                note: tx.purpose || ''
            });
        } else {
            const isExpenseRec = rec?.type === 'expense';
            const cat = isExpenseRec && rec.targetId ? categoryById.get(rec.targetId) : null;
            const propertyId = isExpenseRec && rec.propertyId && scopedPropertyById.has(rec.propertyId) ? rec.propertyId : '';
            const unitId = propertyId && rec.unitId ? rec.unitId : '';
            setExpenseForm({
                booking_date: tx.booking_date,
                payee: tx.counterpart_name || '',
                category_id: cat?.id || '',
                category_custom: '',
                scope: unitId ? 'unit' : 'general',
                property_id: propertyId,
                unit_id: unitId,
                amount: remaining,
                is_allocatable: cat ? (cat.is_recoverable ?? true) : true,
                note: tx.purpose || ''
            });
        }
        setManualMapTx(tx);
    };

    // Manuelle Zuordnung übernehmen (nur Vorschau) und Regel lokal merken
    const handleSaveManualMap = () => {
        if (!manualMapTx || actionsLocked) return;
        const tx = transactions.find(t => t.id === manualMapTx.id) || manualMapTx;
        const remaining = remainingAmount(tx);
        const isCredit = Number(tx.amount) > 0;
        const amount = round2(toNumber(isCredit ? incomeForm.amount : expenseForm.amount));

        if (!(amount > 0)) {
            alert('Bitte einen Betrag größer als 0 eingeben.');
            return;
        }
        if (amount > remaining + AMOUNT_EPSILON) {
            alert(`Der Betrag darf den noch offenen Betrag dieses Umsatzes (${formatCurrency(remaining)}) nicht übersteigen.`);
            return;
        }

        let allocation;
        let ruleTarget = null;
        if (isCredit) {
            const lease = scopedLeaseById.get(incomeForm.lease_id);
            if (!lease) {
                alert('Bitte den Mietvertrag wählen, dem die Zahlung zugeordnet werden soll.');
                return;
            }
            if (!/^\d{4}-\d{2}$/.test(incomeForm.period_month || '')) {
                alert('Bitte den Leistungsmonat angeben, für den die Zahlung gilt.');
                return;
            }
            if (!incomeForm.payment_date) {
                alert('Bitte das Zahldatum angeben.');
                return;
            }
            allocation = buildRentAllocation({ lease, amount, paymentDate: incomeForm.payment_date, periodMonth: incomeForm.period_month, note: incomeForm.note });
            ruleTarget = { type: 'income', targetId: lease.id, propertyId: lease.unit?.property_id || null, unitId: lease.unit_id || null };
        } else {
            const category = categoryById.get(expenseForm.category_id) || null;
            const customCategory = (expenseForm.category_custom || '').trim();
            if (!category && !customCategory) {
                alert('Bitte eine Kostenart wählen oder eine eigene Kategorie eingeben.');
                return;
            }
            if (!expenseForm.booking_date) {
                alert('Bitte das Buchungsdatum angeben.');
                return;
            }
            const property = scopedPropertyById.get(expenseForm.property_id) || null;
            const unit = expenseForm.scope === 'unit' && expenseForm.unit_id ? scoped.units.find(u => u.id === expenseForm.unit_id) || null : null;
            if (expenseForm.scope === 'unit' && (!property || !unit)) {
                alert('Bitte Immobilie und Einheit wählen (oder Zuordnung „Allgemein“).');
                return;
            }
            allocation = buildExpenseAllocation({
                amount, category, customCategory, property, unit, scope: expenseForm.scope,
                isAllocatable: expenseForm.is_allocatable, bookingDate: expenseForm.booking_date,
                payee: expenseForm.payee, note: expenseForm.note
            });
            // Für eine Freitext-Kategorie wird keine Regel gemerkt (eine Regel braucht eine Kostenart)
            if (category) ruleTarget = { type: 'expense', targetId: category.id, propertyId: property?.id || null, unitId: unit?.id || null };
        }

        applyAllocation(tx.id, allocation);
        const learned = ruleTarget ? learnLocalRule(tx, ruleTarget) : false;
        toastAfterAllocation(tx, learned, round2(remaining - amount));
        setManualMapTx(null);
    };

    const handleDeleteRule = async (rule) => {
        if (rule.isLocal) {
            setLocalRules(prev => prev.filter(r => r.id !== rule.id));
            showToast('Regel verworfen', 'Die in der Demo gemerkte Regel wurde entfernt.', 'info');
            return;
        }
        if (!window.confirm('Möchten Sie diese gespeicherte Zuordnungsregel aus der früheren Testversion löschen?')) return;
        setActionLoading(true);
        try {
            const { error } = await supabase.from('bank_matching_rules').delete().eq('id', rule.id);
            if (error) throw error;
            setDbRules(prev => prev.filter(r => r.id !== rule.id));
            showToast('Regel gelöscht', 'Die gespeicherte Regel wurde gelöscht.', 'success');
        } catch (error) {
            console.error('Error deleting rule:', error);
            alert('Fehler beim Löschen der Regel: ' + error.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Altbestand der früheren Testversion entfernen. Achtung: Die Umsätze hängen per ON DELETE CASCADE am
    // Konto – es werden ALLE Demo-Umsätze gelöscht, auch die als verbucht markierten. Daraus erzeugte
    // Mietzahlungen/Ausgaben bleiben bestehen und müssen in den Finanzen geprüft werden.
    const handleDeleteLegacyData = async () => {
        if (!userId) return;
        const msg = 'Alte Demo-Daten löschen?\n\n'
            + `Gelöscht werden ${legacyConnections.length} Demo-Bankkonto/-konten, ${legacyTransactions.length} Demo-Umsätze `
            + `(auch die als verbucht markierten) und ${dbRules.length} gespeicherte Zuordnungsregel(n) Ihres Kontos.\n\n`
            + 'Mietzahlungen und Ausgaben, die damals aus Demo-Umsätzen gebucht wurden, bleiben in den Finanzen bestehen '
            + 'und müssen dort bei Bedarf einzeln gelöscht werden. Notieren Sie sich vorher die aufgelisteten Umsätze.';
        if (!window.confirm(msg)) return;
        setActionLoading(true);
        try {
            const { error: txErr } = await supabase.from('bank_transactions').delete().eq('user_id', userId);
            if (txErr) throw txErr;
            const { error: connErr } = await supabase.from('bank_connections').delete().eq('user_id', userId);
            if (connErr) throw connErr;
            const { error: ruleErr } = await supabase.from('bank_matching_rules').delete().eq('user_id', userId);
            if (ruleErr) throw ruleErr;
            showToast('Alte Demo-Daten gelöscht', 'Demo-Konten, -Umsätze und gespeicherte Regeln wurden entfernt.', 'success');
            await loadData();
        } catch (error) {
            console.error('Error deleting legacy bank demo data:', error);
            alert('Fehler beim Löschen der alten Demo-Daten: ' + error.message);
            await loadData();
        } finally {
            setActionLoading(false);
        }
    };

    // ── Abgeleitete Werte für die Anzeige ───────────────────────────────────
    const demoActive = transactions.length > 0;
    const openCount = transactions.filter(t => t.status === 'pending').length;
    const legacyMatched = legacyTransactions.filter(t => t.status === 'matched');
    const hasLegacyData = legacyConnections.length > 0 || legacyTransactions.length > 0 || dbRules.length > 0;

    const manualTx = manualMapTx ? (transactions.find(t => t.id === manualMapTx.id) || manualMapTx) : null;
    const manualIsCredit = manualTx ? Number(manualTx.amount) > 0 : true;
    const manualRemaining = manualTx ? remainingAmount(manualTx) : 0;

    const expenseFormUnits = useMemo(
        () => (expenseForm.property_id ? scoped.units.filter(u => u.property_id === expenseForm.property_id) : []),
        [scoped.units, expenseForm.property_id]
    );

    const incomeLeaseOptions = useMemo(() => scoped.leases
        .filter(l => !incomeForm.property_id || l.unit?.property_id === incomeForm.property_id)
        .map(l => ({ lease: l, ended: isLeaseEnded(l, todayStr) }))
        .sort((a, b) => (Number(a.ended) - Number(b.ended)) || leaseLabel(a.lease).localeCompare(leaseLabel(b.lease), 'de')),
    [scoped.leases, incomeForm.property_id, todayStr]);

    const selectedIncomeLease = scopedLeaseById.get(incomeForm.lease_id) || null;

    const saveDisabled = actionsLocked || (manualIsCredit
        ? !incomeForm.lease_id || !incomeForm.period_month
        : !(expenseForm.category_id || (expenseForm.category_custom || '').trim()));

    if (initialLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '100px' }}>
                <Loader2 className="animate-spin" size={32} color="var(--primary-color)" />
            </div>
        );
    }

    const renderAllocations = (tx) => (tx.allocations || []).map((a, i) => (
        <div key={i} style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.3, marginTop: '4px' }}>
            {a.text}
        </div>
    ));

    const renderStatusCell = (tx) => {
        if (tx.status === 'matched' || tx.status === 'ignored') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    {tx.status === 'matched'
                        ? <Badge variant="success">✓ Zugeordnet (Vorschau)</Badge>
                        : <Badge>Ignoriert (Vorschau)</Badge>}
                    {renderAllocations(tx)}
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Nicht gespeichert – Demo</div>
                    <button onClick={() => handleResetTransaction(tx)} style={{ ...actionBtn('default', false), marginTop: '4px' }} title="Wieder als offen markieren">
                        <RotateCcw size={12} /> Zurücksetzen
                    </button>
                </div>
            );
        }

        if ((tx.allocations || []).length > 0) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', padding: '8px', borderRadius: '6px', backgroundColor: 'rgba(14, 165, 233, 0.05)', border: '1px dashed rgba(14, 165, 233, 0.3)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0284c7' }}>
                        Teilweise zugeordnet: {formatCurrency(allocatedAmount(tx))} von {formatCurrency(Math.abs(tx.amount))}
                    </div>
                    {renderAllocations(tx)}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button onClick={() => openManualMap(tx)} disabled={actionsLocked} style={actionBtn('primary', actionsLocked)}>
                            Rest zuordnen
                        </button>
                        <button onClick={() => handleResetTransaction(tx)} style={actionBtn('icon', false)} title="Zurücksetzen">
                            <RotateCcw size={12} />
                        </button>
                    </div>
                </div>
            );
        }

        const rec = recommendations.get(tx.id) || { confidence: 0 };
        const ignoreButton = (
            <button onClick={() => handleIgnoreTransaction(tx)} disabled={actionsLocked} style={actionBtn('default', actionsLocked)} title="Umsatz ignorieren (Vorschau)">
                Ignorieren
            </button>
        );
        const duplicateHint = rec.possibleDuplicate && (
            <div style={{ display: 'flex', gap: '4px', fontSize: '0.68rem', color: '#b45309', marginTop: '4px', lineHeight: 1.25 }}>
                <AlertCircle size={11} style={{ flexShrink: 0, marginTop: '1px' }} /> {rec.possibleDuplicate}
            </div>
        );

        if (rec.alreadyBooked) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', padding: '8px', borderRadius: '6px', backgroundColor: 'rgba(245, 158, 11, 0.06)', border: '1px dashed rgba(245, 158, 11, 0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: '#d97706' }}>
                        <AlertCircle size={12} /> Bereits erfasst
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rec.label}>
                        {rec.label}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.2 }}>{rec.reason}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button onClick={() => handleLinkExisting(tx, rec)} disabled={actionsLocked} style={actionBtn('warning', actionsLocked)} title="Demo: mit vorhandenem Eintrag verknüpfen – es wird nichts gespeichert">
                            <Check size={12} /> Verknüpfen
                        </button>
                        <button onClick={() => openManualMap(tx)} disabled={actionsLocked} style={actionBtn('icon', actionsLocked)} title="Neu zuordnen">
                            <Settings size={12} />
                        </button>
                        {ignoreButton}
                    </div>
                </div>
            );
        }

        if (rec.confidence > 0) {
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', padding: '8px', borderRadius: '6px',
                    backgroundColor: rec.rule ? 'rgba(56, 189, 248, 0.06)' : 'rgba(22, 163, 74, 0.04)',
                    border: rec.rule ? '1px dashed rgba(56, 189, 248, 0.3)' : '1px dashed rgba(22, 163, 74, 0.25)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: rec.rule ? '#0ea5e9' : 'var(--success-color)' }}>
                        <Sparkles size={12} /> {rec.confidence}% Treffer
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rec.label}>
                        {rec.label}
                    </div>
                    {rec.reason && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.2 }}>{rec.reason}</div>
                    )}
                    {duplicateHint}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button onClick={() => handleConfirmMatch(tx, rec)} disabled={actionsLocked} style={actionBtn('success', actionsLocked)} title="Demo: zeigt nur, welche Buchung entstehen würde – es wird nichts gespeichert">
                            <Check size={12} /> Bestätigen
                        </button>
                        <button onClick={() => openManualMap(tx)} disabled={actionsLocked} style={actionBtn('icon', actionsLocked)} title="Anders zuordnen">
                            <Settings size={12} />
                        </button>
                        {ignoreButton}
                    </div>
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertCircle size={12} color="#f59e0b" /> Keine Zuweisung
                </div>
                {rec.reason && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.2 }}>{rec.reason}</div>
                )}
                {duplicateHint}
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => openManualMap(tx)} disabled={actionsLocked} style={actionBtn('primary', actionsLocked)}>
                        Zuweisen
                    </button>
                    {ignoreButton}
                </div>
            </div>
        );
    };

    const selectStyle = { width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color-soft)' };
    const labelStyle = { display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' };

    return (
        <div style={{ position: 'relative' }}>
            {/* Toast */}
            {toast && (
                <div role="status" style={{
                    position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000,
                    backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
                    padding: '16px 20px', color: '#f8fafc', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', gap: '12px', width: '380px', maxWidth: 'calc(100vw - 48px)',
                    animation: 'slideIn 0.3s ease-out'
                }}>
                    {toast.tone === 'error'
                        ? <AlertCircle size={20} color={TOAST_COLORS.error} />
                        : toast.tone === 'learned'
                            ? <Sparkles size={20} color={TOAST_COLORS.learned} />
                            : toast.tone === 'success'
                                ? <Check size={20} color={TOAST_COLORS.success} />
                                : <Info size={20} color={TOAST_COLORS.info} />}
                    <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: TOAST_COLORS[toast.tone] || TOAST_COLORS.info }}>{toast.title}</div>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>{toast.message}</div>
                    </div>
                    <button onClick={() => setToast(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }} aria-label="Hinweis schließen">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        Automatisierter Bankabgleich <Badge variant="warning">Demo</Badge>
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Vorschau der geplanten Funktion – noch ohne Verbindung zu Ihrer Bank.</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <Button variant="ghost" onClick={handleRefresh} disabled={refreshing || actionLoading} title="Lädt Objekte, Mietverträge, Kostenarten und vorhandene Buchungen neu (keine Bankumsätze)">
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} style={{ marginRight: '6px' }} /> Daten neu laden
                    </Button>
                    {!demoActive && (
                        <Button icon={FlaskConical} onClick={handleStartDemo}>
                            Demo starten
                        </Button>
                    )}
                </div>
            </div>

            {/* Demo-Hinweis */}
            <div role="note" style={{
                display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 16px', marginBottom: '20px',
                borderRadius: '10px', backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.45)',
                color: 'var(--text-primary)'
            }}>
                <TriangleAlert size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, color: '#b45309', marginBottom: '4px' }}>Demo-Modus – keine Verbindung zu Ihrer Bank</div>
                    <div>
                        Diese Seite zeigt nur, wie der Bankabgleich künftig funktionieren soll. Einen Import echter Kontoumsätze gibt es noch nicht.
                        Die Umsätze der Demo sind Beispieldaten und existieren nur in diesem Browserfenster.
                    </div>
                    <div style={{ marginTop: '4px' }}>
                        <strong>Es wird nichts gespeichert:</strong> „Bestätigen“, „Verknüpfen“, „Zuweisen“ und „Ignorieren“ zeigen nur eine Vorschau.
                        Es entstehen keine Mietzahlungen, Ausgaben, Bankkonten oder Regeln in Ihren Daten; beim Neuladen der Seite ist die Demo zurückgesetzt.
                    </div>
                </div>
            </div>

            {/* Ladefehler: Vorschläge wären unvollständig -> Zuordnen gesperrt */}
            {!dataComplete && (
                <div role="alert" style={{
                    display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 16px', marginBottom: '20px',
                    borderRadius: '10px', backgroundColor: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.35)',
                    fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--text-primary)'
                }}>
                    <AlertCircle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        <strong>Nicht alle Daten konnten geladen werden:</strong> {loadErrors.join(', ')}.
                        Vorschläge und die Prüfung auf bereits erfasste Buchungen wären unvollständig – Zuordnen ist deshalb gesperrt.
                        Bitte „Daten neu laden“.
                    </div>
                </div>
            )}

            {/* Altbestand der früheren Testversion */}
            {hasLegacyData && (
                <Card style={{ padding: '16px', marginBottom: '20px', border: '1px solid rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.03)' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <Info size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ fontSize: '0.84rem', lineHeight: 1.5, flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Alte Demo-Daten in Ihrem Konto</div>
                            <div>
                                Die frühere Testversion dieser Seite hat Beispieldaten in Ihrer Datenbank gespeichert:
                                {' '}{legacyConnections.length} Demo-Bankkonto/-konten, {legacyTransactions.length} Demo-Umsätze
                                und {dbRules.length} Zuordnungsregel(n). Diese Daten stammen nicht von Ihrer Bank. Die Umsätze werden nicht mehr angezeigt;
                                gespeicherte Regeln erscheinen weiterhin unter „Lernende Regeln“ und werden nur als Vorschlag genutzt.
                            </div>
                            {legacyMatched.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div>
                                        Aus diesen Demo-Umsätzen wurde damals eine Mietzahlung bzw. Ausgabe gebucht oder eine vorhandene Buchung verknüpft.
                                        Bitte prüfen Sie die Einträge unter <strong>Finanzen</strong> und löschen Sie sie dort, falls sie zu keiner echten Zahlung gehören:
                                    </div>
                                    <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                                        {legacyMatched.map(t => (
                                            <li key={t.id}>
                                                {formatDate(t.booking_date)} · {formatCurrency(Math.abs(Number(t.amount)))} · {t.counterpart_name || 'Unbekannt'}
                                                {' '}· {t.matched_type === 'income' ? 'als Mietzahlung' : t.matched_type === 'expense' ? 'als Ausgabe' : 'zugeordnet'}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div style={{ marginTop: '10px' }}>
                                <Button variant="secondary" size="sm" onClick={handleDeleteLegacyData} disabled={actionLoading || refreshing}>
                                    {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} style={{ marginRight: '6px' }} />}
                                    Alte Demo-Daten löschen
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>
            )}
            {legacyError && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Hinweis: Ob noch alte Demo-Daten der früheren Testversion gespeichert sind, konnte nicht geprüft werden.
                </div>
            )}

            {/* Main Layout Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '24px', alignItems: 'start' }}>

                {/* Left Area - Tabs & Lists */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>

                    {/* Tabs navigation */}
                    <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', flexWrap: 'wrap' }}>
                        <button
                            onClick={() => setActiveTab('transactions')}
                            style={{
                                padding: '8px 16px', border: 'none', background: 'none', fontSize: '0.95rem', fontWeight: 600,
                                color: activeTab === 'transactions' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                borderBottom: activeTab === 'transactions' ? '2px solid var(--primary-color)' : 'none',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            <CreditCard size={16} /> Demo-Umsätze ({openCount} offen)
                        </button>
                        <button
                            onClick={() => setActiveTab('rules')}
                            style={{
                                padding: '8px 16px', border: 'none', background: 'none', fontSize: '0.95rem', fontWeight: 600,
                                color: activeTab === 'rules' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                borderBottom: activeTab === 'rules' ? '2px solid var(--primary-color)' : 'none',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            <Sparkles size={16} /> Lernende Regeln ({allRules.length})
                        </button>
                    </div>

                    {/* Active Tab Contents */}
                    {activeTab === 'transactions' && (
                        <Card>
                            {!demoActive ? (
                                <div style={{ padding: '48px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '60px', height: '60px', borderRadius: '30px', backgroundColor: 'rgba(14, 165, 233, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0ea5e9' }}>
                                        <CreditCard size={28} />
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px' }}>Noch keine Bankanbindung verfügbar</h3>
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto', lineHeight: 1.5 }}>
                                            Ein Import echter Kontoumsätze ist in Vorbereitung. Mit der Demo sehen Sie anhand von Beispiel-Umsätzen,
                                            wie Mieteingänge und Ausgaben künftig zugeordnet werden – gespeichert wird dabei nichts.
                                        </p>
                                    </div>
                                    <Button icon={FlaskConical} onClick={handleStartDemo}>
                                        Demo starten
                                    </Button>
                                </div>
                            ) : (
                                <div style={{ overflowX: 'auto' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', backgroundColor: 'var(--border-color)', borderRadius: '8px', overflow: 'hidden', minWidth: '820px' }}>

                                        {/* Table Header */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '100px 180px 1fr 120px 240px', padding: '12px 16px', backgroundColor: 'var(--bg-secondary)', fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                            <div>Datum</div>
                                            <div>Partner / IBAN</div>
                                            <div>Verwendungszweck</div>
                                            <div>Betrag</div>
                                            <div>Zuweisung / Status</div>
                                        </div>

                                        {/* Table Body */}
                                        {transactions.map(tx => {
                                            const isPositive = Number(tx.amount) > 0;
                                            return (
                                                <div
                                                    key={tx.id}
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '100px 180px 1fr 120px 240px',
                                                        padding: '16px',
                                                        backgroundColor: 'var(--surface-color)',
                                                        alignItems: 'center',
                                                        borderBottom: '1px solid var(--border-color)',
                                                        opacity: tx.status !== 'pending' ? 0.8 : 1
                                                    }}
                                                >
                                                    {/* Date */}
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                        {formatDate(tx.booking_date)}
                                                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#b45309', marginTop: '2px' }}>BEISPIEL</div>
                                                    </div>

                                                    {/* Partner */}
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingRight: '8px' }}>
                                                        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                                            {tx.counterpart_name || 'Unbekannt'}
                                                        </span>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                                            {tx.counterpart_iban || '–'}
                                                        </span>
                                                    </div>

                                                    {/* Purpose */}
                                                    <div style={{ fontSize: '0.85rem', paddingRight: '12px', color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                                        {tx.purpose}
                                                    </div>

                                                    {/* Amount */}
                                                    <div>
                                                        <span style={{
                                                            fontWeight: 700,
                                                            fontSize: '0.95rem',
                                                            color: isPositive ? 'var(--success-color)' : 'var(--danger-color)'
                                                        }}>
                                                            {isPositive ? '+' : ''}{formatCurrency(tx.amount)}
                                                        </span>
                                                    </div>

                                                    {/* Zuweisung & Match Action */}
                                                    <div>{renderStatusCell(tx)}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </Card>
                    )}

                    {activeTab === 'rules' && (
                        <Card>
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Zuordnungsregeln</h3>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                                    Aus Ihren Zuordnungen merkt sich das System den Zahlungspartner (IBAN bzw. Name) und schlägt künftige Umsätze vor.
                                    In der Demo gemerkte Regeln gelten nur bis zum Neuladen der Seite. Vorschläge müssen immer bestätigt werden.
                                </p>
                            </div>

                            {allRules.length === 0 ? (
                                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Noch keine Regeln vorhanden.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    {allRules.map(rule => {
                                        const lease = allLeaseById.get(rule.target_id);
                                        const category = categoryById.get(rule.target_id);
                                        const prop = allPropertyById.get(rule.property_id);

                                        return (
                                            <div
                                                key={rule.id}
                                                style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
                                                    padding: '16px 20px', borderBottom: '1px solid var(--border-color)'
                                                }}
                                            >
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                                                            {rule.counterpart_name || 'Ohne Namen'}
                                                        </span>
                                                        {rule.isLocal
                                                            ? <Badge variant="blue">Demo – nur lokal</Badge>
                                                            : <Badge variant="warning">Gespeichert (frühere Testversion)</Badge>}
                                                    </div>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                                        Erkennung: {ruleCriteria(rule)}
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                        <span>Zuordnung auf:</span>
                                                        {rule.target_type === 'income' ? (
                                                            <Badge variant="success">Miete: {lease ? leaseLabel(lease) : 'Mietvertrag nicht (mehr) verfügbar'}</Badge>
                                                        ) : (
                                                            <Badge variant="warning">Ausgabe: {category?.name || 'Kostenart nicht verfügbar'} {prop ? `(${propertyLabel(prop)})` : ''}</Badge>
                                                        )}
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => handleDeleteRule(rule)}
                                                    disabled={actionLoading}
                                                    style={{
                                                        background: 'none', border: 'none', color: '#ef4444',
                                                        cursor: actionLoading ? 'not-allowed' : 'pointer', padding: '6px', borderRadius: '4px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                                    }}
                                                    title={rule.isLocal ? 'Regel verwerfen' : 'Gespeicherte Regel löschen'}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </Card>
                    )}

                </div>

                {/* Right Area - Demo-Konto */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    <Card style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Bankverbindung</h3>
                            <Badge variant={demoActive ? 'warning' : 'default'}>
                                {demoActive ? 'Demo' : 'Keine'}
                            </Badge>
                        </div>

                        {demoActive ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
                                        <Building2 size={16} color="var(--primary-color)" /> Demo-Konto (Beispieldaten)
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                                        Keine echte Bank, keine IBAN, kein Kontostand.
                                    </div>
                                    <div style={{ fontSize: '0.82rem', marginTop: '8px' }}>
                                        {transactions.length} Beispiel-Umsätze · {openCount} offen
                                    </div>
                                </div>
                                <button
                                    onClick={handleEndDemo}
                                    style={{
                                        width: '100%', padding: '8px', fontSize: '0.8rem', fontWeight: 600,
                                        color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.04)',
                                        border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', cursor: 'pointer'
                                    }}
                                >
                                    Demo beenden
                                </button>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0', lineHeight: 1.5 }}>
                                Eine Anbindung an Ihre Bank ist noch nicht verfügbar. Mit „Demo starten“ sehen Sie den Abgleich mit Beispiel-Umsätzen.
                            </div>
                        )}
                    </Card>

                    {/* How it works info panel */}
                    <Card style={{ padding: '16px', backgroundColor: 'rgba(14, 165, 233, 0.03)', border: '1px solid rgba(14, 165, 233, 0.15)' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.88rem', fontWeight: 700, color: '#0ea5e9' }}>
                            <HelpCircle size={16} /> Wie soll der Abgleich funktionieren?
                        </div>
                        <ol style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', paddingLeft: '16px', marginTop: '10px', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <li>Künftig: Kontoumsätze werden über eine Bankschnittstelle oder einen Datei-Import übernommen. In der Demo stehen Beispiel-Umsätze bereit.</li>
                            <li>Das System schlägt passende Mietverträge bzw. Kostenarten vor (gelernte IBAN-Regeln, Mietername, Betrag).</li>
                            <li>„Bestätigen“ zeigt, welche Buchung entstehen würde – in der Demo wird nichts gespeichert.</li>
                            <li>Manuelle Zuordnungen werden als Regel gemerkt (in der Demo nur bis zum Neuladen der Seite).</li>
                        </ol>
                    </Card>

                </div>

            </div>

            {/* ZUORDNUNGS-DIALOG (Vorschau) */}
            <Modal
                isOpen={!!manualTx}
                onClose={() => setManualMapTx(null)}
                title={manualIsCredit ? 'Mieteingang zuordnen (Demo)' : 'Ausgabe zuordnen (Demo)'}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setManualMapTx(null)}>Abbrechen</Button>
                        <Button onClick={handleSaveManualMap} disabled={saveDisabled}>Zuordnen (Vorschau)</Button>
                    </>
                }
            >
                {manualTx && (
                    <div style={{ padding: '10px 12px', marginBottom: 'var(--spacing-lg)', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                        <div><strong>{manualTx.counterpart_name || 'Unbekannt'}</strong> · {formatDate(manualTx.booking_date)} · {formatCurrency(manualTx.amount)}</div>
                        <div style={{ color: 'var(--text-secondary)' }}>{manualTx.purpose}</div>
                        <div style={{ marginTop: '4px' }}>Noch offen: <strong>{formatCurrency(manualRemaining)}</strong></div>
                        <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                            {manualIsCredit
                                ? 'Gutschriften werden als Mieteingang zugeordnet. Erstattungen von Dienstleistern bitte direkt in den Finanzen erfassen.'
                                : 'Abbuchungen werden als Ausgabe zugeordnet. Rückzahlungen an Mieter (z. B. Kaution, Nebenkosten-Guthaben) bitte direkt in den Finanzen erfassen.'}
                        </div>
                    </div>
                )}

                {/* Expense Form */}
                {!manualIsCredit && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Datum" type="date" value={expenseForm.booking_date} onChange={e => setExpenseForm({ ...expenseForm, booking_date: e.target.value })} />
                            <Input label="Zahlungsempfänger" value={expenseForm.payee} onChange={e => setExpenseForm({ ...expenseForm, payee: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={labelStyle}>Kostenart</label>
                                <select
                                    style={selectStyle}
                                    value={expenseForm.category_id}
                                    onChange={e => {
                                        const catId = e.target.value;
                                        const cat = categoryById.get(catId);
                                        setExpenseForm({
                                            ...expenseForm,
                                            category_id: catId,
                                            is_allocatable: cat ? (cat.is_recoverable ?? true) : true
                                        });
                                    }}
                                >
                                    <option value="">Eigene Angabe...</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            {!expenseForm.category_id && (
                                <Input label="Kategorie (Text)" value={expenseForm.category_custom} onChange={e => setExpenseForm({ ...expenseForm, category_custom: e.target.value })} />
                            )}
                        </div>

                        <div>
                            <label style={labelStyle}>Zuordnung</label>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" checked={expenseForm.scope === 'general'} onChange={() => setExpenseForm({ ...expenseForm, scope: 'general', unit_id: '' })} /> Allgemein</label>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="radio" checked={expenseForm.scope === 'unit'} onChange={() => setExpenseForm({ ...expenseForm, scope: 'unit' })} /> Einheit</label>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={labelStyle}>Immobilie</label>
                                <select
                                    style={selectStyle}
                                    value={expenseForm.property_id}
                                    onChange={e => setExpenseForm({ ...expenseForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {scoped.properties.map(p => <option key={p.id} value={p.id}>{propertyLabel(p)}</option>)}
                                </select>
                            </div>
                            {expenseForm.scope === 'unit' && (
                                <div>
                                    <label style={labelStyle}>Einheit</label>
                                    <select
                                        style={selectStyle}
                                        value={expenseForm.unit_id}
                                        onChange={e => setExpenseForm({ ...expenseForm, unit_id: e.target.value })}
                                        disabled={!expenseForm.property_id}
                                    >
                                        <option value="">Wählen...</option>
                                        {expenseFormUnits.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Betrag (€)" allowDecimals value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
                            <div style={{ display: 'flex', alignItems: 'center', marginTop: '25px' }}>
                                <label style={{ display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={expenseForm.is_allocatable} onChange={e => setExpenseForm({ ...expenseForm, is_allocatable: e.target.checked })} style={{ marginRight: 8 }} /> Umlagefähig</label>
                            </div>
                        </div>
                        <Input label="Notiz" value={expenseForm.note} onChange={e => setExpenseForm({ ...expenseForm, note: e.target.value })} />
                    </div>
                )}

                {/* Income Form */}
                {manualIsCredit && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Zahldatum" type="date" value={incomeForm.payment_date} onChange={e => setIncomeForm({ ...incomeForm, payment_date: e.target.value })} />
                            <Input label="Leistungsmonat" type="month" value={incomeForm.period_month} onChange={e => setIncomeForm({ ...incomeForm, period_month: e.target.value })} />
                        </div>

                        <div>
                            <label style={labelStyle}>Immobilie (Filter)</label>
                            <select
                                style={selectStyle}
                                value={incomeForm.property_id}
                                onChange={e => {
                                    const propertyId = e.target.value;
                                    const keepLease = selectedIncomeLease && (!propertyId || selectedIncomeLease.unit?.property_id === propertyId);
                                    setIncomeForm({ ...incomeForm, property_id: propertyId, lease_id: keepLease ? incomeForm.lease_id : '' });
                                }}
                            >
                                <option value="">Alle Immobilien</option>
                                {scoped.properties.map(p => <option key={p.id} value={p.id}>{propertyLabel(p)}</option>)}
                            </select>
                        </div>

                        <div>
                            <label style={labelStyle}>Mietvertrag (Mieter – Einheit)</label>
                            <select
                                style={selectStyle}
                                value={incomeForm.lease_id}
                                onChange={e => {
                                    const lease = scopedLeaseById.get(e.target.value);
                                    setIncomeForm({ ...incomeForm, lease_id: e.target.value, property_id: incomeForm.property_id || lease?.unit?.property_id || '' });
                                }}
                            >
                                <option value="">Wählen...</option>
                                {incomeLeaseOptions.map(({ lease, ended }) => (
                                    <option key={lease.id} value={lease.id}>
                                        {leaseLabel(lease)}{ended ? ' – beendet' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Betrag (€)" allowDecimals value={incomeForm.amount} onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })} />
                            <div>
                                <label style={labelStyle}>Soll-Miete (Gesamt)</label>
                                <input
                                    type="text"
                                    disabled
                                    value={selectedIncomeLease ? formatCurrency(leaseMonthlyTotal(selectedIncomeLease)) : '-'}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', color: 'var(--text-secondary)' }}
                                />
                            </div>
                        </div>
                        <Input label="Notiz" value={incomeForm.note} onChange={e => setIncomeForm({ ...incomeForm, note: e.target.value })} />
                    </div>
                )}

                <div style={{ display: 'flex', gap: '8px', padding: '10px', backgroundColor: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '6px', fontSize: '0.72rem', color: '#0284c7', lineHeight: 1.4, marginTop: '20px' }}>
                    <Save size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>
                        <strong>Nur Vorschau:</strong> Es wird keine Mietzahlung bzw. Ausgabe gespeichert. Die Zuordnung wird für weitere Umsätze
                        dieses Zahlungspartners (gleiche IBAN bzw. gleicher Name) als Regel gemerkt – nur in dieser Demo bis zum Neuladen der Seite.
                        Bei einer eigenen Kategorie (Freitext) wird keine Regel gemerkt. Ein Teilbetrag lässt den Rest des Umsatzes offen.
                    </span>
                </div>
            </Modal>
        </div>
    );
};

export default BankReconciliation;
