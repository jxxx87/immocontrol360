import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, ArrowRight, Calculator, ChevronDown, ChevronRight,
    Plus, Trash2, Loader2, Save, CheckCircle2, Building2,
    Home, Building, Layers, TriangleIcon, Square, Minus,
    Bath, DoorOpen, Maximize2, PanelTop, Info, FileText
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { generateCalcLines, recalcGP } from './calcEngine';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useViewMode } from '../../context/ViewModeContext';
import { generateClientPdf } from '../../lib/pdfGenerator';
import { usePdfTemplate, fetchPdfTemplate } from '../../lib/usePdfTemplate';

const fmt = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v || 0);
const fmt0 = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);

/* ─── Building type icons ───────── */
const BUILDING_TYPES = [
    { key: 'wohnung', label: 'Wohnung', icon: Home, description: 'Einzelne Wohnung' },
    { key: 'efh', label: 'Einfamilienhaus', icon: Building2, description: 'Freistehendes Haus' },
    { key: 'mfh', label: 'Mehrfamilienhaus', icon: Building, description: 'Mehrere Einheiten' },
];

const ROOF_TYPES = [
    { key: 'satteldach', label: 'Satteldach' },
    { key: 'walmdach', label: 'Walmdach' },
    { key: 'flachdach', label: 'Flachdach' },
];

const FLOOR_OPTIONS = ['Fliesen', 'Parkett', 'Vinyl', 'Laminat'];
const CURRENT_FLOOR_OPTIONS = ['Fliesen', 'Laminat/Vinyl/Parkett'];

const STEP_LABELS = ['Gebäude', 'Räume & Ausstattung', 'Kalkulation'];

const RenovationCalculatorDetail = () => {
    const { id } = useParams();
    const isNew = id === 'new';
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const { isMobile } = useViewMode();
    const [searchParams] = useSearchParams();
    const pdfTemplate = usePdfTemplate('sanierung_rechner');

    const [step, setStep] = useState(0);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [calcId, setCalcId] = useState(isNew ? null : id);

    // ─── Step 0: Meta + Grunddaten ─────────
    const [name, setName] = useState('');
    const [calcType, setCalcType] = useState('buy_and_hold');
    const [propertyId, setPropertyId] = useState('');
    const [unitId, setUnitId] = useState('');
    const [dealId, setDealId] = useState('');
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [deals, setDeals] = useState([]);

    // ─── Step 1: Building ─────────
    const [buildingType, setBuildingType] = useState('wohnung');
    const [floorHeight, setFloorHeight] = useState(2.5);
    const [unitCount, setUnitCount] = useState(1);
    const [floorCount, setFloorCount] = useState(1);
    const [roofType, setRoofType] = useState('satteldach');
    const [houseWidth, setHouseWidth] = useState(0);
    const [houseLength, setHouseLength] = useState(0);
    const [roofAngle, setRoofAngle] = useState(35);
    const [gaubenCount, setGaubenCount] = useState(0);

    // ─── Step 2: Floors & Rooms ─────────
    const [floors, setFloors] = useState([]);

    // ─── Step 3: Kalkulation ─────────
    const [workItems, setWorkItems] = useState([]);
    const [calcLines, setCalcLines] = useState([]);
    const [expandedTrades, setExpandedTrades] = useState({});
    const [showRecalcDialog, setShowRecalcDialog] = useState(false);
    const [calcGenerated, setCalcGenerated] = useState(false);
    const [loadingCalc, setLoadingCalc] = useState(false);

    // ─── WM Tooltip ─────────
    const [showWmInfo, setShowWmInfo] = useState(null); // bath id

    /* ─── Total WHG count across all floors ───── */
    const totalWhgCount = useMemo(() => {
        return floors.reduce((sum, f) => sum + f.whgs.length, 0);
    }, [floors]);

    /* ─── Auto-select deal from URL param ?dealId=xxx ───── */
    useEffect(() => {
        if (!isNew || !user) return;
        const urlDealId = searchParams.get('dealId');
        const urlDealName = searchParams.get('dealName');
        // Immediately set name from URL (available before deals load)
        if (urlDealId && !dealId) {
            setDealId(urlDealId);
            if (urlDealName) setName(decodeURIComponent(urlDealName));
        }
        // Once deals are loaded, set type and update name if not already set from URL
        if (urlDealId && deals.length > 0) {
            const deal = deals.find(d => d.id === urlDealId);
            if (deal) {
                setCalcType(deal.deal_type === 'fix_flip' ? 'fix_and_flip' : 'buy_and_hold');
                if (!urlDealName && !name) setName(deal.name || '');
            }
        }
    }, [isNew, user, searchParams, deals]);

    /* ─── Max WHG allowed ───── */
    const maxWhg = buildingType === 'mfh' ? unitCount : 1;
    const isEfhMfh = buildingType === 'efh' || buildingType === 'mfh';

    /* ─── Load data ───── */
    useEffect(() => {
        if (!user) return;
        loadProperties();
        loadDeals();
        if (!isNew) loadCalculation();
    }, [user, id]);

    const loadProperties = async () => {
        let q = supabase.from('properties').select('id, street, house_number, city, zip, portfolio_id');
        if (selectedPortfolioID) q = q.eq('portfolio_id', selectedPortfolioID);
        const { data } = await q;
        setProperties(data || []);
    };

    const loadUnits = async (propId) => {
        if (!propId) { setUnits([]); return; }
        const { data } = await supabase.from('units').select('id, unit_name').eq('property_id', propId);
        setUnits(data || []);
    };

    const loadDeals = async () => {
        const { data } = await supabase.from('deals').select('id, name, deal_type, deal_data').eq('user_id', user.id).order('updated_at', { ascending: false });
        setDeals(data || []);
    };

    const loadCalculation = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('renovation_calculations')
                .select('*')
                .eq('id', id).single();
            if (error) throw error;
            setName(data.name);
            setCalcType(data.calc_type);
            setPropertyId(data.property_id || '');
            setUnitId(data.unit_id || '');
            if (data.property_id) loadUnits(data.property_id);

            // Load building config from JSON
            const cfg = data.building_config || {};
            if (cfg.buildingType) setBuildingType(cfg.buildingType);
            if (cfg.floorHeight) setFloorHeight(cfg.floorHeight);
            if (cfg.unitCount) setUnitCount(cfg.unitCount);
            if (cfg.floorCount) setFloorCount(cfg.floorCount);
            if (cfg.roofType) setRoofType(cfg.roofType);
            if (cfg.houseWidth) setHouseWidth(cfg.houseWidth);
            if (cfg.houseLength) setHouseLength(cfg.houseLength);
            if (cfg.roofAngle) setRoofAngle(cfg.roofAngle);
            if (cfg.gaubenCount) setGaubenCount(cfg.gaubenCount);
            if (cfg.floors) setFloors(cfg.floors);
            if (cfg.workItems) setWorkItems(cfg.workItems);
            if (cfg.calcLines) { setCalcLines(cfg.calcLines); setCalcGenerated(true); }
            if (cfg.dealId) setDealId(cfg.dealId);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    /* ─── On deal selection: auto-set calc type + name, clear property ───── */
    const handleDealChange = (selectedId) => {
        setDealId(selectedId);
        // Mutual exclusivity: clear property when deal is selected
        if (selectedId) {
            setPropertyId('');
            setUnitId('');
            setUnits([]);
        }
        const deal = deals.find(d => d.id === selectedId);
        if (deal) {
            setCalcType(deal.deal_type === 'fix_flip' ? 'fix_and_flip' : 'buy_and_hold');
            setName(deal.name);
        } else if (!propertyId) {
            // Cleared deal and no property -> clear name only if it was deal-derived
            setName('');
        }
    };

    /* ─── On property selection: auto-set name, clear deal ───── */
    const handlePropertyChange = (selectedId) => {
        setPropertyId(selectedId);
        setUnitId('');
        loadUnits(selectedId);
        // Mutual exclusivity: clear deal when property is selected
        if (selectedId) {
            setDealId('');
            const prop = properties.find(p => p.id === selectedId);
            if (prop) setName(`${prop.street} ${prop.house_number || ''}, ${prop.city}`.trim());
        } else if (!dealId) {
            setName('');
        }
    };

    /* ─── Initialize floors when building config changes ───── */
    useEffect(() => {
        if (loading || !isNew) return;
        const fc = buildingType === 'wohnung' ? 1 : floorCount;

        // Only initialize if floors are empty or count changed
        if (floors.length !== fc) {
            const newFloors = Array.from({ length: fc }, (_, fi) => {
                const existing = floors[fi];
                if (existing) return existing;
                return {
                    id: `floor_${fi}`,
                    label: fc === 1 ? 'Erdgeschoss' : fi === 0 ? 'Erdgeschoss' : `${fi}. OG`,
                    whgs: buildingType === 'wohnung' ? [createDefaultWhg(0)] : [],
                };
            });
            setFloors(newFloors);
        }
    }, [buildingType, floorCount, unitCount, loading]);

    const createDefaultWhg = (index) => ({
        id: `whg_${Date.now()}_${index}`,
        name: `WHG ${index + 1}`,
        rooms: [],
        bathrooms: [],
        balcony: false,
        windows: [],
    });

    /* ─── Room/Bathroom/Window Management ───── */
    const updateFloor = (floorIdx, updater) => {
        setFloors(prev => prev.map((f, i) => i === floorIdx ? updater(f) : f));
    };

    const updateFloorLabel = (floorIdx, newLabel) => {
        setFloors(prev => prev.map((f, i) => i === floorIdx ? { ...f, label: newLabel } : f));
    };

    const addRoom = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                rooms: [...w.rooms, { id: `room_${Date.now()}`, name: `Zimmer ${w.rooms.length + 1}`, sqm: 0, currentFlooring: 'Laminat/Vinyl/Parkett', flooring: 'Parkett' }],
            } : w),
        }));
    };

    const addBathroom = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                bathrooms: [...w.bathrooms, {
                    id: `bath_${Date.now()}`, sqm: 0, wallTiles: '1.2m',
                    shower: false, bathtub: false, sinkCount: 1, urinalBidetCount: 0,
                    washingMachine: false,
                }],
            } : w),
        }));
    };

    const addWindow = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => {
                if (wi !== whgIdx) return w;
                return {
                    ...w,
                    windows: [...(w.windows || []), {
                        id: `win_${Date.now()}`, width: 100, height: 120, rollladen: true,
                    }],
                };
            }),
        }));
    };

    const addWhg = (floorIdx) => {
        if (totalWhgCount >= maxWhg) return;
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: [...f.whgs, createDefaultWhg(totalWhgCount)],
        }));
    };

    const removeWhg = (floorIdx, whgIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.filter((_, wi) => wi !== whgIdx),
        }));
    };

    const updateWhgField = (floorIdx, whgIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? { ...w, [field]: value } : w),
        }));
    };

    const updateRoom = (floorIdx, whgIdx, roomIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                rooms: w.rooms.map((r, ri) => ri === roomIdx ? { ...r, [field]: value } : r),
            } : w),
        }));
    };

    const removeRoom = (floorIdx, whgIdx, roomIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w, rooms: w.rooms.filter((_, ri) => ri !== roomIdx),
            } : w),
        }));
    };

    const updateBathroom = (floorIdx, whgIdx, bathIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                bathrooms: w.bathrooms.map((b, bi) => bi === bathIdx ? { ...b, [field]: value } : b),
            } : w),
        }));
    };

    const removeBathroom = (floorIdx, whgIdx, bathIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w, bathrooms: w.bathrooms.filter((_, bi) => bi !== bathIdx),
            } : w),
        }));
    };

    const updateWindow = (floorIdx, whgIdx, winIdx, field, value) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w,
                windows: (w.windows || []).map((win, wii) => wii === winIdx ? { ...win, [field]: value } : win),
            } : w),
        }));
    };

    const removeWindow = (floorIdx, whgIdx, winIdx) => {
        updateFloor(floorIdx, f => ({
            ...f,
            whgs: f.whgs.map((w, wi) => wi === whgIdx ? {
                ...w, windows: (w.windows || []).filter((_, wii) => wii !== winIdx),
            } : w),
        }));
    };

    /* ─── Grand total from work items ───── */
    const grandTotal = useMemo(() => {
        if (calcLines.length > 0) {
            return calcLines.filter(l => l.enabled).reduce((sum, l) => sum + (l.gp || 0), 0);
        }
        return workItems.filter(w => w.enabled).reduce((sum, w) => sum + (Number(w.total) || 0), 0);
    }, [workItems, calcLines]);

    /* ─── Save ───── */
    const handleSave = async () => {
        if (!name.trim()) { alert('Bitte Name der Kalkulation eingeben.'); return; }
        setSaving(true);
        try {
            const buildingConfig = {
                buildingType, floorHeight, unitCount, floorCount,
                roofType, houseWidth, houseLength, roofAngle, gaubenCount,
                floors, workItems, calcLines, dealId,
            };

            if (calcId) {
                await supabase.from('renovation_calculations').update({
                    name: name.trim(), calc_type: calcType,
                    property_id: propertyId || null, unit_id: unitId || null,
                    building_config: buildingConfig,
                    total_cost: grandTotal,
                }).eq('id', calcId);
            } else {
                const { data, error } = await supabase.from('renovation_calculations').insert({
                    user_id: user.id, name: name.trim(), calc_type: calcType,
                    property_id: propertyId || null, unit_id: unitId || null,
                    building_config: buildingConfig,
                    total_cost: grandTotal,
                }).select().single();
                if (error) throw error;
                setCalcId(data.id);
                // Preserve query params (returnTo, dealId) when updating URL
                const currentParams = new URLSearchParams(window.location.search);
                const qs = currentParams.toString();
                window.history.replaceState(null, '', `/renovation/calculator/${data.id}${qs ? '?' + qs : ''}`);
            }

            // Update deal if linked
            if (dealId) {
                const deal = deals.find(d => d.id === dealId);
                if (deal) {
                    const dealData = { ...(deal.deal_data || {}) };
                    if (deal.deal_type === 'buy_hold') {
                        dealData.renovationCosts = grandTotal;
                    } else if (deal.deal_type === 'fix_flip') {
                        dealData.renovation = grandTotal;
                    }
                    await supabase.from('deals').update({
                        deal_data: dealData,
                        updated_at: new Date().toISOString(),
                    }).eq('id', dealId);
                }
            }

            // Show success, then navigate back to the deal
            const returnTo = searchParams.get('returnTo');
            if (returnTo) {
                setSaveSuccess(true);
                setTimeout(() => {
                    setSaveSuccess(false);
                    navigate(returnTo);
                }, 800);
            } else {
                navigate('/renovation?tab=calculator');
            }
        } catch (err) {
            alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><Loader2 className="animate-spin" size={28} /></div>;

    /* ═══════════════════════════════════════
       RENDER
       ═══════════════════════════════════════ */
    return (
        <div>
            {/* Back */}
            <button onClick={() => {
                const returnTo = searchParams.get('returnTo');
                navigate(returnTo || '/renovation?tab=calculator');
            }} style={backBtnStyle}>
                <ArrowLeft size={16} /> {searchParams.get('returnTo') ? 'Zurück zum Deal' : 'Zurück zur Übersicht'}
            </button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <Calculator size={isMobile ? 22 : 28} color="#f59e0b" />
                <h1 style={{ fontSize: isMobile ? '1.3rem' : '1.6rem', fontWeight: 700 }}>
                    {isNew ? 'Neuer Sanierungsrechner' : (name || 'Sanierungsrechner')}
                </h1>
            </div>

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '24px' }}>
                {STEP_LABELS.map((label, i) => (
                    <button key={i} onClick={() => setStep(i)} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: isMobile ? '8px 10px' : '8px 16px', borderRadius: 'var(--radius-md)',
                        background: step === i ? '#0ea5e9' : 'var(--surface-color)',
                        color: step === i ? '#fff' : 'var(--text-secondary)',
                        border: step === i ? 'none' : '1px solid var(--border-color)',
                        fontSize: isMobile ? '0.75rem' : '0.85rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.15s', flex: isMobile ? 1 : undefined,
                    }}>
                        <span style={{
                            width: '22px', height: '22px', borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: step === i ? 'rgba(255,255,255,0.25)' : 'var(--border-color)',
                            fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
                        }}>{i + 1}</span>
                        {!isMobile ? label : label.split(' ')[0]}
                    </button>
                ))}
            </div>

            {/* ═══ STEP 1: BUILDING ═══ */}
            {step === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Deal / Property selection (mutual exclusive) */}
                    <Card>
                        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '12px' }}>Zuordnung & Name</h3>
                        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
                            <div>
                                <label style={labelStyle}>Neuer Deal</label>
                                <select
                                    value={dealId}
                                    onChange={e => handleDealChange(e.target.value)}
                                    disabled={!!propertyId}
                                    style={{ ...inputStyle, opacity: propertyId ? 0.5 : 1 }}
                                >
                                    <option value="">— Kein Deal —</option>
                                    {deals.map(d => (
                                        <option key={d.id} value={d.id}>
                                            {d.name} ({d.deal_type === 'fix_flip' ? 'Fix & Flip' : 'Buy & Hold'})
                                        </option>
                                    ))}
                                </select>
                                {propertyId && <span style={hintStyle}>Immobilie ist ausgewählt – Deal nicht verfügbar</span>}
                            </div>
                            <div>
                                <label style={labelStyle}>Immobilie</label>
                                <select
                                    value={propertyId}
                                    onChange={e => handlePropertyChange(e.target.value)}
                                    disabled={!!dealId}
                                    style={{ ...inputStyle, opacity: dealId ? 0.5 : 1 }}
                                >
                                    <option value="">— Keine Immobilie —</option>
                                    {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.zip} {p.city}</option>)}
                                </select>
                                {dealId && <span style={hintStyle}>Deal ist ausgewählt – Immobilie nicht verfügbar</span>}
                            </div>
                            {propertyId && units.length > 0 && (
                                <div>
                                    <label style={labelStyle}>Einheit (optional)</label>
                                    <select value={unitId} onChange={e => setUnitId(e.target.value)} style={inputStyle}>
                                        <option value="">— Gesamtes Projekt —</option>
                                        {units.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label style={labelStyle}>Kalkulationstyp</label>
                                <select value={calcType} onChange={e => setCalcType(e.target.value)} style={inputStyle}>
                                    <option value="buy_and_hold">Buy & Hold</option>
                                    <option value="fix_and_flip">Fix & Flip</option>
                                </select>
                            </div>
                        </div>

                        {/* Name – shown when neither deal nor property selected */}
                        <div style={{ marginTop: '12px' }}>
                            <label style={labelStyle}>
                                Name der Kalkulation *
                                {(dealId || propertyId) && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}> (automatisch übernommen)</span>}
                            </label>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={dealId || propertyId ? '' : 'z.B. Sanierung Musterstraße 12'}
                                readOnly={!!(dealId || propertyId)}
                                style={{
                                    ...inputStyle, fontWeight: 600, fontSize: '0.95rem', maxWidth: '500px',
                                    background: (dealId || propertyId) ? 'var(--background-color)' : 'var(--surface-color)',
                                }}
                            />
                        </div>
                    </Card>

                    {/* Building Type Selection */}
                    <Card>
                        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '16px' }}>Gebäudetyp</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                            {BUILDING_TYPES.map(bt => (
                                <button key={bt.key} onClick={() => setBuildingType(bt.key)} style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                                    padding: '20px 16px', borderRadius: 'var(--radius-lg)',
                                    border: buildingType === bt.key ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                    background: buildingType === bt.key ? 'rgba(14,165,233,0.08)' : 'var(--surface-color)',
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }}>
                                    <bt.icon size={36} color={buildingType === bt.key ? '#0ea5e9' : 'var(--text-secondary)'} />
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: buildingType === bt.key ? '#0ea5e9' : 'var(--text-primary)' }}>{bt.label}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{bt.description}</span>
                                </button>
                            ))}
                        </div>

                        {/* Building dimensions */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '12px' }}>
                            <div>
                                <label style={labelStyle}>Geschosshöhe (m)</label>
                                <input type="number" step="0.1" value={floorHeight} onChange={e => setFloorHeight(Number(e.target.value))} style={inputStyle} />
                            </div>
                            {buildingType === 'mfh' && (
                                <div>
                                    <label style={labelStyle}>Anzahl Einheiten</label>
                                    <input type="number" min="2" value={unitCount} onChange={e => setUnitCount(Math.max(2, Number(e.target.value)))} style={inputStyle} />
                                </div>
                            )}
                            {(buildingType === 'efh' || buildingType === 'mfh') && (
                                <div>
                                    <label style={labelStyle}>Anzahl Etagen</label>
                                    <input type="number" min="1" max="6" value={floorCount} onChange={e => setFloorCount(Math.max(1, Math.min(6, Number(e.target.value))))} style={inputStyle} />
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Roof & Dimensions */}
                    {(buildingType === 'efh' || buildingType === 'mfh') && (
                        <Card>
                            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '16px' }}>Dach & Abmessungen</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                {ROOF_TYPES.map(rt => (
                                    <button key={rt.key} onClick={() => setRoofType(rt.key)} style={{
                                        padding: '12px', borderRadius: 'var(--radius-md)', textAlign: 'center',
                                        border: roofType === rt.key ? '2px solid #0ea5e9' : '1px solid var(--border-color)',
                                        background: roofType === rt.key ? 'rgba(14,165,233,0.08)' : 'var(--surface-color)',
                                        cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                                        color: roofType === rt.key ? '#0ea5e9' : 'var(--text-primary)',
                                    }}>
                                        {rt.label}
                                    </button>
                                ))}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={labelStyle}>Breite (Giebelseite) m</label>
                                    <input type="number" step="0.1" value={houseWidth} onChange={e => setHouseWidth(Number(e.target.value))} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}>Länge (Traufseite) m</label>
                                    <input type="number" step="0.1" value={houseLength} onChange={e => setHouseLength(Number(e.target.value))} style={inputStyle} />
                                </div>
                                {roofType !== 'flachdach' && (
                                    <div>
                                        <label style={labelStyle}>Dachneigung (°)</label>
                                        <input type="number" min="0" max="60" value={roofAngle} onChange={e => setRoofAngle(Number(e.target.value))} style={inputStyle} />
                                    </div>
                                )}
                                <div>
                                    <label style={labelStyle}>Anzahl Gauben</label>
                                    <input type="number" min="0" value={gaubenCount} onChange={e => setGaubenCount(Number(e.target.value))} style={inputStyle} />
                                </div>
                            </div>
                        </Card>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <Button onClick={() => setStep(1)}>
                            Weiter <ArrowRight size={15} style={{ marginLeft: '4px' }} />
                        </Button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 2: ROOMS & UNITS ═══ */}
            {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* WHG counter info */}
                    {buildingType === 'mfh' && (
                        <div style={{
                            padding: '10px 16px', borderRadius: 'var(--radius-md)',
                            background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)',
                            fontSize: '0.82rem', color: 'var(--text-secondary)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <span>Wohnungen zugewiesen</span>
                            <span style={{ fontWeight: 700, color: totalWhgCount >= maxWhg ? '#0ea5e9' : 'var(--text-primary)' }}>
                                {totalWhgCount} / {maxWhg}
                            </span>
                        </div>
                    )}

                    {floors.map((floor, fi) => (
                        <Card key={floor.id}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                <Layers size={18} color="#0ea5e9" />
                                <input
                                    value={floor.label}
                                    onChange={e => updateFloorLabel(fi, e.target.value)}
                                    style={{ ...inputStyle, fontWeight: 700, fontSize: '0.95rem', maxWidth: '220px', padding: '6px 10px' }}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    ({floor.whgs.length} {floor.whgs.length === 1 ? 'Wohnung' : 'Wohnungen'})
                                </span>
                            </div>

                            {floor.whgs.map((whg, wi) => (
                                <div key={whg.id} style={{ marginBottom: '16px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--background-color)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                        <Home size={16} color="#f59e0b" />
                                        <input value={whg.name} onChange={e => updateWhgField(fi, wi, 'name', e.target.value)} style={{ ...inputStyle, fontWeight: 700, maxWidth: '200px' }} />
                                        <button onClick={() => removeWhg(fi, wi)} style={deleteBtnStyle}><Trash2 size={14} /></button>
                                        <div style={{ flex: 1 }} />
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={whg.balcony} onChange={e => updateWhgField(fi, wi, 'balcony', e.target.checked)} />
                                            Balkon
                                        </label>
                                    </div>

                                    {/* Rooms */}
                                    <div style={{ marginBottom: '8px' }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Zimmer</div>
                                        {whg.rooms.length > 0 && !isMobile && (
                                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 130px 110px 28px', gap: '6px', marginBottom: '4px' }}>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Name</span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textAlign: 'right' }}>m²</span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Ist-Zustand</span>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Neuer Belag</span>
                                                <span></span>
                                            </div>
                                        )}
                                        {whg.rooms.map((room, ri) => (
                                            <div key={room.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 60px 90px 90px 28px' : '2fr 80px 130px 110px 28px', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
                                                <input value={room.name} onChange={e => updateRoom(fi, wi, ri, 'name', e.target.value)} style={inputStyleSm} placeholder="Name" />
                                                <input type="number" step="0.1" value={room.sqm || ''} onChange={e => updateRoom(fi, wi, ri, 'sqm', Number(e.target.value))} style={{ ...inputStyleSm, textAlign: 'right' }} placeholder="m²" />
                                                <select value={room.currentFlooring || 'Laminat/Vinyl/Parkett'} onChange={e => updateRoom(fi, wi, ri, 'currentFlooring', e.target.value)} style={inputStyleSm} title="Ist-Zustand">
                                                    {CURRENT_FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                                                </select>
                                                <select value={room.flooring} onChange={e => updateRoom(fi, wi, ri, 'flooring', e.target.value)} style={inputStyleSm} title="Neuer Bodenbelag">
                                                    {FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                                                </select>
                                                <button onClick={() => removeRoom(fi, wi, ri)} style={deleteBtnStyle}><Trash2 size={12} /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => addRoom(fi, wi)} style={addBtnStyle}><Plus size={12} /> Zimmer</button>
                                    </div>

                                    {/* Bathrooms */}
                                    <div style={{ marginBottom: '8px' }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                                            <Bath size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Badezimmer
                                        </div>
                                        {whg.bathrooms.map((bath, bi) => (
                                            <div key={bath.id} style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '6px', background: 'var(--surface-color)' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '80px 120px 1fr 1fr 1fr 1fr 1fr 28px', gap: '6px', alignItems: 'center' }}>
                                                    <div>
                                                        <span style={miniLabel}>m²</span>
                                                        <input type="number" step="0.1" value={bath.sqm || ''} onChange={e => updateBathroom(fi, wi, bi, 'sqm', Number(e.target.value))} style={inputStyleSm} />
                                                    </div>
                                                    <div>
                                                        <span style={miniLabel}>Wandfliesen</span>
                                                        <select value={bath.wallTiles} onChange={e => updateBathroom(fi, wi, bi, 'wallTiles', e.target.value)} style={inputStyleSm}>
                                                            <option value="raumhoch">Raumhoch</option>
                                                            <option value="1.2m">1,2m Spiegel</option>
                                                        </select>
                                                    </div>
                                                    <label style={checkboxLabel}>
                                                        <input type="checkbox" checked={bath.shower} onChange={e => updateBathroom(fi, wi, bi, 'shower', e.target.checked)} /> Dusche
                                                    </label>
                                                    <label style={checkboxLabel}>
                                                        <input type="checkbox" checked={bath.bathtub} onChange={e => updateBathroom(fi, wi, bi, 'bathtub', e.target.checked)} /> Badewanne
                                                    </label>
                                                    <div>
                                                        <span style={miniLabel}>Waschbecken</span>
                                                        <input type="number" min="0" value={bath.sinkCount} onChange={e => updateBathroom(fi, wi, bi, 'sinkCount', Number(e.target.value))} style={inputStyleSm} />
                                                    </div>
                                                    <div>
                                                        <span style={miniLabel}>Urinal/Bidet</span>
                                                        <input type="number" min="0" value={bath.urinalBidetCount} onChange={e => updateBathroom(fi, wi, bi, 'urinalBidetCount', Number(e.target.value))} style={inputStyleSm} />
                                                    </div>
                                                    <div style={{ position: 'relative' }}>
                                                        <label style={checkboxLabel}>
                                                            <input type="checkbox" checked={bath.washingMachine} onChange={e => updateBathroom(fi, wi, bi, 'washingMachine', e.target.checked)} />
                                                            WM
                                                            <Info
                                                                size={13}
                                                                color="var(--text-secondary)"
                                                                style={{ cursor: 'pointer', flexShrink: 0 }}
                                                                onMouseEnter={() => setShowWmInfo(bath.id)}
                                                                onMouseLeave={() => setShowWmInfo(null)}
                                                            />
                                                        </label>
                                                        {showWmInfo === bath.id && (
                                                            <div style={{
                                                                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                                                                background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                borderRadius: '8px', padding: '8px 12px', fontSize: '0.72rem',
                                                                boxShadow: '0 4px 16px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
                                                                zIndex: 50, marginBottom: '4px', color: 'var(--text-primary)',
                                                            }}>
                                                                Vorbereitung eines Waschmaschinenanschlusses<br />
                                                                (Wasser, Abwasser, Strom)
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button onClick={() => removeBathroom(fi, wi, bi)} style={deleteBtnStyle}><Trash2 size={12} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        <button onClick={() => addBathroom(fi, wi)} style={addBtnStyle}><Plus size={12} /> Badezimmer</button>
                                    </div>

                                    {/* Windows */}
                                    <div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
                                            <PanelTop size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Fenster
                                        </div>
                                        {(whg.windows || []).map((win, wii) => (
                                            <div key={win.id} style={{ display: 'grid', gridTemplateColumns: '80px 10px 80px 100px 28px', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
                                                <div>
                                                    <span style={miniLabel}>Breite cm</span>
                                                    <input type="number" value={win.width} onChange={e => updateWindow(fi, wi, wii, 'width', Number(e.target.value))} style={inputStyleSm} />
                                                </div>
                                                <span style={{ textAlign: 'center', fontWeight: 700 }}>×</span>
                                                <div>
                                                    <span style={miniLabel}>Höhe cm</span>
                                                    <input type="number" value={win.height} onChange={e => updateWindow(fi, wi, wii, 'height', Number(e.target.value))} style={inputStyleSm} />
                                                </div>
                                                <label style={checkboxLabel}>
                                                    <input type="checkbox" checked={win.rollladen} onChange={e => updateWindow(fi, wi, wii, 'rollladen', e.target.checked)} /> Rollladen
                                                </label>
                                                <button onClick={() => removeWindow(fi, wi, wii)} style={deleteBtnStyle}><Trash2 size={12} /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => addWindow(fi, wi)} style={addBtnStyle}><Plus size={12} /> Fenster</button>
                                    </div>
                                </div>
                            ))}

                            {/* Add WHG – only for MFH and only up to unitCount */}
                            {buildingType === 'mfh' && totalWhgCount < maxWhg && (
                                <button onClick={() => addWhg(fi)} style={{ ...addBtnStyle, marginTop: '8px' }}>
                                    <Plus size={13} /> Wohnung hinzufügen ({totalWhgCount}/{maxWhg})
                                </button>
                            )}
                            {buildingType === 'mfh' && totalWhgCount >= maxWhg && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                                    Maximale Anzahl Wohnungen erreicht ({maxWhg})
                                </div>
                            )}
                        </Card>
                    ))}

                    {totalWhgCount < maxWhg && (
                        <div style={{
                            padding: '10px 16px', borderRadius: 'var(--radius-md)',
                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                            fontSize: '0.82rem', color: '#b91c1c',
                            display: 'flex', alignItems: 'center', gap: '8px',
                        }}>
                            <Info size={16} />
                            <span>Bitte alle <strong>{maxWhg}</strong> Wohnungen anlegen. Aktuell: <strong>{totalWhgCount}</strong> von {maxWhg}.</span>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <Button variant="secondary" onClick={() => setStep(0)}>
                            <ArrowLeft size={15} style={{ marginRight: '4px' }} /> Zurück
                        </Button>
                        <Button onClick={() => setStep(2)} disabled={totalWhgCount < maxWhg} style={{ opacity: totalWhgCount < maxWhg ? 0.5 : 1 }}>
                            Kalkulation <ArrowRight size={15} style={{ marginLeft: '4px' }} />
                        </Button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 3: KALKULATION ═══ */}
            {step === 2 && (() => {
                /* ─── Generate Calculation ───── */
                const doGenerateCalc = async (mode = 'all') => {
                    setLoadingCalc(true);
                    try {
                        // Load user trades from DB
                        const { data: tData } = await supabase
                            .from('renovation_trades')
                            .select('*, subtrades:renovation_subtrades(*)')
                            .eq('user_id', user.id)
                            .order('sort_order');

                        const userTrades = (tData || []).map(t => ({
                            ...t,
                            subtrades: (t.subtrades || []).map(s => ({
                                ...s,
                                positions: Array.isArray(s.positions)
                                    ? s.positions
                                    : (typeof s.positions === 'string' ? JSON.parse(s.positions) : []),
                            })),
                        }));

                        const newLines = generateCalcLines({
                            buildingType, floorHeight, unitCount, floorCount,
                            roofType, houseWidth, houseLength, roofAngle, gaubenCount,
                            floors, userTrades,
                        });

                        if (mode === 'all' || calcLines.length === 0) {
                            setCalcLines(newLines);
                        } else if (mode === 'empty') {
                            // Only fill lines where qty is 0 or missing
                            setCalcLines(prev => prev.map(existing => {
                                if (existing.qty > 0) return existing;
                                const fresh = newLines.find(n => n.position === existing.position && n.trade === existing.trade);
                                return fresh ? { ...existing, qty: fresh.qty, ep: fresh.ep, gp: fresh.gp, enabled: fresh.enabled } : existing;
                            }));
                        }

                        setCalcGenerated(true);
                        // Auto-expand all trades
                        const expanded = {};
                        userTrades.forEach(t => { expanded[t.name] = true; });
                        setExpandedTrades(expanded);
                    } catch (err) {
                        alert('Fehler beim Berechnen: ' + err.message);
                    } finally {
                        setLoadingCalc(false);
                        setShowRecalcDialog(false);
                    }
                };

                /* ─── Update a single calc line ───── */
                const updateCalcLine = (idx, field, value) => {
                    setCalcLines(prev => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], [field]: value };
                        if (field === 'qty' || field === 'ep') {
                            next[idx].gp = Math.round(((next[idx].qty || 0) * (next[idx].ep || 0)) * 100) / 100;
                        }
                        return next;
                    });
                };

                /* ─── Add custom position to a trade ───── */
                const addCalcLine = (tradeName) => {
                    // Find the last line of this trade to insert after it
                    const lastIdx = calcLines.reduce((last, l, i) => l.trade === tradeName ? i : last, -1);
                    const insertAt = lastIdx + 1;
                    const newLine = {
                        id: `custom_${Date.now()}`,
                        trade: tradeName,
                        subtrade: 'Sonstige',
                        position: 'Neue Position',
                        unit: 'Stk.',
                        ep: 0,
                        qty: 0,
                        gp: 0,
                        enabled: true,
                        isCustom: true,
                    };
                    setCalcLines(prev => [
                        ...prev.slice(0, insertAt),
                        newLine,
                        ...prev.slice(insertAt),
                    ]);
                };

                /* ─── Group calc lines by trade ───── */
                const groupedByTrade = calcLines.reduce((acc, line, idx) => {
                    if (!acc[line.trade]) acc[line.trade] = [];
                    acc[line.trade].push({ ...line, _idx: idx });
                    return acc;
                }, {});

                /* ─── Summary stats ───── */
                const allRoomsCount = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.rooms || []).length, 0), 0);
                const allBathsCount = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.bathrooms || []).length, 0), 0);
                const allWindowsCount = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.windows || []).length, 0), 0);
                const allWhgCount = floors.reduce((s, f) => s + f.whgs.length, 0);
                const totalRoomSqm = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.rooms || []).reduce((s3, r) => s3 + (r.sqm || 0), 0), 0), 0);
                const totalBathSqm = floors.reduce((s, f) => s + f.whgs.reduce((s2, w) => s2 + (w.bathrooms || []).reduce((s3, b) => s3 + (b.sqm || 0), 0), 0), 0);

                const enabledTotal = calcLines.filter(l => l.enabled).reduce((s, l) => s + (l.gp || 0), 0);
                const tradeTotal = (tradeName) => calcLines.filter(l => l.trade === tradeName && l.enabled).reduce((s, l) => s + (l.gp || 0), 0);

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Summary Card */}
                        <Card>
                            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Info size={16} color="#0ea5e9" /> Zusammenfassung Eingaben
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: '10px' }}>
                                {[
                                    { label: 'Gebäudetyp', value: BUILDING_TYPES.find(b => b.key === buildingType)?.label },
                                    { label: 'Etagen', value: buildingType === 'wohnung' ? '–' : floorCount },
                                    { label: 'Geschosshöhe', value: `${floorHeight} m` },
                                    { label: 'Einheiten', value: buildingType === 'mfh' ? unitCount : 1 },
                                    { label: 'Wohnungen', value: allWhgCount },
                                    { label: 'Zimmer', value: allRoomsCount },
                                    { label: 'Bäder', value: allBathsCount },
                                    { label: 'Fenster', value: allWindowsCount },
                                    { label: 'Wohnfläche', value: `${totalRoomSqm.toFixed(1)} m²` },
                                    { label: 'Badfläche', value: `${totalBathSqm.toFixed(1)} m²` },
                                    { label: 'Dachform', value: ROOF_TYPES.find(r => r.key === roofType)?.label || '–' },
                                    isEfhMfh ? { label: 'Gebäude', value: `${houseWidth}×${houseLength} m` } : { label: 'Gauben', value: gaubenCount },
                                ].map((item, i) => (
                                    <div key={i} style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--background-color)', border: '1px solid var(--border-color)' }}>
                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '2px' }}>{item.label}</div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </Card>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {!calcGenerated ? (
                                <Button onClick={() => doGenerateCalc('all')} disabled={loadingCalc} style={{ flex: 1 }}>
                                    {loadingCalc ? <Loader2 size={16} className="animate-spin" /> : <><Calculator size={15} style={{ marginRight: '6px' }} /> Kalkulation erstellen</>}
                                </Button>
                            ) : (
                                <>
                                    <Button variant="secondary" onClick={() => setShowRecalcDialog(true)} style={{ flex: 1 }}>
                                        <Calculator size={15} style={{ marginRight: '6px' }} /> Neu berechnen
                                    </Button>
                                    <Button variant="secondary" onClick={async () => {
                                        const pdfData = Object.entries(groupedByTrade).map(([tradeName, lines]) => ({
                                            gewerk: tradeName,
                                            summe: lines.filter(l => l.enabled).reduce((s, l) => s + (l.gp || 0), 0),
                                            positionen: lines.filter(l => l.enabled).map(l => `${l.position}: ${l.qty} ${l.unit || 'Stk'} × ${(l.ep || 0).toFixed(2)} € = ${(l.gp || 0).toFixed(2)} €`).join('\n'),
                                        }));
                                        // Resolve the correct PDF template based on the property's portfolio
                                        let tpl = pdfTemplate;
                                        if (propertyId) {
                                            const prop = properties.find(p => p.id === propertyId);
                                            if (prop?.portfolio_id) {
                                                tpl = await fetchPdfTemplate(prop.portfolio_id, 'sanierung_rechner');
                                            }
                                        }
                                        generateClientPdf({
                                            reportType: 'sanierung_rechner',
                                            data: pdfData,
                                            selectedColumns: ['gewerk', 'summe', 'positionen'],
                                            showSums: true,
                                            portfolioName: name || 'Kalkulation',
                                            template: tpl,
                                            subtitle: `Gesamt: ${enabledTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`,
                                        });
                                    }}>
                                        <FileText size={15} style={{ marginRight: '6px' }} /> PDF Export
                                    </Button>
                                </>
                            )}
                        </div>

                        {/* Recalc Dialog */}
                        {showRecalcDialog && (
                            <Card style={{ border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.05)' }}>
                                <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px', color: '#92400e' }}>Mengen neu berechnen?</h4>
                                <p style={{ fontSize: '0.82rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                    Wählen Sie, ob alle Mengen überschrieben oder nur leere Felder gefüllt werden sollen.
                                </p>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <Button onClick={() => doGenerateCalc('all')} disabled={loadingCalc}>
                                        {loadingCalc ? <Loader2 size={14} className="animate-spin" /> : 'Alle überschreiben'}
                                    </Button>
                                    <Button variant="secondary" onClick={() => doGenerateCalc('empty')} disabled={loadingCalc}>
                                        Nur leere füllen
                                    </Button>
                                    <Button variant="secondary" onClick={() => setShowRecalcDialog(false)}>
                                        Abbrechen
                                    </Button>
                                </div>
                            </Card>
                        )}

                        {/* Calc Table */}
                        {calcGenerated && calcLines.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {Object.entries(groupedByTrade).map(([tradeName, lines]) => {
                                    const isExpanded = expandedTrades[tradeName];
                                    const tTotal = tradeTotal(tradeName);
                                    return (
                                        <Card key={tradeName} style={{ padding: '0', overflow: 'hidden' }}>
                                            {/* Trade Header */}
                                            <button
                                                onClick={() => setExpandedTrades(prev => ({ ...prev, [tradeName]: !prev[tradeName] }))}
                                                style={{
                                                    width: '100%', display: 'flex', justifyContent: 'space-between',
                                                    alignItems: 'center', padding: '12px 16px', border: 'none',
                                                    background: 'var(--surface-color)', cursor: 'pointer', color: 'var(--text-primary)',
                                                }}
                                            >
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{tradeName}</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>({lines.length} Pos.)</span>
                                                </span>
                                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: tTotal > 0 ? '#0ea5e9' : 'var(--text-secondary)' }}>
                                                    {fmt0(tTotal)}
                                                </span>
                                            </button>

                                            {/* Lines */}
                                            {isExpanded && (
                                                <div style={{ padding: '0 12px 12px' }}>
                                                    {/* Column headers */}
                                                    {!isMobile && (
                                                        <div style={{
                                                            display: 'grid', gridTemplateColumns: '28px 2fr 1fr 70px 80px 80px 90px',
                                                            gap: '6px', padding: '6px 4px', borderBottom: '1px solid var(--border-color)',
                                                            fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase',
                                                        }}>
                                                            <span></span>
                                                            <span>Position</span>
                                                            <span>Untergewerk</span>
                                                            <span style={{ textAlign: 'right' }}>Menge</span>
                                                            <span>Einheit</span>
                                                            <span style={{ textAlign: 'right' }}>EP €</span>
                                                            <span style={{ textAlign: 'right' }}>GP €</span>
                                                        </div>
                                                    )}

                                                    {lines.map((line) => {
                                                        const idx = line._idx;
                                                        return (
                                                            <div key={idx} style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: isMobile
                                                                    ? '24px 1fr 60px 55px 70px'
                                                                    : '28px 2fr 1fr 70px 80px 80px 90px',
                                                                gap: '6px', padding: '5px 4px', alignItems: 'center',
                                                                borderBottom: '1px solid var(--border-color)',
                                                                opacity: line.enabled ? 1 : 0.4,
                                                                background: line.enabled && line.qty > 0 ? 'transparent' : 'var(--background-color)',
                                                            }}>
                                                                <input
                                                                    type="checkbox" checked={line.enabled}
                                                                    onChange={e => updateCalcLine(idx, 'enabled', e.target.checked)}
                                                                />
                                                                {line.isCustom ? (
                                                                    <input
                                                                        value={line.position}
                                                                        onChange={e => updateCalcLine(idx, 'position', e.target.value)}
                                                                        style={{ ...inputStyleSm, fontWeight: 500 }}
                                                                        placeholder="Positionsname"
                                                                    />
                                                                ) : (
                                                                    <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{line.position}</span>
                                                                )}
                                                                {!isMobile && (
                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{line.subtrade}</span>
                                                                )}
                                                                <input
                                                                    type="number" step="0.01" min="0"
                                                                    value={line.qty || ''}
                                                                    onChange={e => updateCalcLine(idx, 'qty', Number(e.target.value))}
                                                                    style={{ ...inputStyleSm, textAlign: 'right', fontWeight: 600 }}
                                                                />
                                                                {!isMobile && (
                                                                    line.isCustom ? (
                                                                        <select
                                                                            value={line.unit}
                                                                            onChange={e => updateCalcLine(idx, 'unit', e.target.value)}
                                                                            style={{ ...inputStyleSm, fontSize: '0.75rem' }}
                                                                        >
                                                                            {['Stk.', 'm²', 'lfm.', 'm³', 'psch.', 'Wo.', 'kg'].map(u => (
                                                                                <option key={u} value={u}>{u}</option>
                                                                            ))}
                                                                        </select>
                                                                    ) : (
                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{line.unit}</span>
                                                                    )
                                                                )}
                                                                <input
                                                                    type="number" step="0.01" min="0"
                                                                    value={line.ep || ''}
                                                                    onChange={e => updateCalcLine(idx, 'ep', Number(e.target.value))}
                                                                    style={{ ...inputStyleSm, textAlign: 'right' }}
                                                                />
                                                                <span style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.82rem', color: line.gp > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                                                    {fmt0(line.gp)}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Add custom position */}
                                                    <div style={{ padding: '6px 4px 0' }}>
                                                        <button onClick={() => addCalcLine(tradeName)} style={addBtnStyle}>
                                                            <Plus size={12} /> Position
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        )}

                        {/* Grand Total */}
                        <div style={{
                            padding: '16px 20px', borderRadius: 'var(--radius-lg)',
                            background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                            color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <span style={{ fontSize: '1rem', fontWeight: 600 }}>Gesamtkosten (aktive Positionen)</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmt0(grandTotal)}</span>
                        </div>

                        {/* Deal info */}
                        {dealId && (
                            <div style={{ padding: '10px 16px', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.82rem', color: '#92400e' }}>
                                <strong>Deal-Verknüpfung:</strong> Beim Speichern wird der Gesamtbetrag ({fmt0(grandTotal)}) im verknüpften Deal als{' '}
                                Sanierungskosten übernommen.
                            </div>
                        )}

                        {/* Navigation + Save */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                            <Button variant="secondary" onClick={() => setStep(1)}>
                                <ArrowLeft size={15} style={{ marginRight: '4px' }} /> Zurück
                            </Button>
                            <Button onClick={handleSave} disabled={saving || saveSuccess}>
                                {saving ? <Loader2 size={16} className="animate-spin" /> : saveSuccess ? <><CheckCircle2 size={15} style={{ marginRight: '4px', color: '#16a34a' }} /> Gespeichert</> : <><Save size={15} style={{ marginRight: '4px' }} /> Speichern</>}
                            </Button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

/* ─── Styles ───── */
const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)', background: 'var(--surface-color)',
    fontSize: '0.875rem', outline: 'none', color: 'var(--text-primary)',
};

const inputStyleSm = {
    width: '100%', padding: '5px 8px', borderRadius: '6px',
    border: '1px solid var(--border-color)', fontSize: '0.8rem',
    outline: 'none', background: 'var(--surface-color)', color: 'var(--text-primary)',
};

const labelStyle = {
    display: 'block', fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', color: 'var(--text-secondary)',
};

const miniLabel = {
    display: 'block', fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '2px',
};

const checkboxLabel = {
    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
};

const deleteBtnStyle = {
    background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px',
};

const addBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px', fontSize: '0.78rem', color: '#0ea5e9',
    background: 'none', border: '1px dashed #0ea5e9', borderRadius: '6px', cursor: 'pointer',
};

const backBtnStyle = {
    display: 'flex', alignItems: 'center', gap: '4px', background: 'none',
    border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
    fontSize: '0.85rem', marginBottom: '16px',
};

const hintStyle = {
    display: 'block', fontSize: '0.7rem', color: '#f59e0b', marginTop: '4px', fontStyle: 'italic',
};

export default RenovationCalculatorDetail;
