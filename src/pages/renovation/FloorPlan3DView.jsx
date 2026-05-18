// ─── 3D Viewer Component ────────────────────────────────────────────
// Three.js based 3D view for floor plan visualization.
// Renders walls as boxes with corner overlap, openings as cutouts.

import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text } from '@react-three/drei';
import * as THREE from 'three';
import { getPoint, getWallPolygon, dist, polygonCentroid } from '../../lib/floorplan/geometryKernel';
import { getFurnitureItem } from '../../lib/floorplan/furnitureCatalog';

const MM = 0.001;

// ─── Wall Mesh ──────────────────────────────────────────────────
// Each wall is a box, extended slightly at endpoints that connect to other walls
// to fill corner gaps.

const WallMesh = ({ wall, storey, yOffset = 0 }) => {
    const pt1 = getPoint(storey, wall.p1);
    const pt2 = getPoint(storey, wall.p2);
    if (!pt1 || !pt2) return null;

    const wallLenMm = dist(pt1, pt2);
    if (wallLenMm < 1) return null;

    const thickness = wall.thickness_mm * MM;
    const height = (wall.height_mm || storey.height_mm || 2600) * MM;

    // Check if endpoints connect to other walls (for corner extension)
    const p1Walls = storey.walls.filter(w => w.id !== wall.id && (w.p1 === wall.p1 || w.p2 === wall.p1));
    const p2Walls = storey.walls.filter(w => w.id !== wall.id && (w.p1 === wall.p2 || w.p2 === wall.p2));

    // Extend half-thickness at connected corners to fill gaps
    const ext1 = p1Walls.length > 0 ? wall.thickness_mm / 2 : 0;
    const ext2 = p2Walls.length > 0 ? wall.thickness_mm / 2 : 0;

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

    // Find openings on this wall
    const wallOpenings = storey.openings.filter(o => o.wall_id === wall.id);
    const wallColor = wall.type === 'outer' ? '#e2e8f0' : '#cbd5e1';

    if (wallOpenings.length === 0) {
        return (
            <mesh position={[cx, cy, cz]} rotation={[0, angle, 0]} castShadow receiveShadow>
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
    const totalLen = wallLenMm + ext1 + ext2;
    const elements = [];
    const sorted = [...openings].sort((a, b) => a.position_mm - b.position_mm);

    let lastEnd = -ext1; // start from extended beginning

    sorted.forEach((opening, idx) => {
        const openStart = opening.position_mm - opening.width_mm / 2;
        const openEnd = opening.position_mm + opening.width_mm / 2;
        const openHeight = (opening.height_mm || 1200) * MM;
        const sillHeight = (opening.sill_mm || 0) * MM;

        // Solid segment before opening
        if (openStart > lastEnd + 1) {
            const segLen = (openStart - lastEnd) * MM;
            const segCenter = ((lastEnd + openStart) / 2 - wallLenMm / 2 + (ext2 - ext1) / 2) * MM;
            elements.push(
                <mesh key={`seg-${idx}-before`} position={[segCenter, 0, 0]} castShadow receiveShadow>
                    <boxGeometry args={[segLen, wallHeight, thickness]} />
                    <meshStandardMaterial color={wallColor} roughness={0.8} />
                </mesh>
            );
        }

        const openW = opening.width_mm * MM;
        const openCenter = (opening.position_mm - wallLenMm / 2 + (ext2 - ext1) / 2) * MM;

        // Lintel (above opening)
        const topOfOpening = sillHeight + openHeight;
        if (topOfOpening < wallHeight - 0.01) {
            const lintelH = wallHeight - topOfOpening;
            elements.push(
                <mesh key={`lintel-${idx}`} position={[openCenter, wallHeight / 2 - lintelH / 2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[openW, lintelH, thickness]} />
                    <meshStandardMaterial color={wallColor} roughness={0.8} />
                </mesh>
            );
        }

        // Sill wall (below opening) for windows
        if (sillHeight > 0.01) {
            elements.push(
                <mesh key={`sill-${idx}`} position={[openCenter, -wallHeight / 2 + sillHeight / 2, 0]} castShadow receiveShadow>
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
        const segCenter = ((lastEnd + finalEnd) / 2 - wallLenMm / 2 + (ext2 - ext1) / 2) * MM;
        elements.push(
            <mesh key="seg-final" position={[segCenter, 0, 0]} castShadow receiveShadow>
                <boxGeometry args={[segLen, wallHeight, thickness]} />
                <meshStandardMaterial color={wallColor} roughness={0.8} />
            </mesh>
        );
    }

    return elements;
};

// ─── Floor Mesh ─────────────────────────────────────────────────

const FloorMesh = ({ storey, yOffset = 0 }) => {
    const geometry = useMemo(() => {
        if (!storey.outerPolygon || storey.outerPolygon.length < 3) return null;
        const shape = new THREE.Shape();
        const pts = storey.outerPolygon;
        shape.moveTo(pts[0].x * MM, pts[0].y * MM);
        for (let i = 1; i < pts.length; i++) {
            shape.lineTo(pts[i].x * MM, pts[i].y * MM);
        }
        shape.closePath();
        return new THREE.ShapeGeometry(shape);
    }, [storey.outerPolygon]);

    if (!geometry) return null;
    return (
        <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, yOffset, 0]} receiveShadow>
            <meshStandardMaterial color="#f8fafc" roughness={0.9} metalness={0.0} side={THREE.DoubleSide} />
        </mesh>
    );
};

// ─── Slab Mesh (Ceiling / Floor slab) ───────────────────────────

const SlabMesh = ({ slab, storey, yOffset = 0 }) => {
    const geometry = useMemo(() => {
        // Use the slab's own drawn polygon
        const polygon = slab.polygon;
        if (!polygon || polygon.length < 3) return null;
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x * MM, -polygon[0].y * MM);
        for (let i = 1; i < polygon.length; i++) {
            shape.lineTo(polygon[i].x * MM, -polygon[i].y * MM);
        }
        shape.closePath();
        const thickM = (slab.thickness_mm || 200) * MM;
        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: thickM,
            bevelEnabled: false,
        });
        // Rotate so the shape lies flat (XZ plane) with extrusion going up (Y+)
        geo.rotateX(-Math.PI / 2);
        return geo;
    }, [slab.polygon, slab.thickness_mm]);

    if (!geometry) return null;

    // Position: yOffset is storey base, ref_height_mm is where slab bottom starts
    const refY = yOffset + (slab.ref_height_mm || 0) * MM;
    const isCeiling = (slab.ref_height_mm || 0) > 1000;
    const color = isCeiling ? '#94a3b8' : '#a1887f';

    return (
        <mesh
            geometry={geometry}
            position={[0, refY, 0]}
            receiveShadow
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
    const catItem = getFurnitureItem(item.catalog_id);
    const w = item.width_mm * MM;
    const d = item.depth_mm * MM;
    const h = item.height_mm * MM;
    const cx = item.x * MM;
    const cz = item.y * MM;
    const cy = yOffset + h / 2;
    const rotY = -(item.rotation || 0) * Math.PI / 180;

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

const RoomLabel3D = ({ room, yOffset = 0 }) => {
    const centroid = polygonCentroid(room.polygon);
    const area = (room.area_mm2 / 1000000).toFixed(1);
    return (
        <Text
            position={[centroid.x * MM, yOffset + 0.01, centroid.y * MM]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.3}
            color="#64748b"
            anchorX="center"
            anchorY="middle"
            maxWidth={3}
        >
            {`${room.name}\n${area} m²`}
        </Text>
    );
};

// ─── Roof Mesh ──────────────────────────────────────────────────

const RoofMesh = ({ storey, yOffset = 0 }) => {
    const roof = storey.roof;
    const geometry = useMemo(() => {
        if (!roof) return null;
        // Get outer boundary as footprint
        const boundary = storey.outerBoundary || storey.outerPolygon;
        if (!boundary || boundary.length < 3) return null;

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
        const wallH = (storey.height_mm || 2600) * MM;
        const overhang = (roof.overhang_mm || 0) * MM;

        if (roof.type === 'gable') {
            const kneeH = (roof.kneeWall_mm || 0) * MM;
            const pitch = (roof.pitch_deg || 35) * Math.PI / 180;
            const halfSpan = W / 2 + overhang;
            const ridgeH = Math.tan(pitch) * halfSpan;
            const totalH = kneeH + ridgeH;
            const depth = D + overhang * 2;

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
            geo.computeVertexNormals();
            return { geo, cx, cz, baseY: yOffset + wallH };
        }

        if (roof.type === 'hip') {
            const pitch = (roof.pitch_deg || 25) * Math.PI / 180;
            const hw = W / 2 + overhang;
            const hd = D / 2 + overhang;
            // For hip roof, ridge runs along the longer axis
            const isWide = W > D;
            const shortHalf = isWide ? hd : hw;
            const longHalf = isWide ? hw : hd;
            const ridgeH = Math.tan(pitch) * shortHalf;
            const ridgeLen = longHalf - shortHalf; // ridge length (shorter than full length)
            if (ridgeLen < 0) {
                // Pyramid (no ridge)
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

        if (roof.type === 'flat') {
            const parapet = (roof.parapet_mm || 500) * MM;
            // Simple flat slab on top
            const geo = new THREE.BoxGeometry(W + 0.1, parapet, D + 0.1);
            return { geo, cx, cz, baseY: yOffset + wallH + parapet / 2 };
        }

        return null;
    }, [roof, storey.outerBoundary, storey.outerPolygon, storey.height_mm, yOffset]);

    if (!geometry) return null;

    const color = roof.type === 'flat' ? '#94a3b8' : '#b45309';

    return (
        <mesh
            geometry={geometry.geo}
            position={[geometry.cx, geometry.baseY, geometry.cz]}
            castShadow receiveShadow
        >
            <meshStandardMaterial
                color={color} roughness={0.75} metalness={0.1}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
};

// ─── Scene ──────────────────────────────────────────────────────

const Scene = ({ storeys, activeStoreyIdx }) => {
    return (
        <>
            <PerspectiveCamera makeDefault position={[8, 8, 8]} fov={50} />
            <OrbitControls
                enablePan enableZoom enableRotate
                maxPolarAngle={Math.PI / 2.1}
                minDistance={2} maxDistance={50}
                target={[0, 1, 0]}
            />

            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 15, 8]} intensity={1.0} />
            <directionalLight position={[-5, 10, -5]} intensity={0.3} />

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
                <planeGeometry args={[100, 100]} />
                <meshStandardMaterial color="#f1f5f9" roughness={1} />
            </mesh>

            {storeys.map((storey, idx) => {
                let yOffset = 0;
                for (let i = 0; i < idx; i++) {
                    yOffset += (storeys[i].height_mm || 2600) * MM;
                }
                return (
                    <group key={storey.id}>
                        <FloorMesh storey={storey} yOffset={yOffset} />
                        {storey.walls.map(wall => (
                            <WallMesh key={wall.id} wall={wall} storey={storey} yOffset={yOffset} />
                        ))}
                        {storey.furniture.map(furn => (
                            <FurnitureMesh key={furn.id} item={furn} yOffset={yOffset} />
                        ))}
                        {storey.rooms.map(room => (
                            <RoomLabel3D key={room.id} room={room} yOffset={yOffset} />
                        ))}
                        {(storey.slabs || []).map(slab => (
                            <SlabMesh key={slab.id} slab={slab} storey={storey} yOffset={yOffset} />
                        ))}
                        {storey.roof && (
                            <RoofMesh storey={storey} yOffset={yOffset} />
                        )}
                    </group>
                );
            })}
        </>
    );
};

// ─── Main 3D Viewer Component ───────────────────────────────────

const FloorPlan3DView = ({ storeys, activeStoreyIdx }) => {
    return (
        <div style={{ width: '100%', height: '100%', background: '#0f172a', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
                <color attach="background" args={['#f8fafc']} />
                <fog attach="fog" args={['#f8fafc', 30, 80]} />
                <Scene storeys={storeys} activeStoreyIdx={activeStoreyIdx} />
            </Canvas>
        </div>
    );
};

export default FloorPlan3DView;
