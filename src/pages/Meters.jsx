import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import LoadingOverlay from '../components/ui/LoadingOverlay';
import { Plus, Zap, Droplets, Flame, MoreHorizontal, Filter, Loader2, Gauge, Trash2, Edit2, Search, MoreVertical, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { translateError } from '../lib/errorTranslator';

const ActionMenu = ({ onEdit, onDelete, onHistory, onReading }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);
    const contentRef = useRef(null);
    const [menuStyle, setMenuStyle] = useState({});

    useEffect(() => {
        const handleClickOutside = (event) => {
            // Check if click is outside BOTH the trigger button (menuRef) AND the portal content (contentRef)
            const isOutsideTrigger = menuRef.current && !menuRef.current.contains(event.target);
            const isOutsideContent = contentRef.current && !contentRef.current.contains(event.target);

            if (isOutsideTrigger && isOutsideContent) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);

            // Calculate Position
            // Use fixed position relative to viewport, so we don't need scrollY if we use fixed.
            // But if user scrolls while menu is open, we want it to stick or close?
            // Usually fixed menus stay put on screen.
            // Let's use getBoundingClientRect which is relative to viewport.
            if (menuRef.current) {
                const rect = menuRef.current.getBoundingClientRect();
                setMenuStyle({
                    position: 'fixed',
                    top: `${rect.bottom + 5}px`, // Fixed is viewport relative
                    left: `${rect.right - 160}px`,
                    zIndex: 9999
                });
            }
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // Use Portal to render outside of table overflow
    const MenuContent = (
        <div
            ref={contentRef}
            style={{
                ...menuStyle,
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                minWidth: '160px',
                overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()} // Stop bubbling to prevent immediate close if table row has click handlers
        >
            <div style={{ display: 'flex', flexDirection: 'column', padding: '4px' }}>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onReading(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Plus size={16} /> Stand erfassen
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onHistory(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <FileText size={16} /> Historie
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onEdit(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--text-primary)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Edit2 size={16} /> Bearbeiten
                </button>
                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                <button
                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onDelete(); }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', width: '100%', textAlign: 'left',
                        border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', color: 'var(--danger-color)',
                        borderRadius: '4px', transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    <Trash2 size={16} /> Löschen
                </button>
            </div>
        </div>
    );

    return (
        <div style={{ position: 'relative' }} ref={menuRef}>
            <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} />
            {isOpen && createPortal(MenuContent, document.body)}
        </div>
    );
};

const Meters = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();

    // Data State
    const [meters, setMeters] = useState([]);
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Filter State
    const [filters, setFilters] = useState({
        propertyId: '',
        meterType: 'all',
        search: ''
    });

    // Modal State
    const [isMeterModalOpen, setIsMeterModalOpen] = useState(false);
    const [editingMeter, setEditingMeter] = useState(null);
    const [meterForm, setMeterForm] = useState({
        property_id: '',
        unit_id: '', // nullable (null = Property Level)
        meter_number: '',
        meter_type: 'Strom',
        unit: 'kWh',
        meter_name: '',
        location: '',
        supplier: '',
        contract_number: '',
        notes: ''
    });

    // Reading Modal State
    const [isReadingModalOpen, setIsReadingModalOpen] = useState(false);
    const [readingMeter, setReadingMeter] = useState(null);
    const [readingForm, setReadingForm] = useState({
        value: '',
        date: new Date().toISOString().split('T')[0],
        note: ''
    });

    // Detail Modal State
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [detailMeter, setDetailMeter] = useState(null);
    const [readingsHistory, setReadingsHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // --- DATA FETCHING ---
    const fetchData = React.useCallback(async () => {
        if (!user) return;
        setLoading(true);
        console.log("Fetching data... user:", user.id, "portfolio:", selectedPortfolioID);

        try {
            // 1. Fetch Meters
            let meterQuery = supabase
                .from('meters')
                .select(`
                    *,
                    property:properties(id, street, house_number, city),
                    unit_ref:units(id, unit_name, floor) 
                `)
                .order('created_at', { ascending: false });

            if (selectedPortfolioID) meterQuery = meterQuery.eq('portfolio_id', selectedPortfolioID);

            const { data: meterData, error: meterError } = await meterQuery;

            if (meterError) {
                console.error("Error fetching meters:", meterError);
                // alert("Fehler beim Laden der Zähler: " + meterError.message);
            } else {
                setMeters(meterData || []);
            }

            // 2. Fetch Properties for filters/dropdowns
            let propQuery = supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id')
                .order('street');

            if (selectedPortfolioID) {
                console.log("Filtering properties by portfolio:", selectedPortfolioID);
                propQuery = propQuery.eq('portfolio_id', selectedPortfolioID);
            }

            const { data: propData, error: propError } = await propQuery;

            if (propError) {
                console.error("Error fetching properties:", propError);
                // alert("Fehler beim Laden der Immobilien: " + propError.message);
            } else {
                console.log("Loaded properties:", propData?.length);
                setProperties(propData || []);
            }

        } catch (error) {
            console.error('Unexpected error fetching data:', error);
        } finally {
            setLoading(false);
        }
    }, [user, selectedPortfolioID]);

    useEffect(() => {
        setFilters({
            propertyId: '',
            meterType: 'all',
            search: ''
        });
        fetchData();
    }, [user, selectedPortfolioID, fetchData]);

    // Fetch units for a specific property (for Modal dropdown)
    const fetchUnitsForProperty = async (propertyId) => {
        if (!propertyId) {
            setUnits([]);
            return;
        }
        const { data } = await supabase.from('units').select('*').eq('property_id', propertyId).order('unit_name');
        setUnits(data || []);
    };

    // Use effect to load units when form property changes
    useEffect(() => {
        if (isMeterModalOpen && meterForm.property_id) {
            fetchUnitsForProperty(meterForm.property_id);
        } else if (!meterForm.property_id) {
            setUnits([]);
        }
    }, [meterForm.property_id, isMeterModalOpen]);

    // --- COMPUTED / FILTERED DATA ---
    const filteredMeters = meters.filter(m => {
        // Portfolio filter already applied in query
        if (filters.propertyId && m.property_id !== filters.propertyId) return false;
        if (filters.meterType !== 'all' && m.meter_type !== filters.meterType) return false;
        if (filters.search) {
            const term = filters.search.toLowerCase();
            return (
                (m.meter_number || '').toLowerCase().includes(term) ||
                (m.meter_name || '').toLowerCase().includes(term) ||
                (m.supplier || '').toLowerCase().includes(term) ||
                (m.location || '').toLowerCase().includes(term) ||
                (m.contract_number || '').toLowerCase().includes(term) ||
                (m.notes || '').toLowerCase().includes(term) ||
                // Search in Property
                (m.property?.street || '').toLowerCase().includes(term) ||
                (m.property?.city || '').toLowerCase().includes(term) ||
                // Search in Unit
                (m.unit_ref?.unit_name || '').toLowerCase().includes(term)
            );
        }
        return true;
    });

    // --- ACTIONS ---

    const handleOpenAdd = () => {
        setEditingMeter(null);
        setMeterForm({
            property_id: '',
            unit_id: '',
            meter_number: '',
            meter_type: 'Strom',
            unit: 'kWh',
            meter_name: '',
            location: '',
            supplier: '',
            contract_number: '',
            notes: ''
        });
        setUnits([]);
        setIsMeterModalOpen(true);
    };

    const handleOpenEdit = (meter) => {
        setEditingMeter(meter);
        setMeterForm({
            property_id: meter.property_id,
            unit_id: meter.unit_id || '',
            meter_number: meter.meter_number,
            meter_type: meter.meter_type,
            unit: meter.unit,
            meter_name: meter.meter_name || '',
            location: meter.location || '',
            supplier: meter.supplier || '',
            contract_number: meter.contract_number || '',
            notes: meter.notes || ''
        });
        setIsMeterModalOpen(true);
    };

    const handleSaveMeter = async () => {
        // Validation
        if (!meterForm.property_id) return alert('Bitte wählen Sie eine Immobilie.');
        if (!meterForm.meter_number) return alert('Bitte geben Sie eine Zählernummer ein.');

        try {
            setIsSaving(true);

            // Find portfolio_id from property if not explicit (but usually property belongs to a portfolio)
            // We need portfolio_id for the insert.
            // Since we filtered properties by selectedPortfolio, we can try to find it in properties list
            // OR if selectedPortfolioID is set use that. 
            // BUT if selectedPortfolioID is empty (All), we must get it from the chosen property.
            const selectedProp = properties.find(p => p.id === meterForm.property_id);
            if (!selectedProp) throw new Error('Immobilie nicht gefunden');

            const payload = {
                user_id: user.id,
                portfolio_id: selectedProp.portfolio_id, // ensure correct mapping
                property_id: meterForm.property_id,
                unit_id: meterForm.unit_id || null,
                meter_number: meterForm.meter_number,
                meter_type: meterForm.meter_type,
                unit: meterForm.unit,
                meter_name: meterForm.meter_name,
                location: meterForm.location,
                supplier: meterForm.supplier,
                contract_number: meterForm.contract_number,
                notes: meterForm.notes
            };

            if (editingMeter) {
                const { error } = await supabase
                    .from('meters')
                    .update(payload)
                    .eq('id', editingMeter.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('meters')
                    .insert([payload]);
                if (error) throw error;
            }

            setIsMeterModalOpen(false);
            fetchData(); // Reload table

        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteMeter = async (id) => {
        if (!window.confirm('Möchten Sie diesen Zähler wirklich löschen? Alle erfassten Stände werden ebenfalls gelöscht.')) return;
        try {
            setIsSaving(true); // show generic saving overlay
            const { error } = await supabase.from('meters').delete().eq('id', id);
            if (error) throw error;
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // --- READING ACTIONS ---
    const handleOpenReading = (meter) => {
        setReadingMeter(meter);
        setReadingForm({
            value: '',
            date: new Date().toISOString().split('T')[0],
            note: ''
        });
        setIsReadingModalOpen(true);
    };

    const handleSaveReading = async () => {
        if (!readingForm.value) return alert('Bitte Zählerstand eingeben.');
        if (!readingForm.date) return alert('Bitte Datum eingeben.');

        try {
            setIsSaving(true);
            const payload = {
                meter_id: readingMeter.id,
                user_id: user.id,
                portfolio_id: readingMeter.portfolio_id,
                reading_value: parseFloat(readingForm.value.replace(',', '.')),
                reading_date: readingForm.date,
                note: readingForm.note
            };

            const { error } = await supabase.from('meter_readings').insert([payload]);
            if (error) throw error;

            setIsReadingModalOpen(false);
            // Trigger auto-updates last_reading on meters table via DB trigger, but we need to reload UI
            fetchData();

        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // --- DETAIL ACTIONS ---
    const handleOpenDetail = async (meter) => {
        setDetailMeter(meter);
        setIsDetailModalOpen(true);
        setLoadingHistory(true);
        try {
            const { data, error } = await supabase
                .from('meter_readings')
                .select('*')
                .eq('meter_id', meter.id)
                .order('reading_date', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            setReadingsHistory(data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingHistory(false);
        }
    };

    // --- UTILS ---
    const getIcon = (type) => {
        switch (type) {
            case 'Strom': return <Zap size={18} />;
            case 'Kaltwasser': case 'Warmwasser': return <Droplets size={18} />;
            case 'Gas': case 'Wärmemengen': return <Flame size={18} />;
            default: return <Gauge size={18} />;
        }
    };

    const formatPropName = (row) => {
        const p = row.property;
        if (!p) return '-';
        return `${p.street} ${p.house_number}, ${p.city}`;
    };

    const columns = [
        {
            header: 'Typ',
            accessor: 'meter_type',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        padding: '4px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--background-color)',
                        display: 'flex',
                        color: 'var(--text-secondary)'
                    }}>
                        {getIcon(row.meter_type)}
                    </div>
                    <span>{row.meter_type}</span>
                </div>
            )
        },
        { header: 'Nr.', accessor: 'meter_number', render: r => <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{r.meter_number}</span> },
        { header: 'Immobilie', accessor: 'property', render: formatPropName },
        { header: 'Zuordnung', accessor: 'unit_ref', render: r => r.unit_ref ? `Einheit: ${r.unit_ref.unit_name}` : `Gebäudezähler` },
        { header: 'Stand', accessor: 'last_reading_value', align: 'right', render: r => r.last_reading_value != null ? `${r.last_reading_value} ${r.unit}` : '-' },
        { header: 'Datum', accessor: 'last_reading_date', align: 'right', render: r => r.last_reading_date ? new Date(r.last_reading_date).toLocaleDateString() : '-' },
        { header: 'Versorger', accessor: 'supplier', align: 'right', render: r => r.supplier || '-' },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ActionMenu
                        onReading={() => handleOpenReading(row)}
                        onHistory={() => handleOpenDetail(row)}
                        onEdit={() => handleOpenEdit(row)}
                        onDelete={() => handleDeleteMeter(row.id)}
                    />
                </div>
            )
        }
    ];

    return (
        <div>
            {isSaving && <LoadingOverlay message="Wird gespeichert..." />}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Zähler</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Verwalten Sie Ihre Zähler und erfassen Sie Stände.</p>
                </div>
                <Button icon={Plus} onClick={handleOpenAdd}>Zähler hinzufügen</Button>
            </div>

            {/* Filter Bar */}
            <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-md)', alignItems: 'end' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Immobilie</label>
                        <div style={{ position: 'relative' }}>
                            <select
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    appearance: 'none',
                                    backgroundColor: 'var(--surface-color)'
                                }}
                                value={filters.propertyId}
                                onChange={(e) => setFilters({ ...filters, propertyId: e.target.value })}
                            >
                                <option value="">Alle Immobilien</option>
                                {properties.map(p => (
                                    <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>
                                ))}
                            </select>
                            <Filter size={16} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#9CA3AF' }} />
                        </div>
                    </div>

                    <div style={{ flex: 1, minWidth: '150px' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Zählertyp</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={filters.meterType}
                            onChange={(e) => setFilters({ ...filters, meterType: e.target.value })}
                        >
                            <option value="all">Alle Typen</option>
                            <option value="Strom">Strom</option>
                            <option value="Kaltwasser">Kaltwasser</option>
                            <option value="Warmwasser">Warmwasser</option>
                            <option value="Gas">Gas</option>
                            <option value="Wärmemengen">Wärmemengen</option>
                            <option value="Sonstiges">Sonstiges</option>
                        </select>
                    </div>

                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Suche</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                placeholder="Nr, Name, Versorger..."
                                style={{
                                    width: '100%',
                                    padding: '0.5rem 0.5rem 0.5rem 2rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    outline: 'none'
                                }}
                                value={filters.search}
                                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            />
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
                        <Loader2 className="animate-spin" />
                    </div>
                ) : (
                    <Table columns={columns} data={filteredMeters} />
                )}
            </Card>

            {/* --- ADD / EDIT MODAL --- */}
            <Modal
                isOpen={isMeterModalOpen}
                onClose={() => setIsMeterModalOpen(false)}
                title={editingMeter ? 'Zähler bearbeiten' : 'Neuen Zähler anlegen'}
                maxWidth="800px"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsMeterModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveMeter}>Speichern</Button>
                    </>
                }
            >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie *</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.property_id}
                            onChange={(e) => setMeterForm({ ...meterForm, property_id: e.target.value, unit_id: '' })}
                        >
                            <option value="">Bitte wählen...</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.street} {p.house_number}, {p.city}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit (Optional)</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.unit_id}
                            onChange={(e) => setMeterForm({ ...meterForm, unit_id: e.target.value })}
                            disabled={!meterForm.property_id}
                        >
                            <option value="">Keine (Gebäudezähler)</option>
                            {units.map(u => (
                                <option key={u.id} value={u.id}>{u.unit_name} ({u.floor})</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Zählernummer *"
                        value={meterForm.meter_number}
                        onChange={(e) => setMeterForm({ ...meterForm, meter_number: e.target.value })}
                    />
                    <Input
                        label="Zählername (z.B. Hauptzähler)"
                        value={meterForm.meter_name}
                        onChange={(e) => setMeterForm({ ...meterForm, meter_name: e.target.value })}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Zählertyp *</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.meter_type}
                            onChange={(e) => setMeterForm({ ...meterForm, meter_type: e.target.value })}
                        >
                            <option value="Strom">Strom</option>
                            <option value="Kaltwasser">Kaltwasser</option>
                            <option value="Warmwasser">Warmwasser</option>
                            <option value="Gas">Gas</option>
                            <option value="Wärmemengen">Wärmemengen</option>
                            <option value="Sonstiges">Sonstiges</option>
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit *</label>
                        <select
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)'
                            }}
                            value={meterForm.unit}
                            onChange={(e) => setMeterForm({ ...meterForm, unit: e.target.value })}
                        >
                            <option value="kWh">kWh</option>
                            <option value="Wh">Wh</option>
                            <option value="m³">m³</option>
                            <option value="Liter">Liter</option>
                            <option value="sonstiges">sonstiges</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Versorger"
                        value={meterForm.supplier}
                        onChange={(e) => setMeterForm({ ...meterForm, supplier: e.target.value })}
                    />
                    <Input
                        label="Vertragsnummer"
                        value={meterForm.contract_number}
                        onChange={(e) => setMeterForm({ ...meterForm, contract_number: e.target.value })}
                    />
                </div>
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <Input
                        label="Lage im Objekt (z.B. Keller, Wohnung)"
                        value={meterForm.location}
                        onChange={(e) => setMeterForm({ ...meterForm, location: e.target.value })}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Notizen</label>
                    <textarea
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            minHeight: '80px',
                            resize: 'vertical'
                        }}
                        value={meterForm.notes}
                        onChange={(e) => setMeterForm({ ...meterForm, notes: e.target.value })}
                    />
                </div>
            </Modal>

            {/* --- READING MODAL --- */}
            <Modal
                isOpen={isReadingModalOpen}
                onClose={() => setIsReadingModalOpen(false)}
                title="Zählerstand erfassen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsReadingModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveReading}>Speichern</Button>
                    </>
                }
            >
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <strong>{readingMeter?.meter_type} Zähler {readingMeter?.meter_number}</strong>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Aktueller Stand: {readingMeter?.last_reading_value ?? '-'} {readingMeter?.unit}
                        {readingMeter?.last_reading_date && ` (vom ${new Date(readingMeter.last_reading_date).toLocaleDateString()})`}
                    </div>
                </div>
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    <Input
                        label={`Neuer Zählerstand (${readingMeter?.unit}) *`}
                        type="number"
                        step="any"
                        value={readingForm.value}
                        onChange={(e) => setReadingForm({ ...readingForm, value: e.target.value })}
                    />
                    <Input
                        label="Ablesedatum *"
                        type="date"
                        value={readingForm.date}
                        onChange={(e) => setReadingForm({ ...readingForm, date: e.target.value })}
                    />
                    <Input
                        label="Notiz (optional)"
                        value={readingForm.note}
                        onChange={(e) => setReadingForm({ ...readingForm, note: e.target.value })}
                    />
                </div>
            </Modal>

            {/* --- DETAIL MODAL --- */}
            <Modal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                title="Zähler Details & Historie"
                maxWidth="800px"
                footer={<Button variant="secondary" onClick={() => setIsDetailModalOpen(false)}>Schließen</Button>}
            >
                {detailMeter && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                        {/* Master Data */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem', backgroundColor: 'var(--background-color)', borderRadius: '8px' }}>
                            <div>
                                <small style={{ color: '#6B7280' }}>Zählernummer</small>
                                <div style={{ fontWeight: 600 }}>{detailMeter.meter_number}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Typ</small>
                                <div>{detailMeter.meter_type} ({detailMeter.unit})</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Immobilie</small>
                                <div>{formatPropName({ property: detailMeter.property })}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Lage</small>
                                <div>{detailMeter.location || '-'}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Versorger</small>
                                <div>{detailMeter.supplier || '-'}</div>
                            </div>
                            <div>
                                <small style={{ color: '#6B7280' }}>Vertrags-Nr.</small>
                                <div>{detailMeter.contract_number || '-'}</div>
                            </div>
                        </div>

                        {/* History Table */}
                        <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Ablesehistorie</h3>
                            {loadingHistory ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}><Loader2 className="animate-spin" /></div>
                            ) : readingsHistory.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einträge vorhanden.</p>
                            ) : (
                                <Table
                                    data={readingsHistory}
                                    columns={[
                                        { header: 'Datum', accessor: 'reading_date', render: r => new Date(r.reading_date).toLocaleDateString() },
                                        { header: 'Wert', accessor: 'reading_value', align: 'right', render: r => <span style={{ fontWeight: 600 }}>{r.reading_value} {detailMeter.unit}</span> },
                                        { header: 'Notiz', accessor: 'note', render: r => r.note || '-' }
                                    ]}
                                />
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default Meters;
