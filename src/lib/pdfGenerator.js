// ─── Client-Side PDF Generator ─────────────────────────────────────
// Opens a print-ready HTML document in a new tab.
// Renders header/footer using positioned template elements from Supabase.
//
// Sicherheit: Das Druckfenster (about:blank) erbt die Origin der App. Darum
// werden ALLE eingesetzten Werte maskiert (escapeHtml), Farben/Ausrichtung/
// Zahlen per Whitelist geprüft, Logo-URLs nur vom eigenen Storage zugelassen
// und das Dokument zusätzlich mit einer Content-Security-Policy ohne Skripte
// ausgeliefert. Die Logik (Druckknopf, Seitenaufteilung) läuft ausschließlich
// aus dem App-Fenster heraus.

import { REPORT_CONFIGS, formatValue, generateFilename } from './reportConfigs';
import {
    MM_TO_PX, HEADER_H, FOOTER_H, DEFAULT_MARGIN, DEFAULT_ACCENT, PDF_FONT_STACK,
    getTemplateOrientation, fitElementsToOrientation,
} from '../pages/pdf-template/constants';

// ─── Escaping & Whitelists ───────────────────────────────────────────
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Maskiert einen beliebigen Wert für die Ausgabe in HTML-Text oder -Attributen. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);

/** Liefert '#rrggbb' für gültige Hex-Farben (#rgb / #rrggbb), sonst null. */
export const normalizeHexColor = (value) => {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split('').map(c => c + c).join('')}`.toLowerCase();
    return null;
};

const LOGO_PUBLIC_PATH = '/storage/v1/object/public/pdf-assets/';

const getStorageOrigin = () => {
    try {
        const raw = import.meta.env?.VITE_SUPABASE_URL;
        return raw ? new URL(raw).origin : null;
    } catch {
        return null;
    }
};

/**
 * Lässt nur Logo-URLs aus dem eigenen Supabase-Storage (Bucket pdf-assets) zu.
 * Ist die Supabase-URL unbekannt, werden nur https-URLs akzeptiert.
 */
export const sanitizeLogoUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    const origin = getStorageOrigin();
    if (origin) {
        if (url.origin !== origin || !url.pathname.startsWith(LOGO_PUBLIC_PATH)) return null;
        return url.href;
    }
    return url.protocol === 'https:' ? url.href : null;
};

const toFinite = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};
const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));
const safeAlign = (value, fallback = 'left') => (['left', 'center', 'right', 'justify'].includes(value) ? value : fallback);
const safeWeight = (value, fallback = 'normal') => {
    const v = String(value ?? '');
    return ['normal', 'bold', '400', '500', '600', '700'].includes(v) ? v : fallback;
};

// ─── Spaltenbreiten (eine Quelle für Orientierung und Tabellenlayout) ─
const getEstWidth = (col) => {
    let w = Math.max(String(col.label || '').length * 7 + 24, 60);
    if (col.format === 'currency') w = Math.max(w, 85);
    else if (col.format === 'area') w = Math.max(w, 75);
    else if (col.format === 'percent') w = Math.max(w, 65);
    else if (col.format === 'decimal') w = Math.max(w, 65);
    else if (col.format === 'date') w = Math.max(w, 75);
    else if (['adresse', 'objekt', 'immobilie', 'immobilie_einheit'].includes(col.key)) w = Math.max(w, 130);
    else if (['verwendungszweck', 'empfaenger', 'notizen', 'positionen'].includes(col.key)) w = Math.max(w, 150);
    else if (['mietername', 'mieter', 'projekt', 'dealname'].includes(col.key)) w = Math.max(w, 110);
    return w;
};

// ─── Summen ──────────────────────────────────────────────────────────
// Erkennt Zahlen und deutsch formatierte Beträge ("1.234,56 €"). Nicht
// auswertbare Werte werden NICHT still als 0 gezählt.
const parseNumeric = (value) => {
    if (value === null || value === undefined || value === '') return { empty: true };
    if (typeof value === 'number') return Number.isFinite(value) ? { value } : { invalid: true };
    if (typeof value !== 'string') return { invalid: true };
    const str = value.trim();
    if (str === '' || str === '–' || str === '-') return { empty: true };
    const direct = Number(str);
    if (Number.isFinite(direct)) return { value: direct };
    const cleaned = str.replace(/[€\s]/g, ''); // \s umfasst auch geschützte Leerzeichen
    if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned) || /^-?\d+(,\d+)?$/.test(cleaned)) {
        return { value: Number(cleaned.replace(/\./g, '').replace(',', '.')) };
    }
    return { invalid: true };
};

const computeSums = (rows, columns, sumColumns) => {
    const sums = {};
    (sumColumns || []).forEach(key => {
        if (!columns.some(c => c.key === key)) return;
        let total = 0;
        let invalid = 0;
        rows.forEach(row => {
            const parsed = parseNumeric(row[key]);
            if (parsed.invalid) invalid += 1;
            else if (!parsed.empty) total += parsed.value;
        });
        sums[key] = { total, invalid };
    });
    return sums;
};

// ─── DSGVO ───────────────────────────────────────────────────────────
// Namen werden durch laufende Pseudonyme ersetzt (gleicher Name → gleiches
// Pseudonym), alle übrigen DSGVO-Felder vollständig maskiert.
const PSEUDONYM_PREFIX = { mietername: 'Mieter', mieter: 'Mieter' };

const anonymizeRows = (rows, fields) => {
    const pseudonyms = new Map();
    const counters = {};
    return rows.map(row => {
        const newRow = { ...row };
        (fields || []).forEach(field => {
            const val = newRow[field];
            if (val === null || val === undefined || val === '') return;
            const prefix = PSEUDONYM_PREFIX[field];
            if (!prefix) {
                newRow[field] = '***';
                return;
            }
            const key = `${prefix}\u0000${String(val).trim().toLowerCase()}`;
            if (!pseudonyms.has(key)) {
                counters[prefix] = (counters[prefix] || 0) + 1;
                pseudonyms.set(key, `${prefix} ${counters[prefix]}`);
            }
            newRow[field] = pseudonyms.get(key);
        });
        return newRow;
    });
};

/**
 * Render a single template element to HTML
 */
function renderTemplateElement(el, { title, subtitle, portfolioName, propertyName, logoUrl, dateStr }, yOffset = 0) {
    if (!el || !el.visible) return '';
    const left = toFinite(el.x, 0) * MM_TO_PX;
    const top = (toFinite(el.y, 0) - yOffset) * MM_TO_PX;
    const width = toFinite(el.w, 10) * MM_TO_PX;
    const height = (toFinite(el.h, 0) || 5) * MM_TO_PX;
    const zIndex = Math.round(clampNum(toFinite(el.zIndex, 1) || 1, 1, 999));
    const base = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-family:${PDF_FONT_STACK};overflow:hidden;z-index:${zIndex};`;
    const text = (defaults) => {
        const fontSize = clampNum(toFinite(el.fontSize, defaults.fontSize), 4, 72);
        const fontWeight = safeWeight(el.fontWeight, defaults.fontWeight);
        const color = normalizeHexColor(el.color) || defaults.color;
        const align = safeAlign(el.align, defaults.align);
        return `${base}font-size:${fontSize}pt;font-weight:${fontWeight};color:${color};text-align:${align};line-height:1.2`;
    };
    const placeAndName = `${portfolioName || ''}${propertyName ? ` — ${propertyName}` : ''}`;

    switch (el.type) {
        case 'title':
            return `<div style="${text({ fontSize: 16, fontWeight: 'bold', color: '#1a1a1a', align: 'left' })}">${escapeHtml(title)}</div>`;
        case 'subtitle': {
            const sub = subtitle || (propertyName ? `${portfolioName} — ${propertyName}` : portfolioName);
            return sub ? `<div style="${text({ fontSize: 11, fontWeight: 'normal', color: '#555555', align: 'left' })}">${escapeHtml(sub)}</div>` : '';
        }
        case 'portfolio_name':
            return `<div style="${text({ fontSize: 10, fontWeight: 'normal', color: '#555555', align: 'left' })}">${escapeHtml(placeAndName)}</div>`;
        case 'date':
            return `<div style="${text({ fontSize: 10, fontWeight: 'normal', color: '#888888', align: 'left' })}">Stichtag: ${escapeHtml(dateStr)}</div>`;
        case 'page_number':
            // Text wird nach der Seitenaufteilung je Seite gesetzt (paginateReport)
            return `<div data-page-number="1" style="${text({ fontSize: 9, fontWeight: 'normal', color: '#888888', align: 'right' })}">Seite 1 von 1</div>`;
        case 'line':
            return `<div style="${base}border-top:1px solid ${normalizeHexColor(el.color) || '#cccccc'}"></div>`;
        case 'logo':
            return logoUrl
                ? `<img src="${escapeHtml(logoUrl)}" alt="" style="${base}object-fit:contain" />`
                : '';
        case 'freetext':
            return `<div style="${text({ fontSize: 10, fontWeight: 'normal', color: '#333333', align: 'left' })}">${escapeHtml(el.text || '')}</div>`;
        default:
            return '';
    }
}

/**
 * Generate and open a print-ready report
 * @param {Object} options
 * @param {string} options.reportType - key from REPORT_CONFIGS
 * @param {Array} options.data - array of row objects
 * @param {Array} options.selectedColumns - array of column keys to include
 * @param {string} options.orientation - 'portrait' | 'landscape' | 'auto'
 * @param {boolean} options.showSums - show sum row
 * @param {boolean} options.groupByProperty - group rows by property
 * @param {boolean} options.dsgvoAnonymize - anonymize DSGVO fields
 * @param {string} options.portfolioName - name of the portfolio
 * @param {string} options.propertyName - optional property name
 * @param {string} options.accentColor - brand accent color
 * @param {string} options.logoUrl - optional logo URL
 * @param {string} options.subtitle - optional subtitle
 * @param {Object} options.template - full usePdfTemplate() result (preferred)
 * @param {Array}  options.templateElements - elements from pdf_templates (fallback)
 * @param {number} options.templateMargin - margin in mm (fallback)
 * @param {number} options.templateHeaderHeight - header height mm (fallback)
 * @param {number} options.templateFooterHeight - footer height mm (fallback)
 * @param {boolean} options.autoPrint - Druckdialog automatisch öffnen (Standard: true)
 * @param {Window} [options.targetWindow] - bereits (synchron im Klick) geöffnetes Fenster;
 *   empfohlen, wenn vor dem Aufruf noch auf Daten gewartet wird (Pop-up-Blocker)
 * @returns {boolean} true, wenn das Druckfenster geöffnet wurde
 */
export const generateClientPdf = ({
    reportType,
    data = [],
    selectedColumns = [],
    orientation = null,
    showSums = false,
    groupByProperty = false,
    dsgvoAnonymize = false,
    portfolioName = '',
    propertyName = null,
    accentColor: rawAccent = DEFAULT_ACCENT,
    logoUrl: rawLogo = null,
    subtitle: rawSubtitle = '',
    template = null,
    templateElements: rawElements = null,
    templateMargin: rawMargin = DEFAULT_MARGIN,
    templateHeaderHeight: rawHeaderH = HEADER_H,
    templateFooterHeight: rawFooterH = FOOTER_H,
    extraOptions = {},
    unitData = null,
    autoPrint = true,
    targetWindow = null,
}) => {
    const config = REPORT_CONFIGS[reportType];
    if (!config) {
        console.error('Unknown report type:', reportType);
        return false;
    }

    // Resolve template values (template object takes precedence over individual props)
    const accentColor = normalizeHexColor(template?.accentColor) || normalizeHexColor(rawAccent) || DEFAULT_ACCENT;
    const logoUrl = sanitizeLogoUrl(template?.logoUrl ?? rawLogo);
    const subtitle = template?.subtitle || rawSubtitle || '';
    const tplMargin = clampNum(toFinite(template?.margin || rawMargin, DEFAULT_MARGIN) || DEFAULT_MARGIN, 0, 50);
    const tplHeaderH = clampNum(toFinite(template?.headerHeight || rawHeaderH, HEADER_H) || HEADER_H, 10, 120);
    const tplFooterH = clampNum(toFinite(template?.footerHeight || rawFooterH, FOOTER_H) || FOOTER_H, 5, 80);

    // Get column definitions for selected columns
    const columns = config.columns.filter(c => selectedColumns.includes(c.key));

    // Estimate required width of the selected columns in pixels
    // A4 Portrait printable width is 180mm (≈ 680px) assuming 15mm margins (tplMargin)
    const totalEstWidth = columns.reduce((acc, col) => acc + getEstWidth(col), 0);
    const marginMm = tplMargin || 15;
    const printableWidthPortraitPx = (210 - 2 * marginMm) * MM_TO_PX;
    const autoOrient = totalEstWidth > printableWidthPortraitPx ? 'landscape' : 'portrait';

    // Resolve orientation: explicit > template per-reportType > any global template value > config default
    const templateOrientations = template?.orientationByReport || {};
    let orient = orientation
        || templateOrientations[reportType]
        || Object.values(templateOrientations)[0]
        || config.defaultOrientation;

    if (!orient || orient === 'auto') {
        orient = autoOrient;
    } else if (orientation !== 'portrait' && orientation !== 'landscape') {
        // Upgrade to landscape if it resolved to portrait but columns exceed page width
        if (orient === 'portrait' && totalEstWidth > printableWidthPortraitPx) {
            orient = 'landscape';
        }
    }
    if (orient !== 'landscape') orient = 'portrait';

    // Resolve elements: use global elements from template. Die Koordinaten
    // gelten für die im Editor gewählte Orientierung – weicht die Export-
    // Orientierung ab, werden sie (wie im Editor) umgerechnet und auf Ränder/
    // Zonen begrenzt, damit z. B. die Fußzeile nicht außerhalb der Seite landet.
    let tplElements = template ? (template.elements || rawElements) : rawElements;
    if (Array.isArray(tplElements) && tplElements.length > 0) {
        const tplOrient = template ? getTemplateOrientation(template.orientationByReport) : orient;
        tplElements = fitElementsToOrientation(tplElements, {
            from: tplOrient, to: orient, margin: tplMargin, headerH: tplHeaderH, footerH: tplFooterH,
        });
    } else {
        tplElements = null;
    }
    const filename = generateFilename(reportType, portfolioName, propertyName);
    const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    // Anonymize DSGVO fields
    const processedData = dsgvoAnonymize && config.dsgvoRelevant
        ? anonymizeRows(data, config.dsgvoFields)
        : data;

    // Group by property if needed
    let groups = null;
    if (groupByProperty && config.groupByProperty) {
        groups = {};
        processedData.forEach(row => {
            const groupKey = row._propertyLabel || row.immobilie || row.objekt || '–';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(row);
        });
    }

    // Build HTML
    const html = buildHtml({
        config, columns, processedData, groups, totalEstWidth,
        orient, filename, dateStr, timeStr,
        portfolioName, propertyName, subtitle,
        accentColor, logoUrl, showSums,
        templateElements: tplElements, templateMargin: tplMargin,
        templateHeaderHeight: tplHeaderH, templateFooterHeight: tplFooterH,
        extraOptions, unitData,
    });

    // Open in new tab (oder ein vom Aufrufer vorab geöffnetes Fenster verwenden)
    const win = targetWindow && !targetWindow.closed ? targetWindow : window.open('', '_blank');
    if (!win) {
        alert('Das Druckfenster wurde vom Browser blockiert. Bitte erlaube Pop-ups für diese Seite und versuche es erneut.');
        return false;
    }
    writePrintDocument(win, html);
    preparePrintWindow(win, html)
        .then(() => {
            if (autoPrint && !win.closed) {
                win.focus();
                win.print();
            }
        })
        .catch(err => console.warn('PDF-Druck konnte nicht vorbereitet werden:', err));
    return true;
};

// ─── Druckfenster ─────────────────────────────────────────────────────
function writePrintDocument(win, html) {
    const doc = win.document;
    doc.open();
    doc.write(html);
    doc.close();
    // Kein Inline-Skript im Druckdokument (CSP) – der Knopf wird von hier verdrahtet.
    const btn = doc.getElementById('pdf-print-btn');
    if (btn) btn.addEventListener('click', () => win.print());
}

const withTimeout = (promise, ms) => Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, ms)),
]);

const waitForImages = (doc) => Promise.all(Array.from(doc.images || []).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
    });
}));

/**
 * Wartet auf Schriften, teilt den Bericht auf echte A4-Seiten auf (Kopf/Fuß
 * auf jeder Seite, korrekte Seitenzahlen) und wartet auf das Logo, bevor
 * gedruckt wird.
 */
async function preparePrintWindow(win, html) {
    const doc = win.document;
    await withTimeout(doc.fonts?.ready, 3000);
    try {
        paginateReport(doc);
    } catch (err) {
        console.warn('Seitenaufteilung fehlgeschlagen – Bericht wird ungeteilt angezeigt:', err);
        writePrintDocument(win, html);
    }
    await withTimeout(waitForImages(win.document), 5000);
}

/**
 * Verteilt den Inhalt der (einen) Fließseite auf Seiten fester Höhe.
 * Einheiten: Gruppen (Überschrift + Tabelle), Tabellen (zeilenweise, je
 * <tbody class="row-block">) und sonstige Blöcke. Ein Block, der selbst auf
 * einer leeren Seite keinen Platz hat, bekommt ausnahmsweise eine mitwachsende
 * Seite („oversize"), damit nichts abgeschnitten wird.
 * @returns {number} Anzahl Seiten
 */
function paginateReport(doc) {
    const source = doc.querySelector('.page');
    const flow = source?.querySelector(':scope > .content');
    if (!source || !flow) return 0;

    const template = source.cloneNode(true);
    template.querySelector(':scope > .content').textContent = '';
    template.classList.add('paged');

    const host = source.parentNode;
    const units = Array.from(flow.children);
    const pages = [];
    let page = null;
    let content = null;
    let forceNew = false;

    const newPage = () => {
        page = template.cloneNode(true);
        content = page.querySelector(':scope > .content');
        host.insertBefore(page, source);
        pages.push(page);
        forceNew = false;
    };
    const ensureRoom = () => { if (!page || forceNew) newPage(); };
    const overflows = () => content.scrollHeight > content.clientHeight + 1;
    const markOversize = () => { page.classList.add('oversize'); forceNew = true; };

    const placeBlock = (node) => {
        ensureRoom();
        content.appendChild(node);
        if (!overflows()) return;
        if (content.childElementCount > 1) {
            node.remove();
            newPage();
            content.appendChild(node);
            if (overflows()) markOversize();
        } else {
            markOversize();
        }
    };

    const placeTable = (table, heading) => {
        const bodies = Array.from(table.tBodies);
        let shell = null;
        let headCopy = null;
        let rowsInShell = 0;
        const openShell = () => {
            ensureRoom();
            headCopy = heading ? heading.cloneNode(true) : null;
            if (headCopy) content.appendChild(headCopy);
            shell = table.cloneNode(false);
            if (table.tHead) shell.appendChild(table.tHead.cloneNode(true));
            content.appendChild(shell);
            rowsInShell = 0;
        };
        const discardShell = () => { shell.remove(); if (headCopy) headCopy.remove(); };
        const shellIsAlone = () => content.childElementCount === (headCopy ? 2 : 1);

        openShell();
        if (bodies.length === 0) {
            if (overflows() && !shellIsAlone()) { discardShell(); newPage(); openShell(); }
            if (overflows()) markOversize();
            return;
        }
        bodies.forEach(body => {
            if (forceNew) openShell();
            shell.appendChild(body);
            if (!overflows()) { rowsInShell += 1; return; }
            body.remove();
            if (rowsInShell === 0 && shellIsAlone()) {
                shell.appendChild(body);
                rowsInShell = 1;
                markOversize();
                return;
            }
            // Überschrift/Tabellenkopf nicht allein am Seitenende stehen lassen
            if (rowsInShell === 0) discardShell();
            newPage();
            openShell();
            shell.appendChild(body);
            rowsInShell = 1;
            if (overflows()) markOversize();
        });
    };

    units.forEach(node => {
        if (node.matches('section.report-group')) {
            if (node.dataset.breakBefore === '1' && page && content.childElementCount > 0) forceNew = true;
            const heading = node.querySelector(':scope > .group-title');
            const table = node.querySelector(':scope > table.report-table');
            if (table) placeTable(table, heading);
            else placeBlock(node);
        } else if (node.matches('table.report-table')) {
            placeTable(node, null);
        } else {
            placeBlock(node);
        }
    });
    if (pages.length === 0) newPage();
    source.remove();

    pages.forEach((p, i) => {
        p.querySelectorAll('[data-page-number]').forEach(el => {
            el.textContent = `Seite ${i + 1} von ${pages.length}`;
        });
    });
    return pages.length;
}

// ─── HTML Builder ─────────────────────────────────────────────────────
function buildHtml({
    config, columns, processedData, groups, totalEstWidth,
    orient, filename, dateStr, timeStr,
    portfolioName, propertyName, subtitle,
    accentColor, logoUrl, showSums,
    templateElements, templateMargin, templateHeaderHeight, templateFooterHeight,
    extraOptions = {}, unitData = null,
}) {
    const isLandscape = orient === 'landscape';
    const pageW = isLandscape ? 297 : 210;
    const pageH = isLandscape ? 210 : 297;
    const margin = templateMargin || 15;
    const headerH = templateHeaderHeight || 50;
    const footerH = templateFooterHeight || 20;
    const title = config.label;
    const hasTemplate = templateElements && templateElements.length > 0;
    const widthTotal = totalEstWidth || 1;
    let sumWarning = false;

    const getAlign = (col) => {
        if (['currency', 'area', 'percent', 'decimal'].includes(col.format)) return 'right';
        return 'left';
    };

    const badge = (val, bg, fg) => `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:7px;font-weight:600;background:${bg};color:${fg};">${escapeHtml(val)}</span>`;

    const renderCell = (row, col) => {
        const val = row[col.key];
        if (val === null || val === undefined || val === '') return '–';
        if (col.key === 'status') {
            const statusStr = String(val);
            if (statusStr === 'Vermietet' || statusStr === 'vermietet') return badge(val, '#dcfce7', '#15803d');
            if (statusStr === 'Ferienwohnung' || statusStr === 'ferienwohnung') return badge(val, '#dbeafe', '#1d4ed8');
            return badge(val, '#fee2e2', '#b91c1c');
        }
        if (col.format) return escapeHtml(formatValue(val, col.format));
        const str = String(val);
        if (col.maxLen && str.length > col.maxLen) return escapeHtml(str.substring(0, col.maxLen) + '…');
        return escapeHtml(str).replace(/\r?\n/g, '<br/>');
    };

    const renderUnitRows = (row) => {
        if (!extraOptions.includeUnits || !unitData || !row.property_id) return '';
        const units = unitData[row.property_id];
        if (!units || units.length === 0) return '';
        const thStyle = 'padding:3px 8px;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;';
        const tdStyle = 'padding:3px 8px;font-size:8px;border-bottom:1px solid #f1f5f9;';
        return `
                <tr>
                    <td colspan="${columns.length}" style="padding:4px 10px 10px 28px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
                        <table style="width:100%;border-collapse:collapse;margin-top:2px;table-layout:fixed;">
                            <thead>
                                <tr>
                                    <th style="width:35%;text-align:left;${thStyle}">Einheit</th>
                                    <th style="width:15%;text-align:left;${thStyle}">Etage</th>
                                    <th style="width:12%;text-align:right;${thStyle}">Fläche</th>
                                    <th style="width:10%;text-align:right;${thStyle}">Zimmer</th>
                                    <th style="width:15%;text-align:right;${thStyle}">Miete Ist</th>
                                    <th style="width:13%;text-align:left;${thStyle}">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${units.map((u, ui) => `
                                <tr style="${ui % 2 === 1 ? 'background:#f1f5f9;' : ''}">
                                    <td style="width:35%;${tdStyle}white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u.unit_name || '–')}</td>
                                    <td style="width:15%;${tdStyle}white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u.floor || '–')}</td>
                                    <td style="width:12%;${tdStyle}text-align:right;">${u.sqm ? escapeHtml(formatValue(u.sqm, 'area')) : '–'}</td>
                                    <td style="width:10%;${tdStyle}text-align:right;">${escapeHtml(u.rooms || '–')}</td>
                                    <td style="width:15%;${tdStyle}text-align:right;">${u.target_rent ? escapeHtml(formatValue(u.target_rent, 'currency')) : '–'}</td>
                                    <td style="width:13%;${tdStyle}white-space:nowrap;overflow:hidden;">
                                        ${u.status === 'Vermietet' ? badge(u.status, '#dcfce7', '#15803d') : (u.status === 'Ferienwohnung' ? badge(u.status, '#dbeafe', '#1d4ed8') : badge(u.status || '–', '#fee2e2', '#b91c1c'))}
                                    </td>
                                </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </td>
                </tr>`;
    };

    // Jede Zeile (inkl. Einheiten-Unterzeile) ist ein eigener <tbody>, damit
    // die Seitenaufteilung Zeilen nie auseinanderreißt.
    const renderRows = (rows) => rows.map((row, i) => `
        <tbody class="row-block">
        <tr style="${i % 2 === 1 ? 'background:#fafbfc;' : ''}">
            ${columns.map(col => {
            const cellContent = renderCell(row, col);
            const hasBreaks = cellContent.includes('<br/>');
            const pct = (getEstWidth(col) / widthTotal) * 100;
            return `
                <td style="width:${pct}%;padding:6px 10px;text-align:${getAlign(col)};font-size:9px;border-bottom:1px solid #eee;${hasBreaks ? 'white-space:pre-line;' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;'}">
                    ${cellContent}
                </td>`;
        }).join('')}
        </tr>${renderUnitRows(row)}
        </tbody>`).join('');

    const renderSumRow = (dataForSums) => {
        if (!showSums || !config.sumColumns) return '';
        const localSums = computeSums(dataForSums, columns, config.sumColumns);
        return `
            <tbody class="row-block sum-block">
            <tr style="background:${accentColor}11;font-weight:700;border-top:2px solid ${accentColor};">
                ${columns.map(col => {
                    const pct = (getEstWidth(col) / widthTotal) * 100;
                    const sum = localSums[col.key];
                    let cell = col === columns[0] ? 'Summe' : '';
                    if (sum) {
                        if (sum.invalid > 0) {
                            sumWarning = true;
                            cell = '–*';
                        } else {
                            cell = escapeHtml(formatValue(sum.total, col.format));
                        }
                    }
                    return `
                    <td style="width:${pct}%;padding:7px 10px;text-align:${getAlign(col)};font-size:9px;border-bottom:2px solid ${accentColor}30;">
                        ${cell}
                    </td>`;
                }).join('')}
            </tr>
            </tbody>
        `;
    };

    const renderTable = (rows) => `
            <table class="report-table" style="width:100%;border-collapse:collapse;table-layout:fixed;">
                <thead>
                    <tr>
                        ${columns.map(col => {
                            const pct = (getEstWidth(col) / widthTotal) * 100;
                            return `
                            <th style="width:${pct}%;padding:7px 10px;text-align:${getAlign(col)};font-size:8px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;white-space:nowrap;">
                                ${escapeHtml(col.label)}
                            </th>`;
                        }).join('')}
                    </tr>
                </thead>
                ${renderRows(rows)}
                ${renderSumRow(rows)}
            </table>
        `;

    let tableContent = '';

    if (groups) {
        const groupKeys = Object.keys(groups);
        groupKeys.forEach((groupName, gi) => {
            tableContent += `
                <section class="report-group" data-break-before="${gi > 0 ? '1' : '0'}" style="${gi > 0 ? 'page-break-before:always;break-before:page;' : ''}">
                    <h3 class="group-title" style="font-size:11px;font-weight:600;color:${accentColor};margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid ${accentColor}30;">
                        ${escapeHtml(groupName)}
                    </h3>
                    ${renderTable(groups[groupName])}
                </section>
            `;
        });
    } else {
        tableContent = renderTable(processedData);
    }

    // ── Template-aware header & footer ──────────────────────────────
    const elContext = { title, subtitle, portfolioName, propertyName, logoUrl, dateStr };

    let headerHtml = '';
    let footerHtml = '';

    if (hasTemplate) {
        // Use positioned elements from the saved template
        const headerEls = templateElements.filter(e => e.zone === 'header' && e.visible).sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));
        const footerEls = templateElements.filter(e => e.zone === 'footer' && e.visible).sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));
        // Footer elements have Y coords relative to the full page, but the
        // .footer container starts at (pageH - footerH). Subtract that offset.
        const footerYOffset = pageH - footerH;
        headerHtml = headerEls.map(el => renderTemplateElement(el, elContext, 0)).join('');
        footerHtml = footerEls.map(el => renderTemplateElement(el, elContext, footerYOffset)).join('');
    } else {
        // Fallback: hardcoded header/footer (same as before)
        headerHtml = `
            <div style="position:absolute;left:${margin * MM_TO_PX}px;right:${margin * MM_TO_PX}px;top:${18 * MM_TO_PX}px;display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <div style="font-size:16pt;font-weight:700;color:#1a1a1a;margin-bottom:2mm">${escapeHtml(title)}</div>
                    ${subtitle ? `<div style="font-size:11pt;color:#555;margin-bottom:1mm">${escapeHtml(subtitle)}</div>` : ''}
                    <div style="font-size:10pt;color:#888">${escapeHtml(portfolioName)}${propertyName ? ` — ${escapeHtml(propertyName)}` : ''} · Stichtag: ${escapeHtml(dateStr)}</div>
                </div>
                ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" style="max-height:15mm;max-width:45mm;object-fit:contain" />` : ''}
            </div>
            <div style="position:absolute;left:${margin * MM_TO_PX}px;right:${margin * MM_TO_PX}px;top:${44 * MM_TO_PX}px;height:0.5mm;background:${accentColor};opacity:0.3"></div>
        `;
        footerHtml = `
            <div style="position:absolute;left:${margin * MM_TO_PX}px;bottom:3mm;font-size:9pt;color:#888">Stichtag: ${escapeHtml(dateStr)}</div>
            <div data-page-number="1" style="position:absolute;right:${margin * MM_TO_PX}px;bottom:3mm;font-size:9pt;color:#888;text-align:right">Seite 1 von 1</div>
        `;
    }

    const sizeStr = isLandscape ? 'A4 landscape' : 'A4';
    const storageOrigin = getStorageOrigin();
    // Bilder nur vom eigenen Storage (Logo); ohne bekannte Supabase-URL: https
    const imgSrc = storageOrigin || 'https:';
    const metaLine = `${processedData.length} Einträge · Erstellt am ${escapeHtml(dateStr)} um ${escapeHtml(timeStr)}`;
    const sumNote = sumWarning ? '<div style="margin-top:1mm">* Summe nicht berechenbar: Die Spalte enthält nicht-numerische Werte.</div>' : '';

    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <title>${escapeHtml(filename)}</title>
    <style>
        @page {
            size: ${sizeStr};
            margin: 0;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: ${PDF_FONT_STACK};
            color: #1e293b;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .page {
            width: ${pageW}mm;
            min-height: ${pageH}mm;
            position: relative;
            margin: 0 auto;
            background: #fff;
            page-break-after: always;
            break-after: page;
        }
        .page:last-of-type { page-break-after: auto; break-after: auto; }
        .header { position: relative; height: ${headerH}mm; }
        .footer { position: absolute; bottom: 0; left: 0; right: 0; height: ${footerH}mm; border-top: 0.5px solid #e5e7eb; }
        .content { padding: 4mm ${margin}mm ${footerH + 2}mm; }
        .page.paged { height: ${pageH}mm; min-height: 0; overflow: hidden; }
        .page.paged > .content { position: absolute; top: ${headerH}mm; left: 0; right: 0; bottom: ${footerH + 2}mm; padding: 4mm ${margin}mm 0; overflow: hidden; }
        .page.paged.oversize { height: auto; min-height: ${pageH}mm; overflow: visible; }
        .page.paged.oversize > .content { position: static; overflow: visible; padding: 4mm ${margin}mm ${footerH + 2}mm; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
        @media screen {
            body {
                padding: 20px;
                background: #f1f5f9;
            }
            .page {
                margin: 0 auto 40px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08);
                border-radius: 8px;
            }
        }
        @media print {
            .no-print { display: none !important; }
            body { padding: 0; background: #fff; }
            .page { margin: 0; box-shadow: none; border-radius: 0; }
        }
    </style>
</head>
<body>
    <!-- Print button (screen only) -->
    <div class="no-print" style="text-align:center;padding:12px 0 20px;">
        <button id="pdf-print-btn" type="button" style="padding:10px 28px;font-size:14px;font-weight:600;background:${accentColor};color:white;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);">
            🖨️ Als PDF drucken / speichern
        </button>
        <p style="margin-top:8px;font-size:12px;color:#94a3b8;">Drücke Strg+P oder klicke den Button. Wähle "Als PDF speichern" im Druckdialog.</p>
    </div>

    <div class="page">
        <!-- Header -->
        <div class="header">
            ${headerHtml}
        </div>

        <!-- Table Content -->
        <div class="content">
            ${tableContent}
            <div class="report-meta" style="margin-top:8mm;font-size:7pt;color:#aaa">${metaLine}${sumNote}</div>
        </div>

        <!-- Footer -->
        <div class="footer">
            ${footerHtml}
        </div>
    </div>
</body>
</html>`;
}
