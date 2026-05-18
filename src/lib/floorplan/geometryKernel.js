// ─── Geometry Kernel ────────────────────────────────────────────────
// Pure integer (mm) geometry operations for the floor plan editor.
// No external dependencies. Deterministic computations.

import { SNAP_GRID, ANGLE_SNAP, SNAP_TOLERANCE, MIN_WALL_SEGMENT, MIN_ROOM_AREA, WALL_THICKNESS } from './constants.js';

// ─── UUID helper ─────────────────────────────────────────────────
let _idCounter = 0;
export const genId = () => {
    _idCounter++;
    return `fp_${Date.now().toString(36)}_${_idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
};

// ─── Basic Math ──────────────────────────────────────────────────

export const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

export const snapToGrid = (val) => Math.round(val / SNAP_GRID) * SNAP_GRID;

export const snapPointToGrid = (x, y) => ({
    x: snapToGrid(x),
    y: snapToGrid(y),
});

/**
 * Snap angle to nearest ANGLE_SNAP increment.
 * Given a start point and candidate end, returns snapped end point.
 */
export const snapAngle = (startX, startY, endX, endY) => {
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) return { x: endX, y: endY };

    const angleRad = Math.atan2(dy, dx);
    const angleDeg = (angleRad * 180) / Math.PI;
    const snappedDeg = Math.round(angleDeg / ANGLE_SNAP) * ANGLE_SNAP;
    const snappedRad = (snappedDeg * Math.PI) / 180;

    return {
        x: snapToGrid(startX + Math.cos(snappedRad) * length),
        y: snapToGrid(startY + Math.sin(snappedRad) * length),
    };
};

/**
 * Find nearest point within snap tolerance; returns the point or null.
 */
export const findSnapPoint = (x, y, points, excludeIds = []) => {
    let best = null;
    let bestDist = SNAP_TOLERANCE;
    for (const p of points) {
        if (excludeIds.includes(p.id)) continue;
        const d = dist({ x, y }, p);
        if (d < bestDist) {
            bestDist = d;
            best = p;
        }
    }
    return best;
};

// ─── Line Segment Operations ────────────────────────────────────

/**
 * Point-to-line-segment distance and closest point.
 */
export const pointToSegmentDist = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return { dist: dist({ x: px, y: py }, { x: ax, y: ay }), t: 0, cx: ax, cy: ay };
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    return { dist: dist({ x: px, y: py }, { x: cx, y: cy }), t, cx, cy };
};

/**
 *  Line segment intersection. Returns { x, y, t1, t2 } or null.
 */
export const segmentIntersection = (a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) => {
    const d1x = a2x - a1x, d1y = a2y - a1y;
    const d2x = b2x - b1x, d2y = b2y - b1y;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 0.001) return null; // parallel

    const t1 = ((b1x - a1x) * d2y - (b1y - a1y) * d2x) / cross;
    const t2 = ((b1x - a1x) * d1y - (b1y - a1y) * d1x) / cross;

    if (t1 >= -0.001 && t1 <= 1.001 && t2 >= -0.001 && t2 <= 1.001) {
        return {
            x: Math.round(a1x + t1 * d1x),
            y: Math.round(a1y + t1 * d1y),
            t1, t2,
        };
    }
    return null;
};

// ─── Polygon Operations ─────────────────────────────────────────

/**
 * Compute signed area of polygon (points should be [{x,y}]).
 * Positive = CCW, Negative = CW.
 */
export const signedArea = (pts) => {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
    }
    return area / 2;
};

/**
 * Ensure polygon is CW (for outer wall — offset goes inward).
 */
export const ensureCW = (pts) => {
    if (signedArea(pts) > 0) return [...pts].reverse();
    return pts;
};

/**
 * Point in polygon test (ray casting).
 */
export const pointInPolygon = (px, py, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
};

/**
 * Polygon centroid.
 */
export const polygonCentroid = (pts) => {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    return { x: Math.round(cx / pts.length), y: Math.round(cy / pts.length) };
};

/**
 * Offset polygon inward by `dist` mm.
 * Uses miter join with bevel fallback for sharp angles.
 * Input: CW polygon points. Output: offset polygon points.
 */
export const offsetPolygon = (pts, offset) => {
    const n = pts.length;
    if (n < 3) return [];

    // Compute edge normals (pointing inward for CW polygon)
    const edges = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) continue;
        // For CW: inward normal is (dy/len, -dx/len)
        edges.push({
            nx: dy / len,
            ny: -dx / len,
            i, j,
        });
    }

    if (edges.length < 3) return [];

    const result = [];
    const MITER_LIMIT = 2.5; // miter length / offset ratio

    for (let ei = 0; ei < edges.length; ei++) {
        const ej = (ei + 1) % edges.length;
        const e1 = edges[ei];
        const e2 = edges[ej];

        // Offset lines
        const p1 = pts[e1.i], p2 = pts[e1.j];
        const p3 = pts[e2.i], p4 = pts[e2.j];

        const o1x = p1.x + e1.nx * offset, o1y = p1.y + e1.ny * offset;
        const o2x = p2.x + e1.nx * offset, o2y = p2.y + e1.ny * offset;
        const o3x = p3.x + e2.nx * offset, o3y = p3.y + e2.ny * offset;
        const o4x = p4.x + e2.nx * offset, o4y = p4.y + e2.ny * offset;

        // Intersect the two offset lines
        const d1x = o2x - o1x, d1y = o2y - o1y;
        const d2x = o4x - o3x, d2y = o4y - o3y;
        const cross = d1x * d2y - d1y * d2x;

        if (Math.abs(cross) < 0.001) {
            // Parallel edges, just use midpoint
            result.push({ x: Math.round(o2x), y: Math.round(o2y) });
        } else {
            const t = ((o3x - o1x) * d2y - (o3y - o1y) * d2x) / cross;
            const ix = o1x + t * d1x;
            const iy = o1y + t * d1y;

            // Check miter length
            const refPt = pts[e1.j]; // the corner point
            const miterLen = dist({ x: ix, y: iy }, refPt);

            if (miterLen > offset * MITER_LIMIT) {
                // Bevel fallback: use two points
                result.push({ x: Math.round(o2x), y: Math.round(o2y) });
                result.push({ x: Math.round(o3x), y: Math.round(o3y) });
            } else {
                result.push({ x: Math.round(ix), y: Math.round(iy) });
            }
        }
    }

    return result;
};

// ─── Storey State Factory ───────────────────────────────────────

/**
 * Create a fresh empty storey state.
 */
export const createStorey = (label = 'EG', heightMm = 2600) => ({
    id: genId(),
    label,
    height_mm: heightMm,
    ref_height_mm: 0,  // reference height relative to ground level (0.00m = Erdniveau)
    points: [],        // { id, x, y }
    walls: [],         // { id, type, p1, p2, thickness_mm, ref_edge, height_mm, ref_height_mm }
    openings: [],      // { id, wall_id, type, position_mm, width_mm, height_mm, sill_mm, swing, direction }
    furniture: [],     // { id, catalog_id, x, y, rotation, width_mm, depth_mm, height_mm }
    rooms: [],         // computed: { id, name, polygon, area_mm2 }
    slabs: [],         // { id, name, thickness_mm, ref_height_mm, polygon }
    roof: null,        // { type: 'gable'|'hip'|'flat', kneeWall_mm, pitch_deg, overhang_mm, parapet_mm }
    outerClosed: false,
    outerPolygon: null,   // inner edge polygon of outer walls (room boundary)
    outerBoundary: null,  // outer edge polygon of outer walls
});

/**
 * Duplicate a storey (deep clone with new IDs).
 */
export const duplicateStorey = (storey, newLabel) => {
    const idMap = {};
    const newId = (oldId) => {
        if (!idMap[oldId]) idMap[oldId] = genId();
        return idMap[oldId];
    };

    return {
        id: genId(),
        label: newLabel,
        height_mm: storey.height_mm,
        ref_height_mm: storey.ref_height_mm || 0,
        points: storey.points.map(p => ({ ...p, id: newId(p.id) })),
        walls: storey.walls.map(w => ({
            ...w,
            id: newId(w.id),
            p1: newId(w.p1),
            p2: newId(w.p2),
        })),
        openings: storey.openings.map(o => ({
            ...o,
            id: genId(),
            wall_id: newId(o.wall_id),
        })),
        furniture: storey.furniture.map(f => ({
            ...f,
            id: genId(),
        })),
        rooms: [],
        slabs: (storey.slabs || []).map(s => ({ ...s, id: genId() })),
        outerClosed: storey.outerClosed,
        outerPolygon: storey.outerPolygon ? [...storey.outerPolygon] : null,
        outerBoundary: storey.outerBoundary ? [...storey.outerBoundary] : null,
        roof: storey.roof ? { ...storey.roof } : null,
    };
};

// ─── Wall Operations ────────────────────────────────────────────

/**
 * Add a point to the storey. Returns the point (reuses existing if snappable).
 */
export const addPoint = (storey, x, y) => {
    const snapped = findSnapPoint(x, y, storey.points);
    if (snapped) return snapped;
    const p = { id: genId(), x: snapToGrid(x), y: snapToGrid(y) };
    storey.points.push(p);
    return p;
};

/**
 * Get point by ID.
 */
export const getPoint = (storey, id) => storey.points.find(p => p.id === id);

/**
 * Add outer wall segment.
 */
export const addOuterWallSegment = (storey, p1Id, p2Id, thickness = WALL_THICKNESS.outerDefault) => {
    const pt1 = getPoint(storey, p1Id);
    const pt2 = getPoint(storey, p2Id);
    if (!pt1 || !pt2) return null;
    if (dist(pt1, pt2) < MIN_WALL_SEGMENT) return null;

    const wall = {
        id: genId(),
        type: 'outer',
        p1: p1Id,
        p2: p2Id,
        thickness_mm: thickness,
        ref_edge: 'inner', // inner edge is the reference (innenbündig)
        height_mm: storey.height_mm,
    };
    storey.walls.push(wall);
    return wall;
};

/**
 * Close the outer wall polygon. Computes inner polygon via offset.
 */
export const closeOuterWalls = (storey) => {
    const outerWalls = storey.walls.filter(w => w.type === 'outer');
    if (outerWalls.length < 3) return false;

    // Build ordered polygon from outer walls
    const polygon = buildOrderedPolygon(outerWalls, storey.points);
    if (!polygon || polygon.length < 3) return false;

    // Ensure CW
    const cwPoly = ensureCW(polygon);

    // Innenbündig: drawn points = inner edge (room boundary)
    const thickness = outerWalls[0].thickness_mm;
    storey.outerPolygon = [...cwPoly]; // inner edge = room boundary
    // Compute outer boundary (offset outward = negative offset for CW)
    storey.outerBoundary = offsetPolygon(cwPoly, -thickness);

    storey.outerClosed = true;
    return true;
};

/**
 * Build ordered polygon points from wall segments.
 */
export const buildOrderedPolygon = (walls, points) => {
    if (walls.length === 0) return null;

    const getP = (id) => points.find(p => p.id === id);
    const ordered = [walls[0]];
    const used = new Set([walls[0].id]);
    let currentEnd = walls[0].p2;

    for (let i = 0; i < walls.length - 1; i++) {
        const next = walls.find(w => !used.has(w.id) && (w.p1 === currentEnd || w.p2 === currentEnd));
        if (!next) break;
        used.add(next.id);
        ordered.push(next);
        currentEnd = next.p1 === currentEnd ? next.p2 : next.p1;
    }

    return ordered.map(w => getP(w.p1)).filter(Boolean);
};

/**
 * Add inner wall segment. Determines offset side from cursor position.
 */
export const addInnerWallSegment = (storey, p1Id, p2Id, type = 'inner_nonload', thickness = WALL_THICKNESS.innerNonloadDefault, cursorSide = 'left') => {
    const pt1 = getPoint(storey, p1Id);
    const pt2 = getPoint(storey, p2Id);
    if (!pt1 || !pt2) return null;
    if (dist(pt1, pt2) < MIN_WALL_SEGMENT) return null;

    const wall = {
        id: genId(),
        type,
        p1: p1Id,
        p2: p2Id,
        thickness_mm: thickness,
        ref_edge: cursorSide, // which side the thickness goes
        height_mm: storey.height_mm,
    };
    storey.walls.push(wall);
    return wall;
};

/**
 * Split a wall at a given point, creating two new walls.
 * The original wall is removed and replaced by two shorter walls
 * that share the new midpoint. Returns the new point, or null if
 * the split point is too close to existing endpoints.
 */
export const splitWallAtPoint = (storey, wallId, splitX, splitY) => {
    const wallIdx = storey.walls.findIndex(w => w.id === wallId);
    if (wallIdx < 0) return null;
    const wall = storey.walls[wallIdx];
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return null;

    // Project split point onto the wall's reference line (p1→p2)
    // This prevents kinking when the snap was on a surface edge (offset from the ref line)
    const dx = pt2.x - pt1.x, dy = pt2.y - pt1.y;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen < 1) return null;
    const t = Math.max(0, Math.min(1, ((splitX - pt1.x) * dx + (splitY - pt1.y) * dy) / (wallLen * wallLen)));
    const projX = snapToGrid(pt1.x + t * dx);
    const projY = snapToGrid(pt1.y + t * dy);

    // Don't split if projected point is too close to existing endpoints
    const d1 = dist({ x: projX, y: projY }, pt1);
    const d2 = dist({ x: projX, y: projY }, pt2);
    if (d1 < 50 || d2 < 50) return null; // too close, use existing point

    // Create the new junction point on the reference line
    const midPt = addPoint(storey, projX, projY);

    // Create two new walls with same properties
    const wall1 = {
        id: genId(),
        type: wall.type,
        p1: wall.p1,
        p2: midPt.id,
        thickness_mm: wall.thickness_mm,
        ref_edge: wall.ref_edge,
        height_mm: wall.height_mm,
    };
    const wall2 = {
        id: genId(),
        type: wall.type,
        p1: midPt.id,
        p2: wall.p2,
        thickness_mm: wall.thickness_mm,
        ref_edge: wall.ref_edge,
        height_mm: wall.height_mm,
    };

    // Replace original wall with the two new ones
    storey.walls.splice(wallIdx, 1, wall1, wall2);

    // Move any openings from old wall to the correct new wall
    for (const opening of storey.openings) {
        if (opening.wallId === wallId) {
            const wallLen = dist(pt1, pt2);
            const splitT = d1 / wallLen;
            const openingCenter = opening.position_mm / wallLen;
            if (openingCenter < splitT) {
                opening.wallId = wall1.id;
            } else {
                opening.wallId = wall2.id;
                opening.position_mm -= d1;
            }
        }
    }

    return midPt;
};

/**
 * Compute wall geometry (polygon corners of the thick wall).
 * Returns 4 points: [p1_left, p2_left, p2_right, p1_right]
 */
export const getWallPolygon = (wall, storey) => {
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return null;

    const dx = pt2.x - pt1.x;
    const dy = pt2.y - pt1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;

    // Normal perpendicular
    const nx = -dy / len;
    const ny = dx / len;
    const t = wall.thickness_mm;

    if (wall.type === 'outer') {
        // Outer wall: innenbündig — ref is inner edge, thickness goes outward
        return [
            { x: Math.round(pt1.x - nx * t), y: Math.round(pt1.y - ny * t) },
            { x: Math.round(pt2.x - nx * t), y: Math.round(pt2.y - ny * t) },
            { x: Math.round(pt2.x), y: Math.round(pt2.y) },
            { x: Math.round(pt1.x), y: Math.round(pt1.y) },
        ];
    }

    // Inner wall: ref_edge determines side
    if (wall.ref_edge === 'left') {
        return [
            { x: Math.round(pt1.x), y: Math.round(pt1.y) },
            { x: Math.round(pt2.x), y: Math.round(pt2.y) },
            { x: Math.round(pt2.x + nx * t), y: Math.round(pt2.y + ny * t) },
            { x: Math.round(pt1.x + nx * t), y: Math.round(pt1.y + ny * t) },
        ];
    } else {
        return [
            { x: Math.round(pt1.x - nx * t), y: Math.round(pt1.y - ny * t) },
            { x: Math.round(pt2.x - nx * t), y: Math.round(pt2.y - ny * t) },
            { x: Math.round(pt2.x), y: Math.round(pt2.y) },
            { x: Math.round(pt1.x), y: Math.round(pt1.y) },
        ];
    }
};

/**
 * Flip inner wall side.
 */
export const flipWallSide = (wall) => {
    if (wall.type === 'outer') return;
    wall.ref_edge = wall.ref_edge === 'left' ? 'right' : 'left';
};

/**
 * Delete a wall and its openings.
 */
export const deleteWall = (storey, wallId) => {
    storey.openings = storey.openings.filter(o => o.wall_id !== wallId);
    storey.walls = storey.walls.filter(w => w.id !== wallId);
};

// ─── Opening Operations ─────────────────────────────────────────

/**
 * Find which wall a point (screen coords) is closest to.
 * Returns { wall, t, dist } or null.
 */
export const findWallAtPoint = (storey, px, py, maxDist = 30) => {
    let best = null;
    for (const wall of storey.walls) {
        const pt1 = getPoint(storey, wall.p1);
        const pt2 = getPoint(storey, wall.p2);
        if (!pt1 || !pt2) continue;
        const result = pointToSegmentDist(px, py, pt1.x, pt1.y, pt2.x, pt2.y);
        // Account for wall thickness
        if (result.dist < maxDist + wall.thickness_mm && (!best || result.dist < best.dist)) {
            best = { wall, t: result.t, dist: result.dist, cx: result.cx, cy: result.cy };
        }
    }
    return best;
};

/**
 * Place an opening (door/window) on a wall.
 */
export const placeOpening = (storey, wallId, type, positionMm, params = {}) => {
    const wall = storey.walls.find(w => w.id === wallId);
    if (!wall) return null;

    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return null;

    const wallLen = dist(pt1, pt2);
    const width = params.width_mm ?? (type === 'door' ? 860 : 1000);
    const height = params.height_mm ?? (type === 'door' ? 2010 : 1200);

    // Validate: opening fits in wall
    if (positionMm - width / 2 < 50 || positionMm + width / 2 > wallLen - 50) {
        return null; // too close to edge
    }

    // Check for overlaps with existing openings
    for (const existing of storey.openings.filter(o => o.wall_id === wallId)) {
        const eStart = existing.position_mm - existing.width_mm / 2;
        const eEnd = existing.position_mm + existing.width_mm / 2;
        const nStart = positionMm - width / 2;
        const nEnd = positionMm + width / 2;
        if (nStart < eEnd && nEnd > eStart) return null; // overlap
    }

    const opening = {
        id: genId(),
        wall_id: wallId,
        type,
        position_mm: snapToGrid(positionMm),
        width_mm: width,
        height_mm: height,
        sill_mm: params.sill_mm ?? (type === 'window' ? 800 : 0),
        swing: params.swing || 'left',
        direction: params.direction || 'inward',
    };
    storey.openings.push(opening);
    return opening;
};

/**
 * Delete an opening.
 */
export const deleteOpening = (storey, openingId) => {
    storey.openings = storey.openings.filter(o => o.id !== openingId);
};

// ─── Furniture Operations ───────────────────────────────────────

/**
 * Place furniture item.
 */
export const placeFurniture = (storey, catalogId, x, y, width, depth, height, rotation = 0) => {
    const item = {
        id: genId(),
        catalog_id: catalogId,
        x: snapToGrid(x),
        y: snapToGrid(y),
        rotation,
        width_mm: width,
        depth_mm: depth,
        height_mm: height,
    };
    storey.furniture.push(item);
    return item;
};

/**
 * Delete furniture.
 */
export const deleteFurniture = (storey, furnitureId) => {
    storey.furniture = storey.furniture.filter(f => f.id !== furnitureId);
};

/**
 * Move furniture.
 */
export const moveFurniture = (storey, furnitureId, x, y) => {
    const f = storey.furniture.find(f => f.id === furnitureId);
    if (f) {
        f.x = snapToGrid(x);
        f.y = snapToGrid(y);
    }
};

// ─── Room Computation ───────────────────────────────────────────

/**
 * Compute rooms from wall geometry.
 * Uses a simplified approach: builds enclosed regions from inner edges.
 * For MVP, we detect rooms from the outer polygon minus inner wall divisions.
 */
export const computeRooms = (storey) => {
    if (!storey.outerClosed || !storey.outerPolygon || storey.outerPolygon.length < 3) {
        storey.rooms = [];
        return;
    }

    const innerWalls = storey.walls.filter(w => w.type !== 'outer');

    if (innerWalls.length === 0) {
        // Single room = entire inner polygon
        const area = Math.abs(signedArea(storey.outerPolygon));
        if (area >= MIN_ROOM_AREA) {
            storey.rooms = [{
                id: storey.rooms[0]?.id || genId(),
                name: storey.rooms[0]?.name || 'Raum 1',
                polygon: [...storey.outerPolygon],
                area_mm2: Math.round(area),
                labelOffsetX: storey.rooms[0]?.labelOffsetX || 0,
                labelOffsetY: storey.rooms[0]?.labelOffsetY || 0,
            }];
        } else {
            storey.rooms = [];
        }
        return;
    }

    // For multiple inner walls we use a sweep approach:
    // Split the outer polygon using inner wall segments as dividers.
    const rooms = splitPolygonByWalls(storey.outerPolygon, innerWalls, storey);

    // Preserve existing room names
    const oldNames = {};
    storey.rooms.forEach(r => { oldNames[r.id] = r.name; });

    storey.rooms = rooms
        .filter(r => r.area >= MIN_ROOM_AREA)
        .map((r, i) => {
            // Try to match to existing room by centroid proximity
            const centroid = polygonCentroid(r.polygon);
            const existing = storey.rooms.find(er => {
                const ec = polygonCentroid(er.polygon);
                return dist(centroid, ec) < 500; // within 50cm
            });
            return {
                id: existing?.id || genId(),
                name: existing?.name || `Raum ${i + 1}`,
                polygon: r.polygon,
                area_mm2: Math.round(r.area),
                labelOffsetX: existing?.labelOffsetX || 0,
                labelOffsetY: existing?.labelOffsetY || 0,
            };
        });
};

/**
 * Split outer polygon by inner walls into sub-regions.
 * Simplified approach that works for common rectangular floor plans.
 */
const splitPolygonByWalls = (outerPoly, innerWalls, storey) => {
    // Collect all wall line segments (inner wall reference edges)
    const dividers = [];
    for (const wall of innerWalls) {
        const p1 = getPoint(storey, wall.p1);
        const p2 = getPoint(storey, wall.p2);
        if (p1 && p2) {
            // Project endpoint onto outer polygon if close (snap rounding fix)
            let x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
            let bestD1 = 50, bestD2 = 50; // only project within small tolerance
            for (let i = 0; i < outerPoly.length; i++) {
                const a = outerPoly[i];
                const b = outerPoly[(i + 1) % outerPoly.length];
                const d1 = pointToSegmentDist(p1.x, p1.y, a.x, a.y, b.x, b.y);
                if (d1.dist < bestD1 && d1.dist > 0) {
                    bestD1 = d1.dist;
                    x1 = d1.cx; y1 = d1.cy;
                }
                const d2 = pointToSegmentDist(p2.x, p2.y, a.x, a.y, b.x, b.y);
                if (d2.dist < bestD2 && d2.dist > 0) {
                    bestD2 = d2.dist;
                    x2 = d2.cx; y2 = d2.cy;
                }
            }
            dividers.push({ x1, y1, x2, y2 });
        }
    }

    if (dividers.length === 0) {
        return [{ polygon: outerPoly, area: Math.abs(signedArea(outerPoly)) }];
    }

    // Use graph-based planar subdivision
    // Build all edges (outer polygon edges + dividers) and compute faces
    const edges = [];

    // Outer polygon edges
    for (let i = 0; i < outerPoly.length; i++) {
        const j = (i + 1) % outerPoly.length;
        edges.push({
            x1: outerPoly[i].x, y1: outerPoly[i].y,
            x2: outerPoly[j].x, y2: outerPoly[j].y,
        });
    }

    // Divider edges
    for (const div of dividers) {
        edges.push(div);
    }

    // Compute all intersection points
    const allPoints = new Map(); // key -> {x,y}
    const ptKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

    // Collect all vertices
    const addPt = (x, y) => {
        const k = ptKey(x, y);
        if (!allPoints.has(k)) allPoints.set(k, { x: Math.round(x), y: Math.round(y) });
        return allPoints.get(k);
    };

    for (const e of edges) {
        addPt(e.x1, e.y1);
        addPt(e.x2, e.y2);
    }

    // Find all edge-edge intersections
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            const isect = segmentIntersection(
                edges[i].x1, edges[i].y1, edges[i].x2, edges[i].y2,
                edges[j].x1, edges[j].y1, edges[j].x2, edges[j].y2
            );
            if (isect) addPt(isect.x, isect.y);
        }
    }

    // Build adjacency graph
    const pointsList = [...allPoints.values()];

    // For each edge, find all points on it and create sub-edges
    const graph = new Map(); // ptKey -> Set<ptKey>

    const addEdge = (a, b) => {
        const ka = ptKey(a.x, a.y);
        const kb = ptKey(b.x, b.y);
        if (ka === kb) return;
        if (!graph.has(ka)) graph.set(ka, new Set());
        if (!graph.has(kb)) graph.set(kb, new Set());
        graph.get(ka).add(kb);
        graph.get(kb).add(ka);
    };

    for (const e of edges) {
        // Find all points lying on this edge
        const onEdge = pointsList.filter(p => {
            const d = pointToSegmentDist(p.x, p.y, e.x1, e.y1, e.x2, e.y2);
            return d.dist < 10; // within 10mm tolerance (accounts for grid snap vs polygon offset)
        });

        // Sort along edge direction
        const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
        onEdge.sort((a, b) => {
            const ta = (a.x - e.x1) * dx + (a.y - e.y1) * dy;
            const tb = (b.x - e.x1) * dx + (b.y - e.y1) * dy;
            return ta - tb;
        });

        // Create sub-edges
        for (let i = 0; i < onEdge.length - 1; i++) {
            addEdge(onEdge[i], onEdge[i + 1]);
        }
    }

    // Find minimal cycles (rooms) using face extraction
    const rooms = extractFaces(graph, allPoints, outerPoly);
    return rooms;
};

/**
 * Extract faces (rooms) from a planar graph.
 * Uses the "next edge by angle" approach for minimal cycle detection.
 */
const extractFaces = (graph, allPoints, outerPoly) => {
    const ptKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;
    const usedHalfEdges = new Set();
    const faces = [];

    const getPoint = (key) => allPoints.get(key);

    // For each half-edge, find the next half-edge in the face
    const getNextEdge = (fromKey, toKey) => {
        const to = getPoint(toKey);
        const from = getPoint(fromKey);
        if (!to || !from) return null;

        const neighbors = graph.get(toKey);
        if (!neighbors || neighbors.size === 0) return null;

        // Angle of incoming edge (from -> to)
        const inAngle = Math.atan2(from.y - to.y, from.x - to.x);

        // Find the neighbor with smallest CW angle from incoming direction
        let bestKey = null;
        let bestAngle = Infinity;

        for (const nk of neighbors) {
            if (nk === fromKey) continue; // don't go back
            const n = getPoint(nk);
            if (!n) continue;

            const outAngle = Math.atan2(n.y - to.y, n.x - to.x);
            let diff = outAngle - inAngle;
            // Normalize to (0, 2π) — we want the most clockwise turn
            while (diff <= 0) diff += Math.PI * 2;
            while (diff > Math.PI * 2) diff -= Math.PI * 2;

            if (diff < bestAngle) {
                bestAngle = diff;
                bestKey = nk;
            }
        }

        return bestKey;
    };

    // Iterate all directed edges
    for (const [fromKey, neighbors] of graph) {
        for (const toKey of neighbors) {
            const heKey = `${fromKey}->${toKey}`;
            if (usedHalfEdges.has(heKey)) continue;

            // Trace face
            const face = [];
            let curFrom = fromKey;
            let curTo = toKey;
            let valid = true;
            const maxSteps = 100;

            for (let step = 0; step < maxSteps; step++) {
                const hk = `${curFrom}->${curTo}`;
                if (usedHalfEdges.has(hk)) { valid = false; break; }
                usedHalfEdges.add(hk);
                face.push(curTo);

                const next = getNextEdge(curFrom, curTo);
                if (!next) { valid = false; break; }

                curFrom = curTo;
                curTo = next;

                if (curTo === toKey && curFrom === fromKey) break; // closed
                if (curTo === face[0] && face.length >= 3) break; // closed to start
            }

            if (!valid || face.length < 3) continue;

            const polygon = face.map(k => getPoint(k)).filter(Boolean);
            const area = Math.abs(signedArea(polygon));

            // Skip the outer boundary face (largest area or area close to outer polygon)
            const outerArea = Math.abs(signedArea(outerPoly));
            if (area > outerArea * 0.95) continue;
            if (area < MIN_ROOM_AREA) continue;

            // Verify centroid is inside outer polygon
            const c = polygonCentroid(polygon);
            if (!pointInPolygon(c.x, c.y, outerPoly)) continue;

            faces.push({ polygon, area });
        }
    }

    // Deduplicate faces that share the same centroid
    const unique = [];
    const usedCentroids = new Set();
    for (const f of faces) {
        const c = polygonCentroid(f.polygon);
        const ck = `${Math.round(c.x / 100)},${Math.round(c.y / 100)}`;
        if (!usedCentroids.has(ck)) {
            usedCentroids.add(ck);
            unique.push(f);
        }
    }

    return unique;
};

// ─── Hit Testing ────────────────────────────────────────────────

/**
 * Find furniture at a given point.
 */
export const findFurnitureAtPoint = (storey, px, py) => {
    // Check in reverse order (topmost first)
    for (let i = storey.furniture.length - 1; i >= 0; i--) {
        const f = storey.furniture[i];
        const cos = Math.cos(-f.rotation * Math.PI / 180);
        const sin = Math.sin(-f.rotation * Math.PI / 180);

        // Transform point to furniture local coords
        const lx = cos * (px - f.x) - sin * (py - f.y);
        const ly = sin * (px - f.x) + cos * (py - f.y);

        if (lx >= 0 && lx <= f.width_mm && ly >= 0 && ly <= f.depth_mm) {
            return f;
        }
    }
    return null;
};

/**
 * Find opening at a given point.
 */
export const findOpeningAtPoint = (storey, px, py) => {
    for (const opening of storey.openings) {
        const wall = storey.walls.find(w => w.id === opening.wall_id);
        if (!wall) continue;
        const pt1 = getPoint(storey, wall.p1);
        const pt2 = getPoint(storey, wall.p2);
        if (!pt1 || !pt2) continue;

        const wallLen = dist(pt1, pt2);
        const dx = (pt2.x - pt1.x) / wallLen;
        const dy = (pt2.y - pt1.y) / wallLen;

        const centerT = opening.position_mm / wallLen;
        const cx = pt1.x + dx * opening.position_mm;
        const cy = pt1.y + dy * opening.position_mm;

        if (dist({ x: px, y: py }, { x: cx, y: cy }) < opening.width_mm / 2 + 50) {
            return opening;
        }
    }
    return null;
};

/**
 * Find room at a given point.
 */
export const findRoomAtPoint = (storey, px, py) => {
    for (const room of storey.rooms) {
        if (pointInPolygon(px, py, room.polygon)) return room;
    }
    return null;
};

/**
 * Determine which side of a wall segment a point is on.
 * Returns 'left' or 'right'.
 */
export const getPointSide = (px, py, p1x, p1y, p2x, p2y) => {
    const cross = (p2x - p1x) * (py - p1y) - (p2y - p1y) * (px - p1x);
    return cross > 0 ? 'left' : 'right';
};
