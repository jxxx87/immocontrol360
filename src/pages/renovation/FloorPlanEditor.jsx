import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, Save, Undo2, Redo2, Download, MousePointer2, PenTool,
    DoorOpen, Square, Sofa, Trash2, Loader2, ChevronDown, Plus,
    RotateCcw, FlipHorizontal2, Copy, Box, Image, FileText, Ruler,
    List, FileSpreadsheet, BoxSelect, SeparatorHorizontal, AppWindow, Armchair, Search,
    Upload, Eye, EyeOff, X, Scaling, Layers, Maximize, Minimize, Home,
    Spline, CircleDot, Pentagon, Type,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import {
    TOOLS, TOOL_HINTS, WALL_THICKNESS, STOREY_HEIGHT,
    mmToM, mm2ToM2, STOREY_LABELS, ROOF_TYPES,
    DOOR_PRESETS, WINDOW_PRESETS, OPENING_MIN_EDGE_DIST,
} from '../../lib/floorplan/constants';
import {
    createStorey, duplicateStorey, addPoint, getPoint,
    addOuterWallSegment, closeOuterWalls, addInnerWallSegment,
    computeRooms, placeOpening, deleteWall, deleteOpening, deleteFurniture,
    placeFurniture, moveFurniture, flipWallSide, findWallAtPoint,
    findFurnitureAtPoint, findOpeningAtPoint, findRoomAtPoint,
    snapToGrid, snapAngle, findSnapPoint, dist, getPointSide, genId, pointToSegmentDist,
    getWallPolygon, ensureCW, offsetPolygon, buildOrderedPolygon,
    splitWallAtPoint,
} from '../../lib/floorplan/geometryKernel';
import {
    createViewport, render, screenToWorld, worldToScreen, zoomAtPoint, zoomToFit,
} from '../../lib/floorplan/canvasRenderer';
import { createCommandStack } from '../../lib/floorplan/commandStack';
import { FURNITURE_CATEGORIES, FURNITURE_ITEMS, getItemsByCategory, getFurnitureItem, clampDimensions } from '../../lib/floorplan/furnitureCatalog';
import { exportToPNG, exportToPDF, exportQuantityListCSV, exportQuantityListPDF, generateQuantityList, downloadBlob } from '../../lib/floorplan/floorplanExport';

// Lazy load 3D viewer to avoid loading Three.js unless needed
const FloorPlan3DView = lazy(() => import('./FloorPlan3DView'));

// ─── Main Component ─────────────────────────────────────────────

const FloorPlanEditor = () => {
    const { id: planId } = useParams();
    const isNew = planId === 'new';
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const { isMobile } = useViewMode();

    // ─── State ──────────────────────────────────────────────────
    const [planName, setPlanName] = useState('Neuer Grundriss');
    const [storeys, setStoreys] = useState([createStorey('EG', 2600)]);
    const [activeStoreyIdx, setActiveStoreyIdx] = useState(0);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(!isNew);
    const [savedId, setSavedId] = useState(isNew ? null : planId);

    // Tool state
    const [activeTool, setActiveTool] = useState(TOOLS.SELECT);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedType, setSelectedType] = useState(null); // 'wall' | 'opening' | 'furniture' | 'room' | 'point'
    const [selectedIds, setSelectedIds] = useState([]); // [{id, type}] for multi-selection
    const [selectedRoomId, setSelectedRoomId] = useState(null); // for room label dragging
    const [editingLength, setEditingLength] = useState(null); // { wallId, value } when editing wall length

    // View mode: '2d' or '3d'
    const [viewMode, setViewMode] = useState('2d');
    const [rightPanel, setRightPanel] = useState('properties'); // 'properties' | 'quantities'
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [slabContextMenu, setSlabContextMenu] = useState(null); // { x, y, worldX, worldY, slabId, edgeIdx }
    const [showDimensions, setShowDimensions] = useState(true); // normgerechte Bemaßung

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            const el = editorContainerRef.current || document.documentElement;
            el.requestFullscreen().catch(() => { });
        } else {
            document.exitFullscreen().catch(() => { });
        }
    }, []);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    // Measurement tool state
    const [measurePoints, setMeasurePoints] = useState([]);
    const [measureResult, setMeasureResult] = useState(null);

    // Drawing state
    const [drawPoints, setDrawPoints] = useState([]); // point IDs for current polygon
    const [innerWallType, setInnerWallType] = useState('inner_nonload');
    const [innerWallThickness, setInnerWallThickness] = useState(WALL_THICKNESS.innerNonloadDefault);
    const [outerWallThickness, setOuterWallThickness] = useState(WALL_THICKNESS.outerDefault);

    // Annotation drawing state
    const [annotationColor, setAnnotationColor] = useState('#ef4444'); // default red
    const [annotationLineWidth, setAnnotationLineWidth] = useState(2);
    const [annotationPoints, setAnnotationPoints] = useState([]); // {x,y}[] for current polyline/area
    const [annotationCircleCenter, setAnnotationCircleCenter] = useState(null); // {x,y}
    const [editingAnnotationId, setEditingAnnotationId] = useState(null); // text being edited
    const [activeAnnotationId, setActiveAnnotationId] = useState(null); // live-editing polyline/area id
    const clipboardRef = useRef(null); // { type, data } for copy/paste

    // Furniture placing
    const [placingFurniture, setPlacingFurniture] = useState(null);
    const [furnitureCategory, setFurnitureCategory] = useState('wohnen');

    // Next opening preset (editable in right panel when door/window tool is active)
    const [nextOpeningPreset, setNextOpeningPreset] = useState({
        door: { width: 860, height: 2010, sill: 0 },
        window: { width: 1200, height: 1200, sill: 700 },
    });

    // Background image
    const [bgImage, setBgImage] = useState(null); // { dataUrl, scale, offsetX, offsetY, opacity, visible }
    const [bgImageObj, setBgImageObj] = useState(null); // HTMLImageElement
    const [calibPoints, setCalibPoints] = useState([]); // [{x,y}, {x,y}] world coords
    const [showCalibDialog, setShowCalibDialog] = useState(false);
    const [calibDistMm, setCalibDistMm] = useState('');
    const bgFileRef = useRef(null);
    const editorContainerRef = useRef(null);

    // Viewport & canvas
    const canvasRef = useRef(null);
    const vpRef = useRef(createViewport());
    const cmdStackRef = useRef(createCommandStack());
    const [, forceRender] = useState(0);
    const animFrameRef = useRef(null);

    // Preview state for rendering
    const previewRef = useRef(null);
    const snapPointRef = useRef(null);
    const mouseWorldRef = useRef({ x: 0, y: 0 });

    // Autosave timer
    const autosaveTimerRef = useRef(null);
    const isDirtyRef = useRef(false);

    // ─── Active Storey ──────────────────────────────────────────
    const activeStorey = storeys[activeStoreyIdx] || storeys[0];

    // ─── Load ───────────────────────────────────────────────────
    useEffect(() => {
        if (isNew || !user) { setLoading(false); return; }
        (async () => {
            const { data, error } = await supabase.from('floor_plans').select('*').eq('id', planId).single();
            if (error || !data) { setLoading(false); return; }
            setPlanName(data.name || 'Grundriss');
            if (Array.isArray(data.plan_data) && data.plan_data.length > 0) {
                setStoreys(data.plan_data);
            }
            setSavedId(data.id);
            setLoading(false);
        })();
    }, [planId, user]);

    // ─── Save ───────────────────────────────────────────────────
    const handleSave = useCallback(async (silent = false) => {
        if (!user || saving) return;
        setSaving(true);
        try {
            // Recompute rooms before saving
            const updated = storeys.map(s => {
                computeRooms(s);
                // Clean up temporary render data from annotations
                if (s.annotations) {
                    for (const ann of s.annotations) { delete ann._hitBox; }
                }
                return { ...s };
            });

            const payload = {
                user_id: user.id,
                name: planName.trim() || 'Grundriss',
                plan_data: updated,
                updated_at: new Date().toISOString(),
            };

            if (savedId) {
                await supabase.from('floor_plans').update(payload).eq('id', savedId);
            } else {
                const { data } = await supabase.from('floor_plans').insert(payload).select('id').single();
                if (data) {
                    setSavedId(data.id);
                    window.history.replaceState(null, '', `/renovation/floorplan/${data.id}`);
                }
            }
            isDirtyRef.current = false;
        } catch (err) {
            if (!silent) alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(false);
        }
    }, [user, saving, planName, storeys, savedId]);

    // Autosave
    const markDirty = useCallback(() => {
        isDirtyRef.current = true;
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => {
            if (isDirtyRef.current) handleSave(true);
        }, 2000);
    }, [handleSave]);

    // ─── Undo/Redo subscription ─────────────────────────────────
    useEffect(() => {
        const unsub = cmdStackRef.current.subscribe(() => forceRender(v => v + 1));
        return unsub;
    }, []);

    // ─── Canvas Setup ───────────────────────────────────────────
    useEffect(() => {
        if (viewMode !== '2d') return; // canvas not mounted in 3D mode
        const canvas = canvasRef.current;
        if (!canvas) return;
        const resize = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            requestRender();
        };
        // Small timeout to ensure DOM has laid out after view mode switch
        const timer = setTimeout(resize, 50);
        window.addEventListener('resize', resize);
        return () => { clearTimeout(timer); window.removeEventListener('resize', resize); };
    }, [loading, viewMode]);

    // Center viewport on first load
    useEffect(() => {
        if (loading) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const vp = vpRef.current;
        vp.offsetX = canvas.width / 2;
        vp.offsetY = canvas.height / 2;
        requestRender();
    }, [loading]);

    // Keep selectedIds ref in sync so requestRender never uses stale selection
    const selectedIdsRef = useRef(selectedIds);
    useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
    const selectedRoomIdRef = useRef(selectedRoomId);
    useEffect(() => { selectedRoomIdRef.current = selectedRoomId; }, [selectedRoomId]);

    // Keep bg refs in sync so requestRender always uses current values
    const bgImageRef = useRef(bgImage);
    const bgImageObjRef = useRef(bgImageObj);
    const calibPointsRef = useRef(calibPoints);
    useEffect(() => { bgImageRef.current = bgImage; }, [bgImage]);
    useEffect(() => { bgImageObjRef.current = bgImageObj; }, [bgImageObj]);
    useEffect(() => { calibPointsRef.current = calibPoints; }, [calibPoints]);

    // Restore background image from saved storey data
    useEffect(() => {
        if (activeStorey?.bgImage?.dataUrl && !bgImage) {
            const saved = activeStorey.bgImage;
            setBgImage(saved);
            const img = new window.Image();
            img.onload = () => { setBgImageObj(img); requestRender(); };
            img.src = saved.dataUrl;
        } else if (activeStorey && !activeStorey.bgImage && bgImage) {
            // Storey changed and new storey has no bg
            setBgImage(null);
            setBgImageObj(null);
        }
    }, [activeStorey?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Render Loop ────────────────────────────────────────────
    const isPrintingRef = useRef(false);
    const showDimensionsRef = useRef(true);

    const requestRender = useCallback(() => {
        // Cancel any pending stale frame so we always render with fresh state
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
        }
        animFrameRef.current = requestAnimationFrame(() => {
            animFrameRef.current = null;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const bg = bgImageRef.current;
            render(ctx, canvas, vpRef.current, activeStorey, {
                selectedId: selectedIdRef.current,
                selectedIds: selectedIdsRef.current,
                preview: previewRef.current,
                snapPoint: snapPointRef.current,
                dimensionLine: dimensionLineRef.current,
                dragHandle: dragHandleRef.current,
                hoverPoint: hoverPointRef.current,
                marquee: marqueeRef.current,
                hoverId: hoverIdRef.current,
                bgImage: bg && bg.visible !== false ? bg : null,
                bgImageObj: bgImageObjRef.current,
                calibPoints: calibPointsRef.current,
                isPrinting: isPrintingRef.current,
                showDimensions: showDimensionsRef.current,
                selectedRoomId: selectedRoomIdRef.current,
            });
        });
    }, [activeStorey]);

    useEffect(() => { requestRender(); }, [requestRender, storeys, activeStoreyIdx, selectedId, selectedIds, selectedRoomId]);

    // Re-render when bg changes
    useEffect(() => { requestRender(); }, [bgImage, bgImageObj, calibPoints]);

    // Hide grid during printing
    useEffect(() => {
        const beforePrint = () => { isPrintingRef.current = true; requestRender(); };
        const afterPrint = () => { isPrintingRef.current = false; requestRender(); };
        window.addEventListener('beforeprint', beforePrint);
        window.addEventListener('afterprint', afterPrint);
        return () => {
            window.removeEventListener('beforeprint', beforePrint);
            window.removeEventListener('afterprint', afterPrint);
        };
    }, [requestRender]);

    // ─── Background Image Upload ─────────────────────────────────
    const handleBgUpload = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const loadImage = (dataUrl, pxPerMm) => {
            const img = new window.Image();
            img.onload = () => {
                setBgImageObj(img);
                // pxPerMm = how many image pixels per 1 mm of real-world space
                const finalScale = pxPerMm || 5;
                const bgData = {
                    dataUrl,
                    scale: finalScale,
                    offsetX: 0,
                    offsetY: 0,
                    opacity: 0.35,
                    visible: true,
                    imgWidth: img.width,
                    imgHeight: img.height,
                };
                setBgImage(bgData);
                // Persist to storey so it saves to DB
                if (activeStorey) activeStorey.bgImage = bgData;
                markDirty();
                requestRender();
            };
            img.src = dataUrl;
        };

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            // PDF: render first page to canvas using pdfjsLib
            const loadPdf = async () => {
                try {
                    const pdfjsLib = await import('pdfjs-dist');

                    // pdfjs-dist v5+ worker setup for Vite
                    try {
                        const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
                        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;
                    } catch (workerErr) {
                        console.warn('PDF worker import failed, using workerless mode:', workerErr);
                        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
                    }

                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({
                        data: new Uint8Array(arrayBuffer),
                        useWorkerFetch: false,
                        isEvalSupported: false,
                        useSystemFonts: true,
                    }).promise;
                    const page = await pdf.getPage(1);

                    // Get physical page size (1 PDF point = 1/72 inch = 0.352778 mm)
                    const baseViewport = page.getViewport({ scale: 1 });
                    const pageWidthMm = baseViewport.width * 0.352778;
                    const pageHeightMm = baseViewport.height * 0.352778;
                    console.log(`[PDF] Page size: ${(pageWidthMm / 1000).toFixed(2)}m × ${(pageHeightMm / 1000).toFixed(2)}m`);

                    const renderScale = 4; // Render at 4x for crisp quality
                    const viewport = page.getViewport({ scale: renderScale });
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport }).promise;

                    // pxPerMm = rendered pixels / physical mm on paper
                    // Architectural plans are typically 1:100, so 1mm paper = 100mm real
                    // Divide by 100 to get real-world scale
                    const drawingScale = 100; // default: 1:100
                    const pxPerMm = viewport.width / (pageWidthMm * drawingScale);

                    const dataUrl = canvas.toDataURL('image/png');
                    loadImage(dataUrl, pxPerMm);
                } catch (err) {
                    console.error('PDF load error:', err);
                    alert('PDF konnte nicht geladen werden: ' + (err.message || err) + '\nBitte verwende ein Bild (PNG/JPG) oder versuche es erneut.');
                }
            };
            loadPdf();
        } else {
            // Regular image — assume 150 DPI scanned plan at 1:100 scale
            // 150 DPI = 5.906 px/mm on paper; at 1:100 → 0.05906 px/mm in real world
            const reader = new FileReader();
            reader.onload = (ev) => {
                loadImage(ev.target.result, 5.906 / 100);
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    }, [requestRender]);

    const handleCalibApply = useCallback(() => {
        if (calibPoints.length < 2 || !calibDistMm) return;
        const distMm = parseFloat(calibDistMm.replace(',', '.'));
        if (!distMm || distMm <= 0) return;

        // Distance in current world coords between the two calibration points
        const dx = calibPoints[1].x - calibPoints[0].x;
        const dy = calibPoints[1].y - calibPoints[0].y;
        const worldDist = Math.sqrt(dx * dx + dy * dy);
        if (worldDist < 1) return;

        // Current scale: pxPerMm. worldDist mm in current scale = worldDist mm
        // Real distance = distMm mm.
        // New scale = old scale * (worldDist / distMm)
        const oldScale = bgImage?.scale || 1;
        const newScale = oldScale * (worldDist / distMm);

        setBgImage(prev => { const u = { ...prev, scale: newScale }; if (activeStorey) activeStorey.bgImage = u; return u; });
        setCalibPoints([]);
        setShowCalibDialog(false);
        setCalibDistMm('');
        setActiveTool(TOOLS.SELECT);
        requestRender();
    }, [calibPoints, calibDistMm, bgImage, requestRender]);

    const removeBgImage = useCallback(() => {
        setBgImage(null);
        setBgImageObj(null);
        setCalibPoints([]);
        if (bgFileRef.current) bgFileRef.current.value = '';
        if (activeStorey) { delete activeStorey.bgImage; markDirty(); }
        requestRender();
    }, [activeStorey, markDirty, requestRender]);

    // ─── Mouse Handlers ─────────────────────────────────────────
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const dragStartRef = useRef(null);
    const spaceHeldRef = useRef(false);
    const dragHandleRef = useRef(null);     // which handle is being dragged: p1Id, p2Id, or 'mid'
    const dimensionLineRef = useRef(null);  // active dimension line during drag
    const selectedIdRef = useRef(null);     // always-current selectedId for closures
    selectedIdRef.current = selectedId;
    const hoverPointRef = useRef(null);     // world point near cursor for corner hover
    const marqueeRef = useRef(null);        // { sx1, sy1, sx2, sy2 } screen coords for selection rectangle
    const hoverIdRef = useRef(null);         // ID of element currently hovered
    showDimensionsRef.current = showDimensions;

    // Track Space key for pan mode
    useEffect(() => {
        const down = (e) => { if (e.code === 'Space' && !e.repeat) { spaceHeldRef.current = true; e.preventDefault(); } };
        const up = (e) => { if (e.code === 'Space') { spaceHeldRef.current = false; } };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, []);

    const handleMouseDown = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // Middle button / Right button / Space+Left = pan
        // BUT: right-click during wall drawing = cancel drawing
        if (e.button === 2 && (activeTool === TOOLS.OUTER_WALL || activeTool === TOOLS.INNER_WALL) && drawPoints.length > 0) {
            e.preventDefault();
            // Cancel current drawing operation
            if (drawPoints.length === 1) {
                // Remove the single placed point if no wall was created yet
                const ptId = drawPoints[0];
                const usedByWall = activeStorey.walls.some(w => w.p1 === ptId || w.p2 === ptId);
                if (!usedByWall) {
                    activeStorey.points = activeStorey.points.filter(p => p.id !== ptId);
                }
            }
            setDrawPoints([]);
            previewRef.current = null;
            snapPointRef.current = null;
            requestRender();
            forceRender(v => v + 1);
            return;
        }
        if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeldRef.current)) {
            isPanningRef.current = true;
            panStartRef.current = { x: sx, y: sy };
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return;

        const world = screenToWorld(vpRef.current, sx, sy);
        const wx = snapToGrid(world.x);
        const wy = snapToGrid(world.y);

        // Tool-specific click behavior
        if (activeTool === TOOLS.OUTER_WALL) {
            handleOuterWallClick(wx, wy);
        } else if (activeTool === TOOLS.INNER_WALL) {
            handleInnerWallClick(wx, wy);
        } else if (activeTool === TOOLS.DOOR || activeTool === TOOLS.WINDOW) {
            handleOpeningClick(wx, wy, activeTool === TOOLS.DOOR ? 'door' : 'window');
        } else if (activeTool === TOOLS.FURNITURE && placingFurniture) {
            handleFurnitureClick(wx, wy);
        } else if (activeTool === TOOLS.DELETE) {
            handleDeleteClick(wx, wy);
        } else if (activeTool === TOOLS.CALIBRATE) {
            // Calibration: place two points on the background image
            if (calibPoints.length < 2) {
                const newPts = [...calibPoints, { x: world.x, y: world.y }];
                setCalibPoints(newPts);
                if (newPts.length === 2) {
                    setShowCalibDialog(true);
                }
                requestRender();
            }
        } else if (activeTool === TOOLS.SELECT) {
            handleSelectClick(wx, wy, sx, sy);
        } else if (activeTool === TOOLS.SLAB) {
            // Polygon drawing for slabs
            let clickX = wx, clickY = wy;
            if (snapPointRef.current) {
                clickX = snapPointRef.current.x;
                clickY = snapPointRef.current.y;
            }
            // Snap to wall endpoints and outer wall edges
            const snapRadius = 20 / vpRef.current.zoom;
            const snapTargets = [...activeStorey.points];
            if (activeStorey.outerBoundary) snapTargets.push(...activeStorey.outerBoundary);
            if (activeStorey.outerPolygon) snapTargets.push(...activeStorey.outerPolygon);
            for (const pt of snapTargets) {
                if (dist({ x: clickX, y: clickY }, pt) < snapRadius) {
                    clickX = pt.x; clickY = pt.y;
                    break;
                }
            }
            // Close polygon if near start point
            if (drawPoints.length >= 3) {
                const startPt = drawPoints[0];
                if (dist({ x: clickX, y: clickY }, startPt) < 30 / vpRef.current.zoom) {
                    // Create slab with polygon
                    if (!activeStorey.slabs) activeStorey.slabs = [];
                    const storeyCopy = JSON.parse(JSON.stringify(activeStorey));
                    const newSlab = {
                        id: genId(),
                        name: 'Decke',
                        thickness_mm: 200,
                        ref_height_mm: activeStorey.height_mm || 2600,
                        polygon: drawPoints.map(p => ({ x: p.x, y: p.y })),
                    };
                    activeStorey.slabs.push(newSlab);
                    cmdStackRef.current.execute({
                        do: () => { },
                        undo: () => { Object.assign(activeStorey, storeyCopy); forceRender(v => v + 1); },
                        label: 'Decke erstellen',
                    });
                    setDrawPoints([]);
                    previewRef.current = null;
                    snapPointRef.current = null;
                    setSelectedId(newSlab.id);
                    setSelectedType('slab');
                    setActiveTool(TOOLS.SELECT);
                    markDirty();
                    forceRender(v => v + 1);
                    requestRender();
                    return;
                }
            }
            // Add point to polygon (with angle snap)
            let snapX = snapToGrid(clickX), snapY = snapToGrid(clickY);
            if (drawPoints.length > 0) {
                const lastPt = drawPoints[drawPoints.length - 1];
                const snapped = snapAngle(lastPt.x, lastPt.y, snapX, snapY);
                snapX = snapped.x;
                snapY = snapped.y;
            }
            setDrawPoints(prev => [...prev, { x: snapX, y: snapY }]);
            requestRender();
        }

        // ── Annotation Tools ──────────────────────────────────────────
        const isAnnotTool = [TOOLS.ANNOTATE_POLYLINE, TOOLS.ANNOTATE_CIRCLE, TOOLS.ANNOTATE_AREA, TOOLS.ANNOTATE_TEXT].includes(activeTool);
        if (isAnnotTool) {
            if (!activeStorey.annotations) activeStorey.annotations = [];
            const world = screenToWorld(vpRef.current, sx, sy);
            let ax = snapToGrid(world.x), ay = snapToGrid(world.y);

            // Snap to existing elements
            const snapResult = findSnapPoint(ax, ay, activeStorey.points, []);
            if (snapResult) { ax = snapResult.x; ay = snapResult.y; }
            const genAnnId = () => 'ann_' + Math.random().toString(36).substr(2, 9);

            if (activeTool === TOOLS.ANNOTATE_POLYLINE || activeTool === TOOLS.ANNOTATE_AREA) {
                const annType = activeTool === TOOLS.ANNOTATE_POLYLINE ? 'polyline' : 'area';
                if (!activeAnnotationId) {
                    // First click — just store the first point
                    setAnnotationPoints([{ x: ax, y: ay }]);
                } else {
                    // Subsequent clicks — add point to the live annotation
                    const ann = activeStorey.annotations.find(a => a.id === activeAnnotationId);
                    if (ann) {
                        ann.points.push({ x: ax, y: ay });
                        setAnnotationPoints(prev => [...prev, { x: ax, y: ay }]);
                        markDirty();
                        forceRender(v => v + 1);
                    }
                }

                // After 2nd point: create the annotation object immediately
                if (!activeAnnotationId && annotationPoints.length >= 1) {
                    const newAnn = {
                        id: genAnnId(), type: annType,
                        points: [...annotationPoints, { x: ax, y: ay }],
                        color: annotationColor,
                        lineWidth: annotationLineWidth,
                        fillColor: annType === 'area' ? (annotationColor + '33') : undefined,
                    };
                    activeStorey.annotations.push(newAnn);
                    setActiveAnnotationId(newAnn.id);
                    setAnnotationPoints([...annotationPoints, { x: ax, y: ay }]);
                    setSelectedId(newAnn.id);
                    setSelectedType('annotation');
                    markDirty();
                    forceRender(v => v + 1);
                }
                requestRender();
            } else if (activeTool === TOOLS.ANNOTATE_CIRCLE) {
                if (!annotationCircleCenter) {
                    setAnnotationCircleCenter({ x: ax, y: ay });
                } else {
                    // Second click → commit circle
                    const radius = dist(annotationCircleCenter, { x: ax, y: ay });
                    if (radius > 10) {
                        const newAnn = {
                            id: genAnnId(), type: 'circle',
                            cx: annotationCircleCenter.x, cy: annotationCircleCenter.y,
                            radius, color: annotationColor, lineWidth: annotationLineWidth,
                        };
                        activeStorey.annotations.push(newAnn);
                        setSelectedId(newAnn.id);
                        setSelectedType('annotation');
                        markDirty();
                        forceRender(v => v + 1);
                    }
                    setAnnotationCircleCenter(null);
                    requestRender();
                }
            } else if (activeTool === TOOLS.ANNOTATE_TEXT) {
                const newAnn = {
                    id: genAnnId(), type: 'text',
                    x: ax, y: ay, text: 'Text',
                    color: annotationColor, fontSize: 14,
                };
                activeStorey.annotations.push(newAnn);
                setEditingAnnotationId(newAnn.id);
                setSelectedId(newAnn.id);
                setSelectedType('annotation');
                markDirty();
                forceRender(v => v + 1);
                requestRender();
            }
        }
    }, [activeTool, activeStorey, drawPoints, placingFurniture, innerWallType, innerWallThickness, outerWallThickness, calibPoints, requestRender, nextOpeningPreset, selectedIds, selectedType, annotationColor, annotationLineWidth, annotationCircleCenter, annotationPoints, activeAnnotationId]);

    const handleMouseMove = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // Pan
        if (isPanningRef.current) {
            const vp = vpRef.current;
            vp.offsetX += sx - panStartRef.current.x;
            vp.offsetY += sy - panStartRef.current.y;
            panStartRef.current = { x: sx, y: sy };
            requestRender();
            return;
        }

        // Drag (select tool)
        if (dragStartRef.current) {
            const world = screenToWorld(vpRef.current, sx, sy);
            const wx = snapToGrid(world.x);
            const wy = snapToGrid(world.y);
            const { type, id, startX, startY } = dragStartRef.current;
            if (type === 'furniture') {
                const dx = wx - startX;
                const dy = wy - startY;
                const furn = activeStorey.furniture.find(f => f.id === id);
                if (furn) {
                    furn.x = dragStartRef.current.origX + dx;
                    furn.y = dragStartRef.current.origY + dy;
                }
                requestRender();
            } else if (type === 'opening') {
                // Slide opening along its wall
                const opening = activeStorey.openings.find(o => o.id === id);
                if (opening) {
                    const hostWall = activeStorey.walls.find(w => w.id === opening.wall_id);
                    if (hostWall) {
                        const wp1 = getPoint(activeStorey, hostWall.p1);
                        const wp2 = getPoint(activeStorey, hostWall.p2);
                        if (wp1 && wp2) {
                            const wallLen = dist(wp1, wp2);
                            const wallDx = (wp2.x - wp1.x) / wallLen;
                            const wallDy = (wp2.y - wp1.y) / wallLen;
                            // Project mouse position onto wall axis
                            const relX = world.x - wp1.x;
                            const relY = world.y - wp1.y;
                            let newPos = relX * wallDx + relY * wallDy;
                            // Clamp to valid range
                            const halfW = opening.width_mm / 2;
                            newPos = Math.max(halfW + 50, Math.min(wallLen - halfW - 50, snapToGrid(newPos)));
                            opening.position_mm = newPos;
                        }
                    }
                }
                requestRender();
            } else if (type === 'corner') {
                // Endpoint drag: move single point (resize wall)
                const pt = getPoint(activeStorey, dragStartRef.current.pointId);
                if (pt) {
                    const wall = activeStorey.walls.find(w => w.id === id);
                    let newX = snapToGrid(world.x);
                    let newY = snapToGrid(world.y);

                    // For inner wall endpoints, constrain to host wall
                    if (wall && wall.type !== 'outer') {
                        const origPt = { x: dragStartRef.current.origX, y: dragStartRef.current.origY };
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
                                // Project mouse position onto host wall
                                const tMouse = (snapToGrid(world.x) - hp1.x) * hux + (snapToGrid(world.y) - hp1.y) * huy;
                                const clampedT = Math.max(0, Math.min(hwLen, snapToGrid(tMouse)));
                                newX = hp1.x + hux * clampedT;
                                newY = hp1.y + huy * clampedT;
                                break;
                            }
                        }
                    }

                    pt.x = newX;
                    pt.y = newY;
                    if (wall) {
                        const p1 = getPoint(activeStorey, wall.p1);
                        const p2 = getPoint(activeStorey, wall.p2);
                        if (p1 && p2) {
                            dimensionLineRef.current = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
                        }
                    }
                }
                requestRender();
            } else if (type === 'wall_perp') {
                const dx = wx - startX;
                const dy = wy - startY;
                const { nx, ny, origP1, origP2, p1Id, p2Id } = dragStartRef.current;
                const projDist = dx * nx + dy * ny;
                const snapProj = snapToGrid(projDist);
                const p1 = getPoint(activeStorey, p1Id);
                const p2 = getPoint(activeStorey, p2Id);
                if (p1 && p2) {
                    // Compute desired new positions
                    let newP1x = origP1.x + nx * snapProj;
                    let newP1y = origP1.y + ny * snapProj;
                    let newP2x = origP2.x + nx * snapProj;
                    let newP2y = origP2.y + ny * snapProj;

                    // Find the wall being dragged
                    const draggedWall = activeStorey.walls.find(w => w.id === id);

                    // Constrain endpoints to their host walls (if attached)
                    if (draggedWall && draggedWall.type !== 'outer') {
                        // For each endpoint, find a host wall it lies on and project movement onto it
                        const constrainToHost = (origPt, newX, newY, ptId) => {
                            // Find host wall: another wall whose edge contains this point
                            for (const hw of activeStorey.walls) {
                                if (hw.id === id) continue;
                                const hp1 = getPoint(activeStorey, hw.p1);
                                const hp2 = getPoint(activeStorey, hw.p2);
                                if (!hp1 || !hp2) continue;

                                // Check if this endpoint was originally on this wall's edge
                                const hwDx = hp2.x - hp1.x, hwDy = hp2.y - hp1.y;
                                const hwLen = Math.sqrt(hwDx * hwDx + hwDy * hwDy);
                                if (hwLen < 1) continue;
                                const hux = hwDx / hwLen, huy = hwDy / hwLen;

                                // Project original point onto host wall
                                const t0 = (origPt.x - hp1.x) * hux + (origPt.y - hp1.y) * huy;
                                const projX = hp1.x + hux * t0;
                                const projY = hp1.y + huy * t0;
                                const perpDist = Math.sqrt((origPt.x - projX) ** 2 + (origPt.y - projY) ** 2);

                                if (perpDist < 50 && t0 > -10 && t0 < hwLen + 10) {
                                    // This endpoint is on this host wall => constrain to slide along it
                                    const moveX = newX - origPt.x;
                                    const moveY = newY - origPt.y;
                                    // Project movement onto host wall direction
                                    const proj = moveX * hux + moveY * huy;
                                    const snappedProj = snapToGrid(proj);
                                    const newT = Math.max(0, Math.min(hwLen, t0 + snappedProj));
                                    return {
                                        x: hp1.x + hux * newT,
                                        y: hp1.y + huy * newT,
                                        constrained: true,
                                    };
                                }
                            }
                            return { x: newX, y: newY, constrained: false };
                        };

                        const c1 = constrainToHost(origP1, newP1x, newP1y, p1Id);
                        const c2 = constrainToHost(origP2, newP2x, newP2y, p2Id);
                        newP1x = c1.x; newP1y = c1.y;
                        newP2x = c2.x; newP2y = c2.y;
                    }

                    p1.x = newP1x; p1.y = newP1y;
                    p2.x = newP2x; p2.y = newP2y;
                    dimensionLineRef.current = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
                }
                requestRender();
            } else if (type === 'wall_body') {
                // Move entire wall body — constrained to host walls if inner wall
                const dx = snapToGrid(wx - startX);
                const dy = snapToGrid(wy - startY);
                const { origP1, origP2, p1Id, p2Id } = dragStartRef.current;
                const p1 = getPoint(activeStorey, p1Id);
                const p2 = getPoint(activeStorey, p2Id);
                if (p1 && p2) {
                    const draggedWall = activeStorey.walls.find(w => w.id === id);

                    if (draggedWall && draggedWall.type !== 'outer') {
                        // For inner walls, constrain each endpoint to slide along its host wall
                        const constrainToHost = (origPt, moveX, moveY) => {
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

                        const c1 = constrainToHost(origP1, dx, dy);
                        const c2 = constrainToHost(origP2, dx, dy);
                        p1.x = c1.x; p1.y = c1.y;
                        p2.x = c2.x; p2.y = c2.y;
                    } else {
                        // Outer walls: free movement
                        p1.x = origP1.x + dx;
                        p1.y = origP1.y + dy;
                        p2.x = origP2.x + dx;
                        p2.y = origP2.y + dy;
                    }
                    dimensionLineRef.current = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
                }
                requestRender();
            } else if (type === 'slab_corner') {
                const { slabId, cornerIdx, origX, origY } = dragStartRef.current;
                const slab = (activeStorey.slabs || []).find(s => s.id === slabId);
                if (slab && slab.polygon[cornerIdx]) {
                    const dx = snapToGrid(wx - startX);
                    const dy = snapToGrid(wy - startY);
                    slab.polygon[cornerIdx].x = origX + dx;
                    slab.polygon[cornerIdx].y = origY + dy;
                }
                requestRender();
            } else if (type === 'room_label') {
                // Drag room label to reposition it
                const dx = wx - startX;
                const dy = wy - startY;
                const room = activeStorey.rooms.find(r => r.id === dragStartRef.current.roomId);
                if (room) {
                    room.labelOffsetX = dragStartRef.current.origOffsetX + dx;
                    room.labelOffsetY = dragStartRef.current.origOffsetY + dy;
                }
                requestRender();
            } else if (type === 'annotation_drag') {
                const dx = wx - startX;
                const dy = wy - startY;
                const ann = (activeStorey.annotations || []).find(a => a.id === dragStartRef.current.annId);
                if (ann) {
                    if (dragStartRef.current.annType === 'text') {
                        ann.x = dragStartRef.current.origX + dx;
                        ann.y = dragStartRef.current.origY + dy;
                    } else if (dragStartRef.current.annType === 'circle') {
                        ann.cx = dragStartRef.current.origCx + dx;
                        ann.cy = dragStartRef.current.origCy + dy;
                    } else if (dragStartRef.current.origPoints) {
                        for (let i = 0; i < ann.points.length; i++) {
                            ann.points[i].x = dragStartRef.current.origPoints[i].x + dx;
                            ann.points[i].y = dragStartRef.current.origPoints[i].y + dy;
                        }
                    }
                }
                requestRender();
            } else if (type === 'annotation_point') {
                // Drag individual point of polyline/area
                const ann = (activeStorey.annotations || []).find(a => a.id === dragStartRef.current.annId);
                if (ann && ann.points && ann.points[dragStartRef.current.pointIdx]) {
                    ann.points[dragStartRef.current.pointIdx].x = dragStartRef.current.origX + (wx - startX);
                    ann.points[dragStartRef.current.pointIdx].y = dragStartRef.current.origY + (wy - startY);
                }
                requestRender();
            } else if (type === 'annotation_resize_circle') {
                // Resize circle radius
                const ann = (activeStorey.annotations || []).find(a => a.id === dragStartRef.current.annId);
                if (ann) {
                    const newRadius = dist({ x: wx, y: wy }, { x: ann.cx, y: ann.cy });
                    if (newRadius > 5) ann.radius = newRadius;
                }
                requestRender();
            } else if (type === 'multi') {
                const dx = snapToGrid(wx - startX);
                const dy = snapToGrid(wy - startY);
                const { origPositions, items } = dragStartRef.current;
                const movedPoints = new Set();
                for (const item of items) {
                    if (item.type === 'wall') {
                        const w = activeStorey.walls.find(w => w.id === item.id);
                        if (!w) continue;
                        for (const ptId of [w.p1, w.p2]) {
                            if (movedPoints.has(ptId)) continue;
                            const orig = origPositions[ptId];
                            const pt = getPoint(activeStorey, ptId);
                            if (orig && pt) {
                                pt.x = orig.x + dx;
                                pt.y = orig.y + dy;
                                movedPoints.add(ptId);
                            }
                        }
                    } else if (item.type === 'furniture') {
                        const f = activeStorey.furniture.find(f => f.id === item.id);
                        const orig = origPositions[item.id];
                        if (f && orig) {
                            f.x = orig.x + dx;
                            f.y = orig.y + dy;
                        }
                    }
                }
                requestRender();
            }
            return;
        }

        const world = screenToWorld(vpRef.current, sx, sy);
        mouseWorldRef.current = { x: world.x, y: world.y };

        // Preview
        if (activeTool === TOOLS.OUTER_WALL && drawPoints.length > 0) {
            const lastPtId = drawPoints[drawPoints.length - 1];
            const lastPt = getPoint(activeStorey, lastPtId);
            if (lastPt) {
                const snapped = snapAngle(lastPt.x, lastPt.y, snapToGrid(world.x), snapToGrid(world.y));

                // Find the real start of the entire wall chain (trace backward through existing walls)
                let chainStartId = drawPoints[0];
                const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                for (let i = 0; i < outerWalls.length; i++) {
                    const prev = outerWalls.find(w => w.p2 === chainStartId || w.p1 === chainStartId);
                    if (prev) {
                        const otherEnd = prev.p1 === chainStartId ? prev.p2 : prev.p1;
                        // Only trace back if this wall is not in our current drawPoints
                        if (!drawPoints.includes(otherEnd)) {
                            chainStartId = otherEnd;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                const chainStartPt = getPoint(activeStorey, chainStartId);

                // Check close to chain start (needs at least 3 walls total to close)
                const totalWallsInChain = drawPoints.length; // walls drawn in this session
                const existingConnectedWalls = outerWalls.filter(w => {
                    // Count walls not created by current drawPoints
                    const inDraw = drawPoints.some((dp, idx) => idx < drawPoints.length - 1 &&
                        ((dp === w.p1 && drawPoints[idx + 1] === w.p2) || (dp === w.p2 && drawPoints[idx + 1] === w.p1)));
                    return !inDraw;
                }).length;
                const canClose = (totalWallsInChain + existingConnectedWalls) >= 3;

                if (canClose && chainStartPt && dist(snapped, chainStartPt) < 30 / vpRef.current.zoom) {
                    previewRef.current = {
                        type: 'close_indicator',
                        x: chainStartPt.x, y: chainStartPt.y,
                        x1: lastPt.x, y1: lastPt.y,
                    };
                    snapPointRef.current = { ...chainStartPt, id: chainStartId };
                    requestRender();
                    return;
                }

                // Alignment snap: snap to same X/Y as existing wall endpoints
                const alignThreshold = 15; // mm
                let alignX = snapped.x, alignY = snapped.y;
                for (const pt of activeStorey.points) {
                    if (drawPoints.includes(pt.id) && pt.id === drawPoints[drawPoints.length - 1]) continue;
                    if (Math.abs(pt.y - snapped.y) < alignThreshold) {
                        alignY = pt.y; // snap Y to align horizontally
                    }
                    if (Math.abs(pt.x - snapped.x) < alignThreshold) {
                        alignX = pt.x; // snap X to align vertically
                    }
                }

                previewRef.current = {
                    type: 'wall_segment',
                    x1: lastPt.x, y1: lastPt.y,
                    x2: alignX, y2: alignY,
                    wallType: 'outer',
                };
                // Add previous point for angle display
                if (drawPoints.length >= 2) {
                    const prevPt = getPoint(activeStorey, drawPoints[drawPoints.length - 2]);
                    if (prevPt) {
                        previewRef.current.prevX = prevPt.x;
                        previewRef.current.prevY = prevPt.y;
                    }
                }
                // Enhanced snap: check all wall endpoints AND wall edges
                let bestSnap = findSnapPoint(alignX, alignY, activeStorey.points, [lastPtId]);
                // Also snap to wall edges (closest point on any wall segment)
                if (!bestSnap) {
                    let bestEdgeDist = 20 / vpRef.current.zoom;
                    for (const w of activeStorey.walls) {
                        const wp1 = getPoint(activeStorey, w.p1);
                        const wp2 = getPoint(activeStorey, w.p2);
                        if (!wp1 || !wp2) continue;
                        const segRes = pointToSegmentDist(alignX, alignY, wp1.x, wp1.y, wp2.x, wp2.y);
                        if (segRes.dist < bestEdgeDist) {
                            bestEdgeDist = segRes.dist;
                            bestSnap = { x: snapToGrid(segRes.cx), y: snapToGrid(segRes.cy), wallP1: { x: wp1.x, y: wp1.y }, wallP2: { x: wp2.x, y: wp2.y } };
                        }
                    }
                }
                if (bestSnap) {
                    previewRef.current.x2 = bestSnap.x;
                    previewRef.current.y2 = bestSnap.y;
                }
                snapPointRef.current = bestSnap;
            }
            requestRender();
        } else if (activeTool === TOOLS.OUTER_WALL && drawPoints.length === 0) {
            // Before first point: show snap to existing outer wall endpoints
            const gx = snapToGrid(world.x), gy = snapToGrid(world.y);
            const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
            if (outerWalls.length > 0) {
                // Find outer wall endpoints that are chain ends (only connected to one wall)
                const ptUsage = {};
                for (const w of outerWalls) {
                    ptUsage[w.p1] = (ptUsage[w.p1] || 0) + 1;
                    ptUsage[w.p2] = (ptUsage[w.p2] || 0) + 1;
                }
                // Chain endpoints are those used by exactly one wall
                const chainEndpoints = Object.entries(ptUsage)
                    .filter(([, count]) => count === 1)
                    .map(([id]) => activeStorey.points.find(p => p.id === id))
                    .filter(Boolean);

                let bestSnap = null;
                let bestDist = 30 / vpRef.current.zoom;
                for (const pt of chainEndpoints) {
                    const d = dist({ x: gx, y: gy }, pt);
                    if (d < bestDist) {
                        bestDist = d;
                        bestSnap = { x: pt.x, y: pt.y, id: pt.id };
                    }
                }
                snapPointRef.current = bestSnap;
                hoverPointRef.current = bestSnap ? { x: bestSnap.x, y: bestSnap.y } : null;
            }
            requestRender();
        } else if (activeTool === TOOLS.INNER_WALL && drawPoints.length === 1) {
            const lastPtId = drawPoints[0];
            const lastPt = getPoint(activeStorey, lastPtId);
            if (lastPt) {
                const snapped = snapAngle(lastPt.x, lastPt.y, snapToGrid(world.x), snapToGrid(world.y));

                // Alignment snap for inner walls too
                const alignThreshold = 15;
                let endX = snapped.x, endY = snapped.y;
                for (const pt of activeStorey.points) {
                    if (pt.id === lastPtId) continue;
                    if (Math.abs(pt.y - snapped.y) < alignThreshold) endY = pt.y;
                    if (Math.abs(pt.x - snapped.x) < alignThreshold) endX = pt.x;
                }

                let snapFound = null;
                let bestDist = 20 / vpRef.current.zoom;

                // 1. Snap to ALL wall endpoints (outer + inner)
                const ptSnap = findSnapPoint(snapped.x, snapped.y, activeStorey.points, [lastPtId]);
                if (ptSnap) {
                    const d = dist({ x: snapped.x, y: snapped.y }, ptSnap);
                    if (d < bestDist) {
                        bestDist = d;
                        endX = ptSnap.x; endY = ptSnap.y;
                        snapFound = ptSnap;
                    }
                }

                // 2. Snap to outer polygon vertices (inner edge of outer walls)
                if (activeStorey.outerPolygon && activeStorey.outerPolygon.length > 0) {
                    for (const ip of activeStorey.outerPolygon) {
                        const d = dist({ x: snapped.x, y: snapped.y }, ip);
                        if (d < bestDist) {
                            bestDist = d;
                            endX = ip.x; endY = ip.y;
                            snapFound = ip;
                        }
                    }
                    // Snap to inner edge line segments — include wall info for measurement display
                    for (let i = 0; i < activeStorey.outerPolygon.length; i++) {
                        const a = activeStorey.outerPolygon[i];
                        const b = activeStorey.outerPolygon[(i + 1) % activeStorey.outerPolygon.length];
                        const segRes = pointToSegmentDist(snapped.x, snapped.y, a.x, a.y, b.x, b.y);
                        if (segRes.dist < bestDist) {
                            bestDist = segRes.dist;
                            endX = snapToGrid(segRes.cx); endY = snapToGrid(segRes.cy);
                            // Find the corresponding outer wall for this polygon edge
                            let closestWallId = null;
                            let closestWallDist = Infinity;
                            for (const ow of activeStorey.walls.filter(w => w.type === 'outer')) {
                                const owp1 = getPoint(activeStorey, ow.p1);
                                const owp2 = getPoint(activeStorey, ow.p2);
                                if (!owp1 || !owp2) continue;
                                const d = pointToSegmentDist(endX, endY, owp1.x, owp1.y, owp2.x, owp2.y);
                                if (d.dist < closestWallDist) {
                                    closestWallDist = d.dist;
                                    closestWallId = ow.id;
                                }
                            }
                            snapFound = { x: endX, y: endY, wallP1: { x: a.x, y: a.y }, wallP2: { x: b.x, y: b.y }, snapWallId: closestWallId };
                        }
                    }
                }

                // 3. Snap to ALL wall edges (inner walls too) — both surfaces
                for (const w of activeStorey.walls) {
                    const wp1 = getPoint(activeStorey, w.p1);
                    const wp2 = getPoint(activeStorey, w.p2);
                    if (!wp1 || !wp2) continue;

                    // Reference edge
                    const segRes = pointToSegmentDist(snapped.x, snapped.y, wp1.x, wp1.y, wp2.x, wp2.y);
                    if (segRes.dist < bestDist) {
                        bestDist = segRes.dist;
                        endX = snapToGrid(segRes.cx); endY = snapToGrid(segRes.cy);
                        snapFound = { x: endX, y: endY, wallP1: { x: wp1.x, y: wp1.y }, wallP2: { x: wp2.x, y: wp2.y }, snapWallId: w.id };
                    }

                    // Opposite edge (outer surface)
                    const poly = getWallPolygon(w, activeStorey);
                    if (poly && poly.length >= 4) {
                        let outerP1, outerP2;
                        if (w.type === 'outer') {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        } else if (w.ref_edge === 'left') {
                            outerP1 = poly[2]; outerP2 = poly[3];
                        } else {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        }
                        const segRes2 = pointToSegmentDist(snapped.x, snapped.y, outerP1.x, outerP1.y, outerP2.x, outerP2.y);
                        if (segRes2.dist < bestDist) {
                            bestDist = segRes2.dist;
                            endX = snapToGrid(segRes2.cx); endY = snapToGrid(segRes2.cy);
                            snapFound = { x: endX, y: endY, wallP1: { x: outerP1.x, y: outerP1.y }, wallP2: { x: outerP2.x, y: outerP2.y }, snapWallId: w.id };
                        }
                    }
                }

                previewRef.current = {
                    type: 'wall_segment',
                    x1: lastPt.x, y1: lastPt.y,
                    x2: endX, y2: endY,
                    wallType: 'inner',
                };
                snapPointRef.current = snapFound;
            }
            requestRender();
        } else if ((activeTool === TOOLS.DOOR || activeTool === TOOLS.WINDOW) && activeStorey.walls.length > 0) {
            const wx = snapToGrid(world.x);
            const wy = snapToGrid(world.y);
            const hit = findWallAtPoint(activeStorey, wx, wy, 50 / vpRef.current.zoom);
            if (hit) {
                const pt1 = getPoint(activeStorey, hit.wall.p1);
                const pt2 = getPoint(activeStorey, hit.wall.p2);
                if (pt1 && pt2) {
                    const wallLen = dist(pt1, pt2);
                    const pos = hit.t * wallLen;
                    const openingKey = activeTool === TOOLS.DOOR ? 'door' : 'window';
                    const preset = nextOpeningPreset[openingKey];
                    const width = preset.width;
                    const height = preset.height;
                    const sill = preset.sill || 0;
                    const halfW = width / 2;
                    // Clamp to valid range
                    const clampedPos = Math.max(halfW + 50, Math.min(wallLen - halfW - 50, pos));
                    const dx = (pt2.x - pt1.x) / wallLen;
                    const dy = (pt2.y - pt1.y) / wallLen;
                    previewRef.current = {
                        type: 'opening_ghost',
                        x1: pt1.x + dx * (clampedPos - halfW),
                        y1: pt1.y + dy * (clampedPos - halfW),
                        x2: pt1.x + dx * (clampedPos + halfW),
                        y2: pt1.y + dy * (clampedPos + halfW),
                        openingType: activeTool === TOOLS.DOOR ? 'door' : 'window',
                        wallP1: { x: pt1.x, y: pt1.y },
                        wallP2: { x: pt2.x, y: pt2.y },
                        position_mm: clampedPos,
                        width_mm: width,
                        wall_len: wallLen,
                        thickness: hit.wall.thickness_mm,
                        wallType: hit.wall.type,
                        refEdge: hit.wall.ref_edge,
                    };
                }
            } else {
                previewRef.current = null;
            }
            requestRender();
        } else if (activeTool === TOOLS.FURNITURE && placingFurniture) {
            const wx = snapToGrid(world.x);
            const wy = snapToGrid(world.y);
            previewRef.current = {
                type: 'furniture_ghost',
                x: wx - placingFurniture.defaultWidth / 2,
                y: wy - placingFurniture.defaultDepth / 2,
                width: placingFurniture.defaultWidth,
                depth: placingFurniture.defaultDepth,
                rotation: 0,
                catalogId: placingFurniture.id,
            };
            requestRender();
        } else if (activeTool === TOOLS.SLAB && drawPoints.length > 0) {
            const lastPt = drawPoints[drawPoints.length - 1];
            let endX = snapToGrid(world.x), endY = snapToGrid(world.y);
            const snapped = snapAngle(lastPt.x, lastPt.y, endX, endY);
            endX = snapped.x; endY = snapped.y;

            // Snap to wall endpoints and outer wall edges
            let snapFound = null;
            const snapRadius = 20 / vpRef.current.zoom;
            // Collect all snap-able points: wall endpoints + outer boundary + outer polygon
            const snapTargets = [...activeStorey.points];
            if (activeStorey.outerBoundary) snapTargets.push(...activeStorey.outerBoundary);
            if (activeStorey.outerPolygon) snapTargets.push(...activeStorey.outerPolygon);
            for (const pt of snapTargets) {
                const d = dist({ x: endX, y: endY }, pt);
                if (d < snapRadius) {
                    endX = pt.x; endY = pt.y;
                    snapFound = { x: pt.x, y: pt.y };
                    break;
                }
            }

            // Check if hovering near start point (close indicator)
            if (drawPoints.length >= 3) {
                const startPt = drawPoints[0];
                if (dist({ x: endX, y: endY }, startPt) < 30 / vpRef.current.zoom) {
                    previewRef.current = {
                        type: 'slab_close_indicator',
                        x: startPt.x, y: startPt.y,
                        x1: lastPt.x, y1: lastPt.y,
                        polygon: drawPoints,
                    };
                    snapPointRef.current = startPt;
                    requestRender();
                    return;
                }
            }

            previewRef.current = {
                type: 'slab_segment',
                x1: lastPt.x, y1: lastPt.y,
                x2: endX, y2: endY,
                polygon: drawPoints,
            };
            snapPointRef.current = snapFound;
            requestRender();
        } else if ((activeTool === TOOLS.ANNOTATE_POLYLINE || activeTool === TOOLS.ANNOTATE_AREA) && annotationPoints.length > 0) {
            // Preview line from last annotation point to cursor
            const lastPt = annotationPoints[annotationPoints.length - 1];
            let ax = snapToGrid(world.x), ay = snapToGrid(world.y);
            const snapResult = findSnapPoint(ax, ay, activeStorey.points, []);
            if (snapResult) { ax = snapResult.x; ay = snapResult.y; }
            previewRef.current = {
                type: 'annotation_line',
                points: annotationPoints,
                x2: ax, y2: ay,
                color: annotationColor,
                lineWidth: annotationLineWidth,
                closed: activeTool === TOOLS.ANNOTATE_AREA,
            };
            snapPointRef.current = snapResult;
            requestRender();
        } else if (activeTool === TOOLS.ANNOTATE_CIRCLE && annotationCircleCenter) {
            // Preview circle radius
            let ax = snapToGrid(world.x), ay = snapToGrid(world.y);
            const snapResult = findSnapPoint(ax, ay, activeStorey.points, []);
            if (snapResult) { ax = snapResult.x; ay = snapResult.y; }
            const radius = dist(annotationCircleCenter, { x: ax, y: ay });
            previewRef.current = {
                type: 'annotation_circle',
                cx: annotationCircleCenter.x, cy: annotationCircleCenter.y,
                radius, color: annotationColor, lineWidth: annotationLineWidth,
            };
            snapPointRef.current = snapResult;
            requestRender();
        } else {
            previewRef.current = null;
            snapPointRef.current = null;

            // In SELECT mode: detect wall corner hover + element hover + update marquee
            if (activeTool === TOOLS.SELECT) {
                // Corner hover: find nearest wall endpoint
                const hoverRadius = 15 / vpRef.current.zoom;
                let nearestPt = null;
                let nearestDist = hoverRadius;
                for (const wall of activeStorey.walls) {
                    for (const ptId of [wall.p1, wall.p2]) {
                        const pt = getPoint(activeStorey, ptId);
                        if (!pt) continue;
                        const d = dist({ x: world.x, y: world.y }, pt);
                        if (d < nearestDist) {
                            nearestDist = d;
                            nearestPt = pt;
                        }
                    }
                }
                hoverPointRef.current = nearestPt;

                // Element hover detection (wall, furniture, opening)
                let newHoverId = null;
                const hitWall = findWallAtPoint(activeStorey, world.x, world.y, 20 / vpRef.current.zoom);
                if (hitWall) {
                    newHoverId = hitWall.wall.id;
                } else {
                    const hitFurn = findFurnitureAtPoint(activeStorey, world.x, world.y, 20 / vpRef.current.zoom);
                    if (hitFurn) {
                        newHoverId = hitFurn.id;
                    } else {
                        const hitOpen = findOpeningAtPoint(activeStorey, world.x, world.y, 20 / vpRef.current.zoom);
                        if (hitOpen) newHoverId = hitOpen.id;
                    }
                }
                if (hoverIdRef.current !== newHoverId) {
                    hoverIdRef.current = newHoverId;
                    // Change cursor to indicate clickable element
                    if (canvasRef.current) {
                        canvasRef.current.style.cursor = newHoverId ? 'pointer' : '';
                    }
                    requestRender();
                }

                // Marquee drag update with live selection preview
                if (marqueeRef.current && marqueeRef.current.dragging) {
                    marqueeRef.current.sx2 = sx;
                    marqueeRef.current.sy2 = sy;

                    // Compute live preview of elements that would be selected
                    const vp = vpRef.current;
                    const w1m = screenToWorld(vp, Math.min(marqueeRef.current.sx1, sx), Math.min(marqueeRef.current.sy1, sy));
                    const w2m = screenToWorld(vp, Math.max(marqueeRef.current.sx1, sx), Math.max(marqueeRef.current.sy1, sy));
                    const minX = Math.min(w1m.x, w2m.x), maxX = Math.max(w1m.x, w2m.x);
                    const minY = Math.min(w1m.y, w2m.y), maxY = Math.max(w1m.y, w2m.y);

                    const preselected = new Set();
                    for (const w of activeStorey.walls) {
                        const p1w = getPoint(activeStorey, w.p1);
                        const p2w = getPoint(activeStorey, w.p2);
                        if (!p1w || !p2w) continue;
                        const p1In = p1w.x >= minX && p1w.x <= maxX && p1w.y >= minY && p1w.y <= maxY;
                        const p2In = p2w.x >= minX && p2w.x <= maxX && p2w.y >= minY && p2w.y <= maxY;
                        if (p1In || p2In) {
                            preselected.add(w.id);
                            // Also add openings on this wall
                            for (const op of activeStorey.openings) {
                                if (op.wallId === w.id || op.wall_id === w.id) preselected.add(op.id);
                            }
                        }
                    }
                    for (const f of activeStorey.furniture) {
                        const fw = (f.width_mm || 500) / 2;
                        const fh = (f.depth_mm || 500) / 2;
                        if (f.x + fw >= minX && f.x - fw <= maxX && f.y + fh >= minY && f.y - fh <= maxY) {
                            preselected.add(f.id);
                        }
                    }
                    marqueeRef.current.preselected = preselected;
                }
            } else if ((activeTool === TOOLS.INNER_WALL && drawPoints.length === 0) ||
                (activeTool === TOOLS.OUTER_WALL && drawPoints.length === 0)) {
                // Show snap indicator before first click
                const gx = snapToGrid(world.x), gy = snapToGrid(world.y);
                let bestDist = 20 / vpRef.current.zoom;
                let snap = null;

                // Snap to wall endpoints
                for (const pt of activeStorey.points) {
                    const d = dist({ x: gx, y: gy }, pt);
                    if (d < bestDist) {
                        bestDist = d;
                        snap = pt;
                    }
                }
                // Snap to outer polygon vertices
                if (activeStorey.outerPolygon) {
                    for (const ip of activeStorey.outerPolygon) {
                        const d = dist({ x: gx, y: gy }, ip);
                        if (d < bestDist) {
                            bestDist = d;
                            snap = ip;
                        }
                    }
                    // Snap to outer polygon edges
                    for (let i = 0; i < activeStorey.outerPolygon.length; i++) {
                        const a = activeStorey.outerPolygon[i];
                        const b = activeStorey.outerPolygon[(i + 1) % activeStorey.outerPolygon.length];
                        const segRes = pointToSegmentDist(gx, gy, a.x, a.y, b.x, b.y);
                        if (segRes.dist < bestDist) {
                            bestDist = segRes.dist;
                            // Find the corresponding outer wall
                            let closestWallId = null;
                            let closestWallDist = Infinity;
                            for (const ow of activeStorey.walls.filter(w => w.type === 'outer')) {
                                const owp1 = getPoint(activeStorey, ow.p1);
                                const owp2 = getPoint(activeStorey, ow.p2);
                                if (!owp1 || !owp2) continue;
                                const d = pointToSegmentDist(segRes.cx, segRes.cy, owp1.x, owp1.y, owp2.x, owp2.y);
                                if (d.dist < closestWallDist) {
                                    closestWallDist = d.dist;
                                    closestWallId = ow.id;
                                }
                            }
                            snap = { x: snapToGrid(segRes.cx), y: snapToGrid(segRes.cy), wallP1: { x: a.x, y: a.y }, wallP2: { x: b.x, y: b.y }, snapWallId: closestWallId };
                        }
                    }
                }
                // Snap to wall edges (both inner and outer surfaces)
                for (const w of activeStorey.walls) {
                    const wp1 = getPoint(activeStorey, w.p1);
                    const wp2 = getPoint(activeStorey, w.p2);
                    if (!wp1 || !wp2) continue;

                    // Reference edge (p1→p2)
                    const segRes = pointToSegmentDist(gx, gy, wp1.x, wp1.y, wp2.x, wp2.y);
                    if (segRes.dist < bestDist) {
                        bestDist = segRes.dist;
                        snap = { x: snapToGrid(segRes.cx), y: snapToGrid(segRes.cy), wallP1: { x: wp1.x, y: wp1.y }, wallP2: { x: wp2.x, y: wp2.y }, snapWallId: w.id };
                    }

                    // Opposite edge (outer surface of wall)
                    const poly = getWallPolygon(w, activeStorey);
                    if (poly && poly.length >= 4) {
                        // poly = [p1_left, p2_left, p2_right, p1_right]
                        // For outer walls: indices 0,1 are the outer edge
                        // For inner walls (ref_edge=right): indices 0,1 are the outer edge
                        // For inner walls (ref_edge=left): indices 2,3 (reversed) are the outer edge
                        let outerP1, outerP2;
                        if (w.type === 'outer') {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        } else if (w.ref_edge === 'left') {
                            outerP1 = poly[2]; outerP2 = poly[3];
                        } else {
                            outerP1 = poly[0]; outerP2 = poly[1];
                        }
                        const segRes2 = pointToSegmentDist(gx, gy, outerP1.x, outerP1.y, outerP2.x, outerP2.y);
                        if (segRes2.dist < bestDist) {
                            bestDist = segRes2.dist;
                            snap = { x: snapToGrid(segRes2.cx), y: snapToGrid(segRes2.cy), wallP1: { x: outerP1.x, y: outerP1.y }, wallP2: { x: outerP2.x, y: outerP2.y }, snapWallId: w.id };
                        }
                    }
                }
                snapPointRef.current = snap;
                hoverPointRef.current = null;
            } else {
                hoverPointRef.current = null;
            }

            requestRender();
        }
    }, [activeTool, drawPoints, activeStorey, placingFurniture, nextOpeningPreset]);

    const handleMouseUp = useCallback((e) => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            return;
        }
        if (dragStartRef.current) {
            const { type } = dragStartRef.current;
            if (type === 'furniture' || type === 'corner' || type === 'wall_perp' || type === 'wall_body' || type === 'multi' || type === 'opening' || type === 'slab_corner' || type === 'room_label' || type === 'annotation_drag' || type === 'annotation_point' || type === 'annotation_resize_circle') {
                // Recompute rooms and inner polygon after wall geometry changes
                if (type === 'corner' || type === 'wall_perp' || type === 'wall_body' || type === 'multi') {
                    // Recompute both boundaries for outer walls
                    if (activeStorey.outerClosed) {
                        const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                        if (outerWalls.length >= 3) {
                            const pts = buildOrderedPolygon(outerWalls, activeStorey.points);
                            if (pts && pts.length >= 3) {
                                const cwPoly = ensureCW(pts);
                                const thickness = outerWalls[0].thickness_mm;
                                activeStorey.outerPolygon = [...cwPoly];
                                activeStorey.outerBoundary = offsetPolygon(cwPoly, -thickness);
                            }
                        }
                    }
                }
                computeRooms(activeStorey);
                markDirty();
                forceRender(v => v + 1);
            }
            dragStartRef.current = null;
            dragHandleRef.current = null;
            dimensionLineRef.current = null;
            requestRender();
        }

        // Finalize marquee selection
        if (marqueeRef.current && marqueeRef.current.dragging) {
            const m = marqueeRef.current;
            const dragDist = Math.sqrt((m.sx2 - m.sx1) ** 2 + (m.sy2 - m.sy1) ** 2);

            if (dragDist < 5) {
                // Tiny drag = simple deselect click
                setSelectedId(null);
                setSelectedType(null);
                setSelectedIds([]);
            } else {
                // Convert screen rectangle to world coords for hit detection
                const vp = vpRef.current;
                const w1 = screenToWorld(vp, Math.min(m.sx1, m.sx2), Math.min(m.sy1, m.sy2));
                const w2 = screenToWorld(vp, Math.max(m.sx1, m.sx2), Math.max(m.sy1, m.sy2));
                const minX = Math.min(w1.x, w2.x), maxX = Math.max(w1.x, w2.x);
                const minY = Math.min(w1.y, w2.y), maxY = Math.max(w1.y, w2.y);

                // Collect ALL elements inside the marquee
                const selected = [];

                // Walls: select if ANY endpoint overlaps the marquee (partial selection)
                for (const wall of activeStorey.walls) {
                    const p1 = getPoint(activeStorey, wall.p1);
                    const p2 = getPoint(activeStorey, wall.p2);
                    if (!p1 || !p2) continue;
                    const p1Inside = p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY;
                    const p2Inside = p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY;
                    if (p1Inside || p2Inside) {
                        selected.push({ id: wall.id, type: 'wall' });
                    }
                }

                // Openings on selected walls or inside marquee
                for (const opening of activeStorey.openings) {
                    const wall = activeStorey.walls.find(w => w.id === opening.wallId);
                    if (wall && selected.some(s => s.id === wall.id)) {
                        selected.push({ id: opening.id, type: 'opening' });
                    }
                }

                // Furniture: select if center or any corner is inside marquee
                for (const furn of activeStorey.furniture) {
                    const fw = (furn.width_mm || 500) / 2;
                    const fh = (furn.depth_mm || 500) / 2;
                    const fMinX = furn.x - fw, fMaxX = furn.x + fw;
                    const fMinY = furn.y - fh, fMaxY = furn.y + fh;
                    // Check if bounding boxes overlap
                    if (fMaxX >= minX && fMinX <= maxX && fMaxY >= minY && fMinY <= maxY) {
                        selected.push({ id: furn.id, type: 'furniture' });
                    }
                }

                if (selected.length > 0) {
                    setSelectedId(selected[0].id);
                    setSelectedType(selected[0].type);
                    setSelectedIds(selected);
                } else {
                    setSelectedId(null);
                    setSelectedType(null);
                    setSelectedIds([]);
                }
            }
            marqueeRef.current = null;
            requestRender();
        }
    }, [activeStorey, markDirty, requestRender]);

    const handleWheel = useCallback((e) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();

        if (e.ctrlKey) {
            // Ctrl + Wheel = Zoom
            zoomAtPoint(vpRef.current, e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
        } else {
            // Normal scroll = Pan
            const vp = vpRef.current;
            vp.offsetX -= e.deltaX || (e.shiftKey ? e.deltaY : 0);
            vp.offsetY -= e.shiftKey ? 0 : e.deltaY;
        }
        requestRender();
    }, [requestRender]);

    // ─── Tool Click Handlers ────────────────────────────────────

    const handleOuterWallClick = (wx, wy) => {

        // Apply active snap point if available
        let clickX = wx, clickY = wy;
        if (snapPointRef.current) {
            clickX = snapPointRef.current.x;
            clickY = snapPointRef.current.y;
        }

        // Find the real start of the entire wall chain (trace backward through existing walls)
        const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
        let chainStartId = drawPoints.length > 0 ? drawPoints[0] : null;
        if (chainStartId) {
            for (let i = 0; i < outerWalls.length; i++) {
                const prev = outerWalls.find(w => w.p2 === chainStartId || w.p1 === chainStartId);
                if (prev) {
                    const otherEnd = prev.p1 === chainStartId ? prev.p2 : prev.p1;
                    if (!drawPoints.includes(otherEnd)) {
                        chainStartId = otherEnd;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
        const chainStartPt = chainStartId ? getPoint(activeStorey, chainStartId) : null;

        // Check if clicking near chain start → close polygon
        if (drawPoints.length >= 1 && chainStartPt) {
            // Count total walls: existing connected ones + walls from drawPoints
            const totalWalls = outerWalls.length + (drawPoints.length > 0 ? 1 : 0); // +1 for the closing wall
            if (totalWalls >= 3 && dist({ x: clickX, y: clickY }, chainStartPt) < 30 / vpRef.current.zoom) {
                // Close polygon
                const lastPtId = drawPoints[drawPoints.length - 1];

                const storeyCopy = JSON.parse(JSON.stringify(activeStorey));
                addOuterWallSegment(activeStorey, lastPtId, chainStartId, outerWallThickness);
                closeOuterWalls(activeStorey);
                computeRooms(activeStorey);

                cmdStackRef.current.execute({
                    do: () => { /* already done */ },
                    undo: () => {
                        const idx = storeys.indexOf(activeStorey);
                        if (idx >= 0) {
                            Object.assign(activeStorey, storeyCopy);
                        }
                        forceRender(v => v + 1);
                    },
                    label: 'Außenwand schließen',
                });

                setDrawPoints([]);
                previewRef.current = null;
                snapPointRef.current = null;
                markDirty();
                forceRender(v => v + 1);
                return;
            }
        }

        // If snapping to an existing point, reuse it instead of creating a new one
        let pt;
        const existingSnap = snapPointRef.current && snapPointRef.current.id
            ? activeStorey.points.find(p => p.id === snapPointRef.current.id)
            : null;
        if (existingSnap) {
            pt = existingSnap;
        } else {
            pt = addPoint(activeStorey, clickX, clickY);
        }

        if (drawPoints.length > 0) {
            const lastPtId = drawPoints[drawPoints.length - 1];
            const lastPt = getPoint(activeStorey, lastPtId);
            if (lastPt && !existingSnap) {
                // Only snap angle if very close to axis alignment (within 2°)
                const dx = pt.x - lastPt.x, dy = pt.y - lastPt.y;
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                const nearAxis = [0, 90, 180, -90, -180].some(a => Math.abs(((angle - a + 180) % 360) - 180) < 2);
                if (nearAxis) {
                    const snapped = snapAngle(lastPt.x, lastPt.y, pt.x, pt.y);
                    pt.x = snapped.x;
                    pt.y = snapped.y;
                }
            }
            const wall = addOuterWallSegment(activeStorey, lastPtId, pt.id, outerWallThickness);
            if (!wall) return; // too short
        }
        setDrawPoints([...drawPoints, pt.id]);
        forceRender(v => v + 1);
        requestRender(); // Immediate canvas refresh
    };

    const handleInnerWallClick = (wx, wy) => {
        if (!activeStorey.outerClosed) return;

        // Apply active snap point if available
        let clickX = wx, clickY = wy;
        if (snapPointRef.current) {
            clickX = snapPointRef.current.x;
            clickY = snapPointRef.current.y;
        }

        // If snapping to an existing point, reuse it
        let pt;
        const existingSnap = snapPointRef.current && snapPointRef.current.id
            ? activeStorey.points.find(p => p.id === snapPointRef.current.id)
            : null;
        if (existingSnap) {
            pt = existingSnap;
        } else if (snapPointRef.current && snapPointRef.current.snapWallId) {
            const hostWall = activeStorey.walls.find(w => w.id === snapPointRef.current.snapWallId);
            if (hostWall && hostWall.type === 'outer') {
                // Outer wall: DON'T split; just create an independent point at the projected position
                // Project click position onto the outer wall's center line
                const wPt1 = getPoint(activeStorey, hostWall.p1);
                const wPt2 = getPoint(activeStorey, hostWall.p2);
                if (wPt1 && wPt2) {
                    const dx = wPt2.x - wPt1.x, dy = wPt2.y - wPt1.y;
                    const wLen = Math.sqrt(dx * dx + dy * dy);
                    if (wLen > 1) {
                        const t = Math.max(0, Math.min(1, ((clickX - wPt1.x) * dx + (clickY - wPt1.y) * dy) / (wLen * wLen)));
                        const px = snapToGrid(wPt1.x + t * dx);
                        const py = snapToGrid(wPt1.y + t * dy);
                        // Check if very close to an endpoint — if so, reuse it
                        const d1 = dist({ x: px, y: py }, wPt1);
                        const d2 = dist({ x: px, y: py }, wPt2);
                        if (d1 < 50) {
                            pt = wPt1;
                        } else if (d2 < 50) {
                            pt = wPt2;
                        } else {
                            // Create new independent point (NOT linked to outer wall)
                            const newPt = { id: genId(), x: px, y: py };
                            activeStorey.points.push(newPt);
                            pt = newPt;
                        }
                    } else {
                        pt = addPoint(activeStorey, clickX, clickY);
                    }
                } else {
                    pt = addPoint(activeStorey, clickX, clickY);
                }
            } else {
                // Inner wall: split for T-junction (as before)
                const splitResult = splitWallAtPoint(activeStorey, snapPointRef.current.snapWallId, clickX, clickY);
                if (splitResult) {
                    pt = splitResult;
                } else {
                    if (hostWall) {
                        const ep1 = getPoint(activeStorey, hostWall.p1);
                        const ep2 = getPoint(activeStorey, hostWall.p2);
                        if (ep1 && ep2) {
                            const d1 = dist({ x: clickX, y: clickY }, ep1);
                            const d2 = dist({ x: clickX, y: clickY }, ep2);
                            pt = d1 < d2 ? ep1 : ep2;
                        } else {
                            pt = addPoint(activeStorey, clickX, clickY);
                        }
                    } else {
                        pt = addPoint(activeStorey, clickX, clickY);
                    }
                }
            }
        } else {
            pt = addPoint(activeStorey, clickX, clickY);
        }

        if (drawPoints.length === 0) {
            // If an inner wall was split, recompute outer boundary
            const hostWall = snapPointRef.current && snapPointRef.current.snapWallId
                ? activeStorey.walls.find(w => w.id === snapPointRef.current.snapWallId)
                : null;
            if (hostWall && hostWall.type !== 'outer' && activeStorey.outerClosed) {
                const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                const orderedPts = buildOrderedPolygon(outerWalls, activeStorey.points);
                if (orderedPts && orderedPts.length >= 3) {
                    const cwPoly = ensureCW(orderedPts);
                    activeStorey.outerPolygon = [...cwPoly];
                    activeStorey.outerBoundary = offsetPolygon(cwPoly, -outerWalls[0].thickness_mm);
                }
            }
            setDrawPoints([pt.id]);
            requestRender();
            return;
        }

        const lastPtId = drawPoints[0];
        const lastPt = getPoint(activeStorey, lastPtId);
        // Only apply angle snap if NOT snapping to an existing point/wall surface
        // AND only for short-distance alignment (not forced)
        const skipAngleSnap = existingSnap || (snapPointRef.current && snapPointRef.current.snapWallId);
        if (lastPt && !skipAngleSnap) {
            // Check if very close to axis alignment (within 2°), only then snap
            const dx = pt.x - lastPt.x, dy = pt.y - lastPt.y;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const nearAxis = [0, 90, 180, -90, -180].some(a => Math.abs(((angle - a + 180) % 360) - 180) < 2);
            if (nearAxis) {
                const snapped = snapAngle(lastPt.x, lastPt.y, pt.x, pt.y);
                pt.x = snapped.x;
                pt.y = snapped.y;
            }
        }

        // Determine side from cursor
        const side = getPointSide(mouseWorldRef.current.x, mouseWorldRef.current.y, lastPt.x, lastPt.y, pt.x, pt.y);

        const storeyCopy = JSON.parse(JSON.stringify(activeStorey));
        const wall = addInnerWallSegment(activeStorey, lastPtId, pt.id, innerWallType, innerWallThickness, side);

        if (wall) {
            // Recompute outer boundary in case a wall was split
            if (activeStorey.outerClosed) {
                const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                const orderedPts = buildOrderedPolygon(outerWalls, activeStorey.points);
                if (orderedPts && orderedPts.length >= 3) {
                    const cwPoly = ensureCW(orderedPts);
                    // Match closeOuterWalls: outerPolygon = inner edge (room boundary)
                    activeStorey.outerPolygon = [...cwPoly];
                    // outerBoundary = outer edge (offset outward)
                    activeStorey.outerBoundary = offsetPolygon(cwPoly, -outerWalls[0].thickness_mm);
                }
            }
            computeRooms(activeStorey);
            cmdStackRef.current.execute({
                do: () => { /* already done */ },
                undo: () => {
                    Object.assign(activeStorey, storeyCopy);
                    forceRender(v => v + 1);
                },
                label: 'Innenwand hinzufügen',
            });
            markDirty();
        }

        setDrawPoints([]);
        setActiveTool(TOOLS.SELECT); // Reset to select mode after drawing
        previewRef.current = null;
        snapPointRef.current = null;
        forceRender(v => v + 1);
        // Immediate canvas refresh — don't wait for React re-render cycle
        requestRender();
    };

    const handleOpeningClick = (wx, wy, type) => {
        const hit = findWallAtPoint(activeStorey, wx, wy, 50 / vpRef.current.zoom);
        if (!hit) return;

        const pt1 = getPoint(activeStorey, hit.wall.p1);
        const pt2 = getPoint(activeStorey, hit.wall.p2);
        if (!pt1 || !pt2) return;

        const wallLen = dist(pt1, pt2);
        const pos = hit.t * wallLen;

        const preset = nextOpeningPreset[type === 'door' ? 'door' : 'window'];
        const opening = placeOpening(activeStorey, hit.wall.id, type, pos, {
            width_mm: preset.width,
            height_mm: preset.height,
            sill_mm: preset.sill || 0,
        });

        if (opening) {
            const storeyCopy = JSON.parse(JSON.stringify(activeStorey));
            cmdStackRef.current.execute({
                do: () => { /* already done */ },
                undo: () => {
                    Object.assign(activeStorey, storeyCopy);
                    forceRender(v => v + 1);
                },
                label: `${type === 'door' ? 'Tür' : 'Fenster'} platzieren`,
            });
            setSelectedId(opening.id);
            setSelectedType('opening');
            markDirty();
            forceRender(v => v + 1);
        }
    };

    const handleFurnitureClick = (wx, wy) => {
        if (!placingFurniture) return;
        const item = placingFurniture;
        // Place with mouse as center of object
        const fx = wx - item.defaultWidth / 2;
        const fy = wy - item.defaultDepth / 2;
        const furn = placeFurniture(activeStorey, item.id, fx, fy, item.defaultWidth, item.defaultDepth, item.defaultHeight, 0);
        if (furn) {
            const storeyCopy = JSON.parse(JSON.stringify(activeStorey));
            cmdStackRef.current.execute({
                do: () => { /* already done */ },
                undo: () => {
                    Object.assign(activeStorey, storeyCopy);
                    forceRender(v => v + 1);
                },
                label: `${item.name} platzieren`,
            });
            setSelectedId(furn.id);
            setSelectedType('furniture');
            markDirty();
            forceRender(v => v + 1);
        }
    };

    const handleDeleteClick = (wx, wy) => {
        const storeyCopy = JSON.parse(JSON.stringify(activeStorey));

        const furn = findFurnitureAtPoint(activeStorey, wx, wy);
        if (furn) { deleteFurniture(activeStorey, furn.id); }
        else {
            const opening = findOpeningAtPoint(activeStorey, wx, wy);
            if (opening) { deleteOpening(activeStorey, opening.id); }
            else {
                const hit = findWallAtPoint(activeStorey, wx, wy, 30 / vpRef.current.zoom);
                if (hit && hit.wall.type !== 'outer') {
                    deleteWall(activeStorey, hit.wall.id);
                } else if (activeStorey.annotations) {
                    // Check annotations for delete
                    for (let i = activeStorey.annotations.length - 1; i >= 0; i--) {
                        const ann = activeStorey.annotations[i];
                        let hitAnn = false;
                        if (ann.type === 'circle') {
                            const d = dist({ x: wx, y: wy }, { x: ann.cx, y: ann.cy });
                            if (Math.abs(d - ann.radius) < 20 / vpRef.current.zoom || d < ann.radius) hitAnn = true;
                        } else if (ann.type === 'text') {
                            if (dist({ x: wx, y: wy }, { x: ann.x, y: ann.y }) < 50 / vpRef.current.zoom) hitAnn = true;
                        } else if ((ann.type === 'polyline' || ann.type === 'area') && ann.points) {
                            for (let j = 0; j < ann.points.length - 1; j++) {
                                const a = ann.points[j], b = ann.points[j + 1];
                                const dx = b.x - a.x, dy = b.y - a.y;
                                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                                const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / (len * len)));
                                const px = a.x + t * dx, py = a.y + t * dy;
                                if (dist({ x: wx, y: wy }, { x: px, y: py }) < 15 / vpRef.current.zoom) { hitAnn = true; break; }
                            }
                        }
                        if (hitAnn) {
                            activeStorey.annotations.splice(i, 1);
                            break;
                        }
                    }
                }
            }
        }

        computeRooms(activeStorey);
        cmdStackRef.current.execute({
            do: () => { },
            undo: () => { Object.assign(activeStorey, storeyCopy); forceRender(v => v + 1); },
            label: 'Löschen',
        });
        markDirty();
        forceRender(v => v + 1);
    };

    const handleSelectClick = (wx, wy, sx, sy) => {
        // If multi-selected items exist, check if click is on one of them → initiate multi-drag
        if (selectedIds.length > 1) {
            // Check if click is on any of the selected items
            const clickedFurn = findFurnitureAtPoint(activeStorey, wx, wy);
            const clickedWall = findWallAtPoint(activeStorey, wx, wy, 30 / vpRef.current.zoom);

            const isInSelection = (clickedFurn && selectedIds.some(s => s.id === clickedFurn.id)) ||
                (clickedWall && selectedIds.some(s => s.id === clickedWall.wall.id));

            if (isInSelection) {
                // Start multi-drag: save original positions for all selected elements
                const origPositions = {};
                for (const item of selectedIds) {
                    if (item.type === 'furniture') {
                        const f = activeStorey.furniture.find(f => f.id === item.id);
                        if (f) origPositions[item.id] = { x: f.x, y: f.y };
                    } else if (item.type === 'wall') {
                        const w = activeStorey.walls.find(w => w.id === item.id);
                        if (w) {
                            const p1 = getPoint(activeStorey, w.p1);
                            const p2 = getPoint(activeStorey, w.p2);
                            if (p1 && p2) {
                                origPositions[w.p1] = origPositions[w.p1] || { x: p1.x, y: p1.y };
                                origPositions[w.p2] = origPositions[w.p2] || { x: p2.x, y: p2.y };
                            }
                        }
                    }
                }
                dragStartRef.current = {
                    type: 'multi', startX: wx, startY: wy,
                    origPositions, items: selectedIds,
                };
                return;
            }
        }

        // Clear multi-selection on single click
        setSelectedIds([]);
        setSelectedRoomId(null);

        // Check room labels (they render on top, so check first)
        for (const room of activeStorey.rooms) {
            if (room._labelHitBox) {
                const hb = room._labelHitBox;
                if (sx >= hb.x && sx <= hb.x + hb.w && sy >= hb.y && sy <= hb.y + hb.h) {
                    setSelectedId(room.id);
                    setSelectedType('room');
                    setSelectedRoomId(room.id);
                    dragStartRef.current = {
                        type: 'room_label',
                        roomId: room.id,
                        startX: wx, startY: wy,
                        origOffsetX: room.labelOffsetX || 0,
                        origOffsetY: room.labelOffsetY || 0,
                    };
                    requestRender();
                    return;
                }
            }
        }

        // Check furniture
        const furn = findFurnitureAtPoint(activeStorey, wx, wy);
        if (furn) {
            setSelectedId(furn.id);
            setSelectedType('furniture');
            dragStartRef.current = { type: 'furniture', id: furn.id, startX: wx, startY: wy, origX: furn.x, origY: furn.y };
            return;
        }

        // Check openings
        const opening = findOpeningAtPoint(activeStorey, wx, wy);
        if (opening) {
            setSelectedId(opening.id);
            setSelectedType('opening');
            dragStartRef.current = {
                type: 'opening', id: opening.id,
                startX: wx, startY: wy,
                origPosition: opening.position_mm,
            };
            return;
        }

        // Check walls — first check for dimension label click, then CAD handles, then wall body
        const curSelectedId = selectedIdRef.current;
        if (curSelectedId) {
            const selWall = activeStorey.walls.find(w => w.id === curSelectedId);
            if (selWall) {
                const p1 = getPoint(activeStorey, selWall.p1);
                const p2 = getPoint(activeStorey, selWall.p2);
                if (p1 && p2) {
                    // Check dimension label click (midpoint area, offset perpendicular)
                    const s1 = worldToScreen(vpRef.current, p1.x, p1.y);
                    const s2 = worldToScreen(vpRef.current, p2.x, p2.y);
                    const smx = (s1.x + s2.x) / 2;
                    const smy = (s1.y + s2.y) / 2;
                    const sdx = s2.x - s1.x, sdy = s2.y - s1.y;
                    const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
                    const snx = -sdy / slen, sny = sdx / slen;
                    const dimLabelX = smx + snx * 18;
                    const dimLabelY = smy + sny * 18;
                    const dimDist = Math.sqrt((sx - dimLabelX) ** 2 + (sy - dimLabelY) ** 2);
                    if (dimDist < 28) {
                        // Show length editing overlay at this screen position
                        const wLen = dist(p1, p2);
                        const wDx = (p2.x - p1.x) / wLen;
                        const wDy = (p2.y - p1.y) / wLen;
                        setEditingLength({
                            wallId: selWall.id,
                            value: +(wLen / 1000).toFixed(3),
                            dirX: wDx, dirY: wDy,
                            p1x: p1.x, p1y: p1.y,
                            overlayX: smx + snx * 20 - 45,
                            overlayY: smy + sny * 20 - 16,
                        });
                        return;
                    }

                    const handleRadius = 12 / vpRef.current.zoom; // screen px -> world
                    // Check endpoint handles
                    if (dist({ x: wx, y: wy }, p1) < handleRadius) {
                        dragHandleRef.current = selWall.p1;
                        dragStartRef.current = {
                            type: 'corner', id: selWall.id, pointId: selWall.p1,
                            startX: wx, startY: wy, origX: p1.x, origY: p1.y,
                        };
                        return;
                    }
                    if (dist({ x: wx, y: wy }, p2) < handleRadius) {
                        dragHandleRef.current = selWall.p2;
                        dragStartRef.current = {
                            type: 'corner', id: selWall.id, pointId: selWall.p2,
                            startX: wx, startY: wy, origX: p2.x, origY: p2.y,
                        };
                        return;
                    }
                    // Check midpoint handle (perpendicular move)
                    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                    if (dist({ x: wx, y: wy }, mid) < handleRadius) {
                        const wallLen = dist(p1, p2);
                        const wallDx = (p2.x - p1.x) / wallLen;
                        const wallDy = (p2.y - p1.y) / wallLen;
                        // Normal perpendicular to wall
                        const nx = -wallDy;
                        const ny = wallDx;
                        dragHandleRef.current = 'mid';
                        dragStartRef.current = {
                            type: 'wall_perp', id: selWall.id,
                            startX: wx, startY: wy,
                            origP1: { x: p1.x, y: p1.y },
                            origP2: { x: p2.x, y: p2.y },
                            p1Id: selWall.p1, p2Id: selWall.p2,
                            nx, ny,
                        };
                        return;
                    }
                }
            }
        }

        // Check dimension label click on ANY wall (not just selected)
        for (const wall of activeStorey.walls) {
            const wp1 = getPoint(activeStorey, wall.p1);
            const wp2 = getPoint(activeStorey, wall.p2);
            if (!wp1 || !wp2 || dist(wp1, wp2) < 200) continue;
            const ws1 = worldToScreen(vpRef.current, wp1.x, wp1.y);
            const ws2 = worldToScreen(vpRef.current, wp2.x, wp2.y);
            const wmx = (ws1.x + ws2.x) / 2;
            const wmy = (ws1.y + ws2.y) / 2;
            const wdx = ws2.x - ws1.x, wdy = ws2.y - ws1.y;
            const wlen = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
            const wnx = -wdy / wlen, wny = wdx / wlen;
            const dlx = wmx + wnx * 18;
            const dly = wmy + wny * 18;
            const dd = Math.sqrt((sx - dlx) ** 2 + (sy - dly) ** 2);
            if (dd < 28) {
                setSelectedId(wall.id);
                setSelectedType('wall');
                const wLen = dist(wp1, wp2);
                const wDirX = (wp2.x - wp1.x) / wLen;
                const wDirY = (wp2.y - wp1.y) / wLen;
                setEditingLength({
                    wallId: wall.id,
                    value: +(wLen / 1000).toFixed(3),
                    dirX: wDirX, dirY: wDirY,
                    p1x: wp1.x, p1y: wp1.y,
                    overlayX: wmx + wnx * 20 - 45,
                    overlayY: wmy + wny * 20 - 16,
                });
                return;
            }
        }

        // Check walls (body click = select + drag)
        const hit = findWallAtPoint(activeStorey, wx, wy, 30 / vpRef.current.zoom);
        if (hit) {
            setSelectedId(hit.wall.id);
            setSelectedType('wall');
            const w = hit.wall;
            const p1 = getPoint(activeStorey, w.p1);
            const p2 = getPoint(activeStorey, w.p2);
            if (p1 && p2) {
                // Duplicate shared endpoints so only this wall moves
                const isP1Shared = activeStorey.walls.some(o => o.id !== w.id && (o.p1 === w.p1 || o.p2 === w.p1));
                const isP2Shared = activeStorey.walls.some(o => o.id !== w.id && (o.p1 === w.p2 || o.p2 === w.p2));
                let p1Id = w.p1, p2Id = w.p2;
                if (isP1Shared) {
                    const np = addPoint(activeStorey, p1.x, p1.y);
                    w.p1 = np.id;
                    p1Id = np.id;
                }
                if (isP2Shared) {
                    const np = addPoint(activeStorey, p2.x, p2.y);
                    w.p2 = np.id;
                    p2Id = np.id;
                }
                dragStartRef.current = {
                    type: 'wall_body', id: w.id,
                    startX: wx, startY: wy,
                    origP1: { x: p1.x, y: p1.y },
                    origP2: { x: p2.x, y: p2.y },
                    p1Id, p2Id,
                };
            }
            return;
        }

        // Check rooms
        const room = findRoomAtPoint(activeStorey, wx, wy);
        if (room) {
            setSelectedId(room.id);
            setSelectedType('room');
            return;
        }

        // Check annotations — first check handles on currently selected annotation
        const curSelAnn = (selectedType === 'annotation' && activeStorey.annotations)
            ? activeStorey.annotations.find(a => a.id === selectedIdRef.current) : null;
        if (curSelAnn) {
            const handleRad = 10 / vpRef.current.zoom;
            // Polyline/Area point handles
            if ((curSelAnn.type === 'polyline' || curSelAnn.type === 'area') && curSelAnn.points) {
                for (let pi = 0; pi < curSelAnn.points.length; pi++) {
                    const pt = curSelAnn.points[pi];
                    if (dist({ x: wx, y: wy }, pt) < handleRad) {
                        dragStartRef.current = {
                            type: 'annotation_point', annId: curSelAnn.id,
                            pointIdx: pi, startX: wx, startY: wy,
                            origX: pt.x, origY: pt.y,
                        };
                        return;
                    }
                }
            }
            // Circle radius handle (right edge)
            if (curSelAnn.type === 'circle') {
                const edgePt = { x: curSelAnn.cx + curSelAnn.radius, y: curSelAnn.cy };
                if (dist({ x: wx, y: wy }, edgePt) < handleRad) {
                    dragStartRef.current = {
                        type: 'annotation_resize_circle', annId: curSelAnn.id,
                        startX: wx, startY: wy, origRadius: curSelAnn.radius,
                    };
                    return;
                }
            }
        }

        // Check annotations body click
        if (activeStorey.annotations) {
            for (let i = activeStorey.annotations.length - 1; i >= 0; i--) {
                const ann = activeStorey.annotations[i];
                let hitAnn = false;
                if (ann.type === 'text' && ann._hitBox) {
                    const hb = ann._hitBox;
                    if (sx >= hb.sx && sx <= hb.sx + hb.sw && sy >= hb.sy && sy <= hb.sy + hb.sh) hitAnn = true;
                } else if (ann.type === 'circle') {
                    const d = dist({ x: wx, y: wy }, { x: ann.cx, y: ann.cy });
                    if (Math.abs(d - ann.radius) < 20 / vpRef.current.zoom || d < ann.radius) hitAnn = true;
                } else if ((ann.type === 'polyline' || ann.type === 'area') && ann.points && ann.points.length >= 2) {
                    // Check proximity to any line segment
                    for (let j = 0; j < ann.points.length - 1; j++) {
                        const a = ann.points[j], b = ann.points[j + 1];
                        const dx = b.x - a.x, dy = b.y - a.y;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / (len * len)));
                        const px = a.x + t * dx, py = a.y + t * dy;
                        if (dist({ x: wx, y: wy }, { x: px, y: py }) < 15 / vpRef.current.zoom) { hitAnn = true; break; }
                    }
                    if (!hitAnn && ann.type === 'area') {
                        // Also check inside polygon
                        let inside = false;
                        const poly = ann.points;
                        for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
                            if (((poly[j].y > wy) !== (poly[k].y > wy)) &&
                                (wx < (poly[k].x - poly[j].x) * (wy - poly[j].y) / (poly[k].y - poly[j].y) + poly[j].x)) {
                                inside = !inside;
                            }
                        }
                        if (inside) hitAnn = true;
                    }
                }
                if (hitAnn) {
                    setSelectedId(ann.id);
                    setSelectedType('annotation');
                    // Start drag for annotation repositioning
                    if (ann.type === 'text') {
                        dragStartRef.current = {
                            type: 'annotation_drag', annId: ann.id, annType: 'text',
                            startX: wx, startY: wy, origX: ann.x, origY: ann.y,
                        };
                    } else if (ann.type === 'circle') {
                        dragStartRef.current = {
                            type: 'annotation_drag', annId: ann.id, annType: 'circle',
                            startX: wx, startY: wy, origCx: ann.cx, origCy: ann.cy,
                        };
                    } else if (ann.type === 'polyline' || ann.type === 'area') {
                        dragStartRef.current = {
                            type: 'annotation_drag', annId: ann.id, annType: ann.type,
                            startX: wx, startY: wy,
                            origPoints: ann.points.map(p => ({ x: p.x, y: p.y })),
                        };
                    }
                    requestRender();
                    return;
                }
            }
        }

        // Check slabs — first check corner handles on selected slab, then body
        const curSelSlab = selectedType === 'slab' ? (activeStorey.slabs || []).find(s => s.id === selectedIdRef.current) : null;
        if (curSelSlab && curSelSlab.polygon) {
            const handleRadius = 10 / vpRef.current.zoom;
            // Check corner handles
            for (let i = 0; i < curSelSlab.polygon.length; i++) {
                const pt = curSelSlab.polygon[i];
                if (dist({ x: wx, y: wy }, pt) < handleRadius) {
                    dragStartRef.current = {
                        type: 'slab_corner', slabId: curSelSlab.id, cornerIdx: i,
                        startX: wx, startY: wy, origX: pt.x, origY: pt.y,
                    };
                    return;
                }
            }
            // Check midpoint handles (insert new point)
            for (let i = 0; i < curSelSlab.polygon.length; i++) {
                const a = curSelSlab.polygon[i];
                const b = curSelSlab.polygon[(i + 1) % curSelSlab.polygon.length];
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                if (dist({ x: wx, y: wy }, { x: mx, y: my }) < handleRadius) {
                    // Insert new point at midpoint
                    curSelSlab.polygon.splice(i + 1, 0, { x: mx, y: my });
                    // Start dragging the new point
                    dragStartRef.current = {
                        type: 'slab_corner', slabId: curSelSlab.id, cornerIdx: i + 1,
                        startX: mx, startY: my, origX: mx, origY: my,
                    };
                    markDirty();
                    requestRender();
                    return;
                }
            }
        }
        for (const slab of (activeStorey.slabs || [])) {
            if (slab.polygon && slab.polygon.length >= 3) {
                let inside = false;
                const poly = slab.polygon;
                for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                    const xi = poly[i].x, yi = poly[i].y;
                    const xj = poly[j].x, yj = poly[j].y;
                    if (((yi > wy) !== (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi) + xi)) {
                        inside = !inside;
                    }
                }
                if (inside) {
                    setSelectedId(slab.id);
                    setSelectedType('slab');
                    return;
                }
            }
        }

        // Start marquee selection (deselect happens on mouseUp if no drag)
        setEditingLength(null);
        marqueeRef.current = {
            dragging: true,
            sx1: sx, sy1: sy,
            sx2: sx, sy2: sy,
            wx1: wx, wy1: wy,
        };
    };

    // ─── Measure Tool ───────────────────────────────────────────
    const handleMeasureClick = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(vpRef.current, sx, sy);
        const wx = snapToGrid(world.x);
        const wy = snapToGrid(world.y);

        if (measurePoints.length === 0) {
            setMeasurePoints([{ x: wx, y: wy }]);
            setMeasureResult(null);
            // Show preview line on next move
            previewRef.current = { type: 'measure_start', x: wx, y: wy };
            requestRender();
        } else {
            const p1 = measurePoints[0];
            const d = dist(p1, { x: wx, y: wy });
            setMeasureResult(Math.round(d));
            // Show dimension line
            previewRef.current = {
                type: 'wall_segment',
                x1: p1.x, y1: p1.y,
                x2: wx, y2: wy,
                wallType: 'measure',
            };
            requestRender();
            setMeasurePoints([]);
        }
    }, [measurePoints, requestRender]);

    // ─── Delete selected element (by type) ───────────────────────
    const handleDeleteSelected = useCallback(() => {
        const itemsToDelete = selectedIds.length > 0 ? selectedIds : (selectedId ? [{ id: selectedId, type: selectedType }] : []);
        if (itemsToDelete.length === 0) return;

        const storeyCopy = JSON.parse(JSON.stringify(activeStorey));
        let deleted = false;

        for (const item of itemsToDelete) {
            if (item.type === 'furniture') {
                if (activeStorey.furniture.find(f => f.id === item.id)) {
                    deleteFurniture(activeStorey, item.id);
                    deleted = true;
                }
            } else if (item.type === 'opening') {
                if (activeStorey.openings.find(o => o.id === item.id)) {
                    deleteOpening(activeStorey, item.id);
                    deleted = true;
                }
            } else if (item.type === 'wall') {
                const wall = activeStorey.walls.find(w => w.id === item.id);
                if (wall) {
                    if (wall.type === 'outer' && activeStorey.outerClosed) {
                        activeStorey.outerClosed = false;
                        activeStorey.outerPolygon = null;
                        activeStorey.outerBoundary = null;
                    }
                    deleteWall(activeStorey, item.id);
                    deleted = true;
                }
            } else if (item.type === 'slab') {
                activeStorey.slabs = (activeStorey.slabs || []).filter(s => s.id !== item.id);
                deleted = true;
            } else if (item.type === 'annotation') {
                activeStorey.annotations = (activeStorey.annotations || []).filter(a => a.id !== item.id);
                deleted = true;
            }
        }

        if (deleted) {
            computeRooms(activeStorey);
            cmdStackRef.current.execute({
                do: () => { },
                undo: () => { Object.assign(activeStorey, storeyCopy); forceRender(v => v + 1); },
                label: 'Löschen',
            });
            setSelectedId(null);
            setSelectedType(null);
            setSelectedIds([]);
            markDirty();
            forceRender(v => v + 1);
            requestRender();
        }
    }, [selectedId, selectedType, selectedIds, activeStorey, markDirty, requestRender]);

    // ─── Keyboard ───────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setDrawPoints([]);
                setMeasurePoints([]);
                setMeasureResult(null);
                previewRef.current = null;
                snapPointRef.current = null;
                setPlacingFurniture(null);
                setShowExportMenu(false);
                setShowStoreyDialog(false);
                setSlabContextMenu(null);
                // Finalize active annotation (polyline/area)
                setActiveAnnotationId(null);
                setAnnotationPoints([]);
                setAnnotationCircleCenter(null);
                setActiveTool(TOOLS.SELECT);
                setSelectedIds([]);
                setSelectedRoomId(null);
                requestRender();
            }
            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); cmdStackRef.current.undo(); forceRender(v => v + 1); requestRender(); }
            if (e.ctrlKey && e.key === 'y') { e.preventDefault(); cmdStackRef.current.redo(); forceRender(v => v + 1); requestRender(); }
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSave(); }
            if (e.key === 'Delete' && (selectedId || selectedIds.length > 0)) {
                e.preventDefault();
                handleDeleteSelected();
            }

            // ── Copy (Ctrl+C) ────────────────────────────────────
            if (e.ctrlKey && e.key === 'c' && selectedId && activeStorey) {
                e.preventDefault();
                if (selectedType === 'annotation') {
                    const ann = (activeStorey.annotations || []).find(a => a.id === selectedId);
                    if (ann) clipboardRef.current = { type: 'annotation', data: JSON.parse(JSON.stringify(ann)) };
                } else if (selectedType === 'furniture') {
                    const furn = (activeStorey.furniture || []).find(f => f.id === selectedId);
                    if (furn) clipboardRef.current = { type: 'furniture', data: JSON.parse(JSON.stringify(furn)) };
                } else if (selectedType === 'opening') {
                    const op = (activeStorey.openings || []).find(o => o.id === selectedId);
                    if (op) clipboardRef.current = { type: 'opening', data: JSON.parse(JSON.stringify(op)) };
                } else if (selectedType === 'slab') {
                    const slab = (activeStorey.slabs || []).find(s => s.id === selectedId);
                    if (slab) clipboardRef.current = { type: 'slab', data: JSON.parse(JSON.stringify(slab)) };
                }
            }

            // ── Paste (Ctrl+V) ───────────────────────────────────
            if (e.ctrlKey && e.key === 'v' && clipboardRef.current && activeStorey) {
                e.preventDefault();
                const genId = () => Math.random().toString(36).substr(2, 9);
                const cb = clipboardRef.current;
                const offset = 50; // offset pasted element slightly

                if (cb.type === 'annotation') {
                    if (!activeStorey.annotations) activeStorey.annotations = [];
                    const copy = JSON.parse(JSON.stringify(cb.data));
                    copy.id = 'ann_' + genId();
                    // Offset the pasted element
                    if (copy.type === 'polyline' || copy.type === 'area') {
                        copy.points = copy.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
                    } else if (copy.type === 'circle') {
                        copy.cx += offset; copy.cy += offset;
                    } else if (copy.type === 'text') {
                        copy.x += offset; copy.y += offset;
                    }
                    delete copy._hitBox;
                    activeStorey.annotations.push(copy);
                    setSelectedId(copy.id);
                    setSelectedType('annotation');
                } else if (cb.type === 'furniture') {
                    if (!activeStorey.furniture) activeStorey.furniture = [];
                    const copy = JSON.parse(JSON.stringify(cb.data));
                    copy.id = 'furn_' + genId();
                    copy.x += offset; copy.y += offset;
                    activeStorey.furniture.push(copy);
                    setSelectedId(copy.id);
                    setSelectedType('furniture');
                } else if (cb.type === 'slab') {
                    if (!activeStorey.slabs) activeStorey.slabs = [];
                    const copy = JSON.parse(JSON.stringify(cb.data));
                    copy.id = 'slab_' + genId();
                    copy.polygon = copy.polygon.map(p => ({ x: p.x + offset, y: p.y + offset }));
                    activeStorey.slabs.push(copy);
                    setSelectedId(copy.id);
                    setSelectedType('slab');
                }
                markDirty();
                forceRender(v => v + 1);
                requestRender();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave, selectedId, selectedIds, selectedType, activeStorey, handleDeleteSelected, requestRender]);

    // ─── Canvas event attachment ────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        const preventContext = (e) => e.preventDefault();
        canvas.addEventListener('contextmenu', preventContext);
        return () => {
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('contextmenu', preventContext);
        };
    }, [handleWheel]);

    const [showStoreyDialog, setShowStoreyDialog] = useState(false);

    const addStoreyAt = (position) => {
        const usedLabels = storeys.map(s => s.label);
        const nextLabel = STOREY_LABELS.find(l => !usedLabels.includes(l)) || `${storeys.length + 1}. OG`;
        const newStorey = createStorey(nextLabel, STOREY_HEIGHT.default);
        const insertIdx = position === 'above' ? activeStoreyIdx + 1 : activeStoreyIdx;
        const newStoreys = [...storeys];
        newStoreys.splice(insertIdx, 0, newStorey);
        setStoreys(newStoreys);
        setActiveStoreyIdx(insertIdx);
        setShowStoreyDialog(false);
    };

    const duplicateCurrentStorey = () => {
        const dupe = duplicateStorey(activeStorey, `${activeStorey.label} (Kopie)`);
        setStoreys([...storeys, dupe]);
        setActiveStoreyIdx(storeys.length);
        markDirty();
    };

    const deleteCurrentStorey = () => {
        if (storeys.length <= 1) return; // mindestens 1 Geschoss behalten
        const idx = activeStoreyIdx;
        const newStoreys = storeys.filter((_, i) => i !== idx);
        setStoreys(newStoreys);
        setActiveStoreyIdx(Math.max(0, idx - 1));
        setSelectedId(null);
        setSelectedType(null);
        setDrawPoints([]);
        markDirty();
    };

    // ─── Selected Element Details ───────────────────────────────
    const selectedWall = selectedType === 'wall' ? activeStorey.walls.find(w => w.id === selectedId) : null;
    const selectedOpening = selectedType === 'opening' ? activeStorey.openings.find(o => o.id === selectedId) : null;
    const selectedFurniture = selectedType === 'furniture' ? activeStorey.furniture.find(f => f.id === selectedId) : null;
    const selectedRoom = selectedType === 'room' ? activeStorey.rooms.find(r => r.id === selectedId) : null;
    const selectedSlab = selectedType === 'slab' ? (activeStorey.slabs || []).find(s => s.id === selectedId) : null;

    // ─── Render ─────────────────────────────────────────────────
    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    const zoomPercent = Math.round(vpRef.current.zoom * 100 / 0.15);

    return (
        <div ref={editorContainerRef} style={{ display: 'flex', flexDirection: 'column', height: isFullscreen ? '100vh' : 'calc(100vh - 64px)', overflow: 'hidden', position: 'relative', background: 'var(--bg-color, #fff)' }}>
            {/* ─── Topbar ──────────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px',
                borderBottom: '1px solid var(--border-color)', background: 'var(--surface-color)',
                flexWrap: 'wrap', minHeight: '48px',
            }}>
                <button onClick={() => navigate('/renovation?tab=floorplan')} style={topBtnStyle} title="Zur Übersicht">
                    <ArrowLeft size={16} />
                </button>

                <input
                    type="text"
                    value={planName}
                    onChange={e => setPlanName(e.target.value)}
                    onBlur={markDirty}
                    style={{
                        border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px', fontSize: '0.95rem', fontWeight: 600,
                        background: 'transparent', minWidth: '120px', maxWidth: '300px',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--border-color)'}
                />

                <div style={{ flex: 1 }} />

                {/* Storey selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <select
                        value={activeStoreyIdx}
                        onChange={e => { setActiveStoreyIdx(Number(e.target.value)); setDrawPoints([]); }}
                        style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.82rem', background: 'var(--surface-color)' }}
                    >
                        {storeys.map((s, i) => (
                            <option key={s.id} value={i}>{s.label}</option>
                        ))}
                    </select>
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowStoreyDialog(!showStoreyDialog)} title="Geschoss hinzufügen" style={topBtnStyle}><Plus size={14} /></button>
                        {showStoreyDialog && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                zIndex: 100, overflow: 'hidden', minWidth: '170px',
                            }}>
                                <button
                                    onClick={() => addStoreyAt('above')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-color, #f1f5f9)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    Darüber einfügen
                                </button>
                                <button
                                    onClick={() => addStoreyAt('below')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-color, #f1f5f9)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    Darunter einfügen
                                </button>
                            </div>
                        )}
                    </div>
                    <button onClick={duplicateCurrentStorey} title="Geschoss duplizieren" style={topBtnStyle}><Copy size={14} /></button>
                    <button
                        onClick={deleteCurrentStorey}
                        disabled={storeys.length <= 1}
                        title="Geschoss entfernen"
                        style={{ ...topBtnStyle, color: storeys.length > 1 ? '#ef4444' : '#d1d5db', opacity: storeys.length <= 1 ? 0.4 : 1 }}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>

                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />

                <button onClick={() => cmdStackRef.current.undo()} disabled={!cmdStackRef.current.canUndo()} style={topBtnStyle} title="Rückgängig (Strg+Z)">
                    <Undo2 size={16} />
                </button>
                <button onClick={() => cmdStackRef.current.redo()} disabled={!cmdStackRef.current.canRedo()} style={topBtnStyle} title="Wiederholen (Strg+Y)">
                    <Redo2 size={16} />
                </button>
                <button onClick={() => handleSave()} disabled={saving} style={{ ...topBtnStyle, color: '#0ea5e9', fontWeight: 600 }} title="Speichern (Strg+S)">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Speichern</span>}
                </button>

                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />

                {/* ── Background Image Controls ── */}
                <input
                    ref={bgFileRef}
                    type="file"
                    accept="image/*,.pdf"
                    style={{ display: 'none' }}
                    onChange={handleBgUpload}
                />
                <button
                    onClick={() => bgFileRef.current?.click()}
                    style={topBtnStyle}
                    title="Hintergrundbild hochladen (PNG/JPG)"
                >
                    <Upload size={16} />
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Hintergrund</span>}
                </button>

                {bgImage && (
                    <>
                        <button
                            onClick={() => { setBgImage(prev => { const u = { ...prev, visible: !prev.visible }; if (activeStorey) activeStorey.bgImage = u; return u; }); }}
                            style={{ ...topBtnStyle, color: bgImage.visible !== false ? '#0ea5e9' : 'var(--text-secondary)' }}
                            title={bgImage.visible !== false ? 'Hintergrund ausblenden' : 'Hintergrund einblenden'}
                        >
                            {bgImage.visible !== false ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <input
                            type="range"
                            min="5" max="90" step="5"
                            value={(bgImage.opacity || 0.35) * 100}
                            onChange={e => { const op = Number(e.target.value) / 100; setBgImage(prev => { const u = { ...prev, opacity: op }; if (activeStorey) activeStorey.bgImage = u; return u; }); }}
                            title={`Transparenz: ${Math.round((bgImage.opacity || 0.35) * 100)}%`}
                            style={{ width: '60px', accentColor: '#0ea5e9' }}
                        />
                        <button
                            onClick={() => {
                                setActiveTool(TOOLS.CALIBRATE);
                                setCalibPoints([]);
                                setDrawPoints([]);
                            }}
                            style={{ ...topBtnStyle, color: activeTool === TOOLS.CALIBRATE ? '#ef4444' : 'var(--text-secondary)', background: activeTool === TOOLS.CALIBRATE ? '#fef2f2' : 'transparent' }}
                            title="Referenzmaß setzen (2 Punkte klicken, Strecke eingeben)"
                        >
                            <Scaling size={16} />
                            {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Maßstab</span>}
                        </button>
                        <button onClick={removeBgImage} style={{ ...topBtnStyle, color: '#ef4444' }} title="Hintergrund entfernen">
                            <X size={14} />
                        </button>
                    </>
                )}

                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />

                {/* Bemaßung toggle */}
                <button
                    onClick={() => { setShowDimensions(v => !v); requestRender(); }}
                    style={{ ...topBtnStyle, background: showDimensions ? '#e0f2fe' : 'var(--surface-color)', color: showDimensions ? '#0ea5e9' : 'var(--text-secondary)' }}
                    title={showDimensions ? 'Bemaßung ausblenden' : 'Bemaßung einblenden'}
                >
                    <Ruler size={16} />
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Maße</span>}
                </button>

                {/* 2D/3D toggle */}
                <button
                    onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')}
                    style={{ ...topBtnStyle, background: viewMode === '3d' ? '#e0f2fe' : 'var(--surface-color)', color: viewMode === '3d' ? '#0ea5e9' : 'var(--text-secondary)' }}
                    title={viewMode === '2d' ? '3D-Ansicht' : '2D-Ansicht'}
                >
                    <Box size={16} />
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>{viewMode === '2d' ? '3D' : '2D'}</span>}
                </button>

                {/* Export dropdown */}
                <button
                    onClick={toggleFullscreen}
                    style={topBtnStyle}
                    title={isFullscreen ? 'Vollbild beenden' : 'Vollbild'}
                >
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                    {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>{isFullscreen ? 'Beenden' : 'Vollbild'}</span>}
                </button>

                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        style={topBtnStyle}
                        title="Exportieren"
                    >
                        <Download size={16} />
                        {!isMobile && <span style={{ marginLeft: '4px', fontSize: '0.82rem' }}>Export</span>}
                        <ChevronDown size={12} />
                    </button>
                    {showExportMenu && (
                        <div style={{
                            position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                            background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            minWidth: '200px', zIndex: 100, overflow: 'hidden',
                        }}>
                            <ExportMenuItem
                                icon={Image} label="Als PNG exportieren" sublabel="Hochauflösendes Bild"
                                onClick={async () => { setShowExportMenu(false); const blob = await exportToPNG(activeStorey, planName); downloadBlob(blob, `${planName}_${activeStorey.label}.png`); }}
                            />
                            <ExportMenuItem
                                icon={FileText} label="Als PDF exportieren" sublabel="Alle Geschosse"
                                onClick={() => { setShowExportMenu(false); exportToPDF(storeys, planName); }}
                            />
                            <div style={{ height: '1px', background: 'var(--border-color)' }} />
                            <ExportMenuItem
                                icon={FileSpreadsheet} label="Massenermittlung CSV" sublabel="Für Excel"
                                onClick={() => { setShowExportMenu(false); exportQuantityListCSV(storeys, planName); }}
                            />
                            <ExportMenuItem
                                icon={FileText} label="Massenermittlung PDF" sublabel="Druckfertig"
                                onClick={() => { setShowExportMenu(false); exportQuantityListPDF(storeys, planName); }}
                            />
                        </div>
                    )}
                </div>

                <button
                    onClick={() => {
                        const canvas = canvasRef.current;
                        if (!canvas) return;
                        zoomToFit(vpRef.current, activeStorey, canvas.width, canvas.height);
                        requestRender();
                        forceRender(v => v + 1);
                    }}
                    style={topBtnStyle}
                    title="Grundriss einpassen (Zoom auf alles)"
                >
                    <Search size={16} />
                </button>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'center' }}>
                    {zoomPercent}%
                </div>
            </div>

            {/* ── Calibration Dialog ── */}
            {showCalibDialog && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
                }} onClick={() => { setShowCalibDialog(false); setCalibPoints([]); setActiveTool(TOOLS.SELECT); }}>
                    <div style={{
                        background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                        padding: '24px', minWidth: '320px', boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem' }}>Referenzmaß eingeben</h3>
                        <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            Geben Sie die reale Länge der markierten Strecke ein:
                        </p>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
                            <input
                                type="text"
                                value={calibDistMm}
                                onChange={e => setCalibDistMm(e.target.value)}
                                placeholder="z.B. 5000"
                                autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') handleCalibApply(); }}
                                style={{
                                    flex: 1, padding: '8px 12px', border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-sm)', fontSize: '0.95rem',
                                }}
                            />
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>mm</span>
                        </div>
                        <p style={{ margin: '0 0 16px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Tipp: 1m = 1000mm, 5m = 5000mm
                        </p>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => { setShowCalibDialog(false); setCalibPoints([]); setActiveTool(TOOLS.SELECT); }}
                                style={{ padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer' }}
                            >Abbrechen</button>
                            <button
                                onClick={handleCalibApply}
                                disabled={!calibDistMm}
                                style={{
                                    padding: '8px 16px', border: 'none', borderRadius: 'var(--radius-sm)',
                                    background: '#0ea5e9', color: '#fff', cursor: 'pointer', fontWeight: 600,
                                    opacity: calibDistMm ? 1 : 0.5,
                                }}
                            >Anwenden</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Main Area ──────────────────────────────────────── */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                {/* Left Toolbar */}
                <div style={{
                    width: '52px', borderRight: '1px solid var(--border-color)',
                    background: 'var(--surface-color)', display: 'flex', flexDirection: 'column',
                    padding: '8px 0', gap: '2px', alignItems: 'center',
                }}>
                    {[
                        { tool: TOOLS.SELECT, icon: MousePointer2, label: 'Auswahl' },
                        { tool: TOOLS.OUTER_WALL, icon: BoxSelect, label: 'Außenwand' },
                        { tool: TOOLS.INNER_WALL, icon: SeparatorHorizontal, label: 'Innenwand', disabled: !activeStorey.outerClosed },
                        { tool: TOOLS.DOOR, icon: DoorOpen, label: 'Tür', disabled: activeStorey.walls.length === 0 },
                        { tool: TOOLS.WINDOW, icon: AppWindow, label: 'Fenster', disabled: activeStorey.walls.length === 0 },
                        { tool: TOOLS.FURNITURE, icon: Armchair, label: 'Möbel' },
                        { tool: TOOLS.SLAB, icon: Layers, label: 'Decke' },
                        { tool: TOOLS.ROOF, icon: Home, label: 'Dach' },
                        { tool: 'measure', icon: Ruler, label: 'Messen' },
                        { tool: TOOLS.DELETE, icon: Trash2, label: 'Löschen' },
                        { separator: true },
                        { tool: TOOLS.ANNOTATE_POLYLINE, icon: Spline, label: 'Polylinie' },
                        { tool: TOOLS.ANNOTATE_CIRCLE, icon: CircleDot, label: 'Kreis' },
                        { tool: TOOLS.ANNOTATE_AREA, icon: Pentagon, label: 'Fläche' },
                        { tool: TOOLS.ANNOTATE_TEXT, icon: Type, label: 'Textfeld' },
                    ].map((t, idx) => t.separator ? (
                        <div key={`sep-${idx}`} style={{ width: '30px', height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />
                    ) : (
                        <button
                            key={t.tool}
                            onClick={() => {
                                setActiveTool(t.tool);
                                setDrawPoints([]);
                                setMeasurePoints([]);
                                setMeasureResult(null);
                                setAnnotationPoints([]);
                                setAnnotationCircleCenter(null);
                                previewRef.current = null;
                                if (t.tool !== TOOLS.FURNITURE) setPlacingFurniture(null);
                            }}
                            disabled={t.disabled}
                            title={t.label}
                            style={{
                                width: '40px', height: '40px', borderRadius: 'var(--radius-sm)',
                                border: 'none', cursor: t.disabled ? 'not-allowed' : 'pointer',
                                background: activeTool === t.tool ? '#e0f2fe' : 'transparent',
                                color: t.disabled ? '#d1d5db' : (activeTool === t.tool ? '#0ea5e9' : 'var(--text-secondary)'),
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                                opacity: t.disabled ? 0.4 : 1,
                            }}
                        >
                            <t.icon size={18} />
                        </button>
                    ))}

                </div>

                {/* Furniture sidebar (when tool = furniture) */}
                {activeTool === TOOLS.FURNITURE && (
                    <div style={{
                        width: '200px', borderRight: '1px solid var(--border-color)',
                        background: 'var(--surface-color)', overflowY: 'auto', padding: '8px',
                    }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Möbelkatalog</div>

                        {/* Category tabs */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                            {FURNITURE_CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setFurnitureCategory(cat.id)}
                                    style={{
                                        padding: '4px 8px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                        fontSize: '0.72rem', fontWeight: 600,
                                        background: furnitureCategory === cat.id ? '#e0f2fe' : '#f1f5f9',
                                        color: furnitureCategory === cat.id ? '#0ea5e9' : '#64748b',
                                    }}
                                >
                                    {cat.icon} {cat.label}
                                </button>
                            ))}
                        </div>

                        {/* Items */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {getItemsByCategory(furnitureCategory).map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setPlacingFurniture(item)}
                                    style={{
                                        padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                                        border: placingFurniture?.id === item.id ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                        background: placingFurniture?.id === item.id ? '#f0f9ff' : 'var(--surface-color)',
                                        cursor: 'pointer', textAlign: 'left', fontSize: '0.8rem',
                                    }}
                                >
                                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                        {mmToM(item.defaultWidth)} × {mmToM(item.defaultDepth)} m
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Roof sidebar (when tool = roof) */}
                {activeTool === TOOLS.ROOF && (
                    <div style={{
                        width: '220px', borderRight: '1px solid var(--border-color)',
                        background: 'var(--surface-color)', overflowY: 'auto', padding: '12px',
                    }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Dach</div>

                        {/* Roof type selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                            {Object.entries(ROOF_TYPES).map(([key, rt]) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        const defaults = { type: key };
                                        if (key === 'gable') { defaults.kneeWall_mm = rt.kneeWall_mm; defaults.pitch_deg = rt.pitch_deg; defaults.overhang_mm = rt.overhang_mm; }
                                        if (key === 'hip') { defaults.pitch_deg = rt.pitch_deg; defaults.overhang_mm = rt.overhang_mm; }
                                        if (key === 'flat') { defaults.parapet_mm = rt.parapet_mm; }
                                        // Merge with existing values if type matches
                                        const existing = activeStorey.roof?.type === key ? activeStorey.roof : {};
                                        activeStorey.roof = { ...defaults, ...existing, type: key };
                                        forceRender(n => n + 1);
                                        markDirty();
                                    }}
                                    style={{
                                        padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                                        border: activeStorey.roof?.type === key ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                        background: activeStorey.roof?.type === key ? '#f0f9ff' : 'var(--surface-color)',
                                        cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem', fontWeight: 600,
                                    }}
                                >
                                    {rt.label}
                                </button>
                            ))}
                        </div>

                        {/* Roof parameters */}
                        {activeStorey.roof && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {/* Satteldach */}
                                {activeStorey.roof.type === 'gable' && (
                                    <>
                                        <PropField label="Kniestockhöhe" value={(activeStorey.roof.kneeWall_mm || 1000) / 10} unit="cm" min={0} max={200} step={5}
                                            onChange={v => { activeStorey.roof.kneeWall_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                        <PropField label="Dachneigung" value={activeStorey.roof.pitch_deg || 35} unit="°" min={10} max={60} step={1}
                                            onChange={v => { activeStorey.roof.pitch_deg = Math.round(v); forceRender(n => n + 1); markDirty(); }} />
                                        <PropField label="Dachüberstand" value={(activeStorey.roof.overhang_mm || 500) / 10} unit="cm" min={0} max={150} step={5}
                                            onChange={v => { activeStorey.roof.overhang_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                    </>
                                )}
                                {/* Walmdach */}
                                {activeStorey.roof.type === 'hip' && (
                                    <>
                                        <PropField label="Dachneigung" value={activeStorey.roof.pitch_deg || 25} unit="°" min={10} max={60} step={1}
                                            onChange={v => { activeStorey.roof.pitch_deg = Math.round(v); forceRender(n => n + 1); markDirty(); }} />
                                        <PropField label="Dachüberstand" value={(activeStorey.roof.overhang_mm || 500) / 10} unit="cm" min={0} max={150} step={5}
                                            onChange={v => { activeStorey.roof.overhang_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                    </>
                                )}
                                {/* Flachdach */}
                                {activeStorey.roof.type === 'flat' && (
                                    <PropField label="Attikahöhe" value={(activeStorey.roof.parapet_mm || 500) / 10} unit="cm" min={10} max={150} step={5}
                                        onChange={v => { activeStorey.roof.parapet_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                )}

                                {/* Delete roof */}
                                <button
                                    onClick={() => { activeStorey.roof = null; forceRender(n => n + 1); markDirty(); }}
                                    style={{
                                        marginTop: '12px', padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                                        border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                                        cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                                    }}
                                >
                                    <Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    Dach entfernen
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Canvas / 3D View */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: viewMode === '3d' ? 'default' : getCursor(activeTool, isPanningRef.current) }}>
                    {viewMode === '2d' ? (
                        <canvas
                            ref={canvasRef}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseDown={(e) => {
                                setSlabContextMenu(null); // close on any click
                                if (activeTool === 'measure') {
                                    handleMeasureClick(e);
                                } else {
                                    handleMouseDown(e);
                                }
                            }}
                            onDoubleClick={(e) => {
                                // Finish polyline or area on double-click — finalize the live annotation
                                if ((activeTool === TOOLS.ANNOTATE_POLYLINE || activeTool === TOOLS.ANNOTATE_AREA) && activeAnnotationId) {
                                    // The annotation already exists — just finalize
                                    setActiveAnnotationId(null);
                                    setAnnotationPoints([]);
                                    markDirty();
                                    forceRender(v => v + 1);
                                    requestRender();
                                }
                            }}
                            style={{ display: 'block', width: '100%', height: '100%' }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                // Slab right-click context menu
                                if (selectedType === 'slab') {
                                    const slab = (activeStorey.slabs || []).find(s => s.id === selectedId);
                                    if (slab && slab.polygon && slab.polygon.length >= 3) {
                                        const rect = canvasRef.current.getBoundingClientRect();
                                        const sx = e.clientX - rect.left;
                                        const sy = e.clientY - rect.top;
                                        const world = screenToWorld(vpRef.current, sx * (canvasRef.current.width / rect.width), sy * (canvasRef.current.height / rect.height));
                                        // Find nearest edge to insert a point
                                        let bestEdge = 0, bestDist = Infinity;
                                        for (let i = 0; i < slab.polygon.length; i++) {
                                            const a = slab.polygon[i];
                                            const b = slab.polygon[(i + 1) % slab.polygon.length];
                                            const d = pointToSegmentDist(world.x, world.y, a.x, a.y, b.x, b.y);
                                            if (d.dist < bestDist) { bestDist = d.dist; bestEdge = i; }
                                        }
                                        // Find nearest corner to possibly delete
                                        let nearestCornerIdx = -1, nearestCornerDist = Infinity;
                                        for (let i = 0; i < slab.polygon.length; i++) {
                                            const d = dist({ x: world.x, y: world.y }, slab.polygon[i]);
                                            if (d < nearestCornerDist) { nearestCornerDist = d; nearestCornerIdx = i; }
                                        }
                                        setSlabContextMenu({
                                            x: e.clientX, y: e.clientY,
                                            worldX: snapToGrid(world.x), worldY: snapToGrid(world.y),
                                            slabId: slab.id, edgeIdx: bestEdge,
                                            nearCornerIdx: slab.polygon.length > 3 ? nearestCornerIdx : -1,
                                        });
                                    }
                                }
                            }}
                        />
                    ) : (
                        <Suspense fallback={
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f8fafc' }}>
                                <Loader2 className="animate-spin" size={32} color="#0ea5e9" />
                            </div>
                        }>
                            <FloorPlan3DView storeys={storeys} activeStoreyIdx={activeStoreyIdx} />
                        </Suspense>
                    )}

                    {/* Slab right-click context menu */}
                    {slabContextMenu && (
                        <div
                            style={{
                                position: 'fixed', left: slabContextMenu.x, top: slabContextMenu.y,
                                background: '#fff', border: '1px solid var(--border-color)',
                                borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                                zIndex: 9999, minWidth: '180px', overflow: 'hidden',
                            }}
                            onMouseLeave={() => setSlabContextMenu(null)}
                        >
                            <button
                                onClick={() => {
                                    const slab = (activeStorey.slabs || []).find(s => s.id === slabContextMenu.slabId);
                                    if (slab) {
                                        slab.polygon.splice(slabContextMenu.edgeIdx + 1, 0, {
                                            x: slabContextMenu.worldX, y: slabContextMenu.worldY,
                                        });
                                        markDirty();
                                        forceRender(n => n + 1);
                                        requestRender();
                                    }
                                    setSlabContextMenu(null);
                                }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                                    padding: '10px 14px', border: 'none', background: 'none',
                                    cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500, textAlign: 'left',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                                <Plus size={14} style={{ color: '#0ea5e9' }} /> Knotenpunkt einfügen
                            </button>
                            {slabContextMenu.nearCornerIdx >= 0 && (
                                <button
                                    onClick={() => {
                                        const slab = (activeStorey.slabs || []).find(s => s.id === slabContextMenu.slabId);
                                        if (slab && slab.polygon.length > 3) {
                                            slab.polygon.splice(slabContextMenu.nearCornerIdx, 1);
                                            markDirty();
                                            forceRender(n => n + 1);
                                            requestRender();
                                        }
                                        setSlabContextMenu(null);
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                                        padding: '10px 14px', border: 'none', background: 'none',
                                        cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500, textAlign: 'left',
                                        color: '#dc2626',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                >
                                    <Trash2 size={14} /> Punkt entfernen
                                </button>
                            )}
                        </div>
                    )}

                    {/* Measure result overlay */}
                    {activeTool === 'measure' && measureResult && (
                        <div style={{
                            position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(14,165,233,0.9)', color: '#fff', padding: '8px 20px',
                            borderRadius: '8px', fontSize: '0.9rem', fontWeight: 700,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)', pointerEvents: 'none',
                        }}>
                            📏 {mmToM(measureResult)} m
                        </div>
                    )}

                    {/* Floating length editing input */}
                    {editingLength && (() => {
                        const wall = activeStorey.walls.find(w => w.id === editingLength.wallId);
                        if (!wall) return null;
                        const p1 = getPoint(activeStorey, wall.p1);
                        const p2 = getPoint(activeStorey, wall.p2);
                        if (!p1 || !p2) return null;

                        // Use stored original direction & p1 for stable length changes
                        const origDx = editingLength.dirX;
                        const origDy = editingLength.dirY;
                        const origP1x = editingLength.p1x;
                        const origP1y = editingLength.p1y;

                        // Position overlay from the STORED screen position (doesn't jump)
                        const ox = editingLength.overlayX;
                        const oy = editingLength.overlayY;

                        const applyLength = (val) => {
                            const newLen = Math.max(100, parseFloat(val) * 1000);
                            if (!isNaN(newLen) && newLen > 0 && origDx !== undefined) {
                                // Apply new length along the original direction
                                p2.x = snapToGrid(origP1x + origDx * newLen);
                                p2.y = snapToGrid(origP1y + origDy * newLen);
                                if (activeStorey.outerClosed) {
                                    const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                                    const pts = buildOrderedPolygon(outerWalls, activeStorey.points);
                                    if (pts && pts.length >= 3) {
                                        const cwPoly = ensureCW(pts);
                                        const thickness = outerWalls[0].thickness_mm;
                                        activeStorey.outerPolygon = [...cwPoly];
                                        activeStorey.outerBoundary = offsetPolygon(cwPoly, -thickness);
                                    }
                                }
                                computeRooms(activeStorey);
                                markDirty();
                                requestRender();
                                forceRender(v => v + 1);
                            }
                        };

                        return (
                            <div style={{
                                position: 'absolute', left: ox + 'px', top: oy + 'px',
                                zIndex: 100, display: 'flex', gap: '2px', alignItems: 'center',
                            }}>
                                <input
                                    type="number"
                                    autoFocus
                                    defaultValue={editingLength.value}
                                    step="0.01"
                                    min="0.10"
                                    onChange={e => {
                                        // Live update as you type
                                        if (e.target.value && !isNaN(parseFloat(e.target.value))) {
                                            applyLength(e.target.value);
                                        }
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            applyLength(e.target.value);
                                            setEditingLength(null);
                                        }
                                        if (e.key === 'Escape') setEditingLength(null);
                                    }}
                                    onBlur={e => {
                                        applyLength(e.target.value);
                                        setEditingLength(null);
                                    }}
                                    style={{
                                        width: '70px', padding: '4px 8px',
                                        border: '2px solid #0ea5e9', borderRadius: '6px',
                                        fontSize: '0.85rem', fontWeight: 700,
                                        background: '#fff', color: '#0c4a6e',
                                        outline: 'none', boxShadow: '0 2px 10px rgba(14,165,233,0.4)',
                                        textAlign: 'center',
                                    }}
                                    onFocus={e => e.target.select()}
                                />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0ea5e9' }}>m</span>
                            </div>
                        );
                    })()}

                    {/* Mobile hint */}
                    {isMobile && (
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '20px 30px', borderRadius: '12px',
                            textAlign: 'center', fontSize: '0.9rem',
                        }}>
                            Der Grundrisseditor ist für Desktop optimiert.
                        </div>
                    )}
                </div>

                {/* Right Properties / Quantities Panel */}
                <div style={{
                    width: '260px', borderLeft: '1px solid var(--border-color)',
                    background: 'var(--surface-color)', overflowY: 'auto',
                    display: isMobile ? 'none' : 'flex', flexDirection: 'column',
                }}>
                    {/* Panel tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                        <button
                            onClick={() => setRightPanel('properties')}
                            style={{
                                flex: 1, padding: '8px', border: 'none', cursor: 'pointer',
                                fontSize: '0.78rem', fontWeight: 600, background: 'none',
                                color: rightPanel === 'properties' ? '#0ea5e9' : 'var(--text-secondary)',
                                borderBottom: rightPanel === 'properties' ? '2px solid #0ea5e9' : '2px solid transparent',
                            }}
                        >
                            Eigenschaften
                        </button>
                        <button
                            onClick={() => setRightPanel('quantities')}
                            style={{
                                flex: 1, padding: '8px', border: 'none', cursor: 'pointer',
                                fontSize: '0.78rem', fontWeight: 600, background: 'none',
                                color: rightPanel === 'quantities' ? '#0ea5e9' : 'var(--text-secondary)',
                                borderBottom: rightPanel === 'quantities' ? '2px solid #0ea5e9' : '2px solid transparent',
                            }}
                        >
                            <List size={13} style={{ marginRight: '4px', verticalAlign: '-2px' }} />Massen
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                        {rightPanel === 'properties' && (<>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Eigenschaften
                            </div>

                            {/* Storey height + reference */}
                            <PropGroup label="Geschoss">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '0.78rem', width: '80px' }}>Raumhöhe:</span>
                                    <input
                                        type="number"
                                        value={activeStorey.height_mm / 1000}
                                        onChange={e => {
                                            const v = Math.max(STOREY_HEIGHT.min, Math.min(STOREY_HEIGHT.max, Math.round(parseFloat(e.target.value) * 1000)));
                                            activeStorey.height_mm = v;
                                            forceRender(v => v + 1);
                                            markDirty();
                                        }}
                                        step="0.05"
                                        min={STOREY_HEIGHT.min / 1000}
                                        max={STOREY_HEIGHT.max / 1000}
                                        style={inputStyle}
                                    />
                                    <span style={unitStyle}>m</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '0.78rem', width: '80px' }}>Ref.-Höhe:</span>
                                    <input
                                        type="number"
                                        value={(activeStorey.ref_height_mm || 0) / 1000}
                                        onChange={e => {
                                            activeStorey.ref_height_mm = Math.round(parseFloat(e.target.value) * 1000) || 0;
                                            forceRender(v => v + 1);
                                            markDirty();
                                        }}
                                        step="0.01"
                                        style={inputStyle}
                                    />
                                    <span style={unitStyle}>m</span>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    Bezugshöhe des Geschosses (0,00 = Erdniveau)
                                </div>
                            </PropGroup>

                            {/* Wall tool: thickness selector */}
                            {(activeTool === TOOLS.OUTER_WALL || activeTool === TOOLS.INNER_WALL) && (
                                <PropGroup label={activeTool === TOOLS.OUTER_WALL ? 'Außenwand' : 'Innenwand'}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '0.78rem', width: '80px' }}>Wandstärke:</span>
                                        {activeTool === TOOLS.OUTER_WALL ? (
                                            <select
                                                value={outerWallThickness}
                                                onChange={e => setOuterWallThickness(Number(e.target.value))}
                                                style={{ ...inputStyle, width: '100px', padding: '4px 6px' }}
                                            >
                                                <option value={175}>17,5 cm</option>
                                                <option value={240}>24 cm</option>
                                                <option value={300}>30 cm</option>
                                                <option value={365}>36,5 cm</option>
                                                <option value={425}>42,5 cm</option>
                                                <option value={490}>49 cm</option>
                                            </select>
                                        ) : (
                                            <select
                                                value={innerWallType}
                                                onChange={e => {
                                                    setInnerWallType(e.target.value);
                                                    setInnerWallThickness(e.target.value === 'inner_load' ? WALL_THICKNESS.innerLoadDefault : WALL_THICKNESS.innerNonloadDefault);
                                                }}
                                                style={{ ...inputStyle, width: '100px', padding: '4px 6px' }}
                                            >
                                                <option value="inner_nonload">11,5 cm</option>
                                                <option value="inner_load">24 cm</option>
                                            </select>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                        {activeTool === TOOLS.OUTER_WALL
                                            ? 'Steinbreite für neue Außenwände'
                                            : innerWallType === 'inner_load' ? 'Tragende Innenwand (24 cm)' : 'Nichttragende Innenwand (11,5 cm)'
                                        }
                                    </div>
                                </PropGroup>
                            )}

                            {/* Annotation tool properties */}
                            {[TOOLS.ANNOTATE_POLYLINE, TOOLS.ANNOTATE_CIRCLE, TOOLS.ANNOTATE_AREA, TOOLS.ANNOTATE_TEXT].includes(activeTool) && (
                                <PropGroup label="Zeichenwerkzeug">
                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '6px' }}>
                                        {activeTool === TOOLS.ANNOTATE_POLYLINE ? 'Polylinie' :
                                            activeTool === TOOLS.ANNOTATE_CIRCLE ? 'Kreis' :
                                                activeTool === TOOLS.ANNOTATE_AREA ? 'Fläche' : 'Textfeld'}
                                    </div>
                                    <div style={{ marginBottom: '8px' }}>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Farbe</div>
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                            {['#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899', '#64748b', '#1e293b'].map(c => (
                                                <button
                                                    key={c}
                                                    onClick={() => setAnnotationColor(c)}
                                                    style={{
                                                        width: '24px', height: '24px', borderRadius: '4px',
                                                        background: c, border: annotationColor === c ? '2px solid #0ea5e9' : '2px solid transparent',
                                                        cursor: 'pointer', padding: 0,
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <input
                                            type="color"
                                            value={annotationColor}
                                            onChange={e => setAnnotationColor(e.target.value)}
                                            style={{ width: '100%', height: '28px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                                        />
                                    </div>
                                    {activeTool !== TOOLS.ANNOTATE_TEXT && (
                                        <div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Linienstärke</div>
                                            <select
                                                value={annotationLineWidth}
                                                onChange={e => setAnnotationLineWidth(Number(e.target.value))}
                                                style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                                            >
                                                <option value={1}>1 px — dünn</option>
                                                <option value={2}>2 px — normal</option>
                                                <option value={3}>3 px — breit</option>
                                                <option value={5}>5 px — extra breit</option>
                                            </select>
                                        </div>
                                    )}
                                    {annotationPoints.length > 0 && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                            {activeAnnotationId
                                                ? `${annotationPoints.length} Punkte — Doppelklick oder ESC zum Beenden`
                                                : `${annotationPoints.length} Punkt gesetzt — klicke für nächsten Punkt`}
                                        </div>
                                    )}
                                    {annotationCircleCenter && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                            Mittelpunkt gesetzt — klicke für Radius
                                        </div>
                                    )}
                                </PropGroup>
                            )}

                            {/* Selected annotation properties */}
                            {selectedType === 'annotation' && selectedId && (() => {
                                const ann = (activeStorey.annotations || []).find(a => a.id === selectedId);
                                if (!ann) return null;
                                return (
                                    <PropGroup label={ann.type === 'polyline' ? 'Polylinie' : ann.type === 'circle' ? 'Kreis' : ann.type === 'area' ? 'Fläche' : 'Textfeld'}>
                                        {ann.type === 'text' && (
                                            <div style={{ marginBottom: '6px' }}>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Text</div>
                                                <input
                                                    type="text"
                                                    value={ann.text}
                                                    onChange={e => { ann.text = e.target.value; forceRender(v => v + 1); markDirty(); requestRender(); }}
                                                    style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                                                />
                                            </div>
                                        )}
                                        <div style={{ marginBottom: '6px' }}>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Farbe</div>
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                                {['#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899', '#64748b', '#1e293b'].map(c => (
                                                    <button
                                                        key={c}
                                                        onClick={() => { ann.color = c; if (ann.type === 'area') ann.fillColor = c + '33'; forceRender(v => v + 1); markDirty(); requestRender(); }}
                                                        style={{
                                                            width: '24px', height: '24px', borderRadius: '4px',
                                                            background: c, border: ann.color === c ? '2px solid #0ea5e9' : '2px solid transparent',
                                                            cursor: 'pointer', padding: 0,
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                        {ann.type !== 'text' && (
                                            <div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Linienstärke</div>
                                                <select
                                                    value={ann.lineWidth || 2}
                                                    onChange={e => { ann.lineWidth = Number(e.target.value); forceRender(v => v + 1); markDirty(); requestRender(); }}
                                                    style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                                                >
                                                    <option value={1}>1 px</option>
                                                    <option value={2}>2 px</option>
                                                    <option value={3}>3 px</option>
                                                    <option value={5}>5 px</option>
                                                </select>
                                            </div>
                                        )}
                                    </PropGroup>
                                );
                            })()}

                            {/* Multi-selection info */}
                            {selectedIds.length > 1 && (
                                <PropGroup label="Mehrfachauswahl">
                                    <div style={{ fontSize: '0.82rem', marginBottom: '8px' }}>
                                        <strong>{selectedIds.length}</strong> Elemente ausgewählt
                                        {(() => {
                                            const walls = selectedIds.filter(s => s.type === 'wall').length;
                                            const openings = selectedIds.filter(s => s.type === 'opening').length;
                                            const furniture = selectedIds.filter(s => s.type === 'furniture').length;
                                            const parts = [];
                                            if (walls > 0) parts.push(`${walls} Wände`);
                                            if (openings > 0) parts.push(`${openings} Öffnungen`);
                                            if (furniture > 0) parts.push(`${furniture} Möbel`);
                                            return parts.length > 0 ? <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{parts.join(', ')}</div> : null;
                                        })()}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button
                                            onClick={handleDeleteSelected}
                                            style={{
                                                ...topBtnStyle, gap: '4px', fontSize: '0.78rem', flex: 1,
                                                background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                            }}
                                        >
                                            <Trash2 size={14} /> Alle löschen
                                        </button>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
                                        Klicke und ziehe zum Verschieben. <kbd style={{ padding: '1px 4px', borderRadius: '3px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}>Entf</kbd> zum Löschen.
                                    </div>
                                </PropGroup>
                            )}

                            {/* Wall properties */}
                            {selectedWall && selectedIds.length <= 1 && (
                                <>
                                    <PropGroup label="Wand">
                                        <div style={{ fontSize: '0.82rem', marginBottom: '6px' }}>
                                            Typ: <strong>{selectedWall.type === 'outer' ? 'Außenwand' : selectedWall.type === 'inner_load' ? 'Tragend' : 'Nichttragend'}</strong>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Dicke:</span>
                                            <input
                                                type="number"
                                                value={selectedWall.thickness_mm / 10}
                                                onChange={e => {
                                                    selectedWall.thickness_mm = Math.max(50, Math.min(500, Math.round(parseFloat(e.target.value) * 10)));
                                                    if (selectedWall.type === 'outer') closeOuterWalls(activeStorey);
                                                    computeRooms(activeStorey);
                                                    forceRender(v => v + 1);
                                                    markDirty();
                                                }}
                                                step="0.5"
                                                style={inputStyle}
                                            />
                                            <span style={unitStyle}>cm</span>
                                        </div>
                                        {(() => {
                                            const pt1 = getPoint(activeStorey, selectedWall.p1);
                                            const pt2 = getPoint(activeStorey, selectedWall.p2);
                                            const len = pt1 && pt2 ? dist(pt1, pt2) : 0;
                                            return (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                                    <span style={{ fontSize: '0.78rem', width: '48px' }}>Länge:</span>
                                                    <input
                                                        type="number"
                                                        value={+(len / 1000).toFixed(3)}
                                                        onChange={e => {
                                                            const newLen = Math.max(0.1, parseFloat(e.target.value)) * 1000; // mm
                                                            if (pt1 && pt2) {
                                                                const currentLen = dist(pt1, pt2);
                                                                if (currentLen > 0) {
                                                                    const dx = pt2.x - pt1.x;
                                                                    const dy = pt2.y - pt1.y;
                                                                    const scale = newLen / currentLen;
                                                                    pt2.x = snapToGrid(pt1.x + dx * scale);
                                                                    pt2.y = snapToGrid(pt1.y + dy * scale);
                                                                    if (activeStorey.outerClosed) {
                                                                        const outerWalls = activeStorey.walls.filter(w => w.type === 'outer');
                                                                        const pts = buildOrderedPolygon(outerWalls, activeStorey.points);
                                                                        if (pts && pts.length >= 3) {
                                                                            const cwPoly = ensureCW(pts);
                                                                            const thickness = outerWalls[0].thickness_mm;
                                                                            activeStorey.outerPolygon = [...cwPoly];
                                                                            activeStorey.outerBoundary = offsetPolygon(cwPoly, -thickness);
                                                                        }
                                                                    }
                                                                    computeRooms(activeStorey);
                                                                    forceRender(v => v + 1);
                                                                    markDirty();
                                                                    requestRender();
                                                                }
                                                            }
                                                        }}
                                                        step="0.01"
                                                        min="0.10"
                                                        style={inputStyle}
                                                    />
                                                    <span style={unitStyle}>m</span>
                                                </div>
                                            );
                                        })()}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Höhe:</span>
                                            <input
                                                type="number"
                                                value={(selectedWall.height_mm || activeStorey.height_mm) / 1000}
                                                onChange={e => {
                                                    selectedWall.height_mm = Math.max(100, Math.round(parseFloat(e.target.value) * 1000));
                                                    forceRender(v => v + 1);
                                                    markDirty();
                                                }}
                                                step="0.05"
                                                style={inputStyle}
                                            />
                                            <span style={unitStyle}>m</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Ref.:</span>
                                            <input
                                                type="number"
                                                value={(selectedWall.ref_height_mm || 0) / 1000}
                                                onChange={e => {
                                                    selectedWall.ref_height_mm = Math.round(parseFloat(e.target.value) * 1000) || 0;
                                                    forceRender(v => v + 1);
                                                    markDirty();
                                                }}
                                                step="0.01"
                                                style={inputStyle}
                                            />
                                            <span style={unitStyle}>m</span>
                                        </div>
                                        {selectedWall.type !== 'outer' && (
                                            <button
                                                onClick={() => { flipWallSide(selectedWall); computeRooms(activeStorey); forceRender(v => v + 1); markDirty(); }}
                                                style={{ ...topBtnStyle, marginTop: '6px', gap: '4px', fontSize: '0.78rem' }}
                                            >
                                                <FlipHorizontal2 size={14} /> Seite wechseln
                                            </button>
                                        )}
                                        <button
                                            onClick={handleDeleteSelected}
                                            style={{
                                                ...topBtnStyle, marginTop: '6px', gap: '4px', fontSize: '0.78rem',
                                                background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                            }}
                                        >
                                            <Trash2 size={14} /> Wand löschen
                                        </button>
                                    </PropGroup>
                                </>
                            )}

                            {/* Opening preset (when door/window tool active) */}
                            {(activeTool === TOOLS.DOOR || activeTool === TOOLS.WINDOW) && (
                                <PropGroup label={activeTool === TOOLS.DOOR ? 'Nächste Tür' : 'Nächstes Fenster'}>
                                    <PropField label="Breite" value={nextOpeningPreset[activeTool === TOOLS.DOOR ? 'door' : 'window'].width / 10} unit="cm"
                                        onChange={v => {
                                            const key = activeTool === TOOLS.DOOR ? 'door' : 'window';
                                            setNextOpeningPreset(prev => ({ ...prev, [key]: { ...prev[key], width: Math.round(v * 10) } }));
                                        }} />
                                    <PropField label="Höhe" value={nextOpeningPreset[activeTool === TOOLS.DOOR ? 'door' : 'window'].height / 10} unit="cm"
                                        onChange={v => {
                                            const key = activeTool === TOOLS.DOOR ? 'door' : 'window';
                                            setNextOpeningPreset(prev => ({ ...prev, [key]: { ...prev[key], height: Math.round(v * 10) } }));
                                        }} />
                                    {activeTool === TOOLS.WINDOW && (
                                        <PropField label="Brüstung" value={nextOpeningPreset.window.sill / 10} unit="cm"
                                            onChange={v => {
                                                setNextOpeningPreset(prev => ({ ...prev, window: { ...prev.window, sill: Math.round(v * 10) } }));
                                            }} />
                                    )}
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        Klicke auf eine Wand um {activeTool === TOOLS.DOOR ? 'die Tür' : 'das Fenster'} zu platzieren.
                                    </div>
                                </PropGroup>
                            )}

                            {/* Opening properties */}
                            {selectedOpening && (
                                <PropGroup label={selectedOpening.type === 'door' ? 'Tür' : 'Fenster'}>
                                    <PropField label="Breite" value={selectedOpening.width_mm / 10} unit="cm"
                                        onChange={v => { selectedOpening.width_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); requestRender(); }} />
                                    <PropField label="Höhe" value={selectedOpening.height_mm / 10} unit="cm"
                                        onChange={v => { selectedOpening.height_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); requestRender(); }} />
                                    {selectedOpening.type === 'window' && (
                                        <PropField label="Brüstung" value={selectedOpening.sill_mm / 10} unit="cm"
                                            onChange={v => { selectedOpening.sill_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); requestRender(); }} />
                                    )}
                                    {selectedOpening.type === 'door' && (
                                        <>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '8px', marginBottom: '2px' }}>Anschlag</div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="swing" checked={selectedOpening.swing === 'left'} onChange={() => { selectedOpening.swing = 'left'; forceRender(n => n + 1); markDirty(); requestRender(); }} /> Links
                                                </label>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="swing" checked={selectedOpening.swing === 'right'} onChange={() => { selectedOpening.swing = 'right'; forceRender(n => n + 1); markDirty(); requestRender(); }} /> Rechts
                                                </label>
                                            </div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px', marginBottom: '2px' }}>Öffnungsrichtung</div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="dir" checked={selectedOpening.direction === 'inward'} onChange={() => { selectedOpening.direction = 'inward'; forceRender(n => n + 1); markDirty(); requestRender(); }} /> Innen
                                                </label>
                                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                    <input type="radio" name="dir" checked={selectedOpening.direction === 'outward'} onChange={() => { selectedOpening.direction = 'outward'; forceRender(n => n + 1); markDirty(); requestRender(); }} /> Außen
                                                </label>
                                            </div>
                                        </>
                                    )}
                                    <button
                                        onClick={handleDeleteSelected}
                                        style={{
                                            ...topBtnStyle, marginTop: '8px', gap: '4px', fontSize: '0.78rem',
                                            background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                        }}
                                    >
                                        <Trash2 size={14} /> {selectedOpening.type === 'door' ? 'Tür' : 'Fenster'} löschen
                                    </button>
                                </PropGroup>
                            )}

                            {/* Furniture properties */}
                            {selectedFurniture && (() => {
                                const catItem = getFurnitureItem(selectedFurniture.catalog_id);
                                return (
                                    <PropGroup label={catItem?.name || 'Möbel'}>
                                        <PropField label="Breite" value={selectedFurniture.width_mm / 10} unit="cm"
                                            min={catItem ? catItem.minWidth / 10 : 10} max={catItem ? catItem.maxWidth / 10 : 1000}
                                            onChange={v => { selectedFurniture.width_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                        <PropField label="Tiefe" value={selectedFurniture.depth_mm / 10} unit="cm"
                                            min={catItem ? catItem.minDepth / 10 : 10} max={catItem ? catItem.maxDepth / 10 : 1000}
                                            onChange={v => { selectedFurniture.depth_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                        <PropField label="Höhe" value={selectedFurniture.height_mm / 10} unit="cm"
                                            onChange={v => { selectedFurniture.height_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                            <span style={{ fontSize: '0.78rem', width: '48px' }}>Rotation:</span>
                                            <select
                                                value={selectedFurniture.rotation}
                                                onChange={e => { selectedFurniture.rotation = Number(e.target.value); forceRender(n => n + 1); markDirty(); }}
                                                style={inputStyle}
                                            >
                                                {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
                                                    <option key={a} value={a}>{a}°</option>
                                                ))}
                                            </select>
                                        </div>
                                        <button
                                            onClick={handleDeleteSelected}
                                            style={{
                                                ...topBtnStyle, marginTop: '8px', gap: '4px', fontSize: '0.78rem',
                                                background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca',
                                            }}
                                        >
                                            <Trash2 size={14} /> Möbel löschen
                                        </button>
                                    </PropGroup>
                                );
                            })()}

                            {/* Room properties */}
                            {selectedRoom && (
                                <PropGroup label="Raum">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                        <input
                                            type="text"
                                            value={selectedRoom.name}
                                            onChange={e => { selectedRoom.name = e.target.value; forceRender(n => n + 1); markDirty(); }}
                                            style={{ ...inputStyle, flex: 1 }}
                                        />
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                        Fläche: <strong>{mm2ToM2(selectedRoom.area_mm2)} m²</strong>
                                    </div>
                                </PropGroup>
                            )}

                            {/* Slab properties */}
                            {selectedSlab && (
                                <PropGroup label="Decke / Bodenplatte">
                                    <div style={{ marginBottom: '6px' }}>
                                        <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Bezeichnung</label>
                                        <input
                                            type="text" value={selectedSlab.name || ''}
                                            onChange={e => { selectedSlab.name = e.target.value; forceRender(n => n + 1); markDirty(); }}
                                            style={{
                                                width: '100%', padding: '4px 8px', fontSize: '0.82rem',
                                                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                                                background: 'var(--surface-color)', color: 'var(--text-primary)',
                                            }}
                                        />
                                    </div>
                                    <PropField label="Dicke" value={selectedSlab.thickness_mm / 10} unit="cm"
                                        onChange={v => { selectedSlab.thickness_mm = Math.round(v * 10); forceRender(n => n + 1); markDirty(); }} />
                                    <PropField label="Referenzhöhe" value={selectedSlab.ref_height_mm / 1000} unit="m"
                                        onChange={v => { selectedSlab.ref_height_mm = Math.round(v * 1000); forceRender(n => n + 1); markDirty(); }} />
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        {selectedSlab.ref_height_mm >= 0
                                            ? `↑ ${(selectedSlab.ref_height_mm / 1000).toFixed(2)} m über 0,00 (Decke)`
                                            : `↓ ${Math.abs(selectedSlab.ref_height_mm / 1000).toFixed(2)} m unter 0,00 (Bodenplatte)`}
                                    </div>
                                    <button
                                        onClick={() => {
                                            activeStorey.slabs = (activeStorey.slabs || []).filter(s => s.id !== selectedSlab.id);
                                            setSelectedId(null); setSelectedType(null);
                                            markDirty(); forceRender(v => v + 1); requestRender();
                                        }}
                                        style={{
                                            marginTop: '10px', width: '100%', padding: '6px', fontSize: '0.78rem',
                                            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                                            background: '#fef2f2', color: '#ef4444', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                        }}
                                    >
                                        <Trash2 size={14} /> Löschen
                                    </button>
                                </PropGroup>
                            )}

                            {/* Slab list */}
                            {(activeStorey.slabs || []).length > 0 && !selectedSlab && (
                                <PropGroup label="Decken / Bodenplatten">
                                    {(activeStorey.slabs || []).map(s => (
                                        <button key={s.id}
                                            onClick={() => { setSelectedId(s.id); setSelectedType('slab'); }}
                                            style={{
                                                width: '100%', padding: '6px 8px', marginBottom: '4px',
                                                fontSize: '0.78rem', textAlign: 'left',
                                                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                                                background: selectedId === s.id ? '#e0f2fe' : 'var(--surface-color)',
                                                color: 'var(--text-primary)', cursor: 'pointer',
                                            }}
                                        >
                                            {s.name || 'Platte'} — {(s.ref_height_mm / 1000).toFixed(2)} m · {s.thickness_mm / 10} cm
                                        </button>
                                    ))}
                                </PropGroup>
                            )}

                            {/* No selection */}
                            {!selectedWall && !selectedOpening && !selectedFurniture && !selectedRoom && !selectedSlab && (
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                    Wähle ein Element aus um seine Eigenschaften zu bearbeiten.
                                </div>
                            )}
                        </>)}

                        {/* Quantities Panel */}
                        {rightPanel === 'quantities' && (
                            <QuantitiesPanel storeys={storeys} activeStoreyIdx={activeStoreyIdx} />
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Status Bar ─────────────────────────────────────── */}
            <div style={{
                borderTop: '1px solid var(--border-color)', padding: '6px 16px',
                background: 'var(--surface-color)', fontSize: '0.78rem',
                color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between',
            }}>
                <span>{activeTool === 'measure' ? 'Klicke 2 Punkte um den Abstand zu messen' : (TOOL_HINTS[activeTool] || '')}</span>
                <span>
                    {[activeStorey.walls.length > 0 && `${activeStorey.walls.length} Wände`, activeStorey.rooms.length > 0 && `${activeStorey.rooms.length} Räume`, activeStorey.openings.length > 0 && `${activeStorey.openings.length} Öffnungen`, (activeStorey.slabs || []).length > 0 && `${(activeStorey.slabs || []).length} Decken`].filter(Boolean).join(' · ') || 'Keine Elemente'}
                </span>
            </div>
        </div>
    );
};

// ─── Sub-components ─────────────────────────────────────────────

const PropGroup = ({ label, children }) => (
    <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>{label}</div>
        {children}
    </div>
);

const PropField = ({ label, value, unit, onChange, min, max, step = 0.5 }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.78rem', width: '54px', flexShrink: 0 }}>{label}:</span>
        <input
            type="number"
            value={value}
            onChange={e => onChange(parseFloat(e.target.value))}
            step={step}
            min={min}
            max={max}
            style={inputStyle}
        />
        <span style={unitStyle}>{unit}</span>
    </div>
);

// ─── Styles ─────────────────────────────────────────────────────

const topBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: '2px',
    padding: '6px 10px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)', background: 'var(--surface-color)',
    cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.82rem',
    transition: 'all 0.15s',
};

const inputStyle = {
    width: '72px', padding: '4px 6px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)', fontSize: '0.82rem',
    background: 'var(--surface-color)',
};

const unitStyle = {
    fontSize: '0.72rem', color: 'var(--text-secondary)', flexShrink: 0,
};

const getCursor = (tool, panning) => {
    if (panning) return 'grabbing';
    switch (tool) {
        case TOOLS.SELECT: return 'default';
        case TOOLS.OUTER_WALL:
        case TOOLS.INNER_WALL:
        case TOOLS.SLAB: return 'crosshair';
        case TOOLS.DOOR:
        case TOOLS.WINDOW: return 'copy';
        case TOOLS.FURNITURE: return 'cell';
        case TOOLS.DELETE: return 'not-allowed';
        case 'measure': return 'crosshair';
        case TOOLS.ROOF: return 'default';
        case TOOLS.ANNOTATE_POLYLINE:
        case TOOLS.ANNOTATE_CIRCLE:
        case TOOLS.ANNOTATE_AREA:
        case TOOLS.ANNOTATE_TEXT: return 'crosshair';
        default: return 'default';
    }
};

// ─── Export Menu Item ───────────────────────────────────────────

const ExportMenuItem = ({ icon: Icon, label, sublabel, onClick }) => (
    <button
        onClick={onClick}
        style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 14px', border: 'none', cursor: 'pointer',
            background: 'none', width: '100%', textAlign: 'left',
            transition: 'background 0.1s', fontSize: '0.85rem',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
        <Icon size={16} style={{ color: '#64748b', flexShrink: 0 }} />
        <div>
            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{label}</div>
            {sublabel && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{sublabel}</div>}
        </div>
    </button>
);

// ─── Quantities Panel ───────────────────────────────────────────

const QuantitiesPanel = ({ storeys, activeStoreyIdx }) => {
    const data = useMemo(() => generateQuantityList(storeys), [storeys]);
    const activeSt = data.storeys[activeStoreyIdx];

    return (
        <div>
            {/* Totals */}
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>Gesamtübersicht</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '16px' }}>
                <QStatCard label="Räume" value={data.totals.roomCount} />
                <QStatCard label="Fläche" value={`${data.totals.floorArea_m2} m²`} />
                <QStatCard label="Wandlänge" value={`${data.totals.wallLength_m} m`} />
                <QStatCard label="Wandfläche" value={`${data.totals.wallArea_m2} m²`} />
                <QStatCard label="Türen" value={data.totals.doorCount} />
                <QStatCard label="Fenster" value={data.totals.windowCount} />
            </div>

            {/* Active storey details */}
            {activeSt && (
                <>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>{activeSt.label}</div>

                    {activeSt.rooms.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', color: '#0ea5e9' }}>Räume</div>
                            {activeSt.rooms.map((r, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '2px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <span>{r.name}</span>
                                    <span style={{ fontWeight: 600 }}>{r.area_m2} m²</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeSt.walls.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', color: '#0ea5e9' }}>Wände</div>
                            {activeSt.walls.map((w, i) => (
                                <div key={i} style={{ fontSize: '0.75rem', padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>{w.type}</span>
                                        <span style={{ fontWeight: 600 }}>{w.length_m} m</span>
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                        {w.thickness_cm} cm × {w.height_m} m = {w.area_m2} m²
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeSt.openings.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px', color: '#0ea5e9' }}>Öffnungen</div>
                            {activeSt.openings.map((o, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '2px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <span>{o.type}</span>
                                    <span style={{ fontWeight: 600 }}>{o.width_cm}×{o.height_cm} cm</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const QStatCard = ({ label, value }) => (
    <div style={{
        background: '#f8fafc', borderRadius: '6px', padding: '6px 8px',
        border: '1px solid #e2e8f0', textAlign: 'center',
    }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{label}</div>
    </div>
);

export default FloorPlanEditor;
