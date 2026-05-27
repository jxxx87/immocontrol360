import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Building2, ChevronDown, ChevronRight, MoreVertical, Edit, Edit3, Trash2, AlertCircle, Home, Key, LayoutGrid, Check, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';
import { useSubscription } from '../context/SubscriptionContext';
import ExportDropdown from '../components/ExportDropdown';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const Properties = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const { checkUsageLimit, checkGlobalAccess } = useSubscription();
    const { isMobile } = useViewMode();
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [returnTo, setReturnTo] = useState(null); // Track where to redirect after save
    const [searchTerm, setSearchTerm] = useState('');

    // Property Modal State
    const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
    const [propertyForm, setPropertyForm] = useState({
        portfolio_id: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        construction_year: '',
        property_type: 'residential', // residential, commercial, mixed
        economic_unit_members: [], // Array of property IDs
        _original_economic_unit_id: null
    });

    // Units and Group Logic
    const [expandedPropertyId, setExpandedPropertyId] = useState(null);
    const [expandedWEId, setExpandedWEId] = useState(null); // For Economic Units
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
                        unit_name,
                        floor,
                        sqm,
                        rooms,
                        target_rent,
                        cold_rent_ist,
                        is_vacation_rental,
                        balcony,
                        fitted_kitchen,
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

            // Fetch Loans
            let loanQuery = supabase.from('loans').select('*');
            if (selectedPortfolioID) {
                loanQuery = loanQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const { data: loanData, error: loanError } = await loanQuery;
            if (loanError) throw loanError;

            // Loan Helper functions
            const calculateCurrentDebt = (loan) => {
                const originalAmount = parseFloat(loan.loan_amount || 0);
                const interestRate = parseFloat(loan.interest_rate || 0) / 100;
                let monthlyPayment = parseFloat(loan.fixed_annuity || 0);

                if (!monthlyPayment) {
                    const repaymentRate = parseFloat(loan.initial_repayment_rate || 0) / 100;
                    monthlyPayment = (originalAmount * (interestRate + repaymentRate)) / 12;
                }

                const hasActual = loan.actual_residual_debt !== null && loan.actual_residual_debt !== undefined;
                const amount = hasActual ? parseFloat(loan.actual_residual_debt) : originalAmount;
                const startDateStr = hasActual && loan.actual_residual_debt_date ? loan.actual_residual_debt_date : loan.start_date;

                if (!startDateStr) return amount;
                
                const startDate = new Date(startDateStr);
                let endDateTarget = loan.end_date ? new Date(loan.end_date) : null;

                if (!endDateTarget || isNaN(endDateTarget.getTime())) {
                    endDateTarget = new Date(startDate);
                    endDateTarget.setFullYear(endDateTarget.getFullYear() + 50);
                }

                const validUntil = new Date(); // TODAY

                let currentBalance = amount;
                let currentDate = new Date(startDate);

                let months = 0;
                while (currentBalance > 0.01 && months < 600) {
                    if (currentDate > validUntil) break;
                    const monthlyInterest = currentBalance * interestRate / 12;
                    const principal = monthlyPayment - monthlyInterest;
                    const endBalance = currentBalance - principal;

                    currentBalance = endBalance < 0 ? 0 : endBalance;
                    currentDate.setMonth(currentDate.getMonth() + 1);
                    months++;
                }

                return currentBalance;
            };

            const calculateMonthlyPayment = (loan) => {
                if (loan.fixed_annuity) return parseFloat(loan.fixed_annuity);
                const originalAmount = parseFloat(loan.loan_amount || 0);
                const interestRate = parseFloat(loan.interest_rate || 0) / 100;
                const repaymentRate = parseFloat(loan.initial_repayment_rate || 0) / 100;
                return (originalAmount * (interestRate + repaymentRate)) / 12;
            };

            // Calculate Aggregations
            const propertiesWithStats = data.map(p => {
                const units = p.units || [];
                const totalUnits = units.length;
                const totalArea = units.reduce((sum, u) => sum + (u.sqm || 0), 0);
                const totalTargetRent = units.reduce((sum, u) => sum + (u.target_rent || 0), 0);

                // Calculate Actual Rent (Sum of active leases' cold_rent)
                const totalActualRent = units.reduce((sum, u) => {
                    if (u.is_vacation_rental) return sum + (parseFloat(u.cold_rent_ist) || parseFloat(u.target_rent) || 0);
                    const activeLease = u.leases?.find(l => l.status === 'active');
                    return sum + (activeLease ? (parseFloat(activeLease.cold_rent) || 0) : 0);
                }, 0);

                // Calculate Loan Stats
                const propLoans = (loanData || []).filter(l => l.property_id === p.id);
                const remainingDebt = propLoans.reduce((sum, l) => sum + calculateCurrentDebt(l), 0);
                const monthlyLoanPayment = propLoans.reduce((sum, l) => sum + calculateMonthlyPayment(l), 0);

                return {
                    ...p,
                    remaining_debt: remainingDebt,
                    monthly_loan_payment: monthlyLoanPayment,
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
                .select('*, leases(status, start_date, end_date, cold_rent)')
                .eq('property_id', propertyId)
                .order('unit_name');

            if (error) throw error;

            const today = new Date().toISOString().split('T')[0];
            const processedUnits = (data || []).map(u => {
                if (u.is_vacation_rental) {
                    return { ...u, status: 'vacation_rental' };
                }
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
            
            let finalEconomicUnitId = propertyForm._original_economic_unit_id;

            if (propertyForm.economic_unit_members && propertyForm.economic_unit_members.length > 0) {
                if (!finalEconomicUnitId) {
                    finalEconomicUnitId = crypto.randomUUID();
                }
            } else {
                // No members selected, current property leaves the unit
                finalEconomicUnitId = null;
            }

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
                equity_invested: parseFloat(propertyForm.equity_invested) || 0,
                economic_unit_id: finalEconomicUnitId
            };

            let error;
            if (editingPropertyId) {
                const { error: updateError } = await supabase.from('properties').update(propData).eq('id', editingPropertyId);
                error = updateError;
            } else {
                // Insert first to get the ID, but since we are inserting, we can just insert with the unit ID
                const { error: insertError } = await supabase.from('properties').insert([propData]);
                error = insertError;
            }

            if (error) throw error;
            
            // Now handle updating other members
            if (finalEconomicUnitId) {
                // Add newly checked members
                const newMembers = propertyForm.economic_unit_members.filter(id => {
                    const p = properties.find(prop => prop.id === id);
                    return p && p.economic_unit_id !== finalEconomicUnitId;
                });
                
                if (newMembers.length > 0) {
                    await supabase.from('properties')
                        .update({ economic_unit_id: finalEconomicUnitId })
                        .in('id', newMembers);
                }
                
                // Remove unchecked members that were previously in THIS unit
                if (propertyForm._original_economic_unit_id) {
                    const removedMembers = properties
                        .filter(p => p.economic_unit_id === propertyForm._original_economic_unit_id && p.id !== editingPropertyId)
                        .filter(p => !propertyForm.economic_unit_members.includes(p.id))
                        .map(p => p.id);
                        
                    if (removedMembers.length > 0) {
                        await supabase.from('properties')
                            .update({ economic_unit_id: null })
                            .in('id', removedMembers);
                    }
                }
            }

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

            // Limit Check for NEW units
            if (!editingUnitId) {
                const { count, error } = await supabase
                    .from('units')
                    .select('*', { count: 'exact', head: true }) // Fast count
                    .eq('user_id', user.id);

                if (error) throw error;

                // checkUsageLimit handles the Paywall trigger internally
                if (!checkUsageLimit(count)) {
                    setIsSaving(false);
                    return; // Stop here
                }
            }

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
            equity_invested: property.equity_invested || '',
            economic_unit_members: property.economic_unit_id 
                ? properties.filter(p => p.economic_unit_id === property.economic_unit_id && p.id !== property.id).map(p => p.id) 
                : [],
            _original_economic_unit_id: property.economic_unit_id
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

    // Filter properties by selected property
    const filteredProperties = properties.filter(p => {
        if (!searchTerm) return true;
        return p.id === searchTerm;
    });

    // Group Properties by Economic Unit
    const groupedProperties = React.useMemo(() => {
        const groups = {};
        const result = [];

        filteredProperties.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = {
                        id: 'we_' + p.economic_unit_id,
                        isGroup: true,
                        economic_unit_id: p.economic_unit_id,
                        street: 'Wirtschaftseinheit',
                        house_number: '',
                        property_type: 'mixed',
                        properties: [],
                        stats: { totalUnits: 0, totalArea: 0, totalTargetRent: 0, totalActualRent: 0 },
                        total_investment_cost: 0,
                        equity_invested: 0,
                        market_value_total: 0,
                        remaining_debt: 0,
                        monthly_loan_payment: 0
                    };
                }
                const group = groups[p.economic_unit_id];
                group.properties.push(p);
                group.stats.totalUnits += (p.stats?.totalUnits || 0);
                group.stats.totalArea += (p.stats?.totalArea || 0);
                group.stats.totalTargetRent += (p.stats?.totalTargetRent || 0);
                group.stats.totalActualRent += (p.stats?.totalActualRent || 0);
                group.total_investment_cost += (p.total_investment_cost || 0);
                group.equity_invested += (p.equity_invested || 0);
                group.market_value_total += (p.market_value_total || 0);
                group.remaining_debt += (p.remaining_debt || 0);
                group.monthly_loan_payment += (p.monthly_loan_payment || 0);
            } else {
                result.push(p);
            }
        });

        // Resolve Groups: If a group only has 1 property, flatten it. Otherwise, generate name and add to result.
        Object.values(groups).forEach(g => {
            if (g.properties.length === 1) {
                result.push(g.properties[0]);
            } else if (g.properties.length > 1) {
                const streets = Array.from(new Set(g.properties.map(pr => pr.street).filter(Boolean)));
                const streetName = streets.length > 0 ? streets.join(', ') : 'Diverse';
                const numbers = g.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                g.street = `Wirtschaftseinheit: ${streetName}`;
                g.house_number = numbers;
                result.push(g);
            }
        });

        // Sort by street name
        return result.sort((a, b) => (a.street || '').localeCompare(b.street || ''));
    }, [filteredProperties]);

    const propertyColumns = [
        {
            header: '',
            accessor: 'expand',
            width: '40px',
            render: (row) => (
                <button
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        if (row.isGroup) {
                            setExpandedWEId(expandedWEId === row.id ? null : row.id);
                        } else {
                            toggleExpand(row.id); 
                        }
                    }}
                    style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
                >
                    {(row.isGroup ? expandedWEId === row.id : expandedPropertyId === row.id) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
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
                        backgroundColor: row.isGroup ? 'rgba(139, 92, 246, 0.1)' : 'var(--surface-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 'var(--spacing-md)',
                        color: row.isGroup ? 'var(--accent-color)' : 'var(--primary-color)'
                    }}>
                        <Building2 size={20} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: row.isGroup ? 'var(--accent-color)' : 'inherit' }}>{row.street} {row.house_number}</div>
                        {!row.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.zip} {row.city}</div>}
                        {row.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.properties.length} Gebäude verknüpft</div>}
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
            render: (row) => row.isGroup ? null : (
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

                    {openPropertyActionMenuId === row.id && createPortal(
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
                            }}
                                onClick={(e) => e.stopPropagation()}>
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
                        </>,
                        document.body
                    )}
                </div>
            )
        }
    ];

    return (
        <div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 'var(--spacing-xl)', gap: isMobile ? '10px' : '0' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Immobilien</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht Ihrer Wohn- und Gewerbeobjekte</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ExportDropdown
                        reportType="immobilien"
                        data={properties.map(p => ({
                            property_id: p.id,
                            adresse: `${p.street} ${p.house_number || ''}`.trim(),
                            einheiten: p.stats?.totalUnits || 0,
                            kaufpreis: p.total_investment_cost || 0,
                            marktpreis: p.market_value_total || 0,
                            restschuld: p.remaining_debt || 0,
                            miete_monat: p.stats?.totalActualRent || 0,
                            cashflow_monat: (p.stats?.totalActualRent || 0) - (p.monthly_loan_payment || 0),
                            wohnflaeche: p.stats?.totalArea || 0,
                            leerstand: p.stats?.totalUnits ? `${p.stats.totalUnits - (p.stats.occupiedUnits || p.stats.totalUnits)} / ${p.stats.totalUnits}` : '–',
                            ltv: p.market_value_total > 0 ? (p.remaining_debt || 0) / p.market_value_total : 0,
                            dscr: p.monthly_loan_payment > 0 ? (p.stats?.totalActualRent || 0) / p.monthly_loan_payment : 0,
                            _propertyLabel: `${p.street} ${p.house_number || ''}`.trim(),
                        }))}
                        unitData={Object.fromEntries(properties.map(p => [
                            p.id,
                            (p.units || []).map(u => ({
                                unit_name: u.unit_name || '–',
                                floor: u.floor || '–',
                                sqm: u.sqm || 0,
                                rooms: u.rooms || '–',
                                target_rent: u.target_rent || 0,
                                status: u.leases?.find(l => l.status === 'active') ? 'Vermietet' : 'Leerstand',
                            })),
                        ]))}
                        properties={properties.map(p => ({ id: p.id, label: `${p.street} ${p.house_number || ''}`.trim() }))}
                        totalRows={properties.length}
                    />
                    <Button icon={Plus} onClick={() => {
                        if (!checkGlobalAccess()) return;
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
            </div>

            {/* Filter Bar */}
            {properties.length > 0 && (
                <div style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                    </div>
                    <div>
                        <select
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '200px' }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            <Card>
                {filteredProperties.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {properties.length === 0 ? 'Keine Immobilien gefunden.' : 'Keine Immobilien gefunden für diesen Filter.'}
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile" style={{ overflowX: 'auto' }}>
                            {/* Custom Table Rendering to support expansion */}
                            <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {propertyColumns.map((col, idx) => (
                                            <th key={idx} style={{ textAlign: col.align || 'left', width: col.width }}>{col.header}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedProperties.map(propertyOrGroup => (
                                        <React.Fragment key={propertyOrGroup.id}>
                                            <tr
                                                className="table-row"
                                                onClick={() => {
                                                    if (propertyOrGroup.isGroup) {
                                                        setExpandedWEId(expandedWEId === propertyOrGroup.id ? null : propertyOrGroup.id);
                                                    } else {
                                                        toggleExpand(propertyOrGroup.id);
                                                    }
                                                }}
                                                style={{
                                                    borderBottom: (propertyOrGroup.isGroup ? expandedWEId === propertyOrGroup.id : expandedPropertyId === propertyOrGroup.id) ? 'none' : '1px solid var(--border-color)',
                                                    cursor: 'pointer',
                                                    backgroundColor: propertyOrGroup.isGroup ? 'rgba(139, 92, 246, 0.02)' : 'transparent'
                                                }}
                                            >
                                                {propertyColumns.map((col, idx) => (
                                                    <td key={idx} style={{ textAlign: col.align || 'left', fontWeight: propertyOrGroup.isGroup ? 600 : 'normal' }}>
                                                        {col.render ? col.render(propertyOrGroup) : propertyOrGroup[col.accessor]}
                                                    </td>
                                                ))}
                                            </tr>
                                            
                                            {/* If it's a Group and expanded, render sub-properties */}
                                            {propertyOrGroup.isGroup && expandedWEId === propertyOrGroup.id && (
                                                <>
                                                    {propertyOrGroup.properties.map(subProp => (
                                                        <React.Fragment key={subProp.id}>
                                                            <tr
                                                                className="table-row"
                                                                onClick={(e) => { e.stopPropagation(); toggleExpand(subProp.id); }}
                                                                style={{
                                                                    borderBottom: expandedPropertyId === subProp.id ? 'none' : '1px solid var(--border-color)',
                                                                    cursor: 'pointer',
                                                                    backgroundColor: 'rgba(0,0,0,0.01)'
                                                                }}
                                                            >
                                                                {propertyColumns.map((col, idx) => (
                                                                    <td key={idx} style={{ textAlign: col.align || 'left', paddingLeft: idx === 1 ? '40px' : undefined }}>
                                                                        {col.render ? col.render(subProp) : subProp[col.accessor]}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                            {/* Render Units for Sub-Property */}
                                                            {expandedPropertyId === subProp.id && (
                                                                <tr style={{ backgroundColor: 'var(--background-color)', borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td colSpan={propertyColumns.length} style={{ padding: 'var(--spacing-md) var(--spacing-xl) var(--spacing-md) 60px' }}>
                                                                        <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                            <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <Home size={16} /> Einheiten
                                                                            </h4>
                                                                            <Button size="sm" icon={Plus} onClick={() => {
                                                                                if (!checkGlobalAccess()) return;
                                                                                handleOpenUnitModal(subProp);
                                                                            }}>Neue Einheit</Button>
                                                                        </div>
                                                                        
                                                                        {loadingUnits[subProp.id] ? (
                                                                            <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Lade Einheiten...</div>
                                                                        ) : (
                                                                            !units[subProp.id] || units[subProp.id].length === 0 ? (
                                                                                <div style={{ padding: '10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einheiten angelegt.</div>
                                                                            ) : (
                                                                                // Table rendering code is the same, just mapped to subProp.id
                                                                                <table style={{ width: '100%', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                                                                    {/* Same header and body logic as below */}
                                                                                    <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                                                                        <tr>
                                                                                            <th style={{ padding: '8px' }}>Name</th>
                                                                                            <th style={{ padding: '8px' }}>Etage</th>
                                                                                            <th style={{ padding: '8px' }}>Fläche</th>
                                                                                            <th style={{ padding: '8px' }}>Zimmer</th>
                                                                                            <th style={{ padding: '8px' }}>Status</th>
                                                                                            <th style={{ padding: '8px' }}>Istmiete</th>
                                                                                            <th style={{ padding: '8px' }}></th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody>
                                                                                        {units[subProp.id].map(unit => (
                                                                                            <tr key={unit.id} className="table-row" style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                                                <td style={{ padding: '8px' }}>{unit.unit_name}</td>
                                                                                                <td style={{ padding: '8px' }}>{unit.floor}</td>
                                                                                                <td style={{ padding: '8px' }}>{unit.sqm} m²</td>
                                                                                                <td style={{ padding: '8px' }}>{unit.rooms}</td>
                                                                                                <td style={{ padding: '8px' }}>
                                                                                                    {unit.status === 'vacation_rental' ? (
                                                                                                        <span style={{ color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                            <Home size={12} /> Ferienwohnung
                                                                                                        </span>
                                                                                                    ) : unit.status === 'rented' ? (
                                                                                                        <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                            <Key size={12} /> Vermietet
                                                                                                        </span>
                                                                                                    ) : (
                                                                                                        <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                                            <AlertCircle size={12} /> Leerstand
                                                                                                        </span>
                                                                                                    )}
                                                                                                </td>
                                                                                                <td style={{ padding: '8px', fontWeight: 600 }}>
                                                                                                    {unit.is_vacation_rental 
                                                                                                        ? (parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                                        : (unit.leases?.find(l => l.status === 'active')?.cold_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                                    }
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
                                                                                                                    setMenuPos({ top: rect.bottom, left: rect.right });
                                                                                                                    setOpenActionMenuId(unit.id);
                                                                                                                }
                                                                                                            }}
                                                                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                                                                                        >
                                                                                                            <MoreVertical size={16} color="var(--text-secondary)" />
                                                                                                        </button>

                                                                                                        {openActionMenuId === unit.id && createPortal(
                                                                                                            <>
                                                                                                                <div
                                                                                                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                                                                                                    onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); }}
                                                                                                                />
                                                                                                                <div style={{
                                                                                                                    position: 'fixed',
                                                                                                                    top: menuPos.top + 5,
                                                                                                                    left: menuPos.left,
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
                                                                                                                    {unit.status === 'vacant' && (
                                                                                                                        <button
                                                                                                                            onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); navigate(`/tenants?action=create&propertyId=${subProp.id}&unitId=${unit.id}`); }}
                                                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--success-color)' }}
                                                                                                                            title="Einheit vermieten"
                                                                                                                        >
                                                                                                                            <Plus size={14} /> Vermieten
                                                                                                                        </button>
                                                                                                                    )}
                                                                                                                    <button
                                                                                                                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleEditUnit(subProp, unit); }}
                                                                                                                        style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                                                                                                        title="Einheit bearbeiten"
                                                                                                                    >
                                                                                                                        <Edit size={14} /> Bearbeiten
                                                                                                                    </button>
                                                                                                                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                                                    <button
                                                                                                                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleDeleteUnit(subProp.id, unit.id); }}
                                                                                                                        style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                                                                                                        title="Einheit löschen"
                                                                                                                    >
                                                                                                                        <Trash2 size={14} /> Löschen
                                                                                                                    </button>
                                                                                                                </div>
                                                                                                            </>,
                                                                                                            document.body
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
                                                </>
                                            )}

                                            {/* Render Units for Normal Property (Not Group) */}
                                            {!propertyOrGroup.isGroup && expandedPropertyId === propertyOrGroup.id && (
                                                <tr style={{ backgroundColor: 'var(--background-color)', borderBottom: '1px solid var(--border-color)' }}>
                                                    <td colSpan={propertyColumns.length} style={{ padding: 'var(--spacing-md) var(--spacing-xl)' }}>
                                                        <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <Home size={16} /> Einheiten
                                                            </h4>
                                                            <Button size="sm" icon={Plus} onClick={() => {
                                                                if (!checkGlobalAccess()) return;
                                                                handleOpenUnitModal(property);
                                                            }}>Neue Einheit</Button>
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
                                                                            <th style={{ padding: '8px' }}>Istmiete</th>
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
                                                                                    {unit.status === 'vacation_rental' ? (
                                                                                        <span style={{ color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                            <Home size={12} /> Ferienwohnung
                                                                                        </span>
                                                                                    ) : unit.status === 'rented' ? (
                                                                                        <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                            <Key size={12} /> Vermietet
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                                                                                            <AlertCircle size={12} /> Leerstand
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ padding: '8px', fontWeight: 600 }}>
                                                                                    {unit.is_vacation_rental 
                                                                                        ? (parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                        : (unit.leases?.find(l => l.status === 'active')?.cold_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                                                                                    }
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
                                                                                                    setMenuPos({ top: rect.bottom, left: rect.right });
                                                                                                    setOpenActionMenuId(unit.id);
                                                                                                }
                                                                                            }}
                                                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                                                                        >
                                                                                            <MoreVertical size={16} color="var(--text-secondary)" />
                                                                                        </button>

                                                                                        {openActionMenuId === unit.id && createPortal(
                                                                                            <>
                                                                                                <div
                                                                                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                                                                                    onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); }}
                                                                                                />
                                                                                                <div style={{
                                                                                                    position: 'fixed',
                                                                                                    top: menuPos.top + 5,
                                                                                                    left: menuPos.left,
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
                                                                                            </>,
                                                                                            document.body
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

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {filteredProperties.map(property => {
                                const totalSqm = property.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                                // Calculate unit details for quick view
                                const unitCount = property.units?.length || 0;
                                const rentedUnits = property.units?.filter(u => u.status === 'rented').length || 0;

                                return (
                                    <div key={property.id}
                                        onClick={() => handleEditProperty(property)}
                                        style={{
                                            border: '1px solid var(--border-color)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: 'var(--spacing-md)',
                                            backgroundColor: 'var(--surface-color)',
                                            cursor: 'pointer'
                                        }}>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{property.street} {property.house_number}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{property.zip} {property.city}</div>
                                            </div>
                                            <div style={{
                                                padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                                                backgroundColor: property.property_type === 'commercial' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                                color: property.property_type === 'commercial' ? 'var(--warning-color)' : 'var(--primary-color)'
                                            }}>
                                                {property.property_type === 'commercial' ? 'Gewerbe' : 'Wohnen'}
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px', fontSize: '0.85rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Home size={14} className="text-secondary" />
                                                <span>
                                                    {unitCount === 0 ? 'Keine Einheiten' : `${rentedUnits}/${unitCount} Vermietet`}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <LayoutGrid size={14} className="text-secondary" />
                                                <span>{totalSqm > 0 ? `${totalSqm} m²` : '—'}</span>
                                            </div>
                                        </div>

                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', gap: '8px' }}>
                                            <Button size="sm" variant="secondary" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); handleEditProperty(property); }}>
                                                <Edit3 size={14} style={{ marginRight: '6px' }} /> Bearbeiten
                                            </Button>
                                            <Button size="sm" variant="secondary" style={{ flex: 1 }} onClick={(e) => {
                                                e.stopPropagation();
                                                if (!checkGlobalAccess()) return;
                                                handleOpenUnitModal(property);
                                            }}>
                                                <Plus size={14} style={{ marginRight: '6px' }} /> Einheit
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
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
                
                {/* Economic Unit Selection (Checkboxes) */}
                <div style={{ marginTop: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--accent-color)' }}>
                        Wirtschaftseinheit bilden mit (Mehrfachauswahl möglich)
                    </label>
                    <div style={{ 
                        border: '1px solid var(--accent-color)', 
                        borderRadius: 'var(--radius-md)', 
                        padding: '12px', 
                        backgroundColor: 'rgba(139, 92, 246, 0.05)',
                        maxHeight: '150px',
                        overflowY: 'auto'
                    }}>
                        {properties.filter(p => p.id !== editingPropertyId && (!propertyForm.portfolio_id || p.portfolio_id === propertyForm.portfolio_id)).length === 0 ? (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Keine weiteren Immobilien im Portfolio.</span>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {properties
                                    .filter(p => p.id !== editingPropertyId && (!propertyForm.portfolio_id || p.portfolio_id === propertyForm.portfolio_id))
                                    .map(p => (
                                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={propertyForm.economic_unit_members?.includes(p.id)}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setPropertyForm(prev => {
                                                    const members = prev.economic_unit_members || [];
                                                    if (checked) return { ...prev, economic_unit_members: [...members, p.id] };
                                                    return { ...prev, economic_unit_members: members.filter(id => id !== p.id) };
                                                });
                                            }}
                                            style={{ accentColor: 'var(--accent-color)', width: '16px', height: '16px' }}
                                        />
                                        {p.street} {p.house_number} {p.city}
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Wähle alle Gebäude aus, die zu dieser Wirtschaftseinheit gehören. Sie werden im Dashboard zusammengefasst.
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
