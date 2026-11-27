// ─── Geometry Kernel ────────────────────────────────────────────────
// Pure integer (mm) geometry operations for the floor plan editor.
// No external dependencies. Deterministic computations.

import {
    SNAP_GRID, ANGLE_SNAP, SNAP_TOLERANCE, MIN_WALL_SEGMENT, MIN_ROOM_AREA,
    WALL_THICKNESS, OPENING_MIN_EDGE_DIST,
} from './constants.js';

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
 * Polygon centroid (flächengewichteter Schwerpunkt).
 * Bei entarteten Polygonen (Fläche ≈ 0) Mittelwert der Eckpunkte.
 */
export const polygonCentroid = (pts) => {
    if (!pts || pts.length === 0) return { x: 0, y: 0 };
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const cross = p.x * q.y - q.x * p.y;
        a += cross;
        cx += (p.x + q.x) * cross;
        cy += (p.y + q.y) * cross;
    }
    if (Math.abs(a) < 1e-6) {
        let mx = 0, my = 0;
        for (const p of pts) { mx += p.x; my += p.y; }
        return { x: Math.round(mx / pts.length), y: Math.round(my / pts.length) };
    }
    return { x: Math.round(cx / (3 * a)), y: Math.round(cy / (3 * a)) };
};

/**
 * Liefert einen Punkt, der garantiert im Polygon liegt (für Beschriftungen und
 * Innen-Prüfungen). Bei konvexen Polygonen der Schwerpunkt, sonst die Mitte des
 * breitesten Abschnitts einer horizontalen Schnittlinie.
 */
export const polygonInteriorPoint = (pts) => {
    if (!pts || pts.length < 3) return polygonCentroid(pts || []);
    const c = polygonCentroid(pts);
    if (pointInPolygon(c.x, c.y, pts)) return c;

    const widestOnLine = (y) => {
        const xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[j], b = pts[i];
            if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
        xs.sort((p, q) => p - q);
        let best = null;
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const w = xs[k + 1] - xs[k];
            if (!best || w > best.w) best = { w, x: (xs[k] + xs[k + 1]) / 2, y };
        }
        return best;
    };

    // Erst die Schnittlinie durch den Schwerpunkt, dann Linien zwischen den Eckpunkt-Höhen
    let best = widestOnLine(c.y);
    if (!best) {
        const ys = [...new Set(pts.map(p => p.y))].sort((a, b) => a - b);
        for (let i = 0; i < ys.length - 1; i++) {
            const cand = widestOnLine((ys[i] + ys[i + 1]) / 2);
            if (cand && (!best || cand.w > best.w)) best = cand;
        }
    }
    return best ? { x: Math.round(best.x), y: Math.round(best.y) } : c;
};

/**
 * Offset polygon inward by `dist` mm.
 * Uses miter join with bevel fallback for sharp angles.
 * Input: CW polygon points. Output: offset polygon points.
 * `offset` ist entweder eine Zahl (alle Kanten gleich) oder ein Array mit einem
 * Wert je Kante i → i+1 (z. B. unterschiedliche Außenwanddicken).
 * Negativer Offset = nach außen.
 */
export const offsetPolygon = (pts, offset) => {
    const n = pts.length;
    if (n < 3) return [];
    const offsetAt = (i) => (Array.isArray(offset) ? (Number(offset[i]) || 0) : offset);

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
            len,
            off: offsetAt(i),
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

        const o1x = p1.x + e1.nx * e1.off, o1y = p1.y + e1.ny * e1.off;
        const o2x = p2.x + e1.nx * e1.off, o2y = p2.y + e1.ny * e1.off;
        const o3x = p3.x + e2.nx * e2.off, o3y = p3.y + e2.ny * e2.off;
        const o4x = p4.x + e2.nx * e2.off, o4y = p4.y + e2.ny * e2.off;

        // Intersect the two offset lines
        const d1x = o2x - o1x, d1y = o2y - o1y;
        const d2x = o4x - o3x, d2y = o4y - o3y;
        const cross = d1x * d2y - d1y * d2x;
        // Sinus des Knickwinkels (Kreuzprodukt normiert auf die Kantenlängen)
        const sin = Math.abs(cross) / ((Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) || 1);

        if (sin < 1e-6) {
            // Parallele (kollineare) Kanten: bei gleicher Dicke ein Punkt,
            // bei unterschiedlicher Dicke ein Versatz mit zwei Punkten
            result.push({ x: Math.round(o2x), y: Math.round(o2y) });
            if (Math.hypot(o3x - o2x, o3y - o2y) > 0.5) {
                result.push({ x: Math.round(o3x), y: Math.round(o3y) });
            }
        } else {
            const t = ((o3x - o1x) * d2y - (o3y - o1y) * d2x) / cross;
            const ix = o1x + t * d1x;
            const iy = o1y + t * d1y;

            // Check miter length (Betrag, denn der Offset ist nach außen negativ)
            const refPt = pts[e1.j]; // the corner point
            const miterLen = dist({ x: ix, y: iy }, refPt);
            const maxOffset = Math.max(Math.abs(e1.off), Math.abs(e2.off));

            if (miterLen > maxOffset * MITER_LIMIT) {
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

/**
 * Sutherland–Hodgman: beschneidet ein (beliebiges) Polygon an einem konvexen
 * Polygon. Die Fläche des Ergebnisses ist auch bei konkavem Eingangspolygon korrekt.
 */
const clipPolygonByConvex = (subject, clip) => {
    if (!subject || subject.length < 3 || !clip || clip.length < 3) return [];
    const orientation = signedArea(clip) >= 0 ? 1 : -1;
    let output = subject;
    for (let i = 0; i < clip.length && output.length > 0; i++) {
        const A = clip[i], B = clip[(i + 1) % clip.length];
        const ex = B.x - A.x, ey = B.y - A.y;
        if (ex === 0 && ey === 0) continue;
        const inside = (p) => orientation * (ex * (p.y - A.y) - ey * (p.x - A.x)) >= 0;
        const intersect = (P, Q) => {
            const dx = Q.x - P.x, dy = Q.y - P.y;
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) return { x: Q.x, y: Q.y };
            const t = ((A.x - P.x) * ey - (A.y - P.y) * ex) / den;
            return { x: P.x + t * dx, y: P.y + t * dy };
        };
        const input = output;
        output = [];
        for (let j = 0; j < input.length; j++) {
            const P = input[(j + input.length - 1) % input.length];
            const Q = input[j];
            const qIn = inside(Q);
            if (qIn) {
                if (!inside(P)) output.push(intersect(P, Q));
                output.push(Q);
            } else if (inside(P)) {
                output.push(intersect(P, Q));
            }
        }
    }
    return output;
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
 * Übernimmt Wände, Öffnungen, Möbel, Decken, Dach, Anmerkungen und Raumnamen
 * als tiefe Kopie. Das Hintergrundbild (Kalibrier-Vorlage, oft mehrere MB als
 * Base64) bleibt bewusst beim Ursprungsgeschoss und wird nicht verdoppelt.
 */
export const duplicateStorey = (storey, newLabel) => {
    const idMap = {};
    const newId = (oldId) => {
        if (oldId === undefined || oldId === null) return oldId;
        if (!idMap[oldId]) idMap[oldId] = genId();
        return idMap[oldId];
    };

    // Plan-Daten sind reines JSON → tiefe Kopie ohne geteilte Objekte
    // eslint-disable-next-line no-unused-vars
    const { bgImage, ...rest } = storey;
    const clone = JSON.parse(JSON.stringify(rest));

    const copy = {
        ...clone,
        id: genId(),
        label: newLabel,
        height_mm: clone.height_mm,
        ref_height_mm: clone.ref_height_mm || 0,
        points: (clone.points || []).map(p => ({ ...p, id: newId(p.id) })),
        walls: (clone.walls || []).map(w => ({
            ...w,
            id: newId(w.id),
            p1: newId(w.p1),
            p2: newId(w.p2),
        })),
        openings: (clone.openings || []).map(o => {
            const { wallId: legacyWallId, ...op } = o;
            return { ...op, id: genId(), wall_id: newId(o.wall_id ?? legacyWallId) };
        }),
        furniture: (clone.furniture || []).map(f => ({ ...f, id: genId() })),
        rooms: (clone.rooms || []).map(r => {
            const { _labelHitBox, ...room } = r; // flüchtige Render-Daten nicht übernehmen
            return { ...room, id: genId() };
        }),
        slabs: (clone.slabs || []).map(s => ({ ...s, id: genId() })),
        annotations: (clone.annotations || []).map(a => {
            const { _hitBox, ...ann } = a;
            return { ...ann, id: genId() };
        }),
        outerClosed: !!clone.outerClosed,
        outerPolygon: clone.outerPolygon || null,
        outerBoundary: clone.outerBoundary || null,
        roof: clone.roof || null,
    };

    // outerPolygon referenziert im Original die Punktobjekte → auf die neuen Punkte abbilden
    if (Array.isArray(copy.outerPolygon)) {
        copy.outerPolygon = copy.outerPolygon.map(p => {
            if (p && p.id !== undefined && idMap[p.id]) {
                return copy.points.find(np => np.id === idMap[p.id]) || { ...p, id: idMap[p.id] };
            }
            return p;
        });
    }

    computeRooms(copy);
    return copy;
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

// Index-Cache je Punkt-Array: id → Position. Jeder Treffer wird gegen das Array
// geprüft, Änderungen (push/splice/filter) erzwingen einen Neuaufbau.
const _pointIndexCache = new WeakMap();

/**
 * Get point by ID.
 */
export const getPoint = (storey, id) => {
    const points = storey?.points;
    if (!points) return undefined;
    let index = _pointIndexCache.get(points);
    if (index) {
        const i = index.get(id);
        if (i !== undefined && points[i] && points[i].id === id) return points[i];
    }
    index = new Map();
    for (let i = 0; i < points.length; i++) {
        if (points[i] && !index.has(points[i].id)) index.set(points[i].id, i);
    }
    _pointIndexCache.set(points, index);
    const i = index.get(id);
    return i !== undefined ? points[i] : undefined;
};

/**
 * Wand-ID einer Öffnung (kanonisch `wall_id`, ältere Daten ggf. `wallId`).
 */
export const getOpeningWallId = (opening) => (opening ? (opening.wall_id ?? opening.wallId) : undefined);

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
 * Verfolgt eine Wandkette über gemeinsame Punkte (Wände dürfen in beliebiger
 * Richtung gespeichert sein). `used` (Set von Wand-IDs) wird fortgeschrieben.
 * Rückgabe: { walls, nodes, closed } – walls[k] verbindet nodes[k] mit nodes[k+1]
 * (bei geschlossener Kette: nodes.length === walls.length, sonst +1).
 */
export const traceWallChain = (walls, startWall, used = new Set()) => {
    used.add(startWall.id);
    const chainWalls = [startWall];
    const nodes = [startWall.p1, startWall.p2];
    let closed = false;

    // Vorwärts ab p2
    let cur = startWall.p2;
    for (let guard = 0; guard < walls.length; guard++) {
        if (cur === nodes[0]) { closed = true; break; }
        const next = walls.find(w => !used.has(w.id) && (w.p1 === cur || w.p2 === cur));
        if (!next) break;
        used.add(next.id);
        chainWalls.push(next);
        cur = next.p1 === cur ? next.p2 : next.p1;
        nodes.push(cur);
    }
    if (!closed && nodes.length > 1 && nodes[nodes.length - 1] === nodes[0]) closed = true;
    if (closed) {
        nodes.pop(); // letzter Knoten = Startknoten
        return { walls: chainWalls, nodes, closed: true };
    }

    // Rückwärts ab p1
    cur = startWall.p1;
    for (let guard = 0; guard < walls.length; guard++) {
        const prev = walls.find(w => !used.has(w.id) && (w.p1 === cur || w.p2 === cur));
        if (!prev) break;
        used.add(prev.id);
        chainWalls.unshift(prev);
        cur = prev.p1 === cur ? prev.p2 : prev.p1;
        nodes.unshift(cur);
    }
    return { walls: chainWalls, nodes, closed: false };
};

/**
 * Zerlegt Wände in zusammenhängende Ketten (siehe traceWallChain).
 */
export const buildWallChains = (walls) => {
    const used = new Set();
    const chains = [];
    for (const w of walls || []) {
        if (used.has(w.id)) continue;
        chains.push(traceWallChain(walls, w, used));
    }
    return chains;
};

/**
 * Hauptkette der Außenwände: der erste geschlossene Ring (ab walls[0] gesucht).
 * Gibt es keinen Ring, wird nur eine einzige offene Kette über ALLE Wände
 * akzeptiert (Schlusskante implizit); sonst null.
 */
const findPrimaryWallChain = (walls) => {
    if (!walls || walls.length === 0) return null;
    const chains = [];
    const used = new Set();
    for (const w of walls) {
        if (used.has(w.id)) continue;
        const chain = traceWallChain(walls, w, used);
        if (chain.closed && chain.walls.length >= 3) return chain;
        chains.push(chain);
    }
    if (chains.length === 1 && chains[0].walls.length === walls.length) return chains[0];
    return null;
};

/**
 * Kehrt die Richtung einer Wand um (p1 ↔ p2), ohne ihre Lage zu ändern:
 * Öffnungspositionen werden gespiegelt, der Türanschlag bleibt an derselben
 * Stelle (swing links ↔ rechts), bei Innenwänden bleibt die Dickenseite erhalten.
 */
const reverseWallDirection = (storey, wall) => {
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    const len = pt1 && pt2 ? dist(pt1, pt2) : 0;
    const oldP1 = wall.p1;
    wall.p1 = wall.p2;
    wall.p2 = oldP1;
    if (wall.type !== 'outer' && (wall.ref_edge === 'left' || wall.ref_edge === 'right')) {
        wall.ref_edge = wall.ref_edge === 'left' ? 'right' : 'left';
    }
    for (const o of storey.openings || []) {
        if (getOpeningWallId(o) !== wall.id) continue;
        if (len > 0 && Number.isFinite(o.position_mm)) o.position_mm = len - o.position_mm;
        if (o.swing === 'left') o.swing = 'right';
        else if (o.swing === 'right') o.swing = 'left';
    }
};

/**
 * Bringt alle Außenwände der Hauptkette in eine einheitliche Laufrichtung, bei
 * der die Wanddicke (innenbündig) nach außen zeigt – unabhängig davon, in welcher
 * Drehrichtung der Nutzer den Umriss gezeichnet hat. Gibt true zurück, wenn
 * mindestens eine Wand umgedreht wurde.
 */
export const normalizeOuterWallDirections = (storey) => {
    const outerWalls = (storey?.walls || []).filter(w => w.type === 'outer');
    if (outerWalls.length < 3) return false;
    const chain = findPrimaryWallChain(outerWalls);
    if (!chain) return false;
    const pts = chain.nodes.map(id => getPoint(storey, id));
    if (pts.some(p => !p)) return false;
    const area = signedArea(pts);
    if (Math.abs(area) < 1) return false;
    // Positive Fläche (y nach unten) ⇒ die Dickenseite -n (siehe getWallPolygon) liegt außen
    const forward = area > 0;
    let changed = false;
    chain.walls.forEach((w, k) => {
        const a = chain.nodes[k];
        const b = chain.nodes[(k + 1) % chain.nodes.length];
        const wantP1 = forward ? a : b;
        if (w.p1 !== wantP1) {
            reverseWallDirection(storey, w);
            changed = true;
        }
    });
    return changed;
};

/**
 * Berechnet outerPolygon (Innenkante = Raumgrenze) und outerBoundary
 * (Außenkante, je Kante mit der Dicke der zugehörigen Wand) neu.
 */
export const updateOuterBoundary = (storey) => {
    const outerWalls = (storey?.walls || []).filter(w => w.type === 'outer');
    if (outerWalls.length < 3) return false;
    const polygon = buildOrderedPolygon(outerWalls, storey.points);
    if (!polygon || polygon.length < 3) return false;
    const cwPoly = ensureCW(polygon);
    const fallback = outerWalls[0].thickness_mm || WALL_THICKNESS.outerDefault;
    const offsets = cwPoly.map((p, i) => {
        const q = cwPoly[(i + 1) % cwPoly.length];
        const wall = outerWalls.find(w => (w.p1 === p.id && w.p2 === q.id) || (w.p1 === q.id && w.p2 === p.id));
        return -((wall && wall.thickness_mm) || fallback);
    });
    storey.outerPolygon = [...cwPoly]; // inner edge = room boundary
    // Compute outer boundary (offset outward = negative offset for CW)
    storey.outerBoundary = offsetPolygon(cwPoly, offsets);
    return true;
};

/**
 * Close the outer wall polygon. Computes inner polygon via offset.
 */
export const closeOuterWalls = (storey) => {
    const outerWalls = storey.walls.filter(w => w.type === 'outer');
    if (outerWalls.length < 3) return false;

    // Wandrichtungen vereinheitlichen, damit die Dicke immer nach außen liegt
    normalizeOuterWallDirections(storey);

    // Innenbündig: drawn points = inner edge (room boundary); Außenkontur je Wanddicke
    if (!updateOuterBoundary(storey)) return false;

    storey.outerClosed = true;
    return true;
};

/**
 * Build ordered polygon points from wall segments.
 * Folgt den Wänden über gemeinsame Punkte (auch rückwärts gespeicherte Wände)
 * und liefert die Eckpunkte in Laufrichtung. Ohne geschlossenen Ring wird nur eine
 * einzige offene Kette über alle Wände akzeptiert, sonst null.
 */
export const buildOrderedPolygon = (walls, points) => {
    if (!walls || walls.length === 0) return null;
    const chain = findPrimaryWallChain(walls);
    if (!chain) return null;
    const getP = (id) => points.find(p => p.id === id);
    const pts = chain.nodes.map(getP);
    if (pts.some(p => !p)) return null;
    return pts;
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

    // Create two new walls with same properties (alle Felder, z. B. ref_height_mm)
    const wall1 = { ...wall, id: genId(), p1: wall.p1, p2: midPt.id };
    const wall2 = { ...wall, id: genId(), p1: midPt.id, p2: wall.p2 };

    // Replace original wall with the two new ones
    storey.walls.splice(wallIdx, 1, wall1, wall2);

    // Teilungspunkt entlang der alten Wandachse (addPoint kann auf einen Nachbarpunkt fangen)
    const splitDist = Math.max(0, Math.min(wallLen,
        ((midPt.x - pt1.x) * dx + (midPt.y - pt1.y) * dy) / wallLen));
    const len1 = dist(pt1, midPt);
    const len2 = dist(midPt, pt2);

    // Move any openings from old wall to the correct new wall
    for (const opening of storey.openings || []) {
        if (getOpeningWallId(opening) !== wallId) continue;
        const half = (Number(opening.width_mm) || 0) / 2;
        const center = Number(opening.position_mm) || 0;
        if (center < splitDist) {
            let pos = center;
            // Ragt die Öffnung über den Teilungspunkt, in ihre Teilwand zurückschieben
            const maxPos = len1 - half - OPENING_MIN_EDGE_DIST;
            if (pos > maxPos) pos = Math.max(half, maxPos);
            opening.wall_id = wall1.id;
            opening.position_mm = pos;
        } else {
            let pos = center - splitDist;
            const minPos = half + OPENING_MIN_EDGE_DIST;
            if (pos < minPos) pos = Math.min(Math.max(half, len2 - half), minPos);
            opening.wall_id = wall2.id;
            opening.position_mm = pos;
        }
        if ('wallId' in opening) delete opening.wallId;
    }

    return midPt;
};

/**
 * Ermittelt bei Außenwänden, ob die Dicke entgegen der gespeicherten Laufrichtung
 * liegen muss (Umriss gegen den Uhrzeigersinn gezeichnet, ältere Pläne). Geprüft
 * wird, auf welcher Seite der Wandmitte das Rauminnere (outerPolygon) liegt; nur
 * ein eindeutiges Ergebnis führt zum Umklappen.
 */
const isOuterWallFlipped = (storey, pt1, pt2, nx, ny, len) => {
    const poly = storey && storey.outerClosed ? storey.outerPolygon : null;
    if (!poly || poly.length < 3) return false;
    const probe = Math.min(20, len / 4);
    const mx = (pt1.x + pt2.x) / 2, my = (pt1.y + pt2.y) / 2;
    const defaultSideInside = pointInPolygon(mx - nx * probe, my - ny * probe, poly);
    const otherSideInside = pointInPolygon(mx + nx * probe, my + ny * probe, poly);
    return defaultSideInside && !otherSideInside;
};

/**
 * Compute wall geometry (polygon corners of the thick wall).
 * Returns 4 points: [p1_left, p2_left, p2_right, p1_right]
 * Bei Außenwänden ist poly[0]→poly[1] immer die Außenfläche und
 * poly[3]→poly[2] die Referenzlinie (Innenkante).
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
        const s = isOuterWallFlipped(storey, pt1, pt2, nx, ny, len) ? -1 : 1;
        return [
            { x: Math.round(pt1.x - s * nx * t), y: Math.round(pt1.y - s * ny * t) },
            { x: Math.round(pt2.x - s * nx * t), y: Math.round(pt2.y - s * ny * t) },
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
 * Lage der beiden Wandflächen relativ zur Referenzlinie p1→p2, gemessen entlang
 * der Normalen n = (-dy, dx)/len: { min, max } (min ≤ max). interiorSign gibt bei
 * Außenwänden an, auf welcher Seite (+1 = +n, -1 = -n) das Gebäudeinnere liegt;
 * bei Innenwänden ist er +1 (bisherige Bedeutung von „innen“).
 */
export const getWallFaceOffsets = (wall, storey) => {
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return null;
    const dx = pt2.x - pt1.x, dy = pt2.y - pt1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;
    const nx = -dy / len, ny = dx / len;
    const poly = getWallPolygon(wall, storey);
    if (!poly) return null;
    const offsetOf = (p) => (p.x - pt1.x) * nx + (p.y - pt1.y) * ny;
    const o0 = offsetOf(poly[0]); // bei Außenwänden: Außenfläche
    const o3 = offsetOf(poly[3]); // bei Außenwänden: Referenz-/Innenfläche
    return {
        min: Math.min(o0, o3),
        max: Math.max(o0, o3),
        interiorSign: wall.type === 'outer' ? (Math.sign(o3 - o0) || 1) : 1,
        nx, ny, ux: dx / len, uy: dy / len, len,
    };
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
    storey.openings = storey.openings.filter(o => getOpeningWallId(o) !== wallId);
    storey.walls = storey.walls.filter(w => w.id !== wallId);
};

// ─── Opening Operations ─────────────────────────────────────────

/**
 * Find which wall a point (screen coords) is closest to.
 * Returns { wall, t, dist } or null.
 * Getroffen wird der tatsächliche Wandkörper (plus maxDist Toleranz) – die Dicke
 * zählt nur auf der Seite, auf der die Wand wirklich liegt.
 */
export const findWallAtPoint = (storey, px, py, maxDist = 30) => {
    let best = null;
    for (const wall of storey.walls) {
        const pt1 = getPoint(storey, wall.p1);
        const pt2 = getPoint(storey, wall.p2);
        if (!pt1 || !pt2) continue;
        const result = pointToSegmentDist(px, py, pt1.x, pt1.y, pt2.x, pt2.y);

        let bodyDist = result.dist;
        const poly = getWallPolygon(wall, storey);
        if (poly) {
            if (pointInPolygon(px, py, poly)) {
                bodyDist = 0;
            } else {
                bodyDist = Infinity;
                for (let i = 0; i < poly.length; i++) {
                    const a = poly[i], b = poly[(i + 1) % poly.length];
                    bodyDist = Math.min(bodyDist, pointToSegmentDist(px, py, a.x, a.y, b.x, b.y).dist);
                }
            }
        }
        // Ungültige Wanddicke (Altdaten) ergibt NaN-Polygone → Abstand zur Referenzlinie
        if (!Number.isFinite(bodyDist)) bodyDist = result.dist;
        if (!(bodyDist <= maxDist)) continue; // auch NaN ausschließen
        if (!best || bodyDist < best.bodyDist || (bodyDist === best.bodyDist && result.dist < best.dist)) {
            best = { wall, t: result.t, dist: result.dist, cx: result.cx, cy: result.cy, bodyDist };
        }
    }
    return best;
};

/**
 * Mittelpunkt einer Öffnung entlang der Wand (mm ab p1), auf die Wandlänge
 * begrenzt – so bleiben Öffnungen nach dem Verkürzen einer Wand auf der Wand.
 */
export const getOpeningCenterMm = (opening, wallLen) => {
    const half = (Number(opening?.width_mm) || 0) / 2;
    const pos = Number(opening?.position_mm) || 0;
    if (wallLen >= half * 2) return Math.min(wallLen - half, Math.max(half, pos));
    return wallLen / 2;
};

/**
 * Place an opening (door/window) on a wall.
 * Die Position wird zuerst in den zulässigen Bereich (Randabstand
 * OPENING_MIN_EDGE_DIST) geklemmt, dann gerastert und danach geprüft.
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
    if (!(width > 0) || !Number.isFinite(positionMm)) return null;

    // Validate: opening fits in wall
    const lo = width / 2 + OPENING_MIN_EDGE_DIST;
    const hi = wallLen - width / 2 - OPENING_MIN_EDGE_DIST;
    if (hi < lo) return null; // Wand zu kurz für diese Öffnung
    let position = snapToGrid(Math.min(hi, Math.max(lo, positionMm)));
    if (position < lo) position += SNAP_GRID;
    if (position > hi) position -= SNAP_GRID;
    if (position < lo || position > hi) position = Math.round(Math.min(hi, Math.max(lo, positionMm)));

    // Check for overlaps with existing openings
    for (const existing of storey.openings.filter(o => getOpeningWallId(o) === wallId)) {
        const eStart = existing.position_mm - existing.width_mm / 2;
        const eEnd = existing.position_mm + existing.width_mm / 2;
        const nStart = position - width / 2;
        const nEnd = position + width / 2;
        if (nStart < eEnd && nEnd > eStart) return null; // overlap
    }

    const opening = {
        id: genId(),
        wall_id: wallId,
        type,
        position_mm: position,
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

/**
 * Eckpunkte eines Möbelstücks in Weltkoordinaten. Ursprung (x, y) ist die obere
 * linke Ecke, gedreht wird um diesen Punkt (wie drawFurniture2D und
 * findFurnitureAtPoint). Fehlende Maße werden wie bisher mit 500 mm angenommen.
 */
export const getFurnitureCorners = (furn) => {
    const w = Number(furn?.width_mm) || 500;
    const d = Number(furn?.depth_mm) || 500;
    const rad = ((Number(furn?.rotation) || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const x = Number(furn?.x) || 0, y = Number(furn?.y) || 0;
    return [[0, 0], [w, 0], [w, d], [0, d]].map(([lx, ly]) => ({
        x: x + lx * cos - ly * sin,
        y: y + lx * sin + ly * cos,
    }));
};

/**
 * Achsparallele Hülle eines (ggf. gedrehten) Möbelstücks.
 */
export const getFurnitureBounds = (furn) => {
    const corners = getFurnitureCorners(furn);
    return {
        minX: Math.min(...corners.map(c => c.x)),
        minY: Math.min(...corners.map(c => c.y)),
        maxX: Math.max(...corners.map(c => c.x)),
        maxY: Math.max(...corners.map(c => c.y)),
    };
};

// ─── Room Computation ───────────────────────────────────────────

/**
 * Compute rooms from wall geometry.
 * Uses a simplified approach: builds enclosed regions from inner edges.
 * For MVP, we detect rooms from the outer polygon minus inner wall divisions.
 * area_mm2 ist die Netto-Fläche (lichte Fläche): die Grundfläche der
 * Innenwände ist abgezogen; gross_area_mm2 enthält die Fläche bis zu den
 * Wand-Referenzlinien.
 */
export const computeRooms = (storey) => {
    if (!storey.outerClosed || !storey.outerPolygon || storey.outerPolygon.length < 3) {
        storey.rooms = [];
        return;
    }

    const oldRooms = (storey.rooms || []).filter(r => r && Array.isArray(r.polygon) && r.polygon.length >= 3);
    const innerWalls = storey.walls.filter(w => w.type !== 'outer');

    if (innerWalls.length === 0) {
        // Single room = entire inner polygon
        const area = Math.abs(signedArea(storey.outerPolygon));
        const prev = (storey.rooms || [])[0];
        if (area >= MIN_ROOM_AREA) {
            storey.rooms = [{
                id: prev?.id || genId(),
                name: prev?.name || 'Raum 1',
                polygon: [...storey.outerPolygon],
                area_mm2: Math.round(area),
                gross_area_mm2: Math.round(area),
                labelOffsetX: prev?.labelOffsetX || 0,
                labelOffsetY: prev?.labelOffsetY || 0,
            }];
        } else {
            storey.rooms = [];
        }
        return;
    }

    // For multiple inner walls we use a sweep approach:
    // Split the outer polygon using inner wall segments as dividers.
    const rooms = splitPolygonByWalls(storey.outerPolygon, innerWalls, storey)
        .filter(r => r.area >= MIN_ROOM_AREA);

    // Bestehende Räume zuordnen (Name, ID, Label-Versatz behalten): bevorzugt der
    // Altraum, dessen Innenpunkt im neuen Raum liegt; jeder Altraum nur einmal.
    const oldInfo = oldRooms.map(o => ({ room: o, inner: polygonInteriorPoint(o.polygon), centroid: polygonCentroid(o.polygon) }));
    const pairs = [];
    rooms.forEach((r, i) => {
        const c = polygonCentroid(r.polygon);
        oldInfo.forEach((o, j) => {
            const inside = pointInPolygon(o.inner.x, o.inner.y, r.polygon);
            const d = dist(c, o.centroid);
            if (inside || d < 500) pairs.push({ i, j, inside: inside ? 1 : 0, d });
        });
    });
    pairs.sort((a, b) => (b.inside - a.inside) || (a.d - b.d));
    const assigned = new Array(rooms.length).fill(null);
    const usedOld = new Set();
    for (const p of pairs) {
        if (assigned[p.i] || usedOld.has(p.j)) continue;
        assigned[p.i] = oldInfo[p.j].room;
        usedOld.add(p.j);
    }

    const usedNames = new Set(assigned.filter(Boolean).map(r => r.name));
    const nextName = (i) => {
        let n = i + 1;
        while (usedNames.has(`Raum ${n}`)) n++;
        const name = `Raum ${n}`;
        usedNames.add(name);
        return name;
    };

    storey.rooms = rooms.map((r, i) => {
        const existing = assigned[i];
        const netArea = computeNetRoomArea(r.polygon, r.area, innerWalls, storey);
        return {
            id: existing?.id || genId(),
            name: existing?.name || nextName(i),
            polygon: r.polygon,
            area_mm2: Math.round(netArea),
            gross_area_mm2: Math.round(r.area),
            labelOffsetX: existing?.labelOffsetX || 0,
            labelOffsetY: existing?.labelOffsetY || 0,
        };
    });
};

/**
 * Netto-Raumfläche: Fläche bis zu den Referenzlinien minus der Grundfläche der
 * Innenwände, die in den Raum hineinragen. Überlappungen zweier Wände (Stöße,
 * Kreuzungen) werden nur einmal abgezogen.
 */
const computeNetRoomArea = (roomPoly, grossArea, innerWalls, storey) => {
    const parts = [];
    for (const w of innerWalls) {
        const poly = getWallPolygon(w, storey);
        if (!poly) continue;
        const part = clipPolygonByConvex(roomPoly, poly);
        const area = part.length >= 3 ? Math.abs(signedArea(part)) : 0;
        if (area > 0.5) parts.push({ poly, part, area });
    }
    let deducted = parts.reduce((sum, p) => sum + p.area, 0);
    // Doppelt abgezogene Überlappungen zweier Wandkörper wieder hinzurechnen
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
            const overlap = clipPolygonByConvex(parts[i].part, parts[j].poly);
            if (overlap.length >= 3) deducted -= Math.abs(signedArea(overlap));
        }
    }
    return Math.max(0, grossArea - Math.max(0, deducted));
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

    // Sackgassen entfernen: freie Wandenden (Wandstummel, Raumteiler) haben nur
    // eine Kante und würden sonst den ganzen Raum aus der Erkennung werfen.
    let pruned = true;
    while (pruned) {
        pruned = false;
        for (const [key, neighbors] of graph) {
            if (neighbors.size <= 1) {
                for (const other of neighbors) graph.get(other)?.delete(key);
                graph.delete(key);
                pruned = true;
            }
        }
    }

    // Find minimal cycles (rooms) using face extraction
    const rooms = extractFaces(graph, allPoints, outerPoly);
    return rooms;
};

/**
 * Extract faces (rooms) from a planar graph.
 * Uses the "next edge by angle" approach for minimal cycle detection.
 * Mit dieser Abbiege-Regel haben alle inneren Flächen eine negative und die
 * Außenfläche eine positive Umlauf-Fläche (signedArea) – daran wird die
 * Außenfläche erkannt, nicht an ihrer Größe.
 */
const extractFaces = (graph, allPoints, outerPoly) => {
    const usedHalfEdges = new Set();
    const faces = [];

    const getPointByKey = (key) => allPoints.get(key);

    // Obergrenze für die Länge einer Fläche: Anzahl aller Halbkanten
    let halfEdgeCount = 0;
    for (const neighbors of graph.values()) halfEdgeCount += neighbors.size;

    // For each half-edge, find the next half-edge in the face
    const getNextEdge = (fromKey, toKey) => {
        const to = getPointByKey(toKey);
        const from = getPointByKey(fromKey);
        if (!to || !from) return null;

        const neighbors = graph.get(toKey);
        if (!neighbors || neighbors.size === 0) return null;

        // Angle of incoming edge (from -> to)
        const inAngle = Math.atan2(from.y - to.y, from.x - to.x);

        // Find the neighbor with smallest CW angle from incoming direction
        let bestKey = null;
        let bestAngle = Infinity;

        for (const nk of neighbors) {
            const n = getPointByKey(nk);
            if (!n) continue;

            let diff;
            if (nk === fromKey) {
                diff = Math.PI * 2; // Umkehr nur, wenn es keine andere Kante gibt
            } else {
                const outAngle = Math.atan2(n.y - to.y, n.x - to.x);
                diff = outAngle - inAngle;
                // Normalize to (0, 2π) — we want the most clockwise turn
                while (diff <= 0) diff += Math.PI * 2;
                while (diff > Math.PI * 2) diff -= Math.PI * 2;
            }

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
            let closed = false;

            for (let step = 0; step <= halfEdgeCount; step++) {
                const hk = `${curFrom}->${curTo}`;
                if (usedHalfEdges.has(hk)) break;
                usedHalfEdges.add(hk);
                face.push(curTo);

                const next = getNextEdge(curFrom, curTo);
                if (!next) break;

                curFrom = curTo;
                curTo = next;

                if (curFrom === fromKey && curTo === toKey) { closed = true; break; } // zurück an der Start-Halbkante
            }

            // Nicht geschlossene (abgeschnittene) Flächen verwerfen
            if (!closed || face.length < 3) continue;

            const polygon = face.map(k => getPointByKey(k)).filter(Boolean);
            if (polygon.length < 3) continue;
            const signed = signedArea(polygon);

            // Außenfläche (entgegengesetzter Umlaufsinn) überspringen
            if (signed >= 0) continue;
            const area = Math.abs(signed);
            if (area < MIN_ROOM_AREA) continue;

            // Verify the face lies inside the outer polygon (Innenpunkt, nicht Ecken-Mittelwert)
            const c = polygonInteriorPoint(polygon);
            if (!pointInPolygon(c.x, c.y, outerPoly)) continue;

            faces.push({ polygon, area });
        }
    }

    return faces;
};

// ─── Hit Testing ────────────────────────────────────────────────

/**
 * Find furniture at a given point.
 */
export const findFurnitureAtPoint = (storey, px, py) => {
    // Check in reverse order (topmost first)
    for (let i = storey.furniture.length - 1; i >= 0; i--) {
        const f = storey.furniture[i];
        const rot = Number(f.rotation) || 0;
        const cos = Math.cos(-rot * Math.PI / 180);
        const sin = Math.sin(-rot * Math.PI / 180);
        // Gleiche Ersatzwerte wie getFurnitureCorners (Auswahlrahmen): fehlende Maße 500 mm, fehlende Lage 0
        const w = Number(f.width_mm) || 500;
        const d = Number(f.depth_mm) || 500;
        const fx = Number(f.x) || 0, fy = Number(f.y) || 0;

        // Transform point to furniture local coords
        const lx = cos * (px - fx) - sin * (py - fy);
        const ly = sin * (px - fx) + cos * (py - fy);

        if (lx >= 0 && lx <= w && ly >= 0 && ly <= d) {
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
        const wall = storey.walls.find(w => w.id === getOpeningWallId(opening));
        if (!wall) continue;
        const pt1 = getPoint(storey, wall.p1);
        const pt2 = getPoint(storey, wall.p2);
        if (!pt1 || !pt2) continue;

        const wallLen = dist(pt1, pt2);
        if (wallLen < 1) continue;
        const dx = (pt2.x - pt1.x) / wallLen;
        const dy = (pt2.y - pt1.y) / wallLen;

        const center = getOpeningCenterMm(opening, wallLen);
        const cx = pt1.x + dx * center;
        const cy = pt1.y + dy * center;

        if (dist({ x: px, y: py }, { x: cx, y: cy }) < (Number(opening.width_mm) || 0) / 2 + 50) {
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
