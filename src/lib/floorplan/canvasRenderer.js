// ─── Canvas Renderer ────────────────────────────────────────────────
// 2D rendering engine for the floor plan editor.
// Renders grid, walls as merged surfaces, openings, 2D furniture, rooms, labels.

import {
    GRID_COLOR, GRID_COLOR_MAJOR, OUTER_WALL_COLOR, INNER_WALL_COLOR,
    OPENING_COLOR, DOOR_ARC_COLOR, WINDOW_STROKE_COLOR, ROOM_LABEL_COLOR,
    FURNITURE_FILL, FURNITURE_STROKE, SELECTION_COLOR, SNAP_INDICATOR_COLOR,
    DIMENSION_COLOR, mmToM, mm2ToM2,
} from './constants.js';
import { getPoint, getWallPolygon, dist, polygonCentroid } from './geometryKernel.js';
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
    const factor = delta > 0 ? 0.9 : 1.1;
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
    // Include furniture
    if (storey.furniture) {
        for (const f of storey.furniture) {
            const fw = (f.width_mm || 500) / 2;
            const fh = (f.depth_mm || 500) / 2;
            if (f.x - fw < minX) minX = f.x - fw;
            if (f.y - fh < minY) minY = f.y - fh;
            if (f.x + fw > maxX) maxX = f.x + fw;
            if (f.y + fh > maxY) maxY = f.y + fh;
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

/**
 * Compute the miter (intersection) point of two wall edges at a junction.
 * Each edge is defined by a near point and a far point.
 * Returns the intersection point, or null if edges are parallel.
 */
const computeMiterPoint = (near1, far1, near2, far2) => {
    const d1x = near1.x - far1.x, d1y = near1.y - far1.y;
    const d2x = near2.x - far2.x, d2y = near2.y - far2.y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.01) return null; // parallel
    const dx = near2.x - near1.x, dy = near2.y - near1.y;
    const t = (dx * d2y - dy * d2x) / cross;
    const ix = near1.x + t * d1x;
    const iy = near1.y + t * d1y;
    // Limit miter extension to avoid extreme spikes
    const miterDist = dist({ x: ix, y: iy }, near1);
    if (miterDist > 500) return null; // too far, skip
    return { x: ix, y: iy };
};

/**
 * Compute intersection of two infinite lines.
 * Line 1 goes through a1→a2, Line 2 goes through b1→b2.
 * Returns intersection point or null if parallel.
 */
const lineLineIntersect = (a1, a2, b1, b2) => {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.01) return null;
    const dx = b1.x - a1.x, dy = b1.y - a1.y;
    const t = (dx * d2y - dy * d2x) / cross;
    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
};

// ─── Main Render ────────────────────────────────────────────────

export const render = (ctx, canvas, vp, storey, state) => {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // Build set of selected IDs for fast lookup
    const selectedSet = new Set();
    if (state.selectedId) selectedSet.add(state.selectedId);
    if (state.selectedIds) {
        for (const item of state.selectedIds) selectedSet.add(item.id);
    }

    // Background
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

    // Grid (skip when background image is active or printing)
    if (!state.bgImage && !state.isPrinting) {
        drawGrid(ctx, vp, w, h);
    }

    // ── Walls as merged closed surfaces ──
    drawWallsMerged(ctx, vp, storey, state, selectedSet);

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
            const fw = (hoveredFurn.width_mm || 500) / 2;
            const fh = (hoveredFurn.depth_mm || 500) / 2;
            const p1 = worldToScreen(vp, hoveredFurn.x - fw, hoveredFurn.y - fh);
            const p2 = worldToScreen(vp, hoveredFurn.x + fw, hoveredFurn.y + fh);
            ctx.fillStyle = 'rgba(14, 165, 233, 0.12)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.5)';
            ctx.lineWidth = 2;
            ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
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
            const fw = (furn.width_mm || 500) / 2;
            const fh = (furn.depth_mm || 500) / 2;
            const fp1 = worldToScreen(vp, furn.x - fw, furn.y - fh);
            const fp2 = worldToScreen(vp, furn.x + fw, furn.y + fh);
            ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.6)';
            ctx.lineWidth = 2;
            ctx.fillRect(fp1.x, fp1.y, fp2.x - fp1.x, fp2.y - fp1.y);
            ctx.strokeRect(fp1.x, fp1.y, fp2.x - fp1.x, fp2.y - fp1.y);
        }
    }

    // Openings
    for (const opening of storey.openings) {
        drawOpening(ctx, vp, opening, storey, selectedSet.has(opening.id));
    }

    // Room fills (subtle background to show detected areas)
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
        drawRoomLabel(ctx, vp, room, isRoomSelected);
    }

    // Slabs
    for (const slab of (storey.slabs || [])) {
        drawSlab(ctx, vp, slab, selectedSet.has(slab.id));
    }

    // Roof overlay (2D)
    if (storey.roof && storey.outerBoundary) {
        drawRoof2D(ctx, vp, storey);
    }

    // Furniture (2D top-down)
    for (const furn of storey.furniture) {
        drawFurniture2D(ctx, vp, furn, selectedSet.has(furn.id));
    }

    // Draw wall dimensions (lichte Maße: inner surface to inner surface)
    // Only for inner walls — outer walls use the outer dimension chains below
    if (state.showDimensions !== false) {
        for (const wall of storey.walls) {
            if (wall.type === 'outer') continue; // outer walls have their own dimension chains
            const p1 = getPoint(storey, wall.p1);
            const p2 = getPoint(storey, wall.p2);
            if (!p1 || !p2) continue;
            const wallLen = dist(p1, p2);
            if (wallLen < 200) continue;

            // For "lichte Maße", subtract connected wall thickness at each endpoint
            // Inner walls: use half-thickness (measure to inner face, not center line)
            // Outer walls: innenbündig — thickness goes outward, so no subtraction needed
            let offsetP1 = 0, offsetP2 = 0;

            // Find perpendicular walls at p1
            for (const w2 of storey.walls) {
                if (w2.id === wall.id || w2.type === 'outer') continue; // skip self and outer walls
                if (w2.p1 === wall.p1 || w2.p2 === wall.p1) {
                    const w2p1 = getPoint(storey, w2.p1);
                    const w2p2 = getPoint(storey, w2.p2);
                    if (!w2p1 || !w2p2) continue;
                    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
                    const d2x = w2p2.x - w2p1.x, d2y = w2p2.y - w2p1.y;
                    const w2Len = dist(w2p1, w2p2);
                    if (w2Len < 1) continue;
                    const dot = Math.abs(d1x * d2x + d1y * d2y) / (wallLen * w2Len);
                    if (dot < 0.3) { // roughly perpendicular
                        offsetP1 = Math.max(offsetP1, w2.thickness_mm);
                    }
                }
            }

            // Find perpendicular walls at p2
            for (const w2 of storey.walls) {
                if (w2.id === wall.id || w2.type === 'outer') continue;
                if (w2.p1 === wall.p2 || w2.p2 === wall.p2) {
                    const w2p1 = getPoint(storey, w2.p1);
                    const w2p2 = getPoint(storey, w2.p2);
                    if (!w2p1 || !w2p2) continue;
                    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
                    const d2x = w2p2.x - w2p1.x, d2y = w2p2.y - w2p1.y;
                    const w2Len = dist(w2p1, w2p2);
                    if (w2Len < 1) continue;
                    const dot = Math.abs(d1x * d2x + d1y * d2y) / (wallLen * w2Len);
                    if (dot < 0.3) {
                        offsetP2 = Math.max(offsetP2, w2.thickness_mm);
                    }
                }
            }

            // Compute shortened dimension points (offset inward from corners)
            const dx = (p2.x - p1.x) / wallLen;
            const dy = (p2.y - p1.y) / wallLen;
            const dimP1 = { x: p1.x + dx * offsetP1, y: p1.y + dy * offsetP1 };
            const dimP2 = { x: p2.x - dx * offsetP2, y: p2.y - dy * offsetP2 };
            const dimLen = dist(dimP1, dimP2);
            if (dimLen < 100) continue;

            const isSel = selectedSet.has(wall.id);
            drawWallDimension(ctx, vp, dimP1, dimP2, !isSel);
        }

        // Normgerechte Bemaßung: Außenmaßketten (DIN 1356)
        if (storey.outerBoundary && storey.outerBoundary.length >= 3) {
            drawOuterDimensionChains(ctx, vp, storey);
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
                ctx.fillStyle = ann.fillColor || (ann.color + '33') || 'rgba(239,68,68,0.2)';
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
                ctx.roundRect(sc.x - 4, sc.y - 4, tw, th, 3);
                ctx.fill();
                ctx.stroke();
                // Text
                ctx.fillStyle = ann.color || '#ef4444';
                ctx.fillText(text, sc.x, sc.y);
                // Store hit box
                ann._hitBox = { sx: sc.x - 4, sy: sc.y - 4, sw: tw, sh: th };
            }
        }
    }

    // Calibration overlay
    if (state.calibPoints) {
        drawCalibration(ctx, vp, state.calibPoints);
    }

    // Tool overlays
    if (state.preview) {
        drawPreview(ctx, vp, state, storey);
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
                const label1 = (distToP1 / 1000).toFixed(2) + ' m';
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
                const label2 = (distToP2 / 1000).toFixed(2) + ' m';
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
                const fw = (furn.width_mm || 500) / 2;
                const fh = (furn.depth_mm || 500) / 2;
                const fp1 = worldToScreen(vp, furn.x - fw, furn.y - fh);
                const fp2 = worldToScreen(vp, furn.x + fw, furn.y + fh);
                ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
                ctx.strokeStyle = 'rgba(14, 165, 233, 0.6)';
                ctx.lineWidth = 2;
                ctx.fillRect(fp1.x, fp1.y, fp2.x - fp1.x, fp2.y - fp1.y);
                ctx.strokeRect(fp1.x, fp1.y, fp2.x - fp1.x, fp2.y - fp1.y);
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

    ctx.restore();
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

const drawWallsMerged = (ctx, vp, storey, state, selectedSet) => {
    // Outer walls: draw as single merged polygon (no visible segments)
    if (storey.outerClosed) {
        const outerWalls = storey.walls.filter(w => w.type === 'outer');
        if (outerWalls.length >= 3) {
            // Innenbündig: raw wall points = inner edge, compute mitered outer boundary
            const innerPts = buildOrderedOuterPoints(outerWalls, storey); // inner edge (drawn pts)

            // Build ordered wall chain for miter computation
            const orderedWalls = buildOrderedWallChain(outerWalls, storey);

            // Compute proper mitered outer boundary
            const outerPts = [];
            if (orderedWalls.length >= 3) {
                for (let i = 0; i < orderedWalls.length; i++) {
                    const w1 = orderedWalls[i];
                    const w2 = orderedWalls[(i + 1) % orderedWalls.length];
                    const poly1 = getWallPolygon(w1, storey);
                    const poly2 = getWallPolygon(w2, storey);
                    if (!poly1 || !poly2) continue;

                    // Find shared point between w1 and w2
                    let sharedPtId = null;
                    if (w1.p2 === w2.p1) sharedPtId = w1.p2;
                    else if (w1.p2 === w2.p2) sharedPtId = w1.p2;
                    else if (w1.p1 === w2.p1) sharedPtId = w1.p1;
                    else if (w1.p1 === w2.p2) sharedPtId = w1.p1;
                    if (!sharedPtId) continue;

                    // Get outer edge direction of each wall
                    const oc1Near = (sharedPtId === w1.p1) ? poly1[0] : poly1[1];
                    const oc1Far = (sharedPtId === w1.p1) ? poly1[1] : poly1[0];
                    const oc2Near = (sharedPtId === w2.p1) ? poly2[0] : poly2[1];
                    const oc2Far = (sharedPtId === w2.p1) ? poly2[1] : poly2[0];

                    // Compute miter intersection of the two outer edges
                    const d1x = oc1Near.x - oc1Far.x, d1y = oc1Near.y - oc1Far.y;
                    const d2x = oc2Near.x - oc2Far.x, d2y = oc2Near.y - oc2Far.y;
                    const cross = d1x * d2y - d1y * d2x;

                    if (Math.abs(cross) > 0.01) {
                        const dx = oc2Near.x - oc1Near.x;
                        const dy = oc2Near.y - oc1Near.y;
                        const t = (dx * d2y - dy * d2x) / cross;
                        outerPts.push({
                            x: oc1Near.x + t * d1x,
                            y: oc1Near.y + t * d1y,
                        });
                    } else {
                        outerPts.push({ x: (oc1Near.x + oc2Near.x) / 2, y: (oc1Near.y + oc2Near.y) / 2 });
                    }
                }
            }

            if (outerPts.length >= 3 && innerPts.length >= 3) {
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
            }

            // Selection highlight for ALL selected outer walls
            for (const ow of outerWalls) {
                if (selectedSet.has(ow.id)) {
                    drawWallSelectionHighlight(ctx, vp, ow, storey);
                }
            }
        }
    } else {
        // During drawing (not closed), render outer walls as merged shape (no internal gray lines)
        const outerWalls = storey.walls.filter(w => w.type === 'outer');
        if (outerWalls.length > 0) {
            // Build ALL ordered wall chains (may be multiple disconnected groups)
            const allChains = [];
            const usedGlobal = new Set();
            while (usedGlobal.size < outerWalls.length) {
                // Find an unused wall to start a new chain
                const startWall = outerWalls.find(w => !usedGlobal.has(w.id));
                if (!startWall) break;

                const chain = [startWall];
                usedGlobal.add(startWall.id);
                let currentEnd = startWall.p2;

                // Follow chain forward
                for (let i = 0; i < outerWalls.length; i++) {
                    const next = outerWalls.find(w => !usedGlobal.has(w.id) && (w.p1 === currentEnd || w.p2 === currentEnd));
                    if (!next) break;
                    usedGlobal.add(next.id);
                    chain.push(next);
                    currentEnd = next.p1 === currentEnd ? next.p2 : next.p1;
                }

                // Also follow chain backward from start
                let currentStart = startWall.p1;
                for (let i = 0; i < outerWalls.length; i++) {
                    const prev = outerWalls.find(w => !usedGlobal.has(w.id) && (w.p1 === currentStart || w.p2 === currentStart));
                    if (!prev) break;
                    usedGlobal.add(prev.id);
                    chain.unshift(prev);
                    currentStart = prev.p1 === currentStart ? prev.p2 : prev.p1;
                }

                allChains.push(chain);
            }

            // Render each chain
            for (const orderedWalls of allChains) {
                if (orderedWalls.length >= 1) {
                    // Build inner boundary (drawn points, ordered)
                    const innerPts = [];
                    for (let i = 0; i < orderedWalls.length; i++) {
                        const w = orderedWalls[i];
                        const wp1 = getPoint(storey, w.p1);
                        // Add start point of each wall
                        if (i === 0 || !innerPts.some(p => Math.abs(p.x - wp1.x) < 1 && Math.abs(p.y - wp1.y) < 1)) {
                            if (wp1) innerPts.push(wp1);
                        }
                    }
                    // Add end point of last wall
                    const lastW = orderedWalls[orderedWalls.length - 1];
                    const lastEnd = getPoint(storey, lastW.p2);
                    if (lastEnd && !innerPts.some(p => Math.abs(p.x - lastEnd.x) < 1 && Math.abs(p.y - lastEnd.y) < 1)) {
                        innerPts.push(lastEnd);
                    }

                    // Build outer boundary with mitered corners
                    const outerPts = [];
                    // First wall: add far outer corner
                    const firstPoly = getWallPolygon(orderedWalls[0], storey);
                    if (firstPoly) outerPts.push(firstPoly[0]);

                    // Miter corners between consecutive walls
                    for (let i = 0; i < orderedWalls.length - 1; i++) {
                        const w1 = orderedWalls[i], w2 = orderedWalls[i + 1];
                        const poly1 = getWallPolygon(w1, storey);
                        const poly2 = getWallPolygon(w2, storey);
                        if (!poly1 || !poly2) continue;

                        let sharedPtId = null;
                        if (w1.p2 === w2.p1) sharedPtId = w1.p2;
                        else if (w1.p2 === w2.p2) sharedPtId = w1.p2;
                        else if (w1.p1 === w2.p1) sharedPtId = w1.p1;
                        else if (w1.p1 === w2.p2) sharedPtId = w1.p1;
                        if (!sharedPtId) { outerPts.push(poly1[1]); continue; }

                        const oc1Near = (sharedPtId === w1.p1) ? poly1[0] : poly1[1];
                        const oc1Far = (sharedPtId === w1.p1) ? poly1[1] : poly1[0];
                        const oc2Near = (sharedPtId === w2.p1) ? poly2[0] : poly2[1];
                        const oc2Far = (sharedPtId === w2.p1) ? poly2[1] : poly2[0];

                        const d1x = oc1Near.x - oc1Far.x, d1y = oc1Near.y - oc1Far.y;
                        const d2x = oc2Near.x - oc2Far.x, d2y = oc2Near.y - oc2Far.y;
                        const cross = d1x * d2y - d1y * d2x;

                        if (Math.abs(cross) > 0.01) {
                            const dx = oc2Near.x - oc1Near.x, dy = oc2Near.y - oc1Near.y;
                            const t = (dx * d2y - dy * d2x) / cross;
                            outerPts.push({ x: oc1Near.x + t * d1x, y: oc1Near.y + t * d1y });
                        } else {
                            outerPts.push({ x: (oc1Near.x + oc2Near.x) / 2, y: (oc1Near.y + oc2Near.y) / 2 });
                        }
                    }

                    // Last wall: add far outer corner
                    const lastPoly = getWallPolygon(orderedWalls[orderedWalls.length - 1], storey);
                    if (lastPoly) outerPts.push(lastPoly[1]);

                    // Draw the merged shape as a single path (outer → inner reversed)
                    if (outerPts.length >= 2 && innerPts.length >= 2) {
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
                    }

                    // Selection highlight for ALL selected outer walls in this chain
                    for (const ow of orderedWalls) {
                        if (selectedSet.has(ow.id)) {
                            drawWallSelectionHighlight(ctx, vp, ow, storey);
                        }
                    }
                }
            } // end for each chain
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
                    if (neighbor.type === 'outer') {
                        // Inner→outer: extend to the wall center line
                        const owPt1 = getPoint(storey, neighbor.p1);
                        const owPt2 = getPoint(storey, neighbor.p2);
                        if (!owPt1 || !owPt2) continue;
                        const extLeft = lineLineIntersect(corners[nearLeftIdx], corners[farLeftIdx], owPt1, owPt2);
                        if (extLeft) corners[nearLeftIdx] = extLeft;
                        const extRight = lineLineIntersect(corners[nearRightIdx], corners[farRightIdx], owPt1, owPt2);
                        if (extRight) corners[nearRightIdx] = extRight;
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
                        if (bestExtL) corners[nearLeftIdx] = bestExtL;
                        // Extend our right side to neighbor's edges
                        let bestExtR = null, bestDistR = Infinity;
                        for (const [ea, eb] of nEdges) {
                            const ext = lineLineIntersect(corners[nearRightIdx], corners[farRightIdx], ea, eb);
                            if (ext) {
                                const d = dist(corners[nearRightIdx], ext);
                                if (d < bestDistR) { bestDistR = d; bestExtR = ext; }
                            }
                        }
                        if (bestExtR) corners[nearRightIdx] = bestExtR;
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


/** Build ordered inner boundary points from the wall chain (p1→p2 links) */
const buildOrderedOuterPoints = (outerWalls, storey) => {
    if (outerWalls.length === 0) return [];
    const ordered = buildOrderedWallChain(outerWalls, storey);
    return ordered.map(w => getPoint(storey, w.p1)).filter(Boolean);
};

/** Build ordered wall chain (wall objects, preserving direction) */
const buildOrderedWallChain = (outerWalls, storey) => {
    if (outerWalls.length === 0) return [];
    const used = new Set();
    const ordered = [outerWalls[0]];
    used.add(outerWalls[0].id);
    let currentEnd = outerWalls[0].p2;

    for (let i = 0; i < outerWalls.length - 1; i++) {
        const next = outerWalls.find(w => !used.has(w.id) && (w.p1 === currentEnd || w.p2 === currentEnd));
        if (!next) break;
        used.add(next.id);
        ordered.push(next);
        currentEnd = next.p1 === currentEnd ? next.p2 : next.p1;
    }

    return ordered;
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
    const label = (length / 1000).toFixed(2) + ' m';

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
    const label = (length / 1000).toFixed(2) + ' m';
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

const drawOpening = (ctx, vp, opening, storey, selected) => {
    const wall = storey.walls.find(w => w.id === opening.wall_id);
    if (!wall) return;
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return;

    const wallLen = dist(pt1, pt2);
    if (wallLen < 1) return;
    const dx = (pt2.x - pt1.x) / wallLen;
    const dy = (pt2.y - pt1.y) / wallLen;

    // Wall normal (perpendicular)
    const nx = -dy, ny = dx;
    const thickness = wall.thickness_mm;

    // Opening center along wall
    const cx = pt1.x + dx * opening.position_mm;
    const cy = pt1.y + dy * opening.position_mm;
    const halfW = opening.width_mm / 2;

    // Opening start and end points (on the wall reference line)
    const sx = cx - dx * halfW;
    const sy = cy - dy * halfW;
    const ex = cx + dx * halfW;
    const ey = cy + dy * halfW;

    // Determine wall surface offsets from reference line
    const poly = getWallPolygon(wall, storey);
    let sideA = 0, sideB = 0;
    if (poly && poly.length >= 4) {
        if (wall.type === 'outer') {
            sideA = 0; sideB = -thickness;
        } else if (wall.ref_edge === 'left') {
            sideA = 0; sideB = thickness;
        } else {
            sideA = -thickness; sideB = 0;
        }
    } else {
        sideA = -thickness / 2; sideB = thickness / 2;
    }

    // Clear the wall area (opening gap)
    const margin = 2;
    const g1 = worldToScreen(vp, sx + nx * (sideA - margin), sy + ny * (sideA - margin));
    const g2 = worldToScreen(vp, ex + nx * (sideA - margin), ey + ny * (sideA - margin));
    const g3 = worldToScreen(vp, ex + nx * (sideB + margin), ey + ny * (sideB + margin));
    const g4 = worldToScreen(vp, sx + nx * (sideB + margin), sy + ny * (sideB + margin));

    ctx.fillStyle = '#fafafa';
    ctx.beginPath();
    ctx.moveTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y);
    ctx.lineTo(g3.x, g3.y); ctx.lineTo(g4.x, g4.y);
    ctx.closePath();
    ctx.fill();

    if (opening.type === 'door') {
        // ── CAD Door: break lines + leaf from hinge + solid quarter-arc ──
        const swingLeft = opening.swing === 'left';
        const inward = opening.direction !== 'outward';

        const hinge = swingLeft ? { x: sx, y: sy } : { x: ex, y: ey };
        const free = swingLeft ? { x: ex, y: ey } : { x: sx, y: sy };
        const hingeS = worldToScreen(vp, hinge.x, hinge.y);

        // Swing normal direction
        const swingNx = inward ? nx : -nx;
        const swingNy = inward ? ny : -ny;

        // The door leaf endpoint (90° from wall direction, at hinge)
        const leafEndX = hinge.x + swingNx * opening.width_mm;
        const leafEndY = hinge.y + swingNy * opening.width_mm;
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
        const arcRadius = opening.width_mm * vp.zoom;
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
        ctx.arc(hingeS.x, hingeS.y, arcRadius, leafAngle, freeAngle, counterClockwise);
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

const drawRoomLabel = (ctx, vp, room, isSelected) => {
    const centroid = polygonCentroid(room.polygon);
    // Apply user-defined offset (for dragging the label)
    const labelX = centroid.x + (room.labelOffsetX || 0);
    const labelY = centroid.y + (room.labelOffsetY || 0);
    const sc = worldToScreen(vp, labelX, labelY);
    const fontSize = Math.max(10, Math.min(16, 12 / vp.zoom * 0.01));

    // Background pill for readability
    const nameText = room.name;
    const areaText = `${mm2ToM2(room.area_mm2)} m²`;
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

    // Store the screen-space hit box for click detection
    room._labelHitBox = { x: boxX, y: boxY, w: boxW, h: boxH };
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
    ctx.restore();

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
    const centroid = polygonCentroid(slab.polygon);
    const sc = worldToScreen(vp, centroid.x, centroid.y);
    const fontSize = Math.max(9, Math.min(14, 11 / vp.zoom * 0.01));
    ctx.fillStyle = selected ? '#3b82f6' : '#64748b';
    ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(slab.name || 'Decke', sc.x, sc.y - fontSize * 0.5);
    ctx.font = `400 ${fontSize * 0.8}px Inter, system-ui, sans-serif`;
    ctx.fillText(`${slab.thickness_mm / 10} cm · ${(slab.ref_height_mm / 1000).toFixed(2)} m`, sc.x, sc.y + fontSize * 0.5);

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
    const overhang = roof.overhang_mm || 0;

    // Draw overhang outline (expanded boundary)
    if (overhang > 0 && (roof.type === 'gable' || roof.type === 'hip')) {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const oMinX = minX - overhang, oMinY = minY - overhang;
        const oMaxX = maxX + overhang, oMaxY = maxY + overhang;
        const os1 = worldToScreen(vp, oMinX, oMinY);
        const os2 = worldToScreen(vp, oMaxX, oMinY);
        const os3 = worldToScreen(vp, oMaxX, oMaxY);
        const os4 = worldToScreen(vp, oMinX, oMaxY);
        ctx.moveTo(os1.x, os1.y);
        ctx.lineTo(os2.x, os2.y);
        ctx.lineTo(os3.x, os3.y);
        ctx.lineTo(os4.x, os4.y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Ridge line
    if (roof.type === 'gable' || roof.type === 'hip') {
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);

        // Ridge along longest axis
        if (bw >= bh) {
            // Horizontal ridge
            const ridgeInset = roof.type === 'hip' ? bh * 0.3 : 0;
            const r1 = worldToScreen(vp, minX + ridgeInset, cy);
            const r2 = worldToScreen(vp, maxX - ridgeInset, cy);
            ctx.beginPath();
            ctx.moveTo(r1.x, r1.y);
            ctx.lineTo(r2.x, r2.y);
            ctx.stroke();

            // Hip: draw diagonal lines from corners to ridge ends
            if (roof.type === 'hip') {
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 0.8;
                const corners = [
                    worldToScreen(vp, minX, minY), worldToScreen(vp, minX, maxY),
                    worldToScreen(vp, maxX, minY), worldToScreen(vp, maxX, maxY),
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
            const ridgeInset = roof.type === 'hip' ? bw * 0.3 : 0;
            const r1 = worldToScreen(vp, cx, minY + ridgeInset);
            const r2 = worldToScreen(vp, cx, maxY - ridgeInset);
            ctx.beginPath();
            ctx.moveTo(r1.x, r1.y);
            ctx.lineTo(r2.x, r2.y);
            ctx.stroke();

            if (roof.type === 'hip') {
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 0.8;
                const corners = [
                    worldToScreen(vp, minX, minY), worldToScreen(vp, maxX, minY),
                    worldToScreen(vp, minX, maxY), worldToScreen(vp, maxX, maxY),
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
    }

    // Flat roof: draw parapet outline
    if (roof.type === 'flat') {
        const par = roof.parapet_mm || 300;
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const ps1 = worldToScreen(vp, minX + 50, minY + 50);
        const ps2 = worldToScreen(vp, maxX - 50, minY + 50);
        const ps3 = worldToScreen(vp, maxX - 50, maxY - 50);
        const ps4 = worldToScreen(vp, minX + 50, maxY - 50);
        ctx.moveTo(ps1.x, ps1.y);
        ctx.lineTo(ps2.x, ps2.y);
        ctx.lineTo(ps3.x, ps3.y);
        ctx.lineTo(ps4.x, ps4.y);
        ctx.closePath();
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

    ctx.restore();
};

// ─── Normgerechte Bemaßung (DIN 1356) ──────────────────────────

/**
 * Draw outer dimension chains around the building footprint.
 * Two chain levels:
 *   1st chain (close): individual outer wall segment lengths
 *   2nd chain (far):   total building dimension
 */
const drawOuterDimensionChains = (ctx, vp, storey) => {
    const outerWalls = storey.walls.filter(w => w.type === 'outer');
    if (outerWalls.length < 2) return;

    // Collect all outer wall endpoint world coords (unique)
    const ptSet = new Set();
    const pts = [];
    for (const w of outerWalls) {
        for (const pid of [w.p1, w.p2]) {
            if (ptSet.has(pid)) continue;
            ptSet.add(pid);
            const p = getPoint(storey, pid);
            if (p) pts.push({ x: p.x, y: p.y });
        }
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

    // Collect outer wall segments as pairs
    const segments = outerWalls.map(w => {
        const p1 = getPoint(storey, w.p1);
        const p2 = getPoint(storey, w.p2);
        return p1 && p2 ? { p1, p2 } : null;
    }).filter(Boolean);

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
            const fontSize = Math.max(8, Math.min(11, 10));
            ctx.save();
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
            ctx.restore();
        }
    };

    ctx.save();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);

    // --- Horizontal dimension chains (top and bottom) ---
    // Collect X coordinates of all outer wall endpoints, sorted
    const xCoords = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b);
    const yCoords = [...new Set(pts.map(p => p.y))].sort((a, b) => a - b);

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
            const label = segLen >= 100 ? (segLen / 1000).toFixed(2) : '';
            drawDimLine(s1.x, s1.y, s2.x, s2.y, label);
        }

        // Total chain
        if (xCoords.length > 2) {
            const st1 = worldToScreen(vp, xCoords[0], totalChainY);
            const st2 = worldToScreen(vp, xCoords[xCoords.length - 1], totalChainY);
            const totalLen = xCoords[xCoords.length - 1] - xCoords[0];
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            drawDimLine(st1.x, st1.y, st2.x, st2.y, (totalLen / 1000).toFixed(2));
        }
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
            const label = segLen >= 100 ? (segLen / 1000).toFixed(2) : '';
            drawDimLine(s1.x, s1.y, s2.x, s2.y, label);
        }

        // Total chain
        if (yCoords.length > 2) {
            const st1 = worldToScreen(vp, totalChainX, yCoords[0]);
            const st2 = worldToScreen(vp, totalChainX, yCoords[yCoords.length - 1]);
            const totalLen = yCoords[yCoords.length - 1] - yCoords[0];
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            drawDimLine(st1.x, st1.y, st2.x, st2.y, (totalLen / 1000).toFixed(2));
        }
    }

    ctx.restore();
};

// ─── 2D Furniture (realistic top-down view) ─────────────────────

const drawFurniture2D = (ctx, vp, furn, selected) => {
    ctx.save();

    const s = worldToScreen(vp, furn.x, furn.y);
    const sw = furn.width_mm * vp.zoom;
    const sd = furn.depth_mm * vp.zoom;

    ctx.translate(s.x, s.y);
    ctx.rotate((furn.rotation * Math.PI) / 180);

    const catItem = getFurnitureItem(furn.catalog_id);
    const catId = furn.catalog_id || '';

    // Base fill
    const baseColor = selected ? '#dbeafe' : (catItem?.color || FURNITURE_FILL);
    const strokeColor = selected ? SELECTION_COLOR : FURNITURE_STROKE;
    ctx.fillStyle = baseColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = selected ? 2 : 1.2;

    // Choose drawing based on furniture type
    if (catId.startsWith('sofa') || catId === 'sessel') {
        drawSofa(ctx, sw, sd, catId, baseColor, strokeColor);
    } else if (catId.startsWith('bett') || catId === 'einzelbett') {
        drawBed(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId.includes('tisch') || catId.includes('esstisch') || catId === 'schreibtisch' || catId === 'couchtisch') {
        drawTable(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId.includes('stuhl') || catId === 'buerostuhl') {
        drawChair(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId.includes('schrank') || catId === 'kleiderschrank' || catId === 'regal' || catId === 'sideboard' || catId === 'kommode' || catId === 'nachttisch') {
        drawCabinet(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'badewanne' || catId === 'san_badewanne' || catId === 'san_badewanne_frei') {
        drawBathtub(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'dusche' || catId === 'san_duschkabine' || catId === 'san_dusche_boden') {
        drawShower(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'san_dusche_eck') {
        drawShowerQuarter(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'toilette' || catId === 'wc' || catId === 'san_toilette' || catId === 'san_toilette_stand') {
        drawToilet(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'san_bidet') {
        drawBidet(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'san_urinal') {
        drawUrinal(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'waschbecken' || catId === 'san_waschbecken' || catId === 'san_handwaschbecken') {
        drawSink(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId === 'san_doppelwaschtisch') {
        drawDoubleSink(ctx, sw, sd, baseColor, strokeColor);
    } else if (catId.includes('kuech') || catId === 'kueche' || catId === 'kuechenzeile' || catId === 'herd' || catId === 'kuehlschrank' || catId === 'kuechenblock') {
        drawKitchen(ctx, sw, sd, catId, baseColor, strokeColor);
    } else if (catId === 'waschmaschine' || catId === 'trockner' || catId === 'san_waschmaschine' || catId === 'san_trockner') {
        drawWasher(ctx, sw, sd, baseColor, strokeColor);
    } else {
        // Default: rounded rectangle with label
        drawDefaultFurniture(ctx, sw, sd, furn, baseColor, strokeColor);
    }

    ctx.restore();
};

const drawSofa = (ctx, w, d, catId, fill, stroke) => {
    const r = Math.min(4, w * 0.05);
    // Backrest
    ctx.fillStyle = darkenColor(fill, 20);
    ctx.beginPath();
    ctx.roundRect(0, 0, w, d * 0.25, [r, r, 0, 0]);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.stroke();

    // Seat cushion
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(0, d * 0.25, w, d * 0.65, 0);
    ctx.fill();
    ctx.stroke();

    // Armrests
    ctx.fillStyle = darkenColor(fill, 15);
    ctx.beginPath();
    ctx.roundRect(0, d * 0.2, w * 0.12, d * 0.7, [0, r, r, 0]);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(w * 0.88, d * 0.2, w * 0.12, d * 0.7, [r, 0, 0, r]);
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
    ctx.roundRect(w * 0.13, d * 0.85, w * 0.74, d * 0.12, [0, 0, r, r]);
    ctx.stroke();
};

const drawBed = (ctx, w, d, fill, stroke) => {
    // Mattress
    ctx.fillStyle = '#f1f5f9';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, d, 3);
    ctx.fill();
    ctx.stroke();

    // Headboard
    ctx.fillStyle = darkenColor(fill, 25);
    ctx.beginPath();
    ctx.roundRect(0, 0, w, d * 0.08, [3, 3, 0, 0]);
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
        ctx.roundRect(w * 0.06, py, pillowW, pillowH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(w * 0.52, py, pillowW, pillowH, 4);
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.roundRect(w * 0.2, py, pillowW, pillowH, 4);
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
    ctx.roundRect(0, 0, w, d, 3);
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

    // Door lines
    if (w > 20) {
        const doors = Math.max(1, Math.round(w / (d * 1.5)));
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
    ctx.roundRect(0, 0, w, d, 6);
    ctx.fill();
    ctx.stroke();

    // Inner tub
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(w * 0.08, d * 0.08, w * 0.84, d * 0.84, 10);
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
    ctx.roundRect(0, 0, w, d, 2);
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
    ctx.roundRect(w * 0.1, 0, w * 0.8, d * 0.3, [3, 3, 0, 0]);
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
    ctx.roundRect(0, 0, w, d, 2);
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
    ctx.roundRect(w * 0.05, 0, w * 0.9, d * 0.35, [3, 3, 0, 0]);
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
    ctx.roundRect(0, 0, w, d, 2);
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

const drawDefaultFurniture = (ctx, sw, sd, furn, fill, stroke) => {
    // Very subtle outline instead of a bold bounding rectangle
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.roundRect(0, 0, sw, sd, 3);
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
        const label = furn.catalog_id.replace(/_/g, ' ');
        ctx.fillText(label, sw / 2, sd / 2);
    }
};

/** Darken/lighten a hex color */
const darkenColor = (hex, amount) => {
    if (!hex || hex.length < 7) return hex;
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

const drawPreview = (ctx, vp, state, storey) => {
    const { preview } = state;

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
            const thickness = preview.wallType === 'outer' ? 365 : 115;
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
                // Inner wall: centered
                const half = thickness / 2;
                pts = [
                    worldToScreen(vp, preview.x1 + nx * half, preview.y1 + ny * half),
                    worldToScreen(vp, preview.x2 + nx * half, preview.y2 + ny * half),
                    worldToScreen(vp, preview.x2 - nx * half, preview.y2 - ny * half),
                    worldToScreen(vp, preview.x1 - nx * half, preview.y1 - ny * half),
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
                // Find the last placed wall ending at (x1,y1)
                const outerWalls = storey.walls.filter(w => w.type === 'outer');
                const lastWall = outerWalls.find(w => {
                    const p2 = getPoint(storey, w.p2);
                    const p1 = getPoint(storey, w.p1);
                    return (p2 && Math.abs(p2.x - preview.x1) < 1 && Math.abs(p2.y - preview.y1) < 1) ||
                        (p1 && Math.abs(p1.x - preview.x1) < 1 && Math.abs(p1.y - preview.y1) < 1);
                });
                if (lastWall) {
                    const lastPoly = getWallPolygon(lastWall, storey);
                    if (lastPoly) {
                        // Determine which end connects to preview start
                        const lp2 = getPoint(storey, lastWall.p2);
                        const isP2 = lp2 && Math.abs(lp2.x - preview.x1) < 1 && Math.abs(lp2.y - preview.y1) < 1;

                        const oc1Near = isP2 ? lastPoly[1] : lastPoly[0];
                        const oc1Far = isP2 ? lastPoly[0] : lastPoly[1];

                        // Preview outer edge: pts[0]=outer_start, pts[1]=outer_end
                        const oc2Near = { x: (preview.x1 - nx * thickness), y: (preview.y1 - ny * thickness) };
                        const oc2Far = { x: (preview.x2 - nx * thickness), y: (preview.y2 - ny * thickness) };

                        // Compute miter point
                        const d1x = oc1Near.x - oc1Far.x, d1y = oc1Near.y - oc1Far.y;
                        const d2x = oc2Near.x - oc2Far.x, d2y = oc2Near.y - oc2Far.y;
                        const cross = d1x * d2y - d1y * d2x;

                        if (Math.abs(cross) > 0.01) {
                            const ddx = oc2Near.x - oc1Near.x;
                            const ddy = oc2Near.y - oc1Near.y;
                            const t = (ddx * d2y - ddy * d2x) / cross;
                            const miter = {
                                x: oc1Near.x + t * d1x,
                                y: oc1Near.y + t * d1y,
                            };

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
            const canvasW = ctx.canvas.width;
            const canvasH = ctx.canvas.height;
            ctx.save();
            ctx.strokeStyle = 'rgba(236, 72, 153, 0.7)'; // brighter pink
            ctx.lineWidth = 1.5;
            ctx.setLineDash([8, 4]);
            let hGuideDrawn = false, vGuideDrawn = false;
            for (const pt of allPoints) {
                // Horizontal guide (same Y as preview endpoint)
                if (!hGuideDrawn && Math.abs(pt.y - preview.y2) < guideThreshold && Math.abs(pt.x - preview.x2) > 50) {
                    ctx.beginPath();
                    ctx.moveTo(0, s2.y);
                    ctx.lineTo(canvasW, s2.y);
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
                    ctx.lineTo(s2.x, canvasH);
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
            ctx.restore();
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

            // Interior angle
            let angle = a1 - a2;
            while (angle < 0) angle += Math.PI * 2;
            while (angle > Math.PI * 2) angle -= Math.PI * 2;
            // Use the smaller angle
            const degrees = Math.round(angle * 180 / Math.PI);
            const displayDeg = degrees > 180 ? 360 - degrees : degrees;

            // Draw arc
            const arcRadius = 25;
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const startAngle = Math.min(a1, a2);
            const endAngle = Math.max(a1, a2);
            // Choose correct arc direction
            if (endAngle - startAngle <= Math.PI) {
                ctx.arc(s1.x, s1.y, arcRadius, startAngle, endAngle);
            } else {
                ctx.arc(s1.x, s1.y, arcRadius, endAngle, startAngle);
            }
            ctx.stroke();

            // Angle label
            const midAngle = (a1 + a2) / 2;
            // If angles wrap around, adjust
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
            const thickness = 365; // outer wall default
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
        ctx.save();
        const s = worldToScreen(vp, preview.x, preview.y);
        const sw = preview.width * vp.zoom;
        const sd = preview.depth * vp.zoom;
        ctx.globalAlpha = 0.5;
        ctx.translate(s.x, s.y);
        ctx.rotate((preview.rotation || 0) * Math.PI / 180);

        // Use actual furniture drawing if catalog mapped, else simple shape
        const catId = preview.catalogId || '';
        const baseColor = FURNITURE_FILL;
        const strokeColor = FURNITURE_STROKE;
        ctx.fillStyle = baseColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;

        if (catId.startsWith('sofa') || catId === 'sessel') {
            drawSofa(ctx, sw, sd, catId, baseColor, strokeColor);
        } else if (catId.startsWith('bett') || catId === 'einzelbett') {
            drawBed(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId.includes('tisch') || catId === 'schreibtisch' || catId === 'couchtisch' || catId.includes('esstisch')) {
            drawTable(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId.includes('stuhl') || catId === 'buerostuhl') {
            drawChair(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId.includes('schrank') || catId === 'kleiderschrank' || catId === 'regal' || catId === 'sideboard' || catId === 'kommode' || catId === 'nachttisch') {
            drawCabinet(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId === 'badewanne' || catId === 'san_badewanne' || catId === 'san_badewanne_frei') {
            drawBathtub(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId === 'dusche' || catId === 'san_duschkabine' || catId === 'san_dusche_boden') {
            drawShower(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId === 'toilette' || catId === 'wc' || catId === 'san_toilette' || catId === 'san_toilette_stand') {
            drawToilet(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId === 'waschbecken' || catId === 'san_waschbecken' || catId === 'san_handwaschbecken') {
            drawSink(ctx, sw, sd, baseColor, strokeColor);
        } else if (catId.includes('kuech') || catId === 'kueche' || catId === 'herd' || catId === 'kuehlschrank') {
            drawKitchen(ctx, sw, sd, catId, baseColor, strokeColor);
        } else {
            // Default: simple shape without bounding rectangle
            ctx.beginPath();
            ctx.roundRect(0, 0, sw, sd, 3);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    if (preview.type === 'opening_ghost') {
        const s1 = worldToScreen(vp, preview.x1, preview.y1);
        const s2 = worldToScreen(vp, preview.x2, preview.y2);
        const isDoor = preview.openingType === 'door';
        const color = isDoor ? DOOR_ARC_COLOR : WINDOW_STROKE_COLOR;

        // Draw wall break (white gap) — use correct wall surface offsets
        if (preview.thickness) {
            const dx = preview.x2 - preview.x1, dy = preview.y2 - preview.y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / len, ny = dx / len;
            // Determine offset sides matching drawOpening logic
            let sideA = 0, sideB = 0;
            if (preview.wallType === 'outer') {
                sideA = 0; sideB = -preview.thickness;
            } else if (preview.refEdge === 'left') {
                sideA = 0; sideB = preview.thickness;
            } else {
                sideA = -preview.thickness; sideB = 0;
            }
            const margin = 2;
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
        let ox1 = preview.x1, oy1 = preview.y1, ox2 = preview.x2, oy2 = preview.y2;
        if (preview.thickness) {
            const dx = preview.x2 - preview.x1, dy = preview.y2 - preview.y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / len, ny = dx / len;
            let centerOffset = 0;
            if (preview.wallType === 'outer') {
                centerOffset = -preview.thickness / 2;
            } else if (preview.refEdge === 'left') {
                centerOffset = preview.thickness / 2;
            } else {
                centerOffset = -preview.thickness / 2;
            }
            ox1 += nx * centerOffset; oy1 += ny * centerOffset;
            ox2 += nx * centerOffset; oy2 += ny * centerOffset;
        }
        const sc1 = worldToScreen(vp, ox1, oy1);
        const sc2 = worldToScreen(vp, ox2, oy2);

        // Opening line/shape
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(sc1.x, sc1.y);
        ctx.lineTo(sc2.x, sc2.y);
        ctx.stroke();

        if (isDoor) {
            // Door arc preview
            const arcR = Math.sqrt((sc2.x - sc1.x) ** 2 + (sc2.y - sc1.y) ** 2);
            const baseAngle = Math.atan2(sc2.y - sc1.y, sc2.x - sc1.x);
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(sc1.x, sc1.y, arcR, baseAngle, baseAngle - Math.PI / 2, true);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            // Window: cross lines
            const mx = (sc1.x + sc2.x) / 2, my = (sc1.y + sc2.y) / 2;
            const dx = sc2.x - sc1.x, dy = sc2.y - sc1.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / len * 4, ny = dx / len * 4;
            ctx.lineWidth = 2;
            // Double line
            ctx.beginPath();
            ctx.moveTo(sc1.x + nx, sc1.y + ny);
            ctx.lineTo(sc2.x + nx, sc2.y + ny);
            ctx.moveTo(sc1.x - nx, sc1.y - ny);
            ctx.lineTo(sc2.x - nx, sc2.y - ny);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Measurement labels: left and right distance
        if (preview.wallP1 && preview.wallP2 && preview.position_mm !== undefined) {
            const leftDist = preview.position_mm - preview.width_mm / 2;
            const rightDist = preview.wall_len - preview.position_mm - preview.width_mm / 2;

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
                const lText = leftDist >= 1000 ? (leftDist / 1000).toFixed(2) + ' m' : Math.round(leftDist) + ' mm';
                ctx.fillText(lText, lmx, lmy);
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
                const rText = rightDist >= 1000 ? (rightDist / 1000).toFixed(2) + ' m' : Math.round(rightDist) + ' mm';
                ctx.fillText(rText, rmx, rmy);
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

        // ── Annotation previews ──────────────────────────────
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
                const spEnd = worldToScreen(vp, preview.x2, preview.y2);
                ctx.lineTo(spEnd.x, spEnd.y);
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
        }

        if (preview.type === 'annotation_circle') {
            const sc = worldToScreen(vp, preview.cx, preview.cy);
            const edgePt = worldToScreen(vp, preview.cx + preview.radius, preview.cy);
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
    }
};

