// ─── Innenwand-Endpunkte an ihrer Host-Wand führen ─────────────────
// Beim Ziehen einer Innenwand (Endpunkt, Wand senkrecht verschieben, ganze Wand
// verschieben) gleiten Endpunkte, die auf einer anderen Wand sitzen, entlang dieser
// "Host-Wand". Früher stand die Suche dreimal kopiert im Editor; die Rechenschritte
// hier entsprechen exakt diesen Kopien (Tests in hostWallConstraint.test.js).

import { getPoint } from './geometryKernel';

/** Höchster Abstand (mm) eines Endpunkts zur Achse der Host-Wand. */
export const HOST_WALL_MAX_PERP_DIST = 50;
/** Toleranz (mm) über die Wandenden hinaus. */
export const HOST_WALL_END_TOLERANCE = 10;

/**
 * Erste Wand (außer `excludeWallId`), auf deren Achse `origPt` liegt.
 * Rückgabe { wall, hp1, hux, huy, hwLen, t0 } oder null.
 * t0 = Lage des Punkts entlang der Wand ab hp1 (mm).
 */
export const findHostWall = (storey, excludeWallId, origPt) => {
    for (const hw of storey?.walls || []) {
        if (hw.id === excludeWallId) continue;
        const hp1 = getPoint(storey, hw.p1);
        const hp2 = getPoint(storey, hw.p2);
        if (!hp1 || !hp2) continue;
        const hwDx = hp2.x - hp1.x, hwDy = hp2.y - hp1.y;
        const hwLen = Math.sqrt(hwDx * hwDx + hwDy * hwDy);
        if (hwLen < 1) continue;
        const hux = hwDx / hwLen, huy = hwDy / hwLen;
        const t0 = (origPt.x - hp1.x) * hux + (origPt.y - hp1.y) * huy;
        const projX = hp1.x + hux * t0;
        const projY = hp1.y + huy * t0;
        const perpDist = Math.sqrt((origPt.x - projX) ** 2 + (origPt.y - projY) ** 2);
        if (perpDist < HOST_WALL_MAX_PERP_DIST && t0 > -HOST_WALL_END_TOLERANCE && t0 < hwLen + HOST_WALL_END_TOLERANCE) {
            return { wall: hw, hp1, hux, huy, hwLen, t0 };
        }
    }
    return null;
};

const pointOnHost = (host, t) => ({ x: host.hp1.x + host.hux * t, y: host.hp1.y + host.huy * t });

/**
 * Bewegung (moveX, moveY) eines Endpunkts auf seine Host-Wand projizieren.
 * `snapProj` (optional, z. B. snapToGrid) rastet die projizierte Strecke.
 * Rückgabe { x, y, constrained: true } oder null, wenn der Punkt auf keiner
 * Host-Wand liegt (dann gilt die freie Bewegung des Aufrufers).
 */
export const constrainPointToHostWall = (storey, excludeWallId, origPt, moveX, moveY, { snapProj } = {}) => {
    const host = findHostWall(storey, excludeWallId, origPt);
    if (!host) return null;
    const proj = moveX * host.hux + moveY * host.huy;
    const delta = snapProj ? snapProj(proj) : proj;
    const newT = Math.max(0, Math.min(host.hwLen, host.t0 + delta));
    return { ...pointOnHost(host, newT), constrained: true };
};

/**
 * Zielpunkt (targetX, targetY) senkrecht auf die Host-Wand von `origPt` projizieren
 * (Ziehen eines einzelnen Endpunkts). `snap` (optional) rastet die Lage entlang der Wand.
 * Rückgabe { x, y, constrained: true } oder null ohne Host-Wand.
 */
export const projectPointOntoHostWall = (storey, excludeWallId, origPt, targetX, targetY, { snap } = {}) => {
    const host = findHostWall(storey, excludeWallId, origPt);
    if (!host) return null;
    const tTarget = (targetX - host.hp1.x) * host.hux + (targetY - host.hp1.y) * host.huy;
    const t = Math.max(0, Math.min(host.hwLen, snap ? snap(tTarget) : tTarget));
    return { ...pointOnHost(host, t), constrained: true };
};
