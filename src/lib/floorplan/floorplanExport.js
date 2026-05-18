// ─── Floor Plan Export Utilities ─────────────────────────────────
// PNG, PDF, and CSV quantity list export for floor plans.

import jsPDF from 'jspdf';
import { render, createViewport, worldToScreen } from './canvasRenderer';
import { mmToM, mm2ToM2 } from './constants';
import { dist, getPoint, polygonCentroid, getWallPolygon } from './geometryKernel';
import { getFurnitureItem } from './furnitureCatalog';

// ─── PNG Export ─────────────────────────────────────────────────

/**
 * Export a storey as PNG (high-res offscreen canvas).
 * @param {Object} storey - Storey data
 * @param {string} planName - Name of the floor plan
 * @param {number} [resolution=3000] - Canvas width in pixels
 * @returns {Promise<Blob>} - PNG blob
 */
export const exportToPNG = async (storey, planName, resolution = 3000) => {
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');

    // Calculate bounding box of all points
    const bbox = getBoundingBox(storey);
    const padding = 500; // 50cm padding in mm

    const vp = createViewport();
    const worldWidth = (bbox.maxX - bbox.minX + padding * 2);
    const worldHeight = (bbox.maxY - bbox.minY + padding * 2);
    const zoom = Math.min(resolution / worldWidth, resolution / worldHeight);
    vp.zoom = zoom;
    vp.offsetX = -((bbox.minX - padding) * zoom);
    vp.offsetY = -((bbox.minY - padding) * zoom);

    render(ctx, canvas, vp, storey, { selectedId: null, preview: null, snapPoint: null, dimensionLine: null });

    // Add title
    ctx.fillStyle = '#1e293b';
    ctx.font = `bold ${Math.round(resolution / 50)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${planName} – ${storey.label}`, 30, 50);

    // Add scale bar
    drawScaleBar(ctx, vp, resolution);

    return new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png', 1.0);
    });
};

/**
 * Download blob as file.
 */
export const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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

    for (let i = 0; i < storeys.length; i++) {
        if (i > 0) pdf.addPage();
        const storey = storeys[i];

        // Header
        pdf.setFontSize(14);
        pdf.setFont(undefined, 'bold');
        pdf.text(`${planName} – ${storey.label}`, margin, margin + 5);
        pdf.setFontSize(8);
        pdf.setFont(undefined, 'normal');
        pdf.text(`Erstellt am ${new Date().toLocaleDateString('de-DE')}`, margin, margin + 11);

        // Render storey to offscreen canvas
        const canvas = document.createElement('canvas');
        const pxPerMm = 4; // 4 pixels per pdf mm
        canvas.width = drawW * pxPerMm;
        canvas.height = drawH * pxPerMm;
        const ctx = canvas.getContext('2d');

        const bbox = getBoundingBox(storey);
        const padding = 500;
        const worldWidth = (bbox.maxX - bbox.minX + padding * 2);
        const worldHeight = (bbox.maxY - bbox.minY + padding * 2);
        const zoom = Math.min(canvas.width / worldWidth, canvas.height / worldHeight);

        const vp = createViewport();
        vp.zoom = zoom;
        vp.offsetX = -((bbox.minX - padding) * zoom) + (canvas.width - worldWidth * zoom) / 2;
        vp.offsetY = -((bbox.minY - padding) * zoom) + (canvas.height - worldHeight * zoom) / 2;

        render(ctx, canvas, vp, storey, { selectedId: null, preview: null, snapPoint: null, dimensionLine: null });

        // Add canvas image to PDF
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', margin, margin + 15, drawW, drawH);

        // Room summary footer
        const rooms = storey.rooms || [];
        if (rooms.length > 0) {
            const summaryY = pageH - margin;
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'normal');
            const roomTexts = rooms.map(r => `${r.name}: ${mm2ToM2(r.area_mm2)} m²`);
            pdf.text(roomTexts.join('  |  '), margin, summaryY);
        }

        // Page number
        pdf.setFontSize(7);
        pdf.text(`Seite ${i + 1} / ${storeys.length}`, pageW - margin, pageH - margin, { align: 'right' });
    }

    pdf.save(`${planName.replace(/\s+/g, '_')}_Grundriss.pdf`);
};

// ─── Quantity List (Massenermittlung) ───────────────────────────

/**
 * Generate a quantity/measurement list for all storeys.
 * Returns structured data that can be displayed or exported.
 */
export const generateQuantityList = (storeys) => {
    const result = {
        storeys: [],
        totals: {
            wallLength_m: 0,
            wallArea_m2: 0,
            floorArea_m2: 0,
            doorCount: 0,
            windowCount: 0,
            roomCount: 0,
        },
    };

    storeys.forEach(storey => {
        const storeyData = {
            label: storey.label,
            height_m: (storey.height_mm / 1000).toFixed(2),
            walls: [],
            rooms: [],
            openings: [],
            furniture: [],
        };

        // Walls
        storey.walls.forEach(wall => {
            const pt1 = getPoint(storey, wall.p1);
            const pt2 = getPoint(storey, wall.p2);
            if (!pt1 || !pt2) return;
            const len = dist(pt1, pt2);
            const wallArea = len * wall.height_mm;
            const wallType = wall.type === 'outer' ? 'Außenwand' : (wall.type === 'inner_load' ? 'Innenwand (tragend)' : 'Innenwand (nichttragend)');
            storeyData.walls.push({
                type: wallType,
                length_m: (len / 1000).toFixed(2),
                thickness_cm: (wall.thickness_mm / 10).toFixed(1),
                height_m: (wall.height_mm / 1000).toFixed(2),
                area_m2: (wallArea / 1000000).toFixed(2),
            });
            result.totals.wallLength_m += len / 1000;
            result.totals.wallArea_m2 += wallArea / 1000000;
        });

        // Rooms
        (storey.rooms || []).forEach(room => {
            storeyData.rooms.push({
                name: room.name,
                area_m2: (room.area_mm2 / 1000000).toFixed(2),
            });
            result.totals.floorArea_m2 += room.area_mm2 / 1000000;
            result.totals.roomCount++;
        });

        // Openings
        storey.openings.forEach(opening => {
            const wall = storey.walls.find(w => w.id === opening.wall_id);
            storeyData.openings.push({
                type: opening.type === 'door' ? 'Tür' : 'Fenster',
                width_cm: (opening.width_mm / 10).toFixed(1),
                height_cm: (opening.height_mm / 10).toFixed(1),
                sill_cm: opening.type === 'window' ? (opening.sill_mm / 10).toFixed(1) : '–',
                wallType: wall ? (wall.type === 'outer' ? 'Außenwand' : 'Innenwand') : '–',
            });
            if (opening.type === 'door') result.totals.doorCount++;
            else result.totals.windowCount++;
        });

        // Furniture
        storey.furniture.forEach(furn => {
            const catItem = getFurnitureItem(furn.catalog_id);
            storeyData.furniture.push({
                name: catItem?.name || furn.catalog_id,
                width_cm: (furn.width_mm / 10).toFixed(1),
                depth_cm: (furn.depth_mm / 10).toFixed(1),
                height_cm: (furn.height_mm / 10).toFixed(1),
            });
        });

        result.storeys.push(storeyData);
    });

    // Round totals
    result.totals.wallLength_m = parseFloat(result.totals.wallLength_m.toFixed(2));
    result.totals.wallArea_m2 = parseFloat(result.totals.wallArea_m2.toFixed(2));
    result.totals.floorArea_m2 = parseFloat(result.totals.floorArea_m2.toFixed(2));

    return result;
};

/**
 * Export quantity list as CSV.
 */
export const exportQuantityListCSV = (storeys, planName) => {
    const data = generateQuantityList(storeys);
    const lines = [];
    const sep = ';'; // German CSV standard

    lines.push(`Massenermittlung: ${planName}`);
    lines.push(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`);
    lines.push('');

    // Totals
    lines.push('GESAMTÜBERSICHT');
    lines.push(`Geschosse${sep}${data.storeys.length}`);
    lines.push(`Räume gesamt${sep}${data.totals.roomCount}`);
    lines.push(`Grundfläche gesamt${sep}${data.totals.floorArea_m2} m²`);
    lines.push(`Wandlänge gesamt${sep}${data.totals.wallLength_m} m`);
    lines.push(`Wandfläche gesamt${sep}${data.totals.wallArea_m2} m²`);
    lines.push(`Türen${sep}${data.totals.doorCount}`);
    lines.push(`Fenster${sep}${data.totals.windowCount}`);
    lines.push('');

    data.storeys.forEach(storey => {
        lines.push(`GESCHOSS: ${storey.label} (Höhe: ${storey.height_m} m)`);
        lines.push('');

        if (storey.rooms.length > 0) {
            lines.push(`Räume`);
            lines.push(`Name${sep}Fläche (m²)`);
            storey.rooms.forEach(r => lines.push(`${r.name}${sep}${r.area_m2}`));
            lines.push('');
        }

        if (storey.walls.length > 0) {
            lines.push(`Wände`);
            lines.push(`Typ${sep}Länge (m)${sep}Dicke (cm)${sep}Höhe (m)${sep}Fläche (m²)`);
            storey.walls.forEach(w => lines.push(`${w.type}${sep}${w.length_m}${sep}${w.thickness_cm}${sep}${w.height_m}${sep}${w.area_m2}`));
            lines.push('');
        }

        if (storey.openings.length > 0) {
            lines.push(`Öffnungen`);
            lines.push(`Typ${sep}Breite (cm)${sep}Höhe (cm)${sep}Brüstung (cm)${sep}In Wand`);
            storey.openings.forEach(o => lines.push(`${o.type}${sep}${o.width_cm}${sep}${o.height_cm}${sep}${o.sill_cm}${sep}${o.wallType}`));
            lines.push('');
        }

        if (storey.furniture.length > 0) {
            lines.push(`Möbel`);
            lines.push(`Name${sep}Breite (cm)${sep}Tiefe (cm)${sep}Höhe (cm)`);
            storey.furniture.forEach(f => lines.push(`${f.name}${sep}${f.width_cm}${sep}${f.depth_cm}${sep}${f.height_cm}`));
            lines.push('');
        }
    });

    const csvContent = '\uFEFF' + lines.join('\r\n'); // BOM for Excel UTF-8
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${planName.replace(/\s+/g, '_')}_Massenermittlung.csv`);
};

/**
 * Export quantity list as PDF.
 */
export const exportQuantityListPDF = (storeys, planName) => {
    const data = generateQuantityList(storeys);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 15;
    const pageW = 210;
    let y = margin;

    // Title
    pdf.setFontSize(16);
    pdf.setFont(undefined, 'bold');
    pdf.text(`Massenermittlung: ${planName}`, margin, y + 6);
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
        ['Grundfläche', `${data.totals.floorArea_m2} m²`],
        ['Wandlänge', `${data.totals.wallLength_m} m`],
        ['Wandfläche', `${data.totals.wallArea_m2} m²`],
        ['Türen', data.totals.doorCount],
        ['Fenster', data.totals.windowCount],
    ];
    totals.forEach(([label, val]) => {
        pdf.text(label, margin, y);
        pdf.text(String(val), margin + 45, y);
        y += 4.5;
    });
    y += 6;

    // Per-storey tables
    data.storeys.forEach(storey => {
        if (y > 260) { pdf.addPage(); y = margin; }

        pdf.setFontSize(11);
        pdf.setFont(undefined, 'bold');
        pdf.text(`${storey.label} (Höhe: ${storey.height_m} m)`, margin, y);
        y += 7;

        // Rooms table
        if (storey.rooms.length > 0) {
            pdf.setFontSize(9);
            pdf.setFont(undefined, 'bold');
            pdf.text('Räume', margin, y);
            y += 5;
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'bold');
            pdf.text('Name', margin, y);
            pdf.text('Fläche', margin + 60, y);
            y += 4;
            pdf.setFont(undefined, 'normal');
            storey.rooms.forEach(r => {
                if (y > 280) { pdf.addPage(); y = margin; }
                pdf.text(r.name, margin, y);
                pdf.text(`${r.area_m2} m²`, margin + 60, y);
                y += 3.5;
            });
            y += 4;
        }

        // Walls
        if (storey.walls.length > 0) {
            pdf.setFontSize(9);
            pdf.setFont(undefined, 'bold');
            pdf.text('Wände', margin, y);
            y += 5;
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'bold');
            ['Typ', 'Länge', 'Dicke', 'Höhe', 'Fläche'].forEach((h, i) => {
                pdf.text(h, margin + i * 34, y);
            });
            y += 4;
            pdf.setFont(undefined, 'normal');
            storey.walls.forEach(w => {
                if (y > 280) { pdf.addPage(); y = margin; }
                pdf.text(w.type, margin, y);
                pdf.text(`${w.length_m} m`, margin + 34, y);
                pdf.text(`${w.thickness_cm} cm`, margin + 68, y);
                pdf.text(`${w.height_m} m`, margin + 102, y);
                pdf.text(`${w.area_m2} m²`, margin + 136, y);
                y += 3.5;
            });
            y += 4;
        }

        // Openings
        if (storey.openings.length > 0) {
            pdf.setFontSize(9);
            pdf.setFont(undefined, 'bold');
            pdf.text('Öffnungen', margin, y);
            y += 5;
            pdf.setFontSize(7);
            pdf.setFont(undefined, 'bold');
            ['Typ', 'Breite', 'Höhe', 'Brüstung', 'In Wand'].forEach((h, i) => {
                pdf.text(h, margin + i * 34, y);
            });
            y += 4;
            pdf.setFont(undefined, 'normal');
            storey.openings.forEach(o => {
                if (y > 280) { pdf.addPage(); y = margin; }
                pdf.text(o.type, margin, y);
                pdf.text(`${o.width_cm} cm`, margin + 34, y);
                pdf.text(`${o.height_cm} cm`, margin + 68, y);
                pdf.text(o.sill_cm === '–' ? '–' : `${o.sill_cm} cm`, margin + 102, y);
                pdf.text(o.wallType, margin + 136, y);
                y += 3.5;
            });
            y += 4;
        }

        y += 4;
    });

    pdf.save(`${planName.replace(/\s+/g, '_')}_Massenermittlung.pdf`);
};

// ─── Helpers ────────────────────────────────────────────────────

const getBoundingBox = (storey) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    storey.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });
    storey.furniture.forEach(f => {
        if (f.x < minX) minX = f.x;
        if (f.y < minY) minY = f.y;
        if (f.x + f.width_mm > maxX) maxX = f.x + f.width_mm;
        if (f.y + f.depth_mm > maxY) maxY = f.y + f.depth_mm;
    });
    if (minX === Infinity) { minX = -5000; maxX = 5000; minY = -5000; maxY = 5000; }
    return { minX, minY, maxX, maxY };
};

const drawScaleBar = (ctx, vp, canvasWidth) => {
    // Draw a 1m scale bar in the bottom right
    const barWorldLen = 1000; // 1m
    const barScreenLen = barWorldLen * vp.zoom;
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
