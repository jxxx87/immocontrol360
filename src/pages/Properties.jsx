import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { Plus, Building2, MapPin, LayoutGrid, ChevronDown, ChevronRight, Home, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const Properties = () => {
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false); // New saving state

    // Property Modal State
    const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
    const [propertyForm, setPropertyForm] = useState({
        portfolio_id: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        construction_year: '',
        property_type: 'residential' // residential, commercial, mixed
    });

    // Units Logic
    const [expandedPropertyId, setExpandedPropertyId] = useState(null);
    const [units, setUnits] = useState({}); // Map: propertyId -> [units]
    const [loadingUnits, setLoadingUnits] = useState({}); // Map: propertyId -> boolean

    // Unit Modal State
    const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
    const [currentPropertyForUnit, setCurrentPropertyForUnit] = useState(null);
    const [editingUnitId, setEditingUnitId] = useState(null); // Track if editing
    const [unitForm, setUnitForm] = useState({
        unit_name: '',
        floor: '',
        sqm: '',
        rooms: '',
        bathrooms: 1,
        bedrooms: 1,
        balcony: false,
        fitted_kitchen: false,
        is_vacation_rental: false
    });

    // Fetch Properties with Aggregated Data
    const fetchProperties = async () => {
        try {
            setLoading(true);
            let query = supabase
                .from('properties')
                .select(`
                    *,
                    units (
                        id,
                        sqm,
                        target_rent,
                        leases (
                            cold_rent,
                            status
                        )
                    )
                `)
                .order('street');

            if (selectedPortfolioID) {
                query = query.eq('portfolio_id', selectedPortfolioID);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Calculate Aggregations
            const propertiesWithStats = data.map(p => {
                const units = p.units || [];
                const totalUnits = units.length;
                const totalArea = units.reduce((sum, u) => sum + (u.sqm || 0), 0);
                const totalTargetRent = units.reduce((sum, u) => sum + (u.target_rent || 0), 0);

                // Calculate Actual Rent (Sum of active leases' cold_rent)
                const totalActualRent = units.reduce((sum, u) => {
                    const activeLease = u.leases?.find(l => l.status === 'active');
                    return sum + (activeLease ? (activeLease.cold_rent || 0) : 0);
                }, 0);

                return {
                    ...p,
                    stats: {
                        totalUnits,
                        totalArea,
                        totalTargetRent,
                        totalActualRent
                    }
                };
            });

            setProperties(propertiesWithStats || []);

            // If expanded property is no longer in list (e.g. portfolio switch), collapse
            if (expandedPropertyId && data && !data.find(p => p.id === expandedPropertyId)) {
                setExpandedPropertyId(null);
            }
        } catch (error) {
            console.error('Error fetching properties:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchProperties();
        }
    }, [user, selectedPortfolioID]);

    // Fetch Units for a Property
    const fetchUnitsForProperty = async (propertyId) => {
        try {
            setLoadingUnits(prev => ({ ...prev, [propertyId]: true }));
            const { data, error } = await supabase
                .from('units')
                .select('*')
                .eq('property_id', propertyId)
                .order('unit_name');

            if (error) throw error;
            setUnits(prev => ({ ...prev, [propertyId]: data || [] }));
        } catch (error) {
            console.error('Error fetching units:', error);
        } finally {
            setLoadingUnits(prev => ({ ...prev, [propertyId]: false }));
        }
    };

    const toggleExpand = (propertyId) => {
        if (expandedPropertyId === propertyId) {
            setExpandedPropertyId(null);
        } else {
            setExpandedPropertyId(propertyId);
            fetchUnitsForProperty(propertyId);
        }
    };

    // Save Property
    const handleSaveProperty = async () => {
        if (!propertyForm.portfolio_id && portfolios.length > 0) {
            alert('Bitte wählen Sie ein Portfolio aus.');
            return;
        }

        try {
            setIsSaving(true);
            const { error } = await supabase.from('properties').insert([
                {
                    user_id: user.id,
                    portfolio_id: propertyForm.portfolio_id || null,
                    street: propertyForm.street,
                    house_number: propertyForm.house_number,
                    zip: propertyForm.zip,
                    city: propertyForm.city,
                    construction_year: parseInt(propertyForm.construction_year) || null,
                    property_type: propertyForm.property_type
                }
            ]);

            if (error) throw error;

            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // Save Unit
    const handleOpenUnitModal = (property) => {
        setCurrentPropertyForUnit(property);
        setEditingUnitId(null); // Reset editing state
        setUnitForm({
            unit_name: '', floor: '', sqm: '', rooms: '', target_rent: '',
            bathrooms: 1, bedrooms: 1, balcony: false, fitted_kitchen: false, is_vacation_rental: false
        });
        setIsUnitModalOpen(true);
    };

    const handleSaveUnit = async () => {
        if (!currentPropertyForUnit) return;

        try {
            setIsSaving(true);

            const unitData = {
                user_id: user.id,
                property_id: currentPropertyForUnit.id,
                unit_name: unitForm.unit_name,
                floor: unitForm.floor,
                sqm: parseFloat(unitForm.sqm) || 0,
                target_rent: parseFloat(unitForm.target_rent) || 0,
                rooms: parseFloat(unitForm.rooms) || 0,
                bathrooms: parseFloat(unitForm.bathrooms) || 0,
                bedrooms: parseFloat(unitForm.bedrooms) || 0,
                balcony: unitForm.balcony,
                fitted_kitchen: unitForm.fitted_kitchen,
                is_vacation_rental: unitForm.is_vacation_rental
            };

            let error;

            if (editingUnitId) {
                // UPDATE
                const { error: updateError } = await supabase
                    .from('units')
                    .update(unitData)
                    .eq('id', editingUnitId);
                error = updateError;
            } else {
                // INSERT
                const { error: insertError } = await supabase
                    .from('units')
                    .insert([unitData]);
                error = insertError;
            }

            if (error) throw error;

            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditUnit = (property, unit) => {
        setCurrentPropertyForUnit(property);
        setEditingUnitId(unit.id);
        setUnitForm({
            unit_name: unit.unit_name,
            floor: unit.floor,
            sqm: unit.sqm,
            target_rent: unit.target_rent,
            rooms: unit.rooms,
            bathrooms: unit.bathrooms,
            bedrooms: unit.bedrooms,
            balcony: unit.balcony,
            fitted_kitchen: unit.fitted_kitchen,
            is_vacation_rental: unit.is_vacation_rental
        });
        setIsUnitModalOpen(true);
    };

    const handleDeleteUnit = async (propertyId, unitId) => {
        if (!confirm('Möchten Sie diese Einheit wirklich löschen?')) return;

        try {
            const { error } = await supabase.from('units').delete().eq('id', unitId);
            if (error) throw error;
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const propertyColumns = [
        {
            header: '',
            accessor: 'expand',
            width: '40px',
            render: (row) => (
                <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}
                    style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
                >
                    {expandedPropertyId === row.id ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
            )
        },
        {
            header: 'Immobilie',
            accessor: 'street',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: '#E0F2FE',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 'var(--spacing-md)',
                        color: 'var(--primary-color)'
                    }}>
                        <Building2 size={20} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600 }}>{row.street} {row.house_number}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.zip} {row.city}</div>
                    </div>
                </div>
            )
        },
        {
            header: 'Typ',
            accessor: 'property_type',
            render: (row) => row.property_type === 'commercial' ? 'Gewerbe' : 'Wohnen'
        },
        {
            header: 'Einh.',
            accessor: 'stats.totalUnits',
            render: (row) => row.stats?.totalUnits || 0
        },
        {
            header: 'Fläche',
            accessor: 'stats.totalArea',
            render: (row) => <span>{row.stats?.totalArea?.toFixed(1) || '0'} m²</span>
        },
        {
            header: 'Soll',
            accessor: 'stats.totalTargetRent',
            render: (row) => <span>{row.stats?.totalTargetRent?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        },
        {
            header: 'Ist',
            accessor: 'stats.totalActualRent',
            render: (row) => <span style={{ fontWeight: 600 }}>{row.stats?.totalActualRent?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <Button variant="ghost" size="sm" onClick={() => toggleExpand(row.id)}>
                    {expandedPropertyId === row.id ? 'Details schließen' : 'Details / Einheiten'}
                </Button>
            )
        }
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Immobilien</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht Ihrer Wohn- und Gewerbeobjekte</p>
                </div>
                <Button icon={Plus} onClick={() => {
                    // Pre-select active portfolio if set
                    setPropertyForm(prev => ({ ...prev, portfolio_id: selectedPortfolioID || '' }));
                    setIsPropertyModalOpen(true);
                }}>Neue Immobilie</Button>
            </div>

            <Card>
                {properties.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Immobilien gefunden.
                    </div>
                ) : (
                    <div>
                        {/* Custom Table Rendering to support expansion */}
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    {propertyColumns.map((col, idx) => (
                                        <th key={idx} style={{ textAlign: col.align || 'left', width: col.width }}>{col.header}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {properties.map(property => (
                                    <React.Fragment key={property.id}>
                                        <tr style={{ borderBottom: expandedPropertyId === property.id ? 'none' : '1px solid var(--border-color)' }}>
                                            {propertyColumns.map((col, idx) => (
                                                <td key={idx} style={{ textAlign: col.align || 'left' }}>
                                                    {col.render ? col.render(property) : property[col.accessor]}
                                                </td>
                                            ))}
                                        </tr>
                                        {expandedPropertyId === property.id && (
                                            <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid var(--border-color)' }}>
                                                <td colSpan={propertyColumns.length} style={{ padding: 'var(--spacing-md) var(--spacing-xl)' }}>
                                                    <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <Home size={16} /> Einheiten
                                                        </h4>
                                                        <Button size="sm" icon={Plus} onClick={() => handleOpenUnitModal(property)}>Neue Einheit</Button>
                                                    </div>

                                                    {loadingUnits[property.id] ? (
                                                        <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Lade Einheiten...</div>
                                                    ) : (
                                                        !units[property.id] || units[property.id].length === 0 ? (
                                                            <div style={{ padding: '10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einheiten angelegt.</div>
                                                        ) : (
                                                            <table style={{ width: '100%', backgroundColor: 'white', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                                                <thead style={{ backgroundColor: '#F3F4F6' }}>
                                                                    <tr>
                                                                        <th style={{ padding: '8px' }}>Name</th>
                                                                        <th style={{ padding: '8px' }}>Etage</th>
                                                                        <th style={{ padding: '8px' }}>Fläche</th>
                                                                        <th style={{ padding: '8px' }}>Zimmer</th>
                                                                        <th style={{ padding: '8px' }}></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {units[property.id].map(unit => (
                                                                        <tr key={unit.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                            <td style={{ padding: '8px' }}>{unit.unit_name}</td>
                                                                            <td style={{ padding: '8px' }}>{unit.floor}</td>
                                                                            <td style={{ padding: '8px' }}>{unit.sqm} m²</td>
                                                                            <td style={{ padding: '8px' }}>{unit.rooms}</td>
                                                                            <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                                <button
                                                                                    onClick={() => handleEditUnit(property, unit)}
                                                                                    style={{ marginRight: '10px', color: 'var(--primary-color)' }}
                                                                                    title="Einheit bearbeiten"
                                                                                >
                                                                                    Bearbeiten
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleDeleteUnit(property.id, unit.id)}
                                                                                    style={{ color: 'var(--danger-color)' }}
                                                                                    title="Einheit löschen"
                                                                                >
                                                                                    <Trash2 size={14} />
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Property Modal */}
            <Modal
                isOpen={isPropertyModalOpen}
                onClose={() => setIsPropertyModalOpen(false)}
                title="Neue Immobilie anlegen"
                footer={<><Button variant="secondary" onClick={() => setIsPropertyModalOpen(false)}>Abbrechen</Button><Button onClick={handleSaveProperty}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay message="Speichere Immobilie..." />}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Portfolio *</label>
                    <select
                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                        value={propertyForm.portfolio_id}
                        onChange={(e) => setPropertyForm({ ...propertyForm, portfolio_id: e.target.value })}
                    >
                        <option value="">Bitte wählen...</option>
                        {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {portfolios.length === 0 && (
                        <div style={{ marginTop: '5px', fontSize: '0.875rem', color: 'var(--warning-color)' }}>
                            Kein Portfolio vorhanden. <Link to="/settings" style={{ textDecoration: 'underline' }}>Jetzt anlegen</Link>
                        </div>
                    )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Straße" value={propertyForm.street} onChange={(e) => setPropertyForm({ ...propertyForm, street: e.target.value })} />
                    <Input label="Nr." value={propertyForm.house_number} onChange={(e) => setPropertyForm({ ...propertyForm, house_number: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                    <Input label="PLZ" value={propertyForm.zip} onChange={(e) => setPropertyForm({ ...propertyForm, zip: e.target.value })} />
                    <Input label="Ort" value={propertyForm.city} onChange={(e) => setPropertyForm({ ...propertyForm, city: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Baujahr" type="number" value={propertyForm.construction_year} onChange={(e) => setPropertyForm({ ...propertyForm, construction_year: e.target.value })} />
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Typ</label>
                        <select
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                            value={propertyForm.property_type}
                            onChange={(e) => setPropertyForm({ ...propertyForm, property_type: e.target.value })}
                        >
                            <option value="residential">Wohnen</option>
                            <option value="commercial">Gewerbe</option>
                            <option value="mixed">Gemischt</option>
                        </select>
                    </div>
                </div>
            </Modal>

            {/* Unit Modal */}
            <Modal
                isOpen={isUnitModalOpen}
                onClose={() => setIsUnitModalOpen(false)}
                title={editingUnitId ? "Einheit bearbeiten" : `Neue Einheit in ${currentPropertyForUnit?.street} ${currentPropertyForUnit?.house_number}`}
                footer={<><Button variant="secondary" onClick={() => setIsUnitModalOpen(false)}>Abbrechen</Button><Button onClick={handleSaveUnit}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay message="Speichere Einheit..." />}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Name / Nr." placeholder="Whg 1.01" value={unitForm.unit_name} onChange={(e) => setUnitForm({ ...unitForm, unit_name: e.target.value })} />
                    <Input label="Etage" placeholder="1. OG" value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Fläche (m²)" type="number" value={unitForm.sqm} onChange={(e) => setUnitForm({ ...unitForm, sqm: e.target.value })} />
                    <Input label="Zimmer" type="number" value={unitForm.rooms} onChange={(e) => setUnitForm({ ...unitForm, rooms: e.target.value })} />
                    <Input label="Soll-Miete (€)" type="number" value={unitForm.target_rent} onChange={(e) => setUnitForm({ ...unitForm, target_rent: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Bad" type="number" value={unitForm.bathrooms} onChange={(e) => setUnitForm({ ...unitForm, bathrooms: e.target.value })} />
                    <Input label="Schlafzimmer" type="number" value={unitForm.bedrooms} onChange={(e) => setUnitForm({ ...unitForm, bedrooms: e.target.value })} />
                </div>
                <div style={{ marginTop: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-lg)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.balcony} onChange={(e) => setUnitForm({ ...unitForm, balcony: e.target.checked })} /> Balkon
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.fitted_kitchen} onChange={(e) => setUnitForm({ ...unitForm, fitted_kitchen: e.target.checked })} /> Einbauküche
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.is_vacation_rental} onChange={(e) => setUnitForm({ ...unitForm, is_vacation_rental: e.target.checked })} /> Ferienwohnung
                    </label>
                </div>
            </Modal>
        </div>
    );
};

export default Properties;
