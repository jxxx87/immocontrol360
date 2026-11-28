import { describe, it, expect } from 'vitest';
import { getPoint, snapToGrid } from './geometryKernel';
import { findHostWall, constrainPointToHostWall, projectPointOntoHostWall } from './hostWallConstraint';

// ─── Referenz: die drei bisherigen Kopien aus FloorPlanEditor.handleMouseMove (wörtlich) ───

// Kopie A: Endpunkt ziehen ('corner') – Mausposition auf die Host-Wand projizieren
const legacyCorner = (activeStorey, id, origPt, world) => {
    let newX = snapToGrid(world.x);
    let newY = snapToGrid(world.y);
    for (const hw of activeStorey.walls) {
        if (hw.id === id) continue;
        const hp1 = getPoint(activeStorey, hw.p1);
        const hp2 = getPoint(activeStorey, hw.p2);
        if (!hp1 || !hp2) continue;
        const hwDx = hp2.x - hp1.x, hwDy = hp2.y - hp1.y;
        const hwLen = Math.sqrt(hwDx * hwDx + hwDy * hwDy);
        if (hwLen < 1) continue;
        const hux = hwDx / hwLen, huy = hwDy / hwLen;
        const t0 = (origPt.x - hp1.x) * hux + (origPt.y - hp1.y) * huy;
        const projX = hp1.x + hux * t0;
        const projY = hp1.y + huy * t0;
        const perpDist = Math.sqrt((origPt.x - projX) ** 2 + (origPt.y - projY) ** 2);
        if (perpDist < 50 && t0 > -10 && t0 < hwLen + 10) {
            const tMouse = (snapToGrid(world.x) - hp1.x) * hux + (snapToGrid(world.y) - hp1.y) * huy;
            const clampedT = Math.max(0, Math.min(hwLen, snapToGrid(tMouse)));
            newX = hp1.x + hux * clampedT;
            newY = hp1.y + huy * clampedT;
            break;
        }
    }
    return { x: newX, y: newY };
};

// Kopie B: Wand senkrecht verschieben ('wall_perp') – Bewegung projiziert und gerastet
const legacyPerp = (activeStorey, id, origPt, newX, newY) => {
    for (const hw of activeStorey.walls) {
        if (hw.id === id) continue;
        const hp1 = getPoint(activeStorey, hw.p1);
        const hp2 = getPoint(activeStorey, hw.p2);
        if (!hp1 || !hp2) continue;
        const hwDx = hp2.x - hp1.x, hwDy = hp2.y - hp1.y;
        const hwLen = Math.sqrt(hwDx * hwDx + hwDy * hwDy);
        if (hwLen < 1) continue;
        const hux = hwDx / hwLen, huy = hwDy / hwLen;
        const t0 = (origPt.x - hp1.x) * hux + (origPt.y - hp1.y) * huy;
        const projX = hp1.x + hux * t0;
        const projY = hp1.y + huy * t0;
        const perpDist = Math.sqrt((origPt.x - projX) ** 2 + (origPt.y - projY) ** 2);
        if (perpDist < 50 && t0 > -10 && t0 < hwLen + 10) {
            const moveX = newX - origPt.x;
            const moveY = newY - origPt.y;
            const proj = moveX * hux + moveY * huy;
            const snappedProj = snapToGrid(proj);
            const newT = Math.max(0, Math.min(hwLen, t0 + snappedProj));
            return { x: hp1.x + hux * newT, y: hp1.y + huy * newT, constrained: true };
        }
    }
    return { x: newX, y: newY, constrained: false };
};

// Kopie C: ganze Wand verschieben ('wall_body') – Bewegung projiziert, ohne Rasten
const legacyBody = (activeStorey, id, origPt, moveX, moveY) => {
    for (const hw of activeStorey.walls) {
        if (hw.id === id) continue;
        const hp1 = getPoint(activeStorey, hw.p1);
        const hp2 = getPoint(activeStorey, hw.p2);
        if (!hp1 || !hp2) continue;
        const hwDx = hp2.x - hp1.x, hwDy = hp2.y - hp1.y;
        const hwLen = Math.sqrt(hwDx * hwDx + hwDy * hwDy);
        if (hwLen < 1) continue;
        const hux = hwDx / hwLen, huy = hwDy / hwLen;
        const t0 = (origPt.x - hp1.x) * hux + (origPt.y - hp1.y) * huy;
        const projX = hp1.x + hux * t0;
        const projY = hp1.y + huy * t0;
        const perpDist = Math.sqrt((origPt.x - projX) ** 2 + (origPt.y - projY) ** 2);
        if (perpDist < 50 && t0 > -10 && t0 < hwLen + 10) {
            const proj = moveX * hux + moveY * huy;
            const newT = Math.max(0, Math.min(hwLen, t0 + proj));
            return { x: hp1.x + hux * newT, y: hp1.y + huy * newT };
        }
    }
    return { x: origPt.x + moveX, y: origPt.y + moveY };
};

// ─── Neue Aufrufe so, wie der Editor sie verwendet ───
const newCorner = (storey, id, origPt, world) => {
    const gx = snapToGrid(world.x), gy = snapToGrid(world.y);
    const c = projectPointOntoHostWall(storey, id, origPt, gx, gy, { snap: snapToGrid });
    return c ? { x: c.x, y: c.y } : { x: gx, y: gy };
};
const newPerp = (storey, id, origPt, newX, newY) => (
    constrainPointToHostWall(storey, id, origPt, newX - origPt.x, newY - origPt.y, { snapProj: snapToGrid })
    || { x: newX, y: newY, constrained: false }
);
const newBody = (storey, id, origPt, moveX, moveY) => {
    const c = constrainPointToHostWall(storey, id, origPt, moveX, moveY);
    return c ? { x: c.x, y: c.y } : { x: origPt.x + moveX, y: origPt.y + moveY };
};

// Deterministischer Zufall (Mulberry32)
const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Zufälliger Grundriss: schräge und achsparallele Wände, entartete Wand, Wand mit fehlendem Punkt
const makeStorey = (rand) => {
    const points = [];
    const walls = [];
    const n = 4 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
        const ax = Math.round((rand() - 0.5) * 12000);
        const ay = Math.round((rand() - 0.5) * 12000);
        const axisAligned = rand() < 0.5;
        const bx = axisAligned ? ax : ax + (rand() - 0.5) * 8000;
        const by = axisAligned ? ay + (rand() - 0.5) * 8000 : ay + (rand() - 0.5) * 8000;
        points.push({ id: `a${i}`, x: ax, y: ay }, { id: `b${i}`, x: bx, y: by });
        walls.push({ id: `w${i}`, type: rand() < 0.3 ? 'outer' : 'inner_nonload', p1: `a${i}`, p2: `b${i}` });
    }
    points.push({ id: 'd1', x: 100, y: 100 }, { id: 'd2', x: 100.4, y: 100.2 });
    walls.push({ id: 'wDeg', type: 'inner_nonload', p1: 'd1', p2: 'd2' });
    walls.push({ id: 'wMissing', type: 'inner_nonload', p1: 'a0', p2: 'gone' });
    return { points, walls };
};

// Punkt nahe einer zufälligen Wand (auf, knapp neben oder weit weg)
const nearWallPoint = (rand, storey) => {
    const w = storey.walls[Math.floor(rand() * (storey.walls.length - 2))];
    const p1 = getPoint(storey, w.p1), p2 = getPoint(storey, w.p2);
    const t = rand() * 1.2 - 0.1;
    const off = [0, 0, 3.7, -20, 49.9, 50, 120][Math.floor(rand() * 7)];
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: p1.x + dx * t - (dy / len) * off, y: p1.y + dy * t + (dx / len) * off };
};

const same = (a, b) => Object.is(a.x, b.x) && Object.is(a.y, b.y);

describe('hostWallConstraint – gleiche Ergebnisse wie die bisherigen Kopien', () => {
    it('Kopie A (Endpunkt ziehen) bitgenau', () => {
        const rand = rng(1234);
        let constrainedCases = 0;
        for (let k = 0; k < 400; k++) {
            const storey = makeStorey(rand);
            const exclude = rand() < 0.5 ? 'w0' : 'none';
            const origPt = nearWallPoint(rand, storey);
            const world = { x: origPt.x + (rand() - 0.5) * 3000, y: origPt.y + (rand() - 0.5) * 3000 };
            const a = legacyCorner(storey, exclude, origPt, world);
            const b = newCorner(storey, exclude, origPt, world);
            expect(same(a, b)).toBe(true);
            if (findHostWall(storey, exclude, origPt)) constrainedCases++;
        }
        expect(constrainedCases).toBeGreaterThan(50);
    });

    it('Kopie B (Wand senkrecht verschieben, gerastet) bitgenau', () => {
        const rand = rng(98765);
        for (let k = 0; k < 400; k++) {
            const storey = makeStorey(rand);
            const exclude = `w${Math.floor(rand() * 4)}`;
            const origPt = nearWallPoint(rand, storey);
            const nx = rand() - 0.5, ny = rand() - 0.5;
            const snapProj = snapToGrid((rand() - 0.5) * 4000);
            const newX = origPt.x + nx * snapProj;
            const newY = origPt.y + ny * snapProj;
            const a = legacyPerp(storey, exclude, origPt, newX, newY);
            const b = newPerp(storey, exclude, origPt, newX, newY);
            expect(same(a, b)).toBe(true);
            expect(b.constrained).toBe(a.constrained);
        }
    });

    it('Kopie C (ganze Wand verschieben, ungerastet) bitgenau', () => {
        const rand = rng(4242);
        for (let k = 0; k < 400; k++) {
            const storey = makeStorey(rand);
            const exclude = `w${Math.floor(rand() * 4)}`;
            const origPt = nearWallPoint(rand, storey);
            const dx = snapToGrid((rand() - 0.5) * 3000);
            const dy = snapToGrid((rand() - 0.5) * 3000);
            expect(same(legacyBody(storey, exclude, origPt, dx, dy), newBody(storey, exclude, origPt, dx, dy))).toBe(true);
        }
    });
});

describe('hostWallConstraint – Einzelfälle', () => {
    const storey = {
        points: [
            { id: 'h1', x: 0, y: 0 }, { id: 'h2', x: 4000, y: 0 },   // Host-Wand entlang x
            { id: 'i1', x: 1000, y: 0 }, { id: 'i2', x: 1000, y: 3000 }, // Innenwand senkrecht darauf
        ],
        walls: [
            { id: 'host', type: 'outer', p1: 'h1', p2: 'h2' },
            { id: 'inner', type: 'inner_nonload', p1: 'i1', p2: 'i2' },
        ],
    };

    it('findet die Host-Wand und ignoriert die gezogene Wand', () => {
        const host = findHostWall(storey, 'inner', { x: 1000, y: 0 });
        expect(host?.wall.id).toBe('host');
        expect(host.t0).toBe(1000);
        expect(findHostWall(storey, 'host', { x: 1000, y: 3000 })?.wall.id).toBe('inner');
        expect(findHostWall(storey, 'inner', { x: 1000, y: 60 })).toBeNull(); // > 50 mm daneben
        expect(findHostWall(storey, 'inner', { x: 4011, y: 0 })).toBeNull();  // > 10 mm hinter dem Ende
    });

    it('Bewegung gleitet entlang der Wand und wird auf die Wandlänge begrenzt', () => {
        expect(constrainPointToHostWall(storey, 'inner', { x: 1000, y: 0 }, 500, 700)).toEqual({ x: 1500, y: 0, constrained: true });
        expect(constrainPointToHostWall(storey, 'inner', { x: 1000, y: 0 }, -5000, 0)).toEqual({ x: 0, y: 0, constrained: true });
        expect(constrainPointToHostWall(storey, 'inner', { x: 1000, y: 3000 }, 10, 10)).toBeNull();
    });

    it('Projektion eines Zielpunkts mit Rasten', () => {
        const c = projectPointOntoHostWall(storey, 'inner', { x: 1000, y: 0 }, 2337, 800, { snap: snapToGrid });
        expect(c.y).toBe(0);
        expect(c.x).toBe(snapToGrid(2337));
        expect(projectPointOntoHostWall(storey, 'inner', { x: 1000, y: 0 }, 9000, 0)).toEqual({ x: 4000, y: 0, constrained: true });
    });
});
