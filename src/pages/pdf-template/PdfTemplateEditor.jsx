import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
    ArrowLeft, Save, Undo2, Redo2, FileText, Lock,
    ZoomIn, ZoomOut, Loader2, Image, Monitor, Smartphone,
    Move, Trash2, RotateCcw, AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useViewMode } from '../../context/ViewModeContext';
import {
    A4_W, A4_H, HEADER_H, FOOTER_H, MM_TO_PX,
    MARGIN_OPTIONS, DEFAULT_MARGIN, SNAP_GRID,
    REPORT_TITLE_MAP, ZOOM_LEVELS,
    EL_TYPES, MAX_FREETEXT, MAX_LINES, MAX_LOGOS,
    getPresetElements, elementDefaults,
    getPageDims, DEFAULT_ORIENTATION_BY_REPORT, convertElements,
} from './constants';

// ─── Helpers ────────────────────────────────────────────────────────
const snap = (v) => Math.round(v / SNAP_GRID) * SNAP_GRID;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const uid = () => `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const labelForType = (type) => {
    const map = {
        logo: 'Logo', title: 'Reporttitel', subtitle: 'Subtitel',
        portfolio_name: 'Portfolio-Name', date: 'Datum',
        page_number: 'Seitenzahl', line: 'Linie', freetext: 'Freitext',
    };
    return map[type] || type;
};

// ─── Main Component ─────────────────────────────────────────────────
const PdfTemplateEditor = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const { isMobile } = useViewMode();
    const [searchParams] = useSearchParams();

    // Where to go back to (from ExportDropdown or Settings)
    const backPath = location.state?.from || '/settings';

    // State
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [templateId, setTemplateId] = useState(null);

    // Template data
    const [margin, setMargin] = useState(DEFAULT_MARGIN);
    const [elements, setElements] = useState([]);
    const [accentColor, setAccentColor] = useState('#0ea5e9');
    const [subtitlesByReport, setSubtitlesByReport] = useState({});
    const [logoUrl, setLogoUrl] = useState(null);

    // Global orientation (one for all reports)
    const [currentOrientation, setCurrentOrientation] = useState('portrait');
    const [collisionWarning, setCollisionWarning] = useState(false);

    // UI state
    const [selectedId, setSelectedId] = useState(null);
    const [activeZone, setActiveZone] = useState('header');
    const [zoom, setZoom] = useState(isMobile ? 0.6 : 1);
    const [rightTab, setRightTab] = useState('elements'); // 'elements' | 'properties'
    const [uploadingLogo, setUploadingLogo] = useState(false);

    // History (Undo/Redo)
    const [history, setHistory] = useState([]);
    const [historyIdx, setHistoryIdx] = useState(-1);
    const skipHistoryRef = useRef(false);

    // Drag state
    const [dragging, setDragging] = useState(null);
    const previewRef = useRef(null);

    const selectedPortfolio = portfolios.find(p => p.id === selectedPortfolioID);

    const pageDims = getPageDims(currentOrientation);
    const pageW = pageDims.w;
    const pageH = pageDims.h;

    // ─── History Management ────────────────────────
    const pushHistory = useCallback((els) => {
        if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
        setHistory(prev => {
            const next = [...prev.slice(0, historyIdx + 1), JSON.stringify(els)];
            if (next.length > 50) next.shift();
            return next;
        });
        setHistoryIdx(prev => Math.min(prev + 1, 49));
    }, [historyIdx]);

    const undo = useCallback(() => {
        if (historyIdx <= 0) return;
        const newIdx = historyIdx - 1;
        skipHistoryRef.current = true;
        setElements(JSON.parse(history[newIdx]));
        setHistoryIdx(newIdx);
        setDirty(true);
    }, [history, historyIdx]);

    const redo = useCallback(() => {
        if (historyIdx >= history.length - 1) return;
        const newIdx = historyIdx + 1;
        skipHistoryRef.current = true;
        setElements(JSON.parse(history[newIdx]));
        setHistoryIdx(newIdx);
        setDirty(true);
    }, [history, historyIdx]);

    // ─── Update elements with history ────────────
    const updateElements = useCallback((newEls) => {
        setElements(newEls);
        pushHistory(newEls);
        setDirty(true);
    }, [pushHistory]);

    // ─── Collision Detection ─────────────────────
    const checkCollision = useCallback((el, allElements) => {
        for (const other of allElements) {
            if (other.id === el.id || !other.visible) continue;
            if (other.zone !== el.zone) continue;
            const ax1 = el.x, ay1 = el.y, ax2 = el.x + el.w, ay2 = el.y + (el.h || 0.5);
            const bx1 = other.x, by1 = other.y, bx2 = other.x + other.w, by2 = other.y + (other.h || 0.5);
            if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
        }
        return false;
    }, []);

    // ─── Zone boundaries (orientation-aware) ────
    const getZoneBounds = useCallback((zone) => {
        if (zone === 'header') return { minY: 0, maxY: HEADER_H };
        if (zone === 'footer') return { minY: pageH - FOOTER_H, maxY: pageH };
        return { minY: 0, maxY: pageH };
    }, [pageH]);

    // ─── Clamp element within bounds ───────────
    const clampElement = useCallback((el) => {
        const bounds = getZoneBounds(el.zone);
        const x = clamp(el.x, margin, pageW - margin - el.w);
        const y = clamp(el.y, bounds.minY, bounds.maxY - (el.h || 0.5));
        return { ...el, x: snap(x), y: snap(y) };
    }, [margin, pageW, getZoneBounds]);

    // ─── Move element ──────────────────────────
    const moveElement = useCallback((id, dx, dy) => {
        setElements(prev => {
            const idx = prev.findIndex(e => e.id === id);
            if (idx < 0) return prev;
            const el = { ...prev[idx] };
            const newEl = clampElement({ ...el, x: el.x + dx, y: el.y + dy });
            const test = prev.map((e, i) => i === idx ? newEl : e);
            if (checkCollision(newEl, test)) return prev; // blocked
            pushHistory(test);
            setDirty(true);
            return test;
        });
    }, [clampElement, checkCollision, pushHistory]);

    // ─── Update single element property ────────
    const updateElement = useCallback((id, updates) => {
        setElements(prev => {
            const idx = prev.findIndex(e => e.id === id);
            if (idx < 0) return prev;
            let newEl = { ...prev[idx], ...updates };
            // If logo aspect locked
            if (newEl.type === EL_TYPES.LOGO && updates.w !== undefined && newEl.aspectRatio) {
                newEl.h = Math.round(newEl.w / newEl.aspectRatio * 10) / 10;
            }
            newEl = clampElement(newEl);
            const test = prev.map((e, i) => i === idx ? newEl : e);
            if (updates.x !== undefined || updates.y !== undefined || updates.w !== undefined) {
                if (checkCollision(newEl, test)) return prev;
            }
            pushHistory(test);
            setDirty(true);
            return test;
        });
    }, [clampElement, checkCollision, pushHistory]);

    // ─── Add element (orientation-aware) ────────
    const addElement = useCallback((type) => {
        const def = elementDefaults(type, margin, currentOrientation);
        const el = { ...def, id: uid(), zone: activeZone };
        const clamped = clampElement(el);
        setElements(prev => {
            if (type === EL_TYPES.FREETEXT && prev.filter(e => e.type === EL_TYPES.FREETEXT).length >= MAX_FREETEXT) return prev;
            if (type === EL_TYPES.LINE && prev.filter(e => e.type === EL_TYPES.LINE).length >= MAX_LINES) return prev;
            const newEls = [...prev, clamped];
            pushHistory(newEls);
            setDirty(true);
            return newEls;
        });
        setSelectedId(clamped.id);
        setRightTab('properties');
    }, [margin, activeZone, currentOrientation, clampElement, pushHistory]);

    // ─── Remove element ────────────────────────
    const removeElement = useCallback((id) => {
        setElements(prev => {
            const el = prev.find(e => e.id === id);
            // Don't allow removing core elements
            if (el && [EL_TYPES.TITLE, EL_TYPES.PAGE_NUMBER].includes(el.type)) return prev;
            const newEls = prev.filter(e => e.id !== id);
            pushHistory(newEls);
            setDirty(true);
            return newEls;
        });
        if (selectedId === id) setSelectedId(null);
    }, [selectedId, pushHistory]);

    // ─── Apply Preset (orientation-aware) ───────
    const applyPreset = useCallback((presetKey) => {
        const newEls = getPresetElements(presetKey, currentOrientation);
        setMargin(15);
        setElements(newEls);
        pushHistory(newEls);
        setDirty(true);
        setSelectedId(null);
    }, [currentOrientation, pushHistory]);

    // ─── Switch Orientation (global) ──────────────
    const switchOrientation = useCallback((newOri) => {
        const oldOri = currentOrientation;
        if (oldOri === newOri) return;

        // Proportional conversion
        let newEls = convertElements(elements, oldOri, newOri);
        const newPage = getPageDims(newOri);
        newEls = newEls.map(el => {
            const bounds = el.zone === 'footer'
                ? { minY: newPage.h - FOOTER_H, maxY: newPage.h }
                : { minY: 0, maxY: HEADER_H };
            return {
                ...el,
                x: snap(clamp(el.x, margin, newPage.w - margin - el.w)),
                y: snap(clamp(el.y, bounds.minY, bounds.maxY - (el.h || 0.5))),
            };
        });

        // Check collisions and warn
        let hasCollision = false;
        for (const el of newEls) {
            for (const other of newEls) {
                if (other.id === el.id || !other.visible || other.zone !== el.zone) continue;
                if (el.x < other.x + other.w && el.x + el.w > other.x && el.y < other.y + (other.h || 0.5) && el.y + (el.h || 0.5) > other.y) {
                    hasCollision = true; break;
                }
            }
            if (hasCollision) break;
        }
        setCollisionWarning(hasCollision);
        if (hasCollision) setTimeout(() => setCollisionWarning(false), 4000);

        setCurrentOrientation(newOri);
        setElements(newEls);
        pushHistory(newEls);
        setDirty(true);
        setSelectedId(null);
    }, [currentOrientation, elements, margin, pushHistory]);

    // ─── Load Template ─────────────────────────
    useEffect(() => {
        if (!user || !selectedPortfolioID) { setLoading(false); return; }
        const load = async () => {
            try {
                const { data } = await supabase
                    .from('pdf_templates')
                    .select('*')
                    .eq('portfolio_id', selectedPortfolioID)
                    .single();

                if (data) {
                    setTemplateId(data.id);
                    setMargin(data.margin_mm || DEFAULT_MARGIN);
                    setAccentColor(data.accent_color || '#0ea5e9');
                    setSubtitlesByReport(data.subtitles_by_report_type || {});
                    setLogoUrl(data.logo_url || null);
                    // Load global orientation
                    const ori = data.orientation_by_report_type || {};
                    // Use the first stored orientation as global, or default to portrait
                    const globalOri = Object.values(ori)[0] || 'portrait';
                    setCurrentOrientation(globalOri);
                    // Load global elements
                    const initEls = data.elements || [];
                    setElements(initEls);
                    pushHistory(initEls);
                } else {
                    applyPreset('standard');
                }
            } catch {
                applyPreset('standard');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [user, selectedPortfolioID]);

    // ─── Save Template ─────────────────────────
    const handleSave = async () => {
        if (!user || !selectedPortfolioID) return;
        setSaving(true);
        try {
            // Build a consistent orientation map for all report types (global orientation)
            const orientationMap = {};
            ['immobilien', 'einheiten', 'mietverhaeltnisse', 'bankaufstellung', 'offene_mieten', 'buchhaltung', 'kpi', 'deals', 'deal_kalkulation', 'finanzierungen', 'sanierung', 'sanierung_rechner'].forEach(rt => {
                orientationMap[rt] = currentOrientation;
            });
            const payload = {
                portfolio_id: selectedPortfolioID,
                user_id: user.id,
                margin_mm: margin,
                header_height_mm: HEADER_H,
                footer_height_mm: FOOTER_H,
                accent_color: accentColor,
                elements,
                orientation_by_report_type: orientationMap,
                elements_by_report_orientation: {},
                subtitles_by_report_type: subtitlesByReport,
                logo_url: logoUrl,
                updated_at: new Date().toISOString(),
                updated_by: user.id,
            };
            if (templateId) {
                await supabase.from('pdf_templates').update(payload).eq('id', templateId);
            } else {
                const { data } = await supabase.from('pdf_templates').insert(payload).select().single();
                if (data) setTemplateId(data.id);
            }
            setDirty(false);
        } catch (err) {
            alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // ─── Logo Upload ───────────────────────────
    const handleLogoUpload = async (file) => {
        if (!file || !selectedPortfolioID) return;
        setUploadingLogo(true);
        try {
            const ext = file.name.split('.').pop();
            const path = `logos/${selectedPortfolioID}/logo_${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage.from('pdf-assets').upload(path, file, { upsert: true });
            if (upErr) throw upErr;
            const { data: urlData } = supabase.storage.from('pdf-assets').getPublicUrl(path);
            setLogoUrl(urlData.publicUrl);
            setDirty(true);
        } catch (err) {
            alert('Logo-Upload fehlgeschlagen: ' + err.message);
        } finally {
            setUploadingLogo(false);
        }
    };

    // ─── Test PDF ──────────────────────────────
    const handleTestPdf = () => {
        // MVP: Open a new tab with a styled HTML preview
        const w = window.open('', '_blank');
        if (!w) return;
        const headerEls = elements.filter(e => e.zone === 'header' && e.visible);
        const footerEls = elements.filter(e => e.zone === 'footer' && e.visible);
        const portfolioName = selectedPortfolio?.name || 'Mein Portfolio';
        const title = 'Immobilienübersicht';
        const subtitle = subtitlesByReport['global'] || '';
        const today = new Date().toLocaleDateString('de-DE');

        const renderEl = (el) => {
            const left = el.x * MM_TO_PX;
            const top = el.y * MM_TO_PX;
            const width = el.w * MM_TO_PX;
            const height = (el.h || 5) * MM_TO_PX;
            const style = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-family:Inter,sans-serif;`;

            switch (el.type) {
                case 'title': return `<div style="${style}font-size:${el.fontSize}pt;font-weight:${el.fontWeight};color:${el.color};text-align:${el.align}">${title}</div>`;
                case 'subtitle': return `<div style="${style}font-size:${el.fontSize}pt;color:${el.color};text-align:${el.align}">${subtitle}</div>`;
                case 'portfolio_name': return `<div style="${style}font-size:${el.fontSize}pt;color:${el.color}">${portfolioName}</div>`;
                case 'date': return `<div style="${style}font-size:${el.fontSize}pt;color:${el.color}">Stichtag: ${today}</div>`;
                case 'page_number': return `<div style="${style}font-size:${el.fontSize}pt;color:${el.color};text-align:${el.align}">Seite 1 von 1</div>`;
                case 'line': return `<div style="${style}border-top:1px solid ${el.color}"></div>`;
                case 'logo': return logoUrl ? `<img src="${logoUrl}" style="${style}object-fit:contain" />` : `<div style="${style}background:#f3f4f6;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:10px;color:#999">Logo</div>`;
                case 'freetext': return `<div style="${style}font-size:${el.fontSize}pt;color:${el.color};text-align:${el.align}">${el.text || ''}</div>`;
                default: return '';
            }
        };

        const sizeStr = currentOrientation === 'landscape' ? 'A4 landscape' : 'A4';
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test PDF – ${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>@page{size:${sizeStr};margin:0}body{margin:0;font-family:Inter,sans-serif}
.page{width:${pageW}mm;height:${pageH}mm;position:relative;margin:0 auto;background:#fff;box-shadow:0 2px 20px rgba(0,0,0,.1)}
.content{position:absolute;left:${margin * MM_TO_PX}px;right:${margin * MM_TO_PX}px;top:${HEADER_H * MM_TO_PX}px;bottom:${FOOTER_H * MM_TO_PX}px;padding-top:10px}
table{width:100%;border-collapse:collapse;font-size:9pt}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f8f9fa;font-weight:600}
</style></head><body><div class="page">
${headerEls.map(renderEl).join('')}
<div class="content">
<table><thead><tr><th>Nr.</th><th>Bezeichnung</th><th>Adresse</th><th>Wert</th></tr></thead>
<tbody><tr><td>1</td><td>Musterstraße 1</td><td>12345 Musterstadt</td><td>250.000 €</td></tr>
<tr><td>2</td><td>Beispielweg 5</td><td>54321 Beispielort</td><td>180.000 €</td></tr>
<tr><td>3</td><td>Testgasse 10</td><td>99999 Testheim</td><td>320.000 €</td></tr></tbody></table>
</div>
${footerEls.map(renderEl).join('')}
</div></body></html>`;
        w.document.write(html);
        w.document.close();
    };

    // ─── Drag Handling ─────────────────────────
    const handlePointerDown = useCallback((e, elId) => {
        e.preventDefault();
        e.stopPropagation();
        const el = elements.find(el => el.id === elId);
        if (!el || el.zone !== activeZone) return;
        setSelectedId(elId);
        setRightTab('properties');
        const rect = previewRef.current?.getBoundingClientRect();
        if (!rect) return;
        const scale = zoom * MM_TO_PX;
        setDragging({
            id: elId,
            startX: (e.clientX || e.touches?.[0]?.clientX) - rect.left,
            startY: (e.clientY || e.touches?.[0]?.clientY) - rect.top,
            origX: el.x,
            origY: el.y,
        });
    }, [elements, activeZone, zoom]);

    useEffect(() => {
        if (!dragging) return;
        const scale = zoom * MM_TO_PX;
        const onMove = (e) => {
            const rect = previewRef.current?.getBoundingClientRect();
            if (!rect) return;
            const cx = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
            const cy = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
            const dxMm = (cx - dragging.startX) / scale;
            const dyMm = (cy - dragging.startY) / scale;
            const newX = snap(dragging.origX + dxMm);
            const newY = snap(dragging.origY + dyMm);

            setElements(prev => {
                const idx = prev.findIndex(e => e.id === dragging.id);
                if (idx < 0) return prev;
                const el = prev[idx];
                const clamped = clampElement({ ...el, x: newX, y: newY });
                const test = prev.map((e, i) => i === idx ? clamped : e);
                if (checkCollision(clamped, test)) return prev;
                return test;
            });
        };
        const onUp = () => {
            setElements(prev => { pushHistory(prev); return prev; });
            setDirty(true);
            setDragging(null);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };
    }, [dragging, zoom, clampElement, checkCollision, pushHistory]);

    // ─── Unsaved changes warning ───────────────
    useEffect(() => {
        const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    // ─── Keyboard shortcuts ────────────────────
    useEffect(() => {
        const handler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
            if (selectedId && !e.ctrlKey) {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowLeft') { e.preventDefault(); moveElement(selectedId, -step, 0); }
                if (e.key === 'ArrowRight') { e.preventDefault(); moveElement(selectedId, step, 0); }
                if (e.key === 'ArrowUp') { e.preventDefault(); moveElement(selectedId, 0, -step); }
                if (e.key === 'ArrowDown') { e.preventDefault(); moveElement(selectedId, 0, step); }
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                        e.preventDefault(); removeElement(selectedId);
                    }
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedId, undo, redo, moveElement, removeElement]);

    const selectedEl = elements.find(e => e.id === selectedId);
    const headerEls = elements.filter(e => e.zone === 'header');
    const footerEls = elements.filter(e => e.zone === 'footer');
    const currentTitle = 'Reporttitel';
    const currentSubtitle = subtitlesByReport['global'] || '';
    const portfolioName = selectedPortfolio?.name || 'Portfolio';
    const orientationLabel = currentOrientation === 'landscape' ? 'Querformat' : 'Hochformat';

    // ─── Count helpers ─────────────────────────
    const freetextCount = elements.filter(e => e.type === EL_TYPES.FREETEXT).length;
    const lineCount = elements.filter(e => e.type === EL_TYPES.LINE).length;

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '100px' }}>
            <Loader2 className="animate-spin" size={32} />
        </div>
    );

    if (!selectedPortfolioID) return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
            <FileText size={48} style={{ color: 'var(--text-secondary)', marginBottom: '16px' }} />
            <h2 style={{ marginBottom: '8px' }}>Kein Portfolio ausgewählt</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Bitte wähle ein Portfolio aus, um die PDF-Vorlage zu bearbeiten.</p>
        </div>
    );

    // ─── Scale factor for preview ──────────────
    const scale = zoom * MM_TO_PX;

    // ─── Render element on canvas ──────────────
    const renderElement = (el) => {
        if (!el.visible) return null;
        const isSelected = el.id === selectedId;
        const inActiveZone = el.zone === activeZone;
        const left = el.x * scale;
        const top = el.y * scale;
        const width = el.w * scale;
        const height = (el.h || 0.5) * scale;

        const boxStyle = {
            position: 'absolute', left, top, width, height,
            cursor: inActiveZone ? 'move' : 'default',
            outline: isSelected ? `2px solid ${accentColor}` : (inActiveZone ? '1px dashed rgba(0,0,0,0.15)' : 'none'),
            borderRadius: '1px',
            opacity: inActiveZone ? 1 : 0.4,
            userSelect: 'none', touchAction: 'none',
            zIndex: isSelected ? 10 : 1,
            boxSizing: 'border-box',
            overflow: 'hidden',
        };

        const textStyle = {
            fontFamily: 'Inter, sans-serif',
            fontSize: `${(el.fontSize || 10) * zoom}pt`,
            fontWeight: el.fontWeight || 'normal',
            color: el.color || '#333',
            textAlign: el.align || 'left',
            lineHeight: 1.3,
            width: '100%',
        };

        let content;
        switch (el.type) {
            case EL_TYPES.LOGO:
                content = logoUrl
                    ? <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
                    : <div style={{ width: '100%', height: '100%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', fontSize: `${9 * zoom}pt`, color: '#aaa' }}>Logo</div>;
                break;
            case EL_TYPES.TITLE:
                content = <div style={textStyle}>{currentTitle}</div>;
                break;
            case EL_TYPES.SUBTITLE:
                content = <div style={textStyle}>{currentSubtitle || 'Subtitel…'}</div>;
                break;
            case EL_TYPES.PORTFOLIO_NAME:
                content = <div style={textStyle}>{portfolioName}</div>;
                break;
            case EL_TYPES.DATE:
                content = <div style={textStyle}>Stichtag: {new Date().toLocaleDateString('de-DE')}</div>;
                break;
            case EL_TYPES.PAGE_NUMBER:
                content = <div style={textStyle}>Seite 1 von 1</div>;
                break;
            case EL_TYPES.LINE:
                content = <div style={{ width: '100%', borderTop: `1px solid ${el.color || '#ccc'}` }} />;
                break;
            case EL_TYPES.FREETEXT:
                content = <div style={textStyle}>{el.text || 'Freitext'}</div>;
                break;
            default: content = null;
        }

        return (
            <div
                key={el.id}
                style={boxStyle}
                onPointerDown={inActiveZone ? (e) => handlePointerDown(e, el.id) : undefined}
                onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); setRightTab('properties'); }}
            >
                {content}
                {/* Resize handle for non-line scalable elements */}
                {isSelected && inActiveZone && el.type !== EL_TYPES.LINE && (
                    <div style={{
                        position: 'absolute', right: -4, bottom: -4, width: 8, height: 8,
                        background: accentColor, borderRadius: '50%', cursor: 'se-resize',
                    }} />
                )}
            </div>
        );
    };

    // ─── TOOLBAR ─────────────────────────────────
    const toolbarStyle = {
        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
        padding: '10px 16px', background: 'var(--glass-bg)', backdropFilter: 'blur(12px)',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)',
        boxShadow: 'var(--shadow-sm)', marginBottom: '16px',
    };

    const selectStyle = {
        padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
        background: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.8rem',
        cursor: 'pointer',
    };

    const toggleBtnStyle = (active) => ({
        padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)',
        background: active ? accentColor : 'var(--surface-color)',
        color: active ? '#fff' : 'var(--text-primary)',
        fontSize: '0.78rem', fontWeight: active ? 600 : 400, cursor: 'pointer',
        transition: 'all 0.15s',
    });

    const iconBtnStyle = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '32px', height: '32px', borderRadius: '6px',
        border: '1px solid var(--border-color)', background: 'var(--surface-color)',
        cursor: 'pointer', color: 'var(--text-primary)',
    };

    // ─── PROPERTIES PANEL ──────────────────────
    const renderPropertiesPanel = () => {
        if (!selectedEl) return (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Klicke auf ein Element, um es zu bearbeiten.
            </div>
        );

        const inputRow = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' };
        const labelSt = { fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '55px' };
        const inputSt = {
            flex: 1, padding: '5px 8px', borderRadius: '5px', border: '1px solid var(--border-color)',
            background: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.82rem',
            width: '60px',
        };

        return (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {labelForType(selectedEl.type)}
                    {![EL_TYPES.TITLE, EL_TYPES.PAGE_NUMBER].includes(selectedEl.type) && (
                        <button onClick={() => removeElement(selectedEl.id)}
                            style={{ ...iconBtnStyle, width: '24px', height: '24px', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>

                {/* Position */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '4px', marginBottom: '4px' }}>Position</div>
                <div style={inputRow}>
                    <span style={labelSt}>X (mm)</span>
                    <input type="number" step={SNAP_GRID} value={selectedEl.x} onChange={e => updateElement(selectedEl.id, { x: snap(Number(e.target.value)) })} style={inputSt} />
                    <span style={labelSt}>Y (mm)</span>
                    <input type="number" step={SNAP_GRID} value={selectedEl.y} onChange={e => updateElement(selectedEl.id, { y: snap(Number(e.target.value)) })} style={inputSt} />
                </div>

                {/* Size */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '4px', marginBottom: '4px' }}>Größe</div>
                <div style={inputRow}>
                    <span style={labelSt}>B (mm)</span>
                    <input type="number" step={SNAP_GRID}
                        value={selectedEl.w}
                        min={selectedEl.type === EL_TYPES.LOGO ? 20 : 10}
                        max={selectedEl.type === EL_TYPES.LOGO ? 60 : pageW - 2 * margin}
                        onChange={e => updateElement(selectedEl.id, { w: clamp(Number(e.target.value), 10, pageW - 2 * margin) })}
                        style={inputSt}
                    />
                    {selectedEl.type !== EL_TYPES.LINE && (
                        <>
                            <span style={labelSt}>H (mm)</span>
                            <input type="number" step={1} value={Math.round((selectedEl.h || 5) * 10) / 10}
                                disabled={selectedEl.type === EL_TYPES.LOGO}
                                onChange={e => updateElement(selectedEl.id, { h: Number(e.target.value) })}
                                style={{ ...inputSt, opacity: selectedEl.type === EL_TYPES.LOGO ? 0.5 : 1 }}
                            />
                        </>
                    )}
                </div>

                {/* Typography (not for logo/line) */}
                {![EL_TYPES.LOGO, EL_TYPES.LINE].includes(selectedEl.type) && (
                    <>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Typografie</div>
                        <div style={inputRow}>
                            <span style={labelSt}>Größe</span>
                            <input type="number" step={1} min={6} max={28} value={selectedEl.fontSize || 10}
                                onChange={e => updateElement(selectedEl.id, { fontSize: Number(e.target.value) })} style={{ ...inputSt, width: '50px' }} />
                            <span style={labelSt}>pt</span>
                        </div>
                        <div style={inputRow}>
                            <span style={labelSt}>Stil</span>
                            <button onClick={() => updateElement(selectedEl.id, { fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                                style={{ ...iconBtnStyle, fontWeight: 'bold', background: selectedEl.fontWeight === 'bold' ? accentColor : 'var(--surface-color)', color: selectedEl.fontWeight === 'bold' ? '#fff' : 'var(--text-primary)' }}>
                                B
                            </button>
                            <button onClick={() => updateElement(selectedEl.id, { align: 'left' })} style={{ ...iconBtnStyle, background: selectedEl.align === 'left' ? 'var(--background-color)' : 'transparent' }}><AlignLeft size={14} /></button>
                            <button onClick={() => updateElement(selectedEl.id, { align: 'center' })} style={{ ...iconBtnStyle, background: selectedEl.align === 'center' ? 'var(--background-color)' : 'transparent' }}><AlignCenter size={14} /></button>
                            <button onClick={() => updateElement(selectedEl.id, { align: 'right' })} style={{ ...iconBtnStyle, background: selectedEl.align === 'right' ? 'var(--background-color)' : 'transparent' }}><AlignRight size={14} /></button>
                        </div>
                    </>
                )}

                {/* Color */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Farbe</div>
                <div style={inputRow}>
                    <span style={labelSt}>{selectedEl.type === EL_TYPES.LINE ? 'Linie' : 'Text'}</span>
                    <input type="color" value={selectedEl.color || '#333333'}
                        onChange={e => updateElement(selectedEl.id, { color: e.target.value })}
                        style={{ width: '36px', height: '28px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', padding: '2px' }}
                    />
                </div>

                {/* Freetext content */}
                {selectedEl.type === EL_TYPES.FREETEXT && (
                    <>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>Inhalt</div>
                        <textarea
                            value={selectedEl.text || ''}
                            onChange={e => updateElement(selectedEl.id, { text: e.target.value })}
                            rows={3}
                            style={{ ...inputSt, width: '100%', resize: 'vertical', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}
                        />
                    </>
                )}

                {/* Subtitle content (global) */}
                {selectedEl.type === EL_TYPES.SUBTITLE && (
                    <>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '8px', marginBottom: '4px' }}>
                            Subtitel-Text
                        </div>
                        <input
                            value={subtitlesByReport['global'] || ''}
                            onChange={e => { setSubtitlesByReport(prev => ({ ...prev, global: e.target.value })); setDirty(true); }}
                            placeholder="Subtitel eingeben…"
                            style={{ ...inputSt, width: '100%' }}
                        />
                    </>
                )}

                {/* Nudge Controls */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Verschieben</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    {[
                        { label: '← 1mm', dx: -1, dy: 0 },
                        { label: '→ 1mm', dx: 1, dy: 0 },
                        { label: '↑ 1mm', dx: 0, dy: -1 },
                        { label: '↓ 1mm', dx: 0, dy: 1 },
                        { label: '← 5mm', dx: -5, dy: 0 },
                        { label: '→ 5mm', dx: 5, dy: 0 },
                        { label: '↑ 5mm', dx: 0, dy: -5 },
                        { label: '↓ 5mm', dx: 0, dy: 5 },
                    ].map(n => (
                        <button key={n.label} onClick={() => moveElement(selectedEl.id, n.dx, n.dy)}
                            style={{ padding: '5px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-primary)' }}>
                            {n.label}
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    // ─── ELEMENTS PANEL ────────────────────────
    const renderElementsPanel = () => {
        const checkRow = (el, label) => (
            <div key={el?.id || label} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                <input type="checkbox" checked={el?.visible ?? false}
                    onChange={e => { if (el) updateElement(el.id, { visible: e.target.checked }); }}
                />
                <span style={{ flex: 1, fontSize: '0.82rem' }}>{label}</span>
                {el && (
                    <button onClick={() => { setSelectedId(el.id); setRightTab('properties'); }}
                        style={{ ...iconBtnStyle, width: '24px', height: '24px' }}>
                        <Move size={11} />
                    </button>
                )}
            </div>
        );

        const logoEl = elements.find(e => e.type === EL_TYPES.LOGO);
        const titleEl = elements.find(e => e.type === EL_TYPES.TITLE);
        const subtitleEl = elements.find(e => e.type === EL_TYPES.SUBTITLE);
        const portfolioNameEl = elements.find(e => e.type === EL_TYPES.PORTFOLIO_NAME);
        const dateEls = elements.filter(e => e.type === EL_TYPES.DATE);
        const pageNumEl = elements.find(e => e.type === EL_TYPES.PAGE_NUMBER);
        const lineEls = elements.filter(e => e.type === EL_TYPES.LINE);
        const freetextEls = elements.filter(e => e.type === EL_TYPES.FREETEXT);

        return (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Standard-Elemente</div>
                {logoEl && checkRow(logoEl, 'Logo')}
                {titleEl && checkRow(titleEl, 'Reporttitel (auto)')}
                {subtitleEl && checkRow(subtitleEl, 'Subtitel (pro Typ)')}
                {portfolioNameEl && checkRow(portfolioNameEl, 'Portfolio-Name')}
                {dateEls.map((d, i) => checkRow(d, `Datum ${d.zone === 'footer' ? '(Footer)' : '(Header)'}`))}
                {pageNumEl && checkRow(pageNumEl, 'Seitenzahl')}

                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Linien ({lineCount}/{MAX_LINES})</div>
                {lineEls.map((l, i) => checkRow(l, `Linie ${i + 1}`))}
                {lineCount < MAX_LINES && (
                    <button onClick={() => addElement(EL_TYPES.LINE)}
                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: accentColor, fontWeight: 500, marginTop: '4px' }}>
                        + Linie hinzufügen
                    </button>
                )}

                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Freitext ({freetextCount}/{MAX_FREETEXT})</div>
                {freetextEls.map((f, i) => checkRow(f, f.text?.slice(0, 20) || `Freitext ${i + 1}`))}
                {freetextCount < MAX_FREETEXT && (
                    <button onClick={() => addElement(EL_TYPES.FREETEXT)}
                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: accentColor, fontWeight: 500, marginTop: '4px' }}>
                        + Freitext hinzufügen
                    </button>
                )}

                {/* Logo Upload */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '16px', marginBottom: '6px' }}>Logo hochladen</div>
                <label style={{ padding: '8px 12px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-primary)', textAlign: 'center', display: 'block' }}>
                    {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <><Image size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />PNG / JPG / SVG</>}
                    <input type="file" accept=".png,.jpg,.jpeg,.svg" hidden onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                </label>
                {logoUrl && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>✓ Logo hochgeladen</div>}

                {/* Accent Color */}
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '16px', marginBottom: '6px' }}>Akzentfarbe</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={accentColor} onChange={e => { setAccentColor(e.target.value); setDirty(true); }}
                        style={{ width: '36px', height: '28px', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', padding: '2px' }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{accentColor}</span>
                </div>

                {/* Reset */}
                <button onClick={() => applyPreset('standard')}
                    style={{ marginTop: '20px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                    <RotateCcw size={13} /> Auf Standard zurücksetzen
                </button>
            </div>
        );
    };

    // ─── RENDER ──────────────────────────────────
    return (
        <div>
            {/* Back */}
            <button onClick={() => navigate(backPath)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px', padding: 0 }}>
                <ArrowLeft size={16} /> Zurück
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <FileText size={isMobile ? 22 : 28} color={accentColor} />
                <h1 style={{ fontSize: isMobile ? '1.3rem' : '1.6rem', fontWeight: 700 }}>
                    PDF-Vorlage – {portfolioName}
                </h1>
                <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(14,165,233,0.08)', color: '#0ea5e9', fontWeight: 500 }}>{orientationLabel}</span>
                {dirty && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', color: '#dc2626', fontWeight: 500 }}>Ungespeichert</span>}
                {collisionWarning && <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(245,158,11,0.12)', color: '#d97706', fontWeight: 500 }}>⚠ Layout kollidiert – bitte Elemente anpassen</span>}
            </div>

            {/* TOOLBAR */}
            <div style={toolbarStyle}>

                <div style={{ display: 'flex', gap: '2px' }}>
                    <button style={toggleBtnStyle(currentOrientation === 'portrait')} onClick={() => switchOrientation('portrait')} title="Hochformat">⬜ Hoch</button>
                    <button style={toggleBtnStyle(currentOrientation === 'landscape')} onClick={() => switchOrientation('landscape')} title="Querformat">⬕ Quer</button>
                </div>

                <select value={margin} onChange={e => { setMargin(Number(e.target.value)); setDirty(true); }} style={selectStyle}>
                    {MARGIN_OPTIONS.map(m => <option key={m} value={m}>Rand {m}mm</option>)}
                </select>

                <div style={{ display: 'flex', gap: '2px' }}>
                    <button style={toggleBtnStyle(activeZone === 'header')} onClick={() => setActiveZone('header')}>Header</button>
                    <button style={toggleBtnStyle(activeZone === 'footer')} onClick={() => setActiveZone('footer')}>Footer</button>
                </div>

                <div style={{ flex: 1 }} />

                <button style={{ ...iconBtnStyle, opacity: historyIdx <= 0 ? 0.3 : 1 }} onClick={undo} disabled={historyIdx <= 0} title="Rückgängig"><Undo2 size={15} /></button>
                <button style={{ ...iconBtnStyle, opacity: historyIdx >= history.length - 1 ? 0.3 : 1 }} onClick={redo} disabled={historyIdx >= history.length - 1} title="Wiederholen"><Redo2 size={15} /></button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <button style={iconBtnStyle} onClick={() => setZoom(z => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)] || z)} title="Verkleinern"><ZoomOut size={14} /></button>
                    <span style={{ fontSize: '0.72rem', minWidth: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>{Math.round(zoom * 100)}%</span>
                    <button style={iconBtnStyle} onClick={() => setZoom(z => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)] || z)} title="Vergrößern"><ZoomIn size={14} /></button>
                </div>

                <Button icon={saving ? Loader2 : Save} onClick={handleSave} disabled={saving} style={{ fontSize: '0.8rem' }}>
                    {saving ? 'Speichert…' : 'Speichern'}
                </Button>
                <Button variant="secondary" icon={FileText} onClick={handleTestPdf} style={{ fontSize: '0.8rem' }}>
                    Test-PDF
                </Button>
            </div>

            {/* MAIN LAYOUT */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: '16px' }}>

                {/* A4 PREVIEW */}
                <div style={{ overflow: 'auto', padding: '20px', background: 'var(--background-color)', borderRadius: 'var(--radius-lg)', minHeight: isMobile ? '400px' : '600px', display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-start' : 'center' }}>
                    <div
                        ref={previewRef}
                        style={{
                            width: pageW * scale, height: pageH * scale,
                            background: '#fff', position: 'relative',
                            boxShadow: '0 4px 30px rgba(0,0,0,0.12)', borderRadius: '2px',
                            flexShrink: 0,
                        }}
                        onClick={() => setSelectedId(null)}
                    >
                        {/* Margin guides */}
                        <div style={{
                            position: 'absolute',
                            left: margin * scale, top: 0,
                            right: margin * scale, bottom: 0,
                            border: '1px dashed rgba(0,0,0,0.08)',
                            pointerEvents: 'none',
                        }} />

                        {/* Header zone */}
                        <div style={{
                            position: 'absolute', left: 0, top: 0, right: 0, height: HEADER_H * scale,
                            background: activeZone === 'header' ? 'rgba(245,158,11,0.04)' : 'transparent',
                            borderBottom: `1px ${activeZone === 'header' ? 'solid' : 'dashed'} ${activeZone === 'header' ? accentColor + '40' : 'rgba(0,0,0,0.06)'}`,
                            pointerEvents: 'none',
                        }} />

                        {/* Content zone (locked) */}
                        <div style={{
                            position: 'absolute', left: margin * scale, right: margin * scale,
                            top: HEADER_H * scale, bottom: FOOTER_H * scale,
                            background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.015) 10px, rgba(0,0,0,0.015) 20px)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            gap: '8px', pointerEvents: 'none',
                        }}>
                            <Lock size={20 * zoom} color="#ccc" />
                            <span style={{ fontSize: `${9 * zoom}pt`, color: '#bbb', fontFamily: 'Inter' }}>Inhalt wird automatisch gefüllt</span>
                        </div>

                        {/* Footer zone */}
                        <div style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, height: FOOTER_H * scale,
                            background: activeZone === 'footer' ? 'rgba(245,158,11,0.04)' : 'transparent',
                            borderTop: `1px ${activeZone === 'footer' ? 'solid' : 'dashed'} ${activeZone === 'footer' ? accentColor + '40' : 'rgba(0,0,0,0.06)'}`,
                            pointerEvents: 'none',
                        }} />

                        {/* Render elements */}
                        {elements.map(renderElement)}
                    </div>
                </div>

                {/* RIGHT PANEL */}
                <Card style={{ padding: 0, height: 'fit-content', overflow: 'hidden', position: isMobile ? 'static' : 'sticky', top: '16px' }}>
                    {/* Panel tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                        {[
                            { id: 'elements', label: 'Elemente' },
                            { id: 'properties', label: 'Eigenschaften' },
                        ].map(t => (
                            <button key={t.id} onClick={() => setRightTab(t.id)}
                                style={{
                                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
                                    background: rightTab === t.id ? 'var(--background-color)' : 'transparent',
                                    borderBottom: rightTab === t.id ? `2px solid ${accentColor}` : '2px solid transparent',
                                    fontWeight: rightTab === t.id ? 600 : 400, fontSize: '0.82rem',
                                    color: rightTab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                                }}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ maxHeight: isMobile ? '400px' : 'calc(100vh - 260px)', overflowY: 'auto' }}>
                        {rightTab === 'elements' ? renderElementsPanel() : renderPropertiesPanel()}
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default PdfTemplateEditor;
