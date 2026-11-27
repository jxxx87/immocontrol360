// ─── Floor Plan Export Utilities ─────────────────────────────────
// PNG, PDF, and CSV quantity list export for floor plans.

import jsPDF from 'jspdf';
import { render, createViewport } from './canvasRenderer';
import { mm2ToM2 } from './constants';
import { dist, getPoint, getWallPolygon, getFurnitureCorners, getOpeningWallId } from './geometryKernel';
import { getFurnitureItem } from './furnitureCatalog';

// ─── Helpers (Formatierung, Dateinamen) ─────────────────────────

/** Zahl mit Dezimalkomma (deutsches Excel/PDF); nicht endliche Werte → '0,00'. */
const de = (value, digits = 2) => {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toFixed(digits).replace('.', ',');
};

/** Bereits als Text (toFixed) vorliegende Zahl ins deutsche Format bringen. */
const deText = (value) => String(value ?? '').replace('.', ',');

/**
 * Textfeld für CSV: CSV-Injection entschärfen (führendes = + - @ wird als Text
 * markiert) und Felder mit Trennzeichen, Anführungszeichen oder Umbrüchen quoten.
 */
const csvText = (value) => {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[";\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
};

/** Dateiname ohne unzulässige Zeichen; leerer/fehlender Planname → „Grundriss“. */
const safeFileBase = (name) => {
    const base = String(name ?? '').trim() || 'Grundriss';
    // eslint-disable-next-line no-control-regex
    return base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_');
};

const planTitle = (name) => String(name ?? '').trim() || 'Grundriss';

// ─── PNG Export ─────────────────────────────────────────────────

/**
 * Export a storey as PNG (high-res offscreen canvas).
 * @param {Object} storey - Storey data
 * @param {string} planName - Name of the floor plan
 * @param {number} [resolution=3000] - Canvas width in pixels
 * @returns {Promise<Blob|null>} - PNG blob (null, wenn der Browser das Bild nicht erzeugen konnte)
 */
export const exportToPNG = async (storey, planName, resolution = 3000) => {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');

    // Gezeichnet wird auf einer logischen Fläche von ca. 1200 px, hochskaliert auf
    // die Zielauflösung – Maßtexte und Linien bleiben dadurch lesbar statt winzig.
    const pixelRatio = Math.max(1, resolution / 1200);
    const logical = resolution / pixelRatio;
    const header = 40; // logische px für den Titel

    // Calculate bounding box of all elements (inkl. Wanddicke, Maßketten, Dach, Anmerkungen)
    const bbox = getBoundingBox(storey);
    const worldWidth = bbox.maxX - bbox.minX;
    const worldHeight = bbox.maxY - bbox.minY;
    const availH = logical - header;
    const zoom = Math.min(logical / worldWidth, availH / worldHeight);

    const vp = createViewport();
    vp.zoom = zoom;
    vp.offsetX = -(bbox.minX * zoom) + (logical - worldWidth * zoom) / 2;
    vp.offsetY = header - (bbox.minY * zoom) + (availH - worldHeight * zoom) / 2;

    render(ctx, canvas, vp, storey, {
        selectedId: null, preview: null, snapPoint: null, dimensionLine: null,
        isPrinting: true, isExport: true, pixelRatio,
    });

    // Add title
    ctx.fillStyle = '#1e293b';
    ctx.font = `bold ${Math.round(resolution / 50)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${planTitle(planName)} – ${storey.label || ''}`, 30, 50);

    // Add scale bar
    drawScaleBar(ctx, vp, resolution, pixelRatio);

    return new Promise((resolve) => {
        try {
            canvas.toBlob(blob => resolve(blob || null), 'image/png', 1.0);
        } catch (err) {
            console.error('PNG-Export fehlgeschlagen:', err);
            resolve(null);
        }
    });
};

/**
 * Download blob as file.
 * Gibt false zurück (mit Hinweis), wenn keine Datei erzeugt werden konnte.
 */
export const downloadBlob = (blob, filename) => {
    if (!blob) {
        const msg = 'Die Datei konnte nicht erzeugt werden (zu wenig Speicher oder zu große Grafik). Bitte erneut versuchen.';
        if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(msg);
        else console.error(msg);
        return false;
    }
    const raw = String(filename ?? '').trim() || 'Grundriss';
    // eslint-disable-next-line no-control-regex
    const safeName = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Erst verzögert freigeben – sofortiges Freigeben bricht den Download in
    // manchen Browsern/WebViews ab
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
};

// ─── PDF Export ─────────────────────────────────────────────────

/**
 * Export floor plan as PDF with all storeys.
 * A4 landscape, one page per storey.
 */
export const exportToPDF = async (storeys, planName) => {
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
    });

    const pageW = 297; // A4 landscape width in mm
    const pageH = 210; // A4 landscape height in mm
    const margin = 15;
    const drawW = pageW - margin * 2;
    const drawH = pageH - margin * 2 - 25; // leave space for header/footer
    const title = planTitle(planName);
    const lineH = 3; // mm je Zeile der Raumliste (7 pt)
    const maxFooterLines = 8;

    for (let i = 0; i < storeys.length; i++) {
        if (i > 0) pdf.addPage();
        const storey = storeys[i];

        // Header
        pdf.setFontSize(14);
        pdf.setFont(undefined, 'bold');
        pdf.text(`${title} – ${storey.label || ''}`, margin, margin + 5);
        pdf.setFontSize(8);
        pdf.setFont(undefined, 'normal');
        pdf.text(`Erstellt am ${new Date().toLocaleDateString('de-DE')}`, margin, margin + 11);

        // Raumliste vorab umbrechen, damit sie Platz bekommt (statt über den Rand zu laufen)
        const rooms = storey.rooms || [];
        let roomLines = [];
        if (rooms.length > 0) {
            pdf.setFontSize(7);
            const roomTexts = rooms.map(r => `${r.name}: ${mm2ToM2(r.area_mm2 || 0)} m²`);
            roomLines = pdf.splitTextToSize(roomTexts.join('  |  '), drawW - 30);
        }
        const footerLines = roomLines.slice(0, maxFooterLines);
        const overflowLines = roomLines.slice(maxFooterLines);
        const extraFooter = Math.max(0, footerLines.length - 2) * lineH;
        const planH = drawH - extraFooter;

        // Render storey to offscreen canvas (8 px je PDF-mm ≈ 200 dpi; Texte/Linien
        // in gleicher Größe wie bisher bei 4 px/mm)
        const pxPerMm = 8;
        const pixelRatio = 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(drawW * pxPerMm);
        canvas.height = Math.round(planH * pxPerMm);
        const ctx = canvas.getContext('2d');
        const logicalW = canvas.width / pixelRatio;
        const logicalH = canvas.height / pixelRatio;

        const bbox = getBoundingBox(storey);
        const worldWidth = bbox.maxX - bbox.minX;
        const worldHeight = bbox.maxY - bbox.minY;
        const zoom = Math.min(logicalW / worldWidth, logicalH / worldHeight);

        const vp = createViewport();
        vp.zoom = zoom;
        vp.offsetX = -(bbox.minX * zoom) + (logicalW - worldWidth * zoom) / 2;
        vp.offsetY = -(bbox.minY * zoom) + (logicalH - worldHeight * zoom) / 2;

        render(ctx, canvas, vp, storey, {
            selectedId: null, preview: null, snapPoint: null, dimensionLine: null,
            isPrinting: true, isExport: true, pixelRatio,
        });

        // Add canvas image to PDF
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', margin, margin + 15, drawW, planH);

        // Room summary footer (umbrochen, oberhalb der Seitenzahl-Zeile)
        if (footerLines.length > 0) {
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'normal');
            const startY = pageH - margin - (footerLines.length - 1) * lineH;
            footerLines.forEach((line, li) => pdf.text(line, margin, startY + li * lineH));
        }

        // Sehr lange Raumlisten auf einer Folgeseite fortsetzen
        if (overflowLines.length > 0) {
            pdf.addPage();
            pdf.setFontSize(11);
            pdf.setFont(undefined, 'bold');
            pdf.text(`${title} – ${storey.label || ''}: Raumliste (Fortsetzung)`, margin, margin + 5);
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'normal');
            let y = margin + 12;
            for (const line of overflowLines) {
                if (y > pageH - margin - 5) {
                    pdf.addPage();
                    y = margin + 5;
                }
                pdf.text(line, margin, y);
                y += lineH;
            }
        }
    }

    // Page numbers (erst am Ende, damit Folgeseiten mitgezählt werden)
    const pageCount = pdf.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
        pdf.setPage(p);
        pdf.setFontSize(7);
        pdf.setFont(undefined, 'normal');
        pdf.text(`Seite ${p} / ${pageCount}`, pageW - margin, pageH - margin, { align: 'right' });
    }

    pdf.save(`${safeFileBase(planName)}_Grundriss.pdf`);
};

// ─── Quantity List (Massenermittlung) ───────────────────────────

/**
 * Generate a quantity/measurement list for all storeys.
 * Returns structured data that can be displayed or exported.
 * Wandflächen: area_m2 = brutto (Länge × Höhe), netArea_m2 = abzüglich der
 * Tür-/Fensterflächen dieser Wand. Raumflächen: area_m2 = Netto-Fläche (ohne
 * Innenwand-Grundfläche), grossArea_m2 = bis zu den Wand-Referenzlinien.
 */
export const generateQuantityList = (storeys) => {
    const result = {
        storeys: [],
        totals: {
            wallLength_m: 0,
            wallArea_m2: 0,
            wallOpeningArea_m2: 0,
            wallAreaNet_m2: 0,
            floorArea_m2: 0,
            doorCount: 0,
            windowCount: 0,
            roomCount: 0,
        },
    };

    const num = (v, fallback = 0) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    (storeys || []).forEach(storey => {
        const storeyHeight = num(storey.height_mm);
        const walls = storey.walls || [];
        const openings = storey.openings || [];
        const storeyData = {
            label: storey.label,
            height_m: (storeyHeight / 1000).toFixed(2),
            walls: [],
            rooms: [],
            openings: [],
            furniture: [],
        };

        // Walls
        walls.forEach(wall => {
            const pt1 = getPoint(storey, wall.p1);
            const pt2 = getPoint(storey, wall.p2);
            if (!pt1 || !pt2) return;
            const len = dist(pt1, pt2);
            // Ältere Pläne ohne Wandhöhe: Geschosshöhe verwenden (sonst NaN in den Summen)
            const height = num(wall.height_mm) || storeyHeight;
            const wallArea = len * height;
            const openingArea = openings
                .filter(o => getOpeningWallId(o) === wall.id)
                .reduce((sum, o) => sum + Math.max(0, num(o.width_mm)) * Math.max(0, num(o.height_mm)), 0);
            const netArea = Math.max(0, wallArea - openingArea);
            const wallType = wall.type === 'outer' ? 'Außenwand' : (wall.type === 'inner_load' ? 'Innenwand (tragend)' : 'Innenwand (nichttragend)');
            storeyData.walls.push({
                type: wallType,
                length_m: (len / 1000).toFixed(2),
                thickness_cm: (num(wall.thickness_mm) / 10).toFixed(1),
                height_m: (height / 1000).toFixed(2),
                area_m2: (wallArea / 1000000).toFixed(2),
                openingArea_m2: (openingArea / 1000000).toFixed(2),
                netArea_m2: (netArea / 1000000).toFixed(2),
            });
            result.totals.wallLength_m += len / 1000;
            result.totals.wallArea_m2 += wallArea / 1000000;
            result.totals.wallOpeningArea_m2 += openingArea / 1000000;
            result.totals.wallAreaNet_m2 += netArea / 1000000;
        });

        // Rooms
        (storey.rooms || []).forEach(room => {
            const area = num(room.area_mm2);
            const gross = num(room.gross_area_mm2, area);
            storeyData.rooms.push({
                name: room.name,
                area_m2: (area / 1000000).toFixed(2),
                grossArea_m2: (gross / 1000000).toFixed(2),
            });
            result.totals.floorArea_m2 += area / 1000000;
            result.totals.roomCount++;
        });

        // Openings
        openings.forEach(opening => {
            const wall = walls.find(w => w.id === getOpeningWallId(opening));
            storeyData.openings.push({
                type: opening.type === 'door' ? 'Tür' : 'Fenster',
                width_cm: (num(opening.width_mm) / 10).toFixed(1),
                height_cm: (num(opening.height_mm) / 10).toFixed(1),
                sill_cm: opening.type === 'window' ? (num(opening.sill_mm) / 10).toFixed(1) : '–',
                wallType: wall ? (wall.type === 'outer' ? 'Außenwand' : 'Innenwand') : '–',
            });
            if (opening.type === 'door') result.totals.doorCount++;
            else result.totals.windowCount++;
        });

        // Furniture
        (storey.furniture || []).forEach(furn => {
            const catItem = getFurnitureItem(furn.catalog_id);
            storeyData.furniture.push({
                name: catItem?.name || furn.catalog_id || 'Möbel',
                width_cm: (num(furn.width_mm) / 10).toFixed(1),
                depth_cm: (num(furn.depth_mm) / 10).toFixed(1),
                height_cm: (num(furn.height_mm) / 10).toFixed(1),
            });
        });

        result.storeys.push(storeyData);
    });

    // Round totals
    result.totals.wallLength_m = parseFloat(result.totals.wallLength_m.toFixed(2));
    result.totals.wallArea_m2 = parseFloat(result.totals.wallArea_m2.toFixed(2));
    result.totals.wallOpeningArea_m2 = parseFloat(result.totals.wallOpeningArea_m2.toFixed(2));
    result.totals.wallAreaNet_m2 = parseFloat(result.totals.wallAreaNet_m2.toFixed(2));
    result.totals.floorArea_m2 = parseFloat(result.totals.floorArea_m2.toFixed(2));

    return result;
};

/**
 * Export quantity list as CSV.
 * Für deutsches Excel: Semikolon, Dezimalkomma, Einheit in der Kopfzeile,
 * Textfelder maskiert (keine Spaltenverschiebung, keine Formel-Ausführung).
 */
export const exportQuantityListCSV = (storeys, planName) => {
    const data = generateQuantityList(storeys);
    const lines = [];
    const sep = ';'; // German CSV standard
    const row = (...cells) => cells.join(sep);

    lines.push(row(csvText(`Massenermittlung: ${planTitle(planName)}`)));
    lines.push(row(csvText(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`)));
    lines.push('');

    // Totals
    lines.push('GESAMTÜBERSICHT');
    lines.push(row('Geschosse', data.storeys.length));
    lines.push(row('Räume gesamt', data.totals.roomCount));
    lines.push(row('Grundfläche gesamt (m²)', de(data.totals.floorArea_m2)));
    lines.push(row('Wandlänge gesamt (m)', de(data.totals.wallLength_m)));
    lines.push(row('Wandfläche brutto gesamt (m²)', de(data.totals.wallArea_m2)));
    lines.push(row('Öffnungsflächen in Wänden (m²)', de(data.totals.wallOpeningArea_m2)));
    lines.push(row('Wandfläche netto gesamt (m²)', de(data.totals.wallAreaNet_m2)));
    lines.push(row('Türen', data.totals.doorCount));
    lines.push(row('Fenster', data.totals.windowCount));
    lines.push('');

    data.storeys.forEach(storey => {
        lines.push(row(csvText(`GESCHOSS: ${storey.label} (Höhe: ${deText(storey.height_m)} m)`)));
        lines.push('');

        if (storey.rooms.length > 0) {
            lines.push(`Räume`);
            lines.push(row('Name', 'Fläche netto (m²)', 'Fläche inkl. Innenwände (m²)'));
            storey.rooms.forEach(r => lines.push(row(csvText(r.name), deText(r.area_m2), deText(r.grossArea_m2))));
            lines.push('');
        }

        if (storey.walls.length > 0) {
            lines.push(`Wände`);
            lines.push(row('Typ', 'Länge (m)', 'Dicke (cm)', 'Höhe (m)', 'Fläche brutto (m²)', 'Öffnungen (m²)', 'Fläche netto (m²)'));
            storey.walls.forEach(w => lines.push(row(
                csvText(w.type), deText(w.length_m), deText(w.thickness_cm), deText(w.height_m),
                deText(w.area_m2), deText(w.openingArea_m2), deText(w.netArea_m2),
            )));
            lines.push('');
        }

        if (storey.openings.length > 0) {
            lines.push(`Öffnungen`);
            lines.push(row('Typ', 'Breite (cm)', 'Höhe (cm)', 'Brüstung (cm)', 'In Wand'));
            storey.openings.forEach(o => lines.push(row(
                csvText(o.type), deText(o.width_cm), deText(o.height_cm), deText(o.sill_cm), csvText(o.wallType),
            )));
            lines.push('');
        }

        if (storey.furniture.length > 0) {
            lines.push(`Möbel`);
            lines.push(row('Name', 'Breite (cm)', 'Tiefe (cm)', 'Höhe (cm)'));
            storey.furniture.forEach(f => lines.push(row(
                csvText(f.name), deText(f.width_cm), deText(f.depth_cm), deText(f.height_cm),
            )));
            lines.push('');
        }
    });

    const csvContent = '﻿' + lines.join('\r\n'); // BOM for Excel UTF-8
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${safeFileBase(planName)}_Massenermittlung.csv`);
};

/**
 * Export quantity list as PDF.
 */
export const exportQuantityListPDF = (storeys, planName) => {
    const data = generateQuantityList(storeys);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 15;
    const pageBottom = 280;
    let y = margin;
    const title = planTitle(planName);

    // Seitenumbruch, wenn weniger als `needed` mm Platz bleiben
    const ensureSpace = (needed) => {
        if (y + needed > pageBottom) { pdf.addPage(); y = margin; }
    };

    // Title
    pdf.setFontSize(16);
    pdf.setFont(undefined, 'bold');
    pdf.text(`Massenermittlung: ${title}`, margin, y + 6);
    y += 12;
    pdf.setFontSize(8);
    pdf.setFont(undefined, 'normal');
    pdf.text(`Erstellt am ${new Date().toLocaleDateString('de-DE')}`, margin, y);
    y += 10;

    // Totals summary
    pdf.setFontSize(10);
    pdf.setFont(undefined, 'bold');
    pdf.text('Gesamtübersicht', margin, y);
    y += 6;
    pdf.setFontSize(8);
    pdf.setFont(undefined, 'normal');
    const totals = [
        ['Geschosse', data.storeys.length],
        ['Räume', data.totals.roomCount],
        ['Grundfläche', `${de(data.totals.floorArea_m2)} m²`],
        ['Wandlänge', `${de(data.totals.wallLength_m)} m`],
        ['Wandfläche brutto', `${de(data.totals.wallArea_m2)} m²`],
        ['Wandfläche netto', `${de(data.totals.wallAreaNet_m2)} m²`],
        ['Türen', data.totals.doorCount],
        ['Fenster', data.totals.windowCount],
    ];
    totals.forEach(([label, val]) => {
        pdf.text(label, margin, y);
        pdf.text(String(val), margin + 45, y);
        y += 4.5;
    });
    y += 6;

    // Abschnitt mit Überschrift + Kopfzeile; Umbruch vor dem Kopf, damit dieser
    // nicht allein am Seitenende steht
    const section = (heading, headers, colX, rows) => {
        if (rows.length === 0) return;
        ensureSpace(5 + 4 + 3.5 * Math.min(rows.length, 2));
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'bold');
        pdf.text(heading, margin, y);
        y += 5;
        const printHeader = () => {
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'bold');
            headers.forEach((h, i) => pdf.text(h, margin + colX[i], y));
            y += 4;
            pdf.setFont(undefined, 'normal');
        };
        printHeader();
        rows.forEach(cells => {
            if (y > pageBottom) { pdf.addPage(); y = margin; printHeader(); }
            cells.forEach((c, i) => pdf.text(String(c ?? ''), margin + colX[i], y));
            y += 3.5;
        });
        y += 4;
    };

    // Per-storey tables
    data.storeys.forEach(storey => {
        ensureSpace(20);

        pdf.setFontSize(11);
        pdf.setFont(undefined, 'bold');
        pdf.text(`${storey.label} (Höhe: ${deText(storey.height_m)} m)`, margin, y);
        y += 7;

        section('Räume', ['Name', 'Fläche netto', 'inkl. Innenwände'], [0, 60, 95],
            storey.rooms.map(r => [r.name, `${deText(r.area_m2)} m²`, `${deText(r.grossArea_m2)} m²`]));

        section('Wände', ['Typ', 'Länge', 'Dicke', 'Höhe', 'Brutto', 'Netto'], [0, 40, 62, 84, 106, 136],
            storey.walls.map(w => [w.type, `${deText(w.length_m)} m`, `${deText(w.thickness_cm)} cm`,
                `${deText(w.height_m)} m`, `${deText(w.area_m2)} m²`, `${deText(w.netArea_m2)} m²`]));

        section('Öffnungen', ['Typ', 'Breite', 'Höhe', 'Brüstung', 'In Wand'], [0, 34, 68, 102, 136],
            storey.openings.map(o => [o.type, `${deText(o.width_cm)} cm`, `${deText(o.height_cm)} cm`,
                o.sill_cm === '–' ? '–' : `${deText(o.sill_cm)} cm`, o.wallType]));

        section('Möbel', ['Name', 'Breite', 'Tiefe', 'Höhe'], [0, 70, 100, 130],
            storey.furniture.map(f => [f.name, `${deText(f.width_cm)} cm`, `${deText(f.depth_cm)} cm`, `${deText(f.height_cm)} cm`]));

        y += 4;
    });

    pdf.save(`${safeFileBase(planName)}_Massenermittlung.pdf`);
};

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Bereich, den der Export abbilden muss (mm, inkl. Rand): Punkte, Wandkörper,
 * Außenkontur, Dachüberstand, gedrehte Möbel, Decken, Anmerkungen und – wenn
 * Maßketten gezeichnet werden – deren Abstand oben/links.
 */
const getBoundingBox = (storey) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };

    (storey.points || []).forEach(p => add(p.x, p.y));
    (storey.walls || []).forEach(w => {
        const poly = getWallPolygon(w, storey);
        if (poly) poly.forEach(p => add(p.x, p.y));
    });
    (storey.outerBoundary || []).forEach(p => add(p.x, p.y));
    (storey.furniture || []).forEach(f => getFurnitureCorners(f).forEach(c => add(c.x, c.y)));
    (storey.slabs || []).forEach(s => (s.polygon || []).forEach(p => add(p.x, p.y)));
    (storey.annotations || []).forEach(a => {
        if (a.type === 'circle') {
            const r = Math.abs(Number(a.radius) || 0);
            add(a.cx - r, a.cy - r);
            add(a.cx + r, a.cy + r);
        } else if (a.type === 'text') {
            add(a.x, a.y);
        } else {
            (a.points || []).forEach(p => add(p.x, p.y));
        }
    });

    if (minX === Infinity) { minX = -5000; maxX = 5000; minY = -5000; maxY = 5000; }

    // Dachüberstand
    const overhang = storey.roof && (storey.roof.type === 'gable' || storey.roof.type === 'hip')
        ? Math.max(0, Number(storey.roof.overhang_mm) || 0) : 0;
    minX -= overhang; minY -= overhang; maxX += overhang; maxY += overhang;

    const padding = 500; // 50cm padding in mm
    // Außenmaßketten liegen 1,2 m oberhalb/links der Außenkante (plus Beschriftung)
    const dimPadding = storey.outerBoundary && storey.outerBoundary.length >= 3 ? 1500 : 0;
    // Textanmerkungen haben eine feste Bildschirmgröße – etwas Reserve rechts/unten
    const textPadding = (storey.annotations || []).some(a => a.type === 'text') ? 1500 : 0;

    return {
        minX: minX - padding - dimPadding,
        minY: minY - padding - dimPadding,
        maxX: maxX + padding + textPadding,
        maxY: maxY + padding + textPadding,
    };
};

const drawScaleBar = (ctx, vp, canvasWidth, pixelRatio = 1) => {
    // Draw a 1m scale bar in the bottom right
    const barWorldLen = 1000; // 1m
    const barScreenLen = barWorldLen * vp.zoom * pixelRatio;
    const x = canvasWidth - 50 - barScreenLen;
    const y = canvasWidth - 40;

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + barScreenLen, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + barScreenLen, y - 5);
    ctx.lineTo(x + barScreenLen, y + 5);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.font = `600 ${Math.round(canvasWidth / 80)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('1 m', x + barScreenLen / 2, y - 10);
};
