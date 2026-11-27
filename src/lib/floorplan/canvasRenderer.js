// ─── Canvas Renderer ────────────────────────────────────────────────
// 2D rendering engine for the floor plan editor.
// Renders grid, walls as merged surfaces, openings, 2D furniture, rooms, labels.

import {
    GRID_COLOR, GRID_COLOR_MAJOR, DOOR_ARC_COLOR, WINDOW_STROKE_COLOR, ROOM_LABEL_COLOR,
    FURNITURE_FILL, FURNITURE_STROKE, SELECTION_COLOR, SNAP_INDICATOR_COLOR,
    WALL_THICKNESS, mmToM, mm2ToM2,
} from './constants.js';
import {
    getPoint, getWallPolygon, getWallFaceOffsets, dist, polygonInteriorPoint,
    buildWallChains, getOpeningWallId, getOpeningCenterMm, getFurnitureCorners,
    ensureCW, offsetPolygon,
} from './geometryKernel.js';
import { getFurnitureItem } from './furnitureCatalog.js';

// ─── Viewport ───────────────────────────────────────────────────

export const createViewport = () => ({
    offsetX: 0,
    offsetY: 0,
    zoom: 0.15,
    minZoom: 0.02,
    maxZoom: 2.0,
});

export const worldToScreen = (vp, wx, wy) => ({
    x: wx * vp.zoom + vp.offsetX,
    y: wy * vp.zoom + vp.offsetY,
});

export const screenToWorld = (vp, sx, sy) => ({
    x: (sx - vp.offsetX) / vp.zoom,
    y: (sy - vp.offsetY) / vp.zoom,
});

export const zoomAtPoint = (vp, sx, sy, delta) => {
    // Schrittweite aus der Stärke des Rad-/Pinch-Ereignisses (Trackpads liefern
    // viele kleine Deltas), je Ereignis auf ±10 % begrenzt; delta 0 zoomt nicht.
    if (!Number.isFinite(delta) || delta === 0) return;
    const factor = Math.min(1 / 0.9, Math.max(0.9, Math.exp(-delta * 0.02)));
    const newZoom = Math.max(vp.minZoom, Math.min(vp.maxZoom, vp.zoom * factor));
    const ratio = newZoom / vp.zoom;
    vp.offsetX = sx - (sx - vp.offsetX) * ratio;
    vp.offsetY = sy - (sy - vp.offsetY) * ratio;
    vp.zoom = newZoom;
};

/** Zoom viewport to fit all elements of the storey within the canvas */
export const zoomToFit = (vp, storey, canvasWidth, canvasHeight) => {
    if (!storey || !storey.points || storey.points.length === 0) return;

    // Calculate bounding box of all points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of storey.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
    }
    // Außenkante der Außenwände (Wanddicke liegt außerhalb der Punkte)
    for (const p of storey.outerBoundary || []) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    // Include furniture (Ursprung oben links, gedreht um diesen Punkt)
    if (storey.furniture) {
        for (const f of storey.furniture) {
            for (const c of getFurnitureCorners(f)) {
                if (c.x < minX) minX = c.x;
                if (c.y < minY) minY = c.y;
                if (c.x > maxX) maxX = c.x;
                if (c.y > maxY) maxY = c.y;
            }
        }
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW < 1 || contentH < 1) return;

    // Add padding (10% on each side)
    const padding = 0.1;
    const availW = canvasWidth * (1 - 2 * padding);
    const availH = canvasHeight * (1 - 2 * padding);

    const zoom = Math.min(availW / contentW, availH / contentH);
    const clampedZoom = Math.max(vp.minZoom, Math.min(vp.maxZoom, zoom));

    // Center the content
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    vp.zoom = clampedZoom;
    vp.offsetX = canvasWidth / 2 - centerX * clampedZoom;
    vp.offsetY = canvasHeight / 2 - centerY * clampedZoom;
};

// ─── Helpers ────────────────────────────────────────────────────

// |sin| des Schnittwinkels, unterhalb dessen zwei Linien als parallel gelten
const PARALLEL_SIN = 1e-3;
// Gehrungs-/Verlängerungspunkt höchstens 3 × Wanddicke von der Ecke entfernt,
// sonst Fase – verhindert Spitzen bei fast parallelen Wänden
const MITER_LIMIT_FACTOR = 3;

/**
 * Compute intersection of two infinite lines.
 * Line 1 goes through a1→a2, Line 2 goes through b1→b2.
 * Returns intersection point or null if parallel.
 */
const lineLineIntersect = (a1, a2, b1, b2) => {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const len1 = Math.hypot(d1x, d1y), len2 = Math.hypot(d2x, d2y);
    if (len1 < 1e-9 || len2 < 1e-9) return null;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) / (len1 * len2) < PARALLEL_SIN) return null;
    const dx = b1.x - a1.x, dy = b1.y - a1.y;
    const t = (dx * d2y - dy * d2x) / cross;
    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
};

/**
 * Gehrungspunkt zweier Wandkanten (je naher und ferner Eckpunkt) an einer Ecke.
 * Liefert null, wenn die Kanten parallel sind oder der Schnittpunkt weiter als
 * maxDist von der Ecke entfernt läge – dann ist eine Fase zu zeichnen.
 */
const computeMiterPoint = (near1, far1, near2, far2, corner, maxDist) => {
    const p = lineLineIntersect(far1, near1, far2, near2);
    if (!p) return null;
    if (corner && maxDist > 0 && dist(p, corner) > maxDist) return null;
    return p;
};

/**
 * ctx.roundRect mit Rückfallebene für ältere Browser/WebViews (Safari < 16,
 * Firefox < 112, ältere Android-WebViews) und auf zulässige Werte geklemmten
 * Radien (negative Radien würden einen RangeError werfen).
 */
const roundRectPath = (ctx, x, y, w, h, radii = 0) => {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const max = Math.min(w, h) / 2;
    const clamp = (r) => Math.max(0, Math.min(max, Number(r) || 0));
    const list = Array.isArray(radii) ? radii : [radii];
    let tl, tr, br, bl;
    if (list.length <= 1) { tl = tr = br = bl = clamp(list[0]); }
    else if (list.length === 2) { tl = br = clamp(list[0]); tr = bl = clamp(list[1]); }
    else if (list.length === 3) { tl = clamp(list[0]); tr = bl = clamp(list[1]); br = clamp(list[2]); }
    else { tl = clamp(list[0]); tr = clamp(list[1]); br = clamp(list[2]); bl = clamp(list[3]); }

    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, [tl, tr, br, bl]);
        return;
    }
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.arcTo(x + w, y, x + w, y + h, tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.arcTo(x + w, y + h, x, y + h, br);
    ctx.lineTo(x + bl, y + h);
    ctx.arcTo(x, y + h, x, y, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + w, y, tl);
    ctx.closePath();
};

/**
 * Flüchtige Render-Daten (Bildschirm-Hitboxen) nicht aufzählbar am Objekt
 * ablegen: der Editor kann sie lesen, JSON.stringify (Speichern, Undo-Kopien)
 * übernimmt sie aber nicht.
 */
const setTransient = (obj, key, value) => {
    try {
        Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: false });
    } catch {
        // eingefrorenes Objekt – Hitbox entfällt
    }
};

// Warnungen je Element nur einmal ausgeben (render läuft bei jeder Mausbewegung)
const _warnedKeys = new Set();
const warnOnce = (key, ...args) => {
    if (_warnedKeys.has(key)) return;
    if (_warnedKeys.size > 1000) _warnedKeys.clear();
    _warnedKeys.add(key);
    console.warn(...args);
};

/** Ein einzelnes Element zeichnen; ein Fehler darin bricht nicht den ganzen Frame ab. */
const safeDraw = (key, fn) => {
    try {
        fn();
    } catch (err) {
        warnOnce(`err:${key}`, `[Grundriss] Element ${key} konnte nicht gezeichnet werden:`, err);
    }
};

/** Fehlende Listen eines Geschosses (Altdaten, Import) durch leere ersetzen. */
const withStoreyDefaults = (storey) => {
    const s = storey || {};
    if (Array.isArray(s.points) && Array.isArray(s.walls) && Array.isArray(s.openings)
        && Array.isArray(s.furniture) && Array.isArray(s.rooms)) return s;
    return {
        ...s,
        points: Array.isArray(s.points) ? s.points : [],
        walls: Array.isArray(s.walls) ? s.walls : [],
        openings: Array.isArray(s.openings) ? s.openings : [],
        furniture: Array.isArray(s.furniture) ? s.furniture : [],
        rooms: Array.isArray(s.rooms) ? s.rooms : [],
    };
};

/** Rahmen um ein (ggf. gedrehtes) Möbelstück zeichnen (Hover/Auswahl/Rahmenauswahl). */
const drawFurnitureHighlight = (ctx, vp, furn, fill, stroke) => {
    const sp = getFurnitureCorners(furn).map(c => worldToScreen(vp, c.x, c.y));
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sp[0].x, sp[0].y);
    for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
};

/** Polygon (Weltkoordinaten) als Pfad anlegen. */
const tracePolygon = (ctx, vp, pts) => {
    const sp = pts.map(p => worldToScreen(vp, p.x, p.y));
    ctx.moveTo(sp[0].x, sp[0].y);
    for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
    ctx.closePath();
};

// ─── Main Render ────────────────────────────────────────────────

/**
 * Zeichnet ein Geschoss.
 * Optionale Felder in `state`:
 *  - pixelRatio: Verhältnis Canvas-Pixel zu Bildschirm-(CSS-)Pixel, z. B.
 *    window.devicePixelRatio für scharfe Darstellung auf HiDPI-Displays oder ein
 *    Faktor für Exporte. Viewport, Schriften und Linien bleiben in CSS-Pixeln.
 *  - isPrinting: ohne Raster (Druck/Export).
 *  - isExport: keine Bildschirm-Hitboxen schreiben (Export-Viewport).
 */
export const render = (ctx, canvas, vp, storey, state) => {
    const pixelRatio = Number(state.pixelRatio) > 0 ? Number(state.pixelRatio) : 1;
    const view = { w: canvas.width / pixelRatio, h: canvas.height / pixelRatio };

    ctx.save();
    try {
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        ctx.clearRect(0, 0, view.w, view.h);
        renderFrame(ctx, vp, withStoreyDefaults(storey), state, view);
    } finally {
        // Zustand auch bei einem Fehler mitten im Frame zurücksetzen
        ctx.restore();
    }
};

const renderFrame = (ctx, vp, storey, state, view) => {
    const { w, h } = view;
    const recordHitBoxes = !state.isExport;
    const frame = { outerContours: [] };

    // Build set of selected IDs for fast lookup
    const selectedSet = new Set();
    if (state.selectedId) selectedSet.add(state.selectedId);
    if (state.selectedIds) {
        for (const item of state.selectedIds) selectedSet.add(item.id);
    }

    // Background (auch für Öffnungs-Aussparungen wiederverwendet, damit eine
    // hinterlegte Vorlage dort sichtbar bleibt)
    const paintBackground = () => {
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, w, h);

        // Background image (under grid)
        if (state.bgImage && state.bgImageObj) {
            const bg = state.bgImage;
            const img = state.bgImageObj;
            const opacity = bg.opacity !== undefined ? bg.opacity : 0.35;
            const pxPerMm = bg.scale || 1; // image pixels per mm
            // Each image pixel = 1/pxPerMm mm in world space
            // Image world size in mm:
            const imgWorldW = img.width / pxPerMm;
            const imgWorldH = img.height / pxPerMm;
            const ox = bg.offsetX || 0;
            const oy = bg.offsetY || 0;
            const screenTopLeft = worldToScreen(vp, ox, oy);
            const screenBotRight = worldToScreen(vp, ox + imgWorldW, oy + imgWorldH);
            ctx.globalAlpha = opacity;
            ctx.drawImage(img, screenTopLeft.x, screenTopLeft.y,
                screenBotRight.x - screenTopLeft.x, screenBotRight.y - screenTopLeft.y);
            ctx.globalAlpha = 1.0;
        }
    };
    paintBackground();

    // Grid (skip when background image is active or printing)
    if (!state.bgImage && !state.isPrinting) {
        drawGrid(ctx, vp, w, h);
    }

    // ── Walls as merged closed surfaces ──
    drawWallsMerged(ctx, vp, storey, state, selectedSet, frame);

    // Openings (vor den Hervorhebungen, damit die Aussparung diese nicht überdeckt)
    for (const opening of storey.openings) {
        safeDraw(`opening:${opening.id}`, () => drawOpening(ctx, vp, opening, storey, selectedSet.has(opening.id), paintBackground));
    }

    // Hover highlight for elements under cursor
    if (state.hoverId && !selectedSet.has(state.hoverId)) {
        // Check if hovered element is a wall
        const hoveredWall = storey.walls.find(w => w.id === state.hoverId);
        if (hoveredWall) {
            const poly = getWallPolygon(hoveredWall, storey);
            if (poly && poly.length >= 4) {
                const screenPoly = poly.map(p => worldToScreen(vp, p.x, p.y));
                ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
                ctx.strokeStyle = 'rgba(14, 165, 233, 0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(screenPoly[0].x, screenPoly[0].y);
                for (let i = 1; i < screenPoly.length; i++) ctx.lineTo(screenPoly[i].x, screenPoly[i].y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        }
        // Check if hovered element is furniture
        const hoveredFurn = storey.furniture.find(f => f.id === state.hoverId);
        if (hoveredFurn) {
            drawFurnitureHighlight(ctx, vp, hoveredFurn, 'rgba(14, 165, 233, 0.12)', 'rgba(14, 165, 233, 0.5)');
        }
    }

    // Selection highlight overlay for all selected elements
    if (selectedSet.size > 0) {
        for (const wall of storey.walls) {
            if (!selectedSet.has(wall.id)) continue;
            const poly = getWallPolygon(wall, storey);
            if (poly && poly.length >= 4) {
                const sp = poly.map(p => worldToScreen(vp, p.x, p.y));
                ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
                ctx.strokeStyle = 'rgba(14, 165, 233, 0.7)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sp[0].x, sp[0].y);
                for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        }
        for (const furn of storey.furniture) {
            if (!selectedSet.has(furn.id)) continue;
            drawFurnitureHighlight(ctx, vp, furn, 'rgba(14, 165, 233, 0.15)', 'rgba(14, 165, 233, 0.6)');
        }
    }

    // Room fills (subtle background to show detected areas)
    // Bewusst erst ab zwei Räumen: bei nur einem Raum wäre die ganze Grundfläche
    // eingefärbt, ohne dass die Farbe etwas unterscheidet.
    if (storey.rooms.length > 1) {
        const roomColors = ['rgba(219,234,254,0.3)', 'rgba(220,252,231,0.3)', 'rgba(254,249,195,0.3)', 'rgba(252,231,243,0.3)'];
        for (let i = 0; i < storey.rooms.length; i++) {
            const room = storey.rooms[i];
            if (!room.polygon || room.polygon.length < 3) continue;
            const screenPoly = room.polygon.map(p => worldToScreen(vp, p.x, p.y));
            ctx.fillStyle = roomColors[i % roomColors.length];
            ctx.beginPath();
            ctx.moveTo(screenPoly[0].x, screenPoly[0].y);
            for (let j = 1; j < screenPoly.length; j++) ctx.lineTo(screenPoly[j].x, screenPoly[j].y);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Room labels
    for (const room of storey.rooms) {
        const isRoomSelected = selectedSet.has(room.id) || state.selectedRoomId === room.id;
        safeDraw(`room:${room.id}`, () => drawRoomLabel(ctx, vp, room, isRoomSelected, recordHitBoxes));
    }

    // Slabs
    for (const slab of (storey.slabs || [])) {
        safeDraw(`slab:${slab.id}`, () => drawSlab(ctx, vp, slab, selectedSet.has(slab.id)));
    }

    // Roof overlay (2D)
    if (storey.roof && storey.outerBoundary) {
        safeDraw('roof', () => drawRoof2D(ctx, vp, storey));
    }

    // Furniture (2D top-down)
    for (const furn of storey.furniture) {
        safeDraw(`furniture:${furn.id}`, () => drawFurniture2D(ctx, vp, furn, selectedSet.has(furn.id)));
    }

    // Draw wall dimensions (lichte Maße: inner surface to inner surface)
    // Only for inner walls — outer walls use the outer dimension chains below
    if (state.showDimensions !== false) {
        // Wie weit ragt der Körper einer an diesem Knoten (annähernd senkrecht)
        // anschließenden Wand in die Wandachse hinein? Gemessen am tatsächlichen
        // Wandpolygon, also abhängig davon, auf welcher Seite die Dicke liegt.
        const clearOffsetAt = (wall, ptId, p1, ux, uy, wallLen, atStart) => {
            let offset = 0;
            for (const w2 of storey.walls) {
                if (w2.id === wall.id) continue;
                const atW2P1 = w2.p1 === ptId;
                if (!atW2P1 && w2.p2 !== ptId) continue;
                const w2p1 = getPoint(storey, w2.p1);
                const w2p2 = getPoint(storey, w2.p2);
                if (!w2p1 || !w2p2) continue;
                const w2Len = dist(w2p1, w2p2);
                if (w2Len < 1) continue;
                const dot = Math.abs(ux * (w2p2.x - w2p1.x) + uy * (w2p2.y - w2p1.y)) / w2Len;
                if (dot >= 0.3) continue; // nur (annähernd) senkrechte Anschlüsse
                const poly = getWallPolygon(w2, storey);
                if (!poly) continue;
                // Eckpunkte des Nachbarn an diesem Knoten: [p1_left, p1_right] bzw. [p2_left, p2_right]
                const corners = atW2P1 ? [poly[0], poly[3]] : [poly[1], poly[2]];
                for (const c of corners) {
                    const t = (c.x - p1.x) * ux + (c.y - p1.y) * uy;
                    const into = atStart ? t : wallLen - t;
                    if (into > offset) offset = into;
                }
            }
            return Math.min(offset, wallLen);
        };

        for (const wall of storey.walls) {
            if (wall.type === 'outer') continue; // outer walls have their own dimension chains
            const p1 = getPoint(storey, wall.p1);
            const p2 = getPoint(storey, wall.p2);
            if (!p1 || !p2) continue;
            const wallLen = dist(p1, p2);
            if (wallLen < 200) continue;

            // Compute shortened dimension points (offset inward from corners)
            const dx = (p2.x - p1.x) / wallLen;
            const dy = (p2.y - p1.y) / wallLen;
            const offsetP1 = clearOffsetAt(wall, wall.p1, p1, dx, dy, wallLen, true);
            const offsetP2 = clearOffsetAt(wall, wall.p2, p1, dx, dy, wallLen, false);
            const dimP1 = { x: p1.x + dx * offsetP1, y: p1.y + dy * offsetP1 };
            const dimP2 = { x: p2.x - dx * offsetP2, y: p2.y - dy * offsetP2 };
            const dimLen = dist(dimP1, dimP2);
            if (dimLen < 100 || offsetP1 + offsetP2 >= wallLen) continue;

            const isSel = selectedSet.has(wall.id);
            drawWallDimension(ctx, vp, dimP1, dimP2, !isSel);
        }

        // Normgerechte Bemaßung: Außenmaßketten (DIN 1356)
        if (storey.outerBoundary && storey.outerBoundary.length >= 3) {
            safeDraw('dimensions', () => drawOuterDimensionChains(ctx, vp, storey, frame));
        }
    } // end showDimensions

    // Points as CAD handles (for ALL selected walls)
    for (const wall of storey.walls) {
        if (!selectedSet.has(wall.id)) continue;
        const p1 = getPoint(storey, wall.p1);
        const p2 = getPoint(storey, wall.p2);
        if (p1) drawCornerHandle(ctx, vp, p1, state.dragHandle === wall.p1);
        if (p2) drawCornerHandle(ctx, vp, p2, state.dragHandle === wall.p2);
        if (p1 && p2) {
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            drawMoveHandle(ctx, vp, mid, state.dragHandle === 'mid');
        }
    }


    // ── Annotations ──────────────────────────────────────────────
    if (storey.annotations && storey.annotations.length > 0) {
        for (const ann of storey.annotations) {
            const isAnnSel = selectedSet.has(ann.id);
            if (ann.type === 'polyline' && ann.points && ann.points.length >= 2) {
                ctx.strokeStyle = ann.color || '#ef4444';
                ctx.lineWidth = (ann.lineWidth || 2) * (isAnnSel ? 2 : 1);
                ctx.setLineDash([]);
                ctx.beginPath();
                const sp0 = worldToScreen(vp, ann.points[0].x, ann.points[0].y);
                ctx.moveTo(sp0.x, sp0.y);
                for (let i = 1; i < ann.points.length; i++) {
                    const sp = worldToScreen(vp, ann.points[i].x, ann.points[i].y);
                    ctx.lineTo(sp.x, sp.y);
                }
                ctx.stroke();
                if (isAnnSel) {
                    // Draw resize handles on each point
                    for (const pt of ann.points) {
                        const sh = worldToScreen(vp, pt.x, pt.y);
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#0ea5e9';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(sh.x, sh.y, 5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    }
                }
            } else if (ann.type === 'circle') {
                const sc = worldToScreen(vp, ann.cx, ann.cy);
                const edgePt = worldToScreen(vp, ann.cx + ann.radius, ann.cy);
                const screenRadius = edgePt.x - sc.x;
                ctx.strokeStyle = ann.color || '#ef4444';
                ctx.lineWidth = (ann.lineWidth || 2) * (isAnnSel ? 2 : 1);
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(sc.x, sc.y, Math.abs(screenRadius), 0, Math.PI * 2);
                ctx.stroke();
                if (isAnnSel) {
                    // Center handle
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#0ea5e9';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(sc.x, sc.y, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    // Radius resize handle (right edge)
                    const rhx = sc.x + Math.abs(screenRadius);
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#0ea5e9';
                    ctx.lineWidth = 2;
                    ctx.fillRect(rhx - 4, sc.y - 4, 8, 8);
                    ctx.strokeRect(rhx - 4, sc.y - 4, 8, 8);
                }
            } else if (ann.type === 'area' && ann.points && ann.points.length >= 3) {
                const screenPts = ann.points.map(p => worldToScreen(vp, p.x, p.y));
                // Transparente Füllung: Alpha nur an 6-stellige Hex-Farben anhängen
                ctx.fillStyle = ann.fillColor
                    || (/^#[0-9a-f]{6}$/i.test(ann.color || '') ? ann.color + '33' : 'rgba(239,68,68,0.2)');
                ctx.strokeStyle = ann.color || '#ef4444';
                ctx.lineWidth = (ann.lineWidth || 2) * (isAnnSel ? 2 : 1);
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(screenPts[0].x, screenPts[0].y);
                for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                if (isAnnSel) {
                    for (const pt of ann.points) {
                        const sh = worldToScreen(vp, pt.x, pt.y);
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#0ea5e9';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(sh.x, sh.y, 5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    }
                }
            } else if (ann.type === 'text') {
                const sc = worldToScreen(vp, ann.x, ann.y);
                const fontSize = Math.max(8, (ann.fontSize || 14));
                ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                const text = ann.text || '';
                const tw = ctx.measureText(text).width + 10;
                const th = fontSize + 8;
                // Background
                ctx.fillStyle = isAnnSel ? 'rgba(14,165,233,0.08)' : 'rgba(255,255,255,0.9)';
                ctx.strokeStyle = isAnnSel ? '#0ea5e9' : (ann.color || '#ef4444');
                ctx.lineWidth = isAnnSel ? 1.5 : 1;
                ctx.beginPath();
                roundRectPath(ctx, sc.x - 4, sc.y - 4, tw, th, 3);
                ctx.fill();
                ctx.stroke();
                // Text
                ctx.fillStyle = ann.color || '#ef4444';
                ctx.fillText(text, sc.x, sc.y);
                // Store hit box (flüchtig, wird nicht gespeichert; nicht im Export-Viewport)
                if (recordHitBoxes) setTransient(ann, '_hitBox', { sx: sc.x - 4, sy: sc.y - 4, sw: tw, sh: th });
            }
        }
    }

    // Calibration overlay
    if (state.calibPoints) {
        drawCalibration(ctx, vp, state.calibPoints);
    }

    // Tool overlays
    if (state.preview) {
        drawPreview(ctx, vp, state, storey, view);
    }

    // Snap indicator — enhanced with wall segment and measurements
    if (state.snapPoint) {
        const sp = worldToScreen(vp, state.snapPoint.x, state.snapPoint.y);

        // If snap is on a wall edge, show the wall segment and distances
        if (state.snapPoint.wallP1 && state.snapPoint.wallP2) {
            const wp1 = state.snapPoint.wallP1;
            const wp2 = state.snapPoint.wallP2;
            const swp1 = worldToScreen(vp, wp1.x, wp1.y);
            const swp2 = worldToScreen(vp, wp2.x, wp2.y);

            // Highlight the host wall segment
            ctx.strokeStyle = SNAP_INDICATOR_COLOR;
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.moveTo(swp1.x, swp1.y);
            ctx.lineTo(swp2.x, swp2.y);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // ── Compute adjusted measurement endpoints ──
            // Find inner walls connected ANYWHERE along the snap segment wp1→wp2.
            // For each inner wall, project its attachment point onto the segment
            // and find where the inner wall's inner face is.
            // Then measure from the nearest inner wall face on each side of the cursor.
            const wallDirX = wp2.x - wp1.x;
            const wallDirY = wp2.y - wp1.y;
            const wallLen = Math.sqrt(wallDirX * wallDirX + wallDirY * wallDirY) || 1;
            const udx = wallDirX / wallLen;
            const udy = wallDirY / wallLen;

            // Project snap point onto segment: t_snap ∈ [0, wallLen]
            const t_snap = (state.snapPoint.x - wp1.x) * udx + (state.snapPoint.y - wp1.y) * udy;

            // Collect all inner wall "barriers" along this segment.
            // Use the actual wall polygon to determine the extent along the segment,
            // since inner walls use ref_edge and thickness goes to ONE side only.
            const barriers = [];
            for (const iw of storey.walls) {
                if (iw.type === 'outer') continue;
                const iwP1 = getPoint(storey, iw.p1);
                const iwP2 = getPoint(storey, iw.p2);
                if (!iwP1 || !iwP2) continue;

                // Check if this inner wall is roughly perpendicular to our snap segment
                const iwDx = iwP2.x - iwP1.x, iwDy = iwP2.y - iwP1.y;
                const iwLen = Math.sqrt(iwDx * iwDx + iwDy * iwDy) || 1;
                const dot = Math.abs(wallDirX * iwDx + wallDirY * iwDy) / (wallLen * iwLen);
                if (dot > 0.3) continue; // not perpendicular enough

                // Check if either endpoint of this inner wall is on/near our segment
                let attached = false;
                for (const endPt of [iwP1, iwP2]) {
                    const t = (endPt.x - wp1.x) * udx + (endPt.y - wp1.y) * udy;
                    const projX = wp1.x + udx * t;
                    const projY = wp1.y + udy * t;
                    const perpDist = Math.sqrt((endPt.x - projX) ** 2 + (endPt.y - projY) ** 2);
                    if (perpDist < 50 && t > -10 && t < wallLen + 10) {
                        attached = true;
                        break;
                    }
                }
                if (!attached) continue;

                // Use actual wall polygon to find min/max t along snap segment
                const poly = getWallPolygon(iw, storey);
                if (!poly || poly.length < 4) continue;

                let tMin = Infinity, tMax = -Infinity;
                for (const corner of poly) {
                    const ct = (corner.x - wp1.x) * udx + (corner.y - wp1.y) * udy;
                    if (ct < tMin) tMin = ct;
                    if (ct > tMax) tMax = ct;
                }
                tMin = Math.max(0, tMin);
                tMax = Math.min(wallLen, tMax);
                if (tMax - tMin < 1) continue;

                barriers.push({ tMin, tMax });
            }

            // Find nearest barrier to the LEFT of snap point (lower t)
            // The barrier's RIGHT edge (tMax) must be < t_snap
            let leftBarrier = null;
            let leftBarrierDist = Infinity;
            for (const b of barriers) {
                if (b.tMax < t_snap && (t_snap - b.tMax) < leftBarrierDist) {
                    leftBarrierDist = t_snap - b.tMax;
                    leftBarrier = b;
                }
            }

            // Find nearest barrier to the RIGHT of snap point (higher t)
            // The barrier's LEFT edge (tMin) must be > t_snap
            let rightBarrier = null;
            let rightBarrierDist = Infinity;
            for (const b of barriers) {
                if (b.tMin > t_snap && (b.tMin - t_snap) < rightBarrierDist) {
                    rightBarrierDist = b.tMin - t_snap;
                    rightBarrier = b;
                }
            }

            // Compute adjusted measurement endpoints and distances
            const measP1 = leftBarrier
                ? { x: wp1.x + udx * leftBarrier.tMax, y: wp1.y + udy * leftBarrier.tMax }
                : wp1;
            const measP2 = rightBarrier
                ? { x: wp1.x + udx * rightBarrier.tMin, y: wp1.y + udy * rightBarrier.tMin }
                : wp2;

            const distToP1 = dist(state.snapPoint, measP1);
            const distToP2 = dist(state.snapPoint, measP2);

            const sMeasP1 = worldToScreen(vp, measP1.x, measP1.y);
            const sMeasP2 = worldToScreen(vp, measP2.x, measP2.y);

            // Draw measurement to left side — using adjusted distance
            if (distToP1 > 50) {
                const label1 = mmToM(distToP1) + ' m';
                const mid1x = (sp.x + sMeasP1.x) / 2;
                const mid1y = (sp.y + sMeasP1.y) / 2;
                // Perpendicular offset
                const dx1 = sMeasP1.x - sp.x, dy1 = sMeasP1.y - sp.y;
                const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
                const nx1 = -dy1 / len1, ny1 = dx1 / len1;
                const lx1 = mid1x + nx1 * 14, ly1 = mid1y + ny1 * 14;
                ctx.font = '10px Inter, sans-serif';
                const m1 = ctx.measureText(label1);
                ctx.fillStyle = 'rgba(249,115,22,0.9)';
                ctx.fillRect(lx1 - m1.width / 2 - 3, ly1 - 7, m1.width + 6, 14);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label1, lx1, ly1);
            }

            // Draw measurement to right side — using adjusted distance
            if (distToP2 > 50) {
                const label2 = mmToM(distToP2) + ' m';
                const mid2x = (sp.x + sMeasP2.x) / 2;
                const mid2y = (sp.y + sMeasP2.y) / 2;
                const dx2 = sMeasP2.x - sp.x, dy2 = sMeasP2.y - sp.y;
                const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
                const nx2 = -dy2 / len2, ny2 = dx2 / len2;
                const lx2 = mid2x + nx2 * 14, ly2 = mid2y + ny2 * 14;
                ctx.font = '10px Inter, sans-serif';
                const m2 = ctx.measureText(label2);
                ctx.fillStyle = 'rgba(249,115,22,0.9)';
                ctx.fillRect(lx2 - m2.width / 2 - 3, ly2 - 7, m2.width + 6, 14);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label2, lx2, ly2);
            }

            // Tick marks
            const wdx = swp2.x - swp1.x, wdy = swp2.y - swp1.y;
            const wlen = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
            const wnx = -wdy / wlen, wny = wdx / wlen;

            // Tick at snap point
            ctx.strokeStyle = SNAP_INDICATOR_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sp.x + wnx * 10, sp.y + wny * 10);
            ctx.lineTo(sp.x - wnx * 10, sp.y - wny * 10);
            ctx.stroke();

            // Tick marks at adjusted measurement endpoints (inner wall faces)
            if (leftBarrier) {
                ctx.strokeStyle = 'rgba(249,115,22,0.7)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(sMeasP1.x + wnx * 8, sMeasP1.y + wny * 8);
                ctx.lineTo(sMeasP1.x - wnx * 8, sMeasP1.y - wny * 8);
                ctx.stroke();
            }
            if (rightBarrier) {
                ctx.strokeStyle = 'rgba(249,115,22,0.7)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(sMeasP2.x + wnx * 8, sMeasP2.y + wny * 8);
                ctx.lineTo(sMeasP2.x - wnx * 8, sMeasP2.y - wny * 8);
                ctx.stroke();
            }
        }

        // Crosshair at snap point
        ctx.strokeStyle = SNAP_INDICATOR_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        // Inner filled dot
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = SNAP_INDICATOR_COLOR;
        ctx.fill();
    }

    // Active dimension line (during drag)
    if (state.dimensionLine) {
        drawDimensionLine(ctx, vp, state.dimensionLine);
    }

    // Hover point indicator — small dot at wall corner when mouse is nearby
    if (state.hoverPoint) {
        const hp = worldToScreen(vp, state.hoverPoint.x, state.hoverPoint.y);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = SELECTION_COLOR;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Marquee selection rectangle
    if (state.marquee && state.marquee.dragging) {
        const { sx1, sy1, sx2, sy2 } = state.marquee;
        const mx = Math.min(sx1, sx2), my = Math.min(sy1, sy2);
        const mw = Math.abs(sx2 - sx1), mh = Math.abs(sy2 - sy1);

        // Draw preselection highlights for elements inside the marquee
        if (state.marquee.preselected && state.marquee.preselected.size > 0) {
            const pre = state.marquee.preselected;

            // Highlight preselected walls
            for (const wall of storey.walls) {
                if (!pre.has(wall.id)) continue;
                const poly = getWallPolygon(wall, storey);
                if (poly && poly.length >= 4) {
                    const sp = poly.map(p => worldToScreen(vp, p.x, p.y));
                    ctx.fillStyle = 'rgba(14, 165, 233, 0.25)';
                    ctx.strokeStyle = 'rgba(14, 165, 233, 0.7)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(sp[0].x, sp[0].y);
                    for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
            }

            // Highlight preselected furniture
            for (const furn of storey.furniture) {
                if (!pre.has(furn.id)) continue;
                drawFurnitureHighlight(ctx, vp, furn, 'rgba(14, 165, 233, 0.2)', 'rgba(14, 165, 233, 0.6)');
            }
        }

        // Draw the marquee rectangle itself
        ctx.fillStyle = 'rgba(14, 165, 233, 0.1)';
        ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(mx, my, mw, mh);
        ctx.setLineDash([]);
    }
};

// ─── Grid ───────────────────────────────────────────────────────

const drawGrid = (ctx, vp, w, h) => {
    let gridSpacing = 100;
    if (vp.zoom < 0.05) gridSpacing = 1000;
    else if (vp.zoom < 0.1) gridSpacing = 500;
    else if (vp.zoom > 0.5) gridSpacing = 50;

    const majorEvery = 10;
    const screenGridSize = gridSpacing * vp.zoom;
    if (screenGridSize < 5) return;

    const startWorld = screenToWorld(vp, 0, 0);
    const endWorld = screenToWorld(vp, w, h);
    const startX = Math.floor(startWorld.x / gridSpacing) * gridSpacing;
    const startY = Math.floor(startWorld.y / gridSpacing) * gridSpacing;
    const endX = Math.ceil(endWorld.x / gridSpacing) * gridSpacing;
    const endY = Math.ceil(endWorld.y / gridSpacing) * gridSpacing;

    for (let x = startX; x <= endX; x += gridSpacing) {
        const sx = worldToScreen(vp, x, 0).x;
        const isMajor = Math.abs(x % (gridSpacing * majorEvery)) < 1;
        ctx.strokeStyle = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR;
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();
    }

    for (let y = startY; y <= endY; y += gridSpacing) {
        const sy = worldToScreen(vp, 0, y).y;
        const isMajor = Math.abs(y % (gridSpacing * majorEvery)) < 1;
        ctx.strokeStyle = isMajor ? GRID_COLOR_MAJOR : GRID_COLOR;
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
    }

    // Origin marker
    const origin = worldToScreen(vp, 0, 0);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(origin.x - 12, origin.y);
    ctx.lineTo(origin.x + 12, origin.y);
    ctx.moveTo(origin.x, origin.y - 12);
    ctx.lineTo(origin.x, origin.y + 12);
    ctx.stroke();
};

// ─── Walls (merged, closed surfaces) ────────────────────────────

const drawWallsMerged = (ctx, vp, storey, state, selectedSet, frame) => {
    // Outer walls: jede zusammenhängende Kette wird als verschmolzene Fläche
    // gezeichnet – geschlossene Ringe (nach dem Schließen) als Ring, offene
    // Ketten (während des Zeichnens, weitere Baukörper, Restwände) als Band.
    const outerWalls = storey.walls.filter(w => w.type === 'outer');
    if (outerWalls.length > 0) {
        const chains = buildWallChains(outerWalls); // einmal je Frame
        for (const chain of chains) {
            const drawn = storey.outerClosed && chain.closed && chain.walls.length >= 3
                ? drawClosedOuterChain(ctx, vp, storey, chain, frame)
                : drawOpenOuterChain(ctx, vp, storey, chain);
            if (!drawn) {
                // Rückfall: Wände einzeln zeichnen, damit nichts unsichtbar bleibt
                for (const w of chain.walls) drawWallSolid(ctx, vp, w, storey, false);
            }

            // Selection highlight for ALL selected outer walls
            for (const ow of chain.walls) {
                if (selectedSet.has(ow.id)) {
                    drawWallSelectionHighlight(ctx, vp, ow, storey);
                }
            }
        }
    }

    // Inner walls: simple two-pass approach for clean merged appearance
    // Pass 1: Fill all inner walls (same color = overlapping areas merge seamlessly)
    // Pass 2: Draw outlines, skipping internal junction edges
    const innerWalls = storey.walls.filter(w => w.type !== 'outer');
    if (innerWalls.length > 0) {
        // Build adjacency: for each point, which walls connect there?
        const pointWalls = new Map();
        for (const w of storey.walls) {
            if (!pointWalls.has(w.p1)) pointWalls.set(w.p1, []);
            if (!pointWalls.has(w.p2)) pointWalls.set(w.p2, []);
            pointWalls.get(w.p1).push(w);
            pointWalls.get(w.p2).push(w);
        }

        // For each inner wall, compute its display polygon
        // Only extend edges when connecting to outer walls (reliable)
        const wallPolys = [];
        for (const wall of innerWalls) {
            const poly = getWallPolygon(wall, storey);
            if (!poly || poly.length < 4) continue;

            // poly = [p1_left, p2_left, p2_right, p1_right]
            let corners = [{ ...poly[0] }, { ...poly[1] }, { ...poly[2] }, { ...poly[3] }];

            // Extend edges at both endpoints where other walls connect
            for (const [endIdx, ptId] of [[0, wall.p1], [1, wall.p2]]) {
                const connectedWalls = pointWalls.get(ptId) || [];
                const neighbors = connectedWalls.filter(w => w.id !== wall.id);
                if (neighbors.length === 0) continue;

                // poly = [p1_left(0), p2_left(1), p2_right(2), p1_right(3)]
                // Left edge: 0→1, Right edge: 3→2
                // At p1-end: near-left=0, far-left=1, near-right=3, far-right=2
                // At p2-end: near-left=1, far-left=0, near-right=2, far-right=3
                const nearLeftIdx = endIdx === 0 ? 0 : 1;
                const farLeftIdx = endIdx === 0 ? 1 : 0;
                const nearRightIdx = endIdx === 0 ? 3 : 2;
                const farRightIdx = endIdx === 0 ? 2 : 3;

                for (const neighbor of neighbors) {
                    // Verlängerung begrenzen (fast parallele Nachbarn würden sonst Spitzen erzeugen)
                    const maxExt = MITER_LIMIT_FACTOR * Math.max(Number(wall.thickness_mm) || 0, Number(neighbor.thickness_mm) || 0);
                    const withinLimit = (idx, p) => p && dist(poly[idx], p) <= maxExt;
                    if (neighbor.type === 'outer') {
                        // Inner→outer: extend to the wall center line
                        const owPt1 = getPoint(storey, neighbor.p1);
                        const owPt2 = getPoint(storey, neighbor.p2);
                        if (!owPt1 || !owPt2) continue;
                        const extLeft = lineLineIntersect(corners[nearLeftIdx], corners[farLeftIdx], owPt1, owPt2);
                        if (withinLimit(nearLeftIdx, extLeft)) corners[nearLeftIdx] = extLeft;
                        const extRight = lineLineIntersect(corners[nearRightIdx], corners[farRightIdx], owPt1, owPt2);
                        if (withinLimit(nearRightIdx, extRight)) corners[nearRightIdx] = extRight;
                    } else {
                        // Inner→inner: extend to the neighbor's polygon edges
                        const nPoly = getWallPolygon(neighbor, storey);
                        if (!nPoly || nPoly.length < 4) continue;
                        // nPoly: [p1_left(0), p2_left(1), p2_right(2), p1_right(3)]
                        // Left edge = 0→1, Right edge = 3→2
                        const nEdges = [
                            [nPoly[0], nPoly[1]], // left edge
                            [nPoly[3], nPoly[2]], // right edge
                        ];
                        // Extend our left side to neighbor's edges
                        let bestExtL = null, bestDistL = Infinity;
                        for (const [ea, eb] of nEdges) {
                            const ext = lineLineIntersect(corners[nearLeftIdx], corners[farLeftIdx], ea, eb);
                            if (ext) {
                                const d = dist(corners[nearLeftIdx], ext);
                                if (d < bestDistL) { bestDistL = d; bestExtL = ext; }
                            }
                        }
                        if (withinLimit(nearLeftIdx, bestExtL)) corners[nearLeftIdx] = bestExtL;
                        // Extend our right side to neighbor's edges
                        let bestExtR = null, bestDistR = Infinity;
                        for (const [ea, eb] of nEdges) {
                            const ext = lineLineIntersect(corners[nearRightIdx], corners[farRightIdx], ea, eb);
                            if (ext) {
                                const d = dist(corners[nearRightIdx], ext);
                                if (d < bestDistR) { bestDistR = d; bestExtR = ext; }
                            }
                        }
                        if (withinLimit(nearRightIdx, bestExtR)) corners[nearRightIdx] = bestExtR;
                    }
                }
            }

            wallPolys.push({ wall, corners });
        }

        // Pass 1: Fill all inner walls (merge via same color)
        ctx.fillStyle = '#d1d5db';
        for (const { corners } of wallPolys) {
            const sp = corners.map(p => worldToScreen(vp, p.x, p.y));
            ctx.beginPath();
            ctx.moveTo(sp[0].x, sp[0].y);
            for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
            ctx.closePath();
            ctx.fill();
        }

        // Build all inner wall polygons for overlap detection
        const allInnerPolys = wallPolys.map(wp => ({
            wall: wp.wall,
            corners: wp.corners,
        }));

        // Helper: check if a screen-space line segment is inside another wall's polygon
        const isEdgeInsideOtherWall = (edgeA, edgeB, ownWallId) => {
            // Check if the midpoint of this edge lies inside any other inner wall polygon
            const midX = (edgeA.x + edgeB.x) / 2;
            const midY = (edgeA.y + edgeB.y) / 2;
            for (const other of allInnerPolys) {
                if (other.wall.id === ownWallId) continue;
                // Point-in-polygon test using world coordinates
                const c = other.corners;
                let inside = false;
                for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
                    const ci = c[i], cj = c[j];
                    if (((ci.y > midY) !== (cj.y > midY)) &&
                        (midX < (cj.x - ci.x) * (midY - ci.y) / (cj.y - ci.y) + ci.x)) {
                        inside = !inside;
                    }
                }
                if (inside) return true;
            }
            return false;
        };

        // Pass 2: Draw outlines (skip end caps at inner-inner junctions AND
        //         skip long edges that are inside another inner wall's body)
        for (const { wall, corners } of wallPolys) {
            const sp = corners.map(p => worldToScreen(vp, p.x, p.y));
            const selected = selectedSet.has(wall.id);

            ctx.strokeStyle = selected ? SELECTION_COLOR : '#475569';
            ctx.lineWidth = selected ? 2.5 : 1.5;

            // Check which endpoints have inner wall junctions
            const p1HasJunction = (pointWalls.get(wall.p1) || []).some(w => w.id !== wall.id && w.type !== 'outer');
            const p2HasJunction = (pointWalls.get(wall.p2) || []).some(w => w.id !== wall.id && w.type !== 'outer');

            // poly = [p1_left(0), p2_left(1), p2_right(2), p1_right(3)]
            // Left long edge (0->1): draw only if not inside another inner wall
            if (!isEdgeInsideOtherWall(corners[0], corners[1], wall.id)) {
                ctx.beginPath();
                ctx.moveTo(sp[0].x, sp[0].y);
                ctx.lineTo(sp[1].x, sp[1].y);
                ctx.stroke();
            }

            // p2 end cap (1->2): skip if p2 has inner wall junction
            if (!p2HasJunction) {
                ctx.beginPath();
                ctx.moveTo(sp[1].x, sp[1].y);
                ctx.lineTo(sp[2].x, sp[2].y);
                ctx.stroke();
            }

            // Right long edge (2->3): draw only if not inside another inner wall
            if (!isEdgeInsideOtherWall(corners[2], corners[3], wall.id)) {
                ctx.beginPath();
                ctx.moveTo(sp[2].x, sp[2].y);
                ctx.lineTo(sp[3].x, sp[3].y);
                ctx.stroke();
            }

            // p1 end cap (3->0): skip if p1 has inner wall junction
            if (!p1HasJunction) {
                ctx.beginPath();
                ctx.moveTo(sp[3].x, sp[3].y);
                ctx.lineTo(sp[0].x, sp[0].y);
                ctx.stroke();
            }
        }
    }
};


/** Außen-Eckpunkt einer Außenwand an einem ihrer Knoten (poly[0]→poly[1] = Außenfläche). */
const outerCornerAt = (wall, poly, nodeId) => (nodeId === wall.p1 ? poly[0] : poly[1]);

/**
 * Gehrungs- bzw. Fasenpunkte der Außenkante zwischen zwei Wänden am Knoten `shared`.
 * Schiebt einen (Gehrung) oder zwei Punkte (Fase/Versatz) nach `out`.
 */
const pushOuterJoint = (out, storey, w1, poly1, far1Node, w2, poly2, far2Node, shared) => {
    const near1 = outerCornerAt(w1, poly1, shared);
    const far1 = outerCornerAt(w1, poly1, far1Node);
    const near2 = outerCornerAt(w2, poly2, shared);
    const far2 = outerCornerAt(w2, poly2, far2Node);
    const corner = getPoint(storey, shared);
    const limit = MITER_LIMIT_FACTOR * Math.max(Number(w1.thickness_mm) || 0, Number(w2.thickness_mm) || 0);
    const miter = computeMiterPoint(near1, far1, near2, far2, corner, limit);
    if (miter) {
        out.push(miter);
    } else {
        out.push(near1);
        if (dist(near1, near2) > 0.5) out.push(near2);
    }
};

/** Geschlossener Außenwand-Ring (Innenkante = Referenzlinie, Außenkante mit Gehrung). */
const drawClosedOuterChain = (ctx, vp, storey, chain, frame) => {
    const n = chain.walls.length;
    const innerPts = chain.nodes.map(id => getPoint(storey, id));
    if (innerPts.some(p => !p)) return false;
    const polys = chain.walls.map(w => getWallPolygon(w, storey));
    if (polys.some(p => !p)) return false;

    // Außenkante: Gehrung an jedem Knoten zwischen Wand i und Wand i+1
    const outerPts = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        pushOuterJoint(
            outerPts, storey,
            chain.walls[i], polys[i], chain.nodes[i],
            chain.walls[j], polys[j], chain.nodes[(j + 1) % n],
            chain.nodes[j],
        );
    }
    if (outerPts.length < 3 || innerPts.length < 3) return false;
    if (frame) frame.outerContours.push(outerPts);

    const outerScreen = outerPts.map(p => worldToScreen(vp, p.x, p.y));
    const innerScreen = innerPts.map(p => worldToScreen(vp, p.x, p.y));

    // Fill solid wall
    ctx.fillStyle = '#dce1e8';
    ctx.beginPath();
    ctx.moveTo(outerScreen[0].x, outerScreen[0].y);
    for (let i = 1; i < outerScreen.length; i++) ctx.lineTo(outerScreen[i].x, outerScreen[i].y);
    ctx.closePath();
    ctx.moveTo(innerScreen[0].x, innerScreen[0].y);
    for (let i = innerScreen.length - 1; i >= 0; i--) ctx.lineTo(innerScreen[i].x, innerScreen[i].y);
    ctx.closePath();
    ctx.fill('evenodd');

    // Outer stroke
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(outerScreen[0].x, outerScreen[0].y);
    for (let i = 1; i < outerScreen.length; i++) ctx.lineTo(outerScreen[i].x, outerScreen[i].y);
    ctx.closePath();
    ctx.stroke();

    // Inner stroke (thicker, reference edge)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(innerScreen[0].x, innerScreen[0].y);
    for (let i = 1; i < innerScreen.length; i++) ctx.lineTo(innerScreen[i].x, innerScreen[i].y);
    ctx.closePath();
    ctx.stroke();
    return true;
};

/** Offene Außenwand-Kette (während des Zeichnens) als Band mit Endkappen. */
const drawOpenOuterChain = (ctx, vp, storey, chain) => {
    const walls = chain.walls;
    if (walls.length === 0) return true;
    // Kettenknoten in Laufrichtung (bei einem nicht geschlossenen Umriss, der dennoch
    // einen Ring bildet, Start- und Endknoten identisch)
    const nodes = chain.closed ? [...chain.nodes, chain.nodes[0]] : chain.nodes;
    const innerPts = nodes.map(id => getPoint(storey, id));
    if (innerPts.some(p => !p)) return false;
    const polys = walls.map(w => getWallPolygon(w, storey));
    if (polys.some(p => !p)) return false;

    // Build outer boundary with mitered corners
    const outerPts = [outerCornerAt(walls[0], polys[0], nodes[0])];
    for (let i = 0; i < walls.length - 1; i++) {
        pushOuterJoint(
            outerPts, storey,
            walls[i], polys[i], nodes[i],
            walls[i + 1], polys[i + 1], nodes[i + 2],
            nodes[i + 1],
        );
    }
    const last = walls.length - 1;
    outerPts.push(outerCornerAt(walls[last], polys[last], nodes[last + 1]));

    // Draw the merged shape as a single path (outer → inner reversed)
    if (outerPts.length < 2 || innerPts.length < 2) return false;
    const outerS = outerPts.map(p => worldToScreen(vp, p.x, p.y));
    const innerS = innerPts.map(p => worldToScreen(vp, p.x, p.y));

    // Fill
    ctx.fillStyle = '#dce1e8';
    ctx.beginPath();
    ctx.moveTo(outerS[0].x, outerS[0].y);
    for (let i = 1; i < outerS.length; i++) ctx.lineTo(outerS[i].x, outerS[i].y);
    for (let i = innerS.length - 1; i >= 0; i--) ctx.lineTo(innerS[i].x, innerS[i].y);
    ctx.closePath();
    ctx.fill();

    // Outer edge stroke only
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(outerS[0].x, outerS[0].y);
    for (let i = 1; i < outerS.length; i++) ctx.lineTo(outerS[i].x, outerS[i].y);
    ctx.stroke();

    // Inner edge stroke
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(innerS[0].x, innerS[0].y);
    for (let i = 1; i < innerS.length; i++) ctx.lineTo(innerS[i].x, innerS[i].y);
    ctx.stroke();

    // End caps (only at the open ends)
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(outerS[0].x, outerS[0].y);
    ctx.lineTo(innerS[0].x, innerS[0].y);
    ctx.moveTo(outerS[outerS.length - 1].x, outerS[outerS.length - 1].y);
    ctx.lineTo(innerS[innerS.length - 1].x, innerS[innerS.length - 1].y);
    ctx.stroke();
    return true;
};

/** Draw a single wall segment as a solid filled shape */
const drawWallSolid = (ctx, vp, wall, storey, selected) => {
    const poly = getWallPolygon(wall, storey);
    if (!poly || poly.length < 3) return;

    const screenPoly = poly.map(p => worldToScreen(vp, p.x, p.y));

    ctx.fillStyle = wall.type === 'outer' ? '#dce1e8' : '#d1d5db';
    ctx.strokeStyle = selected ? SELECTION_COLOR : '#475569';
    ctx.lineWidth = selected ? 2.5 : 1.5;

    ctx.beginPath();
    ctx.moveTo(screenPoly[0].x, screenPoly[0].y);
    for (let i = 1; i < screenPoly.length; i++) ctx.lineTo(screenPoly[i].x, screenPoly[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
};

/** Highlight outline of a selected wall on the merged surface */
const drawWallSelectionHighlight = (ctx, vp, wall, storey) => {
    const poly = getWallPolygon(wall, storey);
    if (!poly || poly.length < 3) return;
    const screenPoly = poly.map(p => worldToScreen(vp, p.x, p.y));

    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(screenPoly[0].x, screenPoly[0].y);
    for (let i = 1; i < screenPoly.length; i++) ctx.lineTo(screenPoly[i].x, screenPoly[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
};

// ─── CAD Handles ─────────────────────────────────────────────────

/** Draw a corner/endpoint handle (square, CAD-style) */
const drawCornerHandle = (ctx, vp, pt, active) => {
    const s = worldToScreen(vp, pt.x, pt.y);
    const size = active ? 8 : 6;
    ctx.fillStyle = active ? '#ef4444' : SELECTION_COLOR;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fillRect(s.x - size, s.y - size, size * 2, size * 2);
    ctx.strokeRect(s.x - size, s.y - size, size * 2, size * 2);
};

/** Draw a midpoint move handle (circle, for perpendicular wall movement) */
const drawMoveHandle = (ctx, vp, pt, active) => {
    const s = worldToScreen(vp, pt.x, pt.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, active ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#f59e0b' : '#0ea5e9';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Draw move arrows
    if (!active) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x - 3, s.y); ctx.lineTo(s.x + 3, s.y);
        ctx.moveTo(s.x, s.y - 3); ctx.lineTo(s.x, s.y + 3);
        ctx.stroke();
    }
};

/** Draw wall length dimension label (CAD-style) */
const drawWallDimension = (ctx, vp, p1, p2, subtle = false) => {
    const s1 = worldToScreen(vp, p1.x, p1.y);
    const s2 = worldToScreen(vp, p2.x, p2.y);
    const length = dist(p1, p2);
    const label = mmToM(length) + ' m';

    const midX = (s1.x + s2.x) / 2;
    const midY = (s1.y + s2.y) / 2;

    // Offset label perpendicular to wall
    const dx = s2.x - s1.x, dy = s2.y - s1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 40) return; // too short to label
    const nx = -dy / len, ny = dx / len;
    const offset = subtle ? 12 : 18;

    const lx = midX + nx * offset;
    const ly = midY + ny * offset;

    // Background
    ctx.font = subtle ? '10px Inter, sans-serif' : 'bold 11px Inter, sans-serif';
    const metrics = ctx.measureText(label);
    const pad = 3;
    ctx.fillStyle = subtle ? 'rgba(255,255,255,0.85)' : 'rgba(14,165,233,0.9)';
    ctx.fillRect(lx - metrics.width / 2 - pad, ly - 7 - pad, metrics.width + pad * 2, 14 + pad * 2);

    // Text
    ctx.fillStyle = subtle ? '#475569' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, ly);

    if (!subtle) {
        // Dimension tick marks
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s1.x + nx * 6, s1.y + ny * 6);
        ctx.lineTo(s1.x + nx * (offset + 6), s1.y + ny * (offset + 6));
        ctx.moveTo(s2.x + nx * 6, s2.y + ny * 6);
        ctx.lineTo(s2.x + nx * (offset + 6), s2.y + ny * (offset + 6));
        // Dimension line
        ctx.moveTo(s1.x + nx * offset, s1.y + ny * offset);
        ctx.lineTo(s2.x + nx * offset, s2.y + ny * offset);
        ctx.stroke();
    }
};

/** Draw dimension line (for active operations) */
const drawDimensionLine = (ctx, vp, dimLine) => {
    if (!dimLine) return;
    const s1 = worldToScreen(vp, dimLine.x1, dimLine.y1);
    const s2 = worldToScreen(vp, dimLine.x2, dimLine.y2);

    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const length = dist({ x: dimLine.x1, y: dimLine.y1 }, { x: dimLine.x2, y: dimLine.y2 });
    const label = mmToM(length) + ' m';
    const midX = (s1.x + s2.x) / 2;
    const midY = (s1.y + s2.y) / 2;

    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = 'rgba(14,165,233,0.95)';
    const metrics = ctx.measureText(label);
    ctx.fillRect(midX - metrics.width / 2 - 4, midY - 10, metrics.width + 8, 20);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);
};

// ─── Openings ───────────────────────────────────────────────────

const drawOpening = (ctx, vp, opening, storey, selected, paintBackground) => {
    const wall = storey.walls.find(w => w.id === getOpeningWallId(opening));
    if (!wall) {
        // Verwaiste Öffnung (z. B. aus einer früheren Wandteilung) – sichtbar melden
        warnOnce(`orphan:${opening.id}`, '[Grundriss] Öffnung ohne zugehörige Wand wird nicht gezeichnet:', opening.id);
        return;
    }
    const width = Number(opening.width_mm);
    if (!(width > 0)) return;
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return;

    const wallLen = dist(pt1, pt2);
    if (wallLen < 1) return;
    const dx = (pt2.x - pt1.x) / wallLen;
    const dy = (pt2.y - pt1.y) / wallLen;

    // Wall normal (perpendicular)
    const nx = -dy, ny = dx;
    const thickness = Number(wall.thickness_mm) || 0;

    // Opening center along wall (auf die Wandlänge begrenzt)
    const center = getOpeningCenterMm(opening, wallLen);
    const cx = pt1.x + dx * center;
    const cy = pt1.y + dy * center;
    const halfW = width / 2;

    // Opening start and end points (on the wall reference line)
    const sx = cx - dx * halfW;
    const sy = cy - dy * halfW;
    const ex = cx + dx * halfW;
    const ey = cy + dy * halfW;

    // Lage der beiden Wandflächen relativ zur Referenzlinie (sideA ≤ sideB),
    // aus dem tatsächlichen Wandpolygon – unabhängig von Wandtyp und Zeichenrichtung
    const faces = getWallFaceOffsets(wall, storey);
    const sideA = faces ? faces.min : -thickness / 2;
    const sideB = faces ? faces.max : thickness / 2;
    const interiorSign = faces ? faces.interiorSign : 1;

    // Clear the wall area (opening gap): Hintergrund (inkl. Vorlage) neu malen
    // statt deckend zu übermalen
    const margin = 2;
    const g1 = worldToScreen(vp, sx + nx * (sideA - margin), sy + ny * (sideA - margin));
    const g2 = worldToScreen(vp, ex + nx * (sideA - margin), ey + ny * (sideA - margin));
    const g3 = worldToScreen(vp, ex + nx * (sideB + margin), ey + ny * (sideB + margin));
    const g4 = worldToScreen(vp, sx + nx * (sideB + margin), sy + ny * (sideB + margin));

    ctx.save();
    try {
        ctx.beginPath();
        ctx.moveTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y);
        ctx.lineTo(g3.x, g3.y); ctx.lineTo(g4.x, g4.y);
        ctx.closePath();
        if (paintBackground) {
            ctx.clip();
            paintBackground();
        } else {
            ctx.fillStyle = '#fafafa';
            ctx.fill();
        }
    } finally {
        ctx.restore();
    }

    if (opening.type === 'door') {
        // ── CAD Door: break lines + leaf from hinge + solid quarter-arc ──
        const swingLeft = opening.swing === 'left';
        const inward = opening.direction !== 'outward';

        // Swing normal direction (+1 = +n). Bei Außenwänden zeigt „innen“ immer ins Gebäude.
        const swingSign = inward ? interiorSign : -interiorSign;
        const swingNx = nx * swingSign;
        const swingNy = ny * swingSign;

        // Scharnier auf der Wandfläche, zu der die Tür aufschlägt – das Türblatt
        // läuft so nicht durch den Wandkörper
        const hingeOffset = swingSign > 0 ? sideB : sideA;
        const hinge = swingLeft
            ? { x: sx + nx * hingeOffset, y: sy + ny * hingeOffset }
            : { x: ex + nx * hingeOffset, y: ey + ny * hingeOffset };
        const free = swingLeft
            ? { x: ex + nx * hingeOffset, y: ey + ny * hingeOffset }
            : { x: sx + nx * hingeOffset, y: sy + ny * hingeOffset };
        const hingeS = worldToScreen(vp, hinge.x, hinge.y);

        // The door leaf endpoint (90° from wall direction, at hinge)
        const leafEndX = hinge.x + swingNx * width;
        const leafEndY = hinge.y + swingNy * width;
        const leafEndS = worldToScreen(vp, leafEndX, leafEndY);

        // Draw short wall break lines at opening edges (perpendicular ticks)
        ctx.strokeStyle = selected ? SELECTION_COLOR : '#475569';
        ctx.lineWidth = 1.5;
        const breakA1 = worldToScreen(vp, sx + nx * sideA, sy + ny * sideA);
        const breakA2 = worldToScreen(vp, sx + nx * sideB, sy + ny * sideB);
        const breakB1 = worldToScreen(vp, ex + nx * sideA, ey + ny * sideA);
        const breakB2 = worldToScreen(vp, ex + nx * sideB, ey + ny * sideB);
        ctx.beginPath();
        ctx.moveTo(breakA1.x, breakA1.y); ctx.lineTo(breakA2.x, breakA2.y);
        ctx.moveTo(breakB1.x, breakB1.y); ctx.lineTo(breakB2.x, breakB2.y);
        ctx.stroke();

        // Door leaf line (hinge → leaf end)
        ctx.strokeStyle = selected ? SELECTION_COLOR : '#334155';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hingeS.x, hingeS.y);
        ctx.lineTo(leafEndS.x, leafEndS.y);
        ctx.stroke();

        // Quarter-circle arc (from leaf end back to free end of opening)
        const arcRadius = width * vp.zoom;
        // Arc angle: from the leaf direction back to the wall direction
        const leafAngle = Math.atan2(leafEndY - hinge.y, leafEndX - hinge.x);
        const freeAngle = Math.atan2(free.y - hinge.y, free.x - hinge.x);

        ctx.strokeStyle = selected ? SELECTION_COLOR : DOOR_ARC_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Determine arc direction
        let angleDiff = freeAngle - leafAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        const counterClockwise = angleDiff < 0;
        if (arcRadius > 0) ctx.arc(hingeS.x, hingeS.y, arcRadius, leafAngle, freeAngle, counterClockwise);
        ctx.stroke();

    } else {
        // ── CAD Window Symbol ──
        // Components: wall break lines at edges + two parallel glass lines + end caps

        const color = selected ? SELECTION_COLOR : WINDOW_STROKE_COLOR;

        // Glass line offsets (close together in center of wall)
        const glOff1 = sideA + (sideB - sideA) * 0.42;
        const glOff2 = sideA + (sideB - sideA) * 0.58;

        // Two parallel glass lines
        const gl1s = worldToScreen(vp, sx + nx * glOff1, sy + ny * glOff1);
        const gl1e = worldToScreen(vp, ex + nx * glOff1, ey + ny * glOff1);
        const gl2s = worldToScreen(vp, sx + nx * glOff2, sy + ny * glOff2);
        const gl2e = worldToScreen(vp, ex + nx * glOff2, ey + ny * glOff2);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;

        // Glass line 1
        ctx.beginPath();
        ctx.moveTo(gl1s.x, gl1s.y);
        ctx.lineTo(gl1e.x, gl1e.y);
        ctx.stroke();

        // Glass line 2
        ctx.beginPath();
        ctx.moveTo(gl2s.x, gl2s.y);
        ctx.lineTo(gl2e.x, gl2e.y);
        ctx.stroke();

        // End caps (short perpendicular lines connecting the two glass lines)
        ctx.lineWidth = 1.5;
        // Start end cap
        ctx.beginPath();
        ctx.moveTo(gl1s.x, gl1s.y);
        ctx.lineTo(gl2s.x, gl2s.y);
        ctx.stroke();
        // End end cap
        ctx.beginPath();
        ctx.moveTo(gl1e.x, gl1e.y);
        ctx.lineTo(gl2e.x, gl2e.y);
        ctx.stroke();

        // Wall break lines at opening edges (full wall thickness)
        ctx.strokeStyle = selected ? SELECTION_COLOR : '#475569';
        ctx.lineWidth = 1.5;
        const breakA1 = worldToScreen(vp, sx + nx * sideA, sy + ny * sideA);
        const breakA2 = worldToScreen(vp, sx + nx * sideB, sy + ny * sideB);
        const breakB1 = worldToScreen(vp, ex + nx * sideA, ey + ny * sideA);
        const breakB2 = worldToScreen(vp, ex + nx * sideB, ey + ny * sideB);
        ctx.beginPath();
        ctx.moveTo(breakA1.x, breakA1.y); ctx.lineTo(breakA2.x, breakA2.y);
        ctx.moveTo(breakB1.x, breakB1.y); ctx.lineTo(breakB2.x, breakB2.y);
        ctx.stroke();
    }
};

// ─── Rooms ──────────────────────────────────────────────────────

// Feste Schriftgrößen (die frühere „zoomabhängige“ Formel ergab im ganzen
// Zoombereich 0,02–2,0 immer genau diese Werte)
const ROOM_LABEL_FONT_PX = 10;
const SLAB_LABEL_FONT_PX = 9;
const DIMENSION_FONT_PX = 10;

const drawRoomLabel = (ctx, vp, room, isSelected, recordHitBox = true) => {
    if (!room.polygon || room.polygon.length < 3) return;
    // Beschriftungspunkt garantiert im Raum (auch bei L-/U-förmigen Räumen)
    const anchor = polygonInteriorPoint(room.polygon);
    // Apply user-defined offset (for dragging the label)
    const labelX = anchor.x + (room.labelOffsetX || 0);
    const labelY = anchor.y + (room.labelOffsetY || 0);
    const sc = worldToScreen(vp, labelX, labelY);
    const fontSize = ROOM_LABEL_FONT_PX;

    // Background pill for readability
    const nameText = room.name || '';
    const areaText = `${mm2ToM2(room.area_mm2 || 0)} m²`;
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    const nameW = ctx.measureText(nameText).width;
    ctx.font = `400 ${fontSize * 0.85}px Inter, system-ui, sans-serif`;
    const areaW = ctx.measureText(areaText).width;
    const boxW = Math.max(nameW, areaW) + 12;
    const boxH = fontSize * 2.4;
    const boxX = sc.x - boxW / 2;
    const boxY = sc.y - boxH / 2;

    // Draw background
    ctx.fillStyle = isSelected ? 'rgba(14, 165, 233, 0.12)' : 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxW - r, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
    ctx.lineTo(boxX + boxW, boxY + boxH - r);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
    ctx.lineTo(boxX + r, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
    ctx.lineTo(boxX, boxY + r);
    ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
    ctx.closePath();
    ctx.fill();
    if (isSelected) {
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.fillStyle = ROOM_LABEL_COLOR;
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nameText, sc.x, sc.y - fontSize * 0.45);

    ctx.font = `400 ${fontSize * 0.85}px Inter, system-ui, sans-serif`;
    ctx.fillText(areaText, sc.x, sc.y + fontSize * 0.55);

    // Store the screen-space hit box for click detection (flüchtig, wird nicht gespeichert)
    if (recordHitBox) setTransient(room, '_labelHitBox', { x: boxX, y: boxY, w: boxW, h: boxH });
};

// ─── Slabs ──────────────────────────────────────────────────────

const drawSlab = (ctx, vp, slab, selected) => {
    if (!slab.polygon || slab.polygon.length < 3) return;

    // Draw filled polygon
    ctx.beginPath();
    const p0 = worldToScreen(vp, slab.polygon[0].x, slab.polygon[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < slab.polygon.length; i++) {
        const p = worldToScreen(vp, slab.polygon[i].x, slab.polygon[i].y);
        ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = selected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(148, 163, 184, 0.08)';
    ctx.fill();

    // Diagonal hatch pattern
    ctx.save();
    try {
        ctx.clip();
        ctx.strokeStyle = selected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(148, 163, 184, 0.2)';
        ctx.lineWidth = 0.5;
        // Get bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of slab.polygon) {
            const s = worldToScreen(vp, pt.x, pt.y);
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x > maxX) maxX = s.x;
            if (s.y > maxY) maxY = s.y;
        }
        const gap = 8;
        for (let d = minX + minY - gap * 2; d < maxX + maxY + gap * 2; d += gap) {
            ctx.beginPath();
            ctx.moveTo(d - minY, minY);
            ctx.lineTo(d - maxY, maxY);
            ctx.stroke();
        }
    } finally {
        ctx.restore();
    }

    // Outline
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < slab.polygon.length; i++) {
        const p = worldToScreen(vp, slab.polygon[i].x, slab.polygon[i].y);
        ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = selected ? '#3b82f6' : '#94a3b8';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    const anchor = polygonInteriorPoint(slab.polygon);
    const sc = worldToScreen(vp, anchor.x, anchor.y);
    const fontSize = SLAB_LABEL_FONT_PX;
    ctx.fillStyle = selected ? '#3b82f6' : '#64748b';
    ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(slab.name || 'Decke', sc.x, sc.y - fontSize * 0.5);
    ctx.font = `400 ${fontSize * 0.8}px Inter, system-ui, sans-serif`;
    const thicknessCm = String((Number(slab.thickness_mm) || 0) / 10).replace('.', ',');
    ctx.fillText(`${thicknessCm} cm · ${mmToM(Number(slab.ref_height_mm) || 0)} m`, sc.x, sc.y + fontSize * 0.5);

    // Corner handles when selected
    if (selected) {
        for (let i = 0; i < slab.polygon.length; i++) {
            const cp = worldToScreen(vp, slab.polygon[i].x, slab.polygon[i].y);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        // Midpoint handles (smaller, for inserting new points)
        for (let i = 0; i < slab.polygon.length; i++) {
            const a = slab.polygon[i];
            const b = slab.polygon[(i + 1) % slab.polygon.length];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const mp = worldToScreen(vp, mx, my);
            ctx.fillStyle = '#e0f2fe';
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(mp.x, mp.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }
};

// ─── Roof 2D Overlay ────────────────────────────────────────────

const drawRoof2D = (ctx, vp, storey) => {
    const roof = storey.roof;
    if (!roof) return;
    const boundary = storey.outerBoundary;
    if (!boundary || boundary.length < 3) return;

    ctx.save();
    try {
        // Compute bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of boundary) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const bw = maxX - minX, bh = maxY - minY;
        const overhang = Math.max(0, Number(roof.overhang_mm) || 0);
        const pitched = roof.type === 'gable' || roof.type === 'hip';

        // Traufkontur: Außenkontur plus Überstand. Folgt bei L-/U-förmigen
        // Grundrissen der Gebäudeform (früher: Rechteck um alles).
        const bboxPoly = (inset) => [
            { x: minX + inset, y: minY + inset }, { x: maxX - inset, y: minY + inset },
            { x: maxX - inset, y: maxY - inset }, { x: minX + inset, y: maxY - inset },
        ];
        let eaves = boundary;
        if (pitched && overhang > 0) {
            const expanded = offsetPolygon(ensureCW(boundary), -overhang);
            eaves = expanded.length >= 3 ? expanded : bboxPoly(-overhang);
        }

        // Draw overhang outline (expanded boundary)
        if (pitched && overhang > 0) {
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            tracePolygon(ctx, vp, eaves);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Ridge line (nur innerhalb der Traufkontur sichtbar)
        if (pitched) {
            ctx.save();
            try {
                ctx.beginPath();
                tracePolygon(ctx, vp, eaves);
                ctx.clip();

                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 4]);

                // Halbe Spannweiten inkl. Überstand – wie in der 3D-Ansicht
                const hw = bw / 2 + overhang, hd = bh / 2 + overhang;
                const ox0 = minX - overhang, oy0 = minY - overhang;
                const ox1 = maxX + overhang, oy1 = maxY + overhang;

                // Ridge along longest axis
                if (bw >= bh) {
                    // Horizontal ridge. Walmdach: Firstlänge = lange minus kurze Halbspannweite (3D)
                    const half = roof.type === 'hip' ? Math.max(0, hw - hd) : bw / 2;
                    const r1 = worldToScreen(vp, cx - half, cy);
                    const r2 = worldToScreen(vp, cx + half, cy);
                    ctx.beginPath();
                    ctx.moveTo(r1.x, r1.y);
                    ctx.lineTo(r2.x, r2.y);
                    ctx.stroke();

                    // Hip: draw diagonal lines from corners to ridge ends
                    if (roof.type === 'hip') {
                        ctx.strokeStyle = '#94a3b8';
                        ctx.lineWidth = 0.8;
                        const corners = [
                            worldToScreen(vp, ox0, oy0), worldToScreen(vp, ox0, oy1),
                            worldToScreen(vp, ox1, oy0), worldToScreen(vp, ox1, oy1),
                        ];
                        ctx.beginPath();
                        ctx.moveTo(corners[0].x, corners[0].y); ctx.lineTo(r1.x, r1.y);
                        ctx.moveTo(corners[1].x, corners[1].y); ctx.lineTo(r1.x, r1.y);
                        ctx.moveTo(corners[2].x, corners[2].y); ctx.lineTo(r2.x, r2.y);
                        ctx.moveTo(corners[3].x, corners[3].y); ctx.lineTo(r2.x, r2.y);
                        ctx.stroke();
                    }
                } else {
                    // Vertical ridge
                    const half = roof.type === 'hip' ? Math.max(0, hd - hw) : bh / 2;
                    const r1 = worldToScreen(vp, cx, cy - half);
                    const r2 = worldToScreen(vp, cx, cy + half);
                    ctx.beginPath();
                    ctx.moveTo(r1.x, r1.y);
                    ctx.lineTo(r2.x, r2.y);
                    ctx.stroke();

                    if (roof.type === 'hip') {
                        ctx.strokeStyle = '#94a3b8';
                        ctx.lineWidth = 0.8;
                        const corners = [
                            worldToScreen(vp, ox0, oy0), worldToScreen(vp, ox1, oy0),
                            worldToScreen(vp, ox0, oy1), worldToScreen(vp, ox1, oy1),
                        ];
                        ctx.beginPath();
                        ctx.moveTo(corners[0].x, corners[0].y); ctx.lineTo(r1.x, r1.y);
                        ctx.moveTo(corners[1].x, corners[1].y); ctx.lineTo(r1.x, r1.y);
                        ctx.moveTo(corners[2].x, corners[2].y); ctx.lineTo(r2.x, r2.y);
                        ctx.moveTo(corners[3].x, corners[3].y); ctx.lineTo(r2.x, r2.y);
                        ctx.stroke();
                    }
                }
                ctx.setLineDash([]);
            } finally {
                ctx.restore();
            }
        }

        // Flat roof: draw parapet outline (Attika-Linie 5 cm innerhalb der Außenkontur)
        if (roof.type === 'flat') {
            const inset = offsetPolygon(ensureCW(boundary), 50);
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            tracePolygon(ctx, vp, inset.length >= 3 ? inset : bboxPoly(50));
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Roof type label
        const sc = worldToScreen(vp, cx, roof.type === 'flat' ? cy : (minY + bh * 0.15));
        const typeLabels = { gable: 'Satteldach', hip: 'Walmdach', flat: 'Flachdach' };
        const pitchLabel = roof.pitch_deg ? ` ${roof.pitch_deg}°` : '';
        ctx.fillStyle = '#64748b';
        ctx.font = '500 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${typeLabels[roof.type] || 'Dach'}${pitchLabel}`, sc.x, sc.y);
    } finally {
        ctx.restore();
    }
};

// ─── Normgerechte Bemaßung (DIN 1356) ──────────────────────────

/** Sortierte Koordinaten, Werte innerhalb von `tol` mm zusammengefasst. */
const mergeCoords = (values, tol = 1) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const out = [];
    let group = [];
    for (const v of sorted) {
        if (group.length > 0 && v - group[0] > tol) {
            out.push(group.reduce((s, x) => s + x, 0) / group.length);
            group = [];
        }
        group.push(v);
    }
    if (group.length > 0) out.push(group.reduce((s, x) => s + x, 0) / group.length);
    return out;
};

/**
 * Draw outer dimension chains around the building footprint.
 * Two chain levels:
 *   1st chain (close): individual outer wall segment lengths
 *   2nd chain (far):   total building dimension
 * Gemessen wird an der Außenkante der Außenwände (Außenmaß), nicht an der
 * Innenkante. Maße in Metern mit Dezimalkomma.
 */
const drawOuterDimensionChains = (ctx, vp, storey, frame) => {
    // Außenkante: bevorzugt die im Frame gezeichnete Kontur (je Wanddicke),
    // sonst die gespeicherte outerBoundary
    let pts = [];
    if (frame && frame.outerContours.length > 0) {
        for (const contour of frame.outerContours) pts.push(...contour);
    } else if (storey.outerBoundary && storey.outerBoundary.length >= 3) {
        pts = storey.outerBoundary;
    }
    if (pts.length < 2) return;

    // Bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    const chain1Offset = 600;  // mm offset for first dimension chain
    const chain2Offset = 1200; // mm offset for total dimension chain
    const tickLen = 3;         // px

    // Helper: draw a single dimension tick and label line
    const drawDimLine = (sx1, sy1, sx2, sy2, label) => {
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();

        // Ticks (45° slash marks instead of arrows)
        const dx = sx2 - sx1, dy = sy2 - sy1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 10) return;

        // Start tick
        ctx.beginPath();
        ctx.moveTo(sx1 - tickLen, sy1 - tickLen);
        ctx.lineTo(sx1 + tickLen, sy1 + tickLen);
        ctx.stroke();
        // End tick
        ctx.beginPath();
        ctx.moveTo(sx2 - tickLen, sy2 - tickLen);
        ctx.lineTo(sx2 + tickLen, sy2 + tickLen);
        ctx.stroke();

        // Label
        if (label && len > 25) {
            const mx = (sx1 + sx2) / 2;
            const my = (sy1 + sy2) / 2;
            const fontSize = DIMENSION_FONT_PX;
            ctx.save();
            try {
                ctx.fillStyle = '#334155';
                ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Draw text background for readability
                const tw = ctx.measureText(label).width + 6;
                ctx.fillStyle = '#fafafa';
                ctx.fillRect(mx - tw / 2, my - fontSize / 2 - 1, tw, fontSize + 2);
                ctx.fillStyle = '#334155';
                ctx.fillText(label, mx, my);
            } finally {
                ctx.restore();
            }
        }
    };

    ctx.save();
    try {
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);

        // --- Horizontal dimension chains (top and bottom) ---
        // X/Y-Koordinaten der Außenecken, sortiert, innerhalb 1 mm zusammengefasst
        const xCoords = mergeCoords(pts.map(p => p.x));
        const yCoords = mergeCoords(pts.map(p => p.y));

        // Top dimension chain (above building)
        if (xCoords.length >= 2) {
            const chainY = minY - chain1Offset;
            const totalChainY = minY - chain2Offset;

            // Extension lines from building to chain
            for (const x of xCoords) {
                const sx = worldToScreen(vp, x, minY);
                const se = worldToScreen(vp, x, chainY - 100);
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(sx.x, sx.y);
                ctx.lineTo(se.x, se.y);
                ctx.stroke();
            }

            // Detail chain: individual segments
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 0.8;
            for (let i = 0; i < xCoords.length - 1; i++) {
                const s1 = worldToScreen(vp, xCoords[i], chainY);
                const s2 = worldToScreen(vp, xCoords[i + 1], chainY);
                const segLen = xCoords[i + 1] - xCoords[i];
                const label = segLen >= 100 ? mmToM(segLen) : '';
                drawDimLine(s1.x, s1.y, s2.x, s2.y, label);
            }

            // Total chain
            if (xCoords.length > 2) {
                const st1 = worldToScreen(vp, xCoords[0], totalChainY);
                const st2 = worldToScreen(vp, xCoords[xCoords.length - 1], totalChainY);
                const totalLen = xCoords[xCoords.length - 1] - xCoords[0];
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1;
                drawDimLine(st1.x, st1.y, st2.x, st2.y, mmToM(totalLen));
            }

            // Einheit einmalig ausweisen
            const cap = worldToScreen(vp, xCoords[0], totalChainY);
            ctx.fillStyle = '#64748b';
            ctx.font = '500 9px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('Maße in m', cap.x, cap.y - 8);
        }

        // Left dimension chain (left of building)
        if (yCoords.length >= 2) {
            const chainX = minX - chain1Offset;
            const totalChainX = minX - chain2Offset;

            // Extension lines
            for (const y of yCoords) {
                const sy = worldToScreen(vp, minX, y);
                const se = worldToScreen(vp, chainX - 100, y);
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(sy.x, sy.y);
                ctx.lineTo(se.x, se.y);
                ctx.stroke();
            }

            // Detail chain
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 0.8;
            for (let i = 0; i < yCoords.length - 1; i++) {
                const s1 = worldToScreen(vp, chainX, yCoords[i]);
                const s2 = worldToScreen(vp, chainX, yCoords[i + 1]);
                const segLen = yCoords[i + 1] - yCoords[i];
                const label = segLen >= 100 ? mmToM(segLen) : '';
                drawDimLine(s1.x, s1.y, s2.x, s2.y, label);
            }

            // Total chain
            if (yCoords.length > 2) {
                const st1 = worldToScreen(vp, totalChainX, yCoords[0]);
                const st2 = worldToScreen(vp, totalChainX, yCoords[yCoords.length - 1]);
                const totalLen = yCoords[yCoords.length - 1] - yCoords[0];
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1;
                drawDimLine(st1.x, st1.y, st2.x, st2.y, mmToM(totalLen));
            }
        }
    } finally {
        ctx.restore();
    }
};

// ─── 2D Furniture (realistic top-down view) ─────────────────────

// Symbole für ältere/importierte IDs, die nicht (mehr) im Katalog stehen
const LEGACY_FURNITURE_SYMBOLS = {
    einzelbett: 'bed', regal: 'cabinet', sideboard: 'cabinet', buerostuhl: 'chair',
    toilette: 'toilet', waschbecken: 'sink', kueche: 'kitchen', kuechenzeile: 'kitchen',
    kuechenblock: 'kitchen', waschmaschine: 'washer', trockner: 'washer',
};

/**
 * Symbol eines Möbelstücks: zuerst das `symbol`-Feld des Katalogs, dann bekannte
 * Alt-IDs, zuletzt Wortmuster – spezifische Begriffe vor allgemeinen
 * ('nachttisch'/'waschtisch' vor 'tisch', 'kuehlschrank' vor 'schrank').
 */
const resolveFurnitureSymbol = (catId, catItem) => {
    if (catItem && catItem.symbol) return catItem.symbol;
    if (LEGACY_FURNITURE_SYMBOLS[catId]) return LEGACY_FURNITURE_SYMBOLS[catId];
    if (catId.startsWith('sofa') || catId.includes('sessel')) return 'sofa';
    if (catId.startsWith('bett')) return 'bed';
    if (catId.includes('doppelwaschtisch')) return 'doubleSink';
    if (catId.includes('waschtisch') || catId.includes('waschbecken')) return 'sink';
    if (catId.includes('nachttisch')) return 'cabinet';
    if (catId.includes('kuehlschrank')) return 'fridge';
    if (catId.includes('herd')) return 'stove';
    if (catId.includes('kuech') || catId.includes('spuele')) return 'kitchen';
    if (catId.includes('badewanne')) return 'bathtub';
    if (catId.includes('dusche_eck')) return 'showerQuarter';
    if (catId.includes('dusch')) return 'shower';
    if (catId.includes('toilette') || catId === 'wc') return 'toilet';
    if (catId.includes('bidet')) return 'bidet';
    if (catId.includes('urinal')) return 'urinal';
    if (catId.includes('waschmaschine') || catId.includes('trockner')) return 'washer';
    if (catId.includes('tisch')) return 'table';
    if (catId.includes('stuhl')) return 'chair';
    if (catId.includes('schrank') || catId.includes('regal') || catId.includes('kommode') || catId.includes('board')) return 'cabinet';
    return null;
};

/** Zeichnet das Symbol; false, wenn es kein passendes gibt. */
const drawFurnitureSymbol = (ctx, symbol, w, d, catId, fill, stroke) => {
    switch (symbol) {
        case 'sofa': drawSofa(ctx, w, d, catId, fill, stroke); return true;
        case 'bed': drawBed(ctx, w, d, fill, stroke); return true;
        case 'table': drawTable(ctx, w, d, fill, stroke); return true;
        case 'chair': drawChair(ctx, w, d, fill, stroke); return true;
        case 'cabinet': drawCabinet(ctx, w, d, fill, stroke); return true;
        case 'bathtub': drawBathtub(ctx, w, d, fill, stroke); return true;
        case 'shower': drawShower(ctx, w, d, fill, stroke); return true;
        case 'showerQuarter': drawShowerQuarter(ctx, w, d, fill, stroke); return true;
        case 'toilet': drawToilet(ctx, w, d, fill, stroke); return true;
        case 'bidet': drawBidet(ctx, w, d, fill, stroke); return true;
        case 'urinal': drawUrinal(ctx, w, d, fill, stroke); return true;
        case 'sink': drawSink(ctx, w, d, fill, stroke); return true;
        case 'doubleSink': drawDoubleSink(ctx, w, d, fill, stroke); return true;
        case 'kitchen': drawKitchen(ctx, w, d, 'kueche', fill, stroke); return true;
        case 'fridge': drawKitchen(ctx, w, d, 'kuehlschrank', fill, stroke); return true;
        case 'stove': drawKitchen(ctx, w, d, 'herd', fill, stroke); return true;
        case 'washer': drawWasher(ctx, w, d, fill, stroke); return true;
        default: return false;
    }
};

const drawFurniture2D = (ctx, vp, furn, selected) => {
    const sw = Number(furn.width_mm) * vp.zoom;
    const sd = Number(furn.depth_mm) * vp.zoom;
    // Ungültige Maße (0, leer, negativ) nicht zeichnen – Tiefe 0 führte zu einer
    // Endlosschleife im Schranksymbol; der Auswahlrahmen bleibt sichtbar
    if (!Number.isFinite(sw) || !Number.isFinite(sd) || sw <= 0 || sd <= 0) return;

    const s = worldToScreen(vp, Number(furn.x) || 0, Number(furn.y) || 0);
    ctx.save();
    try {
        ctx.translate(s.x, s.y);
        ctx.rotate(((Number(furn.rotation) || 0) * Math.PI) / 180);

        const catItem = getFurnitureItem(furn.catalog_id);
        const catId = furn.catalog_id || '';

        // Base fill
        const baseColor = selected ? '#dbeafe' : (catItem?.color || FURNITURE_FILL);
        const strokeColor = selected ? SELECTION_COLOR : FURNITURE_STROKE;
        ctx.fillStyle = baseColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = selected ? 2 : 1.2;

        // Choose drawing based on furniture type
        const symbol = resolveFurnitureSymbol(catId, catItem);
        if (!drawFurnitureSymbol(ctx, symbol, sw, sd, catId, baseColor, strokeColor)) {
            // Default: rounded rectangle with label
            drawDefaultFurniture(ctx, sw, sd, furn, catItem, baseColor, strokeColor);
        }
    } finally {
        ctx.restore();
    }
};

const drawSofa = (ctx, w, d, catId, fill, stroke) => {
    const r = Math.min(4, w * 0.05);
    // Backrest
    ctx.fillStyle = darkenColor(fill, 20);
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d * 0.25, [r, r, 0, 0]);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.stroke();

    // Seat cushion
    ctx.fillStyle = fill;
    ctx.beginPath();
    roundRectPath(ctx, 0, d * 0.25, w, d * 0.65, 0);
    ctx.fill();
    ctx.stroke();

    // Armrests
    ctx.fillStyle = darkenColor(fill, 15);
    ctx.beginPath();
    roundRectPath(ctx, 0, d * 0.2, w * 0.12, d * 0.7, [0, r, r, 0]);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    roundRectPath(ctx, w * 0.88, d * 0.2, w * 0.12, d * 0.7, [r, 0, 0, r]);
    ctx.fill();
    ctx.stroke();

    // Seat divisions
    const seats = catId === 'sofa_3er' ? 3 : (catId === 'sofa_2er' ? 2 : 1);
    if (seats > 1) {
        ctx.strokeStyle = darkenColor(stroke, -30);
        ctx.lineWidth = 0.8;
        for (let i = 1; i < seats; i++) {
            const x = (w * 0.13) + (w * 0.74 / seats) * i;
            ctx.beginPath();
            ctx.moveTo(x, d * 0.3);
            ctx.lineTo(x, d * 0.85);
            ctx.stroke();
        }
    }

    // Front cushion line
    ctx.strokeStyle = darkenColor(stroke, -20);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    roundRectPath(ctx, w * 0.13, d * 0.85, w * 0.74, d * 0.12, [0, 0, r, r]);
    ctx.stroke();
};

const drawBed = (ctx, w, d, fill, stroke) => {
    // Mattress
    ctx.fillStyle = '#f1f5f9';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d, 3);
    ctx.fill();
    ctx.stroke();

    // Headboard
    ctx.fillStyle = darkenColor(fill, 25);
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d * 0.08, [3, 3, 0, 0]);
    ctx.fill();
    ctx.stroke();

    // Pillow(s)
    ctx.fillStyle = '#e2e8f0';
    const pillowCount = w > d * 0.8 ? 2 : 1;
    const pillowW = pillowCount === 2 ? w * 0.42 : w * 0.6;
    const pillowH = d * 0.15;
    const py = d * 0.12;
    if (pillowCount === 2) {
        ctx.beginPath();
        roundRectPath(ctx, w * 0.06, py, pillowW, pillowH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        roundRectPath(ctx, w * 0.52, py, pillowW, pillowH, 4);
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.beginPath();
        roundRectPath(ctx, w * 0.2, py, pillowW, pillowH, 4);
        ctx.fill();
        ctx.stroke();
    }

    // Blanket fold line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, d * 0.55);
    ctx.lineTo(w * 0.9, d * 0.55);
    ctx.stroke();
};

const drawTable = (ctx, w, d, fill, stroke) => {
    // Table top
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d, 3);
    ctx.fill();
    ctx.stroke();

    // Table legs (4 corners)
    ctx.fillStyle = darkenColor(stroke, -20);
    const legSize = Math.min(w * 0.08, d * 0.08, 6);
    ctx.fillRect(2, 2, legSize, legSize);
    ctx.fillRect(w - legSize - 2, 2, legSize, legSize);
    ctx.fillRect(2, d - legSize - 2, legSize, legSize);
    ctx.fillRect(w - legSize - 2, d - legSize - 2, legSize, legSize);
};

const drawChair = (ctx, w, d, fill, stroke) => {
    // Seat (circle or square)
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    const cx = w / 2, cy = d / 2;
    const r = Math.min(w, d) * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Backrest
    ctx.fillStyle = darkenColor(fill, 20);
    ctx.beginPath();
    ctx.arc(cx, d * 0.15, r * 0.7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.fill();
    ctx.stroke();
};

const drawCabinet = (ctx, w, d, fill, stroke) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(0, 0, w, d);
    ctx.fill();
    ctx.stroke();

    // Door lines (Türenzahl begrenzt; ohne Tiefe keine Teilung – sonst Endlosschleife)
    if (w > 20 && d >= 1) {
        const doors = Math.min(12, Math.max(1, Math.round(w / (d * 1.5))));
        ctx.strokeStyle = darkenColor(stroke, -30);
        ctx.lineWidth = 0.7;
        for (let i = 1; i < doors; i++) {
            const x = (w / doors) * i;
            ctx.beginPath();
            ctx.moveTo(x, 1);
            ctx.lineTo(x, d - 1);
            ctx.stroke();
        }
        // Door handles
        ctx.fillStyle = '#94a3b8';
        for (let i = 0; i < doors; i++) {
            const cx = (w / doors) * (i + 0.85);
            ctx.beginPath();
            ctx.arc(cx, d * 0.5, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
};

const drawBathtub = (ctx, w, d, fill, stroke) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d, 6);
    ctx.fill();
    ctx.stroke();

    // Inner tub
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRectPath(ctx, w * 0.08, d * 0.08, w * 0.84, d * 0.84, 10);
    ctx.fill();
    ctx.stroke();

    // Drain
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(w * 0.5, d * 0.85, 3, 0, Math.PI * 2);
    ctx.fill();
};

const drawShower = (ctx, w, d, fill, stroke) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d, 2);
    ctx.fill();
    ctx.stroke();

    // Floor tiles pattern
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.5;
    const step = Math.max(8, Math.min(w, d) / 5);
    for (let x = step; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, d);
        ctx.stroke();
    }
    for (let y = step; y < d; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Drain
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(w * 0.5, d * 0.5, 3, 0, Math.PI * 2);
    ctx.fill();

    // Showerhead
    ctx.beginPath();
    ctx.arc(w * 0.5, d * 0.15, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.stroke();
};

const drawToilet = (ctx, w, d, fill, stroke) => {
    // Tank
    ctx.fillStyle = darkenColor(fill, 10);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    roundRectPath(ctx, w * 0.1, 0, w * 0.8, d * 0.3, [3, 3, 0, 0]);
    ctx.fill();
    ctx.stroke();

    // Bowl
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(w / 2, d * 0.65, w * 0.42, d * 0.33, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.ellipse(w / 2, d * 0.65, w * 0.28, d * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.7;
    ctx.stroke();
};

const drawSink = (ctx, w, d, fill, stroke) => {
    // Counter
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d, 2);
    ctx.fill();
    ctx.stroke();

    // Basin
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(w / 2, d * 0.5, w * 0.35, d * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Faucet dot
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(w * 0.5, d * 0.12, 2, 0, Math.PI * 2);
    ctx.fill();
};

const drawKitchen = (ctx, w, d, catId, fill, stroke) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(0, 0, w, d);
    ctx.fill();
    ctx.stroke();

    if (catId === 'herd') {
        // 4 burners
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        const cx1 = w * 0.3, cx2 = w * 0.7, cy1 = d * 0.35, cy2 = d * 0.7;
        const r = Math.min(w * 0.15, d * 0.15);
        for (const [cx, cy] of [[cx1, cy1], [cx2, cy1], [cx1, cy2], [cx2, cy2]]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    } else if (catId === 'kuehlschrank') {
        // Fridge handle
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w * 0.85, d * 0.15);
        ctx.lineTo(w * 0.85, d * 0.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w * 0.85, d * 0.55);
        ctx.lineTo(w * 0.85, d * 0.85);
        ctx.stroke();
        // Split line
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, d * 0.45);
        ctx.lineTo(w, d * 0.45);
        ctx.stroke();
    } else {
        // Generic kitchen counter: sink circle
        ctx.fillStyle = '#e0f2fe';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(w * 0.5, d * 0.55, Math.min(w, d) * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
};

const drawWasher = (ctx, w, d, fill, stroke) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(0, 0, w, d);
    ctx.fill();
    ctx.stroke();

    // Door circle
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w / 2, d * 0.55, Math.min(w, d) * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(w / 2, d * 0.55, Math.min(w, d) * 0.18, 0, Math.PI * 2);
    ctx.stroke();

    // Control panel
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.rect(w * 0.1, d * 0.05, w * 0.8, d * 0.12);
    ctx.fill();
    ctx.stroke();
};

// ─── Sanitär: Bidet ──────────────────────────────────────────────
const drawBidet = (ctx, w, d, fill, stroke) => {
    // Outer body (rounded rectangle with rounded front)
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    roundRectPath(ctx, w * 0.05, 0, w * 0.9, d * 0.35, [3, 3, 0, 0]);
    ctx.fill();
    ctx.stroke();

    // Bowl (elongated oval)
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(w / 2, d * 0.62, w * 0.4, d * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner basin
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.ellipse(w / 2, d * 0.62, w * 0.26, d * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Water nozzle (small dot)
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(w / 2, d * 0.55, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Faucet
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(w / 2, d * 0.15, 2, 0, Math.PI * 2);
    ctx.fill();
};

// ─── Sanitär: Urinal ────────────────────────────────────────────
const drawUrinal = (ctx, w, d, fill, stroke) => {
    // Outer shell (trapezoid top-view)
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, 0);
    ctx.lineTo(w * 0.85, 0);
    ctx.lineTo(w * 0.9, d * 0.3);
    ctx.quadraticCurveTo(w * 0.9, d * 0.85, w / 2, d);
    ctx.quadraticCurveTo(w * 0.1, d * 0.85, w * 0.1, d * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner basin
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(w * 0.25, d * 0.15);
    ctx.lineTo(w * 0.75, d * 0.15);
    ctx.lineTo(w * 0.78, d * 0.35);
    ctx.quadraticCurveTo(w * 0.78, d * 0.7, w / 2, d * 0.82);
    ctx.quadraticCurveTo(w * 0.22, d * 0.7, w * 0.22, d * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Drain dot
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(w / 2, d * 0.65, 2, 0, Math.PI * 2);
    ctx.fill();
};

// ─── Sanitär: Doppelwaschtisch ──────────────────────────────────
const drawDoubleSink = (ctx, w, d, fill, stroke) => {
    // Counter
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, w, d, 2);
    ctx.fill();
    ctx.stroke();

    // Left basin
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(w * 0.28, d * 0.5, w * 0.18, d * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Right basin
    ctx.beginPath();
    ctx.ellipse(w * 0.72, d * 0.5, w * 0.18, d * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Faucet dots
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(w * 0.28, d * 0.12, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w * 0.72, d * 0.12, 2, 0, Math.PI * 2);
    ctx.fill();

    // Divider line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(w / 2, d * 0.1);
    ctx.lineTo(w / 2, d * 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
};

// ─── Sanitär: Eckdusche (Viertelkreis) ──────────────────────────
const drawShowerQuarter = (ctx, w, d, fill, stroke) => {
    const r = Math.min(w, d);
    // Quarter-circle fill
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r, 0);
    ctx.arc(0, 0, r, 0, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner radius line (glass edge)
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI / 2);
    ctx.stroke();

    // Tray edge
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.88, 0, Math.PI / 2);
    ctx.stroke();

    // Drain
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(r * 0.35, r * 0.35, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Shower head dot
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(r * 0.15, r * 0.15, 2, 0, Math.PI * 2);
    ctx.fill();
};

const drawDefaultFurniture = (ctx, sw, sd, furn, catItem, fill, stroke) => {
    // Very subtle outline instead of a bold bounding rectangle
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    roundRectPath(ctx, 0, 0, sw, sd, 3);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    if (sw > 30 && sd > 15) {
        const fontSize = Math.max(8, Math.min(11, sw / 10));
        ctx.fillStyle = '#475569';
        ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = catItem?.name || String(furn.catalog_id || 'Möbel').replace(/_/g, ' ');
        ctx.fillText(label, sw / 2, sd / 2);
    }
};

/** Darken/lighten a hex color (nur #rrggbb, andere Formate unverändert) */
const darkenColor = (hex, amount) => {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    try {
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        r = Math.max(0, Math.min(255, r - amount));
        g = Math.max(0, Math.min(255, g - amount));
        b = Math.max(0, Math.min(255, b - amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch {
        return hex;
    }
};

// ─── Calibration overlay ────────────────────────────────────────
const drawCalibration = (ctx, vp, calibPoints) => {
    if (!calibPoints || calibPoints.length === 0) return;
    for (const pt of calibPoints) {
        const s = worldToScreen(vp, pt.x, pt.y);
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    if (calibPoints.length === 2) {
        const s1 = worldToScreen(vp, calibPoints[0].x, calibPoints[0].y);
        const s2 = worldToScreen(vp, calibPoints[1].x, calibPoints[1].y);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Distance label
        const dx = calibPoints[1].x - calibPoints[0].x;
        const dy = calibPoints[1].y - calibPoints[0].y;
        const distMm = Math.sqrt(dx * dx + dy * dy);
        const mx = (s1.x + s2.x) / 2;
        const my = (s1.y + s2.y) / 2;
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#ef4444';
        ctx.textAlign = 'center';
        ctx.fillText(`${(distMm / 1000).toFixed(2).replace('.', ',')} m`, mx, my - 10);
    }
};

// ─── Preview (tool-specific) ────────────────────────────────────

/** Wand mit genau diesen Endpunkten (Vorschau-Objekte enthalten nur Koordinaten). */
const findWallByEndpoints = (storey, a, b) => {
    if (!a || !b) return null;
    const near = (p, q) => p && q && Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1;
    return storey.walls.find(w => {
        const p1 = getPoint(storey, w.p1), p2 = getPoint(storey, w.p2);
        return near(p1, a) && near(p2, b);
    }) || null;
};

const drawPreview = (ctx, vp, state, storey, view) => {
    const { preview } = state;
    const viewW = view ? view.w : ctx.canvas.width;
    const viewH = view ? view.h : ctx.canvas.height;

    if (preview.type === 'wall_segment') {
        const s1 = worldToScreen(vp, preview.x1, preview.y1);
        const s2 = worldToScreen(vp, preview.x2, preview.y2);
        const len = dist({ x: preview.x1, y: preview.y1 }, { x: preview.x2, y: preview.y2 });

        if (preview.wallType === 'measure') {
            // Measurement line
            ctx.strokeStyle = '#0ea5e9';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // End dots
            for (const p of [s1, s2]) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#0ea5e9';
                ctx.fill();
            }
        } else {
            // Wall preview: draw as SOLID wall shape
            // Stärke und Seite aus dem Vorschau-Objekt (falls übergeben), sonst Standardwerte
            const thickness = Number(preview.thickness) > 0
                ? Number(preview.thickness)
                : (preview.wallType === 'outer' ? WALL_THICKNESS.outerDefault : WALL_THICKNESS.innerNonloadDefault);
            const dx = preview.x2 - preview.x1;
            const dy = preview.y2 - preview.y1;
            const wallLen = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / wallLen;
            const uy = dy / wallLen;
            const nx = -uy;
            const ny = ux;

            let pts;
            if (preview.wallType === 'outer') {
                // Innenbündig: reference = inner edge, thickness extends outward
                pts = [
                    worldToScreen(vp, preview.x1 - nx * thickness, preview.y1 - ny * thickness),
                    worldToScreen(vp, preview.x2 - nx * thickness, preview.y2 - ny * thickness),
                    worldToScreen(vp, preview.x2, preview.y2),
                    worldToScreen(vp, preview.x1, preview.y1),
                ];
            } else {
                // Inner wall: einseitig ab Referenzkante (wie das Ergebnis), ohne Angabe mittig
                let a = -thickness / 2, b = thickness / 2;
                if (preview.refEdge === 'left') { a = 0; b = thickness; }
                else if (preview.refEdge === 'right') { a = -thickness; b = 0; }
                pts = [
                    worldToScreen(vp, preview.x1 + nx * b, preview.y1 + ny * b),
                    worldToScreen(vp, preview.x2 + nx * b, preview.y2 + ny * b),
                    worldToScreen(vp, preview.x2 + nx * a, preview.y2 + ny * a),
                    worldToScreen(vp, preview.x1 + nx * a, preview.y1 + ny * a),
                ];
            }

            ctx.globalAlpha = 0.5;
            ctx.fillStyle = preview.wallType === 'outer' ? '#dce1e8' : '#d1d5db';
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Inner edge highlight (reference line)
            if (preview.wallType === 'outer') {
                ctx.strokeStyle = SELECTION_COLOR;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(pts[2].x, pts[2].y);
                ctx.lineTo(pts[3].x, pts[3].y);
                ctx.stroke();
            }

            // ── Corner miter preview (between last placed wall and current preview) ──
            if (preview.wallType === 'outer' && preview.prevX !== undefined) {
                // Find the last placed wall ending at (x1,y1) – die zuletzt gesetzte Wand,
                // nicht die erste passende
                const atStart = (p) => p && Math.abs(p.x - preview.x1) < 1 && Math.abs(p.y - preview.y1) < 1;
                let lastWall = null;
                for (let i = storey.walls.length - 1; i >= 0 && !lastWall; i--) {
                    const w = storey.walls[i];
                    if (w.type !== 'outer') continue;
                    if (atStart(getPoint(storey, w.p2)) || atStart(getPoint(storey, w.p1))) lastWall = w;
                }
                if (lastWall) {
                    const lastPoly = getWallPolygon(lastWall, storey);
                    if (lastPoly) {
                        // Determine which end connects to preview start
                        const isP2 = atStart(getPoint(storey, lastWall.p2));

                        const oc1Near = isP2 ? lastPoly[1] : lastPoly[0];
                        const oc1Far = isP2 ? lastPoly[0] : lastPoly[1];

                        // Preview outer edge: pts[0]=outer_start, pts[1]=outer_end
                        const oc2Near = { x: (preview.x1 - nx * thickness), y: (preview.y1 - ny * thickness) };
                        const oc2Far = { x: (preview.x2 - nx * thickness), y: (preview.y2 - ny * thickness) };

                        // Compute miter point (mit Begrenzung gegen Spitzen)
                        const limit = MITER_LIMIT_FACTOR * Math.max(thickness, Number(lastWall.thickness_mm) || 0);
                        const miter = computeMiterPoint(oc1Near, oc1Far, oc2Near, oc2Far,
                            { x: preview.x1, y: preview.y1 }, limit);

                        if (miter) {
                            const cPts = [
                                worldToScreen(vp, oc1Near.x, oc1Near.y),
                                worldToScreen(vp, miter.x, miter.y),
                                worldToScreen(vp, oc2Near.x, oc2Near.y),
                                worldToScreen(vp, preview.x1, preview.y1),
                            ];

                            ctx.globalAlpha = 0.5;
                            ctx.fillStyle = '#dce1e8';
                            ctx.beginPath();
                            ctx.moveTo(cPts[0].x, cPts[0].y);
                            ctx.lineTo(cPts[1].x, cPts[1].y);
                            ctx.lineTo(cPts[2].x, cPts[2].y);
                            ctx.lineTo(cPts[3].x, cPts[3].y);
                            ctx.closePath();
                            ctx.fill();
                            ctx.globalAlpha = 1;

                            ctx.strokeStyle = '#475569';
                            ctx.lineWidth = 1.5;
                            ctx.beginPath();
                            ctx.moveTo(cPts[0].x, cPts[0].y);
                            ctx.lineTo(cPts[1].x, cPts[1].y);
                            ctx.lineTo(cPts[2].x, cPts[2].y);
                            ctx.stroke();
                        }
                    }
                }
            }

            // ── Guide lines from existing wall endpoints ──
            const guideThreshold = 15; // mm tolerance for alignment (increased for easier use)
            const allPoints = storey.points;
            ctx.save();
            try {
                ctx.strokeStyle = 'rgba(236, 72, 153, 0.7)'; // brighter pink
                ctx.lineWidth = 1.5;
                ctx.setLineDash([8, 4]);
                let hGuideDrawn = false, vGuideDrawn = false;
                for (const pt of allPoints) {
                    // Horizontal guide (same Y as preview endpoint)
                    if (!hGuideDrawn && Math.abs(pt.y - preview.y2) < guideThreshold && Math.abs(pt.x - preview.x2) > 50) {
                        ctx.beginPath();
                        ctx.moveTo(0, s2.y);
                        ctx.lineTo(viewW, s2.y);
                        ctx.stroke();
                        // Diamond marker at aligned point
                        const alignedPtScreen = worldToScreen(vp, pt.x, pt.y);
                        ctx.fillStyle = 'rgba(236, 72, 153, 0.8)';
                        ctx.beginPath();
                        ctx.moveTo(alignedPtScreen.x, alignedPtScreen.y - 5);
                        ctx.lineTo(alignedPtScreen.x + 5, alignedPtScreen.y);
                        ctx.lineTo(alignedPtScreen.x, alignedPtScreen.y + 5);
                        ctx.lineTo(alignedPtScreen.x - 5, alignedPtScreen.y);
                        ctx.closePath();
                        ctx.fill();
                        hGuideDrawn = true;
                    }
                }
                for (const pt of allPoints) {
                    // Vertical guide (same X as preview endpoint)
                    if (!vGuideDrawn && Math.abs(pt.x - preview.x2) < guideThreshold && Math.abs(pt.y - preview.y2) > 50) {
                        ctx.beginPath();
                        ctx.moveTo(s2.x, 0);
                        ctx.lineTo(s2.x, viewH);
                        ctx.stroke();
                        // Diamond marker at aligned point
                        const alignedPtScreen = worldToScreen(vp, pt.x, pt.y);
                        ctx.fillStyle = 'rgba(236, 72, 153, 0.8)';
                        ctx.beginPath();
                        ctx.moveTo(alignedPtScreen.x, alignedPtScreen.y - 5);
                        ctx.lineTo(alignedPtScreen.x + 5, alignedPtScreen.y);
                        ctx.lineTo(alignedPtScreen.x, alignedPtScreen.y + 5);
                        ctx.lineTo(alignedPtScreen.x - 5, alignedPtScreen.y);
                        ctx.closePath();
                        ctx.fill();
                        vGuideDrawn = true;
                    }
                }
            } finally {
                ctx.restore();
            }
        }

        // Length label (prominent)
        const mx = (s1.x + s2.x) / 2;
        const my = (s1.y + s2.y) / 2;

        // Offset perpendicular
        const ldx = s2.x - s1.x, ldy = s2.y - s1.y;
        const llen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lnx = -ldy / llen, lny = ldx / llen;
        const labelOffset = 22;

        const labelText = mmToM(len) + ' m';
        ctx.font = 'bold 12px Inter, system-ui, sans-serif';
        const metrics = ctx.measureText(labelText);
        const pad = 5;
        const lx = mx + lnx * labelOffset;
        const ly = my + lny * labelOffset;

        ctx.fillStyle = 'rgba(14,165,233,0.9)';
        ctx.fillRect(lx - metrics.width / 2 - pad, ly - 8 - pad, metrics.width + pad * 2, 16 + pad * 2);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, lx, ly);

        // Angle display (between previous segment and current preview)
        if (preview.prevX !== undefined && preview.prevY !== undefined) {
            const prevS = worldToScreen(vp, preview.prevX, preview.prevY);
            // Corner point is s1 (start of current segment = end of previous)
            // Compute angle between prev→corner and corner→current
            const a1 = Math.atan2(prevS.y - s1.y, prevS.x - s1.x);
            const a2 = Math.atan2(s2.y - s1.y, s2.x - s1.x);

            // Kleinerer Winkel zwischen beiden Schenkeln, über ±180° hinweg korrekt
            let diff = a2 - a1;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const displayDeg = Math.round(Math.abs(diff) * 180 / Math.PI);

            // Draw arc
            const arcRadius = 25;
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s1.x, s1.y, arcRadius, a1, a1 + diff, diff < 0);
            ctx.stroke();

            // Angle label (auf der Winkelhalbierenden des eingeschlossenen Winkels)
            const midAngle = a1 + diff / 2;
            const ax = s1.x + Math.cos(midAngle) * (arcRadius + 15);
            const ay = s1.y + Math.sin(midAngle) * (arcRadius + 15);
            const angleText = displayDeg + '°';
            ctx.font = 'bold 11px Inter, system-ui, sans-serif';
            const angleMeasure = ctx.measureText(angleText);
            ctx.fillStyle = 'rgba(245,158,11,0.9)';
            ctx.fillRect(ax - angleMeasure.width / 2 - 4, ay - 7 - 3, angleMeasure.width + 8, 14 + 6);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(angleText, ax, ay);
        }
    }

    if (preview.type === 'close_indicator') {
        const s = worldToScreen(vp, preview.x, preview.y);

        // Draw closing wall as SOLID wall shape (same as other wall segments)
        if (preview.x1 !== undefined && preview.y1 !== undefined) {
            const s1 = worldToScreen(vp, preview.x1, preview.y1);
            const thickness = Number(preview.thickness) > 0 ? Number(preview.thickness) : WALL_THICKNESS.outerDefault;
            const cdx = preview.x - preview.x1;
            const cdy = preview.y - preview.y1;
            const cLen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
            const cux = cdx / cLen;
            const cuy = cdy / cLen;
            const cnx = -cuy;
            const cny = cux;

            // Innenbündig: reference = inner edge, thickness extends outward
            const closePts = [
                worldToScreen(vp, preview.x1 - cnx * thickness, preview.y1 - cny * thickness),
                worldToScreen(vp, preview.x - cnx * thickness, preview.y - cny * thickness),
                worldToScreen(vp, preview.x, preview.y),
                worldToScreen(vp, preview.x1, preview.y1),
            ];

            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#dce1e8';
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(closePts[0].x, closePts[0].y);
            for (let i = 1; i < closePts.length; i++) ctx.lineTo(closePts[i].x, closePts[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Inner edge highlight (reference line)
            ctx.strokeStyle = SELECTION_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(closePts[2].x, closePts[2].y);
            ctx.lineTo(closePts[3].x, closePts[3].y);
            ctx.stroke();

            // Length label on the closing segment
            const lenMm = cLen;
            const midSx = (s1.x + s.x) / 2, midSy = (s1.y + s.y) / 2;
            const lnxs = -(s.y - s1.y) / (Math.sqrt((s.x - s1.x) ** 2 + (s.y - s1.y) ** 2) || 1);
            const lnys = (s.x - s1.x) / (Math.sqrt((s.x - s1.x) ** 2 + (s.y - s1.y) ** 2) || 1);
            const labelOff = 22;
            const clx = midSx + lnxs * labelOff;
            const cly = midSy + lnys * labelOff;
            const lenText = mmToM(lenMm) + ' m';
            ctx.font = 'bold 12px Inter, system-ui, sans-serif';
            const cMetrics = ctx.measureText(lenText);
            const cPad = 5;
            ctx.fillStyle = 'rgba(14,165,233,0.9)';
            ctx.fillRect(clx - cMetrics.width / 2 - cPad, cly - 8 - cPad, cMetrics.width + cPad * 2, 16 + cPad * 2);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(lenText, clx, cly);
        }

        // Snap circle at start point
        ctx.beginPath();
        ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = '#15803d';
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Klicken zum Schließen', s.x, s.y - 22);
    }

    if (preview.type === 'measure_start') {
        // First measurement point indicator
        const s = worldToScreen(vp, preview.x, preview.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#0ea5e9';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Pulsing ring
        ctx.beginPath();
        ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#0ea5e9';
        ctx.font = '600 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Startpunkt', s.x, s.y - 20);
    }

    if (preview.type === 'furniture_ghost') {
        const sw = Number(preview.width) * vp.zoom;
        const sd = Number(preview.depth) * vp.zoom;
        if (Number.isFinite(sw) && Number.isFinite(sd) && sw > 0 && sd > 0) {
            ctx.save();
            try {
                const s = worldToScreen(vp, preview.x, preview.y);
                ctx.globalAlpha = 0.5;
                ctx.translate(s.x, s.y);
                ctx.rotate((preview.rotation || 0) * Math.PI / 180);

                // Gleiche Symbolwahl wie beim platzierten Möbelstück
                const catId = preview.catalogId || '';
                const baseColor = FURNITURE_FILL;
                const strokeColor = FURNITURE_STROKE;
                ctx.fillStyle = baseColor;
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 1.5;

                const symbol = resolveFurnitureSymbol(catId, getFurnitureItem(catId));
                if (!drawFurnitureSymbol(ctx, symbol, sw, sd, catId, baseColor, strokeColor)) {
                    // Default: simple shape without bounding rectangle
                    ctx.beginPath();
                    roundRectPath(ctx, 0, 0, sw, sd, 3);
                    ctx.fill();
                    ctx.stroke();
                }
            } finally {
                ctx.restore();
            }
        }
    }

    if (preview.type === 'opening_ghost') {
        const s1 = worldToScreen(vp, preview.x1, preview.y1);
        const s2 = worldToScreen(vp, preview.x2, preview.y2);
        const isDoor = preview.openingType === 'door';
        const color = isDoor ? DOOR_ARC_COLOR : WINDOW_STROKE_COLOR;

        const dx = preview.x2 - preview.x1, dy = preview.y2 - preview.y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len, ny = dx / len;

        // Wandflächen wie in drawOpening: aus der echten Wand, sonst aus den Vorschau-Angaben
        const hostWall = findWallByEndpoints(storey, preview.wallP1, preview.wallP2);
        const faces = hostWall ? getWallFaceOffsets(hostWall, storey) : null;
        let sideA = 0, sideB = 0, interiorSign = 1;
        if (faces) {
            sideA = faces.min; sideB = faces.max; interiorSign = faces.interiorSign;
        } else if (preview.thickness) {
            if (preview.wallType === 'outer') {
                sideA = -preview.thickness; sideB = 0;
            } else if (preview.refEdge === 'left') {
                sideA = 0; sideB = preview.thickness;
            } else {
                sideA = -preview.thickness; sideB = 0;
            }
        }
        const hasBody = sideB - sideA > 0;

        // Draw wall break (white gap) — use correct wall surface offsets
        if (hasBody) {
            const margin = 2; // Aussparung etwas breiter als die Wand
            const c1 = worldToScreen(vp, preview.x1 + nx * (sideA - margin), preview.y1 + ny * (sideA - margin));
            const c2 = worldToScreen(vp, preview.x2 + nx * (sideA - margin), preview.y2 + ny * (sideA - margin));
            const c3 = worldToScreen(vp, preview.x2 + nx * (sideB + margin), preview.y2 + ny * (sideB + margin));
            const c4 = worldToScreen(vp, preview.x1 + nx * (sideB + margin), preview.y1 + ny * (sideB + margin));
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y);
            ctx.lineTo(c2.x, c2.y);
            ctx.lineTo(c3.x, c3.y);
            ctx.lineTo(c4.x, c4.y);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // Offset to wall center for correct visual placement
        const centerOffset = hasBody ? (sideA + sideB) / 2 : 0;
        const sc1 = worldToScreen(vp, preview.x1 + nx * centerOffset, preview.y1 + ny * centerOffset);
        const sc2 = worldToScreen(vp, preview.x2 + nx * centerOffset, preview.y2 + ny * centerOffset);

        // Opening line/shape
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(sc1.x, sc1.y);
        ctx.lineTo(sc2.x, sc2.y);
        ctx.stroke();

        if (isDoor) {
            // Door arc preview: Anschlag/Aufschlag wie beim Platzieren (Standard links/innen)
            const swingLeft = (preview.swing || 'left') === 'left';
            const inward = preview.direction !== 'outward';
            const swingSign = inward ? interiorSign : -interiorSign;
            const hingeOffset = swingSign > 0 ? sideB : sideA;
            const hingeW = swingLeft
                ? { x: preview.x1 + nx * hingeOffset, y: preview.y1 + ny * hingeOffset }
                : { x: preview.x2 + nx * hingeOffset, y: preview.y2 + ny * hingeOffset };
            const freeW = swingLeft
                ? { x: preview.x2 + nx * hingeOffset, y: preview.y2 + ny * hingeOffset }
                : { x: preview.x1 + nx * hingeOffset, y: preview.y1 + ny * hingeOffset };
            const leafW = { x: hingeW.x + nx * swingSign * len, y: hingeW.y + ny * swingSign * len };
            const hs = worldToScreen(vp, hingeW.x, hingeW.y);
            const fs = worldToScreen(vp, freeW.x, freeW.y);
            const ls = worldToScreen(vp, leafW.x, leafW.y);
            const arcR = Math.sqrt((ls.x - hs.x) ** 2 + (ls.y - hs.y) ** 2);
            const leafAngle = Math.atan2(ls.y - hs.y, ls.x - hs.x);
            const freeAngle = Math.atan2(fs.y - hs.y, fs.x - hs.x);
            let angleDiff = freeAngle - leafAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(hs.x, hs.y);
            ctx.lineTo(ls.x, ls.y);
            if (arcR > 0) ctx.arc(hs.x, hs.y, arcR, leafAngle, freeAngle, angleDiff < 0);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            // Window: double line
            const wdx = sc2.x - sc1.x, wdy = sc2.y - sc1.y;
            const wlen = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
            const onx = -wdy / wlen * 4, ony = wdx / wlen * 4;
            ctx.lineWidth = 2;
            // Double line
            ctx.beginPath();
            ctx.moveTo(sc1.x + onx, sc1.y + ony);
            ctx.lineTo(sc2.x + onx, sc2.y + ony);
            ctx.moveTo(sc1.x - onx, sc1.y - ony);
            ctx.lineTo(sc2.x - onx, sc2.y - ony);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Measurement labels: left and right distance
        if (preview.wallP1 && preview.wallP2 && preview.position_mm !== undefined) {
            const leftDist = preview.position_mm - preview.width_mm / 2;
            const rightDist = preview.wall_len - preview.position_mm - preview.width_mm / 2;
            const fmtDist = (d) => (d >= 1000 ? mmToM(d) + ' m' : Math.round(d) + ' mm');

            const wp1s = worldToScreen(vp, preview.wallP1.x, preview.wallP1.y);
            const wp2s = worldToScreen(vp, preview.wallP2.x, preview.wallP2.y);

            // Wall direction normal for offset
            const wdx = wp2s.x - wp1s.x, wdy = wp2s.y - wp1s.y;
            const wlen = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
            const wnx = -wdy / wlen * 14, wny = wdx / wlen * 14;

            ctx.font = '600 10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#0ea5e9';

            // Left measurement (wall p1 → opening start)
            if (leftDist > 10) {
                const lmx = (wp1s.x + s1.x) / 2 + wnx;
                const lmy = (wp1s.y + s1.y) / 2 + wny;
                ctx.fillText(fmtDist(leftDist), lmx, lmy);
                // Dimension line
                ctx.strokeStyle = '#0ea5e9';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(wp1s.x + wnx * 0.5, wp1s.y + wny * 0.5);
                ctx.lineTo(s1.x + wnx * 0.5, s1.y + wny * 0.5);
                ctx.stroke();
            }

            // Right measurement (opening end → wall p2)
            if (rightDist > 10) {
                const rmx = (s2.x + wp2s.x) / 2 + wnx;
                const rmy = (s2.y + wp2s.y) / 2 + wny;
                ctx.fillText(fmtDist(rightDist), rmx, rmy);
                ctx.strokeStyle = '#0ea5e9';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(s2.x + wnx * 0.5, s2.y + wny * 0.5);
                ctx.lineTo(wp2s.x + wnx * 0.5, wp2s.y + wny * 0.5);
                ctx.stroke();
            }
        }
    }

    // Slab polygon drawing preview
    if (preview.type === 'slab_segment' || preview.type === 'slab_close_indicator') {
        const polygon = preview.polygon || [];

        // Draw existing polygon edges
        if (polygon.length >= 2) {
            ctx.beginPath();
            const fp = worldToScreen(vp, polygon[0].x, polygon[0].y);
            ctx.moveTo(fp.x, fp.y);
            for (let i = 1; i < polygon.length; i++) {
                const p = worldToScreen(vp, polygon[i].x, polygon[i].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw polygon fill (semi-transparent)
        if (polygon.length >= 3) {
            ctx.beginPath();
            const fp = worldToScreen(vp, polygon[0].x, polygon[0].y);
            ctx.moveTo(fp.x, fp.y);
            for (let i = 1; i < polygon.length; i++) {
                const p = worldToScreen(vp, polygon[i].x, polygon[i].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
            ctx.fillStyle = 'rgba(59, 130, 246, 0.06)';
            ctx.fill();
        }

        // Draw vertex dots
        for (let i = 0; i < polygon.length; i++) {
            const sp = worldToScreen(vp, polygon[i].x, polygon[i].y);
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, i === 0 ? 5 : 3.5, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? '#22c55e' : '#3b82f6';
            ctx.fill();
            if (i === 0) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Current segment preview line
        if (preview.type === 'slab_segment') {
            const s1 = worldToScreen(vp, preview.x1, preview.y1);
            const s2 = worldToScreen(vp, preview.x2, preview.y2);
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Close indicator
        if (preview.type === 'slab_close_indicator') {
            const sp = worldToScreen(vp, preview.x, preview.y);
            // Line from last point to start
            const s1 = worldToScreen(vp, preview.x1, preview.y1);
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(sp.x, sp.y);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Highlight start point
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
            ctx.fill();
        }
    }

    // ── Annotation previews ──────────────────────────────
    // (standen früher innerhalb des Decken-Blocks und wurden daher nie gezeichnet)
    if (preview.type === 'annotation_line') {
        const color = preview.color || '#ef4444';
        const lw = preview.lineWidth || 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        if (preview.points && preview.points.length > 0) {
            const sp0 = worldToScreen(vp, preview.points[0].x, preview.points[0].y);
            ctx.moveTo(sp0.x, sp0.y);
            for (let i = 1; i < preview.points.length; i++) {
                const sp = worldToScreen(vp, preview.points[i].x, preview.points[i].y);
                ctx.lineTo(sp.x, sp.y);
            }
            if (preview.x2 !== undefined && preview.y2 !== undefined) {
                const spEnd = worldToScreen(vp, preview.x2, preview.y2);
                ctx.lineTo(spEnd.x, spEnd.y);
            }
            if (preview.closed) {
                ctx.lineTo(sp0.x, sp0.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw dots on committed points
            for (const pt of preview.points) {
                const sh = worldToScreen(vp, pt.x, pt.y);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(sh.x, sh.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.setLineDash([]);
    }

    if (preview.type === 'annotation_circle') {
        const sc = worldToScreen(vp, preview.cx, preview.cy);
        const edgePt = worldToScreen(vp, preview.cx + (Number(preview.radius) || 0), preview.cy);
        const screenRadius = Math.abs(edgePt.x - sc.x);
        ctx.strokeStyle = preview.color || '#ef4444';
        ctx.lineWidth = preview.lineWidth || 2;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, screenRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Center dot
        ctx.fillStyle = preview.color || '#ef4444';
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }
};
