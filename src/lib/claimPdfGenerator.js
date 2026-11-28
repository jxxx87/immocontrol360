import { supabase } from './supabase';
import QRCode from 'qrcode';
import { openSansFontFaceCss } from './fontFaces';
import { loadHtml2Pdf } from './htmlToPdf';
import { DEFAULT_TEMPLATES, fixLegacyTemplateTypos } from './defaultTemplates';
import { LETTER_PAGE_CSS, scopeLetterCss } from './letterDocumentCss';
import { buildLetterSalutation } from './utilitySettlement';

// ─────────────────────────────────────────────────────────────────────────────
// Gemeinsame Hilfsfunktionen für das Forderungsmanagement (Forderungsliste,
// Forderungsakte und Mahn-PDF). Datumswerte immer als LOKALES Datum
// ('YYYY-MM-DD'), nicht über toISOString (UTC) – sonst kippt das Datum
// zwischen 0 und 2 Uhr auf den Vortag.
// ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');

export const num = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : 0;
};

export const round2 = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100;

// Lokales Datum als 'YYYY-MM-DD'
export const toLocalDateString = (date = new Date()) =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// 'YYYY-MM-DD' -> lokales Datum 00:00 (Zeitstempel werden in lokale Zeit umgerechnet); null bei ungültigem Wert
export const parseLocalDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

export const addDays = (date, days) => {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
};

// Monatsaddition wie PostgreSQL (date + interval '1 month'): Tag wird auf das Monatsende begrenzt
export const addMonthsClamped = (date, months) => {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
};

// Reine Kalendertags-Differenz (b - a), unabhängig von Uhrzeit und Sommerzeit
export const daysBetween = (a, b) => {
    const da = parseLocalDate(a);
    const db = parseLocalDate(b);
    if (!da || !db) return 0;
    const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
    const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
    return Math.round((utcB - utcA) / 86400000);
};

export const formatDateDE = (value) => {
    const d = parseLocalDate(value);
    return d ? d.toLocaleDateString('de-DE') : '';
};

export const formatCurrencyDE = (amount) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(num(amount));

// Ostersonntag (gregorianisch, Gauß/Anonymer Algorithmus)
const easterSunday = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
};

// Bundeseinheitliche gesetzliche Feiertage (landesspezifische Feiertage sind nicht berücksichtigt)
const isNationalHoliday = (date) => {
    const y = date.getFullYear();
    const key = toLocalDateString(date);
    const easter = easterSunday(y);
    const fixed = [`${y}-01-01`, `${y}-05-01`, `${y}-10-03`, `${y}-12-25`, `${y}-12-26`];
    const movable = [-2, 1, 39, 50].map(offset => toLocalDateString(addDays(easter, offset))); // Karfreitag, Ostermontag, Himmelfahrt, Pfingstmontag
    return fixed.includes(key) || movable.includes(key);
};

// § 193 BGB: Fällt der Leistungstag auf einen Samstag, Sonntag oder Feiertag, tritt der nächste Werktag an seine Stelle.
export const shiftToBusinessDay = (value) => {
    let d = parseLocalDate(value);
    if (!d) return null;
    let guard = 0;
    while ((d.getDay() === 0 || d.getDay() === 6 || isNationalHoliday(d)) && guard < 10) {
        d = addDays(d, 1);
        guard++;
    }
    return d;
};

// Verzugstage: Zinslauf ab dem Tag NACH der (ggf. verschobenen) Fälligkeit bis einschließlich Stichtag
export const getDelayDays = (dueDate, referenceDate = new Date()) => {
    const due = shiftToBusinessDay(dueDate);
    if (!due) return 0;
    return Math.max(0, daysBetween(due, referenceDate));
};

// ── Öffentliche Adresse der Web-App (Portal-Links, QR-Codes) ────────────────
// In der nativen App (Capacitor) ist window.location.origin z. B. https://localhost
// und für Mieter nicht erreichbar. Optional per VITE_PUBLIC_APP_URL konfigurierbar.
const PUBLIC_APP_ORIGIN_FALLBACK = 'https://app.immocontrol360.de';

export const getPublicAppOrigin = () => {
    const configured = import.meta.env?.VITE_PUBLIC_APP_URL;
    if (configured && /^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, '');
    const isNative = typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative || typeof window === 'undefined') return PUBLIC_APP_ORIGIN_FALLBACK;
    return window.location.origin;
};

export const buildClaimPortalUrl = (token) => `${getPublicAppOrigin()}/forderung/portal/${encodeURIComponent(token || '')}`;

// Privater Speicher für das Archiv der Mahnschreiben (Pfad: <claim_id>/<datei>.pdf)
export const CLAIM_DOCUMENT_BUCKET = 'claim-documents';

// ── Fehlermeldungen der Forderungs-RPCs verständlich machen ─────────────────
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const translateClaimError = (err, fallback = 'Die Aktion konnte nicht ausgeführt werden.') => {
    const raw = String(err?.message || err?.details || (typeof err === 'string' ? err : '') || '').trim();
    if (!raw) return fallback;
    if (/gehört Owner|RLS verhindert/i.test(raw)) {
        return 'Forderungen können derzeit nur vom Eigentümer des Mietvertrags angelegt werden.';
    }
    if (/invalid input syntax for type (numeric|integer|date)/i.test(raw)) {
        return 'Ein eingegebener Betrag oder ein Datum ist ungültig. Bitte prüfen Sie die Eingaben.';
    }
    if (/row-level security|permission denied|violates row-level/i.test(raw)) {
        return 'Sie haben keine Berechtigung für diese Aktion.';
    }
    if (/failed to fetch|network request failed|networkerror/i.test(raw)) {
        return 'Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.';
    }
    // PL/pgSQL kennt kein '%.2f' – Beträge wie '100.5.2f' lesbar machen
    let msg = raw.replace(/(\d+(?:\.\d+)?)\.2f/g, (m, n) => formatCurrencyDE(Number(n)));
    msg = msg.replace(UUID_RE, '…');
    return msg;
};

// ── HTML-Schutz für das Mahnschreiben ───────────────────────────────────────
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const BLOCKED_TAGS = new Set([
    'SCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'BASE',
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

// Entfernt aktive Inhalte (Skripte, Event-Handler, javascript:-URLs, eingebettete Objekte) aus Vorlagen-HTML.
// Wichtig, weil die PDF-Erzeugung den Inhalt in das Hauptdokument der App klont.
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
                } else if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:/i.test(attr.value)) {
                    child.removeAttribute(attr.name);
                }
            });
            walk(child);
        });
    };
    walk(doc.body);
    return doc.body.innerHTML;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Dokument-CSS des Mahnschreibens (auf .ic-claim-doc begrenzt) ────────────
// Steht im <body>: Die PDF-Erzeugung (lib/htmlToPdf) klont den Inhalt ins App-Dokument, Stile im
// <head> des Hilfs-iframes kämen dort nicht an. Seitengeometrie aus derselben Quelle wie
// Vorlagen-Editor und Druckfenster (lib/letterPage.css); hier nur die PDF-Besonderheiten:
// - kein Seitenschatten/keine Rundung,
// - Blatthöhe 296 mm statt 297 mm: die PDF-Erzeugung rundet das A4-Blatt auf 1122 px ab und würde
//   sonst einen Streifen auf eine Leerseite schneiden. Der untere Innenabstand ist dafür 1 mm
//   kleiner, die Textfläche bleibt damit genau so groß wie im Editor,
// - Umbruch vor jeder Folgeseite (jede Briefseite beginnt oben auf einem PDF-Blatt),
// - Tabellen ohne App-Design (Glas-Hintergrund, Schatten, Rundung).
// Dunkelmodus der App: index.css nimmt .ic-claim-doc und den PDF-Container von seinen Dunkelmodus-Regeln
// (Tabellenköpfe, Überschriften, Linien) aus und setzt dort die Farbvariablen auf die Hellmodus-Werte –
// eigene Gegenregeln sind hier deshalb nicht nötig; das PDF sieht in beiden Modi gleich aus.
const CLAIM_DOC_CSS = `
.ic-claim-doc { width: 210mm; background: #ffffff; color: #000000; text-align: left; }
${scopeLetterCss(LETTER_PAGE_CSS, '.ic-claim-doc')}
.ic-claim-doc .letter-page { height: 296mm !important; min-height: 296mm !important; max-height: 296mm !important; padding-bottom: 34mm !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; page-break-inside: avoid; break-inside: avoid; }
.ic-claim-doc .letter-page ~ .letter-page { page-break-before: always; break-before: page; }
.ic-claim-doc > p:empty { display: none; }
.ic-claim-doc table { background: transparent !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; border: none; }
.ic-claim-doc th, .ic-claim-doc td { color: #000000; background-color: transparent; font-size: inherit; }
`;

const formatCurrency = formatCurrencyDE;
const formatDate = formatDateDE;

// Standardvorlagen der Mahnstufen: gemeinsame Quelle mit dem Vorlagen-Editor (lib/defaultTemplates.js)

// Mahnstufe je Dokumenttyp (für die Forderungsakte)
export const getDunningLevel = (documentType) => {
    if (documentType === 'Zahlungserinnerung') return 1;
    if (documentType === 'Abmahnung' || documentType === 'Mahnung') return 2;
    if (documentType === 'Letzte Zahlungsaufforderung' || documentType === 'dunning_final') return 3;
    return 0;
};

// Prüft die Zahlungsfrist (ganze Tage). Liefert die Zahl oder null.
export const parseDeadlineDays = (value) => {
    const n = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < 1 || n > 365) return null;
    return n;
};

const joinNonEmpty = (parts, sep) => parts.map(p => (p || '').trim()).filter(Boolean).join(sep);

/**
 * Erzeugt das Mahnschreiben als PDF, öffnet es und schreibt einen Historien-Eintrag (append-only).
 *
 * Beträge stammen ausschließlich aus claim_totals_view (gleiche Quelle wie Forderungsakte,
 * Mieterportal und Zahlungsbuchung). Die Signatur bleibt kompatibel; optional:
 * options.targetWindow – vorab (im Klick-Handler) geöffnetes Fenster, damit Popup-Blocker nicht greifen.
 * portalLinkData: { token, pin } nur direkt nach dem Erzeugen des Portal-Links (die Datenbank
 * speichert nur Hashes); ohne beides wird kein QR-Code/keine PIN abgedruckt.
 * Das erzeugte PDF wird im Bucket claim-documents archiviert (scheitert das, nur ein Hinweis).
 *
 * Rückgabe: { fileName, eventMetadata, deadlineDate, warnings, historySaved, historyError, opened, downloaded }
 */
export const generateClaimPdf = async (claim, totals, items, documentType, deadlineDays, internalNote, targetItemId, portalLinkData, options = {}) => {
    if (!claim?.id) throw new Error('Die Forderung ist nicht geladen.');
    const deadlineDaysNum = parseDeadlineDays(deadlineDays);
    if (deadlineDaysNum === null) {
        throw new Error('Bitte eine gültige Zahlungsfrist angeben (ganze Zahl von 1 bis 365 Tagen).');
    }
    const docType = String(documentType || 'Zahlungserinnerung');
    const warnings = [];
    const itemList = Array.isArray(items) ? items : [];

    // 1. Absender: Profil des Eigentümers (nur für ihn selbst lesbar), sonst Portfolio-Daten
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('first_name, last_name, company, email, phone, bank_name, iban, bic, bank_account_holder')
        .eq('id', claim.user_id)
        .maybeSingle();
    if (profileError) console.warn('Absenderprofil nicht lesbar:', profileError);

    const prop = claim.leases?.units?.properties || {};
    const portfolioId = prop.portfolio_id;
    let portfolio = null;
    if (portfolioId) {
        const { data: pData, error: pError } = await supabase
            .from('portfolios')
            .select('company_name, email, phone, bank_name, iban, bic')
            .eq('id', portfolioId)
            .maybeSingle();
        if (pError) console.warn('Portfolio-Daten nicht lesbar:', pError);
        portfolio = pData || null;
    }

    const profileName = joinNonEmpty([profile?.first_name, profile?.last_name], ' ');
    const senderName = (profile?.company || '').trim() || profileName || (portfolio?.company_name || '').trim();
    if (!senderName) {
        throw new Error('Absenderangaben fehlen: Bitte hinterlegen Sie Name bzw. Firma im Profil des Eigentümers oder den Firmennamen im Portfolio, bevor ein Mahnschreiben erzeugt wird.');
    }
    const senderContact = joinNonEmpty([
        (portfolio?.email || profile?.email) ? `E-Mail: ${portfolio?.email || profile?.email}` : '',
        (portfolio?.phone || profile?.phone) ? `Tel.: ${portfolio?.phone || profile?.phone}` : ''
    ], '\n');

    // 2. Empfänger: eigene Anschrift des Mieters, sonst (mit Hinweis) die Objektadresse
    const tenant = claim.tenants || {};
    const tenantName = joinNonEmpty([tenant.first_name, tenant.last_name], ' ');
    const tenantStreetLine = joinNonEmpty([tenant.street, tenant.house_number], ' ');
    const tenantCityLine = joinNonEmpty([tenant.postal_code, tenant.city], ' ');
    const propStreetLine = joinNonEmpty([prop.street, prop.house_number], ' ');
    const propCityLine = joinNonEmpty([prop.zip, prop.city], ' ');
    let recipientLines;
    let recipientSource;
    if (tenantStreetLine && tenantCityLine) {
        recipientLines = [tenantStreetLine, tenantCityLine];
        recipientSource = 'tenant';
    } else if (propStreetLine || propCityLine) {
        recipientLines = [propStreetLine, propCityLine].filter(Boolean);
        recipientSource = 'property';
        warnings.push('Für den Mieter ist keine eigene Anschrift hinterlegt – im Schreiben wurde die Objektadresse verwendet. Bei ausgezogenen Mietern bitte die aktuelle Anschrift im Mieterstamm ergänzen.');
    } else {
        throw new Error('Keine Empfängeranschrift vorhanden: Bitte die Anschrift des Mieters im Mieterstamm hinterlegen.');
    }
    if (!tenantName) warnings.push('Für den Mieter ist kein Name hinterlegt.');

    // Anrede für die Briefanrede (tenants.salutation); fehlt sie in den übergebenen Mieterdaten, nachladen
    let tenantSalutation = tenant.salutation;
    if (tenantSalutation === undefined && claim.tenant_id) {
        const { data: salutationRow, error: salutationError } = await supabase
            .from('tenants')
            .select('salutation')
            .eq('id', claim.tenant_id)
            .maybeSingle();
        if (salutationError) console.warn('Anrede des Mieters nicht lesbar – neutrale Briefanrede:', salutationError);
        tenantSalutation = salutationRow?.salutation ?? null;
    }

    // 3. Vorlage bestimmen
    let templateType = 'payment_reminder';
    if (docType === 'Mahnung') templateType = 'dunning_1';
    else if (docType === 'Abmahnung') templateType = 'dunning_2';
    else if (docType === 'Letzte Zahlungsaufforderung' || docType === 'dunning_final') templateType = 'dunning_final';
    else if (docType !== 'Zahlungserinnerung') {
        const lower = docType.toLowerCase();
        if (lower.includes('erinnerung')) templateType = 'payment_reminder';
        else if (lower.includes('abmahnung')) templateType = 'dunning_2';
        else if (lower.includes('letzte')) templateType = 'dunning_final';
        else templateType = 'dunning_1';
    }

    let template = DEFAULT_TEMPLATES[templateType];
    try {
        let query = supabase
            .from('document_templates')
            .select('*')
            .eq('type', templateType);

        if (portfolioId) {
            query = query.eq('portfolio_id', portfolioId);
        } else {
            query = query.eq('user_id', claim.user_id).is('portfolio_id', null);
        }

        const { data, error } = await query.maybeSingle();
        if (!error && data) {
            template = data;
        } else if (portfolioId) {
            const { data: globalData } = await supabase
                .from('document_templates')
                .select('*')
                .eq('user_id', claim.user_id)
                .eq('type', templateType)
                .is('portfolio_id', null)
                .maybeSingle();
            if (globalData) template = globalData;
        }
    } catch (e) {
        console.error('Error fetching template for dunning PDF:', e);
    }

    const docDate = new Date();
    const todayStr = toLocalDateString(docDate);
    const dateStr = docDate.toLocaleDateString('de-DE');
    const deadlineDate = addDays(docDate, deadlineDaysNum);
    const deadlineDateStr = toLocalDateString(deadlineDate);

    // 4. Beträge: eine Quelle (claim_totals_view), frisch geladen; Fallback = übergebene Summen
    let viewTotals = totals || null;
    const { data: freshTotals, error: totalsError } = await supabase
        .from('claim_totals_view')
        .select('*')
        .eq('claim_id', claim.id)
        .maybeSingle();
    if (!totalsError && freshTotals) viewTotals = freshTotals;
    else if (totalsError) console.warn('claim_totals_view nicht ladbar, verwende geladene Summen:', totalsError);
    if (!viewTotals) {
        throw new Error('Die Forderungssummen konnten nicht geladen werden. Bitte laden Sie die Seite neu.');
    }

    const interestRate = num(claim.interest_rate ?? 0);
    const claimPrincipalOpen = round2(viewTotals.current_principal_open);
    const claimFeesOpen = round2(viewTotals.total_fees_open);
    const claimInterestOpen = round2(viewTotals.total_interest_open);
    const claimTotalDue = round2(viewTotals.total_due);
    const accumulatedInterest = round2(viewTotals.accumulated_unpaid_interest);
    const liveInterest = round2(viewTotals.live_interest_since_start);
    const interestPaid = round2(viewTotals.interest_paid);
    const interestStart = claim.interest_start_date || null;
    const liveDays = interestStart ? Math.max(0, daysBetween(interestStart, docDate)) : 0;

    let activeItems = itemList;
    let isSingleItem = false;
    let interestShare = 1;
    let activeTotals = {
        current_principal_open: claimPrincipalOpen,
        total_interest_open: claimInterestOpen,
        total_fees_open: claimFeesOpen,
        total_due: claimTotalDue
    };

    if (targetItemId) {
        const item = itemList.find(i => i.claim_item_id === targetItemId);
        if (!item) throw new Error('Die gewählte Forderungsposition wurde nicht gefunden. Bitte die Seite neu laden.');
        activeItems = [item];
        isSingleItem = true;
        const itemOpen = round2(item.open_amount);
        interestShare = claimPrincipalOpen > 0 ? Math.min(1, itemOpen / claimPrincipalOpen) : 0;
        const itemInterest = round2(claimInterestOpen * interestShare);
        const itemFee = round2(Math.min(num(item.claim_items?.fee_amount), claimFeesOpen));
        activeTotals = {
            current_principal_open: itemOpen,
            total_interest_open: itemInterest,
            total_fees_open: itemFee,
            total_due: round2(itemOpen + itemInterest + itemFee)
        };
    }

    if (activeTotals.total_due <= 0) {
        throw new Error('Für diese Auswahl ist kein Betrag offen – es wird kein Mahnschreiben erzeugt.');
    }

    // Verzugstage: älteste offene Position ab dem Tag nach Fälligkeit
    const openDueDates = activeItems
        .filter(i => num(i.open_amount) > 0)
        .map(i => i.claim_items?.due_date || i.claim_items?.period_month)
        .filter(Boolean)
        .map(d => parseLocalDate(d))
        .filter(Boolean)
        .sort((a, b) => a - b);
    const verzugstage = openDueDates.length > 0 ? getDelayDays(openDueDates[0], docDate) : liveDays;

    // 5. Bankverbindung: konsistent aus EINER Quelle (Portfolio vor Profil)
    let bank = null;
    if ((portfolio?.iban || '').trim()) {
        bank = { name: portfolio.bank_name, iban: portfolio.iban, bic: portfolio.bic, holder: (portfolio.company_name || '').trim() || senderName };
    } else if ((profile?.iban || '').trim()) {
        bank = { name: profile.bank_name, iban: profile.iban, bic: profile.bic, holder: (profile.bank_account_holder || '').trim() || senderName };
    }
    // Gleicher Verwendungszweck wie in Forderungsakte und Mieterportal
    const paymentReference = `Mahnung-${String(claim.id).substring(0, 8).toUpperCase()}`;
    const bankDetailsStr = bank
        ? `Inhaber: ${bank.holder}, ${bank.name ? 'Bank: ' + bank.name + ', ' : ''}IBAN: ${bank.iban}${bank.bic ? ', BIC: ' + bank.bic : ''}, Verwendungszweck: ${paymentReference}`
        : 'das Ihnen bekannte Bankkonto';
    if (!bank) warnings.push('Es ist keine Bankverbindung (IBAN) im Portfolio oder Profil hinterlegt – im Schreiben steht „das Ihnen bekannte Bankkonto“.');

    const leaseStart = claim.leases?.start_date ? formatDate(claim.leases.start_date) : 'Mietbeginn';

    // 6. Tabellen (alle Werte escaped)
    const singleItemLabel = isSingleItem
        ? escapeHtml(activeItems[0].claim_items?.description || activeItems[0].claim_items?.item_type || 'Hauptforderung')
        : 'Offene Hauptforderungen (Miete/Nebenkosten etc.)';

    const summaryTableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
        <thead>
            <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                <th style="padding: 6px; text-align: left;">Forderungsposition</th>
                <th style="padding: 6px; text-align: right; width: 30%;">Betrag</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">${singleItemLabel}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${formatCurrency(activeTotals.current_principal_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Verzugszinsen bis einschließlich ${dateStr}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${formatCurrency(activeTotals.total_interest_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Mahnkosten / Auslagen</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${formatCurrency(activeTotals.total_fees_open)}</td>
            </tr>
            <tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                <td style="padding: 8px; font-weight: bold; font-size: 11pt;">Gesamtforderung zum ${dateStr}:</td>
                <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: #dc2626;">${formatCurrency(activeTotals.total_due)}</td>
            </tr>
        </tbody>
    </table>`;

    // Zinsberechnung aus denselben Werten wie claim_totals_view
    const rateStr = interestRate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const interestRows = [];
    if (accumulatedInterest !== 0) {
        interestRows.push([
            interestStart ? `Bis zum Zinsstichtag ${formatDate(interestStart)} bereits berechnete Verzugszinsen` : 'Bereits berechnete Verzugszinsen',
            '',
            interestStart ? `bis ${formatDate(interestStart)}` : '',
            '',
            formatCurrency(accumulatedInterest)
        ]);
    }
    if (interestStart) {
        interestRows.push([
            `Laufende Zinsen auf die offene Hauptforderung (${rateStr} % p.a.)`,
            formatCurrency(claimPrincipalOpen),
            `${formatDate(interestStart)} – ${dateStr}`,
            String(liveDays),
            formatCurrency(liveInterest)
        ]);
    }
    // Nur den Betrag abziehen, den claim_totals_view tatsächlich abzieht (heutige Sicht: interest_paid;
    // nach der Umstellung auf netto geführte accumulated_unpaid_interest: nichts) – so ergeben die Zeilen die Summe.
    const interestDeducted = round2(accumulatedInterest + liveInterest - claimInterestOpen);
    if (interestPaid > 0 && interestDeducted > 0.004) {
        interestRows.push(['Abzüglich bereits gezahlter Zinsen', '', '', '', formatCurrency(-interestDeducted)]);
    }
    if (interestRows.length === 0) {
        interestRows.push(['Keine Verzugszinsen berechnet', '', '', '', formatCurrency(0)]);
    }
    const interestSumRows = [`
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td colspan="4" style="padding: 6px;">Summe offener Verzugszinsen${isSingleItem ? ' der gesamten Forderung' : ''}:</td>
                    <td style="padding: 6px; text-align: right;">${formatCurrency(claimInterestOpen)}</td>
                </tr>`];
    if (isSingleItem) {
        const sharePct = (interestShare * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 });
        interestSumRows.push(`
                <tr style="font-weight: bold;">
                    <td colspan="4" style="padding: 6px;">Davon auf diese Position entfallend (anteilig nach offener Hauptforderung, ${sharePct} %):</td>
                    <td style="padding: 6px; text-align: right;">${formatCurrency(activeTotals.total_interest_open)}</td>
                </tr>`);
    }

    const detailTableHtml = `
    <div>
        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 10px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 1: Forderungsaufstellung</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 20px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left;">Position</th>
                    <th style="padding: 5px; text-align: right; width: 22%;">Forderungsbetrag</th>
                    <th style="padding: 5px; text-align: right; width: 22%;">Zahlung / Anrechnung</th>
                    <th style="padding: 5px; text-align: right; width: 22%; font-weight: bold;">Offener Betrag</th>
                </tr>
            </thead>
            <tbody>
                ${activeItems.map(item => {
                    // paid_principal enthält auch Erlasse/Ausbuchungen (kein Geldeingang) – getrennt ausweisen
                    const waived = round2(item.waived_amount ?? item.waived_principal);
                    const paidOnly = round2(num(item.paid_principal) - waived);
                    return `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${escapeHtml(item.claim_items?.description || item.claim_items?.item_type || 'Forderung')}</td>
                        <td style="padding: 5px; text-align: right;">${formatCurrency(item.original_amount)}</td>
                        <td style="padding: 5px; text-align: right;">${formatCurrency(paidOnly)}${waived > 0 ? `<div style="font-size: 8pt; color: #475569;">Erlass: ${formatCurrency(waived)}</div>` : ''}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${formatCurrency(item.open_amount)}</td>
                    </tr>
                `;
                }).join('')}
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td style="padding: 6px;">Summe offener Hauptforderungen:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${formatCurrency(activeTotals.current_principal_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Mahnkosten / Auslagen (offen)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${formatCurrency(activeTotals.total_fees_open)}</td>
                </tr>
                <tr>
                    <td style="padding: 5px;">Verzugszinsen (offen, siehe Anlage 2)</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 5px; text-align: right;">${formatCurrency(activeTotals.total_interest_open)}</td>
                </tr>
                <tr style="border-top: 1px solid #000; font-weight: bold;">
                    <td style="padding: 6px;">Gesamtforderung zum ${dateStr}:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${formatCurrency(activeTotals.total_due)}</td>
                </tr>
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 2: Zinsberechnung</h3>
        <p style="font-size: 8.5pt; color: #475569; margin-bottom: 8px;">
            Nach § 288 Abs. 1 BGB können Verzugszinsen in Höhe von fünf Prozentpunkten über dem jeweiligen Basiszinssatz verlangt werden.
            Der Berechnung liegt ein Zinssatz von ${rateStr} % p.a. zugrunde. Zinstage werden ab dem Tag nach dem Zinsstichtag gezählt.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 20px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left;">Position</th>
                    <th style="padding: 5px; text-align: right; width: 20%;">Verzinslicher Betrag</th>
                    <th style="padding: 5px; text-align: left; width: 25%;">Zeitraum</th>
                    <th style="padding: 5px; text-align: right; width: 12%;">Tage</th>
                    <th style="padding: 5px; text-align: right; width: 18%; font-weight: bold;">Zinsen</th>
                </tr>
            </thead>
            <tbody>
                ${interestRows.map(row => `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${row[0]}</td>
                        <td style="padding: 5px; text-align: right;">${row[1]}</td>
                        <td style="padding: 5px; text-align: left;">${row[2]}</td>
                        <td style="padding: 5px; text-align: right;">${row[3]}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${row[4]}</td>
                    </tr>
                `).join('')}
                ${interestSumRows.join('')}
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 3: Ablauf bei Mietrückstand und mögliche Folgekosten</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 10px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left; width: 25%;">Schritt</th>
                    <th style="padding: 5px; text-align: left;">Erläuterung</th>
                    <th style="padding: 5px; text-align: left; width: 30%;">Mögliche Folgekosten</th>
                </tr>
            </thead>
            <tbody>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">1. Mietzahlung fällig</td>
                    <td style="padding: 4px;">Die Miete ist bis spätestens zum dritten Werktag des Monats zu zahlen.</td>
                    <td style="padding: 4px;">Keine Zusatzkosten bei fristgerechter Zahlung</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">2. Rückstand festgestellt</td>
                    <td style="padding: 4px;">Offene Miete wird ermittelt und tagesgenaue Verzugszinsen laufen an.</td>
                    <td style="padding: 4px;">Verzugszinsen nach § 288 BGB</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">3. Mahnung / Abmahnung</td>
                    <td style="padding: 4px;">Zahlungsfrist wird gesetzt. Die Forderung wird schriftlich beziffert.</td>
                    <td style="padding: 4px;">Auslagen für Porto/Druck</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">4. Keine fristgerechte Zahlung</td>
                    <td style="padding: 4px;">Weitere Beitreibung kann eingeleitet werden: Anwalt, Mahnbescheid oder Klage.</td>
                    <td style="padding: 4px;">Rechtsverfolgungs- und Gerichtskosten möglich</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">5. Kündigungsprüfung</td>
                    <td style="padding: 4px;">Bei erheblichem Mietrückstand kann eine fristlose, hilfsweise ordentliche Kündigung geprüft werden.</td>
                    <td style="padding: 4px;">Weitere Kostenrisiken für den Mieter</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">6. Gerichtliche Durchsetzung</td>
                    <td style="padding: 4px;">Bei weiterem Ausbleiben kann die Forderung tituliert und vollstreckt werden; bei Kündigung ggf. Räumungsklage.</td>
                    <td style="padding: 4px;">Gerichts-, Anwalts- und Vollstreckungskosten möglich</td>
                </tr>
            </tbody>
        </table>
        <div style="font-size: 8.5pt; font-weight: bold; color: #1e293b; margin-top: 8px; line-height: 1.4;">
            Wichtig: Durch vollständige und fristgerechte Zahlung können weitere Kosten und rechtliche Schritte vermieden werden.
            Die tatsächlichen Kosten hängen vom weiteren Verlauf und den gesetzlichen Gebühren ab.
        </div>
    </div>`;

    // 7. QR-Code / Portal-Hinweis
    let qrBlockHtml = '';
    if (portalLinkData && portalLinkData.token && portalLinkData.pin) {
        const portalUrl = buildClaimPortalUrl(portalLinkData.token);
        try {
            const qrDataUrl = await QRCode.toDataURL(portalUrl, { margin: 1, width: 120 });
            qrBlockHtml = `
            <div style="margin-top: 15px; margin-bottom: 15px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; font-size: 9.5pt; page-break-inside: avoid;">
                <div style="margin-bottom: 6px;">
                    <img src="${qrDataUrl}" style="width: 80px; height: 80px; display: inline-block;" alt="QR Code" />
                </div>
                <div style="font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 10pt;">Online Forderungsportal</div>
                <div style="color: #475569; line-height: 1.4; max-width: 480px; margin: 0 auto 6px; font-size: 8.5pt;">
                    Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                </div>
                <div style="font-weight: bold; color: #1e293b; font-size: 10pt;">
                    Zugangscode (PIN): <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${escapeHtml(portalLinkData.pin)}</span>
                </div>
            </div>`;
        } catch (qrErr) {
            console.error('Failed to generate QR code for HTML print', qrErr);
            warnings.push('Der QR-Code für das Forderungsportal konnte nicht erzeugt werden.');
        }
    }

    // 8. Variablen (alle Texte escaped; Tabellen sind eigenes, geprüftes HTML)
    // Gleiche Regel wie Vorlagen-Editor und Nebenkostenabrechnung (Frau/Herr + Nachname, sonst neutral)
    const mieterAnrede = buildLetterSalutation({ fullName: tenantName, lastName: tenant.last_name, salutation: tenantSalutation });
    const localVars = {
        mieter_name: escapeHtml(tenantName),
        mieter_anrede: escapeHtml(mieterAnrede),
        mieter_adresse: recipientLines.map(escapeHtml).join('<br>'),
        objekt_name: escapeHtml(propStreetLine || 'Immobilie'),
        einheit_name: escapeHtml(claim.leases?.units?.unit_name || 'Einheit'),
        objekt_adresse: escapeHtml(joinNonEmpty([propStreetLine, propCityLine], ', ')),
        offener_betrag: formatCurrency(activeTotals.total_due),
        zahlungsfrist_datum: deadlineDate.toLocaleDateString('de-DE'),
        verzugstage: String(verzugstage),
        mahnstufe: escapeHtml(docType),
        zinsbetrag: formatCurrency(activeTotals.total_interest_open),
        nutzungszeitraum: escapeHtml(leaseStart),
        vermieter_name: escapeHtml(senderName),
        vermieter_kontakt: senderContact.split('\n').map(escapeHtml).join('<br>'),
        vermieter_bankverbindung: escapeHtml(bankDetailsStr),
        rechnungsdatum: dateStr,
        forderungs_tabelle: summaryTableHtml + qrBlockHtml,
        forderungs_detail_tabelle: detailTableHtml
    };

    const replaceHTMLVariables = (htmlStr, vars) => {
        if (!htmlStr) return '';
        let result = htmlStr;
        for (const [key, value] of Object.entries(vars)) {
            const regex = new RegExp(`(<span[^>]*data-id="${key}"[^>]*>.*?</span>|\\{${key}\\})`, 'g');
            // Ersetzung per Funktion, damit '$' in Werten nicht als Ersetzungsmuster gilt
            result = result.replace(regex, () => value);
        }
        return result;
    };

    // Vorlage bereinigen; doppelte Anrede vermeiden ('Sehr geehrte/r ' + Variable, die bereits die Anrede enthält)
    const rawTemplateHtml = fixLegacyTemplateTypos(template?.content_html || DEFAULT_TEMPLATES[templateType].content_html);
    const fullTemplateHtml = sanitizeTemplateHtml(rawTemplateHtml)
        .replace(/Sehr geehrte(?:\/r|\(r\)|r)?(?:\s|&nbsp;)*(?=<span[^>]*data-id="mieter_anrede")/gi, '')
        .replace(/Sehr geehrte(?:\/r|\(r\)|r)?(?:\s|&nbsp;)*(?=\{mieter_anrede\})/gi, '');
    const renderedContent = replaceHTMLVariables(fullTemplateHtml, localVars);

    // Druckdokument: Seiten-CSS aus derselben Quelle wie Editor und Druckfenster (CLAIM_DOC_CSS, im <body>)
    const finalHtml = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${escapeHtml(docType)} - ${escapeHtml(tenantName)}</title>
    <style>${openSansFontFaceCss()} @page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #ffffff; }</style>
    </head><body style="background:#fff"><div class="ic-claim-doc"><style>${CLAIM_DOC_CSS}</style>${renderedContent}</div></body></html>`;

    // 9. Dateiname (lokales Datum)
    const cleanTenantName = (tenantName || 'Mieter').replace(/[^a-z0-9äöüß]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Mieter';
    const cleanDocType = docType.replace(/[^a-z0-9äöüß]/gi, '_').replace(/_+/g, '_');
    const fileName = `${cleanDocType}_Zahlungsverzug_${cleanTenantName}_${todayStr}.pdf`;

    // 10. PDF rendern (verstecktes iframe + lib/htmlToPdf); iframe wird in jedem Fall entfernt
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    let pdfArrayBuffer;
    try {
        document.body.appendChild(iframe);
        const frameDoc = iframe.contentDocument;
        frameDoc.open();
        frameDoc.write(finalHtml);
        frameDoc.close();

        const html2pdf = await loadHtml2Pdf();

        // Auf die Briefschrift warten (max. 3 s): gerendert wird im App-Dokument, dort die Schnitte gezielt laden
        try {
            if (document.fonts && document.fonts.ready) {
                const fontLoads = typeof document.fonts.load === 'function'
                    ? Promise.all(['400 11pt "Open Sans"', '600 11pt "Open Sans"', '700 11pt "Open Sans"'].map(f => document.fonts.load(f)))
                        .then(() => document.fonts.ready)
                    : document.fonts.ready;
                await Promise.race([fontLoads, sleep(3000)]);
            }
        } catch {
            // Schriftstatus nicht ermittelbar – weiter mit fester Wartezeit
        }
        await sleep(600);

        // Rand 0: Die Briefseiten sind bereits A4 (wie im Editor); jede Seite beginnt auf einem eigenen Blatt
        pdfArrayBuffer = await html2pdf().set({
            margin: 0,
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css'] }
        }).from(frameDoc.querySelector('.ic-claim-doc') || frameDoc.body).output('arraybuffer');
    } finally {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }

    if (!pdfArrayBuffer || !pdfArrayBuffer.byteLength) {
        throw new Error('Das PDF konnte nicht erzeugt werden.');
    }

    // SHA-256 des erzeugten PDFs (bezieht sich auf genau diese Datei)
    let document_sha256 = null;
    try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', pdfArrayBuffer);
        document_sha256 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (hashErr) {
        console.warn('SHA-256 nicht berechenbar:', hashErr);
    }

    // 10b. Archiv: genau diese Datei unveränderlich ablegen (kein Überschreiben, eindeutiger Name)
    const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
    let documentStoragePath = null;
    try {
        const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
        const archivePath = `${claim.id}/${todayStr}_${Date.now()}_${safeFileName}`;
        const { error: uploadError } = await supabase.storage
            .from(CLAIM_DOCUMENT_BUCKET)
            .upload(archivePath, pdfBlob, { contentType: 'application/pdf', upsert: false });
        if (uploadError) throw uploadError;
        documentStoragePath = archivePath;
    } catch (archiveErr) {
        console.warn('PDF konnte nicht archiviert werden:', archiveErr);
        warnings.push('Das PDF konnte nicht in der App archiviert werden. Bitte legen Sie es selbst ab.');
    }

    // 11. Historien-Eintrag (append-only: jede Erzeugung bleibt nachvollziehbar)
    const eventMetadata = {
        document_type: docType,
        document_date: todayStr,
        snapshot_date: docDate.toISOString(),
        amount_source: 'claim_totals_view',
        principal_snapshot: activeTotals.current_principal_open,
        fees_snapshot: activeTotals.total_fees_open,
        interest_snapshot: activeTotals.total_interest_open,
        total_snapshot: activeTotals.total_due,
        total_due_at_generation: activeTotals.total_due,
        interest_rate: interestRate,
        deadline: deadlineDateStr,
        deadline_date: deadlineDateStr,
        deadline_days: deadlineDaysNum,
        document_file_name: fileName,
        document_stored: !!documentStoragePath,
        document_sha256,
        template_type: templateType,
        template_id: template?.id || null,
        template_updated_at: template?.updated_at || null,
        recipient_address_source: recipientSource,
        target_item_id: targetItemId || null
    };
    if (documentStoragePath) {
        eventMetadata.document_bucket = CLAIM_DOCUMENT_BUCKET;
        eventMetadata.document_storage_path = documentStoragePath;
    }
    if (portalLinkData?.token && portalLinkData?.pin) eventMetadata.portal_access_printed = true;
    if (internalNote) eventMetadata.note = String(internalNote);

    const { error: eventError } = await supabase.from('claim_events').insert([{
        user_id: claim.user_id,
        claim_id: claim.id,
        event_type: 'dunning_sent',
        description: `${docType} erstellt`,
        event_metadata: eventMetadata
    }]);
    if (eventError) console.error('Error saving claim_event:', eventError);

    // 12. PDF anzeigen: vorab geöffnetes Fenster > neues Fenster > Download
    const pdfUrl = URL.createObjectURL(pdfBlob);
    let opened = false;
    let downloaded = false;
    const targetWindow = options?.targetWindow;
    if (targetWindow && !targetWindow.closed) {
        try {
            targetWindow.location.href = pdfUrl;
            opened = true;
        } catch (navErr) {
            console.warn('Vorab geöffnetes Fenster nicht nutzbar:', navErr);
        }
    }
    if (!opened) {
        const win = window.open(pdfUrl, '_blank');
        opened = !!win;
    }
    if (!opened) {
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.download = fileName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        downloaded = true;
    }
    // Blob-URL nach einiger Zeit freigeben (Viewer hat die Datei dann geladen)
    setTimeout(() => URL.revokeObjectURL(pdfUrl), 5 * 60 * 1000);

    return {
        fileName,
        eventMetadata,
        deadlineDate: deadlineDateStr,
        warnings,
        historySaved: !eventError,
        historyError: eventError ? translateClaimError(eventError) : null,
        opened,
        downloaded
    };
};
