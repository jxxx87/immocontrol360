import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Users, Loader2, Search, Trash2, Eye, Filter, Home, Key, AlertCircle, Edit, MoreVertical } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const Tenants = () => {
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const location = useLocation();
    const navigate = useNavigate();

    // Process URL Params
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const action = params.get('action');
        const propertyId = params.get('propertyId');
        const unitId = params.get('unitId');

        if (action === 'create' && propertyId && unitId) {
            setLeaseForm(prev => ({
                ...prev,
                property_id: propertyId,
                unit_id: unitId
            }));
            setCurrentStep(1); // Start with Tenant creation
            setIsCreateModalOpen(true);
            // Clear URL
            navigate(location.pathname, { replace: true });
        }
    }, [location.search, navigate, location.pathname]);

    // Data State
    const [units, setUnits] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Filter State
    const [filterPropertyId, setFilterPropertyId] = useState('');
    const [showEndedLeases, setShowEndedLeases] = useState(false);

    // KPIs
    const [stats, setStats] = useState({ total: 0, rented: 0, vacant: 0 });

    // Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [currentStep, setCurrentStep] = useState(1); // 1: Tenant, 2: Lease
    const [createdTenantId, setCreatedTenantId] = useState(null);

    // Detail Modal State
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedLease, setSelectedLease] = useState(null);
    const [isEditingDetails, setIsEditingDetails] = useState(false);

    // Edit Form Data
    const [editTenantForm, setEditTenantForm] = useState({});
    const [editLeaseForm, setEditLeaseForm] = useState({});
    const [openActionMenuId, setOpenActionMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    // Form Data
    const [tenantForm, setTenantForm] = useState({
        first_name: '', last_name: '', email: '', phone: '', occupants: 1
    });
    const [leaseForm, setLeaseForm] = useState({
        property_id: '',
        unit_id: '',
        start_date: '',
        end_date: '',
        cold_rent: '',
        service_charge: '',
        heating_cost: '',
        other_costs: '',
        deposit: '',
        payment_due_day: 3
    });

    // Helper Data for Dropdowns
    const [propertiesDropdown, setPropertiesDropdown] = useState([]);
    const [unitsDropdown, setUnitsDropdown] = useState([]);

    // Fetch Data (Units + Active Leases)
    const fetchData = async () => {
        try {
            setLoading(true);

            // 1. Fetch All Properties (for Filter & Dropdown)
            let propQuery = supabase.from('properties').select('id, street, house_number, zip, city, portfolio_id').order('street');
            const { data: propsData } = await propQuery;

            let allProps = propsData || [];
            // Filter by Portfolio for main view
            let viewProps = allProps;
            if (selectedPortfolioID) {
                viewProps = allProps.filter(p => p.portfolio_id === selectedPortfolioID);
            }
            setProperties(viewProps);
            setPropertiesDropdown(allProps); // For Create Modal (might allow cross-portfolio or strict? Let's keep strict if needed, but user might want flexibility)

            // 2. Fetch Units (for View)
            // We need units that belong to the visible properties
            const viewPropIds = viewProps.map(p => p.id);

            if (viewPropIds.length === 0) {
                setUnits([]);
                setStats({ total: 0, rented: 0, vacant: 0 });
                setLoading(false);
                return;
            }

            // Fetch Units with Property info
            const { data: unitsData, error: unitsError } = await supabase
                .from('units')
                .select('*, property:properties(*)')
                .in('property_id', viewPropIds);

            if (unitsError) throw unitsError;

            // 3. Fetch Active Leases for these units
            const { data: leasesData, error: leasesError } = await supabase
                .from('leases')
                .select('*, tenant:tenants(*)')
                .in('unit_id', unitsData.map(u => u.id));

            if (leasesError) throw leasesError;

            // 4. Merge Data
            // Map each unit to its active lease (if any)
            const today = new Date().toISOString().split('T')[0];

            const mergedUnits = unitsData.map(unit => {
                // Find active lease
                const activeLease = leasesData.find(l =>
                    l.unit_id === unit.id &&
                    l.status === 'active' &&
                    l.start_date <= today &&
                    (!l.end_date || l.end_date >= today)
                );

                // Find ended leases for this unit
                const endedLeases = leasesData.filter(l =>
                    l.unit_id === unit.id &&
                    (l.status !== 'active' || (l.end_date && l.end_date < today))
                );

                return {
                    ...unit,
                    activeLease: activeLease || null,
                    endedLeases,
                    status: activeLease ? 'rented' : 'vacant'
                };
            });

            // 5. Apply Local Filter (Property Filter from UI)
            let finalUnits = mergedUnits;
            if (filterPropertyId) {
                finalUnits = finalUnits.filter(u => u.property_id === filterPropertyId);
            }

            setUnits(finalUnits);

            // 6. Calc KPIs
            setStats({
                total: finalUnits.length,
                rented: finalUnits.filter(u => u.status === 'rented').length,
                vacant: finalUnits.filter(u => u.status === 'vacant').length
            });

        } catch (error) {
            console.error('Error fetching tenant data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Fetch Units for Dropdown (Create Modal)
    useEffect(() => {
        const fetchUnitsDropdown = async () => {
            if (!leaseForm.property_id) {
                setUnitsDropdown([]);
                return;
            }
            const { data } = await supabase.from('units').select('id, unit_name, target_rent').eq('property_id', leaseForm.property_id).order('unit_name');
            setUnitsDropdown(data || []);
        };
        fetchUnitsDropdown();
    }, [leaseForm.property_id]);


    useEffect(() => {
        if (user) {
            fetchData();
        }
    }, [user, selectedPortfolioID, filterPropertyId]); // Refetch/Recalc when filter changes

    // Handlers
    const handleCreateTenant = async () => {
        try {
            setIsSaving(true);
            const { data, error } = await supabase.from('tenants').insert([
                {
                    user_id: user.id,
                    first_name: tenantForm.first_name,
                    last_name: tenantForm.last_name,
                    email: tenantForm.email,
                    phone: tenantForm.phone,
                    occupants: parseInt(tenantForm.occupants) || 1
                }
            ]).select();

            if (error) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));

            if (data && data.length > 0) {
                setCreatedTenantId(data[0].id);
                setCurrentStep(2);
            }
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateLease = async () => {
        try {
            if (!createdTenantId) return alert('Kein Mieter erstellt.');
            setIsSaving(true);

            const coldRent = parseFloat(leaseForm.cold_rent) || 0;
            const serviceCharge = parseFloat(leaseForm.service_charge) || 0;
            const heatingCost = parseFloat(leaseForm.heating_cost) || 0;
            const otherCosts = parseFloat(leaseForm.other_costs) || 0;
            const deposit = parseFloat(leaseForm.deposit) || 0;

            // 1. Create Lease
            const { error: leaseError } = await supabase.from('leases').insert([
                {
                    user_id: user.id,
                    tenant_id: createdTenantId,
                    unit_id: leaseForm.unit_id,
                    start_date: leaseForm.start_date,
                    end_date: leaseForm.end_date || null,
                    cold_rent: coldRent,
                    service_charge: serviceCharge,
                    heating_cost: heatingCost,
                    other_costs: otherCosts,
                    deposit: deposit,
                    payment_due_day: parseInt(leaseForm.payment_due_day) || 3,
                    status: 'active'
                }
            ]);

            if (leaseError) throw leaseError;

            // 2. Sync unit fields with lease values (same Supabase cells)
            const { error: unitUpdateError } = await supabase.from('units').update({
                cold_rent_ist: coldRent,
                service_charge_soll: serviceCharge,
                heating_cost_soll: heatingCost,
                other_costs_soll: otherCosts,
                deposit_soll: deposit
            }).eq('id', leaseForm.unit_id);

            if (unitUpdateError) console.error('Fehler beim Aktualisieren der Einheit:', unitUpdateError);

            // 3. Create Contact automatically
            const property = propertiesDropdown.find(p => p.id === leaseForm.property_id);
            const unit = unitsDropdown.find(u => u.id === leaseForm.unit_id);

            if (property) {
                const { error: contactError } = await supabase.from('contacts').insert([
                    {
                        user_id: user.id,
                        name: `${tenantForm.first_name} ${tenantForm.last_name}`,
                        contact_type: 'tenant',
                        email: tenantForm.email,
                        phone: tenantForm.phone,
                        street: `${property.street} ${property.house_number}`,
                        zip: property.zip,
                        city: property.city,
                        unit_name: unit ? unit.unit_name : ''
                    }
                ]);
                if (contactError) console.error('Fehler beim Erstellen des Kontakts:', contactError);
            }

            await new Promise(resolve => setTimeout(resolve, 800));

            setIsCreateModalOpen(false);
            resetForms();
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const resetForms = () => {
        setTenantForm({ first_name: '', last_name: '', email: '', phone: '', occupants: 1 });
        setLeaseForm({ property_id: '', unit_id: '', start_date: '', end_date: '', cold_rent: '', service_charge: '', heating_cost: '', other_costs: '', deposit: '', payment_due_day: 3 });
        setCurrentStep(1);
        setCreatedTenantId(null);
    };

    // Update / Delete Handlers (Logic reused)
    const handleUpdateLease = async () => {
        try {
            setIsSaving(true);

            const coldRent = parseFloat(editLeaseForm.cold_rent) || 0;
            const serviceCharge = parseFloat(editLeaseForm.service_charge) || 0;
            const heatingCost = parseFloat(editLeaseForm.heating_cost) || 0;
            const otherCosts = parseFloat(editLeaseForm.other_costs) || 0;
            const deposit = parseFloat(editLeaseForm.deposit) || 0;

            // Update Tenant
            if (editTenantForm.id) {
                const { error: tenantError } = await supabase.from('tenants').update({
                    first_name: editTenantForm.first_name,
                    last_name: editTenantForm.last_name,
                    email: editTenantForm.email,
                    phone: editTenantForm.phone,
                    occupants: parseInt(editTenantForm.occupants) || 1
                }).eq('id', editTenantForm.id);
                if (tenantError) throw tenantError;
            }

            // Update Lease
            const { error: leaseError } = await supabase.from('leases').update({
                start_date: editLeaseForm.start_date,
                end_date: editLeaseForm.end_date || null,
                cold_rent: coldRent,
                service_charge: serviceCharge,
                heating_cost: heatingCost,
                other_costs: otherCosts,
                deposit: deposit,
                payment_due_day: parseInt(editLeaseForm.payment_due_day) || 3,
                last_rent_increase: editLeaseForm.last_rent_increase || null
            }).eq('id', editLeaseForm.id);

            if (leaseError) throw leaseError;

            // Sync unit fields with updated lease values
            if (selectedLease?.unit_id) {
                const { error: unitUpdateError } = await supabase.from('units').update({
                    cold_rent_ist: coldRent,
                    service_charge_soll: serviceCharge,
                    heating_cost_soll: heatingCost,
                    other_costs_soll: otherCosts,
                    deposit_soll: deposit
                }).eq('id', selectedLease.unit_id);

                if (unitUpdateError) console.error('Fehler beim Aktualisieren der Einheit:', unitUpdateError);
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            setIsDetailModalOpen(false);
            fetchData();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteLease = async (leaseToDelete = selectedLease) => {
        if (!leaseToDelete) return;
        if (!confirm('Möchten Sie dieses Mietverhältnis wirklich löschen?')) return;
        try {
            const { error } = await supabase.from('leases').delete().eq('id', leaseToDelete.id);
            if (error) throw error;
            setIsDetailModalOpen(false);
            fetchData();
        } catch (error) {
            alert(translateError(error));
        }
    };


    // Columns
    const columns = [
        {
            header: 'Objekt',
            accessor: 'property',
            render: (row) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{row.property?.street} {row.property?.house_number}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.property?.city}</div>
                </div>
            )
        },
        {
            header: 'Einheit',
            accessor: 'unit_name',
            render: (row) => <span style={{ fontWeight: 600 }}>{row.unit_name}</span>
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => row.status === 'rented' ? (
                <span style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    color: 'var(--success-color)',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <Key size={12} /> Vermietet
                </span>
            ) : row.status === 'ended' ? (
                <span style={{
                    backgroundColor: 'rgba(107, 114, 128, 0.1)',
                    color: '#6b7280',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <AlertCircle size={12} /> Beendet
                </span>
            ) : (
                <span style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--danger-color)',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <AlertCircle size={12} /> Leerstand
                </span>
            )
        },
        {
            header: 'Mieter',
            accessor: 'tenant',
            render: (row) => row.activeLease ? (
                <div>
                    <div>{row.activeLease.tenant?.last_name}, {row.activeLease.tenant?.first_name}</div>
                </div>
            ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>
        },
        {
            header: 'Laufzeit',
            accessor: 'duration',
            render: (row) => row.activeLease ? (
                <div style={{ fontSize: '0.85rem' }}>
                    {new Date(row.activeLease.start_date).toLocaleDateString()} — {row.activeLease.end_date ? new Date(row.activeLease.end_date).toLocaleDateString() : 'Unbefristet'}
                </div>
            ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>
        },
        {
            header: '',
            accessor: 'actions',
            align: 'right',
            render: (row) => row.activeLease ? (
                <div style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => {
                        e.stopPropagation();
                        if (openActionMenuId === row.activeLease.id) {
                            setOpenActionMenuId(null);
                        } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.top, left: rect.right });
                            setOpenActionMenuId(row.activeLease.id);
                        }
                    }}>Aktionen</Button>

                    {openActionMenuId === row.activeLease.id && (
                        <div style={{
                            position: 'fixed',
                            top: menuPos.top,
                            left: menuPos.left,
                            transform: 'translate(-100%, -100%)',
                            backgroundColor: 'var(--surface-color)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                            zIndex: 9999,
                            minWidth: '180px',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '4px'
                        }}>
                            <button
                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                onClick={() => {
                                    setOpenActionMenuId(null);
                                    const l = row.activeLease;
                                    setSelectedLease({ ...l, unit: row });
                                    setEditTenantForm({
                                        id: l.tenant.id,
                                        first_name: l.tenant.first_name,
                                        last_name: l.tenant.last_name,
                                        email: l.tenant.email,
                                        phone: l.tenant.phone,
                                        occupants: l.tenant.occupants
                                    });
                                    setEditLeaseForm({
                                        id: l.id,
                                        start_date: l.start_date,
                                        end_date: l.end_date,
                                        cold_rent: l.cold_rent,
                                        service_charge: l.service_charge,
                                        heating_cost: l.heating_cost,
                                        other_costs: l.other_costs,
                                        deposit: l.deposit,
                                        payment_due_day: l.payment_due_day,
                                        last_rent_increase: l.last_rent_increase
                                    });
                                    setIsEditingDetails(false);
                                    setIsDetailModalOpen(true);
                                }}
                            >
                                <Eye size={14} /> Details
                            </button>
                            <button
                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                onClick={() => {
                                    setOpenActionMenuId(null);
                                    const l = row.activeLease;
                                    setSelectedLease({ ...l, unit: row });
                                    setEditTenantForm({
                                        id: l.tenant.id,
                                        first_name: l.tenant.first_name,
                                        last_name: l.tenant.last_name,
                                        email: l.tenant.email,
                                        phone: l.tenant.phone,
                                        occupants: l.tenant.occupants
                                    });
                                    setEditLeaseForm({
                                        id: l.id,
                                        start_date: l.start_date,
                                        end_date: l.end_date,
                                        cold_rent: l.cold_rent,
                                        service_charge: l.service_charge,
                                        heating_cost: l.heating_cost,
                                        other_costs: l.other_costs,
                                        deposit: l.deposit,
                                        payment_due_day: l.payment_due_day,
                                        last_rent_increase: l.last_rent_increase
                                    });
                                    setIsEditingDetails(true);
                                    setIsDetailModalOpen(true);
                                }}
                            >
                                <Edit size={14} /> Bearbeiten
                            </button>
                            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                            <button
                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                onClick={() => {
                                    setOpenActionMenuId(null);
                                    handleDeleteLease(row.activeLease);
                                }}
                            >
                                <Trash2 size={14} /> Löschen
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <Button variant="secondary" size="sm" icon={Plus} onClick={() => {
                    resetForms();
                    setLeaseForm(prev => ({
                        ...prev,
                        property_id: row.property_id,
                        unit_id: row.id
                    }));
                    setIsCreateModalOpen(true);
                }}>Vermieten</Button>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    // Calculate displayed units (handling ended leases toggle)
    let displayedUnits = [...units];
    if (showEndedLeases) {
        units.forEach(u => {
            (u.endedLeases || []).forEach(el => {
                displayedUnits.push({
                    ...u,
                    id: u.id + '-' + el.id,
                    activeLease: el,
                    status: 'ended'
                });
            });
        });
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Mietverhältnisse</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht der Einheiten und Auslastung</p>
                </div>
                <Button icon={Plus} onClick={() => { resetForms(); setIsCreateModalOpen(true); }}>Neuer Mieter</Button>
            </div>

            {/* Filter Bar */}
            <Card style={{ marginBottom: 'var(--spacing-lg)', padding: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                    </div>
                    <div>
                        <select
                            value={filterPropertyId}
                            onChange={e => setFilterPropertyId(e.target.value)}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '200px' }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                        </select>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={showEndedLeases}
                            onChange={e => setShowEndedLeases(e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: 'var(--primary-color)', cursor: 'pointer' }}
                        />
                        Beendete Mietverhältnisse anzeigen
                    </label>
                </div>
            </Card>

            {/* KPIs */}
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Gesamt (Einheiten)</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {stats.total}
                            </div>
                        </div>
                        <Home size={28} style={{ color: 'var(--primary-color)', opacity: 0.2 }} />
                    </div>
                </Card>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Vermietet</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--success-color)' }}>
                                {stats.rented}
                            </div>
                        </div>
                        <Key size={28} style={{ color: 'var(--success-color)', opacity: 0.2 }} />
                    </div>
                </Card>
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Leerstand</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--danger-color)' }}>
                                {stats.vacant}
                            </div>
                        </div>
                        <AlertCircle size={28} style={{ color: 'var(--danger-color)', opacity: 0.2 }} />
                    </div>
                </Card>
            </div>

            <Card>
                {units.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Einheiten gefunden.
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile">
                            <Table columns={columns} data={displayedUnits} />
                        </div>

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {displayedUnits.map((row) => (
                                <div key={row.id} style={{
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-md)',
                                    backgroundColor: 'var(--surface-color)',
                                    position: 'relative'
                                }}>
                                    {/* Header: Status and Property */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{row.property?.street} {row.property?.house_number}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                {row.property?.city} • {row.unit_name}
                                            </div>
                                        </div>
                                        <div>
                                            {row.status === 'rented' ? (
                                                <span style={{
                                                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                                    color: 'var(--success-color)',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 600,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    <Key size={10} /> Vermietet
                                                </span>
                                            ) : row.status === 'ended' ? (
                                                <span style={{
                                                    backgroundColor: 'rgba(107, 114, 128, 0.1)',
                                                    color: '#6b7280',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 600,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    <AlertCircle size={10} /> Beendet
                                                </span>
                                            ) : (
                                                <span style={{
                                                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                    color: 'var(--danger-color)',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 600,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    <AlertCircle size={10} /> Leerstand
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Tenant Info */}
                                    <div style={{ marginBottom: '12px', fontSize: '0.9rem' }}>
                                        {row.activeLease ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Users size={16} className="text-secondary" />
                                                <span style={{ fontWeight: 500 }}>
                                                    {row.activeLease.tenant?.first_name} {row.activeLease.tenant?.last_name}
                                                </span>
                                            </div>
                                        ) : (
                                            <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.85rem' }}>Kein Mieter zugeordnet</div>
                                        )}
                                    </div>

                                    {/* Lease Dates */}
                                    {row.activeLease && (
                                        <div style={{
                                            fontSize: '0.8rem',
                                            color: 'var(--text-secondary)',
                                            paddingTop: '8px',
                                            borderTop: '1px solid var(--border-color)',
                                            marginBottom: '12px'
                                        }}>
                                            Laufzeit: {new Date(row.activeLease.start_date).toLocaleDateString()} — {row.activeLease.end_date ? new Date(row.activeLease.end_date).toLocaleDateString() : 'Unbefristet'}
                                        </div>
                                    )}

                                    {/* Action Button */}
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
                                        {row.activeLease ? (
                                            <Button variant="secondary" size="sm" onClick={() => {
                                                const l = row.activeLease;
                                                setSelectedLease({ ...l, unit: row });
                                                setEditTenantForm({
                                                    id: l.tenant.id,
                                                    first_name: l.tenant.first_name,
                                                    last_name: l.tenant.last_name,
                                                    email: l.tenant.email,
                                                    phone: l.tenant.phone,
                                                    occupants: l.tenant.occupants
                                                });
                                                setEditLeaseForm({
                                                    id: l.id,
                                                    start_date: l.start_date,
                                                    end_date: l.end_date,
                                                    cold_rent: l.cold_rent,
                                                    service_charge: l.service_charge,
                                                    heating_cost: l.heating_cost,
                                                    other_costs: l.other_costs,
                                                    deposit: l.deposit,
                                                    payment_due_day: l.payment_due_day,
                                                    last_rent_increase: l.last_rent_increase
                                                });
                                                setIsEditingDetails(false);
                                                setIsDetailModalOpen(true);
                                            }}>
                                                <Eye size={14} style={{ marginRight: '4px' }} /> Details
                                            </Button>
                                        ) : (
                                            <Button size="sm" icon={Plus} onClick={() => {
                                                resetForms();
                                                setLeaseForm(prev => ({
                                                    ...prev,
                                                    property_id: row.property_id,
                                                    unit_id: row.id
                                                }));
                                                setIsCreateModalOpen(true);
                                            }}>Vermieten</Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Card>

            {/* Create Wizard Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title={currentStep === 1 ? "Schritt 1: Mieter erfassen" : "Schritt 2: Mietvertrag anlegen"}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Abbrechen</Button>
                        {currentStep === 1 ? (
                            <Button onClick={handleCreateTenant}>Weiter zu Mietvertrag</Button>
                        ) : (
                            <Button onClick={handleCreateLease}>Speichern</Button>
                        )}
                    </>
                }
            >
                {isSaving && <LoadingOverlay message="Speichere Daten..." />}
                {currentStep === 1 && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Vorname" value={tenantForm.first_name} onChange={e => setTenantForm({ ...tenantForm, first_name: e.target.value })} />
                            <Input label="Nachname" value={tenantForm.last_name} onChange={e => setTenantForm({ ...tenantForm, last_name: e.target.value })} />
                        </div>
                        <Input label="E-Mail" type="email" value={tenantForm.email} onChange={e => setTenantForm({ ...tenantForm, email: e.target.value })} />
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Telefon" value={tenantForm.phone} onChange={e => setTenantForm({ ...tenantForm, phone: e.target.value })} />
                            <Input label="Personen" type="number" value={tenantForm.occupants} onChange={e => setTenantForm({ ...tenantForm, occupants: e.target.value })} />
                        </div>
                    </div>
                )}

                {currentStep === 2 && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={leaseForm.property_id}
                                    onChange={e => setLeaseForm({ ...leaseForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {propertiesDropdown.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={leaseForm.unit_id}
                                    onChange={e => setLeaseForm({ ...leaseForm, unit_id: e.target.value })}
                                    disabled={!leaseForm.property_id}
                                >
                                    <option value="">Wählen...</option>
                                    {unitsDropdown.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Mietbeginn" type="date" value={leaseForm.start_date} onChange={e => setLeaseForm({ ...leaseForm, start_date: e.target.value })} />
                            <Input label="Mietende (optional)" type="date" value={leaseForm.end_date} onChange={e => setLeaseForm({ ...leaseForm, end_date: e.target.value })} />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Kaltmiete Soll (Einheit)" value={unitsDropdown.find(u => u.id === leaseForm.unit_id)?.target_rent || ''} readOnly />
                            <CurrencyInput label="Kaltmiete (Vertrag) (€)" allowDecimals value={leaseForm.cold_rent} onChange={e => setLeaseForm({ ...leaseForm, cold_rent: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Nebenkosten (€)" allowDecimals value={leaseForm.service_charge} onChange={e => setLeaseForm({ ...leaseForm, service_charge: e.target.value })} />
                            <CurrencyInput label="Heizkosten (€)" allowDecimals value={leaseForm.heating_cost} onChange={e => setLeaseForm({ ...leaseForm, heating_cost: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Sonstige Kosten (€)" allowDecimals value={leaseForm.other_costs} onChange={e => setLeaseForm({ ...leaseForm, other_costs: e.target.value })} />
                            <CurrencyInput label="Kaution (€)" allowDecimals value={leaseForm.deposit} onChange={e => setLeaseForm({ ...leaseForm, deposit: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input
                                label="Zahltag (1-31)"
                                type="number"
                                min="1"
                                max="31"
                                value={leaseForm.payment_due_day}
                                onChange={e => {
                                    let val = parseInt(e.target.value);
                                    if (isNaN(val)) val = '';
                                    else if (val > 31) val = 31;
                                    else if (val < 1) val = 1;
                                    setLeaseForm({ ...leaseForm, payment_due_day: val });
                                }}
                            />
                            <div></div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Detail Modal */}
            <Modal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                title={isEditingDetails ? "Mietverhältnis bearbeiten" : "Mietverhältnis Details"}
                footer={
                    isEditingDetails ? (
                        <>
                            <Button variant="secondary" onClick={() => setIsEditingDetails(false)}>Abbrechen</Button>
                            <Button onClick={handleUpdateLease}>Speichern</Button>
                        </>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <Button variant="danger" onClick={handleDeleteLease} icon={Trash2}>Löschen</Button>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <Button variant="secondary" onClick={() => setIsDetailModalOpen(false)}>Schließen</Button>
                                <Button onClick={() => setIsEditingDetails(true)}>Bearbeiten</Button>
                            </div>
                        </div>
                    )
                }
            >
                {isSaving && <LoadingOverlay message="Speichere Änderungen..." />}
                {selectedLease && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '10px', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontWeight: 600 }}>{editTenantForm.first_name} {editTenantForm.last_name}</div>
                            <div style={{ fontSize: '0.875rem' }}>{selectedLease.unit?.property?.street} {selectedLease.unit?.property?.house_number} / {selectedLease.unit?.unit_name}</div>
                        </div>

                        {!isEditingDetails ? (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', fontSize: '0.9rem' }}>
                                    <div>
                                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Kontakt</label>
                                        <div>{editTenantForm.email || '—'}</div>
                                        <div>{editTenantForm.phone || '—'}</div>
                                    </div>
                                    <div>
                                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Personen</label>
                                        <div>{editTenantForm.occupants}</div>
                                    </div>
                                </div>
                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Vertragsdaten</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', fontSize: '0.9rem' }}>
                                        <div>
                                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Laufzeit</label>
                                            <div>{new Date(editLeaseForm.start_date).toLocaleDateString()} — {editLeaseForm.end_date ? new Date(editLeaseForm.end_date).toLocaleDateString() : 'Unbefristet'}</div>
                                        </div>
                                        <div>
                                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Letzte Mieterhöhung</label>
                                            <div>{editLeaseForm.last_rent_increase ? new Date(editLeaseForm.last_rent_increase).toLocaleDateString() : '—'}</div>
                                        </div>
                                    </div>
                                </div>
                                {/* Financial details similar to before */}
                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Zahlungen</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)', fontSize: '0.9rem' }}>
                                        <div><label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Kaltmiete Soll (Einheit)</label><div>{selectedLease.unit?.target_rent ? parseFloat(selectedLease.unit.target_rent).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '—'}</div></div>
                                        <div><label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Kaltmiete (Vertrag)</label><div>{parseFloat(editLeaseForm.cold_rent).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div></div>
                                        <div><label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Nebenkosten</label><div>{parseFloat(editLeaseForm.service_charge).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div></div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            // Edit Mode (same as before)
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '10px' }}>
                                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Mieterdaten</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Vorname" value={editTenantForm.first_name} onChange={e => setEditTenantForm({ ...editTenantForm, first_name: e.target.value })} />
                                        <Input label="Nachname" value={editTenantForm.last_name} onChange={e => setEditTenantForm({ ...editTenantForm, last_name: e.target.value })} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                        <Input label="E-Mail" type="email" value={editTenantForm.email} onChange={e => setEditTenantForm({ ...editTenantForm, email: e.target.value })} />
                                        <Input label="Telefon" value={editTenantForm.phone} onChange={e => setEditTenantForm({ ...editTenantForm, phone: e.target.value })} />
                                    </div>
                                    <div style={{ marginTop: 'var(--spacing-md)' }}>
                                        <Input label="Personen" type="number" value={editTenantForm.occupants} onChange={e => setEditTenantForm({ ...editTenantForm, occupants: e.target.value })} />
                                    </div>
                                </div>

                                <div>
                                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Vertragsdaten</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                        <Input label="Mietbeginn" type="date" value={editLeaseForm.start_date} onChange={e => setEditLeaseForm({ ...editLeaseForm, start_date: e.target.value })} />
                                        <Input label="Mietende" type="date" value={editLeaseForm.end_date || ''} onChange={e => setEditLeaseForm({ ...editLeaseForm, end_date: e.target.value })} />
                                    </div>
                                    <div style={{ marginTop: 'var(--spacing-md)' }}>
                                        <Input label="Letzte Mieterhöhung" type="date" value={editLeaseForm.last_rent_increase || ''} onChange={e => setEditLeaseForm({ ...editLeaseForm, last_rent_increase: e.target.value })} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                        <CurrencyInput label="Kaltmiete (€)" allowDecimals value={editLeaseForm.cold_rent} onChange={e => setEditLeaseForm({ ...editLeaseForm, cold_rent: e.target.value })} />
                                        <CurrencyInput label="Nebenkosten (€)" allowDecimals value={editLeaseForm.service_charge} onChange={e => setEditLeaseForm({ ...editLeaseForm, service_charge: e.target.value })} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                        <CurrencyInput label="Heizkosten (€)" allowDecimals value={editLeaseForm.heating_cost} onChange={e => setEditLeaseForm({ ...editLeaseForm, heating_cost: e.target.value })} />
                                        <CurrencyInput label="Sonstige Kosten (€)" allowDecimals value={editLeaseForm.other_costs} onChange={e => setEditLeaseForm({ ...editLeaseForm, other_costs: e.target.value })} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                                        <CurrencyInput label="Kaution (€)" allowDecimals value={editLeaseForm.deposit} onChange={e => setEditLeaseForm({ ...editLeaseForm, deposit: e.target.value })} />
                                        <Input
                                            label="Zahltag"
                                            type="number"
                                            min="1"
                                            max="31"
                                            value={editLeaseForm.payment_due_day}
                                            onChange={e => {
                                                let val = parseInt(e.target.value);
                                                if (isNaN(val)) val = '';
                                                else if (val > 31) val = 31;
                                                else if (val < 1) val = 1;
                                                setEditLeaseForm({ ...editLeaseForm, payment_due_day: val });
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* Note: I truncated the Edit Form in the detail modal for brevity in this plan, but in the actual write I will include the full form from the previous step */}
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default Tenants;
