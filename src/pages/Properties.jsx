import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Building2, MapPin, LayoutGrid, ChevronDown, ChevronRight, Home, Trash2, Key, AlertCircle, MoreVertical, Edit } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const Properties = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [returnTo, setReturnTo] = useState(null); // Track where to redirect after save

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
        is_vacation_rental: false,
        cold_rent_ist: '', service_charge_soll: '', heating_cost_soll: '', other_costs_soll: '', deposit_soll: ''
    });

    // Unit Action Menu State
    const [openActionMenuId, setOpenActionMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    // Property Action Menu State
    const [openPropertyActionMenuId, setOpenPropertyActionMenuId] = useState(null);
    const [propertyMenuPos, setPropertyMenuPos] = useState({ top: 0, left: 0 });
    const [editingPropertyId, setEditingPropertyId] = useState(null);

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
                .select('*, leases(status, start_date, end_date)')
                .eq('property_id', propertyId)
                .order('unit_name');

            if (error) throw error;

            const today = new Date().toISOString().split('T')[0];
            const processedUnits = (data || []).map(u => {
                const activeLease = u.leases?.find(l =>
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );
                return { ...u, status: activeLease ? 'rented' : 'vacant' };
            });

            setUnits(prev => ({ ...prev, [propertyId]: processedUnits }));
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
            const propData = {
                user_id: user.id,
                portfolio_id: propertyForm.portfolio_id || null,
                street: propertyForm.street,
                house_number: propertyForm.house_number,
                zip: propertyForm.zip,
                city: propertyForm.city,
                construction_year: parseInt(propertyForm.construction_year) || null,
                property_type: propertyForm.property_type,
                total_investment_cost: parseFloat(propertyForm.total_investment_cost) || 0,
                equity_invested: parseFloat(propertyForm.equity_invested) || 0
            };

            let error;
            if (editingPropertyId) {
                const { error: updateError } = await supabase.from('properties').update(propData).eq('id', editingPropertyId);
                error = updateError;
            } else {
                const { error: insertError } = await supabase.from('properties').insert([propData]);
                error = insertError;
            }

            if (error) throw error;

            await new Promise(resolve => setTimeout(resolve, 500));

            // Redirect based on returnTo (e.g. back to Cockpit after edit from InvestorPortal)
            if (returnTo === 'cockpit') {
                setReturnTo(null);
                navigate('/investor-portal');
            } else {
                window.location.reload();
            }
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
            bathrooms: 1, bedrooms: 1, balcony: false, fitted_kitchen: false, is_vacation_rental: false,
            cold_rent_ist: '', service_charge_soll: '', heating_cost_soll: '', other_costs_soll: '', deposit_soll: ''
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
                is_vacation_rental: unitForm.is_vacation_rental,
                cold_rent_ist: parseFloat(unitForm.cold_rent_ist) || null,
                service_charge_soll: parseFloat(unitForm.service_charge_soll) || null,
                heating_cost_soll: parseFloat(unitForm.heating_cost_soll) || null,
                other_costs_soll: parseFloat(unitForm.other_costs_soll) || null,
                deposit_soll: parseFloat(unitForm.deposit_soll) || null
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
            is_vacation_rental: unit.is_vacation_rental,
            cold_rent_ist: unit.cold_rent_ist || '',
            service_charge_soll: unit.service_charge_soll || '',
            heating_cost_soll: unit.heating_cost_soll || '',
            other_costs_soll: unit.other_costs_soll || '',
            deposit_soll: unit.deposit_soll || ''
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

    const handleDeleteProperty = async (propertyId) => {
        if (!confirm('Möchten Sie diese Immobilie wirklich löschen? Alle zugehörigen Einheiten und Mietverträge werden ebenfalls gelöscht.')) return;

        try {
            setIsSaving(true);
            const { error } = await supabase.from('properties').delete().eq('id', propertyId);
            if (error) throw error;
            window.location.reload();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditProperty = (property, source = null) => {
        setEditingPropertyId(property.id);
        if (source) setReturnTo(source);
        setPropertyForm({
            portfolio_id: property.portfolio_id || '',
            street: property.street || '',
            house_number: property.house_number || '',
            zip: property.zip || '',
            city: property.city || '',
            construction_year: property.construction_year || '',
            property_type: property.property_type || 'residential',
            total_investment_cost: property.total_investment_cost || '',
            equity_invested: property.equity_invested || ''
        });
        setIsPropertyModalOpen(true);
    };

    // Handle deep-link from Cockpit: ?editPropertyId=...&returnTo=cockpit
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const editId = params.get('editPropertyId');
        const ret = params.get('returnTo');
        if (editId && properties.length > 0) {
            const prop = properties.find(p => p.id === editId);
            if (prop) {
                handleEditProperty(prop, ret);
                // Clear URL params
                navigate(location.pathname, { replace: true });
            }
        }
    }, [location.search, properties]);

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
                        backgroundColor: 'var(--surface-color)',
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
                <div style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (openPropertyActionMenuId === row.id) {
                                setOpenPropertyActionMenuId(null);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setPropertyMenuPos({ top: rect.bottom, left: rect.right });
                                setOpenPropertyActionMenuId(row.id);
                            }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                    >
                        <MoreVertical size={16} color="var(--text-secondary)" />
                    </button>

                    {openPropertyActionMenuId === row.id && (
                        <>
                            <div
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); }}
                            />
                            <div style={{
                                position: 'fixed',
                                top: propertyMenuPos.top + 5,
                                left: propertyMenuPos.left,
                                transform: 'translateX(-100%)',
                                backgroundColor: 'var(--surface-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                zIndex: 9999,
                                minWidth: '160px',
                                display: 'flex',
                                flexDirection: 'column',
                                padding: '4px'
                            }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); toggleExpand(row.id); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                >
                                    <Home size={14} /> Details / Einheiten
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); handleEditProperty(row); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                >
                                    <Edit size={14} /> Bearbeiten
                                </button>
                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); handleDeleteProperty(row.id); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                >
                                    <Trash2 size={14} /> Löschen
                                </button>
                            </div>
                        </>
                    )}
                </div>
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
                    setEditingPropertyId(null);
                    setPropertyForm({
                        portfolio_id: selectedPortfolioID || '',
                        street: '',
                        house_number: '',
                        zip: '',
                        city: '',
                        construction_year: '',
                        property_type: 'residential',
                        total_investment_cost: '',
                        equity_invested: ''
                    });
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
                                        <tr className="table-row" style={{ borderBottom: expandedPropertyId === property.id ? 'none' : '1px solid var(--border-color)' }}>
                                            {propertyColumns.map((col, idx) => (
                                                <td key={idx} style={{ textAlign: col.align || 'left' }}>
                                                    {col.render ? col.render(property) : property[col.accessor]}
                                                </td>
                                            ))}
                                        </tr>
                                        {expandedPropertyId === property.id && (
                                            <tr style={{ backgroundColor: 'var(--background-color)', borderBottom: '1px solid var(--border-color)' }}>
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
                                                            <table style={{ width: '100%', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                                                <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                                                    <tr>
                                                                        <th style={{ padding: '8px' }}>Name</th>
                                                                        <th style={{ padding: '8px' }}>Etage</th>
                                                                        <th style={{ padding: '8px' }}>Fläche</th>
                                                                        <th style={{ padding: '8px' }}>Zimmer</th>
                                                                        <th style={{ padding: '8px' }}>Status</th>
                                                                        <th style={{ padding: '8px' }}></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {units[property.id].map(unit => (
                                                                        <tr key={unit.id} className="table-row" style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                            <td style={{ padding: '8px' }}>{unit.unit_name}</td>
                                                                            <td style={{ padding: '8px' }}>{unit.floor}</td>
                                                                            <td style={{ padding: '8px' }}>{unit.sqm} m²</td>
                                                                            <td style={{ padding: '8px' }}>{unit.rooms}</td>
                                                                            <td style={{ padding: '8px' }}>
                                                                                {unit.status === 'rented' ? (
                                                                                    <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                        <Key size={12} /> Vermietet
                                                                                    </span>
                                                                                ) : (
                                                                                    <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                        <AlertCircle size={12} /> Leerstand
                                                                                    </span>
                                                                                )}
                                                                            </td>
                                                                            <td style={{ padding: '8px', textAlign: 'right' }}>
                                                                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (openActionMenuId === unit.id) {
                                                                                                setOpenActionMenuId(null);
                                                                                            } else {
                                                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                                                setMenuPos({ top: rect.bottom, left: rect.right }); // Position below default
                                                                                                setOpenActionMenuId(unit.id);
                                                                                            }
                                                                                        }}
                                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                                                                    >
                                                                                        <MoreVertical size={16} color="var(--text-secondary)" />
                                                                                    </button>

                                                                                    {openActionMenuId === unit.id && (
                                                                                        <>
                                                                                            <div
                                                                                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                                                                                onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); }}
                                                                                            />
                                                                                            <div style={{
                                                                                                position: 'fixed',
                                                                                                top: menuPos.top + 5, // Add tiny offset
                                                                                                left: menuPos.left,
                                                                                                transform: 'translateX(-100%)', // Align right edge
                                                                                                backgroundColor: 'var(--surface-color)',
                                                                                                border: '1px solid var(--border-color)',
                                                                                                borderRadius: 'var(--radius-md)',
                                                                                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                                                                                zIndex: 9999,
                                                                                                minWidth: '160px',
                                                                                                display: 'flex',
                                                                                                flexDirection: 'column',
                                                                                                padding: '4px'
                                                                                            }}>
                                                                                                {unit.status === 'vacant' && (
                                                                                                    <button
                                                                                                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); navigate(`/tenants?action=create&propertyId=${property.id}&unitId=${unit.id}`); }}
                                                                                                        style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--success-color)' }}
                                                                                                        title="Einheit vermieten"
                                                                                                    >
                                                                                                        <Plus size={14} /> Vermieten
                                                                                                    </button>
                                                                                                )}
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleEditUnit(property, unit); }}
                                                                                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                                                                                    title="Einheit bearbeiten"
                                                                                                >
                                                                                                    <Edit size={14} /> Bearbeiten
                                                                                                </button>
                                                                                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleDeleteUnit(property.id, unit.id); }}
                                                                                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                                                                                    title="Einheit löschen"
                                                                                                >
                                                                                                    <Trash2 size={14} /> Löschen
                                                                                                </button>
                                                                                            </div>
                                                                                        </>
                                                                                    )}
                                                                                </div>
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
                title={editingPropertyId ? "Immobilie bearbeiten" : "Neue Immobilie anlegen"}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                    <CurrencyInput label="Gesamtinvestition (€)" value={propertyForm.total_investment_cost} onChange={(e) => setPropertyForm({ ...propertyForm, total_investment_cost: e.target.value })} />
                    <CurrencyInput label="Eigenkapital (€)" value={propertyForm.equity_invested} onChange={(e) => setPropertyForm({ ...propertyForm, equity_invested: e.target.value })} />
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Fläche (m²)" type="number" value={unitForm.sqm} onChange={(e) => setUnitForm({ ...unitForm, sqm: e.target.value })} />
                    <Input label="Zimmer" type="number" value={unitForm.rooms} onChange={(e) => setUnitForm({ ...unitForm, rooms: e.target.value })} />
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Finanzielle Daten (Soll/Ist)</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Kaltmiete Soll (€)" allowDecimals value={unitForm.target_rent} onChange={(e) => setUnitForm({ ...unitForm, target_rent: e.target.value })} />
                        <CurrencyInput label="Kaltmiete Ist (€)" allowDecimals value={unitForm.cold_rent_ist} onChange={(e) => setUnitForm({ ...unitForm, cold_rent_ist: e.target.value })} placeholder="Optional" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Nebenkosten Soll (€)" allowDecimals value={unitForm.service_charge_soll} onChange={(e) => setUnitForm({ ...unitForm, service_charge_soll: e.target.value })} />
                        <CurrencyInput label="Heizkosten Soll (€)" allowDecimals value={unitForm.heating_cost_soll} onChange={(e) => setUnitForm({ ...unitForm, heating_cost_soll: e.target.value })} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Sonstige Kosten Soll (€)" allowDecimals value={unitForm.other_costs_soll} onChange={(e) => setUnitForm({ ...unitForm, other_costs_soll: e.target.value })} />
                        <CurrencyInput label="Kaution Soll (€)" allowDecimals value={unitForm.deposit_soll} onChange={(e) => setUnitForm({ ...unitForm, deposit_soll: e.target.value })} />
                    </div>
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
