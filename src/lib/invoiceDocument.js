// Gemeinsame, vorlagenbasierte Rechnungs-/Gutschrift-Erzeugung.
//
// ALLE Rechnungsdokumente (Rechnungsliste UND Rechnungsformular) laufen über dieses Modul:
// dieselbe Schreibvorlage (document_templates type 'fewo_invoice'/'fewo_credit_note'),
// derselbe Renderer, dieselbe Nummernvergabe und dieselben Status-Regeln.
//
// Status (Spalte invoices.status; mit dem DB-Trigger protect_issued_invoice sind ausgestellte Belege
// auch in der Datenbank festgeschrieben – erlaubt bleibt nur issued -> credited):
//   draft       Entwurf – frei änderbar, Druck mit Vermerk „ENTWURF"
//   issued      ausgestellt – festgeschrieben, Korrektur nur per Gutschrift
//   credited    ausgestellte Rechnung, zu der eine Gutschrift (Storno) erstellt wurde
//               (Altbestand: hier gab es noch keinen eigenen Gutschrift-Beleg)
//   credit_note eigener Gutschrift-/Storno-Beleg mit eigener Nummer und Bezug zur Rechnung
//
// Zusatzangaben je Position (positions jsonb, rückwärtskompatibel):
//   vatRate (0/7/19), smallBusiness (true = § 19 UStG), refInvoiceId/-Number/-Date (Gutschrift)

import { supabase } from './supabase';
import { openSansFontFaceCss, fontOrigin } from './fontFaces';
import { loadHtml2Pdf } from './htmlToPdf';
import { DEFAULT_TEMPLATES } from './defaultTemplates';
import { LETTER_PAGE_CSS, scopeLetterCss } from './letterDocumentCss';

// ─── Status ──────────────────────────────────────────────────────────
export const INVOICE_STATUS = Object.freeze({
    DRAFT: 'draft',
    ISSUED: 'issued',
    CREDITED: 'credited',
    CREDIT_NOTE: 'credit_note'
});

export const INVOICE_STATUS_LABELS = {
    draft: 'Entwurf',
    issued: 'Ausgestellt',
    credited: 'Storniert',
    credit_note: 'Gutschrift'
};

export const getInvoiceStatus = (inv) => inv?.status || INVOICE_STATUS.DRAFT;

// Nur Entwürfe dürfen geändert werden – alles andere ist festgeschrieben.
export const isInvoiceEditable = (inv) => getInvoiceStatus(inv) === INVOICE_STATUS.DRAFT;

// ─── Steuer ──────────────────────────────────────────────────────────
export const VAT_RATE_OPTIONS = [19, 7, 0];
// Bisher wurden ALLE Positionen fest mit 7 % berechnet – gilt für Altpositionen ohne gespeicherten Satz.
export const LEGACY_VAT_RATE = 7;
export const SMALL_BUSINESS_NOTE = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};
// Kaufmännische Rundung auf Cent (DIN 1333): Betrag runden, Vorzeichen übernehmen (-1,005 -> -1,01).
// Dezimal statt binär skaliert: Number.EPSILON reicht ab ca. 2 € nicht (2.135 * 100 = 213.49999999999997).
// toPrecision(15) entfernt Gleitkomma-Rauschen aus Summen (0.1 + 0.2); Ergebnis nie -0.
export const r2 = (v) => {
    const n = num(v);
    const abs = Number(Math.abs(n).toPrecision(15));
    if (abs < 0.005) return 0;
    if (abs >= 1e15) return n;
    const rounded = Number(`${Math.round(Number(`${abs}e2`))}e-2`);
    return n < 0 ? -rounded : rounded;
};

const fmt = (n) => {
    const v = Math.abs(num(n)) < 0.005 ? 0 : num(n);
    return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtRate = (rate) => `${num(rate).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`;

// Kleinunternehmer-Option am Portfolio (Spalte portfolios.is_small_business, Feature-Erkennung:
// fehlt die Spalte noch, liefert select('*') das Feld nicht).
export const hasSmallBusinessColumn = (portfolio) =>
    !!portfolio && Object.prototype.hasOwnProperty.call(portfolio, 'is_small_business');
export const isSmallBusinessPortfolio = (portfolio) => portfolio?.is_small_business === true;

// Der Kleinunternehmer-Status wird beim Speichern in den Positionen eingefroren.
export const isInvoiceSmallBusiness = (inv) =>
    Array.isArray(inv?.positions) && inv.positions.some(p => p && p.smallBusiness === true);

export const getPositionVatRate = (p, smallBusiness = false) => {
    if (smallBusiness || p?.smallBusiness === true) return 0;
    const raw = p?.vatRate;
    if (raw === null || raw === undefined || raw === '') return LEGACY_VAT_RATE;
    const n = Number(raw);
    return Number.isFinite(n) ? n : LEGACY_VAT_RATE;
};

// Summen je Steuersatz (aus den gespeicherten Positionswerten, damit Tabelle und Summen übereinstimmen)
export const computeTaxBreakdown = (positions = [], smallBusiness = false) => {
    const groups = new Map();
    (Array.isArray(positions) ? positions : []).forEach(p => {
        const rate = getPositionVatRate(p, smallBusiness);
        const g = groups.get(rate) || { rate, net: 0, vat: 0, gross: 0 };
        g.net += num(p?.netTotal);
        g.vat += smallBusiness ? 0 : num(p?.vat);
        g.gross += smallBusiness ? num(p?.grossTotal ?? p?.netTotal) : num(p?.grossTotal);
        groups.set(rate, g);
    });
    return [...groups.values()]
        .map(g => ({ rate: g.rate, net: r2(g.net), vat: r2(g.vat), gross: r2(g.gross) }))
        .sort((a, b) => b.rate - a.rate);
};

// ─── Datum (immer lokal, nicht UTC) ──────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

export const toLocalDateString = (date = new Date()) =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const parseLocalDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
    if (m) {
        const y = Number(m[1]), mo = Number(m[2]) - 1, day = Number(m[3]);
        const d = new Date(y, mo, day);
        // Unmögliche Kalenderdaten (2023-02-29, 2026-04-31) nicht still auf einen anderen Tag verschieben
        return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day ? d : null;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
};

export const formatDateDE = (value) => {
    const d = parseLocalDate(value);
    return d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
};

// ─── HTML-Schutz ─────────────────────────────────────────────────────
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const escapeMultiline = (value) => String(value ?? '').split(/\r?\n/).map(escapeHtml).join('<br>');

const BLOCKED_TAGS = new Set([
    'SCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE',
    'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH',
    'STYLE', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'PORTAL'
]);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'srcset', 'data', 'lowsrc', 'dynsrc', 'ping', 'cite', 'longdesc']);

const isSafeUrl = (value, attrName) => {
    // eslint-disable-next-line no-control-regex
    const v = String(value || '').replace(/[\u0000- ]+/g, '').toLowerCase();
    if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false;
    if (v.startsWith('data:')) return attrName === 'src' && v.startsWith('data:image/') && !v.startsWith('data:image/svg');
    return true;
};

// Entfernt aktive Inhalte (Skripte, Event-Handler, javascript:-URLs, eingebettete Objekte) aus Vorlagen-HTML.
// Wichtig: Das Druckfenster hat dieselbe Herkunft wie die App, und die PDF-Erzeugung klont den Inhalt ins App-Dokument.
export const sanitizeTemplateHtml = (html) => {
    if (!html) return '';
    if (typeof DOMParser === 'undefined') return String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, 'text/html');
    const walk = (node) => {
        Array.from(node.childNodes).forEach(child => {
            if (child.nodeType === 8) { child.remove(); return; }
            if (child.nodeType !== 1) return;
            if (BLOCKED_TAGS.has(String(child.tagName).toUpperCase())) { child.remove(); return; }
            Array.from(child.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
                    child.removeAttribute(attr.name);
                } else if (URL_ATTRS.has(name) && !isSafeUrl(attr.value, name)) {
                    child.removeAttribute(attr.name);
                } else if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(attr.value)) {
                    child.removeAttribute(attr.name);
                }
            });
            walk(child);
        });
    };
    walk(doc.body);
    return doc.body.innerHTML;
};

// Platzhalter-Ersetzung: Werte in `vars` sind fertiges, bereits maskiertes HTML.
// Variablen-Chips (<span data-id="...">, auch mit verschachtelten Spans) werden per DOM ersetzt,
// {schluessel}-Platzhalter per Replacer-Callback (kein '$'-Musterproblem). Unbekannte Chips werden geleert.
// Bei nicht vertrauenswürdigen Vorlagen das Ergebnis anschließend mit sanitizeTemplateHtml bereinigen.
export const replaceHTMLVariables = (htmlStr, vars = {}) => {
    if (!htmlStr) return '';
    const has = (key) => Object.prototype.hasOwnProperty.call(vars, key);
    // 1. {schluessel} im Vorlagentext (vor dem Einsetzen, damit eingesetzte Werte nicht erneut ersetzt werden)
    let html = String(htmlStr).replace(/\{([a-z0-9_]+)\}/gi, (match, key) => (has(key) ? String(vars[key] ?? '') : match));
    // 2. Variablen-Chips
    if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, 'text/html');
        Array.from(doc.body.querySelectorAll('span[data-id]')).forEach(el => {
            if (!el.isConnected) return; // lag in einem bereits ersetzten Chip
            const key = el.getAttribute('data-id');
            const tpl = doc.createElement('template');
            tpl.innerHTML = has(key) ? String(vars[key] ?? '') : '';
            el.replaceWith(tpl.content);
        });
        html = doc.body.innerHTML;
    } else {
        for (const key of Object.keys(vars)) {
            const re = new RegExp(`<span[^>]*data-id="${key}"[^>]*>[\\s\\S]*?</span>`, 'g');
            html = html.replace(re, () => String(vars[key] ?? ''));
        }
    }
    return html;
};

const templateHasVariable = (html, key) =>
    !!html && (html.includes(`data-id="${key}"`) || html.includes(`{${key}}`));

// Sichtbare Markierung fehlender Angaben (statt erfundener Musterwerte)
const missingMark = (text) => `<span class="ic-missing">[${escapeHtml(text)}]</span>`;

const joinNonEmpty = (parts, sep) => parts.map(s => String(s ?? '').trim()).filter(Boolean).join(sep);

// ─── Stammdaten ──────────────────────────────────────────────────────
// Absender: die in der Rechnung gespeicherte Anschrift hat Vorrang (eingefroren), sonst das Portfolio.
export const getInvoiceSender = (inv, portfolio) => {
    const hasInvoiceAddress = !!(inv?.sender_street || inv?.sender_zip || inv?.sender_city);
    return {
        name: String(inv?.sender_name || portfolio?.company_name || portfolio?.name || '').trim(),
        street: hasInvoiceAddress ? String(inv?.sender_street || '').trim() : joinNonEmpty([portfolio?.street, portfolio?.house_number], ' '),
        zip: hasInvoiceAddress ? String(inv?.sender_zip || '').trim() : String(portfolio?.zip || '').trim(),
        city: hasInvoiceAddress ? String(inv?.sender_city || '').trim() : String(portfolio?.city || '').trim(),
        email: String(portfolio?.email || '').trim(),
        phone: String(portfolio?.phone || '').trim(),
        bankName: String(portfolio?.bank_name || '').trim(),
        iban: String(portfolio?.iban || '').trim(),
        bic: String(portfolio?.bic || '').trim(),
        taxNumber: String(portfolio?.tax_number || '').trim(),
        vatId: String(portfolio?.vat_id || '').trim()
    };
};

export const getInvoiceRecipient = (inv) => {
    const street = String(inv?.recipient_street || '').trim();
    const zip = String(inv?.recipient_zip || '').trim();
    const city = String(inv?.recipient_city || '').trim();
    return {
        name: String(inv?.recipient_name || inv?.tenant?.name || inv?.contact?.name || '').trim(),
        street, zip, city,
        legacyAddress: (!street && !zip && !city) ? String(inv?.tenant?.address || '').trim() : ''
    };
};

// Bezug einer Gutschrift auf die Originalrechnung (in den Positionen gespeichert)
export const getCreditNoteReference = (inv) => {
    const p = (Array.isArray(inv?.positions) ? inv.positions : []).find(x => x && (x.refInvoiceId || x.refInvoiceNumber));
    return p ? { id: p.refInvoiceId || null, number: p.refInvoiceNumber || '', date: p.refInvoiceDate || null } : null;
};

// Belegart, Nummer und Dateiname aus EINER Quelle (Status bzw. ausdrücklich gewählte Alt-Gutschrift)
export const getInvoiceDocumentInfo = (inv, { legacyCredit = false } = {}) => {
    const status = getInvoiceStatus(inv);
    const baseNumber = String(inv?.invoice_number || '').trim();
    let isCredit = false;
    let number = baseNumber;
    let reference = null;
    if (status === INVOICE_STATUS.CREDIT_NOTE) {
        isCredit = true;
        reference = getCreditNoteReference(inv);
    } else if (legacyCredit) {
        // Altbestand: Gutschrift ohne eigenen Datensatz (Nummer „GS-<Rechnungsnummer>")
        isCredit = true;
        number = baseNumber ? `GS-${baseNumber}` : '';
        reference = { id: inv?.id || null, number: baseNumber, date: inv?.invoice_date || null };
    }
    const label = isCredit ? 'Gutschrift' : 'Rechnung';
    const isDraft = status === INVOICE_STATUS.DRAFT;
    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9äöüÄÖÜß\s._-]/g, '').trim().replace(/\s+/g, '_');
    const numberPart = safe(number) || 'ohne_Nummer';
    const recipientPart = safe(getInvoiceRecipient(inv).name);
    const titleBase = `${isDraft ? 'Entwurf_' : ''}${label}_${numberPart}`;
    return {
        kind: isCredit ? 'credit_note' : 'invoice',
        label,
        number,
        isDraft,
        reference,
        titleBase,
        filenameBase: recipientPart ? `${titleBase}_${recipientPart}` : titleBase
    };
};

// Fehlende Pflicht-/Zahlungsangaben (§ 14 Abs. 4 UStG) – für Hinweise vor dem Ausstellen
export const getInvoiceMissingFields = (inv, portfolio, { legacyCredit = false } = {}) => {
    const info = getInvoiceDocumentInfo(inv, { legacyCredit });
    const s = getInvoiceSender(inv, portfolio);
    const r = getInvoiceRecipient(inv);
    const missing = [];
    if (!s.name) missing.push('Name des Rechnungsstellers');
    if (!s.street || !s.zip || !s.city) missing.push('Vollständige Anschrift des Rechnungsstellers');
    if (!s.taxNumber && !s.vatId) missing.push('Steuernummer oder USt-IdNr. (im Portfolio hinterlegen)');
    if (!r.name) missing.push('Name des Rechnungsempfängers');
    if (!(r.street && r.zip && r.city) && !r.legacyAddress) missing.push('Vollständige Anschrift des Rechnungsempfängers');
    if (!info.number) missing.push('Rechnungsnummer');
    if (!inv?.invoice_date) missing.push('Rechnungsdatum');
    if (!inv?.move_in || !inv?.move_out) missing.push('Leistungszeitraum (Anreise/Abreise)');
    if (info.kind === 'invoice' && !s.iban) missing.push('Bankverbindung/IBAN (im Portfolio hinterlegen)');
    return missing;
};

// ─── Standardvorlagen ────────────────────────────────────────────────
// Gemeinsame Quelle mit dem Vorlagen-Editor (lib/defaultTemplates.js)
export const DEFAULT_FEWO_INVOICE = DEFAULT_TEMPLATES.fewo_invoice.content_html;

export const DEFAULT_FEWO_CREDIT_NOTE = DEFAULT_TEMPLATES.fewo_credit_note.content_html;

// ─── Vorlagen laden ──────────────────────────────────────────────────
// Portfolio-Vorlage (bevorzugt die des Portfolio-Eigentümers, sonst die zuletzt geänderte) -> globale Vorlage -> Standard.
// Fehler werden NICHT verschluckt: sonst käme still die Standardvorlage statt der gepflegten.
const loadTemplateHtml = async (type, { userId, ownerId, portfolioId }) => {
    if (portfolioId) {
        const { data, error } = await supabase
            .from('document_templates')
            .select('content_html, user_id, updated_at')
            .eq('type', type)
            .eq('portfolio_id', portfolioId)
            .eq('is_custom', false)
            .order('updated_at', { ascending: false })
            .limit(20);
        if (error) throw error;
        const rows = (data || []).filter(r => r.content_html);
        const row = (ownerId && rows.find(r => r.user_id === ownerId)) || rows[0];
        if (row) return row.content_html;
    }
    const globalOwner = ownerId || userId;
    if (!globalOwner) return null;
    const { data, error } = await supabase
        .from('document_templates')
        .select('content_html')
        .eq('type', type)
        .eq('user_id', globalOwner)
        .is('portfolio_id', null)
        .eq('is_custom', false)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0]?.content_html || null;
};

export const fetchInvoiceTemplates = async (user, portfolioId, { ownerId = null } = {}) => {
    const results = { fewo_invoice_template: null, fewo_credit_note_template: null };
    if (!user) return results;
    try {
        const opts = { userId: user.id, ownerId, portfolioId };
        const [inv, cn] = await Promise.all([
            loadTemplateHtml('fewo_invoice', opts),
            loadTemplateHtml('fewo_credit_note', opts)
        ]);
        results.fewo_invoice_template = inv;
        results.fewo_credit_note_template = cn;
    } catch (e) {
        console.error('Error fetching invoice writing templates:', e);
        throw new Error('Die Schreibvorlage für Rechnungen konnte nicht geladen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.');
    }
    return results;
};

// ─── Dokument-CSS (auf .ic-invoice-doc begrenzt) ─────────────────────
// Steht im <body>, damit die PDF-Erzeugung (klont den Inhalt ins App-Dokument) dieselben Regeln mitnimmt.
// Seitengeometrie aus derselben Quelle wie Editor und Druckfenster (lib/letterPage.css), auf den
// Container begrenzt; hier nur Rechnungs-Besonderheiten (kein Schatten, Seitenumbrüche, Entwurfsvermerk).
const SCOPED_CSS = `
.ic-invoice-doc { position: relative; background: #ffffff; color: #000000; font-family: 'Open Sans', Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5; text-align: left; }
.ic-invoice-doc *, .ic-invoice-doc *::before, .ic-invoice-doc *::after { box-sizing: border-box; margin: 0; padding: 0; }
${scopeLetterCss(LETTER_PAGE_CSS, '.ic-invoice-doc')}
.ic-invoice-doc .letter-page { box-shadow: none !important; border-radius: 0 !important; page-break-after: always; break-after: page; page-break-inside: avoid; }
.ic-invoice-doc .letter-page:last-child { page-break-after: auto; break-after: auto; }
.ic-invoice-doc .variable-chip { background: transparent !important; border: none !important; padding: 0 !important; color: inherit !important; font-weight: inherit !important; font-size: inherit !important; display: inline !important; }
.ic-invoice-doc table { width: 100%; border-collapse: collapse; }
.ic-invoice-doc tr { break-inside: avoid; page-break-inside: avoid; }
.ic-invoice-doc .ic-missing { color: #b91c1c; border: 1px dashed #b91c1c; padding: 0 2px; font-weight: 600; text-transform: none; letter-spacing: 0; }
.ic-invoice-doc .ic-tax-notes { margin-top: 8px; font-size: 9pt; line-height: 1.4; color: #333333; }
.ic-invoice-doc .ic-draft-mark { position: absolute; top: 115mm; left: 0; width: 210mm; text-align: center; font-size: 90pt; font-weight: 700; letter-spacing: 8px; color: rgba(185, 28, 28, 0.13); transform: rotate(-30deg); pointer-events: none; z-index: 10; }
.ic-invoice-doc.ic-pdf:not(.ic-flow) .letter-page { height: 296mm !important; min-height: 296mm !important; max-height: 296mm !important; }
.ic-invoice-doc.ic-flow .letter-page { width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; padding: 0 !important; overflow: visible !important; page-break-inside: auto; }
.ic-invoice-doc.ic-flow .letter-body { flex: none !important; overflow: visible !important; margin-bottom: 8mm; }
.ic-invoice-doc.ic-flow .letter-footer { position: static !important; height: auto !important; margin-top: 8mm !important; break-inside: avoid; page-break-inside: avoid; }
.ic-invoice-doc.ic-flow .ic-draft-mark { width: 100%; }
`;

// Schrift wie im Editor: lokal ausgelieferte Open Sans (dieselben Dateien), siehe lib/fontFaces.js.
const fontFaceCss = () => openSansFontFaceCss();
// Kein Skript im Druckdokument: zusätzliche Absicherung neben Maskierung und Bereinigung.
const docCsp = () => `default-src 'none'; style-src 'unsafe-inline'; font-src ${fontOrigin()} data:; img-src data: blob: https:;`;

// ─── Positionstabelle ────────────────────────────────────────────────
const buildPositionsTable = ({ positions, smallBusiness, breakdown, isCredit, notes }) => {
    const td = 'padding:6px;vertical-align:top;border-bottom:1px solid #cbd5e1;';
    const rows = positions.map((p, idx) => {
        const unitPrice = p?.isFirst && num(p?.pricePerNight) ? `${fmt(p.pricePerNight)} €` : '';
        const posNo = escapeHtml(p?.pos ?? idx + 1);
        const desc = escapeMultiline(p?.description || '');
        if (smallBusiness) {
            return `<tr><td style="${td}text-align:center;">${posNo}</td><td style="${td}text-align:left;padding:6px 10px;word-wrap:break-word;">${desc}</td><td style="${td}text-align:right;white-space:nowrap;">${unitPrice}</td><td style="${td}text-align:right;white-space:nowrap;font-weight:bold;">${fmt(p?.grossTotal ?? p?.netTotal)} €</td></tr>`;
        }
        const rate = getPositionVatRate(p, false);
        return `<tr><td style="${td}text-align:center;">${posNo}</td><td style="${td}text-align:left;padding:6px 10px;word-wrap:break-word;">${desc}</td><td style="${td}text-align:right;white-space:nowrap;">${unitPrice}</td><td style="${td}text-align:right;white-space:nowrap;">${fmt(p?.netTotal)} €</td><td style="${td}text-align:right;white-space:nowrap;">${fmtRate(rate)}</td><td style="${td}text-align:right;white-space:nowrap;font-weight:bold;">${fmt(p?.grossTotal)} €</td></tr>`;
    }).join('');

    const totalNet = r2(breakdown.reduce((s, g) => s + g.net, 0));
    const totalVat = r2(breakdown.reduce((s, g) => s + g.vat, 0));
    const totalGross = r2(breakdown.reduce((s, g) => s + g.gross, 0));
    const totalLabel = `${isCredit ? 'Gutschriftsbetrag' : 'Gesamtbetrag'}`;
    const sumRow = (label, value, cols) => `<tr><td colspan="${cols}" style="padding:4px 6px;font-weight:bold;">${label}</td><td style="padding:4px 6px;text-align:right;font-weight:bold;white-space:nowrap;">${value}</td>${smallBusiness ? '' : '<td colspan="2"></td>'}</tr>`;

    let head;
    let totals;
    if (smallBusiness) {
        head = `<tr style="border-bottom:2px solid #000;font-weight:bold;background-color:#f1f5f9;"><th style="padding:6px;text-align:center;width:8%;">Pos.</th><th style="padding:6px 10px;text-align:left;width:56%;">Bezeichnung</th><th style="padding:6px;text-align:right;width:16%;">Einzel</th><th style="padding:6px;text-align:right;width:20%;">Betrag</th></tr>`;
        totals = `<tr style="border-top:1px solid #000;border-bottom:2px double #000;background-color:#f8fafc;"><td colspan="3" style="padding:8px;font-weight:bold;font-size:11pt;">${totalLabel}:</td><td style="padding:8px;text-align:right;font-weight:bold;font-size:11pt;white-space:nowrap;">${fmt(totalGross)} €</td></tr>`;
    } else {
        head = `<tr style="border-bottom:2px solid #000;font-weight:bold;background-color:#f1f5f9;"><th style="padding:6px;text-align:center;width:8%;">Pos.</th><th style="padding:6px 10px;text-align:left;width:42%;">Bezeichnung</th><th style="padding:6px;text-align:right;width:12%;">Einzel</th><th style="padding:6px;text-align:right;width:12%;">Netto</th><th style="padding:6px;text-align:right;width:10%;">USt.</th><th style="padding:6px;text-align:right;width:16%;">Gesamt</th></tr>`;
        const lines = [];
        const vatLabel = (rate) => (rate > 0 && !isCredit ? `zzgl. ${fmtRate(rate)} USt.` : `Umsatzsteuer ${fmtRate(rate)}`);
        if (breakdown.length <= 1) {
            const g = breakdown[0] || { rate: LEGACY_VAT_RATE, net: 0, vat: 0 };
            lines.push(sumRow('Zwischensumme (Netto):', `${fmt(g.net)} €`, 3));
            lines.push(sumRow(`${vatLabel(g.rate)}:`, `${fmt(g.vat)} €`, 3));
        } else {
            // Je Steuersatz: Entgelt (Netto) und Steuerbetrag in einer Zeile (§ 14 Abs. 4 Nr. 7/8 UStG)
            lines.push(sumRow('Summe Netto:', `${fmt(totalNet)} €`, 3));
            breakdown.forEach(g => {
                lines.push(sumRow(`${vatLabel(g.rate)} auf ${fmt(g.net)} €:`, `${fmt(g.vat)} €`, 3));
            });
        }
        lines[0] = lines[0].replace('<tr>', '<tr style="border-top:2px solid #000;">');
        totals = lines.join('') + `<tr style="border-top:1px solid #000;border-bottom:2px double #000;background-color:#f8fafc;"><td colspan="3" style="padding:8px;font-weight:bold;font-size:11pt;">${totalLabel} (Brutto):</td><td colspan="3" style="padding:8px;text-align:right;font-weight:bold;font-size:11pt;white-space:nowrap;">${fmt(totalGross)} €</td></tr>`;
    }

    const notesHtml = notes.length ? `<div class="ic-tax-notes">${notes.join('<br>')}</div>` : '';
    return {
        html: `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:10pt;line-height:1.35;"><thead>${head}</thead><tbody>${rows}${totals}</tbody></table>${notesHtml}`,
        totalNet, totalVat, totalGross
    };
};

// ─── Druck-HTML ──────────────────────────────────────────────────────
// Erzeugt das vollständige Druck-HTML (A4-Briefseite) für eine Rechnung/Gutschrift.
// legacyCredit: Altbestand – Gutschrift-Dokument einer 'credited'-Rechnung ohne eigenen Gutschrift-Datensatz.
export const generateInvoiceHtml = (inv, { portfolios = [], writingTemplates = null, legacyCredit = false, forPdf = false } = {}) => {
    const portfolio = (portfolios || []).find(p => p.id === inv.portfolio_id) || null;
    const info = getInvoiceDocumentInfo(inv, { legacyCredit });
    const isCredit = info.kind === 'credit_note';
    const smallBusiness = isInvoiceSmallBusiness(inv);
    const s = getInvoiceSender(inv, portfolio);
    const r = getInvoiceRecipient(inv);

    let templateHtml = isCredit
        ? (writingTemplates?.fewo_credit_note_template || DEFAULT_FEWO_CREDIT_NOTE)
        : (writingTemplates?.fewo_invoice_template || DEFAULT_FEWO_INVOICE);
    templateHtml = sanitizeTemplateHtml(templateHtml);

    // Fest eingetragene Fremd-Adresse aus alten Standardvorlagen durch die Portfolio-Kontaktadresse ersetzen
    const contactEmail = s.email ? escapeHtml(s.email) : '';
    templateHtml = templateHtml
        .replace(/E-Mail:\s*info@immocontrol\.de/g, () => (contactEmail ? `E-Mail: ${contactEmail}` : ''))
        .replace(/info@immocontrol\.de/g, () => contactEmail);

    // Absenderanschrift (§ 14 Abs. 4 Nr. 1 UStG)
    const senderCityLine = joinNonEmpty([s.zip, s.city], ' ');
    const senderAddressLine = joinNonEmpty([s.street, senderCityLine], ', ');
    let senderAddressHtml;
    if (s.street && s.zip && s.city) senderAddressHtml = escapeHtml(senderAddressLine);
    else if (senderAddressLine) senderAddressHtml = `${escapeHtml(senderAddressLine)} ${missingMark('Anschrift unvollständig')}`;
    else senderAddressHtml = missingMark('Anschrift des Rechnungsstellers fehlt');

    // Empfängeranschrift
    let recipientAddressHtml;
    if (r.legacyAddress) recipientAddressHtml = escapeMultiline(r.legacyAddress);
    else {
        const lines = [r.street, joinNonEmpty([r.zip, r.city], ' ')].filter(Boolean).map(escapeHtml);
        recipientAddressHtml = lines.join('<br>');
        if (!(r.street && r.zip && r.city)) {
            recipientAddressHtml += `${recipientAddressHtml ? '<br>' : ''}${missingMark(lines.length ? 'Anschrift unvollständig' : 'Anschrift des Empfängers fehlt')}`;
        }
    }

    // Steuernummer / USt-IdNr. (§ 14 Abs. 4 Nr. 2 UStG)
    const taxParts = [s.taxNumber && `Steuernummer: ${escapeHtml(s.taxNumber)}`, s.vatId && `USt-IdNr.: ${escapeHtml(s.vatId)}`].filter(Boolean);
    const taxHtml = taxParts.length ? taxParts.join('<br>') : missingMark('Steuernummer oder USt-IdNr. fehlt');

    // Bankverbindung – keine Musterwerte
    let bankHtml;
    if (s.iban) bankHtml = escapeHtml(joinNonEmpty([s.bankName && `Bank: ${s.bankName}`, `IBAN: ${s.iban}`, s.bic && `BIC: ${s.bic}`], ', '));
    else bankHtml = isCredit ? '' : missingMark('Bankverbindung fehlt – bitte im Portfolio hinterlegen');

    const contactHtml = escapeHtml(joinNonEmpty([s.email && `E-Mail: ${s.email}`, s.phone && `Tel.: ${s.phone}`], ' · '));

    const servicePeriod = inv.move_in && inv.move_out
        ? escapeHtml(`${formatDateDE(inv.move_in)} – ${formatDateDE(inv.move_out)}`)
        : missingMark('Leistungszeitraum fehlt');

    const reference = info.reference;
    const refNumberHtml = reference?.number ? escapeHtml(reference.number) : (isCredit ? missingMark('Bezugsrechnung fehlt') : '');
    const refDateHtml = reference?.date ? escapeHtml(formatDateDE(reference.date)) : '';

    // Ergänzende Angaben unter der Tabelle, falls die (ältere) Vorlage sie nicht enthält
    const notes = [];
    if (smallBusiness) notes.push(escapeHtml(SMALL_BUSINESS_NOTE));
    const showsTaxId = templateHasVariable(templateHtml, 'vermieter_steuer_angabe')
        || (templateHasVariable(templateHtml, 'vermieter_steuernummer') && s.taxNumber)
        || (templateHasVariable(templateHtml, 'vermieter_ust_id') && s.vatId);
    if (!showsTaxId) notes.push(taxParts.length ? taxParts.join(' · ') : taxHtml);
    if (isCredit && !templateHasVariable(templateHtml, 'original_rechnungsnummer')) {
        notes.push(`Diese Gutschrift bezieht sich auf die Rechnung Nr. ${refNumberHtml}${refDateHtml ? ` vom ${refDateHtml}` : ''}.`);
    }

    const positions = Array.isArray(inv.positions) ? inv.positions : [];
    let breakdown = computeTaxBreakdown(positions, smallBusiness);
    if (breakdown.length === 0) {
        breakdown = [{ rate: smallBusiness ? 0 : LEGACY_VAT_RATE, net: r2(inv.net_amount), vat: r2(inv.vat_amount), gross: r2(inv.gross_amount) }];
    }
    const table = buildPositionsTable({ positions, smallBusiness, breakdown, isCredit, notes });

    const localVars = {
        beleg_art: escapeHtml(info.label),
        gast_name: r.name ? escapeHtml(r.name) : missingMark('Name des Empfängers fehlt'),
        gast_adresse: recipientAddressHtml,
        buchungszeitraum: servicePeriod,
        leistungszeitraum: servicePeriod,
        gaeste_anzahl: inv.persons ? escapeHtml(inv.persons) : '',
        rechnungsnummer: info.number ? escapeHtml(info.number) : missingMark('Nummer fehlt'),
        rechnungsdatum: inv.invoice_date ? escapeHtml(formatDateDE(inv.invoice_date)) : missingMark('Datum fehlt'),
        netto_betrag: `${fmt(table.totalNet)} €`,
        mwst_betrag: `${fmt(table.totalVat)} €`,
        brutto_betrag: `${fmt(table.totalGross)} €`,
        original_rechnungsnummer: refNumberHtml,
        original_rechnungsdatum: refDateHtml,
        vermieter_name: s.name ? escapeHtml(s.name) : missingMark('Name des Rechnungsstellers fehlt'),
        vermieter_adresse: senderAddressHtml,
        vermieter_kontakt: contactHtml,
        vermieter_bankverbindung: bankHtml,
        vermieter_steuernummer: s.taxNumber ? escapeHtml(s.taxNumber) : '',
        vermieter_ust_id: s.vatId ? escapeHtml(s.vatId) : '',
        vermieter_steuer_angabe: taxHtml,
        steuer_hinweis: smallBusiness ? escapeHtml(SMALL_BUSINESS_NOTE) : '',
        positions_tabelle: table.html,
        // In den Fewo-Vorlagen steht die Objekt-Adresse in der Absenderzeile -> vollständige Absenderanschrift
        objekt_adresse: senderAddressHtml
    };

    // Nach dem Einsetzen erneut bereinigen: Ein {schluessel} an Attribut-Position der Vorlage
    // (z. B. <img src=x {gast_name}>) würde sonst aus maskierten Nutzerwerten einen Event-Handler machen.
    const renderedContent = sanitizeTemplateHtml(replaceHTMLVariables(templateHtml, localVars));
    const rootClass = ['ic-invoice-doc', info.isDraft ? 'ic-draft' : '', forPdf ? 'ic-pdf' : ''].filter(Boolean).join(' ');
    const draftMark = info.isDraft ? '<div class="ic-draft-mark" aria-hidden="true">ENTWURF</div>' : '';

    return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${docCsp()}"><title>${escapeHtml(info.titleBase)}</title>
    <style>${fontFaceCss()} @page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #ffffff; } @media print { html, body { margin: 0; padding: 0; background: #ffffff; } }</style>
    </head>
    <body><div class="${rootClass}"><style>${SCOPED_CSS}</style>${draftMark}${renderedContent}</div></body>
    </html>`;
};

// ─── Rendering-Hilfen ────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Wartet auf Stylesheets und die Webfont (statt fester Wartezeit), höchstens timeoutMs.
const waitForDocument = async (doc, timeoutMs = 5000) => {
    const start = Date.now();
    while (doc.readyState !== 'complete' && Date.now() - start < timeoutMs) {
        await sleep(50);
    }
    try {
        if (doc.fonts && typeof doc.fonts.load === 'function') {
            const loads = Promise.all([
                doc.fonts.load('400 11pt "Open Sans"'),
                doc.fonts.load('700 11pt "Open Sans"')
            ]).then(() => doc.fonts.ready);
            await Promise.race([loads, sleep(Math.max(800, timeoutMs - (Date.now() - start)))]);
        }
    } catch { /* Schrift nicht verfügbar – Ersatzschrift */ }
    await sleep(60);
};

// Passt der Inhalt nicht auf eine Seite, wird auf mehrseitigen Fließtext umgeschaltet (statt abzuschneiden).
const applyFlowLayoutIfNeeded = (doc) => {
    const root = doc.querySelector('.ic-invoice-doc');
    if (!root) return false;
    const overflowing = (el) => el.scrollHeight > el.clientHeight + 2;
    const tooLong = Array.from(root.querySelectorAll('.letter-body')).some(overflowing)
        || Array.from(root.querySelectorAll('.letter-page')).some(overflowing);
    if (!tooLong) return false;
    root.classList.add('ic-flow');
    const style = doc.createElement('style');
    style.textContent = '@page { size: A4; margin: 20mm 20mm 20mm 25mm; }';
    doc.head.appendChild(style);
    return true;
};

// ─── Drucken ─────────────────────────────────────────────────────────
const POPUP_BLOCKED_MSG = 'Das Druckfenster wurde vom Browser blockiert. Bitte erlauben Sie Pop-ups für diese Seite und versuchen Sie es erneut.';

// Öffnet das Druckfenster SOFORT (synchron im Klick), damit Pop-up-Blocker nicht greifen.
export const openInvoicePrintWindow = () => {
    const win = window.open('', '_blank');
    if (!win) return null;
    try {
        win.document.open();
        win.document.write('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Dokument wird vorbereitet …</title></head><body style="font-family:Arial,sans-serif;padding:40px;color:#555;">Dokument wird vorbereitet …</body></html>');
        win.document.close();
    } catch { /* Platzhalter ist optional */ }
    return win;
};

// Rendert das Dokument in ein (synchron geöffnetes) Druckfenster und löst den Browser-Druck aus.
// Das Fenster wird vor dem ersten await geöffnet – Aufruf direkt aus dem Klick-Handler genügt.
export const printInvoice = async (inv, { user, portfolios = [], legacyCredit = false, win = null } = {}) => {
    const target = win || openInvoicePrintWindow();
    if (!target) throw new Error(POPUP_BLOCKED_MSG);
    try {
        const ownerId = (portfolios || []).find(p => p.id === inv.portfolio_id)?.user_id || null;
        const writingTemplates = await fetchInvoiceTemplates(user, inv.portfolio_id, { ownerId });
        if (target.closed) return;
        const html = generateInvoiceHtml(inv, { portfolios, writingTemplates, legacyCredit });
        const info = getInvoiceDocumentInfo(inv, { legacyCredit });
        const doc = target.document;
        doc.open();
        doc.write(html);
        doc.close();
        try { doc.title = info.titleBase; } catch { /* Titel ist optional */ }
        await waitForDocument(doc);
        if (target.closed) return;
        applyFlowLayoutIfNeeded(doc);
        target.focus();
        target.print();
    } catch (err) {
        if (target.closed) return;
        try { target.close(); } catch { /* bereits geschlossen */ }
        throw err;
    }
};

// ─── PDF (html2canvas + jsPDF aus dem App-Bundle, siehe lib/htmlToPdf.js) ────────

// Erzeugt und lädt das PDF. Fehler werden an den Aufrufer weitergegeben; das Hilfs-iframe wird immer entfernt.
export const downloadInvoicePdf = async (inv, { user, portfolios = [], legacyCredit = false } = {}) => {
    const ownerId = (portfolios || []).find(p => p.id === inv.portfolio_id)?.user_id || null;
    const [writingTemplates, html2pdf] = await Promise.all([
        fetchInvoiceTemplates(user, inv.portfolio_id, { ownerId }),
        loadHtml2Pdf()
    ]);
    const html = generateInvoiceHtml(inv, { portfolios, writingTemplates, legacyCredit, forPdf: true });
    const info = getInvoiceDocumentInfo(inv, { legacyCredit });

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin'); // kein Skript im Hilfsdokument
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: 'absolute', left: '-10000px', top: '0', width: '210mm', height: '297mm', border: '0' });
    document.body.appendChild(iframe);
    try {
        const doc = iframe.contentDocument;
        if (!doc) throw new Error('Das PDF konnte nicht vorbereitet werden.');
        doc.open();
        doc.write(html);
        doc.close();
        await waitForDocument(doc);
        const flow = applyFlowLayoutIfNeeded(doc);
        const root = doc.querySelector('.ic-invoice-doc') || doc.body;
        await html2pdf().set({
            margin: flow ? [20, 25, 20, 20] : 0,
            filename: `${info.filenameBase}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.letter-footer'] }
        }).from(root).save();
    } finally {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }
};

// ─── Nummernvergabe ──────────────────────────────────────────────────
// Fortlaufende Nummer „JJJJ-NNN" je Portfolio; Jahr aus dem Rechnungsdatum, numerisches Maximum
// (nicht Textsortierung: '2026-1000' > '2026-999'), Abfragefehler werden gemeldet statt '-001'.
// Die DB-Eindeutigkeit (user_id, invoice_number, portfolio_id) fängt Doppelvergaben ab -> neuer Versuch.
export const fetchNextInvoiceNumber = async (portfolioId, invoiceDate) => {
    if (!portfolioId) throw new Error('Bitte zuerst eine Ferienwohnung bzw. ein Portfolio wählen – die Rechnungsnummer wird je Portfolio vergeben.');
    const year = (parseLocalDate(invoiceDate) || new Date()).getFullYear();
    const prefix = `${year}-`;
    const pattern = new RegExp(`^${year}-(\\d+)$`);
    const PAGE = 1000;
    let max = 0;
    for (let from = 0, guard = 0; guard < 100; guard++, from += PAGE) {
        const { data, error } = await supabase
            .from('invoices')
            .select('id, invoice_number')
            .eq('portfolio_id', portfolioId)
            .like('invoice_number', `${prefix}%`)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw error;
        (data || []).forEach(row => {
            const m = pattern.exec(String(row.invoice_number || '').trim());
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        if (!data || data.length < PAGE) break;
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
};

export const isUniqueViolation = (error) => error?.code === '23505';

// Legt eine Rechnung an und vergibt die Nummer erst beim Speichern (mit Wiederholung bei Kollision).
export const insertInvoiceWithNumber = async (payload, { maxAttempts = 5 } = {}) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const invoice_number = await fetchNextInvoiceNumber(payload.portfolio_id, payload.invoice_date);
        const { data, error } = await supabase.from('invoices').insert([{ ...payload, invoice_number }]).select().single();
        if (!error) return data;
        if (!isUniqueViolation(error)) throw error;
    }
    throw new Error('Es konnte keine eindeutige Rechnungsnummer vergeben werden. Bitte versuchen Sie es erneut.');
};

// ─── Statuswechsel ───────────────────────────────────────────────────
// Entwurf -> ausgestellt (festgeschrieben). Nur aus dem Entwurf heraus.
export const issueInvoice = async (invoiceId) => {
    const { data, error } = await supabase
        .from('invoices')
        .update({ status: INVOICE_STATUS.ISSUED })
        .eq('id', invoiceId)
        .eq('status', INVOICE_STATUS.DRAFT)
        .select();
    if (error) throw error;
    if (!data || data.length === 0) {
        throw new Error('Die Rechnung konnte nicht ausgestellt werden – sie ist bereits ausgestellt oder Sie haben keine Berechtigung.');
    }
    return data[0];
};

// Datenbank-Funktion (noch) nicht eingespielt? (PostgREST: PGRST202 / HTTP 404)
const isMissingRpc = (error, status) =>
    !!error && (error.code === 'PGRST202' || error.code === '42883' || status === 404);

// Korrektur einer ausgestellten Rechnung: eigener Gutschrift-Beleg (eigene Nummer aus dem Nummernkreis,
// eigenes Datum, Bezug zur Rechnung, negative Beträge); das Original bleibt unverändert und wird als
// 'credited' (storniert) markiert. Bevorzugt serverseitig in EINER Transaktion (create_credit_note,
// die Datenbank schützt ausgestellte Belege vor Änderung und Löschung); ohne diese Funktion der
// bisherige Weg in der App.
export const createCreditNote = async (original) => {
    if (getInvoiceStatus(original) !== INVOICE_STATUS.ISSUED) {
        throw new Error('Eine Gutschrift kann nur zu einer ausgestellten Rechnung erstellt werden.');
    }
    // Ohne RPC-Unterstützung des Clients (z. B. Abfrage-Stub der Unit-Tests) gilt der bisherige Weg
    if (typeof supabase.rpc !== 'function') return createCreditNoteInApp(original);
    const { data, error, status } = await supabase.rpc('create_credit_note', { p_invoice_id: original.id });
    if (!error) {
        const creditNote = Array.isArray(data) ? data[0] : data;
        if (creditNote?.id) return creditNote;
        throw new Error('Die Gutschrift wurde erstellt, konnte aber nicht geladen werden. Bitte laden Sie die Rechnungsliste neu.');
    }
    if (!isMissingRpc(error, status)) throw error;
    return createCreditNoteInApp(original);
};

// Bisheriger Weg (ohne create_credit_note): Gutschrift anlegen, dann das Original markieren;
// schlägt die Markierung fehl, wird die neue Gutschrift wieder entfernt.
const createCreditNoteInApp = async (original) => {
    const negate = (v) => {
        const x = r2(-num(v));
        return Object.is(x, -0) ? 0 : x;
    };
    const smallBusiness = isInvoiceSmallBusiness(original);
    const ref = {
        refInvoiceId: original.id,
        refInvoiceNumber: original.invoice_number || '',
        refInvoiceDate: original.invoice_date || null
    };
    const positions = (Array.isArray(original.positions) ? original.positions : []).map(p => ({
        ...p,
        vatRate: getPositionVatRate(p, smallBusiness),
        ...(smallBusiness ? { smallBusiness: true } : {}),
        pricePerNight: negate(p.pricePerNight),
        netTotal: negate(p.netTotal),
        vat: negate(p.vat),
        grossTotal: negate(p.grossTotal),
        ...ref
    }));
    const payload = {
        user_id: original.user_id,
        portfolio_id: original.portfolio_id,
        property_id: original.property_id || null,
        unit_id: original.unit_id || null,
        contact_id: original.contact_id || null,
        invoice_date: toLocalDateString(),
        sender_name: original.sender_name,
        sender_street: original.sender_street,
        sender_zip: original.sender_zip,
        sender_city: original.sender_city,
        recipient_name: original.recipient_name,
        recipient_street: original.recipient_street,
        recipient_zip: original.recipient_zip,
        recipient_city: original.recipient_city,
        move_in: original.move_in || null,
        move_out: original.move_out || null,
        persons: original.persons || null,
        nights: original.nights ?? null,
        vat_rate: original.vat_rate ?? null,
        positions,
        net_amount: negate(original.net_amount),
        vat_amount: negate(original.vat_amount),
        gross_amount: negate(original.gross_amount),
        status: INVOICE_STATUS.CREDIT_NOTE
    };
    const creditNote = await insertInvoiceWithNumber(payload);

    const { data: marked, error: markError } = await supabase
        .from('invoices')
        .update({ status: INVOICE_STATUS.CREDITED })
        .eq('id', original.id)
        .eq('status', INVOICE_STATUS.ISSUED)
        .select('id');
    if (markError || !marked || marked.length === 0) {
        await supabase.from('invoices').delete().eq('id', creditNote.id).eq('status', INVOICE_STATUS.CREDIT_NOTE);
        throw markError || new Error('Die Rechnung wurde inzwischen geändert oder bereits storniert. Es wurde keine Gutschrift erstellt.');
    }
    return creditNote;
};
