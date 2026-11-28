// ─── 3D Viewer Component ────────────────────────────────────────────
// Three.js based 3D view for floor plan visualization.
// Renders walls as boxes with corner overlap, openings as cutouts.

import React, { useMemo, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { getPoint, dist, polygonCentroid } from '../../lib/floorplan/geometryKernel';
import { getFurnitureItem } from '../../lib/floorplan/furnitureCatalog';
import { ROOF_TYPES, WALL_THICKNESS } from '../../lib/floorplan/constants';
import {
    DEFAULT_STOREY_HEIGHT_MM, DEFAULT_SLAB_THICKNESS_MM,
    storeyHeightMm, storeyStackHeightMm, storeyBaseOffsetsMm, totalStackHeightMm,
} from '../../lib/floorplan/storeyStack';

const MM = 0.001;
// Standardhöhen fehlender Öffnungsmaße (wie beim Platzieren in geometryKernel.placeOpening)
const DEFAULT_DOOR_HEIGHT_MM = 2010;
const DEFAULT_WINDOW_HEIGHT_MM = 1200;

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// Polygon als Werte-Schlüssel: Punkte werden im Editor teils in-place verschoben (gleiche
// Array-Referenz). Die Geometrie wird aus dem Schlüssel selbst aufgebaut.
const polygonKey = (pts) => arr(pts)
    .filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .map(p => `${p.x},${p.y}`)
    .join(';');
const parsePolygonKey = (key) => (key
    ? key.split(';').map(s => { const [x, y] = s.split(',').map(Number); return { x, y }; })
    : []);

// Manuell erzeugte three.js-Geometrien/Texturen beim Austausch bzw. Unmount freigeben
const useDisposable = (resource, getDisposable = (r) => r) => {
    useEffect(() => () => {
        const d = resource ? getDisposable(resource) : null;
        if (d && typeof d.dispose === 'function') d.dispose();
    }, [resource]); // eslint-disable-line react-hooks/exhaustive-deps
};

// ─── Wall Mesh ──────────────────────────────────────────────────
// Each wall is a box, extended slightly at endpoints that connect to other walls
// to fill corner gaps.

const WallMesh = ({ wall, storey, yOffset = 0 }) => {
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return null;

    const wallLenMm = dist(pt1, pt2);
    if (!(wallLenMm >= 1)) return null;

    // Ungültige Dicke (Altdaten) nur für die Darstellung durch die Standarddicke ersetzen
    const thicknessMm = num(wall.thickness_mm, 0) > 0 ? wall.thickness_mm : WALL_THICKNESS.innerNonloadDefault;
    const thickness = thicknessMm * MM;
    const height = (num(wall.height_mm, 0) > 0 ? wall.height_mm : storeyHeightMm(storey)) * MM;

    // Check if endpoints connect to other walls (for corner extension)
    const walls = arr(storey.walls);
    const p1Walls = walls.filter(w => w.id !== wall.id && (w.p1 === wall.p1 || w.p2 === wall.p1));
    const p2Walls = walls.filter(w => w.id !== wall.id && (w.p1 === wall.p2 || w.p2 === wall.p2));

    // Extend half-thickness at connected corners to fill gaps
    const ext1 = p1Walls.length > 0 ? thicknessMm / 2 : 0;
    const ext2 = p2Walls.length > 0 ? thicknessMm / 2 : 0;

    const dx = pt2.x - pt1.x;
    const dy = pt2.y - pt1.y;
    const angle = -Math.atan2(dy, dx);
    const totalLen = (wallLenMm + ext1 + ext2) * MM;

    // Center of extended wall
    const dirX = dx / wallLenMm;
    const dirY = dy / wallLenMm;
    const cx = ((pt1.x - dirX * ext1 + pt2.x + dirX * ext2) / 2) * MM;
    const cz = ((pt1.y - dirY * ext1 + pt2.y + dirY * ext2) / 2) * MM;
    const cy = yOffset + height / 2;

    // Find openings on this wall (ungültige Maße überspringen)
    const wallOpenings = arr(storey.openings).filter(o => (o.wall_id ?? o.wallId) === wall.id
        && Number.isFinite(o.position_mm) && Number.isFinite(o.width_mm) && o.width_mm > 0);
    const wallColor = wall.type === 'outer' ? '#e2e8f0' : '#cbd5e1';

    if (wallOpenings.length === 0) {
        return (
            <mesh position={[cx, cy, cz]} rotation={[0, angle, 0]}>
                <boxGeometry args={[totalLen, height, thickness]} />
                <meshStandardMaterial color={wallColor} roughness={0.8} metalness={0.05} />
            </mesh>
        );
    }

    // Wall with openings → split into segments
    return (
        <group position={[cx, cy, cz]} rotation={[0, angle, 0]}>
            {renderWallWithOpenings(wall, wallOpenings, wallLenMm, ext1, ext2, thickness, height, wallColor)}
        </group>
    );
};

const renderWallWithOpenings = (wall, openings, wallLenMm, ext1, ext2, thickness, wallHeight, wallColor) => {
    const elements = [];
    const sorted = [...openings].sort((a, b) => a.position_mm - b.position_mm);
    // Die Gruppe sitzt in der Mitte der verlängerten Wand (Originalmitte + (ext2 - ext1) / 2 in
    // Wandrichtung). Lokale Positionen deshalb um diesen Versatz VERRINGERN.
    const centerShift = wallLenMm / 2 + (ext2 - ext1) / 2;

    let lastEnd = -ext1; // start from extended beginning

    sorted.forEach((opening, idx) => {
        const openStart = opening.position_mm - opening.width_mm / 2;
        const openEnd = opening.position_mm + opening.width_mm / 2;
        // Fehlende/ungültige Höhe: typabhängiger Standard (Tür ≠ Fenster)
        const defaultHeight = opening.type === 'door' ? DEFAULT_DOOR_HEIGHT_MM : DEFAULT_WINDOW_HEIGHT_MM;
        const openHeight = (num(opening.height_mm, 0) > 0 ? opening.height_mm : defaultHeight) * MM;
        const sillHeight = Math.max(0, num(opening.sill_mm, 0)) * MM;

        // Solid segment before opening
        if (openStart > lastEnd + 1) {
            const segLen = (openStart - lastEnd) * MM;
            const segCenter = ((lastEnd + openStart) / 2 - centerShift) * MM;
            elements.push(
                <mesh key={`seg-${idx}-before`} position={[segCenter, 0, 0]}>
                    <boxGeometry args={[segLen, wallHeight, thickness]} />
                    <meshStandardMaterial color={wallColor} roughness={0.8} />
                </mesh>
            );
        }

        const openW = opening.width_mm * MM;
        const openCenter = (opening.position_mm - centerShift) * MM;

        // Lintel (above opening)
        const topOfOpening = sillHeight + openHeight;
        if (topOfOpening < wallHeight - 0.01) {
            const lintelH = wallHeight - topOfOpening;
            elements.push(
                <mesh key={`lintel-${idx}`} position={[openCenter, wallHeight / 2 - lintelH / 2, 0]}>
                    <boxGeometry args={[openW, lintelH, thickness]} />
                    <meshStandardMaterial color={wallColor} roughness={0.8} />
                </mesh>
            );
        }

        // Sill wall (below opening) for windows
        if (sillHeight > 0.01) {
            elements.push(
                <mesh key={`sill-${idx}`} position={[openCenter, -wallHeight / 2 + sillHeight / 2, 0]}>
                    <boxGeometry args={[openW, sillHeight, thickness]} />
                    <meshStandardMaterial color={wallColor} roughness={0.8} />
                </mesh>
            );
        }

        // Window: glass + frame
        if (opening.type === 'window') {
            elements.push(
                <mesh key={`glass-${idx}`} position={[openCenter, -wallHeight / 2 + sillHeight + openHeight / 2, 0]}>
                    <boxGeometry args={[openW - 0.04, openHeight - 0.04, 0.01]} />
                    <meshStandardMaterial color="#93c5fd" transparent opacity={0.35} roughness={0.1} metalness={0.2} />
                </mesh>
            );
            // Frame
            const ft = 0.02;
            const fc = '#f8fafc';
            elements.push(
                <mesh key={`wf-l-${idx}`} position={[openCenter - openW / 2 + ft / 2, -wallHeight / 2 + sillHeight + openHeight / 2, 0]}>
                    <boxGeometry args={[ft, openHeight, thickness * 0.18]} />
                    <meshStandardMaterial color={fc} roughness={0.5} />
                </mesh>,
                <mesh key={`wf-r-${idx}`} position={[openCenter + openW / 2 - ft / 2, -wallHeight / 2 + sillHeight + openHeight / 2, 0]}>
                    <boxGeometry args={[ft, openHeight, thickness * 0.18]} />
                    <meshStandardMaterial color={fc} roughness={0.5} />
                </mesh>,
                <mesh key={`wf-t-${idx}`} position={[openCenter, -wallHeight / 2 + sillHeight + openHeight - ft / 2, 0]}>
                    <boxGeometry args={[openW, ft, thickness * 0.18]} />
                    <meshStandardMaterial color={fc} roughness={0.5} />
                </mesh>,
                <mesh key={`wf-b-${idx}`} position={[openCenter, -wallHeight / 2 + sillHeight + ft / 2, 0]}>
                    <boxGeometry args={[openW, ft, thickness * 0.22]} />
                    <meshStandardMaterial color={fc} roughness={0.5} />
                </mesh>
            );
        }

        // Door: frame + leaf panel
        if (opening.type === 'door') {
            const ft = 0.025;
            const fc = '#a8a29e';
            elements.push(
                <mesh key={`df-l-${idx}`} position={[openCenter - openW / 2 + ft / 2, -wallHeight / 2 + openHeight / 2, 0]}>
                    <boxGeometry args={[ft, openHeight, thickness * 0.25]} />
                    <meshStandardMaterial color={fc} roughness={0.6} />
                </mesh>,
                <mesh key={`df-r-${idx}`} position={[openCenter + openW / 2 - ft / 2, -wallHeight / 2 + openHeight / 2, 0]}>
                    <boxGeometry args={[ft, openHeight, thickness * 0.25]} />
                    <meshStandardMaterial color={fc} roughness={0.6} />
                </mesh>,
                <mesh key={`df-t-${idx}`} position={[openCenter, -wallHeight / 2 + openHeight - ft / 2, 0]}>
                    <boxGeometry args={[openW, ft, thickness * 0.25]} />
                    <meshStandardMaterial color={fc} roughness={0.6} />
                </mesh>,
                <mesh key={`door-${idx}`} position={[openCenter, -wallHeight / 2 + openHeight / 2, thickness * 0.3]}>
                    <boxGeometry args={[openW - 0.05, openHeight - 0.03, 0.04]} />
                    <meshStandardMaterial color="#d4a574" roughness={0.6} metalness={0.05} />
                </mesh>
            );
        }

        lastEnd = openEnd;
    });

    // Final segment after last opening
    const finalEnd = wallLenMm + ext2;
    if (lastEnd < finalEnd - 1) {
        const segLen = (finalEnd - lastEnd) * MM;
        const segCenter = ((lastEnd + finalEnd) / 2 - centerShift) * MM;
        elements.push(
            <mesh key="seg-final" position={[segCenter, 0, 0]}>
                <boxGeometry args={[segLen, wallHeight, thickness]} />
                <meshStandardMaterial color={wallColor} roughness={0.8} />
            </mesh>
        );
    }

    return elements;
};

// ─── Floor Mesh ─────────────────────────────────────────────────

const FloorMesh = ({ storey, yOffset = 0 }) => {
    const outerKey = polygonKey(storey.outerPolygon);
    const geometry = useMemo(() => {
        const pts = parsePolygonKey(outerKey);
        if (pts.length < 3) return null;
        const shape = new THREE.Shape();
        // y negieren: nach der Drehung um -90° um X liegt Plan-y dann (wie Wände/Labels) bei Welt-z = +y
        shape.moveTo(pts[0].x * MM, -pts[0].y * MM);
        for (let i = 1; i < pts.length; i++) {
            shape.lineTo(pts[i].x * MM, -pts[i].y * MM);
        }
        shape.closePath();
        return new THREE.ShapeGeometry(shape);
    }, [outerKey]);
    useDisposable(geometry);

    if (!geometry) return null;
    return (
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, yOffset, 0]}>
            <meshStandardMaterial color="#f8fafc" roughness={0.9} metalness={0.0} side={THREE.DoubleSide} />
        </mesh>
    );
};

// ─── Slab Mesh (Ceiling / Floor slab) ───────────────────────────

const SlabMesh = ({ slab, yOffset = 0 }) => {
    const polyKey = polygonKey(slab.polygon);
    const thicknessMm = num(slab.thickness_mm, 0) > 0 ? slab.thickness_mm : DEFAULT_SLAB_THICKNESS_MM;
    const geometry = useMemo(() => {
        // Use the slab's own drawn polygon
        const polygon = parsePolygonKey(polyKey);
        if (polygon.length < 3) return null;
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x * MM, -polygon[0].y * MM);
        for (let i = 1; i < polygon.length; i++) {
            shape.lineTo(polygon[i].x * MM, -polygon[i].y * MM);
        }
        shape.closePath();
        const thickM = thicknessMm * MM;
        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: thickM,
            bevelEnabled: false,
        });
        // Rotate so the shape lies flat (XZ plane) with extrusion going up (Y+)
        geo.rotateX(-Math.PI / 2);
        return geo;
    }, [polyKey, thicknessMm]);
    useDisposable(geometry);

    if (!geometry) return null;

    // Position: yOffset is storey base, ref_height_mm is where slab bottom starts
    const refMm = num(slab.ref_height_mm, 0);
    const refY = yOffset + refMm * MM;
    const isCeiling = refMm > 1000;
    const color = isCeiling ? '#94a3b8' : '#a1887f';

    return (
        <mesh
            geometry={geometry}
            position={[0, refY, 0]}
        >
            <meshStandardMaterial
                color={color} roughness={0.85} metalness={0.05}
                transparent opacity={0.75} side={THREE.DoubleSide}
            />
        </mesh>
    );
};

// ─── Furniture Mesh ─────────────────────────────────────────────

const FurnitureMesh = ({ item, yOffset = 0 }) => {
    if (!Number.isFinite(item?.x) || !Number.isFinite(item?.y)) return null;
    const catItem = getFurnitureItem(item.catalog_id);
    const w = Math.max(0.01, num(item.width_mm, 500) * MM);
    const d = Math.max(0.01, num(item.depth_mm, 500) * MM);
    const h = Math.max(0.01, num(item.height_mm, 500) * MM);
    // Wie im 2D-Plan: (x, y) ist die obere linke Ecke, gedreht wird um diesen Punkt →
    // Mittelpunkt der Box um die gedrehte halbe Breite/Tiefe versetzen
    const rotRad = num(item.rotation, 0) * Math.PI / 180;
    const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
    const cx = item.x * MM + (w / 2) * cos - (d / 2) * sin;
    const cz = item.y * MM + (w / 2) * sin + (d / 2) * cos;
    const cy = yOffset + h / 2;
    const rotY = -rotRad;

    return (
        <mesh position={[cx, cy, cz]} rotation={[0, rotY, 0]}>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial
                color={catItem?.color || '#d4a574'}
                roughness={0.7}
                metalness={0.05}
            />
        </mesh>
    );
};

// ─── Room Label ─────────────────────────────────────────────────

// Beschriftung als Canvas-Textur mit Systemschrift: lädt keine Schriftdaten von Drittanbietern
// (drei <Text> ohne font-Prop holt Schrift-/Unicode-Daten zur Laufzeit von cdn.jsdelivr.net).
const LABEL_FONT_PX = 48;
const LABEL_FONT_WORLD_M = 0.3;   // Schriftgröße in der Szene (wie zuvor fontSize 0.3)
const LABEL_MAX_WIDTH_M = 3;

const RoomLabel3D = ({ room, yOffset = 0 }) => {
    const hasPolygon = arr(room.polygon).length >= 3;
    const name = String(room.name || 'Raum');
    const areaText = Number.isFinite(room.area_mm2)
        ? (room.area_mm2 / 1000000).toLocaleString('de-DE', { maximumFractionDigits: 2 })
        : '–';

    const label = useMemo(() => {
        if (!hasPolygon || typeof document === 'undefined') return null;
        const lines = [name, `${areaText} m²`];
        const font = `600 ${LABEL_FONT_PX}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.font = font;
        const textW = Math.max(...lines.map(l => ctx.measureText(l).width), 1);
        const lineH = LABEL_FONT_PX * 1.25;
        canvas.width = Math.ceil(Math.min(2048, textW + 24));
        canvas.height = Math.ceil(lineH * lines.length + 16);
        // Nach dem Setzen der Größe ist der Kontext zurückgesetzt
        ctx.font = font;
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, 8 + lineH * (i + 0.5), canvas.width - 8));
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const mPerPx = LABEL_FONT_WORLD_M / LABEL_FONT_PX;
        let w = canvas.width * mPerPx;
        let h = canvas.height * mPerPx;
        if (w > LABEL_MAX_WIDTH_M) { const k = LABEL_MAX_WIDTH_M / w; w *= k; h *= k; }
        return { texture, w, h };
    }, [hasPolygon, name, areaText]);
    useDisposable(label, l => l.texture);

    if (!label) return null;
    const centroid = polygonCentroid(room.polygon);
    if (!Number.isFinite(centroid?.x) || !Number.isFinite(centroid?.y)) return null;
    return (
        <mesh position={[centroid.x * MM, yOffset + 0.01, centroid.y * MM]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
            <planeGeometry args={[label.w, label.h]} />
            <meshBasicMaterial map={label.texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
    );
};

// ─── Roof Mesh ──────────────────────────────────────────────────

const RoofMesh = ({ storey, yOffset = 0 }) => {
    const roof = storey.roof;
    // Primitive Abhängigkeiten: der Editor kann Dachwerte in-place ändern (gleiche Objektreferenz)
    const roofType = roof?.type;
    const pitchDeg = roof?.pitch_deg;
    const kneeWallMm = roof?.kneeWall_mm;
    const overhangMm = roof?.overhang_mm;
    const parapetMm = roof?.parapet_mm;
    const footprintKey = polygonKey(storey.outerBoundary || storey.outerPolygon);
    // Dach sitzt auf der obersten Decke (Raumhöhe + Deckenstärke), nicht in der Deckenplatte
    const wallHeightMm = storeyStackHeightMm(storey);
    const geometry = useMemo(() => {
        if (!roofType) return null;
        // Get outer boundary as footprint
        const boundary = parsePolygonKey(footprintKey);
        if (boundary.length < 3) return null;
        // Vorgaben wie im Dach-Panel des Editors (ROOF_TYPES), 0 bleibt 0
        const typeDefaults = ROOF_TYPES[roofType] || {};

        // Calculate bounding box of boundary
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of boundary) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        const W = (maxX - minX) * MM;
        const D = (maxY - minY) * MM;
        const cx = ((minX + maxX) / 2) * MM;
        const cz = ((minY + maxY) / 2) * MM;
        const wallH = wallHeightMm * MM;
        const overhang = Math.max(0, num(overhangMm, typeDefaults.overhang_mm ?? 0)) * MM;

        if (roofType === 'gable') {
            const kneeH = Math.max(0, num(kneeWallMm, typeDefaults.kneeWall_mm ?? 0)) * MM;
            const pitch = num(pitchDeg, typeDefaults.pitch_deg ?? 35) * Math.PI / 180;
            // First entlang der längeren Grundrissseite (wie im 2D-Plan, canvasRenderer: bw >= bh):
            // Spannweite = kurze Seite, Firstlänge = lange Seite. Gebaut wird mit First entlang z,
            // bei ridgeAlongX wird die fertige Geometrie um 90° gedreht.
            const ridgeAlongX = W >= D;
            const halfSpan = (ridgeAlongX ? D : W) / 2 + overhang;
            const ridgeH = Math.tan(pitch) * halfSpan;
            const totalH = kneeH + ridgeH;
            const depth = (ridgeAlongX ? W : D) + overhang * 2;

            // Build a custom geometry with two triangular prism halves
            const geo = new THREE.BufferGeometry();
            const hw = halfSpan;
            const hd = depth / 2;
            // Vertices: 6 points forming ext
            const verts = new Float32Array([
                // Left bottom front, left bottom back
                -hw, 0, -hd, -hw, 0, hd,
                // Right bottom front, right bottom back
                hw, 0, -hd, hw, 0, hd,
                // Left knee front, left knee back
                -hw, kneeH, -hd, -hw, kneeH, hd,
                // Right knee front, right knee back
                hw, kneeH, -hd, hw, kneeH, hd,
                // Ridge front, ridge back
                0, totalH, -hd, 0, totalH, hd,
            ]);
            // Create indexed triangles
            const indices = [
                // Left slope (4,5,8,9)
                4, 5, 9, 4, 9, 8,
                // Right slope (6,7,8,9)
                7, 6, 8, 7, 8, 9,
                // Front gable (4,6,8)
                4, 8, 6,
                // Back gable (5,7,9)
                5, 7, 9,
                // Left wall (0,1,5,4)
                0, 1, 5, 0, 5, 4,
                // Right wall (2,3,7,6)
                3, 2, 6, 3, 6, 7,
                // Front wall (0,2,6,4)
                2, 0, 4, 2, 4, 6,
                // Back wall (1,3,7,5)
                1, 3, 7, 1, 7, 5,
            ];
            geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
            geo.setIndex(indices);
            // Echte Drehung (keine Spiegelung) – die Dreiecks-Orientierung bleibt erhalten
            if (ridgeAlongX) geo.rotateY(Math.PI / 2);
            geo.computeVertexNormals();
            return { geo, cx, cz, baseY: yOffset + wallH };
        }

        if (roofType === 'hip') {
            const pitch = num(pitchDeg, typeDefaults.pitch_deg ?? 25) * Math.PI / 180;
            const hw = W / 2 + overhang;
            const hd = D / 2 + overhang;
            // For hip roof, ridge runs along the longer axis
            const isWide = W > D;
            const shortHalf = isWide ? hd : hw;
            const longHalf = isWide ? hw : hd;
            const ridgeH = Math.tan(pitch) * shortHalf;
            const ridgeLen = longHalf - shortHalf; // ridge length (shorter than full length), immer >= 0
            if (ridgeLen < 0.01) {
                // Pyramid (no ridge) – (nahezu) quadratischer Grundriss
                const geo = new THREE.BufferGeometry();
                const verts = new Float32Array([
                    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
                    0, ridgeH, 0,
                ]);
                const indices = [
                    0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4,
                    0, 2, 1, 0, 3, 2, // bottom
                ];
                geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
                geo.setIndex(indices);
                geo.computeVertexNormals();
                return { geo, cx, cz, baseY: yOffset + wallH };
            }
            const geo = new THREE.BufferGeometry();
            if (isWide) {
                const verts = new Float32Array([
                    // Base corners
                    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
                    // Ridge endpoints
                    -ridgeLen, ridgeH, 0, ridgeLen, ridgeH, 0,
                ]);
                const indices = [
                    // Front slope
                    0, 1, 5, 0, 5, 4,
                    // Back slope
                    2, 3, 4, 2, 4, 5,
                    // Left hip
                    3, 0, 4,
                    // Right hip
                    1, 2, 5,
                    // Bottom
                    0, 2, 1, 0, 3, 2,
                ];
                geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
                geo.setIndex(indices);
            } else {
                const verts = new Float32Array([
                    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
                    0, ridgeH, -ridgeLen, 0, ridgeH, ridgeLen,
                ]);
                const indices = [
                    0, 1, 4, 1, 2, 5, 1, 5, 4,
                    2, 3, 5, 3, 0, 4, 3, 4, 5,
                    0, 2, 1, 0, 3, 2,
                ];
                geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
                geo.setIndex(indices);
            }
            geo.computeVertexNormals();
            return { geo, cx, cz, baseY: yOffset + wallH };
        }

        if (roofType === 'flat') {
            const parapet = Math.max(0.01, num(parapetMm, typeDefaults.parapet_mm ?? 500) * MM);
            // Simple flat slab on top
            const geo = new THREE.BoxGeometry(W + 0.1, parapet, D + 0.1);
            return { geo, cx, cz, baseY: yOffset + wallH + parapet / 2 };
        }

        return null;
    }, [roofType, pitchDeg, kneeWallMm, overhangMm, parapetMm, footprintKey, wallHeightMm, yOffset]);
    useDisposable(geometry, g => g.geo);

    if (!geometry) return null;

    const color = roofType === 'flat' ? '#94a3b8' : '#b45309';

    return (
        <mesh
            geometry={geometry.geo}
            position={[geometry.cx, geometry.baseY, geometry.cz]}
        >
            <meshStandardMaterial
                color={color} roughness={0.75} metalness={0.1}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
};

// ─── Scene ──────────────────────────────────────────────────────

// Kamera, Zielpunkt und Bodenplatte auf den Grundriss ausrichten (statt fest auf den Ursprung)
const computeSceneFit = (storeys) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    // Gesamthöhe wie die Stapelung in der Szene (Raumhöhen + Deckenstärken)
    const totalHeight = totalStackHeightMm(storeys) * MM;
    for (const storey of arr(storeys)) {
        for (const p of arr(storey?.points)) {
            if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minZ) minZ = p.y;
            if (p.y > maxZ) maxZ = p.y;
        }
    }
    if (!Number.isFinite(minX)) {
        return { cx: 0, cz: 0, size: 10, height: totalHeight || DEFAULT_STOREY_HEIGHT_MM * MM };
    }
    const sizeX = (maxX - minX) * MM;
    const sizeZ = (maxZ - minZ) * MM;
    return {
        cx: ((minX + maxX) / 2) * MM,
        cz: ((minZ + maxZ) / 2) * MM,
        size: Math.max(4, sizeX, sizeZ, totalHeight),
        height: totalHeight,
    };
};

const Scene = ({ storeys, fit }) => {
    const camOffset = Math.max(8, fit.size * 0.9);
    const targetY = Math.max(1, fit.height / 2);
    const groundSize = Math.max(100, fit.size * 6);
    const list = arr(storeys);
    // Unterkante je Geschoss: Summe der darunterliegenden Raumhöhen + Deckenstärken
    // (Deckenplatten liegen auf Geschosshöhe und wachsen nach oben – sonst überlappen
    // sie mit dem Boden des nächsten Geschosses)
    const baseOffsetsMm = storeyBaseOffsetsMm(list);
    return (
        <>
            <PerspectiveCamera makeDefault position={[fit.cx + camOffset, targetY + camOffset, fit.cz + camOffset]} fov={50} />
            <OrbitControls
                enablePan enableZoom enableRotate
                maxPolarAngle={Math.PI / 2.1}
                minDistance={2} maxDistance={Math.max(50, fit.size * 4)}
                target={[fit.cx, targetY, fit.cz]}
            />

            <ambientLight intensity={0.6} />
            <directionalLight position={[fit.cx + 10, 15, fit.cz + 8]} intensity={1.0} />
            <directionalLight position={[fit.cx - 5, 10, fit.cz - 5]} intensity={0.3} />

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[fit.cx, -0.01, fit.cz]}>
                <planeGeometry args={[groundSize, groundSize]} />
                <meshStandardMaterial color="#f1f5f9" roughness={1} />
            </mesh>

            {list.map((storey, idx) => {
                const yOffset = (baseOffsetsMm[idx] || 0) * MM;
                // Dach nur auf dem obersten Geschoss – sonst würde es durch die Geschosse darüber gezeichnet
                const isTopStorey = idx === list.length - 1;
                return (
                    <group key={storey.id || idx}>
                        <FloorMesh storey={storey} yOffset={yOffset} />
                        {arr(storey.walls).map(wall => (
                            <WallMesh key={wall.id} wall={wall} storey={storey} yOffset={yOffset} />
                        ))}
                        {arr(storey.furniture).map(furn => (
                            <FurnitureMesh key={furn.id} item={furn} yOffset={yOffset} />
                        ))}
                        {arr(storey.rooms).map(room => (
                            <RoomLabel3D key={room.id} room={room} yOffset={yOffset} />
                        ))}
                        {arr(storey.slabs).map(slab => (
                            <SlabMesh key={slab.id} slab={slab} yOffset={yOffset} />
                        ))}
                        {storey.roof && isTopStorey && (
                            <RoofMesh storey={storey} yOffset={yOffset} />
                        )}
                    </group>
                );
            })}
        </>
    );
};

// ─── Main 3D Viewer Component ───────────────────────────────────

const FloorPlan3DView = ({ storeys }) => {
    // Einpassen einmal beim Öffnen der 3D-Ansicht (spätere Änderungen sollen die Kamera nicht springen lassen)
    const [fit] = useState(() => computeSceneFit(storeys));
    const fogNear = Math.max(30, fit.size * 2);
    const fogFar = Math.max(80, fit.size * 6);
    return (
        <div style={{ width: '100%', height: '100%', background: '#0f172a', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {/* frameloop="demand": nur bei Änderungen/Kamerabewegung rendern (Akku/GPU) */}
            <Canvas dpr={[1, 2]} frameloop="demand" gl={{ antialias: true, alpha: false }}>
                <color attach="background" args={['#f8fafc']} />
                <fog attach="fog" args={['#f8fafc', fogNear, fogFar]} />
                <Scene storeys={storeys} fit={fit} />
            </Canvas>
        </div>
    );
};

export default FloorPlan3DView;
