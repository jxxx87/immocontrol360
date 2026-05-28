// ─── Client-Side PDF Generator ─────────────────────────────────────
// Opens a print-ready HTML document in a new tab.
// Renders header/footer using positioned template elements from Supabase.

import { REPORT_CONFIGS, formatValue, generateFilename } from './reportConfigs';

const MM_TO_PX = 3.78; // 1mm ≈ 3.78px at 96dpi

/**
 * Render a single template element to HTML
 */
function renderTemplateElement(el, { title, subtitle, portfolioName, propertyName, logoUrl, dateStr, accentColor }, yOffset = 0) {
    if (!el.visible) return '';
    const left = el.x * MM_TO_PX;
    const top = (el.y - yOffset) * MM_TO_PX;
    const width = el.w * MM_TO_PX;
    const height = (el.h || 5) * MM_TO_PX;
    const base = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-family:'Inter',sans-serif;overflow:hidden;`;

    switch (el.type) {
        case 'title':
            return `<div style="${base}font-size:${el.fontSize || 16}pt;font-weight:${el.fontWeight || 'bold'};color:${el.color || '#1a1a1a'};text-align:${el.align || 'left'};line-height:1.2">${title}</div>`;
        case 'subtitle': {
            const sub = subtitle || (propertyName ? `${portfolioName} — ${propertyName}` : portfolioName);
            return sub ? `<div style="${base}font-size:${el.fontSize || 11}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#555555'};text-align:${el.align || 'left'};line-height:1.2">${sub}</div>` : '';
        }
        case 'portfolio_name':
            return `<div style="${base}font-size:${el.fontSize || 10}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#555555'};text-align:${el.align || 'left'};line-height:1.2">${portfolioName}${propertyName ? ` — ${propertyName}` : ''}</div>`;
        case 'date':
            return `<div style="${base}font-size:${el.fontSize || 10}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#888888'};text-align:${el.align || 'left'};line-height:1.2">Stichtag: ${dateStr}</div>`;
        case 'page_number':
            return `<div style="${base}font-size:${el.fontSize || 9}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#888888'};text-align:${el.align || 'right'};line-height:1.2">Seite 1 von 1</div>`;
        case 'line':
            return `<div style="${base}border-top:1px solid ${el.color || '#cccccc'}"></div>`;
        case 'logo':
            return logoUrl
                ? `<img src="${logoUrl}" style="${base}object-fit:contain" />`
                : '';
        case 'freetext':
            return `<div style="${base}font-size:${el.fontSize || 10}pt;font-weight:${el.fontWeight || 'normal'};color:${el.color || '#333333'};text-align:${el.align || 'left'};line-height:1.2">${el.text || ''}</div>`;
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
 * @param {string} options.orientation - 'portrait' | 'landscape'
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
    accentColor: rawAccent = '#0ea5e9',
    logoUrl: rawLogo = null,
    subtitle: rawSubtitle = '',
    template = null,
    templateElements: rawElements = null,
    templateMargin: rawMargin = 15,
    templateHeaderHeight: rawHeaderH = 50,
    templateFooterHeight: rawFooterH = 20,
    extraOptions = {},
    unitData = null,
}) => {
    const config = REPORT_CONFIGS[reportType];
    if (!config) {
        console.error('Unknown report type:', reportType);
        return;
    }

    // Resolve template values (template object takes precedence over individual props)
    const accentColor = template?.accentColor || rawAccent;
    const logoUrl = template?.logoUrl ?? rawLogo;
    const subtitle = template?.subtitle || rawSubtitle;
    const tplMargin = template?.margin || rawMargin;
    const tplHeaderH = template?.headerHeight || rawHeaderH;
    const tplFooterH = template?.footerHeight || rawFooterH;

    // Get column definitions for selected columns
    const columns = config.columns.filter(c => selectedColumns.includes(c.key));

    // Estimate required width of the selected columns in pixels
    // A4 Portrait printable width is 180mm (≈ 680px) assuming 15mm margins (tplMargin)
    const getEstWidth = (col) => {
        let w = Math.max(col.label.length * 7 + 24, 60);
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
    const totalEstWidth = columns.reduce((acc, col) => acc + getEstWidth(col), 0);
    const marginMm = tplMargin || 15;
    const printableWidthPortraitPx = (210 - 2 * marginMm) * 3.78;
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

    // Resolve elements: use global elements from template
    let tplElements = rawElements;
    if (template) {
        tplElements = template.elements || rawElements;
    }
    const filename = generateFilename(reportType, portfolioName, propertyName);
    const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    // Anonymize DSGVO fields
    const processedData = dsgvoAnonymize && config.dsgvoRelevant
        ? data.map(row => {
            const newRow = { ...row };
            (config.dsgvoFields || []).forEach(field => {
                if (newRow[field]) {
                    const val = String(newRow[field]);
                    newRow[field] = val.charAt(0) + '***' + (val.length > 3 ? val.charAt(val.length - 1) : '');
                }
            });
            return newRow;
        })
        : data;

    // Calculate sums
    const sums = {};
    if (showSums && config.sumColumns) {
        config.sumColumns.forEach(key => {
            if (selectedColumns.includes(key)) {
                sums[key] = processedData.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
            }
        });
    }

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
        config, columns, processedData, sums, groups,
        orient, filename, dateStr, timeStr,
        portfolioName, propertyName, subtitle,
        accentColor, logoUrl, showSums,
        templateElements: tplElements, templateMargin: tplMargin,
        templateHeaderHeight: tplHeaderH, templateFooterHeight: tplFooterH,
        extraOptions, unitData,
    });

    // Open in new tab
    const win = window.open('', '_blank');
    if (win) {
        win.document.write(html);
        win.document.close();
        // Auto-trigger print dialog after a short delay
        setTimeout(() => {
            win.print();
        }, 600);
    }
};

// ─── HTML Builder ─────────────────────────────────────────────────────
function buildHtml({
    config, columns, processedData, sums, groups,
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

    const getEstWidth = (col) => {
        let w = Math.max(col.label.length * 7 + 24, 60);
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
    const totalEstWidth = columns.reduce((acc, col) => acc + getEstWidth(col), 0);

    const getAlign = (col) => {
        if (['currency', 'area', 'percent', 'decimal'].includes(col.format)) return 'right';
        return 'left';
    };

    const renderCell = (row, col) => {
        const val = row[col.key];
        if (val === null || val === undefined || val === '') return '–';
        if (col.key === 'status') {
            const statusStr = String(val);
            if (statusStr === 'Vermietet' || statusStr === 'vermietet') {
                return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:7px;font-weight:600;background:#dcfce7;color:#15803d;">${val}</span>`;
            } else if (statusStr === 'Ferienwohnung' || statusStr === 'ferienwohnung') {
                return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:7px;font-weight:600;background:#dbeafe;color:#1d4ed8;">${val}</span>`;
            } else {
                return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:7px;font-weight:600;background:#fee2e2;color:#b91c1c;">${val}</span>`;
            }
        }
        if (col.format) return formatValue(val, col.format);
        const str = String(val);
        if (col.maxLen && str.length > col.maxLen) return str.substring(0, col.maxLen) + '…';
        return str.replace(/\n/g, '<br/>');
    };

    const renderRows = (rows) => rows.map((row, i) => {
        let rowHtml = `
        <tr style="${i % 2 === 1 ? 'background:#fafbfc;' : ''}">
            ${columns.map(col => {
            const cellContent = renderCell(row, col);
            const hasBreaks = cellContent.includes('<br/>');
            const pct = (getEstWidth(col) / totalEstWidth) * 100;
            return `
                <td style="width:${pct}%;padding:6px 10px;text-align:${getAlign(col)};font-size:9px;border-bottom:1px solid #eee;${hasBreaks ? 'white-space:pre-line;' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;'}">
                    ${cellContent}
                </td>`;
        }).join('')}
        </tr>`;

        // Include unit detail sub-rows if enabled
        if (extraOptions.includeUnits && unitData && row.property_id) {
            const units = unitData[row.property_id];
            if (units && units.length > 0) {
                rowHtml += `
                <tr>
                    <td colspan="${columns.length}" style="padding:4px 10px 10px 28px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
                        <table style="width:100%;border-collapse:collapse;margin-top:2px;table-layout:fixed;">
                            <thead>
                                <tr>
                                    <th style="width:35%;padding:3px 8px;text-align:left;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Einheit</th>
                                    <th style="width:15%;padding:3px 8px;text-align:left;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Etage</th>
                                    <th style="width:12%;padding:3px 8px;text-align:right;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Fläche</th>
                                    <th style="width:10%;padding:3px 8px;text-align:right;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Zimmer</th>
                                    <th style="width:15%;padding:3px 8px;text-align:right;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Miete Ist</th>
                                    <th style="width:13%;padding:3px 8px;text-align:left;font-size:7px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${units.map((u, ui) => `
                                <tr style="${ui % 2 === 1 ? 'background:#f1f5f9;' : ''}">
                                    <td style="width:35%;padding:3px 8px;font-size:8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.unit_name || '–'}</td>
                                    <td style="width:15%;padding:3px 8px;font-size:8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.floor || '–'}</td>
                                    <td style="width:12%;padding:3px 8px;font-size:8px;text-align:right;border-bottom:1px solid #f1f5f9;">${u.sqm ? formatValue(u.sqm, 'area') : '–'}</td>
                                    <td style="width:10%;padding:3px 8px;font-size:8px;text-align:right;border-bottom:1px solid #f1f5f9;">${u.rooms || '–'}</td>
                                    <td style="width:15%;padding:3px 8px;font-size:8px;text-align:right;border-bottom:1px solid #f1f5f9;">${u.target_rent ? formatValue(u.target_rent, 'currency') : '–'}</td>
                                    <td style="width:13%;padding:3px 8px;font-size:8px;border-bottom:1px solid #f1f5f9;white-space:nowrap;overflow:hidden;">
                                        <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:7px;font-weight:600;${u.status === 'Vermietet' ? 'background:#dcfce7;color:#15803d;' : (u.status === 'Ferienwohnung' ? 'background:#dbeafe;color:#1d4ed8;' : 'background:#fee2e2;color:#b91c1c;')}">${u.status || '–'}</span>
                                    </td>
                                </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </td>
                </tr>`;
            }
        }

        return rowHtml;
    }).join('');

    const renderSumRow = (dataForSums) => {
        if (!showSums || !config.sumColumns) return '';
        const localSums = {};
        config.sumColumns.forEach(key => {
            if (columns.find(c => c.key === key)) {
                localSums[key] = dataForSums.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
            }
        });
        return `
            <tr style="background:${accentColor}11;font-weight:700;border-top:2px solid ${accentColor};">
                ${columns.map(col => {
                    const pct = (getEstWidth(col) / totalEstWidth) * 100;
                    return `
                    <td style="width:${pct}%;padding:7px 10px;text-align:${getAlign(col)};font-size:9px;border-bottom:2px solid ${accentColor}30;">
                        ${localSums[col.key] !== undefined ? formatValue(localSums[col.key], col.format) : (col === columns[0] ? 'Summe' : '')}
                    </td>`;
                }).join('')}
            </tr>
        `;
    };

    let tableContent = '';

    if (groups) {
        const groupKeys = Object.keys(groups);
        groupKeys.forEach((groupName, gi) => {
            tableContent += `
                <div style="${gi > 0 ? 'page-break-before:always;' : ''}">
                    <h3 style="font-size:11px;font-weight:600;color:${accentColor};margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid ${accentColor}30;">
                        ${groupName}
                    </h3>
                    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
                        <thead>
                            <tr>
                                ${columns.map(col => {
                                    const pct = (getEstWidth(col) / totalEstWidth) * 100;
                                    return `
                                    <th style="width:${pct}%;padding:7px 10px;text-align:${getAlign(col)};font-size:8px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;white-space:nowrap;">
                                        ${col.label}
                                    </th>`;
                                }).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${renderRows(groups[groupName])}
                            ${renderSumRow(groups[groupName])}
                        </tbody>
                    </table>
                </div>
            `;
        });
    } else {
        tableContent = `
            <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
                <thead>
                    <tr>
                        ${columns.map(col => {
                            const pct = (getEstWidth(col) / totalEstWidth) * 100;
                            return `
                            <th style="width:${pct}%;padding:7px 10px;text-align:${getAlign(col)};font-size:8px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e2e8f0;white-space:nowrap;">
                                ${col.label}
                            </th>`;
                        }).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${renderRows(processedData)}
                    ${showSums ? renderSumRow(processedData) : ''}
                </tbody>
            </table>
        `;
    }

    // ── Template-aware header & footer ──────────────────────────────
    const elContext = { title, subtitle, portfolioName, propertyName, logoUrl, dateStr, accentColor };

    let headerHtml = '';
    let footerHtml = '';

    if (hasTemplate) {
        // Use positioned elements from the saved template
        const headerEls = templateElements.filter(e => e.zone === 'header' && e.visible);
        const footerEls = templateElements.filter(e => e.zone === 'footer' && e.visible);
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
                    <div style="font-size:16pt;font-weight:700;color:#1a1a1a;margin-bottom:2mm">${title}</div>
                    ${subtitle ? `<div style="font-size:11pt;color:#555;margin-bottom:1mm">${subtitle}</div>` : ''}
                    <div style="font-size:10pt;color:#888">${portfolioName}${propertyName ? ` — ${propertyName}` : ''} · Stichtag: ${dateStr}</div>
                </div>
                ${logoUrl ? `<img src="${logoUrl}" style="max-height:15mm;max-width:45mm;object-fit:contain" />` : ''}
            </div>
            <div style="position:absolute;left:${margin * MM_TO_PX}px;right:${margin * MM_TO_PX}px;top:${44 * MM_TO_PX}px;height:0.5mm;background:${accentColor};opacity:0.3"></div>
        `;
        footerHtml = `
            <div style="position:absolute;left:${margin * MM_TO_PX}px;bottom:3mm;font-size:9pt;color:#888">Stichtag: ${dateStr}</div>
            <div style="position:absolute;right:${margin * MM_TO_PX}px;bottom:3mm;font-size:9pt;color:#888;text-align:right">Seite 1 von 1</div>
        `;
    }

    const sizeStr = isLandscape ? 'A4 landscape' : 'A4';

    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>${filename}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: ${sizeStr};
            margin: 0;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #1e293b;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        @media print {
            .no-print { display: none !important; }
            body { padding: 0; }
        }
        @media screen {
            body { 
                padding: 20px; 
                background: #f1f5f9;
            }
            .page {
                margin: 0 auto 40px;
                background: white;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08);
                border-radius: 8px;
            }
        }
        .page {
            width: ${pageW}mm;
            min-height: ${pageH}mm;
            position: relative;
            margin: 0 auto;
            background: #fff;
            page-break-after: always;
        }
        .page:last-child { page-break-after: auto; }
        .header { position: relative; height: ${headerH}mm; }
        .footer { position: absolute; bottom: 0; left: 0; right: 0; height: ${footerH}mm; border-top: 0.5px solid #e5e7eb; }
        .content { padding: 4mm ${margin}mm ${footerH + 2}mm; }
        table { width: 100%; border-collapse: collapse; }
        thead { display: table-header-group; }
    </style>
</head>
<body>
    <!-- Print button (screen only) -->
    <div class="no-print" style="text-align:center;padding:12px 0 20px;">
        <button onclick="window.print()" style="padding:10px 28px;font-size:14px;font-weight:600;background:${accentColor};color:white;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);">
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
            <div style="margin-top:8mm;font-size:7pt;color:#aaa">${processedData.length} Einträge · Erstellt am ${dateStr} um ${timeStr}</div>
        </div>

        <!-- Footer -->
        <div class="footer">
            ${footerHtml}
        </div>
    </div>
</body>
</html>`;
}
