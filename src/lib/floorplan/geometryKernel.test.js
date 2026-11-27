// Unit-Tests für den Geometrie-Kern des Grundriss-Editors.
// Einheiten: Millimeter (mm) bzw. mm² (1 m² = 1.000.000 mm²). Bildschirm-Koordinaten:
// y wächst nach unten. Alle Erwartungswerte sind von Hand nachgerechnet (Kommentar).
import { describe, it, expect } from 'vitest';
import {
    genId, dist, snapToGrid, snapPointToGrid, snapAngle, findSnapPoint,
    pointToSegmentDist, segmentIntersection, signedArea, ensureCW, pointInPolygon,
    polygonCentroid, polygonInteriorPoint, offsetPolygon,
    createStorey, duplicateStorey, addPoint, getPoint, getOpeningWallId,
    addOuterWallSegment, addInnerWallSegment, traceWallChain, buildWallChains,
    closeOuterWalls, updateOuterBoundary, buildOrderedPolygon, splitWallAtPoint,
    getWallPolygon, getWallFaceOffsets, flipWallSide, deleteWall,
    findWallAtPoint, getOpeningCenterMm, placeOpening,
    placeFurniture, moveFurniture, getFurnitureCorners, getFurnitureBounds,
    computeRooms, findFurnitureAtPoint, findOpeningAtPoint, findRoomAtPoint, getPointSide,
} from './geometryKernel.js';
import {
    SNAP_TOLERANCE, MIN_WALL_SEGMENT, MIN_ROOM_AREA, WALL_THICKNESS, OPENING_MIN_EDGE_DIST,
} from './constants.js';

// ─── Hilfen ──────────────────────────────────────────────────────
const P = (x, y) => ({ x, y });
const absArea = (pts) => Math.abs(signedArea(pts));
// Punktvergleich mit Toleranz (vermeidet −0/+0-Probleme bei Rundung)
const expectPoint = (actual, x, y, digits = 6) => {
    expect(actual.x).toBeCloseTo(x, digits);
    expect(actual.y).toBeCloseTo(y, digits);
};
const normPts = (pts) => pts
    .map(p => ({ x: p.x + 0, y: p.y + 0 }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

// Rechteck 4,00 × 3,00 m, im Bildschirm im Uhrzeigersinn (Shoelace positiv)
const RECT = [P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)];
// L-Form (konkav): 6 × 3 m oben + 3 × 2 m unten links
const L_SHAPE = [P(0, 0), P(6000, 0), P(6000, 3000), P(3000, 3000), P(3000, 5000), P(0, 5000)];

// Geschoss mit geschlossenem Außenwandzug in der angegebenen Zeichenreihenfolge
const buildOuter = (coords, { close = true, thickness } = {}) => {
    const s = createStorey('EG', 2600);
    const pts = coords.map(([x, y]) => addPoint(s, x, y));
    const walls = pts.map((p, i) => addOuterWallSegment(s, p.id, pts[(i + 1) % pts.length].id, thickness));
    if (close) closeOuterWalls(s);
    return { s, pts, walls };
};
const addInner = (s, [x1, y1], [x2, y2], side = 'left', thickness = 115) => {
    const a = addPoint(s, x1, y1);
    const b = addPoint(s, x2, y2);
    return addInnerWallSegment(s, a.id, b.id, 'inner_nonload', thickness, side);
};
const RECT_COORDS = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]];
const byCentroid = (rooms) => [...rooms].sort((a, b) => {
    const ca = polygonCentroid(a.polygon), cb = polygonCentroid(b.polygon);
    return ca.y - cb.y || ca.x - cb.x;
});
// Physische Lage einer Öffnung (Mittelpunkt) in Weltkoordinaten
const openingWorldCenter = (s, o) => {
    const w = s.walls.find(x => x.id === o.wall_id);
    const a = getPoint(s, w.p1), b = getPoint(s, w.p2);
    const len = dist(a, b);
    return P(a.x + ((b.x - a.x) / len) * o.position_mm, a.y + ((b.y - a.y) / len) * o.position_mm);
};

// ─── Grundrechnen ────────────────────────────────────────────────
describe('dist', () => {
    it('3-4-5-Dreieck: Abstand 5 m', () => {
        expect(dist(P(0, 0), P(3000, 4000))).toBe(5000); // √(3000² + 4000²)
    });
    it('negative Koordinaten und gleicher Punkt', () => {
        expect(dist(P(-1000, -1000), P(2000, 3000))).toBe(5000); // Δ = (3000, 4000)
        expect(dist(P(123, -456), P(123, -456))).toBe(0);
    });
});

describe('snapToGrid / snapPointToGrid (Raster 10 mm)', () => {
    it('rundet auf das nächste Zentimeter-Raster', () => {
        expect(snapToGrid(14)).toBe(10);   // 1,4 → 1
        expect(snapToGrid(16)).toBe(20);   // 1,6 → 2
        expect(snapToGrid(1235)).toBe(1240); // 123,5 → 124 (halb aufwärts)
        expect(snapToGrid(2000)).toBe(2000); // liegt schon im Raster
        expect(snapToGrid(-14)).toBe(-10); // −1,4 → −1
        expect(snapToGrid(-16)).toBe(-20); // −1,6 → −2
        expect(snapToGrid(0)).toBe(0);
    });
    it('Punkt: x und y unabhängig gerastert', () => {
        expect(snapPointToGrid(1234, -567)).toEqual({ x: 1230, y: -570 }); // 123,4→123; −56,7→−57
    });
});

describe('snapAngle (45°-Winkelfang, Länge bleibt erhalten)', () => {
    it('fast waagerecht → exakt waagerecht', () => {
        // atan2(100, 1000) = 5,71° → 0°; Länge √(1000² + 100²) = 1004,99 → Raster 1000
        expect(snapAngle(0, 0, 1000, 100)).toEqual({ x: 1000, y: 0 });
    });
    it('knapp unter 45° → Diagonale', () => {
        // atan2(900, 1000) = 41,99° → 45°; Länge √1.810.000 = 1345,36; ·cos45° = 951,3 → 950
        expect(snapAngle(0, 0, 1000, 900)).toEqual({ x: 950, y: 950 });
    });
    it('135° nach links oben (im Bildschirm links unten)', () => {
        // atan2(950, −1000) = 136,47° → 135°; Länge √1.902.500 = 1379,31; ·0,7071 = 975,3 → 980
        expect(snapAngle(0, 0, -1000, 950)).toEqual({ x: -980, y: 980 });
    });
    it('vom beliebigen Startpunkt senkrecht nach oben (−90°)', () => {
        // Δ = (−500, −2500): atan2 = −101,3° → −90°; Länge √6.500.000 = 2549,51
        // y = 500 − 2549,51 = −2049,51 → Raster −2050; x bleibt 500
        const r = snapAngle(500, 500, 0, -2000);
        expectPoint(r, 500, -2050);
    });
    it('fast 180° in beide Richtungen → waagerecht nach links', () => {
        expectPoint(snapAngle(0, 0, -1000, 10), -1000, 0);  // 179,4° → 180°
        expectPoint(snapAngle(0, 0, -1000, -10), -1000, 0); // −179,4° → −180°
    });
    it('Länge < 1 mm: Endpunkt unverändert (kein Winkel bestimmbar)', () => {
        expect(snapAngle(100, 100, 100.5, 100.5)).toEqual({ x: 100.5, y: 100.5 }); // Länge 0,71
    });
});

describe('findSnapPoint (Fangtoleranz 20 mm)', () => {
    const pts = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1000, y: 0 }, { id: 'c', x: 15, y: 0 }];
    it('liefert den NÄCHSTEN Punkt innerhalb der Toleranz', () => {
        expect(SNAP_TOLERANCE).toBe(20);
        expect(findSnapPoint(10, 0, pts).id).toBe('c'); // a: 10 mm, c: 5 mm
    });
    it('ausgeschlossene IDs werden übersprungen', () => {
        expect(findSnapPoint(10, 0, pts, ['c']).id).toBe('a');
    });
    it('Grenze: genau 20 mm fängt nicht mehr, 19 mm schon (strikt kleiner)', () => {
        const single = [{ id: 'a', x: 0, y: 0 }];
        expect(findSnapPoint(0, 20, single)).toBeNull();
        expect(findSnapPoint(0, 19, single).id).toBe('a');
        expect(findSnapPoint(12, 16, single)).toBeNull(); // √(144 + 256) = 20 → nicht < 20
    });
    it('keine Punkte → null', () => {
        expect(findSnapPoint(0, 0, [])).toBeNull();
    });
});

// ─── Strecken ────────────────────────────────────────────────────
describe('pointToSegmentDist', () => {
    it('Lot auf die Strecke', () => {
        const r = pointToSegmentDist(500, 300, 0, 0, 1000, 0);
        expect(r).toEqual({ dist: 300, t: 0.5, cx: 500, cy: 0 });
    });
    it('vor dem Anfang → Abstand zum Anfangspunkt (t = 0)', () => {
        const r = pointToSegmentDist(-300, 400, 0, 0, 1000, 0);
        expect(r.t).toBe(0);
        expect(r.dist).toBe(500); // √(300² + 400²)
    });
    it('hinter dem Ende → Abstand zum Endpunkt (t = 1)', () => {
        const r = pointToSegmentDist(1300, -400, 0, 0, 1000, 0);
        expect(r.t).toBe(1);
        expect(r.dist).toBe(500);
    });
    it('schräge Strecke: Lotfußpunkt in der Mitte', () => {
        // (1000,0) auf (0,0)–(1000,1000): t = 1.000.000 / 2.000.000 = 0,5 → (500,500), Abstand √(2·500²) = 707,107
        const r = pointToSegmentDist(1000, 0, 0, 0, 1000, 1000);
        expect(r.t).toBe(0.5);
        expectPoint({ x: r.cx, y: r.cy }, 500, 500);
        expect(r.dist).toBeCloseTo(707.1068, 3);
    });
    it('entartete Strecke (Länge 0) → Punktabstand', () => {
        const r = pointToSegmentDist(400, 500, 100, 100, 100, 100);
        expect(r).toEqual({ dist: 500, t: 0, cx: 100, cy: 100 }); // Δ = (300, 400)
    });
});

describe('segmentIntersection', () => {
    it('Kreuzung zweier Diagonalen in der Mitte', () => {
        const r = segmentIntersection(0, 0, 1000, 1000, 0, 1000, 1000, 0);
        expect(r).toEqual({ x: 500, y: 500, t1: 0.5, t2: 0.5 });
    });
    it('T-Stoß am Endpunkt zählt als Schnitt (Endpunkte inklusive)', () => {
        const r = segmentIntersection(0, 0, 1000, 0, 500, 0, 500, 1000);
        expect(r.x).toBe(500);
        expect(r.y).toBe(0);
        expect(r.t1).toBe(0.5);
        expect(r.t2).toBeCloseTo(0, 12);
    });
    it('Schnittpunkt wird auf ganze mm gerundet', () => {
        // (0,0)–(1000,333) × (0,333)–(1000,0): t1 = 0,5 → (500; 166,5) → y = 167
        const r = segmentIntersection(0, 0, 1000, 333, 0, 333, 1000, 0);
        expect(r.x).toBe(500);
        expect(r.y).toBe(167);
        expect(r.t1).toBeCloseTo(0.5, 12);
    });
    it('Geraden schneiden sich, die Strecken aber nicht → null', () => {
        expect(segmentIntersection(0, 0, 1000, 0, 2000, -500, 2000, 500)).toBeNull(); // t1 = 2
    });
    it('parallele und kollinear überlappende Strecken → null', () => {
        expect(segmentIntersection(0, 0, 1000, 0, 0, 100, 1000, 100)).toBeNull();
        expect(segmentIntersection(0, 0, 1000, 0, 500, 0, 1500, 0)).toBeNull();
    });
    it('Toleranz: 0,5 mm Lücke zählt noch als Stoß, 5 mm nicht mehr', () => {
        // t2 = −0,5 / 999,5 = −0,0005 (≥ −0,001) → Treffer
        const near = segmentIntersection(0, 0, 1000, 0, 500, 0.5, 500, 1000);
        expect(near).not.toBeNull();
        expect(near.x).toBe(500);
        expect(near.y).toBe(0);
        // t2 = −5 / 995 = −0,005 → kein Treffer
        expect(segmentIntersection(0, 0, 1000, 0, 500, 5, 500, 1000)).toBeNull();
    });
});

// ─── Polygone ────────────────────────────────────────────────────
describe('signedArea (Shoelace)', () => {
    it('Rechteck 4 × 3 m = 12 m², Vorzeichen hängt vom Umlaufsinn ab', () => {
        expect(signedArea(RECT)).toBe(12_000_000);
        expect(signedArea([...RECT].reverse())).toBe(-12_000_000);
    });
    it('Dreieck: ½ · 3 m · 4 m = 6 m²', () => {
        expect(signedArea([P(0, 0), P(3000, 0), P(0, 4000)])).toBe(6_000_000);
    });
    it('konkave L-Form: 6·3 + 3·2 = 24 m²', () => {
        // Summe x_i·y_{i+1} − x_{i+1}·y_i = 0 + 18e6 + 9e6 + 6e6 + 15e6 + 0 = 48e6 → /2
        expect(signedArea(L_SHAPE)).toBe(24_000_000);
    });
    it('verschiebungsinvariant (auch negative Koordinaten)', () => {
        const shifted = L_SHAPE.map(p => P(p.x - 10_000, p.y + 7_000));
        expect(signedArea(shifted)).toBe(24_000_000);
    });
    it('entartete Fälle: leer, zwei Punkte, kollinear → 0', () => {
        expect(signedArea([])).toBe(0);
        expect(signedArea([P(0, 0), P(1000, 1000)])).toBe(0);
        expect(signedArea([P(0, 0), P(1000, 0), P(2000, 0)])).toBe(0);
    });
});

describe('ensureCW', () => {
    it('dreht ein positiv orientiertes Polygon um, ohne das Original zu verändern', () => {
        const input = [...RECT];
        const out = ensureCW(input);
        expect(signedArea(out)).toBe(-12_000_000);
        expect(out).toEqual([...RECT].reverse());
        expect(input).toEqual(RECT);
    });
    it('lässt ein bereits negativ orientiertes Polygon unverändert (gleiche Referenz)', () => {
        const cw = [...RECT].reverse();
        expect(ensureCW(cw)).toBe(cw);
    });
});

describe('pointInPolygon (Strahlverfahren)', () => {
    it('Rechteck: innen / außen', () => {
        expect(pointInPolygon(2000, 1500, RECT)).toBe(true);
        expect(pointInPolygon(5000, 1500, RECT)).toBe(false);
        expect(pointInPolygon(-1, 1500, RECT)).toBe(false);
        expect(pointInPolygon(2000, 3001, RECT)).toBe(false);
    });
    it('konkave L-Form: Punkt in der Aussparung liegt außen', () => {
        expect(pointInPolygon(4500, 4000, L_SHAPE)).toBe(false); // Aussparung x 3000–6000, y 3000–5000
        expect(pointInPolygon(1500, 4000, L_SHAPE)).toBe(true);  // unterer linker Schenkel
        expect(pointInPolygon(4500, 1500, L_SHAPE)).toBe(true);  // oberer Teil
    });
    it('unabhängig vom Umlaufsinn', () => {
        const rev = [...L_SHAPE].reverse();
        expect(pointInPolygon(4500, 4000, rev)).toBe(false);
        expect(pointInPolygon(1500, 4000, rev)).toBe(true);
    });
    it('Strahl durch eine Ecke wird nur einmal gezählt', () => {
        // Raute; der waagerechte Strahl von (−500, 0) nach rechts trifft die Ecke (1000, 0)
        const diamond = [P(0, -1000), P(1000, 0), P(0, 1000), P(-1000, 0)];
        expect(pointInPolygon(-500, 0, diamond)).toBe(true);
        expect(pointInPolygon(1500, 0, diamond)).toBe(false);
    });
    it('leeres Polygon → außen', () => {
        expect(pointInPolygon(0, 0, [])).toBe(false);
    });
});

describe('polygonCentroid (flächengewichtet)', () => {
    it('Rechteck → Mitte, unabhängig vom Umlaufsinn', () => {
        expect(polygonCentroid(RECT)).toEqual({ x: 2000, y: 1500 });
        expect(polygonCentroid([...RECT].reverse())).toEqual({ x: 2000, y: 1500 });
    });
    it('L-Form: flächengewichtet, NICHT Mittelwert der Ecken', () => {
        // Teil A 6×3 m: 18 m² bei (3000,1500); Teil B 3×2 m: 6 m² bei (1500,4000)
        // x = (18·3000 + 6·1500)/24 = 2625; y = (18·1500 + 6·4000)/24 = 2125
        // (Eckenmittel wäre (3000; 2666,7))
        expect(polygonCentroid(L_SHAPE)).toEqual({ x: 2625, y: 2125 });
    });
    it('Dreieck: Schwerpunkt = Mittel der Ecken, auf ganze mm gerundet', () => {
        expect(polygonCentroid([P(0, 0), P(3000, 0), P(0, 3000)])).toEqual({ x: 1000, y: 1000 });
        expect(polygonCentroid([P(0, 0), P(1000, 0), P(0, 1000)])).toEqual({ x: 333, y: 333 }); // 333,33
    });
    it('entartet (Fläche 0) → Mittelwert der Ecken; leer/null → (0,0)', () => {
        expect(polygonCentroid([P(0, 0), P(1000, 0), P(2000, 0)])).toEqual({ x: 1000, y: 0 });
        expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
        expect(polygonCentroid(null)).toEqual({ x: 0, y: 0 });
    });
});

describe('polygonInteriorPoint', () => {
    it('konvex → Schwerpunkt', () => {
        expect(polygonInteriorPoint(RECT)).toEqual({ x: 2000, y: 1500 });
    });
    it('U-Form: Schwerpunkt liegt außerhalb, geliefert wird ein Punkt im Polygon', () => {
        // Steg oben 3×1 m (3 m² @ y=500) + zwei Schenkel 1×2 m (je 2 m² @ y=2000)
        // Schwerpunkt y = (3·500 + 4·2000)/7 = 1357,1, x = 1500 → in der Lücke (x 1000–2000)
        const U = [P(0, 0), P(3000, 0), P(3000, 3000), P(2000, 3000), P(2000, 1000),
            P(1000, 1000), P(1000, 3000), P(0, 3000)];
        const c = polygonCentroid(U);
        expect(c).toEqual({ x: 1500, y: 1357 });
        expect(pointInPolygon(c.x, c.y, U)).toBe(false);
        const ip = polygonInteriorPoint(U);
        expect(pointInPolygon(ip.x, ip.y, U)).toBe(true);
        // Mitte eines der beiden 1 m breiten Schenkel auf der Schwerpunkt-Höhe
        expect([500, 2500]).toContain(ip.x);
        expect(ip.y).toBe(1357);
    });
    it('weniger als 3 Punkte → Schwerpunkt-Fallback', () => {
        expect(polygonInteriorPoint([P(0, 0), P(1000, 0)])).toEqual({ x: 500, y: 0 });
        expect(polygonInteriorPoint(null)).toEqual({ x: 0, y: 0 });
    });
});

describe('offsetPolygon (Wanddicken-Versatz)', () => {
    const CW_RECT = ensureCW(RECT); // (0,3000),(4000,3000),(4000,0),(0,0)

    it('Versatz nach innen um 100 mm: 3,8 × 2,8 m', () => {
        const r = offsetPolygon(CW_RECT, 100);
        expect(normPts(r)).toEqual(normPts([P(100, 100), P(3900, 100), P(3900, 2900), P(100, 2900)]));
        expect(absArea(r)).toBe(3800 * 2800); // 10.640.000 mm²
    });
    it('Versatz nach außen (negativ) um 365 mm: Außenkontur einer 36,5er Wand', () => {
        const r = offsetPolygon(CW_RECT, -365);
        expect(normPts(r)).toEqual(normPts([P(-365, -365), P(4365, -365), P(4365, 3365), P(-365, 3365)]));
        expect(absArea(r)).toBe(4730 * 3730); // 17.642.900 mm²
    });
    it('je Kante eigene Dicke (Array)', () => {
        // Kanten: 0 unten (y=3000), 1 rechts (x=4000), 2 oben (y=0), 3 links (x=0)
        // unten/oben 300 mm, rechts/links 100 mm nach außen → x −100…4100, y −300…3300
        const r = offsetPolygon(CW_RECT, [-300, -100, -300, -100]);
        expect(normPts(r)).toEqual(normPts([P(-100, -300), P(4100, -300), P(4100, 3300), P(-100, 3300)]));
        expect(absArea(r)).toBe(4200 * 3600); // 15.120.000 mm²
    });
    it('kollinearer Zwischenpunkt mit unterschiedlicher Dicke erzeugt einen Versatz (Stufe)', () => {
        const pts = [P(0, 3000), P(2000, 3000), P(4000, 3000), P(4000, 0), P(0, 0)];
        // gleiche Dicke: Zwischenpunkt bleibt ein Punkt, Fläche wie oben
        const same = offsetPolygon(pts, 100);
        expect(same).toHaveLength(5);
        expect(absArea(same)).toBe(10_640_000);
        // unten links 100 mm, unten rechts 200 mm:
        // Rechteck 100…3900 × 100…2800 = 3800·2700 = 10.260.000 + Streifen 1900·100 = 190.000
        const step = offsetPolygon(pts, [100, 200, 100, 100, 100]);
        expect(step).toHaveLength(6);
        expect(step).toContainEqual(P(2000, 2900));
        expect(step).toContainEqual(P(2000, 2800));
        expect(absArea(step)).toBe(10_450_000);
    });
    it('Kanten der Länge 0 (doppelte Punkte) werden ignoriert', () => {
        const dup = [P(0, 3000), P(4000, 3000), P(4000, 3000), P(4000, 0), P(0, 0)];
        const r = offsetPolygon(dup, 100);
        expect(r).toHaveLength(4);
        expect(absArea(r)).toBe(10_640_000);
    });
    it('spitzer Winkel: Gehrung wird durch Fase ersetzt (2 Punkte statt 1)', () => {
        // Spitze bei (10000,500): Innenwinkel 2·atan(500/10000) = 5,7° → Gehrung ≈ 20·d > 2,5·d
        const tri = ensureCW([P(0, 0), P(10000, 500), P(0, 1000)]);
        const r = offsetPolygon(tri, 50);
        expect(r).toHaveLength(4); // 2 stumpfe Ecken mit Gehrung + Spitze mit Fase
    });
    it('weniger als 3 Punkte → leeres Ergebnis', () => {
        expect(offsetPolygon([P(0, 0), P(1000, 0)], 100)).toEqual([]);
        expect(offsetPolygon([], 100)).toEqual([]);
    });
});

// ─── Geschoss / Punkte ───────────────────────────────────────────
describe('createStorey / genId', () => {
    it('leeres Geschoss mit Standardwerten', () => {
        const s = createStorey();
        expect(s.label).toBe('EG');
        expect(s.height_mm).toBe(2600);
        expect(s.ref_height_mm).toBe(0);
        expect(s.points).toEqual([]);
        expect(s.walls).toEqual([]);
        expect(s.rooms).toEqual([]);
        expect(s.outerClosed).toBe(false);
        expect(s.outerPolygon).toBeNull();
    });
    it('genId liefert eindeutige IDs', () => {
        const ids = new Set(Array.from({ length: 1000 }, () => genId()));
        expect(ids.size).toBe(1000);
        expect([...ids][0]).toMatch(/^fp_/);
    });
});

describe('addPoint / getPoint', () => {
    it('neuer Punkt wird gerastert', () => {
        const s = createStorey();
        const p = addPoint(s, 1234, 5678);
        expect(p).toMatchObject({ x: 1230, y: 5680 });
        expect(s.points).toHaveLength(1);
    });
    it('innerhalb 20 mm wird ein bestehender Punkt wiederverwendet, ab 20 mm entsteht ein neuer', () => {
        const s = createStorey();
        const a = addPoint(s, 1000, 1000);
        expect(addPoint(s, 1015, 1000)).toBe(a); // 15 mm
        expect(s.points).toHaveLength(1);
        const b = addPoint(s, 1020, 1000);       // genau 20 mm → neu
        expect(b).not.toBe(a);
        expect(b).toMatchObject({ x: 1020, y: 1000 });
        expect(s.points).toHaveLength(2);
    });
    it('getPoint findet Punkte auch nach Änderungen des Arrays (Index-Cache)', () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0);
        const b = addPoint(s, 1000, 0);
        const c = addPoint(s, 2000, 0);
        expect(getPoint(s, c.id)).toBe(c);         // Cache aufgebaut (c an Index 2)
        s.points.splice(0, 1);                      // a entfernt → c an Index 1
        expect(getPoint(s, c.id)).toBe(c);
        expect(getPoint(s, a.id)).toBeUndefined();
        const d = addPoint(s, 3000, 0);             // push
        expect(getPoint(s, d.id)).toBe(d);
        expect(getPoint(s, b.id)).toBe(b);
    });
    it('getPoint mit fehlendem Geschoss/ID → undefined', () => {
        expect(getPoint(null, 'x')).toBeUndefined();
        expect(getPoint({}, 'x')).toBeUndefined();
        expect(getPoint(createStorey(), 'unbekannt')).toBeUndefined();
    });
});

// ─── Wände ───────────────────────────────────────────────────────
describe('addOuterWallSegment / addInnerWallSegment', () => {
    it('Mindestlänge 250 mm: 240 mm abgelehnt, genau 250 mm angenommen', () => {
        expect(MIN_WALL_SEGMENT).toBe(250);
        const s = createStorey();
        const a = addPoint(s, 0, 0);
        const short = addPoint(s, 240, 70);  // √(240² + 70²) = 250 → zulässig
        const tooShort = addPoint(s, 0, 240);   // 240 mm < 250
        expect(addOuterWallSegment(s, a.id, tooShort.id)).toBeNull();
        const w = addOuterWallSegment(s, a.id, short.id);
        expect(w).not.toBeNull();
        expect(dist(getPoint(s, w.p1), getPoint(s, w.p2))).toBe(250);
    });
    it('Außenwand: Standarddicke 36,5 cm, innenbündig, Geschosshöhe', () => {
        const s = createStorey('EG', 2750);
        const a = addPoint(s, 0, 0), b = addPoint(s, 4000, 0);
        const w = addOuterWallSegment(s, a.id, b.id);
        expect(w).toMatchObject({ type: 'outer', thickness_mm: WALL_THICKNESS.outerDefault, ref_edge: 'inner', height_mm: 2750 });
        expect(WALL_THICKNESS.outerDefault).toBe(365);
    });
    it('Innenwand: Standard nichttragend 11,5 cm, Seite links', () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0), b = addPoint(s, 4000, 0);
        const w = addInnerWallSegment(s, a.id, b.id);
        expect(w).toMatchObject({ type: 'inner_nonload', thickness_mm: 115, ref_edge: 'left' });
    });
    it('fehlender Punkt → null', () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0);
        expect(addOuterWallSegment(s, a.id, 'fehlt')).toBeNull();
        expect(addInnerWallSegment(s, 'fehlt', a.id)).toBeNull();
    });
});

describe('getWallPolygon / getWallFaceOffsets (Wandkörper)', () => {
    it('Innenwand links: Dicke auf der +n-Seite, Grundfläche 4,00 m × 11,5 cm', () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [4000, 0], 'left', 115);
        const poly = getWallPolygon(w, s);
        // n = (−dy, dx)/len = (0, 1) → Körper y 0…115
        expect(poly).toEqual([P(0, 0), P(4000, 0), P(4000, 115), P(0, 115)]);
        expect(absArea(poly)).toBe(460_000); // 4000 · 115
        const f = getWallFaceOffsets(w, s);
        expect(f).toMatchObject({ min: 0, max: 115, interiorSign: 1, len: 4000 });
    });
    it('Innenwand rechts und Umklappen mit flipWallSide', () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [4000, 0], 'right', 115);
        expect(getWallPolygon(w, s)).toEqual([P(0, -115), P(4000, -115), P(4000, 0), P(0, 0)]);
        flipWallSide(w);
        expect(w.ref_edge).toBe('left');
        expect(getWallPolygon(w, s)[2]).toEqual(P(4000, 115));
    });
    it('Dicke liegt auf der Seite, auf der der Cursor beim Zeichnen war (getPointSide)', () => {
        // Editor: side = getPointSide(Cursor, Start, Ende) → ref_edge. Prüfung in beiden Zeichenrichtungen.
        for (const [from, to] of [[[0, 0], [4000, 0]], [[4000, 0], [0, 0]]]) {
            const s = createStorey();
            const side = getPointSide(2000, 500, from[0], from[1], to[0], to[1]); // Cursor unterhalb (y > 0)
            const w = addInner(s, from, to, side, 115);
            const poly = getWallPolygon(w, s);
            const ys = poly.map(p => p.y);
            expect(Math.min(...ys) + 0).toBe(0);
            expect(Math.max(...ys)).toBe(115); // Körper zum Cursor hin
        }
    });
    it('Wandlänge schräg (3-4-5): 5,00 m', () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [3000, 4000]);
        expect(getWallFaceOffsets(w, s).len).toBe(5000);
        // n = (−4000, 3000)/5000 = (−0,8; 0,6) → Versatz (−92, 69) exakt; Körper 5000 · 115 = 575.000 mm²
        expect(absArea(getWallPolygon(w, s))).toBe(575_000);
    });
    it('offene Außenwand: Dicke auf der −n-Seite', () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0), b = addPoint(s, 4000, 0);
        const w = addOuterWallSegment(s, a.id, b.id);
        expect(getWallPolygon(w, s)).toEqual([P(0, -365), P(4000, -365), P(4000, 0), P(0, 0)]);
    });
    it('Wand ohne Punkte oder mit Länge < 1 mm → null', () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0);
        expect(getWallPolygon({ p1: a.id, p2: 'x', thickness_mm: 115 }, s)).toBeNull();
        expect(getWallPolygon({ p1: a.id, p2: a.id, thickness_mm: 115 }, s)).toBeNull();
        expect(getWallFaceOffsets({ p1: a.id, p2: a.id, thickness_mm: 115 }, s)).toBeNull();
    });
});

describe('traceWallChain / buildWallChains / buildOrderedPolygon', () => {
    const pts = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 4000, y: 0 }, { id: 'c', x: 4000, y: 3000 }, { id: 'd', x: 0, y: 3000 }];
    it('geschlossener Ring aus gemischt gerichteten Wänden', () => {
        const walls = [
            { id: 'w1', p1: 'a', p2: 'b' },
            { id: 'w2', p1: 'c', p2: 'b' }, // rückwärts gespeichert
            { id: 'w3', p1: 'c', p2: 'd' },
            { id: 'w4', p1: 'a', p2: 'd' }, // rückwärts gespeichert
        ];
        const chain = traceWallChain(walls, walls[0]);
        expect(chain.closed).toBe(true);
        expect(chain.nodes).toEqual(['a', 'b', 'c', 'd']);
        expect(chain.walls.map(w => w.id)).toEqual(['w1', 'w2', 'w3', 'w4']);
        const poly = buildOrderedPolygon([walls[2], walls[0], walls[3], walls[1]], pts);
        expect(poly).toHaveLength(4);
        expect(absArea(poly)).toBe(12_000_000);
    });
    it('offene Kette: Start in der Mitte wird nach hinten verlängert', () => {
        const walls = [{ id: 'w2', p1: 'b', p2: 'c' }, { id: 'w1', p1: 'a', p2: 'b' }];
        const chain = traceWallChain(walls, walls[0]);
        expect(chain.closed).toBe(false);
        expect(chain.nodes).toEqual(['a', 'b', 'c']);
        expect(chain.walls.map(w => w.id)).toEqual(['w1', 'w2']);
    });
    it('zwei getrennte Ketten; buildOrderedPolygon lehnt das ab', () => {
        const more = [...pts, { id: 'e', x: 9000, y: 0 }, { id: 'f', x: 9000, y: 1000 }];
        const walls = [{ id: 'w1', p1: 'a', p2: 'b' }, { id: 'w2', p1: 'e', p2: 'f' }];
        expect(buildWallChains(walls)).toHaveLength(2);
        expect(buildOrderedPolygon(walls, more)).toBeNull();
        expect(buildOrderedPolygon([], more)).toBeNull();
    });
});

describe('closeOuterWalls (innenbündige Außenwände)', () => {
    it('Rechteck im Uhrzeigersinn: Raumgrenze 12 m², Außenkontur (4,73 × 3,73 m)', () => {
        const { s } = buildOuter(RECT_COORDS);
        expect(s.outerClosed).toBe(true);
        expect(absArea(s.outerPolygon)).toBe(12_000_000);
        expect(signedArea(s.outerPolygon)).toBeLessThan(0); // für offsetPolygon „CW“ normiert
        expect(absArea(s.outerBoundary)).toBe(4730 * 3730); // (4000 + 2·365)·(3000 + 2·365) = 17.642.900
    });
    it('gegen den Uhrzeigersinn gezeichnet: Ergebnis identisch, Dicke trotzdem außen', () => {
        const { s } = buildOuter([[0, 0], [0, 3000], [4000, 3000], [4000, 0]]);
        expect(absArea(s.outerPolygon)).toBe(12_000_000);
        expect(absArea(s.outerBoundary)).toBe(17_642_900);
        for (const w of s.walls) {
            const poly = getWallPolygon(w, s);
            const mid = P((poly[0].x + poly[1].x) / 2, (poly[0].y + poly[1].y) / 2); // Außenfläche
            expect(pointInPolygon(mid.x, mid.y, s.outerPolygon)).toBe(false);
            const core = polygonCentroid(poly); // Wandmitte: außerhalb des Raums, innerhalb der Außenkontur
            expect(pointInPolygon(core.x, core.y, s.outerPolygon)).toBe(false);
            expect(pointInPolygon(core.x, core.y, s.outerBoundary)).toBe(true);
        }
    });
    it('Umdrehen der Wandrichtung lässt Türen an derselben Stelle (Position gespiegelt, Anschlag getauscht)', () => {
        const { s, walls } = buildOuter([[0, 0], [0, 3000], [4000, 3000], [4000, 0]], { close: false });
        const door = placeOpening(s, walls[0].id, 'door', 1000); // Wand (0,0)→(0,3000): Mitte bei (0,1000)
        expect(openingWorldCenter(s, door)).toEqual(P(0, 1000));
        expect(door.swing).toBe('left');
        closeOuterWalls(s); // Shoelace negativ → alle Wände werden umgedreht
        expect(walls[0].p1).toBe(s.points[1].id);
        expect(door.position_mm).toBe(2000); // 3000 − 1000
        expect(door.swing).toBe('right');
        expectPoint(openingWorldCenter(s, door), 0, 1000);
    });
    it('verschiedene Wanddicken je Kante gehen in die Außenkontur ein', () => {
        const { s, walls } = buildOuter(RECT_COORDS, { close: false });
        walls[0].thickness_mm = 240; // obere Wand (0,0)→(4000,0)
        closeOuterWalls(s);
        // x −365…4365 (4730), y −240…3365 (3605) → 17.051.650 mm²
        expect(absArea(s.outerBoundary)).toBe(4730 * 3605);
    });
    it('konkave L-Form: Raum 24 m², Außenkontur 32,5629 m²', () => {
        const { s } = buildOuter(L_SHAPE.map(p => [p.x, p.y]));
        expect(absArea(s.outerPolygon)).toBe(24_000_000);
        // Rechtwinkliges Polygon, Versatz d nach außen: A + U·d + (konvex − einspringend)·d²
        // = 24e6 + 22.000·365 + (5 − 1)·365² = 24e6 + 8.030.000 + 532.900 = 32.562.900
        expect(absArea(s.outerBoundary)).toBe(32_562_900);
        expect(s.outerBoundary).toContainEqual(P(3365, 3365)); // einspringende Ecke
    });
    it('Altplan mit gegenläufig gespeicherten Außenwänden: Dicke wird trotzdem nach außen geklappt', () => {
        // Wände (0,0)→(0,3000)→(4000,3000)→(4000,0) OHNE Normalisierung (Stand älterer Pläne)
        const { s, walls } = buildOuter([[0, 0], [0, 3000], [4000, 3000], [4000, 0]], { close: false });
        // n = (−dy, dx)/len = (−1, 0); ohne Innenpolygon Standardseite −n = +x → läge im Raum
        expectPoint(getWallPolygon(walls[0], s)[0], 365, 0);
        expect(updateOuterBoundary(s)).toBe(true);
        s.outerClosed = true;
        // Innenraum liegt auf −n → umklappen: Außenfläche bei x = −365
        expectPoint(getWallPolygon(walls[0], s)[0], -365, 0);
        const f = getWallFaceOffsets(walls[0], s);
        expect(f.min).toBe(0);
        expect(f.max).toBe(365);
        expect(f.interiorSign).toBe(-1); // Gebäudeinneres auf der −n-Seite (+x)
    });
    it('Editor-Ablauf: Außenwände am Anschluss geteilt, Innenwand dazwischen, neu geschlossen', () => {
        const { s, walls } = buildOuter(RECT_COORDS);
        const top = splitWallAtPoint(s, walls[0].id, 2000, 0);       // (0,0)→(4000,0)
        const bottom = splitWallAtPoint(s, walls[2].id, 2000, 3000); // (4000,3000)→(0,3000)
        addInnerWallSegment(s, top.id, bottom.id, 'inner_nonload', 115, 'left');
        expect(s.walls.filter(w => w.type === 'outer')).toHaveLength(6);
        closeOuterWalls(s);
        expect(s.outerPolygon).toHaveLength(6);                 // 2 kollineare Zwischenpunkte
        expect(absArea(s.outerPolygon)).toBe(12_000_000);
        expect(absArea(s.outerBoundary)).toBe(17_642_900);       // unverändert 4,73 × 3,73 m
        computeRooms(s);
        const areas = s.rooms.map(r => r.area_mm2).sort((a, b) => a - b);
        expect(areas).toEqual([5_655_000, 6_000_000]);           // 6e6 − 115·3000 | 6e6
    });
    it('weniger als 3 Außenwände → nicht schließbar', () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0), b = addPoint(s, 4000, 0), c = addPoint(s, 4000, 3000);
        addOuterWallSegment(s, a.id, b.id);
        addOuterWallSegment(s, b.id, c.id);
        expect(closeOuterWalls(s)).toBe(false);
        expect(s.outerClosed).toBe(false);
    });
});

// ─── Räume / Flächen ─────────────────────────────────────────────
describe('computeRooms (Raumerkennung, Netto-/Bruttofläche)', () => {
    it('ohne geschlossene Außenwände keine Räume', () => {
        const { s } = buildOuter(RECT_COORDS, { close: false });
        s.rooms = [{ id: 'alt', polygon: RECT }];
        computeRooms(s);
        expect(s.rooms).toEqual([]);
    });
    it('ein Raum ohne Innenwände: 12 m² netto = brutto', () => {
        const { s } = buildOuter(RECT_COORDS);
        computeRooms(s);
        expect(s.rooms).toHaveLength(1);
        expect(s.rooms[0]).toMatchObject({ name: 'Raum 1', area_mm2: 12_000_000, gross_area_mm2: 12_000_000 });
    });
    it('konkave L-Form: ein Raum mit 24 m²', () => {
        const { s } = buildOuter(L_SHAPE.map(p => [p.x, p.y]));
        computeRooms(s);
        expect(s.rooms).toHaveLength(1);
        expect(s.rooms[0].area_mm2).toBe(24_000_000);
    });
    it('Mindestraumfläche 0,25 m²: 40 × 40 cm entfällt, 50 × 50 cm zählt', () => {
        expect(MIN_ROOM_AREA).toBe(250_000);
        const small = buildOuter([[0, 0], [400, 0], [400, 400], [0, 400]]).s;
        computeRooms(small);
        expect(small.rooms).toEqual([]); // 160.000 mm² < 250.000
        const ok = buildOuter([[0, 0], [500, 0], [500, 500], [0, 500]]).s;
        computeRooms(ok);
        expect(ok.rooms).toHaveLength(1);
        expect(ok.rooms[0].area_mm2).toBe(250_000);
    });
    it('Trennwand teilt in zwei Räume; Wandgrundfläche wird nur vom Raum auf ihrer Seite abgezogen', () => {
        const { s } = buildOuter(RECT_COORDS);
        addInner(s, [2000, 0], [2000, 3000], 'left', 115); // n = (−1, 0) → Körper x 1885…2000
        computeRooms(s);
        expect(s.rooms).toHaveLength(2);
        const [left, right] = [...s.rooms].sort((a, b) => polygonCentroid(a.polygon).x - polygonCentroid(b.polygon).x);
        expect(left.gross_area_mm2).toBe(6_000_000);   // 2,00 × 3,00 m
        expect(left.area_mm2).toBe(5_655_000);         // 6e6 − 115·3000
        expect(right.gross_area_mm2).toBe(6_000_000);
        expect(right.area_mm2).toBe(6_000_000);        // Wand liegt komplett links
        expect(left.area_mm2 + right.area_mm2).toBe(12_000_000 - 345_000);
        expect(new Set(s.rooms.map(r => r.name))).toEqual(new Set(['Raum 1', 'Raum 2']));
    });
    it('Kreuzung zweier Innenwände: Überlappung wird nur einmal abgezogen', () => {
        const { s } = buildOuter(RECT_COORDS);
        addInner(s, [2000, 0], [2000, 3000], 'left', 115); // Körper x 1885…2000, y 0…3000
        addInner(s, [0, 1500], [4000, 1500], 'left', 115); // n = (0, 1) → Körper y 1500…1615
        computeRooms(s);
        expect(s.rooms).toHaveLength(4);
        const [tl, tr, bl, br] = byCentroid(s.rooms);
        for (const r of s.rooms) expect(r.gross_area_mm2).toBe(3_000_000); // 2,0 × 1,5 m
        expect(tl.area_mm2).toBe(2_827_500); // 3e6 − 115·1500
        expect(tr.area_mm2).toBe(3_000_000);
        expect(bl.area_mm2).toBe(2_610_725); // 3e6 − 172.500 − 230.000 + 115² (Überlappung 13.225)
        expect(br.area_mm2).toBe(2_770_000); // 3e6 − 2000·115
        // Gesamt: 12e6 − (115·3000 + 115·4000 − 115²) = 11.208.225
        expect(s.rooms.reduce((sum, r) => sum + r.area_mm2, 0)).toBe(11_208_225);
    });
    it('freistehender Wandstummel teilt nicht, zieht aber seine Grundfläche ab', () => {
        const { s } = buildOuter(RECT_COORDS);
        addInner(s, [2000, 0], [2000, 1500], 'left', 115);
        computeRooms(s);
        expect(s.rooms).toHaveLength(1);
        expect(s.rooms[0].gross_area_mm2).toBe(12_000_000);
        expect(s.rooms[0].area_mm2).toBe(11_827_500); // 12e6 − 115·1500
    });
    it('Innenwand endet 10 mm vor der Außenwand: wird angeschlossen (Toleranz 50 mm), zwei Räume', () => {
        const { s } = buildOuter(RECT_COORDS);
        addInner(s, [2000, 10], [2000, 2990], 'left', 115);
        computeRooms(s);
        expect(s.rooms).toHaveLength(2);
        const areas = s.rooms.map(r => r.area_mm2).sort((a, b) => a - b);
        // Körper x 1885…2000, y 10…2990 → 115·2980 = 342.700 → 6e6 − 342.700 = 5.657.300
        expect(areas).toEqual([5_657_300, 6_000_000]);
    });
    it('Innenwand mit 60 mm Lücke zur Außenwand trennt nicht (Durchgang) – ein Raum', () => {
        const { s } = buildOuter(RECT_COORDS);
        addInner(s, [2000, 60], [2000, 2940], 'left', 115);
        computeRooms(s);
        expect(s.rooms).toHaveLength(1);
        expect(s.rooms[0].gross_area_mm2).toBe(12_000_000);
        expect(s.rooms[0].area_mm2).toBe(11_668_800); // 12e6 − 115·2880
    });
    it('Raumnamen und IDs bleiben bei Neuberechnung erhalten', () => {
        const { s } = buildOuter(RECT_COORDS);
        addInner(s, [2000, 0], [2000, 3000], 'left', 115);
        computeRooms(s);
        const left = s.rooms.find(r => polygonCentroid(r.polygon).x < 2000);
        left.name = 'Küche';
        const leftId = left.id;
        computeRooms(s);
        const again = s.rooms.find(r => polygonCentroid(r.polygon).x < 2000);
        expect(again.id).toBe(leftId);
        expect(again.name).toBe('Küche');
        expect(s.rooms.find(r => r !== again).name).not.toBe('Küche');
    });
    it('findRoomAtPoint: Treffer im Raum, kein Treffer in der Aussparung der L-Form', () => {
        const { s } = buildOuter(L_SHAPE.map(p => [p.x, p.y]));
        computeRooms(s);
        expect(findRoomAtPoint(s, 1500, 4000)).toBe(s.rooms[0]);
        expect(findRoomAtPoint(s, 4500, 4000)).toBeNull();
    });
});

describe('splitWallAtPoint', () => {
    const setup = () => {
        const s = createStorey();
        const a = addPoint(s, 0, 0), b = addPoint(s, 4000, 0);
        const w = addInnerWallSegment(s, a.id, b.id, 'inner_load', 240, 'right');
        w.ref_height_mm = 100;
        return { s, a, b, w };
    };
    it('teilt auf der Referenzlinie (Lotfußpunkt), übernimmt alle Eigenschaften', () => {
        const { s, a, b, w } = setup();
        const mid = splitWallAtPoint(s, w.id, 1003, 37); // Lot → (1003, 0) → Raster (1000, 0)
        expect(mid).toMatchObject({ x: 1000, y: 0 });
        expect(s.walls).toHaveLength(2);
        const [w1, w2] = s.walls;
        expect(w1).toMatchObject({ p1: a.id, p2: mid.id, type: 'inner_load', thickness_mm: 240, ref_edge: 'right', ref_height_mm: 100 });
        expect(w2).toMatchObject({ p1: mid.id, p2: b.id, type: 'inner_load', thickness_mm: 240 });
        expect(w1.id).not.toBe(w.id);
        // Gesamtlänge bleibt 4000 = 1000 + 3000
        expect(dist(a, mid) + dist(mid, b)).toBe(4000);
    });
    it('Öffnungen wandern auf die richtige Teilwand und behalten ihre Lage', () => {
        const { s, w } = setup();
        const door = placeOpening(s, w.id, 'door', 3000); // Mitte bei (3000, 0)
        splitWallAtPoint(s, w.id, 1000, 0);
        expect(door.wall_id).toBe(s.walls[1].id);
        expect(door.position_mm).toBe(2000); // 3000 − 1000
        expectPoint(openingWorldCenter(s, door), 3000, 0);
    });
    it('Öffnung direkt hinter dem Teilungspunkt wird mit Randabstand in ihre Teilwand geschoben', () => {
        const { s, w } = setup();
        const door = placeOpening(s, w.id, 'door', 1200); // 86 cm: 770…1630
        splitWallAtPoint(s, w.id, 1000, 0);
        // Teilwand 2 (1000→4000): 1200 − 1000 = 200 < 430 + 50 → 480 (Welt: x = 1480)
        expect(door.wall_id).toBe(s.walls[1].id);
        expect(door.position_mm).toBe(480);
        expectPoint(openingWorldCenter(s, door), 1480, 0);
    });
    it('zu nah (< 50 mm) am Endpunkt → keine Teilung', () => {
        const { s, w } = setup();
        expect(splitWallAtPoint(s, w.id, 40, 0)).toBeNull();
        expect(splitWallAtPoint(s, w.id, 3960, 0)).toBeNull();
        expect(s.walls).toEqual([w]);
    });
    it('unbekannte Wand → null', () => {
        const { s } = setup();
        expect(splitWallAtPoint(s, 'gibtsnicht', 1000, 0)).toBeNull();
    });
});

describe('deleteWall / getOpeningWallId', () => {
    it('löscht Wand samt Öffnungen (auch Altdaten mit wallId)', () => {
        const s = createStorey();
        const w1 = addInner(s, [0, 0], [4000, 0]);
        const w2 = addInner(s, [0, 2000], [4000, 2000]);
        s.openings.push({ id: 'o1', wall_id: w1.id }, { id: 'o2', wallId: w1.id }, { id: 'o3', wall_id: w2.id });
        deleteWall(s, w1.id);
        expect(s.walls.map(w => w.id)).toEqual([w2.id]);
        expect(s.openings.map(o => o.id)).toEqual(['o3']);
    });
    it('wall_id hat Vorrang vor wallId; null → undefined', () => {
        expect(getOpeningWallId({ wall_id: 'a', wallId: 'b' })).toBe('a');
        expect(getOpeningWallId({ wallId: 'b' })).toBe('b');
        expect(getOpeningWallId(null)).toBeUndefined();
    });
});

// ─── Öffnungen ───────────────────────────────────────────────────
describe('placeOpening (Türen/Fenster)', () => {
    const wallStorey = (len = 4000) => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [len, 0]);
        return { s, w };
    };
    it('Tür mit Standardmaßen (86 × 201 cm), Position gerastert', () => {
        const { s, w } = wallStorey();
        const d = placeOpening(s, w.id, 'door', 2003);
        expect(d).toMatchObject({ type: 'door', position_mm: 2000, width_mm: 860, height_mm: 2010, sill_mm: 0, swing: 'left', direction: 'inward', wall_id: w.id });
    });
    it('Fenster mit Standardmaßen (100 × 120 cm, Brüstung 80 cm)', () => {
        const { s, w } = wallStorey();
        expect(placeOpening(s, w.id, 'window', 2000)).toMatchObject({ width_mm: 1000, height_mm: 1200, sill_mm: 800 });
    });
    it('Position wird auf den Bereich mit 50 mm Randabstand begrenzt', () => {
        expect(OPENING_MIN_EDGE_DIST).toBe(50);
        const { s, w } = wallStorey();
        // Bereich: 860/2 + 50 = 480 … 4000 − 480 = 3520
        expect(placeOpening(s, w.id, 'door', 10).position_mm).toBe(480);
        expect(placeOpening(s, w.id, 'door', 3900).position_mm).toBe(3520);
    });
    it('nicht gerasterte Grenzen: Rasterung bleibt innerhalb des zulässigen Bereichs', () => {
        // Breite 865: Bereich 482,5 … 3517,5 → 482,5 rastert auf 480 (< Grenze) → 490; 3517,5 → 3520 → 3510
        const a = wallStorey();
        expect(placeOpening(a.s, a.w.id, 'door', 0, { width_mm: 865 }).position_mm).toBe(490);
        const b = wallStorey();
        expect(placeOpening(b.s, b.w.id, 'door', 5000, { width_mm: 865 }).position_mm).toBe(3510);
    });
    it('Wand zu kurz für die Öffnung → null', () => {
        // 900 mm Wand: 480 > 900 − 480 = 420
        const { s, w } = wallStorey(900);
        expect(placeOpening(s, w.id, 'door', 450)).toBeNull();
        // 960 mm: Bereich genau 480…480 → passt
        const t = wallStorey(960);
        expect(placeOpening(t.s, t.w.id, 'door', 0).position_mm).toBe(480);
    });
    it('Überlappung mit bestehender Öffnung wird abgelehnt, bündiges Anstoßen ist erlaubt', () => {
        const { s, w } = wallStorey();
        placeOpening(s, w.id, 'door', 2000);                                 // 1570…2430
        expect(placeOpening(s, w.id, 'window', 2900)).toBeNull();           // 2400…3400 überlappt
        expect(placeOpening(s, w.id, 'window', 2930)).not.toBeNull();       // 2430…3430 stößt bündig an
        expect(s.openings).toHaveLength(2);
    });
    it('Überlappung wird auch gegen Altdaten (wallId) geprüft', () => {
        const { s, w } = wallStorey();
        s.openings.push({ id: 'alt', wallId: w.id, position_mm: 2000, width_mm: 1000 });
        expect(placeOpening(s, w.id, 'door', 2000)).toBeNull();
    });
    it('ungültige Eingaben → null', () => {
        const { s, w } = wallStorey();
        expect(placeOpening(s, w.id, 'door', NaN)).toBeNull();
        expect(placeOpening(s, w.id, 'door', 2000, { width_mm: 0 })).toBeNull();
        expect(placeOpening(s, w.id, 'door', 2000, { width_mm: -100 })).toBeNull();
        expect(placeOpening(s, 'keine', 'door', 2000)).toBeNull();
    });
});

describe('getOpeningCenterMm (Öffnung bleibt auf der Wand)', () => {
    it('begrenzt den Mittelpunkt auf [Breite/2, Länge − Breite/2]', () => {
        expect(getOpeningCenterMm({ width_mm: 1000, position_mm: 200 }, 3000)).toBe(500);
        expect(getOpeningCenterMm({ width_mm: 1000, position_mm: 2900 }, 3000)).toBe(2500);
        expect(getOpeningCenterMm({ width_mm: 1000, position_mm: 1500 }, 3000)).toBe(1500);
    });
    it('Wand kürzer als die Öffnung → Wandmitte', () => {
        expect(getOpeningCenterMm({ width_mm: 1000, position_mm: 100 }, 800)).toBe(400);
    });
    it('fehlende Felder → 0 statt NaN', () => {
        expect(getOpeningCenterMm({}, 3000)).toBe(0);
        expect(getOpeningCenterMm(null, 3000)).toBe(0);
    });
});

// ─── Trefferprüfung ──────────────────────────────────────────────
describe('findWallAtPoint (Wandkörper + 30 mm Toleranz)', () => {
    const setup = () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [4000, 0], 'left', 115); // Körper y 0…115
        return { s, w };
    };
    it('Punkt im Wandkörper → Abstand 0', () => {
        const { s, w } = setup();
        const r = findWallAtPoint(s, 2000, 100);
        expect(r.wall).toBe(w);
        expect(r.bodyDist).toBe(0);
        expect(r.t).toBe(0.5);
    });
    it('Toleranz zählt ab der echten Wandfläche (beidseitig), Grenze 30 mm inklusive', () => {
        const { s, w } = setup();
        expect(findWallAtPoint(s, 2000, 145).wall).toBe(w); // 145 − 115 = 30
        expect(findWallAtPoint(s, 2000, 146)).toBeNull();   // 31
        expect(findWallAtPoint(s, 2000, -30).wall).toBe(w); // 30 vor der Referenzlinie
        expect(findWallAtPoint(s, 2000, -31)).toBeNull();
    });
    it('näherer Wandkörper gewinnt', () => {
        const { s } = setup();
        const w2 = addInner(s, [0, 200], [4000, 200], 'left', 115); // Körper y 200…315
        expect(findWallAtPoint(s, 2000, 180).wall).toBe(w2); // 20 mm zu w2, 65 mm zu w1
    });
    it('Altdaten ohne gültige Dicke: Abstand zur Referenzlinie', () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [4000, 0]);
        w.thickness_mm = undefined;
        const r = findWallAtPoint(s, 2000, 20);
        expect(r.wall).toBe(w);
        expect(r.bodyDist).toBe(20);
    });
});

describe('findOpeningAtPoint', () => {
    it('Trefferradius = halbe Breite + 50 mm um den Mittelpunkt', () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [4000, 0]);
        const d = placeOpening(s, w.id, 'door', 2000); // 860 → Radius 480
        expect(findOpeningAtPoint(s, 2479, 0)).toBe(d);
        expect(findOpeningAtPoint(s, 2481, 0)).toBeNull();
    });
    it('verkürzte Wand: Treffer an der auf die Wand begrenzten Stelle', () => {
        const s = createStorey();
        const w = addInner(s, [0, 0], [4000, 0]);
        s.openings.push({ id: 'o', wall_id: w.id, position_mm: 5000, width_mm: 860 }); // jenseits des Wandendes
        expect(findOpeningAtPoint(s, 3570, 0).id).toBe('o'); // Mitte begrenzt auf 4000 − 430
    });
});

// ─── Möbel ───────────────────────────────────────────────────────
describe('Möbel: Ecken, Hülle, Treffer', () => {
    it('ohne Drehung: Ecken ab der linken oberen Ecke', () => {
        const c = getFurnitureCorners({ x: 1000, y: 500, width_mm: 2000, depth_mm: 1000, rotation: 0 });
        expect(c).toEqual([P(1000, 500), P(3000, 500), P(3000, 1500), P(1000, 1500)]);
    });
    it('90° gedreht um die linke obere Ecke', () => {
        // (w,0) → (x − 0, y + w); (w,d) → (x − d, y + w); (0,d) → (x − d, y)
        const f = { x: 1000, y: 500, width_mm: 2000, depth_mm: 1000, rotation: 90 };
        const c = getFurnitureCorners(f);
        expectPoint(c[0], 1000, 500);
        expectPoint(c[1], 1000, 2500);
        expectPoint(c[2], 0, 2500);
        expectPoint(c[3], 0, 500);
        const b = getFurnitureBounds(f);
        expect(b.minX).toBeCloseTo(0, 6);
        expect(b.maxX).toBeCloseTo(1000, 6);
        expect(b.minY).toBeCloseTo(500, 6);
        expect(b.maxY).toBeCloseTo(2500, 6);
    });
    it('45° gedreht: Hülle eines 1 × 1 m Quadrats ist √2 m breit', () => {
        const b = getFurnitureBounds({ x: 0, y: 0, width_mm: 1000, depth_mm: 1000, rotation: 45 });
        expect(b.maxX - b.minX).toBeCloseTo(1414.2136, 3);
        expect(b.maxY - b.minY).toBeCloseTo(1414.2136, 3);
    });
    it('fehlende Maße → 500 mm, fehlende Lage → (0,0)', () => {
        expect(getFurnitureCorners({})).toEqual([P(0, 0), P(500, 0), P(500, 500), P(0, 500)]);
    });
    it('findFurnitureAtPoint deckt sich mit den gedrehten Ecken; oberstes Möbel zuerst', () => {
        const s = createStorey();
        const bed = placeFurniture(s, 'bed', 1000, 500, 2000, 1000, 500, 90); // Fläche x 0…1000, y 500…2500
        expect(findFurnitureAtPoint(s, 500, 1500)).toBe(bed);
        expect(findFurnitureAtPoint(s, 1500, 1500)).toBeNull(); // läge im ungedrehten Rechteck
        const lamp = placeFurniture(s, 'lamp', 400, 1400, 300, 300, 1500);
        expect(findFurnitureAtPoint(s, 500, 1500)).toBe(lamp);  // später platziert = oben
    });
    it('findFurnitureAtPoint nutzt dieselben Ersatzmaße wie getFurnitureCorners (Altdaten)', () => {
        const s = createStorey();
        s.furniture.push({ id: 'ohneMasse', x: 1000, y: 1000 });                // → 500 × 500 mm
        expect(findFurnitureAtPoint(s, 1250, 1250)?.id).toBe('ohneMasse');      // im sichtbaren Rahmen
        expect(findFurnitureAtPoint(s, 1600, 1250)).toBeNull();                  // 100 mm daneben
        s.furniture.push({ id: 'ohneLage', width_mm: 1000, depth_mm: 1000 });   // Lage fehlt → (0,0)
        expect(findFurnitureAtPoint(s, 500, 500)?.id).toBe('ohneLage');
        s.furniture.push({ id: 'text', x: '3000', y: '3000', width_mm: '800', depth_mm: '400', rotation: '0' });
        expect(findFurnitureAtPoint(s, 3700, 3300)?.id).toBe('text');          // Zahlen als Text
    });
    it('placeFurniture/moveFurniture rastern die Lage', () => {
        const s = createStorey();
        const f = placeFurniture(s, 'tisch', 1234, 5675, 800, 800, 750);
        expect(f).toMatchObject({ x: 1230, y: 5680, rotation: 0 });
        moveFurniture(s, f.id, -14, 26);
        expect(f).toMatchObject({ x: -10, y: 30 });
    });
});

describe('getPointSide', () => {
    it('Kreuzprodukt: positiv = links, negativ = rechts', () => {
        expect(getPointSide(500, 100, 0, 0, 1000, 0)).toBe('left');
        expect(getPointSide(500, -100, 0, 0, 1000, 0)).toBe('right');
        expect(getPointSide(500, 100, 1000, 0, 0, 0)).toBe('right'); // Gegenrichtung
    });
});

// ─── Geschoss duplizieren ────────────────────────────────────────
describe('duplicateStorey', () => {
    const setup = () => {
        const { s } = buildOuter(RECT_COORDS);
        const inner = addInner(s, [2000, 0], [2000, 3000], 'left', 115);
        placeOpening(s, inner.id, 'door', 1500);
        s.openings.push({ id: 'legacy', wallId: s.walls[0].id, position_mm: 2000, width_mm: 1000 });
        placeFurniture(s, 'sofa', 500, 500, 2000, 900, 800);
        s.bgImage = { src: 'data:image/png;base64,AAAA' };
        computeRooms(s);
        return s;
    };
    it('tiefe Kopie mit neuen IDs und konsistenten Verweisen', () => {
        const s = setup();
        const c = duplicateStorey(s, 'OG');
        expect(c.label).toBe('OG');
        expect(c.id).not.toBe(s.id);
        const oldPointIds = new Set(s.points.map(p => p.id));
        expect(c.points.some(p => oldPointIds.has(p.id))).toBe(false);
        for (const w of c.walls) {
            expect(getPoint(c, w.p1)).toBeDefined();
            expect(getPoint(c, w.p2)).toBeDefined();
        }
        const wallIds = new Set(c.walls.map(w => w.id));
        for (const o of c.openings) expect(wallIds.has(o.wall_id)).toBe(true);
        const legacy = c.openings.find(o => o.width_mm === 1000);
        expect(legacy).not.toHaveProperty('wallId');
    });
    it('Hintergrundbild bleibt beim Original, Flächen sind identisch', () => {
        const s = setup();
        const c = duplicateStorey(s, 'OG');
        expect(c.bgImage).toBeUndefined();
        expect(s.bgImage).toBeDefined();
        const areas = (st) => st.rooms.map(r => r.area_mm2).sort((a, b) => a - b);
        expect(areas(c)).toEqual(areas(s)); // [5.655.000, 6.000.000]
        expect(areas(c)).toEqual([5_655_000, 6_000_000]);
    });
    it('outerPolygon verweist auf die neuen Punktobjekte; Änderungen wirken nicht aufs Original', () => {
        const s = setup();
        const c = duplicateStorey(s, 'OG');
        for (const p of c.outerPolygon) expect(c.points).toContain(p);
        c.points[0].x = 99_999;
        expect(s.points[0].x).toBe(0);
        expect(s.walls[0].p1).not.toBe(c.walls[0].p1);
    });
});
