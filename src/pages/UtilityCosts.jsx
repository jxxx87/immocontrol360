import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import {
    Plus, Loader2, ChevronDown, ChevronRight, Edit2, Trash2,
    Download, ArrowLeft, ArrowRight, Save, Check, X, FileText,
    MoreVertical, Eye, Printer
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';
import { usePdfTemplate, fetchPdfTemplate } from '../lib/usePdfTemplate';

const formatDate = (dateStr) => {
    if (!dateStr) return '–';
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// ========== STEP INDICATOR ==========
const StepIndicator = ({ steps, currentStep, onStepClick }) => (
    <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', padding: '0 0.25rem' }}>
            {steps.map((step, i) => (
                <React.Fragment key={i}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: 0, cursor: onStepClick ? 'pointer' : 'default' }}
                        onClick={() => onStepClick && onStepClick(i)}>
                        <div style={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 600, fontSize: '0.8rem',
                            backgroundColor: i <= currentStep ? 'var(--primary-color)' : '#E5E7EB',
                            color: i <= currentStep ? '#fff' : '#6B7280',
                            transition: 'all 0.3s'
                        }}>
                            {i < currentStep ? <Check size={14} /> : i + 1}
                        </div>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: i === currentStep ? 700 : 400,
                            color: i <= currentStep ? 'var(--text-primary)' : 'var(--text-secondary)',
                            textAlign: 'center', lineHeight: 1.2, maxWidth: '80px',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                        }}>{step}</span>
                    </div>
                    {i < steps.length - 1 && (
                        <div style={{
                            flex: 1, height: 2, marginTop: '13px',
                            backgroundColor: i < currentStep ? 'var(--primary-color)' : '#E5E7EB',
                            transition: 'all 0.3s'
                        }} />
                    )}
                </React.Fragment>
            ))}
        </div>
    </div>
);


// ========== MAIN COMPONENT ==========
const UtilityCosts = () => {
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const { isMobile } = useViewMode();
    const pdfTemplate = usePdfTemplate('nebenkostenabrechnung');

    const [loading, setLoading] = useState(true);
    const [properties, setProperties] = useState([]);
    const [units, setUnits] = useState([]);
    const [leases, setLeases] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [categories, setCategories] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [settlements, setSettlements] = useState([]); // Local state for saved settlements
    const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyDescription, setNewKeyDescription] = useState('');
    const [newKeyType, setNewKeyType] = useState('custom');
    const [pendingKeyIndex, setPendingKeyIndex] = useState(null); // Which row triggered creation
    const [distributionKeys, setDistributionKeys] = useState([]);

    // UI State
    const [expandedProperty, setExpandedProperty] = useState(null);
    const [openSettlementMenuId, setOpenSettlementMenuId] = useState(null);
    const [settlementMenuPos, setSettlementMenuPos] = useState(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [editingSettlement, setEditingSettlement] = useState(null);

    // Wizard Form State
    const [wizardPropertyId, setWizardPropertyId] = useState(null);
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [selectedUnitIds, setSelectedUnitIds] = useState([]);
    const [costItems, setCostItems] = useState([]); // { category_id, category_name, amount, distribution_key }
    const [unitCosts, setUnitCosts] = useState({}); // { unitId: [{ label, amount }] }
    const [reviewUnit, setReviewUnit] = useState(null);
    const [step3SelectedUnit, setStep3SelectedUnit] = useState(null);

    const stepLabels = ['Einheiten', 'Kosten', 'Verteilung', 'Abschluss'];

    // ===== FETCH DATA =====
    useEffect(() => {
        if (user) fetchData();
    }, [user, selectedPortfolioID]);
    // Menu close on outside click is handled by the backdrop overlay in JSX

    const fetchData = async () => {
        try {
            setLoading(true);
            const [propRes, unitRes, leaseRes, tenantRes, catRes, expRes, settlementRes, distKeyRes] = await Promise.all([
                supabase.from('properties').select('*').order('street'),
                supabase.from('units').select('*, property:properties(*)').order('unit_name'),
                supabase.from('leases').select('*, unit:units(*, property:properties(*)), tenant:tenants(*)'),
                supabase.from('tenants').select('*'),
                supabase.from('expense_categories').select('*').order('name'),
                supabase.from('expenses').select('*, expense_categories(name, is_recoverable, distribution_key_id)').order('booking_date', { ascending: false }),
                supabase.from('utility_settlements').select('*').order('created_at', { ascending: false }),
                supabase.from('distribution_keys').select('*').or(`user_id.is.null,user_id.eq.${user.id}`).order('name')
            ]);

            let props = propRes.data || [];
            let allUnits = unitRes.data || [];
            let allLeases = leaseRes.data || [];
            let allExpenses = expRes.data || [];
            let allSettlements = settlementRes.error ? [] : (settlementRes.data || []);
            let keys = distKeyRes.data || [];

            if (selectedPortfolioID) {
                props = props.filter(p => p.portfolio_id === selectedPortfolioID);
                const propIds = props.map(p => p.id);
                allUnits = allUnits.filter(u => propIds.includes(u.property_id));
                allLeases = allLeases.filter(l => l.unit?.property?.portfolio_id === selectedPortfolioID);
                allExpenses = allExpenses.filter(e => !e.property_id || propIds.includes(e.property_id));
                // We'll filter settlements based on properties OR economic unit
                const economicUnitIds = Array.from(new Set(props.map(p => p.economic_unit_id).filter(Boolean)));
                allSettlements = allSettlements.filter(s => propIds.includes(s.property_id) || (s.economic_unit_id && economicUnitIds.includes(s.economic_unit_id)));
            }

            setProperties(props);
            setUnits(allUnits);
            setLeases(allLeases);
            setTenants(tenantRes.data || []);
            setCategories(catRes.data || []);
            setExpenses(allExpenses);
            setSettlements(allSettlements);
            setDistributionKeys(keys);
        } catch (error) {
            console.error('UtilityCosts fetch error:', error);
        } finally {
            setLoading(false);
        }
    };

    // ===== WIZARD HELPERS =====
    const propertyUnits = useMemo(() => {
        if (wizardPropertyId?.startsWith('we_')) {
            const weId = wizardPropertyId.replace('we_', '');
            return units.filter(u => u.property?.economic_unit_id === weId);
        }
        return units.filter(u => u.property_id === wizardPropertyId);
    }, [units, wizardPropertyId]);

    // Group properties into groupedProperties (including standalone properties)
    const groupedProperties = React.useMemo(() => {
        const groups = {};
        const result = [];

        properties.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = {
                        id: 'we_' + p.economic_unit_id,
                        isGroup: true,
                        economic_unit_id: p.economic_unit_id,
                        properties: []
                    };
                }
                groups[p.economic_unit_id].properties.push(p);
            } else {
                result.push({ ...p, isGroup: false });
            }
        });

        Object.values(groups).forEach(g => {
            if (g.properties.length > 0) {
                const uniqueProps = g.properties;
                if (uniqueProps.length === 1) {
                    result.push({ ...uniqueProps[0], isGroup: false });
                } else {
                    const streets = Array.from(new Set(uniqueProps.map(u => u.street).filter(Boolean)));
                    g.street = `Wirtschaftseinheit: ${streets.length > 0 ? streets.join(', ') : 'Diverse'}`;
                    g.house_number = Array.from(new Set(uniqueProps.map(u => u.house_number).filter(Boolean))).join(' & ');
                    const cities = Array.from(new Set(uniqueProps.map(u => u.city).filter(Boolean)));
                    g.city = cities.join(', ');
                    g.zip = uniqueProps[0].zip || '';
                    result.push(g);
                }
            }
        });

        return result.sort((a, b) => (a.street || '').localeCompare(b.street || ''));
    }, [properties]);

    const toggleUnit = (unitId) => {
        setSelectedUnitIds(prev =>
            prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]
        );
    };

    const toggleAllUnits = () => {
        if (selectedUnitIds.length === propertyUnits.length) {
            setSelectedUnitIds([]);
        } else {
            setSelectedUnitIds(propertyUnits.map(u => u.id));
        }
    };

    const startNewSettlement = (propertyId) => {
        setWizardPropertyId(propertyId);
        const now = new Date();
        const year = now.getFullYear() - 1;
        setPeriodStart(`${year}-01-01`);
        setPeriodEnd(`${year}-12-31`);
        let propUnits = [];
        if (propertyId.startsWith('we_')) {
            const weId = propertyId.replace('we_', '');
            propUnits = units.filter(u => u.property?.economic_unit_id === weId);
        } else {
            propUnits = units.filter(u => u.property_id === propertyId);
        }
        setSelectedUnitIds(propUnits.map(u => u.id));
        setCostItems([]);
        setUnitCosts({});
        setReviewUnit(null);
        setStep3SelectedUnit(null);
        setEditingSettlement(null);
        setWizardStep(0);
        setWizardOpen(true);
    };

    const editSettlement = (settlement) => {
        setEditingSettlement(settlement);
        setWizardPropertyId(settlement.economic_unit_id ? `we_${settlement.economic_unit_id}` : settlement.property_id);
        setPeriodStart(settlement.period_start);
        setPeriodEnd(settlement.period_end);

        const data = settlement.data ? (typeof settlement.data === 'string' ? JSON.parse(settlement.data) : settlement.data) : {};
        setSelectedUnitIds(data.selectedUnitIds || []);
        setCostItems(data.costItems || []);
        setUnitCosts(data.unitCosts || {});
        setReviewUnit(null);
        setStep3SelectedUnit(null);
        setWizardStep(0);
        setWizardOpen(true);
    };

    // Load expense-based costs when entering step 2
    const loadCostsForStep2 = () => {
        let weId = null;
        let pId = wizardPropertyId;
        if (wizardPropertyId?.startsWith('we_')) {
            weId = wizardPropertyId.replace('we_', '');
            pId = null;
        }

        // Filter expenses by property and period, only recoverable
        const periodExpenses = expenses.filter(e => {
            // If we have an economic unit, we'd theoretically want expenses across the unit,
            // but expenses only have property_id. We'd map weId to all property_ids.
            const pIdsInWe = pId ? [pId] : properties.filter(p => p.economic_unit_id === weId).map(p => p.id);
            const matchesProp = e.property_id ? pIdsInWe.includes(e.property_id) : false;

            return matchesProp &&
                e.booking_date >= periodStart &&
                e.booking_date <= periodEnd &&
                e.expense_categories?.is_recoverable === true;
        });

        // Group by category
        const byCategory = {};
        periodExpenses.forEach(e => {
            const catId = e.category_id || 'other';
            const catName = e.expense_categories?.name || 'Sonstige';
            const defaultKeyId = e.expense_categories?.distribution_key_id;

            // Calculate default distribution key
            // If expense category has a default key ID, use it.
            // Otherwise use a fallback (e.g. area).
            // We need to resolve key ID to a meaningful value if we were using strings.
            // But now we prefer using IDs. 
            // If the category has no default, we try to find 'Wohnfläche' in our keys list.
            let distKey = defaultKeyId;
            if (!distKey) {
                const areaKey = distributionKeys.find(k => k.calculation_type === 'area');
                distKey = areaKey?.id || 'wohnflaeche'; // Fallback to legacy string if no key found
            }

            if (!byCategory[catId]) {
                byCategory[catId] = { category_id: catId, category_name: catName, amount: 0, distribution_key: distKey };
            }
            byCategory[catId].amount += parseFloat(e.amount) || 0;
        });

        // Only load from expenses if we don't already have cost items (e.g. from a saved draft)
        if (costItems.length === 0) {
            setCostItems(Object.values(byCategory));
        }
    };

    const handleCreateNewKey = async (permanent) => {
        try {
            // Updated to be always permanent and simplified
            let keyObj;

            const { data, error } = await supabase.from('distribution_keys').insert([{
                user_id: user.id,
                name: newKeyName,
                calculation_type: newKeyType, // Default 'custom'
                description: newKeyDescription || 'In Nebenkostenabrechnung erstellt'
            }]).select().single();

            if (error) throw error;
            keyObj = data;

            // Refresh keys
            const { data: allKeys } = await supabase.from('distribution_keys').select('*').or(`user_id.is.null,user_id.eq.${user.id}`).order('name');
            setDistributionKeys(allKeys || []);

            // Update the row
            if (pendingKeyIndex !== null) {
                const updated = [...costItems];
                updated[pendingKeyIndex].distribution_key = keyObj.id;
                setCostItems(updated);
            }

            setIsCreateKeyModalOpen(false);
            setNewKeyName('');
            setNewKeyDescription('');
            setNewKeyType('custom');
            setPendingKeyIndex(null);

        } catch (error) {
            console.error('Error creating key:', error);
            alert('Fehler beim Erstellen des Schlüssels');
        }
    };
    // IMPORTANT: Denominator uses ALL units in the property (the whole house),
    // not just the selected ones, to get correct proportional shares.
    const calculateUnitCosts = () => {
        const result = {};
        selectedUnitIds.forEach(uid => {
            result[uid] = [];
        });

        // Helper: get occupants for any unit via its tenant
        const getOccupants = (u) => {
            const lease = leases.find(l => l.unit_id === u.id && l.status === 'active');
            return lease?.tenant?.occupants || 1;
        };

        // Pre-calculate totals using ALL units in the property (the whole house)
        const allUnitsCount = propertyUnits.length;
        const totalArea = propertyUnits.reduce((sum, u) => sum + (u.sqm || 1), 0);
        const totalPersons = propertyUnits.reduce((sum, u) => sum + getOccupants(u), 0);

        costItems.forEach(item => {
            const totalAmount = item.amount;
            const key = item.distribution_key;

            // Only assign costs to selected units, but denominator = whole house
            const selectedUnits = propertyUnits.filter(u => selectedUnitIds.includes(u.id));

            // Helper: Resolve distribution key to calculation type
            // 1. If key is a UUID, find it in distributionKeys and get calculation_type
            // 2. If key is a legacy string ('wohnflaeche'), map to type
            const getKeyType = (keyVal) => {
                const keyObj = distributionKeys.find(k => k.id === keyVal);
                if (keyObj) return keyObj.calculation_type;

                // Legacy mapping
                if (keyVal === 'wohnflaeche') return 'area';
                if (keyVal === 'personenanzahl') return 'persons';
                if (keyVal === 'einheit') return 'units';
                if (keyVal === 'anteil') return 'equal';
                if (keyVal === 'verbrauch') return 'custom';
                return 'area'; // Default
            };

            const type = getKeyType(key);

            selectedUnits.forEach(unit => {
                let share = 0;
                if (type === 'units' || type === 'equal') {
                    // Per unit (equal share among selected units? Or all units?)
                    // Typically 'equal' means divided by total units in property, then assigned to this unit.
                    share = totalAmount / allUnitsCount;
                    // Note: if type is 'equal', usually it means equal share per unit.
                } else if (type === 'area') {
                    share = totalAmount * (unit.sqm || 1) / totalArea;
                } else if (type === 'persons') {
                    share = totalAmount * getOccupants(unit) / totalPersons;
                } else {
                    // Custom -> simplistic fallback or 0
                    // Ideally custom requires manual input per unit, which step 3 allows.
                    // Step 3 allows overriding 'amount'. So we init with 0 or equal share.
                    share = 0;
                }

                if (share > 0) {
                    result[unit.id].push({
                        label: item.category_name,
                        amount: share,
                        isCustom: false
                    });
                }
            });
        });

        // Initialize empty arrays if needed
        selectedUnitIds.forEach(uid => {
            if (!result[uid]) result[uid] = [];
        });

        // Merge with any existing custom costs
        Object.keys(unitCosts).forEach(uid => {
            const existing = unitCosts[uid] || [];
            const customCosts = existing.filter(c => c.isCustom);
            if (customCosts.length > 0 && result[uid]) {
                result[uid] = [...result[uid], ...customCosts];
            }
        });

        setUnitCosts(result);
    };

    // ===== SAVE / DELETE =====
    const saveSettlement = async (status = 'draft') => {
        try {
            const dataPayload = {
                selectedUnitIds,
                costItems,
                unitCosts
            };

            let actualPropertyId = wizardPropertyId;
            let actualEconomicUnitId = null;
            if (wizardPropertyId?.startsWith('we_')) {
                actualEconomicUnitId = wizardPropertyId.replace('we_', '');
                const relatedProps = properties.filter(p => p.economic_unit_id === actualEconomicUnitId);
                actualPropertyId = relatedProps.length > 0 ? relatedProps[0].id : null;
            }

            const record = {
                user_id: user.id,
                property_id: actualPropertyId,
                economic_unit_id: actualEconomicUnitId,
                period_start: periodStart,
                period_end: periodEnd,
                status: status,
                data: dataPayload,
                year: new Date(periodStart).getFullYear()
            };

            let error;
            if (editingSettlement) {
                const { error: updateError } = await supabase
                    .from('utility_settlements')
                    .update(record)
                    .eq('id', editingSettlement.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('utility_settlements')
                    .insert([record]);
                error = insertError;
            }

            if (error) throw error;

            setWizardOpen(false);
            fetchData();
        } catch (error) {
            alert(translateError(error));
        }
    };

    const deleteSettlement = async (id) => {
        if (!confirm('Möchten Sie diese Abrechnung wirklich löschen?')) return;
        try {
            const { error } = await supabase.from('utility_settlements').delete().eq('id', id);
            if (error) throw error;
            fetchData();
        } catch (error) {
            alert(translateError(error));
        }
    };

    // ===== STEP NAVIGATION =====
    const goNext = () => {
        if (wizardStep === 0 && selectedUnitIds.length === 0) {
            alert('Bitte wählen Sie mindestens eine Einheit aus.');
            return;
        }
        if (wizardStep === 1) {
            calculateUnitCosts();
            // Auto-select first unit for Step 3
            if (selectedUnitIds.length > 0) {
                setStep3SelectedUnit(selectedUnitIds[0]);
            }
        }
        if (wizardStep === 0) {
            loadCostsForStep2();
        }
        setWizardStep(prev => Math.min(prev + 1, 3));
    };

    const goBack = () => {
        setWizardStep(prev => Math.max(prev - 1, 0));
    };

    // ===== HELPER: Get all tenants for a unit within a date range =====
    const getTenantsForUnitInPeriod = (unitId, pStart, pEnd) => {
        if (!pStart || !pEnd) return [];
        const periodStart_ = new Date(pStart);
        const periodEnd_ = new Date(pEnd);
        const totalDays = Math.round((periodEnd_ - periodStart_) / (1000 * 60 * 60 * 24)) + 1;

        // Find all leases for this unit that overlap the period
        const overlapping = leases.filter(l => {
            if (l.unit_id !== unitId) return false;
            const leaseStart = new Date(l.start_date);
            const leaseEnd = l.end_date ? new Date(l.end_date) : new Date('9999-12-31');
            // Overlap check: lease starts before period ends AND lease ends after period starts
            return leaseStart <= periodEnd_ && leaseEnd >= periodStart_;
        });

        return overlapping.map(l => {
            const leaseStart = new Date(l.start_date);
            const leaseEnd = l.end_date ? new Date(l.end_date) : periodEnd_;
            const effectiveStart = leaseStart > periodStart_ ? leaseStart : periodStart_;
            const effectiveEnd = leaseEnd < periodEnd_ ? leaseEnd : periodEnd_;
            const days = Math.round((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1;
            const t = tenants.find(tn => tn.id === l.tenant_id);
            return {
                lease: l,
                tenant: t,
                tenantName: t ? `${t.last_name}, ${t.first_name}` : 'Unbekannt',
                effectiveStart: effectiveStart.toISOString().split('T')[0],
                effectiveEnd: effectiveEnd.toISOString().split('T')[0],
                days,
                ratio: totalDays > 0 ? days / totalDays : 0
            };
        }).sort((a, b) => a.effectiveStart.localeCompare(b.effectiveStart));
    };

    const getTenantForUnit = (unitId) => {
        // If settlement period is set, show all tenants in that period
        if (periodStart && periodEnd) {
            const tenantPeriods = getTenantsForUnitInPeriod(unitId, periodStart, periodEnd);
            if (tenantPeriods.length === 0) return null;
            return tenantPeriods.map(tp => `${tp.tenantName} (${formatDate(tp.effectiveStart)}–${formatDate(tp.effectiveEnd)})`).join(', ');
        }
        // Fallback: active lease only
        const lease = leases.find(l => l.unit_id === unitId && l.status === 'active');
        if (!lease) return null;
        const t = tenants.find(t => t.id === lease.tenant_id);
        return t ? `${t.last_name}, ${t.first_name}` : 'Unbekannt';
    };

    // ===== HELPER: Get property name =====
    const getPropertyName = (propId) => {
        const p = properties.find(p => p.id === propId);
        if (!p) return 'Unbekannt';
        if (p.economic_unit_id) {
            const weProps = properties.filter(x => x.economic_unit_id === p.economic_unit_id);
            const streets = Array.from(new Set(weProps.map(u => u.street).filter(Boolean)));
            const houseNumbers = Array.from(new Set(weProps.map(u => u.house_number).filter(Boolean))).join(' & ');
            return `Wirtschaftseinheit: ${streets.length > 0 ? streets.join(', ') : 'Diverse'} ${houseNumbers}`;
        }
        return `${p.street} ${p.house_number}`;
    };

    const getPropertyFull = (propId) => {
        return properties.find(p => p.id === propId);
    };

    // ===== SETTLEMENT HTML GENERATION =====
    const generateSettlementHTML = (settlement, singleUnitId = null, targetTenantId = null, templateOverride = null, writingTemplates = null) => {
        const prop = getPropertyFull(settlement.property_id);
        const data = settlement.data || {};
        const sUnits = data.selectedUnitIds || [];
        const sCosts = data.unitCosts || {};
        const sCostItems = data.costItems || [];

        const propAddress = prop ? `${prop.street} ${prop.house_number}` : '–';
        const propCity = prop ? `${prop.zip} ${prop.city}` : '';

        const unitsToProcess = singleUnitId ? sUnits.filter(id => id === singleUnitId) : sUnits;
        const allPropertyUnits = settlement.economic_unit_id 
            ? units.filter(u => u.property?.economic_unit_id === settlement.economic_unit_id)
            : units.filter(u => u.property_id === settlement.property_id);

        // Totals for distribution keys
        const totalArea = allPropertyUnits.reduce((s, u) => s + (u.sqm || 1), 0);
        const totalUnitCount = allPropertyUnits.length;
        const getOccHelper = (u) => {
            const l = leases.find(l => l.unit_id === u.id && l.status === 'active');
            return l?.tenant?.occupants || 1;
        };
        const totalPersons = allPropertyUnits.reduce((s, u) => s + getOccHelper(u), 0);

        const pStart = new Date(settlement.period_start);
        const pEnd = new Date(settlement.period_end);
        const settlementMonths = Math.max(1, (pEnd.getFullYear() - pStart.getFullYear()) * 12 + (pEnd.getMonth() - pStart.getMonth()) + 1);
        const fmt = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const keyLabels = { wohnflaeche: 'Wohnfläche', personenanzahl: 'Personen', einheit: 'Einheit', anteil: 'Anteil' };

        let allPages = [];

        unitsToProcess.forEach(uid => {
            const unit = units.find(u => u.id === uid);
            if (!unit) return;

            let periods = getTenantsForUnitInPeriod(uid, settlement.period_start, settlement.period_end);
            if (targetTenantId) {
                periods = periods.filter(p => p.tenant && p.tenant.id === targetTenantId);
            }

            if (periods.length > 0) {
                periods.forEach(p => {
                    allPages.push({
                        unitId: uid,
                        unitName: unit.unit_name,
                        tenantName: p.tenantName,
                        periodText: `${formatDate(p.effectiveStart)} - ${formatDate(p.effectiveEnd)}`,
                        ratio: p.ratio,
                        lease: p.lease,
                        occupants: p.tenant?.occupants || 1,
                        sqm: unit.sqm || 1
                    });
                });
            }
        });

        let pagesHTML = '';
        allPages.forEach((page, idx) => {
            const unitCostsList = sCosts[page.unitId] || [];

            const tenantTotal = unitCostsList.reduce((sum, item) => {
                const sourceItem = sCostItems.find(i => i.category_name === item.label);
                const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                let factor = page.ratio;
                if (key === 'personenanzahl' && page.occupants === 0) factor = 0;
                return sum + (item.amount || 0) * factor;
            }, 0);

            const monthlySvc = page.lease ? parseFloat(page.lease.service_charge || 0) : 0;
            const monthlyHeat = page.lease ? parseFloat(page.lease.heating_cost || 0) : 0;
            const monthlyPrepay = monthlySvc + monthlyHeat;

            const tenantPrepay = monthlyPrepay * settlementMonths * page.ratio;
            const tenantSvcPrepay = monthlySvc * settlementMonths * page.ratio;
            const tenantHeatPrepay = monthlyHeat * settlementMonths * page.ratio;

            const balance = tenantTotal - tenantPrepay;

            const landlordPortfolio = portfolios.find(p => p.id === prop?.portfolio_id);
            const landlordName = landlordPortfolio?.company_name || landlordPortfolio?.name || 'Vermieter';
            const bankDetailsStr = (landlordPortfolio?.bank_name)
                ? `Inhaber: ${landlordPortfolio?.company_name || landlordPortfolio?.name}, Bank: ${landlordPortfolio.bank_name}, IBAN: ${landlordPortfolio.iban}, BIC: ${landlordPortfolio.bic}`
                : '';

            // Generate Summary Table
            const summaryTableHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
                <thead>
                    <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                        <th style="padding: 6px; text-align: left;">Kostenart / Position</th>
                        <th style="padding: 6px; text-align: right; width: 30%;">Betrag</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Ihre Gesamtkosten (Brutto):</td>
                        <td style="padding: 6px; text-align: right; font-weight: bold; border-bottom: 1px solid #cbd5e1;">${fmt(tenantTotal)} €</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Ihre Betriebskosten-Vorauszahlung:</td>
                        <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${fmt(tenantSvcPrepay)} €</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Ihre Heizkosten-Vorauszahlung:</td>
                        <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${fmt(tenantHeatPrepay)} €</td>
                    </tr>
                    <tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                        <td style="padding: 8px; font-weight: bold; font-size: 11pt;">Ihre ${balance > 0 ? 'Nachzahlung' : 'Gutschrift'} (Brutto):</td>
                        <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: ${balance > 0 ? '#dc2626' : '#16a34a'};">${fmt(Math.abs(balance))} €</td>
                    </tr>
                </tbody>
            </table>`;

            // Generate Detail Table
            const detailRows = unitCostsList.map(item => {
                const sourceItem = sCostItems.find(i => i.category_name === item.label);
                const totalCost = sourceItem ? sourceItem.amount : 0;
                const key = sourceItem ? sourceItem.distribution_key : 'anteil';

                const dkObj = distributionKeys.find(k => k.id === key);
                const resolvedType = dkObj ? dkObj.calculation_type : (key === 'wohnflaeche' ? 'area' : key === 'personenanzahl' ? 'persons' : key === 'einheit' ? 'units' : key === 'anteil' ? 'equal' : 'area');
                const resolvedName = dkObj ? dkObj.name : (keyLabels[key] || key);

                let totalUnits = 0;
                let myUnits = 0;
                let unitLabel = '';

                if (resolvedType === 'area') {
                    totalUnits = totalArea;
                    myUnits = page.sqm;
                    unitLabel = 'm²';
                } else if (resolvedType === 'persons') {
                    totalUnits = totalPersons;
                    myUnits = page.occupants;
                    unitLabel = 'P.';
                } else {
                    totalUnits = totalUnitCount;
                    myUnits = 1;
                    unitLabel = 'Einh.';
                }

                const costPerUnit = totalUnits > 0 ? totalCost / totalUnits : 0;
                let factor = page.ratio;
                if (resolvedType === 'persons' && page.occupants === 0) {
                    factor = 0;
                }
                const itemShare = (item.amount || 0) * factor;

                return `
                <tr>
                    <td style="padding: 6px; border-bottom: 1px solid #cbd5e1; font-weight: bold;">${item.label}</td>
                    <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">${resolvedName}</td>
                    <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${totalCost > 0 ? fmt(totalCost) + ' €' : '--'}</td>
                    <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${totalUnits > 0 ? fmt(totalUnits) + ' ' + unitLabel : '--'}</td>
                    <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${costPerUnit > 0 ? fmt(costPerUnit) + ' €' : '--'}</td>
                    <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${myUnits > 0 ? fmt(myUnits) + ' ' + unitLabel : '--'}</td>
                    <td style="padding: 6px; text-align: right; font-weight: bold; border-bottom: 1px solid #cbd5e1;">${fmt(itemShare)} €</td>
                </tr>`;
            }).join('');

            const detailTableHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 8.5pt;">
                <thead>
                    <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                        <th style="padding: 6px; text-align: left; width: 22%;">Kostenart</th>
                        <th style="padding: 6px; text-align: left; width: 15%;">Schlüssel</th>
                        <th style="padding: 6px; text-align: right; width: 12%;">Gesamtkosten</th>
                        <th style="padding: 6px; text-align: right; width: 12%;">Gesamt-Einheit</th>
                        <th style="padding: 6px; text-align: right; width: 12%;">Kosten/Einheit</th>
                        <th style="padding: 6px; text-align: right; width: 12%;">Ihre Einheit</th>
                        <th style="padding: 6px; text-align: right; width: 15%; font-weight: bold;">Ihr Anteil</th>
                    </tr>
                </thead>
                <tbody>
                    ${detailRows}
                    <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                        <td colspan="6" style="padding: 8px;">Gesamtsumme (zeitanteilig):</td>
                        <td style="padding: 8px; text-align: right;">${fmt(tenantTotal)} €</td>
                    </tr>
                </tbody>
            </table>`;

            const localVars = {
                mieter_name: page.tenantName,
                mieter_anrede: `Sehr geehrte/r ${page.tenantName}`,
                objekt_adresse: `${propAddress}, ${propCity}`,
                einheit_name: page.unitName,
                abrechnungsjahr: settlement.year || '',
                abrechnungszeitraum: `${formatDate(settlement.period_start)} - ${formatDate(settlement.period_end)}`,
                nutzungszeitraum: page.periodText,
                gesamtkosten_mieter: `${fmt(tenantTotal)} €`,
                vorauszahlungs_betrag: `${fmt(tenantPrepay)} €`,
                saldo_betrag: `${fmt(Math.abs(balance))} €`,
                saldo_art: balance > 0 ? 'Nachzahlung' : 'Gutschrift',
                vermieter_name: landlordName,
                vermieter_bankverbindung: bankDetailsStr,
                erstellungsdatum: formatDate(settlement.created_at),
                nebenkosten_tabelle: summaryTableHtml,
                nebenkosten_detail_tabelle: detailTableHtml
            };

            const replaceHTMLVariables = (htmlStr, vars) => {
                if (!htmlStr) return '';
                let result = htmlStr;
                for (const [key, value] of Object.entries(vars)) {
                    const regex = new RegExp(`(<span[^>]*data-id="${key}"[^>]*>.*?<\/span>|{${key}})`, 'g');
                    result = result.replace(regex, value);
                }
                return result;
            };

            const DEFAULT_UTILITY_COSTS = `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter-Name">Mieter-Name</span></strong><br><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Datum: <strong><span data-type="mention" data-id="erstellungsdatum" data-label="Erstellungsdatum">Erstellungsdatum</span></strong><br>Abrechnungsjahr: <strong><span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></strong><br>Nutzungszeitraum: <strong><span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Nutzungszeitraum</span></strong></div></div><div class="letter-subject">Betriebskostenabrechnung <span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></div><div class="letter-body"><p>Sehr geehrte(r) <span data-type="mention" data-id="mieter_name" data-label="Mieter-Name">Mieter-Name</span>,</p><p>anbei erhalten Sie die Betriebskostenabrechnung für das Abrechnungsjahr <span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span>. Die Gesamtkosten und Ihr Abrechnungsergebnis stellen sich wie folgt dar:</p><p><span data-type="mention" data-id="nebenkosten_tabelle" data-label="Nebenkosten-Tabelle">Nebenkosten-Tabelle</span></p><p>Die detaillierte Aufteilung der einzelnen Kostenpositionen entnehmen Sie bitte der Folgeseite.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter-Name">Mieter-Name</span></strong><br><span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Datum: <strong><span data-type="mention" data-id="erstellungsdatum" data-label="Erstellungsdatum">Erstellungsdatum</span></strong><br>Abrechnungsjahr: <strong><span data-type="mention" data-id="abrechnungsjahr" data-label="Abrechnungsjahr">Abrechnungsjahr</span></strong><br>Nutzungszeitraum: <strong><span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Nutzungszeitraum</span></strong></div></div><div class="letter-subject">Detaillierte Aufstellung der Umlagen</div><div class="letter-body"><p>Nachfolgend finden Sie die Einzelpositionen und deren Berechnungsgrundlage:</p><p><span data-type="mention" data-id="nebenkosten_detail_tabelle" data-label="Nebenkosten-Detailtabelle">Nebenkosten-Detailtabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`;

            let templateHtml = writingTemplates?.full_template || DEFAULT_UTILITY_COSTS;
            const renderedContent = replaceHTMLVariables(templateHtml, localVars);

            pagesHTML += renderedContent;
        });

        return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Nebenkostenabrechnung ${settlement.year || ''}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
            @page { size: A4; margin: 0; }
            * { box-sizing: border-box; }
            body { margin: 0; padding: 0; background: #fff; font-family: 'Open Sans', Arial, sans-serif; font-size: 11pt; color: #000; }
            .letter-page {
                width: 210mm;
                height: 297mm;
                padding: 20mm 20mm 20mm 25mm;
                margin: 0 auto;
                background: #ffffff;
                color: #000000;
                box-sizing: border-box;
                position: relative;
                display: flex;
                flex-direction: column;
                text-align: left;
                page-break-after: always;
                page-break-inside: avoid;
            }
            .letter-sender {
                font-size: 8pt;
                color: #555555;
                border-bottom: 1px solid #cccccc;
                padding-bottom: 2mm;
                margin-bottom: 5mm;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .letter-header-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 10mm;
            }
            .letter-recipient {
                width: 85mm;
                font-size: 10pt;
                line-height: 1.4;
                color: #111111;
                text-align: left;
            }
            .letter-date {
                font-size: 10pt;
                color: #333333;
                text-align: right;
            }
            .letter-subject {
                font-size: 13pt;
                font-weight: bold;
                margin-bottom: 4mm;
                color: #000000;
                text-align: left;
            }
            .letter-object {
                font-size: 10pt;
                color: #444444;
                margin-bottom: 8mm;
                padding-bottom: 2mm;
                border-bottom: 1px dotted #e2e8f0;
                text-align: left;
            }
            .letter-body {
                flex-grow: 1;
                font-size: 11pt;
                line-height: 1.6;
                text-align: left;
            }
            .letter-body p {
                margin-bottom: 1em !important;
            }
            .letter-footer {
                display: flex;
                justify-content: space-between;
                border-top: 1px solid #dddddd;
                padding-top: 5mm;
                margin-top: 10mm;
                font-size: 8pt;
                color: #666666;
                line-height: 1.4;
                text-align: left;
            }
            .footer-col {
                width: 30%;
            }
            @media print {
                body {
                    margin: 0;
                    padding: 0;
                    background: #fff;
                }
                .letter-page {
                    margin: 0 !important;
                    border: none !important;
                    box-shadow: none !important;
                    page-break-after: always !important;
                    page-break-inside: avoid !important;
                    width: 210mm !important;
                    height: 297mm !important;
                }
            }
        </style></head><body style="background:#fff">
        ${pagesHTML}
        </body></html>`;
    };

    const fetchWritingTemplates = async (portfolioId) => {
        const results = {
            utility_intro: `<p>Sehr geehrte/r <span data-id="mieter_anrede">Sehr geehrte/r ...</span>,</p><p>anbei erhalten Sie die Betriebskostenabrechnung für Ihr Mietobjekt <span data-id="objekt_adresse">Objekt-Adresse</span> für das Abrechnungsjahr <span data-id="abrechnungsjahr">Abrechnungsjahr</span>.</p><p>Die Aufstellung Ihrer Gesamtkosten und Vorauszahlungen entnehmen Sie bitte der folgenden Übersicht:</p>`,
            utility_outro: `<p>Die detaillierte Aufteilung der einzelnen Betriebskostenarten sowie die jeweiligen Verteilerschlüssel können Sie den Folgeseiten entnehmen. Bitte prüfen Sie die Aufstellung. Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.</p><p>Mit freundlichen Grüßen,</p><p><span data-id="vermieter_name">Vermieter Name</span></p>`,
            full_template: null
        };

        if (!user) return results;

        try {
            // First check if there is a 'utility_costs' template
            let query = supabase
                .from('document_templates')
                .select('content_html')
                .eq('user_id', user.id)
                .eq('type', 'utility_costs');

            if (portfolioId) {
                query = query.eq('portfolio_id', portfolioId);
            } else {
                query = query.is('portfolio_id', null);
            }

            let { data, error } = await query.maybeSingle();
            
            // If portfolio-specific 'utility_costs' is not found and portfolioId is set, check global 'utility_costs'
            if ((error || !data) && portfolioId) {
                const { data: globalData, error: globalErr } = await supabase
                    .from('document_templates')
                    .select('content_html')
                    .eq('user_id', user.id)
                    .eq('type', 'utility_costs')
                    .is('portfolio_id', null)
                    .maybeSingle();
                if (!globalErr && globalData) {
                    data = globalData;
                }
            }

            if (data?.content_html) {
                results.full_template = data.content_html;
                // Split by 'nebenkosten_tabelle' placeholder
                const content = data.content_html;
                // Search for placeholder span or curly braces fallback
                const parts = content.split(/<span[^>]*data-id="nebenkosten_tabelle"[^>]*>.*?<\/span>|<span[^>]*data-id="nebenkosten_tabelle"[^>]*>.*?<\/span>|{nebenkosten_tabelle}/);
                results.utility_intro = parts[0] || '';
                results.utility_outro = parts[1] || '';
                return results;
            }

            // Fallback: if 'utility_costs' is not found, load the old 'utility_intro' and 'utility_outro'
            const types = ['utility_intro', 'utility_outro'];
            for (const type of types) {
                let q = supabase
                    .from('document_templates')
                    .select('content_html')
                    .eq('user_id', user.id)
                    .eq('type', type);

                if (portfolioId) {
                    q = q.eq('portfolio_id', portfolioId);
                } else {
                    q = q.is('portfolio_id', null);
                }

                const { data: oldData, error: oldErr } = await q.maybeSingle();
                if (!oldErr && oldData?.content_html) {
                    results[type] = oldData.content_html;
                } else if (portfolioId) {
                    const { data: globalOld } = await supabase
                        .from('document_templates')
                        .select('content_html')
                        .eq('user_id', user.id)
                        .eq('type', type)
                        .is('portfolio_id', null)
                        .maybeSingle();
                    if (globalOld?.content_html) {
                        results[type] = globalOld.content_html;
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching writing templates:', e);
        }

        return results;
    };

    const previewSettlement = async (settlement, unitId = null, tenantId = null) => {
        const prop = getPropertyFull(settlement.property_id);
        const tpl = prop?.portfolio_id
            ? await fetchPdfTemplate(prop.portfolio_id, 'nebenkostenabrechnung')
            : pdfTemplate;
        const writingTemplates = await fetchWritingTemplates(prop?.portfolio_id);
        const html = generateSettlementHTML(settlement, unitId, tenantId, tpl, writingTemplates);

        let suffix = '';
        if (unitId && tenantId) {
            const periods = getTenantsForUnitInPeriod(unitId, settlement.period_start, settlement.period_end);
            const p = periods.find(p => p.tenant && p.tenant.id === tenantId);
            if (p && p.tenant) suffix = `_${p.tenant.last_name}`;
        }
        const filename = `Nebenkostenabrechnung_${settlement.year || ''}_${prop ? prop.street.replace(/\s/g, '_') : 'Objekt'}${suffix}`;

        const win = window.open('', '_blank');
        if (!win) {
            alert('Bitte Popups erlauben.');
            return;
        }
        win.document.open();
        win.document.write(html);

        const script = win.document.createElement('script');
        script.textContent = `document.title = "${filename}";`;
        win.document.head.appendChild(script);

        win.document.close();
        setTimeout(() => {
            win.focus();
            win.print();
        }, 800);
    };

    const downloadSettlement = async (settlement, unitId = null, tenantId = null) => {
        const prop = getPropertyFull(settlement.property_id);
        const tpl = prop?.portfolio_id
            ? await fetchPdfTemplate(prop.portfolio_id, 'nebenkostenabrechnung')
            : pdfTemplate;
        const writingTemplates = await fetchWritingTemplates(prop?.portfolio_id);
        const html = generateSettlementHTML(settlement, unitId, tenantId, tpl, writingTemplates);

        let suffix = '';
        if (unitId && tenantId) {
            const periods = getTenantsForUnitInPeriod(unitId, settlement.period_start, settlement.period_end);
            const p = periods.find(p => p.tenant && p.tenant.id === tenantId);
            if (p && p.tenant) suffix = `_${p.tenant.last_name}`;
        }

        const filename = `Nebenkostenabrechnung_${settlement.year || ''}_${prop ? prop.street.replace(/\s/g, '_') : 'Objekt'}${suffix}.pdf`;

        // Use iframe to preserve full HTML document structure
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.left = '-9999px';
        iframe.style.width = '210mm';
        iframe.style.height = '297mm';
        document.body.appendChild(iframe);
        iframe.contentDocument.open();
        iframe.contentDocument.write(html);
        iframe.contentDocument.close();

        // Load html2pdf from CDN (or use cached version)
        const loadScript = () => new Promise((resolve) => {
            if (window.html2pdf) return resolve();
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });

        await loadScript();

        // Wait for iframe to fully render
        await new Promise(r => setTimeout(r, 500));

        window.html2pdf().set({
            margin: 10,
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(iframe.contentDocument.body).save().then(() => {
            document.body.removeChild(iframe);
        });
    };

    // ===== STATUS BADGE =====
    const StatusBadge = ({ status }) => {
        const map = {
            'done': { label: 'Fertig', variant: 'success' },
            'draft': { label: 'Entwurf', variant: 'default' },
            'in_progress': { label: 'In Bearbeitung', variant: 'warning' },
            'open': { label: 'Noch offen', variant: 'danger' }
        };
        const info = map[status] || map['open'];
        return <Badge variant={info.variant}>{info.label}</Badge>;
    };

    // ===== LOADING =====
    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    // ===== WIZARD VIEW =====
    if (wizardOpen) {
        const prop = properties.find(p => p.id === wizardPropertyId);
        return (
            <>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: 'var(--spacing-lg)' }}>
                        <button onClick={() => setWizardOpen(false)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nebenkostenabrechnung</h1>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{prop ? `${prop.street} ${prop.house_number}, ${prop.zip} ${prop.city} ` : ''}</p>
                        </div>
                    </div>

                    <Card style={isMobile ? { overflow: 'visible', height: 'auto' } : {}}>
                        <StepIndicator steps={stepLabels} currentStep={wizardStep} onStepClick={(step) => setWizardStep(step)} />

                        {/* ===== STEP 1: Unit Selection ===== */}
                        {wizardStep === 0 && (
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Abrechnungszeitraum & Einheiten</h3>

                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
                                    <Input label="Von" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                                    <Input label="Bis" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                                </div>

                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500, marginBottom: '0.5rem' }}>
                                        <input type="checkbox" checked={selectedUnitIds.length === propertyUnits.length && propertyUnits.length > 0} onChange={toggleAllUnits} style={{ width: 16, height: 16 }} />
                                        Alle Einheiten auswählen ({propertyUnits.length})
                                    </label>
                                </div>

                                <div style={{ display: 'grid', gap: '8px' }}>
                                    {propertyUnits.filter(unit => getTenantForUnit(unit.id)).map(unit => {
                                        const tenant = getTenantForUnit(unit.id);
                                        return (
                                            <div key={unit.id}
                                                onClick={() => toggleUnit(unit.id)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '12px',
                                                    padding: '12px 16px', borderRadius: 'var(--radius-md)',
                                                    border: `2px solid ${selectedUnitIds.includes(unit.id) ? 'var(--primary-color)' : 'var(--border-color)'} `,
                                                    cursor: 'pointer', transition: 'all 0.2s',
                                                    backgroundColor: selectedUnitIds.includes(unit.id) ? '#EFF6FF' : 'transparent'
                                                }}>
                                                <input type="checkbox" checked={selectedUnitIds.includes(unit.id)} onChange={() => { }} style={{ width: 16, height: 16, pointerEvents: 'none' }} />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 500 }}>{unit.unit_name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        {tenant}
                                                        {unit.sqm ? ` · ${unit.sqm} m²` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ===== STEP 2: Cost Types & Distribution Keys ===== */}
                        {wizardStep === 1 && (
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Aufstellung Kosten & Verteilerschlüssel</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                    Umlagefähige Kosten aus Ihren Buchungen ({formatDate(periodStart)} – {formatDate(periodEnd)}) wurden automatisch geladen.
                                </p>

                                {!isMobile ? (
                                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                        <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Kostenart</th>
                                                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Betrag (€)</th>
                                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Verteiler</th>
                                                    <th style={{ textAlign: 'center', padding: '10px 12px', width: '50px' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {costItems.map((item, idx) => (
                                                    <tr key={idx} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <td style={{ padding: '10px 12px', fontWeight: 500, position: 'relative' }}>
                                                            <textarea value={item.category_name}
                                                                rows={1}
                                                                onChange={e => {
                                                                    const updated = [...costItems];
                                                                    updated[idx].category_name = e.target.value;
                                                                    setCostItems(updated);
                                                                }}
                                                                onFocus={e => {
                                                                    e.target.rows = 3;
                                                                    e.target.style.position = 'absolute';
                                                                    e.target.style.zIndex = '20';
                                                                    e.target.style.width = 'calc(100% + 200px)';
                                                                    e.target.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
                                                                    e.target.style.borderColor = 'var(--primary-color)';
                                                                }}
                                                                onBlur={e => {
                                                                    e.target.rows = 1;
                                                                    e.target.style.position = 'static';
                                                                    e.target.style.zIndex = 'auto';
                                                                    e.target.style.width = '100%';
                                                                    e.target.style.boxShadow = 'none';
                                                                    e.target.style.borderColor = 'var(--border-color)';
                                                                }}
                                                                style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 500, fontFamily: 'inherit', fontSize: '0.9rem', resize: 'none', color: 'var(--text-primary)', backgroundColor: 'var(--surface-color)', transition: 'all 0.2s ease', left: 0, top: 0 }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                                                            <CurrencyInput allowDecimals value={item.amount}
                                                                onChange={e => {
                                                                    const updated = [...costItems];
                                                                    updated[idx].amount = e.target.value;
                                                                    setCostItems(updated);
                                                                }}
                                                                style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.85rem' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '10px 8px' }}>
                                                            <select value={item.distribution_key}
                                                                onChange={e => {
                                                                    if (e.target.value === 'NEW_KEY') {
                                                                        setPendingKeyIndex(idx);
                                                                        setNewKeyName('');
                                                                        setNewKeyDescription('');
                                                                        setNewKeyType('custom');
                                                                        setIsCreateKeyModalOpen(true);
                                                                    } else {
                                                                        const updated = [...costItems];
                                                                        updated[idx].distribution_key = e.target.value;
                                                                        setCostItems(updated);
                                                                    }
                                                                }}
                                                                style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '160px', fontSize: '0.8rem' }}
                                                            >
                                                                {distributionKeys.map(k => {
                                                                    const abbr = { area: 'Fläche', persons: 'Pers.', units: 'Einh.', equal: 'Gleich', custom: 'Verbr.' };
                                                                    const short = abbr[k.calculation_type] || k.name;
                                                                    return <option key={k.id} value={k.id}>{short}</option>;
                                                                })}
                                                                {!distributionKeys.some(k => k.id === item.distribution_key) && item.distribution_key && !item.distribution_key.startsWith('temp-') && (
                                                                    <option value={item.distribution_key}>{item.distribution_key}</option>
                                                                )}
                                                                <option disabled>─────</option>
                                                                <option value="NEW_KEY" style={{ fontWeight: 'bold' }}>+ Neu</option>
                                                            </select>
                                                        </td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                            <button onClick={() => setCostItems(costItems.filter((_, i) => i !== idx))}
                                                                style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                                    <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: '1.15rem' }}>Gesamt</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '1.15rem' }}>
                                                        {costItems.reduce((sum, i) => sum + (i.amount || 0), 0).toFixed(2)} €
                                                    </td>
                                                    <td colSpan={2}></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                ) : (
                                    /* ===== MOBILE: Card Layout ===== */
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {costItems.map((item, idx) => (
                                            <div key={idx} style={{
                                                border: '1px solid var(--border-color)', borderRadius: '10px',
                                                padding: '12px', backgroundColor: 'var(--surface-color)',
                                                position: 'relative'
                                            }}>
                                                <button onClick={() => setCostItems(costItems.filter((_, i) => i !== idx))}
                                                    style={{ position: 'absolute', top: '8px', right: '8px', color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                                    <Trash2 size={16} />
                                                </button>
                                                <div style={{ marginBottom: '8px' }}>
                                                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Kostenart</label>
                                                    <input type="text" value={item.category_name}
                                                        onChange={e => {
                                                            const updated = [...costItems];
                                                            updated[idx].category_name = e.target.value;
                                                            setCostItems(updated);
                                                        }}
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)', backgroundColor: 'var(--background-color)', marginTop: '4px' }}
                                                    />
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                    <div>
                                                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Betrag (€)</label>
                                                        <CurrencyInput allowDecimals value={item.amount}
                                                            onChange={e => {
                                                                const updated = [...costItems];
                                                                updated[idx].amount = e.target.value;
                                                                setCostItems(updated);
                                                            }}
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.9rem', marginTop: '4px' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Verteiler</label>
                                                        <select value={item.distribution_key}
                                                            onChange={e => {
                                                                if (e.target.value === 'NEW_KEY') {
                                                                    setPendingKeyIndex(idx);
                                                                    setNewKeyName('');
                                                                    setNewKeyDescription('');
                                                                    setNewKeyType('custom');
                                                                    setIsCreateKeyModalOpen(true);
                                                                } else {
                                                                    const updated = [...costItems];
                                                                    updated[idx].distribution_key = e.target.value;
                                                                    setCostItems(updated);
                                                                }
                                                            }}
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', marginTop: '4px', backgroundColor: 'var(--background-color)' }}
                                                        >
                                                            {distributionKeys.map(k => {
                                                                const abbr = { area: 'Fläche', persons: 'Pers.', units: 'Einh.', equal: 'Gleich', custom: 'Verbr.' };
                                                                const short = abbr[k.calculation_type] || k.name;
                                                                return <option key={k.id} value={k.id}>{short}</option>;
                                                            })}
                                                            {!distributionKeys.some(k => k.id === item.distribution_key) && item.distribution_key && !item.distribution_key.startsWith('temp-') && (
                                                                <option value={item.distribution_key}>{item.distribution_key}</option>
                                                            )}
                                                            <option disabled>─────</option>
                                                            <option value="NEW_KEY" style={{ fontWeight: 'bold' }}>+ Neu</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {/* Mobile Total */}
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '12px 16px', borderTop: '2px solid var(--border-color)',
                                            fontWeight: 700, fontSize: '1.1rem', marginTop: '4px'
                                        }}>
                                            <span>Gesamt</span>
                                            <span>{costItems.reduce((sum, i) => sum + (i.amount || 0), 0).toFixed(2)} €</span>
                                        </div>
                                    </div>
                                )}

                                <Button variant="secondary" size="sm" icon={Plus} style={{ marginTop: '1rem' }} onClick={() => {
                                    const defaultKey = distributionKeys.find(k => k.calculation_type === 'units' || k.calculation_type === 'equal') || distributionKeys[0];
                                    setCostItems([...costItems, {
                                        category_id: '',
                                        category_name: 'Neue Kostenart',
                                        amount: 0,
                                        distribution_key: defaultKey ? defaultKey.id : 'einheit'
                                    }]);
                                }}>
                                    Kostenart hinzufügen
                                </Button>
                            </div>
                        )}

                        {/* ===== STEP 3: Costs per Unit ===== */}
                        {wizardStep === 2 && (() => {
                            const activeUid = step3SelectedUnit || selectedUnitIds[0];
                            const activeUnit = units.find(u => u.id === activeUid);
                            const activeCosts = unitCosts[activeUid] || [];
                            const activeTotal = activeCosts.reduce((sum, c) => sum + (c.amount || 0), 0);
                            const activeTenant = getTenantForUnit(activeUid);
                            const activeLease = leases.find(l => l.unit_id === activeUid && l.status === 'active');

                            return (
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Kosten je Einheit</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                        Wählen Sie eine Einheit aus, um die anteiligen Kosten zu prüfen und zu bearbeiten.
                                    </p>

                                    {/* Unit Selector Tabs */}
                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '4px' }}>
                                        {selectedUnitIds.map(uid => {
                                            const unit = units.find(u => u.id === uid);
                                            if (!unit) return null;
                                            const tenant = getTenantForUnit(uid);
                                            const isActive = uid === activeUid;

                                            // Mobile: shorten tenant names to "Nachname, V."
                                            let displayTenant = tenant;
                                            if (isMobile && tenant) {
                                                const periods = getTenantsForUnitInPeriod(uid, periodStart, periodEnd);
                                                if (periods.length > 0) {
                                                    displayTenant = periods.map(tp => {
                                                        if (!tp.tenant) return 'Leerstand';
                                                        const first = tp.tenant.first_name ? tp.tenant.first_name.charAt(0) + '.' : '';
                                                        return `${tp.tenant.last_name}${first ? ', ' + first : ''}`;
                                                    }).join(' / ');
                                                }
                                            }

                                            return (
                                                <button key={uid}
                                                    onClick={() => setStep3SelectedUnit(uid)}
                                                    style={{
                                                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                                        padding: isMobile ? '8px 12px' : '10px 16px', borderRadius: 'var(--radius-md)',
                                                        border: `2px solid ${isActive ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                                        backgroundColor: isActive ? '#EFF6FF' : 'transparent',
                                                        cursor: 'pointer', transition: 'all 0.2s',
                                                        minWidth: isMobile ? '100px' : '140px',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                    <span style={{ fontWeight: 600, fontSize: isMobile ? '0.8rem' : '0.9rem', color: isActive ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                                        {unit.unit_name}
                                                    </span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                        {displayTenant || 'Leerstand'}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Active Unit Detail */}
                                    {activeUnit && (
                                        <Card>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{activeUnit.unit_name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        {activeTenant || 'Leerstand'}
                                                        {activeUnit.sqm ? ` · ${activeUnit.sqm} m²` : ''}
                                                        {activeLease?.tenant?.occupants ? ` · ${activeLease.tenant.occupants} Person(en)` : ''}
                                                    </div>
                                                </div>
                                            </div>

                                            {!isMobile ? (
                                                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                                    <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Kostenart</th>
                                                                <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Gesamt (€)</th>
                                                                {(() => {
                                                                    const periods = getTenantsForUnitInPeriod(activeUid, periodStart, periodEnd);
                                                                    // If single tenant covering whole period, no need for split, unless requested? 
                                                                    // User said "die beiden mieter sind zusammengefasst". So show split if > 1 period or partial period.
                                                                    // Actually even 1 tenant might have partial period (vacancy).
                                                                    if (periods.length === 0) return <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Leerstand</th>;
                                                                    return periods.map((p, idx) => (
                                                                        <th key={idx} style={{ textAlign: 'right', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                                            {p.tenant ? p.tenant.last_name : 'Leerstand'} ({Math.round(p.ratio * 100)}%)
                                                                        </th>
                                                                    ));
                                                                })()}
                                                                <th style={{ textAlign: 'center', padding: '10px 12px', width: '50px' }}></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {activeCosts.map((c, i) => (
                                                                <tr key={i} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td style={{ padding: '10px 12px', position: 'relative' }}>
                                                                        <textarea value={c.label}
                                                                            rows={1}
                                                                            onChange={e => {
                                                                                const updated = { ...unitCosts };
                                                                                updated[activeUid] = [...(updated[activeUid] || [])];
                                                                                updated[activeUid][i] = { ...updated[activeUid][i], label: e.target.value };
                                                                                setUnitCosts(updated);
                                                                            }}
                                                                            onFocus={e => {
                                                                                e.target.rows = 3;
                                                                                e.target.style.position = 'absolute';
                                                                                e.target.style.zIndex = '20';
                                                                                e.target.style.width = 'calc(100% + 200px)';
                                                                                e.target.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
                                                                                e.target.style.borderColor = 'var(--primary-color)';
                                                                            }}
                                                                            onBlur={e => {
                                                                                e.target.rows = 1;
                                                                                e.target.style.position = 'static';
                                                                                e.target.style.zIndex = 'auto';
                                                                                e.target.style.width = '100%';
                                                                                e.target.style.boxShadow = 'none';
                                                                                e.target.style.borderColor = 'var(--border-color)';
                                                                            }}
                                                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 500, fontFamily: 'inherit', fontSize: '0.9rem', resize: 'none', color: 'var(--text-primary)', backgroundColor: 'var(--surface-color)', transition: 'all 0.2s ease', left: 0, top: 0 }}
                                                                        />
                                                                    </td>
                                                                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                                                        <CurrencyInput allowDecimals value={c.amount}
                                                                            onChange={e => {
                                                                                const updated = { ...unitCosts };
                                                                                updated[activeUid] = [...(updated[activeUid] || [])];
                                                                                updated[activeUid][i] = { ...updated[activeUid][i], amount: e.target.value };
                                                                                setUnitCosts(updated);
                                                                            }}
                                                                            style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'right' }}
                                                                        />
                                                                    </td>
                                                                    {(() => {
                                                                        const periods = getTenantsForUnitInPeriod(activeUid, periodStart, periodEnd);
                                                                        if (periods.length === 0) {
                                                                            // Full vacancy
                                                                            const sourceItem = costItems.find(ci => ci.category_name === c.label);
                                                                            const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                                                                            const val = (key === 'personenanzahl') ? 0 : c.amount;
                                                                            return <td style={{ padding: '10px 12px', textAlign: 'right', color: '#666' }}>{val.toFixed(2)} €</td>;
                                                                        }
                                                                        return periods.map((p, idx) => {
                                                                            const sourceItem = costItems.find(ci => ci.category_name === c.label);
                                                                            const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                                                                            let factor = p.ratio;
                                                                            const occ = p.tenant ? (p.tenant.occupants || 1) : 0;
                                                                            if (key === 'personenanzahl' && occ === 0) factor = 0;

                                                                            return (
                                                                                <td key={idx} style={{ padding: '10px 12px', textAlign: 'right', color: '#666', fontSize: '0.9em' }}>
                                                                                    {((c.amount || 0) * factor).toFixed(2)} €
                                                                                </td>
                                                                            );
                                                                        });
                                                                    })()}
                                                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                                        <button onClick={() => {
                                                                            const updated = { ...unitCosts };
                                                                            updated[activeUid] = updated[activeUid].filter((_, idx) => idx !== i);
                                                                            setUnitCosts(updated);
                                                                        }} style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot>
                                                            <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                                                <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: '1.15rem' }}>Gesamt</td>
                                                                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '1.15rem' }}>
                                                                    {activeTotal.toFixed(2)} €
                                                                </td>
                                                                {(() => {
                                                                    const periods = getTenantsForUnitInPeriod(activeUid, periodStart, periodEnd);
                                                                    if (periods.length === 0) return <td style={{ padding: '10px 12px', textAlign: 'right', color: '#666' }}>{activeTotal.toFixed(2)} €</td>;
                                                                    return periods.map((p, idx) => {
                                                                        // Calculate correct total for this period by summing adjusted item costs
                                                                        const periodTotal = activeCosts.reduce((sum, c) => {
                                                                            const sourceItem = costItems.find(ci => ci.category_name === c.label);
                                                                            const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                                                                            let factor = p.ratio;
                                                                            const occ = p.tenant ? (p.tenant.occupants || 1) : 0;
                                                                            if (key === 'personenanzahl' && occ === 0) factor = 0;
                                                                            return sum + (c.amount || 0) * factor;
                                                                        }, 0);

                                                                        return (
                                                                            <td key={idx} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: '0.9em', color: '#666' }}>
                                                                                {periodTotal.toFixed(2)} €
                                                                            </td>
                                                                        );
                                                                    });
                                                                })()}
                                                                <td></td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            ) : (
                                                /* ===== MOBILE: Card Layout for Step 3 ===== */
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                    {activeCosts.map((c, i) => {
                                                        const periods = getTenantsForUnitInPeriod(activeUid, periodStart, periodEnd);
                                                        return (
                                                            <div key={i} style={{
                                                                border: '1px solid var(--border-color)', borderRadius: '10px',
                                                                padding: '12px', backgroundColor: 'var(--surface-color)',
                                                                position: 'relative'
                                                            }}>
                                                                <button onClick={() => {
                                                                    const updated = { ...unitCosts };
                                                                    updated[activeUid] = updated[activeUid].filter((_, idx) => idx !== i);
                                                                    setUnitCosts(updated);
                                                                }} style={{ position: 'absolute', top: '8px', right: '8px', color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                                                    <Trash2 size={16} />
                                                                </button>
                                                                <div style={{ marginBottom: '8px' }}>
                                                                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Kostenart</label>
                                                                    <input type="text" value={c.label}
                                                                        onChange={e => {
                                                                            const updated = { ...unitCosts };
                                                                            updated[activeUid] = [...(updated[activeUid] || [])];
                                                                            updated[activeUid][i] = { ...updated[activeUid][i], label: e.target.value };
                                                                            setUnitCosts(updated);
                                                                        }}
                                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-primary)', backgroundColor: 'var(--background-color)', marginTop: '4px' }}
                                                                    />
                                                                </div>
                                                                <div style={{ marginBottom: periods.length > 0 ? '8px' : 0 }}>
                                                                    <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Gesamt (€)</label>
                                                                    <CurrencyInput allowDecimals value={c.amount}
                                                                        onChange={e => {
                                                                            const updated = { ...unitCosts };
                                                                            updated[activeUid] = [...(updated[activeUid] || [])];
                                                                            updated[activeUid][i] = { ...updated[activeUid][i], amount: e.target.value };
                                                                            setUnitCosts(updated);
                                                                        }}
                                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'right', fontSize: '0.9rem', marginTop: '4px' }}
                                                                    />
                                                                </div>
                                                                {periods.length > 0 && (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                        {periods.map((p, idx) => {
                                                                            const sourceItem = costItems.find(ci => ci.category_name === c.label);
                                                                            const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                                                                            let factor = p.ratio;
                                                                            const occ = p.tenant ? (p.tenant.occupants || 1) : 0;
                                                                            if (key === 'personenanzahl' && occ === 0) factor = 0;
                                                                            return (
                                                                                <div key={idx} style={{
                                                                                    padding: '6px 10px', borderRadius: '6px',
                                                                                    backgroundColor: 'var(--background-color)', fontSize: '0.8rem', color: 'var(--text-secondary)',
                                                                                    display: 'flex', justifyContent: 'space-between'
                                                                                }}>
                                                                                    <span>{p.tenant ? p.tenant.last_name : 'Leerstand'} ({Math.round(p.ratio * 100)}%)</span>
                                                                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{((c.amount || 0) * factor).toFixed(2)} €</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                    <div style={{
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        padding: '12px 16px', borderTop: '2px solid var(--border-color)',
                                                        fontWeight: 700, fontSize: '1.1rem', marginTop: '4px'
                                                    }}>
                                                        <span>Gesamt</span>
                                                        <span>{activeTotal.toFixed(2)} €</span>
                                                    </div>
                                                </div>
                                            )}
                                            <Button variant="secondary" size="sm" icon={Plus} style={{ marginTop: '1rem' }} onClick={() => {
                                                const updated = { ...unitCosts };
                                                if (!updated[activeUid]) updated[activeUid] = [];
                                                updated[activeUid] = [...updated[activeUid], { label: 'Neue Kostenart', amount: 0, isCustom: true }];
                                                setUnitCosts(updated);
                                            }}>
                                                Kostenart hinzufügen
                                            </Button>
                                        </Card>
                                    )}
                                </div>
                            );
                        })()}

                        {/* ===== STEP 4: Review ===== */}
                        {wizardStep === 3 && (
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Prüfen & Abschließen</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                    Klicken Sie auf eine Einheit, um die individuelle Abrechnung zu prüfen und zu bearbeiten.
                                </p>

                                <div style={{ display: 'grid', gap: '8px' }}>
                                    {selectedUnitIds.map(uid => {
                                        const unit = units.find(u => u.id === uid);
                                        if (!unit) return null;
                                        const costs = unitCosts[uid] || [];

                                        // Calculate Settlement Total & Prepayment using periods
                                        const pStart = new Date(periodStart);
                                        const pEnd = new Date(periodEnd);
                                        const settlementMonths = Math.max(1, (pEnd.getFullYear() - pStart.getFullYear()) * 12 + (pEnd.getMonth() - pStart.getMonth()) + 1);

                                        const periods = getTenantsForUnitInPeriod(uid, periodStart, periodEnd);

                                        if (periods.length === 0) {
                                            return (
                                                <div key={uid}
                                                    style={{
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        padding: '14px 16px', borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--border-color)', cursor: 'default', opacity: 0.6,
                                                        backgroundColor: '#f9fafb'
                                                    }}>
                                                    <div>
                                                        <div style={{ fontWeight: 600 }}>{unit.unit_name}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Leerstand</div>
                                                    </div>
                                                    <div style={{ textAlign: 'right', fontSize: '0.85rem', fontStyle: 'italic', color: '#666' }}>
                                                        Keine Abrechnung
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const displayPeriods = periods.map(p => ({
                                            ...p,
                                            occupants: p.tenant?.occupants || 1,
                                            sqm: unit.sqm || 1
                                        }));

                                        let total = 0;
                                        let totalPrepayment = 0;

                                        displayPeriods.forEach(page => {
                                            // 1. Calculate Period Share of Costs
                                            const periodShare = costs.reduce((sum, item) => {
                                                const sourceItem = costItems.find(ci => ci.category_name === item.label);
                                                const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                                                let factor = page.ratio;
                                                if (key === 'personenanzahl' && (page.occupants || 0) === 0) factor = 0;
                                                return sum + (item.amount || 0) * factor;
                                            }, 0);
                                            total += periodShare;

                                            // 2. Calculate Prepayment for Period
                                            const monthlySvc = page.lease ? (parseFloat(page.lease.service_charge) || 0) : 0;
                                            const monthlyHeat = page.lease ? (parseFloat(page.lease.heating_cost) || 0) : 0;
                                            const monthlyPrepay = monthlySvc + monthlyHeat;
                                            const periodPrepay = monthlyPrepay * settlementMonths * page.ratio;
                                            totalPrepayment += periodPrepay;
                                        });

                                        const tenant = getTenantForUnit(uid);
                                        const result = total - totalPrepayment;

                                        // Mobile: shorten tenant name
                                        let displayTenant = tenant;
                                        if (isMobile && tenant) {
                                            const pds = getTenantsForUnitInPeriod(uid, periodStart, periodEnd);
                                            if (pds.length > 0) {
                                                displayTenant = pds.map(tp => {
                                                    if (!tp.tenant) return 'Leerstand';
                                                    const fi = tp.tenant.first_name ? tp.tenant.first_name.charAt(0) + '.' : '';
                                                    return `${tp.tenant.last_name}${fi ? ', ' + fi : ''}`;
                                                }).join(' / ');
                                            }
                                        }

                                        return (
                                            <div key={uid}
                                                onClick={() => setReviewUnit(uid)}
                                                style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: isMobile ? '10px 12px' : '14px 16px', borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--border-color)', cursor: 'pointer',
                                                    transition: 'all 0.2s', backgroundColor: reviewUnit === uid ? '#EFF6FF' : 'transparent'
                                                }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: isMobile ? '0.85rem' : undefined }}>{unit.unit_name}</div>
                                                    <div style={{ fontSize: isMobile ? '0.7rem' : '0.8rem', color: 'var(--text-secondary)' }}>{displayTenant || 'Leerstand'}</div>
                                                </div>
                                                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <div style={{ fontWeight: 700, fontSize: isMobile ? '0.85rem' : undefined }}>{total.toFixed(2)} €</div>
                                                    <div style={{
                                                        fontSize: isMobile ? '0.7rem' : '0.8rem', fontWeight: 500,
                                                        color: result > 0 ? 'var(--danger-color)' : 'var(--success-color)'
                                                    }}>
                                                        {result > 0 ? 'Nachzahlung' : 'Guthaben'}: {Math.abs(result).toFixed(2)} €
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Unit Detail Modal */}
                                {reviewUnit && (() => {
                                    const unit = units.find(u => u.id === reviewUnit);
                                    const allPropertyUnits = wizardPropertyId?.startsWith('we_')
                                        ? units.filter(u => u.property?.economic_unit_id === wizardPropertyId.replace('we_', ''))
                                        : units.filter(u => u.property_id === wizardPropertyId);

                                    // Totals for distribution keys
                                    const totalArea = allPropertyUnits.reduce((s, u) => s + (u.sqm || 1), 0);
                                    const totalUnitCount = allPropertyUnits.length;
                                    const totalPersons = allPropertyUnits.reduce((s, u) => {
                                        const l = leases.find(l => l.unit_id === u.id && l.status === 'active');
                                        return s + (l?.tenant?.occupants || 1);
                                    }, 0);

                                    const keyLabels = { wohnflaeche: 'Wohnfläche', personenanzahl: 'Personen', einheit: 'Einheit', anteil: 'Anteil' };
                                    const unitCostsList = unitCosts[reviewUnit] || [];

                                    // Calculate periods
                                    const periods = getTenantsForUnitInPeriod(reviewUnit, periodStart, periodEnd);
                                    let displayPeriods = [];
                                    if (periods.length === 0) {
                                        displayPeriods.push({
                                            tenantName: 'Leerstand',
                                            effectiveStart: periodStart,
                                            effectiveEnd: periodEnd,
                                            ratio: 1,
                                            lease: null,
                                            occupants: 0,
                                            sqm: unit.sqm || 1
                                        });
                                    } else {
                                        displayPeriods = periods.map(p => ({
                                            ...p,
                                            occupants: p.tenant?.occupants || 1,
                                            sqm: unit.sqm || 1
                                        }));
                                    }

                                    // Initial calculations for settlement duration
                                    const pStart = new Date(periodStart);
                                    const pEnd = new Date(periodEnd);
                                    const settlementMonths = Math.max(1, (pEnd.getFullYear() - pStart.getFullYear()) * 12 + (pEnd.getMonth() - pStart.getMonth()) + 1);

                                    return (
                                        <Modal isOpen={true} onClose={() => setReviewUnit(null)}
                                            title={`Abrechnungsdetails: ${unit?.unit_name}`} maxWidth="900px"
                                            footer={
                                                <>
                                                    <Button variant="secondary" onClick={() => setReviewUnit(null)}>Schließen</Button>
                                                </>
                                            }>
                                            <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '4px' }}>
                                                {displayPeriods.map((page, idx) => {
                                                    const tenantTotal = unitCostsList.reduce((sum, item) => {
                                                        const sourceItem = costItems.find(ci => ci.category_name === item.label);
                                                        const key = sourceItem ? sourceItem.distribution_key : 'anteil';
                                                        let factor = page.ratio;
                                                        if (key === 'personenanzahl' && (page.occupants || 0) === 0) factor = 0;
                                                        return sum + (item.amount || 0) * factor;
                                                    }, 0);

                                                    const monthlySvc = page.lease ? (parseFloat(page.lease.service_charge) || 0) : 0;
                                                    const monthlyHeat = page.lease ? (parseFloat(page.lease.heating_cost) || 0) : 0;
                                                    const monthlyPrepay = monthlySvc + monthlyHeat;

                                                    const tenantPrepay = monthlyPrepay * settlementMonths * page.ratio;
                                                    const balance = tenantTotal - tenantPrepay;

                                                    return (
                                                        <div key={idx} style={{ marginBottom: '2rem', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                                            <div style={{ backgroundColor: 'var(--background-color)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                                                                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{page.tenantName}</div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                    {formatDate(page.effectiveStart)} – {formatDate(page.effectiveEnd)} ({Math.round(page.ratio * 100)}%)
                                                                </div>
                                                            </div>

                                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'fixed', display: 'table', minWidth: '600px' }}>
                                                                <thead style={{ backgroundColor: 'var(--background-color)', display: 'table-header-group' }}>
                                                                    <tr style={{ display: 'table-row' }}>
                                                                        <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600, width: '22%' }}>Kostenart</th>
                                                                        <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600, width: '14%' }}>Schlüssel</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Gesamt</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Einheiten</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Ko./Einh.</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '12%' }}>Ihre Einh.</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, width: '16%' }}>Anteil</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody style={{ display: 'table-row-group' }}>
                                                                    {unitCostsList.map((item, i) => {
                                                                        const sourceItem = costItems.find(ci => ci.category_name === item.label);
                                                                        const totalCost = sourceItem ? sourceItem.amount : 0;
                                                                        const key = sourceItem ? sourceItem.distribution_key : 'anteil';

                                                                        // Resolve key: check distributionKeys first, then legacy strings
                                                                        const dkObj = distributionKeys.find(k => k.id === key);
                                                                        const resolvedType = dkObj ? dkObj.calculation_type : (key === 'wohnflaeche' ? 'area' : key === 'personenanzahl' ? 'persons' : key === 'einheit' ? 'units' : key === 'anteil' ? 'equal' : 'area');

                                                                        let totalUnits = 0;
                                                                        let myUnits = 0;
                                                                        let unitLabel = '';

                                                                        if (resolvedType === 'area') {
                                                                            totalUnits = totalArea;
                                                                            myUnits = page.sqm;
                                                                            unitLabel = 'm²';
                                                                        } else if (resolvedType === 'persons') {
                                                                            totalUnits = totalPersons;
                                                                            myUnits = page.occupants;
                                                                            unitLabel = 'P.';
                                                                        } else {
                                                                            totalUnits = totalUnitCount;
                                                                            myUnits = 1;
                                                                            unitLabel = 'Einh.';
                                                                        }

                                                                        const costPerUnit = totalUnits > 0 ? totalCost / totalUnits : 0;
                                                                        let factor = page.ratio;
                                                                        if (resolvedType === 'persons' && page.occupants === 0) {
                                                                            factor = 0;
                                                                        }
                                                                        const itemShare = (item.amount || 0) * factor;

                                                                        return (
                                                                            <tr key={i} className="table-row" style={{ borderBottom: '1px solid var(--border-color)', display: 'table-row' }}>
                                                                                <td style={{ padding: '8px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        document.querySelectorAll('.cell-popup').forEach(el => el.remove());
                                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                                        const popup = document.createElement('span');
                                                                                        popup.className = 'cell-popup';
                                                                                        popup.textContent = item.label;
                                                                                        Object.assign(popup.style, {
                                                                                            position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', zIndex: '9999',
                                                                                            background: 'var(--surface-color, #fff)', padding: '8px 10px',
                                                                                            borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                                                                                            border: '1px solid var(--border-color)', whiteSpace: 'normal',
                                                                                            maxWidth: '250px', fontSize: '0.85rem', color: 'var(--text-primary)'
                                                                                        });
                                                                                        document.body.appendChild(popup);
                                                                                        const close = () => { popup.remove(); document.removeEventListener('click', close); };
                                                                                        setTimeout(() => document.addEventListener('click', close), 0);
                                                                                    }}>{item.label}</td>
                                                                                <td style={{ padding: '8px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        document.querySelectorAll('.cell-popup').forEach(el => el.remove());
                                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                                        const keyName = (() => { const dk = distributionKeys.find(k => k.id === key); return dk ? dk.name : (keyLabels[key] || key); })();
                                                                                        const popup = document.createElement('span');
                                                                                        popup.className = 'cell-popup';
                                                                                        popup.textContent = keyName;
                                                                                        Object.assign(popup.style, {
                                                                                            position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', zIndex: '9999',
                                                                                            background: 'var(--surface-color, #fff)', padding: '8px 10px',
                                                                                            borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                                                                                            border: '1px solid var(--border-color)', whiteSpace: 'normal',
                                                                                            maxWidth: '250px', fontSize: '0.85rem', color: 'var(--text-primary)'
                                                                                        });
                                                                                        document.body.appendChild(popup);
                                                                                        const close = () => { popup.remove(); document.removeEventListener('click', close); };
                                                                                        setTimeout(() => document.addEventListener('click', close), 0);
                                                                                    }}>{(() => {
                                                                                        const dk = distributionKeys.find(k => k.id === key);
                                                                                        return dk ? dk.name : (keyLabels[key] || key);
                                                                                    })()}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{totalCost > 0 ? totalCost.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €' : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{totalUnits > 0 ? totalUnits.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' ' + unitLabel : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{costPerUnit > 0 ? costPerUnit.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €' : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{myUnits > 0 ? myUnits.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' ' + unitLabel : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{itemShare.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                                <tfoot style={{ backgroundColor: 'var(--background-color)', fontWeight: 600, display: 'table-footer-group' }}>
                                                                    <tr style={{ display: 'table-row' }}>
                                                                        <td colSpan={6} style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Gesamtsumme (zeitanteilig)</td>
                                                                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{tenantTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</td>
                                                                    </tr>
                                                                    <tr style={{ display: 'table-row' }}>
                                                                        <td colSpan={6} style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Vorauszahlungen (zeitanteilig)</td>
                                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>- {tenantPrepay.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</td>
                                                                    </tr>
                                                                    <tr style={{ borderTop: '2px solid var(--border-color)', display: 'table-row' }}>
                                                                        <td colSpan={6} style={{ padding: '10px 12px', color: balance > 0 ? 'var(--danger-color)' : 'var(--success-color)', whiteSpace: 'nowrap' }}>
                                                                            {balance > 0 ? 'Nachzahlung' : 'Guthaben'}
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: balance > 0 ? 'var(--danger-color)' : 'var(--success-color)', whiteSpace: 'nowrap' }}>
                                                                            {Math.abs(balance).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                                                                        </td>
                                                                    </tr>
                                                                </tfoot>
                                                            </table>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </Modal>
                                    );
                                })()}
                            </div>
                        )}

                        {/* ===== WIZARD FOOTER ===== */}
                        {isMobile ? (
                            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                                <div style={{ marginBottom: '8px' }}>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={ArrowLeft} onClick={goBack} style={{ width: '100%' }}>Zurück</Button>
                                    )}
                                    {wizardStep === 0 && (
                                        <Button variant="secondary" onClick={() => setWizardOpen(false)} style={{ width: '100%' }}>Abbrechen</Button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={Save} onClick={() => saveSettlement('draft')} style={{ flex: 1 }}>Entwurf</Button>
                                    )}
                                    {wizardStep < 3 ? (
                                        <Button icon={ArrowRight} onClick={goNext} style={{ flex: 1 }}>Weiter</Button>
                                    ) : (
                                        <Button icon={Check} onClick={() => saveSettlement('done')} style={{ flex: 1, backgroundColor: 'var(--success-color)' }}>
                                            Fertigstellen
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)'
                            }}>
                                <div>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={ArrowLeft} onClick={goBack}>Zurück</Button>
                                    )}
                                    {wizardStep === 0 && (
                                        <Button variant="secondary" onClick={() => setWizardOpen(false)}>Abbrechen</Button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    {wizardStep > 0 && (
                                        <Button variant="secondary" icon={Save} onClick={() => saveSettlement('draft')}>Entwurf speichern</Button>
                                    )}
                                    {wizardStep < 3 ? (
                                        <Button icon={ArrowRight} onClick={goNext}>Weiter</Button>
                                    ) : (
                                        <Button icon={Check} onClick={() => saveSettlement('done')} style={{ backgroundColor: 'var(--success-color)' }}>
                                            Abrechnung fertigstellen
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </Card>
                </div>

                {/* Create Key Modal - MUST be inside wizard return block to render during wizard */}
                <Modal
                    isOpen={isCreateKeyModalOpen}
                    onClose={() => setIsCreateKeyModalOpen(false)}
                    title="Neuen Verteilerschlüssel erstellen"
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setIsCreateKeyModalOpen(false)}>Abbrechen</Button>
                            <Button onClick={() => handleCreateNewKey(true)}>Speichern</Button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Dieser Schlüssel wird in den Einstellungen gespeichert und steht für zukünftige Abrechnungen zur Verfügung.
                        </p>
                        <Input
                            label="Bezeichnung"
                            value={newKeyName}
                            onChange={e => setNewKeyName(e.target.value)}
                            placeholder="z.B. Sonderumlage Garten"
                        />
                        <Input
                            label="Beschreibung (optional)"
                            value={newKeyDescription}
                            onChange={e => setNewKeyDescription(e.target.value)}
                            placeholder="Kurze Beschreibung des Schlüssels"
                        />
                    </div>
                </Modal>
            </>
        );
    }

    // ===== LIST VIEW =====
    const settlementsByGroup = {};
    groupedProperties.forEach(group => {
        if (group.isGroup) {
            settlementsByGroup[group.id] = settlements.filter(s => s.economic_unit_id === group.economic_unit_id);
        } else {
            settlementsByGroup[group.id] = settlements.filter(s => s.property_id === group.id && !s.economic_unit_id);
        }
    });

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Nebenkostenabrechnung</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Erstellen und verwalten Sie Ihre Betriebskostenabrechnungen</p>
                </div>
            </div>

            {groupedProperties.length === 0 ? (
                <Card>
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Immobilien gefunden. Erstellen Sie zunächst eine Immobilie.
                    </div>
                </Card>
            ) : (
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    {groupedProperties.map(prop => {
                        const propSettlements = settlementsByGroup[prop.id] || [];
                        const propUnits = prop.isGroup ? units.filter(u => u.property?.economic_unit_id === prop.economic_unit_id) : units.filter(u => u.property_id === prop.id);
                        const isExpanded = expandedProperty === prop.id;

                        return (
                            <Card key={prop.id}>
                                <div
                                    onClick={() => setExpandedProperty(isExpanded ? null : prop.id)}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        cursor: 'pointer', padding: '4px 0', flexWrap: 'wrap', gap: '10px'
                                    }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '1.05rem', color: prop.isGroup ? 'var(--accent-color)' : 'var(--text-primary)' }}>{prop.street} {prop.house_number}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                {prop.zip} {prop.city} · {propUnits.length} Einheiten
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{propSettlements.length} Abrechnung(en)</span>
                                        <Button size="sm" icon={Plus} onClick={(e) => { e.stopPropagation(); startNewSettlement(prop.id); }}>
                                            Neue Abrechnung
                                        </Button>
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', overflow: 'visible' }}>
                                        {propSettlements.length === 0 ? (
                                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                                Noch keine Abrechnungen für dieses Objekt.
                                            </div>
                                        ) : (
                                            <>
                                                <div className="hidden-mobile">
                                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Abrechnungsjahr</th>
                                                                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Zeitraum</th>
                                                                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Erstellt am</th>
                                                                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Status</th>
                                                                <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Aktionen</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {propSettlements.map(s => (
                                                                <tr key={s.id} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{s.year || new Date(s.period_start).getFullYear()}</td>
                                                                    <td style={{ padding: '10px 12px', fontSize: '0.85rem' }}>
                                                                        {formatDate(s.period_start)} – {formatDate(s.period_end)}
                                                                    </td>
                                                                    <td style={{ padding: '10px 12px', fontSize: '0.85rem' }}>
                                                                        {formatDate(s.created_at)}
                                                                    </td>
                                                                    <td style={{ padding: '10px 12px' }}>
                                                                        <StatusBadge status={s.status} />
                                                                    </td>
                                                                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                                                        <div style={{ position: 'relative', display: 'inline-block' }}>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (openSettlementMenuId === s.id) {
                                                                                        setOpenSettlementMenuId(null);
                                                                                    } else {
                                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                                        setSettlementMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                                                                                        setOpenSettlementMenuId(s.id);
                                                                                    }
                                                                                }}
                                                                                style={{
                                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                    padding: '6px', border: 'none', background: 'none',
                                                                                    cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                                                                                    color: 'var(--text-secondary)', transition: 'all 0.15s'
                                                                                }}
                                                                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--background-color)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                                                                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                                                            >
                                                                                <MoreVertical size={18} />
                                                                            </button>

                                                                            {openSettlementMenuId === s.id && createPortal(
                                                                                <>
                                                                                    {/* Invisible backdrop to close menu on outside click */}
                                                                                    <div onClick={() => setOpenSettlementMenuId(null)} style={{
                                                                                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998
                                                                                    }} />
                                                                                    <div style={{
                                                                                        position: 'fixed', zIndex: 9999,
                                                                                        top: settlementMenuPos?.top ?? 0,
                                                                                        right: settlementMenuPos?.right ?? 0,
                                                                                        backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                                        borderRadius: 'var(--radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                                                                        minWidth: '220px', maxHeight: '60vh', overflowY: 'auto',
                                                                                        display: 'flex',
                                                                                        flexDirection: 'column', padding: '4px'
                                                                                    }}>
                                                                                        <button onClick={() => { setOpenSettlementMenuId(null); editSettlement(s); }}
                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                                                                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                                            <Edit2 size={14} /> Bearbeiten
                                                                                        </button>
                                                                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                        <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>PDF herunterladen</div>
                                                                                        {(s.data?.selectedUnitIds || []).flatMap(uid => {
                                                                                            const u = units.find(x => x.id === uid);
                                                                                            const periods = getTenantsForUnitInPeriod(uid, s.period_start, s.period_end);
                                                                                            const validPeriods = periods.filter(p => p.tenant);
                                                                                            if (validPeriods.length === 0) return [];

                                                                                            return validPeriods.map((p, pIdx) => ({
                                                                                                key: `${uid}-${pIdx}`,
                                                                                                uid,
                                                                                                unitName: u ? u.unit_name : uid,
                                                                                                tenantId: p.tenant.id,
                                                                                                label: p.tenantName
                                                                                            }));
                                                                                        }).map(item => (
                                                                                            <button key={`dl-${item.key}`} onClick={() => { setOpenSettlementMenuId(null); downloadSettlement(s, item.uid, item.tenantId); }}
                                                                                                style={{ textAlign: 'left', padding: '6px 12px 6px 24px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                                                                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                                                <Download size={12} /> {item.unitName} – {item.label}
                                                                                            </button>
                                                                                        ))}
                                                                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                        <button onClick={() => { setOpenSettlementMenuId(null); deleteSettlement(s.id); }}
                                                                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)', borderRadius: '4px' }}
                                                                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
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
                                                </div>

                                                <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                    {propSettlements.map(s => (
                                                        <div key={s.id} style={{
                                                            border: '1px solid var(--border-color)',
                                                            borderRadius: 'var(--radius-md)',
                                                            padding: 'var(--spacing-md)',
                                                            backgroundColor: 'var(--surface-color)',
                                                            position: 'relative'
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                                <div>
                                                                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{s.year || new Date(s.period_start).getFullYear()}</div>
                                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                                        {formatDate(s.period_start)} – {formatDate(s.period_end)}
                                                                    </div>
                                                                </div>
                                                                <StatusBadge status={s.status} />
                                                            </div>

                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                                                Erstellt: {formatDate(s.created_at)}
                                                            </div>

                                                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                                                <div style={{ position: 'relative', display: 'block', width: '100%' }}>
                                                                    <Button variant="secondary" size="sm" icon={Edit2} onClick={() => editSettlement(s)} style={{ width: '100%', justifyContent: 'center', marginBottom: '8px' }}>
                                                                        Bearbeiten
                                                                    </Button>

                                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                                        <Button variant="ghost" size="sm" icon={FileText} onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setOpenSettlementMenuId(openSettlementMenuId === s.id ? null : s.id);
                                                                        }} style={{ flex: 1 }}>
                                                                            Optionen
                                                                        </Button>
                                                                        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => deleteSettlement(s.id)} style={{ color: 'var(--danger-color)' }} />
                                                                    </div>

                                                                    {/* Mobile Menu Logic - Reusing same structure but positioned differently for mobile if needed, though fixed pos works */}
                                                                    {openSettlementMenuId === s.id && (
                                                                        <div onClick={(e) => e.stopPropagation()} style={{
                                                                            position: 'fixed', zIndex: 9999,
                                                                            top: '50%', left: '50%', transform: 'translate(-50%, -50%)', // Center on mobile
                                                                            backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                                                                            width: '90%', maxWidth: '300px',
                                                                            display: 'flex', flexDirection: 'column', padding: '4px',
                                                                            maxHeight: '80vh', overflowY: 'auto'
                                                                        }}>
                                                                            <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                                <span style={{ fontWeight: 600 }}>Optionen</span>
                                                                                <button onClick={() => setOpenSettlementMenuId(null)} style={{ border: 'none', background: 'none' }}><X size={16} /></button>
                                                                            </div>

                                                                            <button onClick={() => { setOpenSettlementMenuId(null); editSettlement(s); }}
                                                                                style={{ textAlign: 'left', padding: '12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                                                                                <Edit2 size={16} /> Bearbeiten
                                                                            </button>


                                                                            <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, backgroundColor: 'var(--bg-secondary)' }}>PDF herunterladen</div>
                                                                            {(s.data?.selectedUnitIds || []).flatMap(uid => {
                                                                                const u = units.find(x => x.id === uid);
                                                                                const periods = getTenantsForUnitInPeriod(uid, s.period_start, s.period_end);
                                                                                const validPeriods = periods.filter(p => p.tenant);
                                                                                if (validPeriods.length === 0) return [];
                                                                                return validPeriods.map((p, pIdx) => ({
                                                                                    key: `${uid}-${pIdx}`,
                                                                                    uid,
                                                                                    unitName: u ? u.unit_name : uid,
                                                                                    tenantId: p.tenant.id,
                                                                                    label: p.tenantName
                                                                                }));
                                                                            }).map(item => (
                                                                                <button key={`dl-${item.key}`} onClick={() => { setOpenSettlementMenuId(null); downloadSettlement(s, item.uid, item.tenantId); }}
                                                                                    style={{ textAlign: 'left', padding: '10px 12px 10px 24px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid #eee' }}>
                                                                                    <Download size={16} /> {item.unitName} – {item.label}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div >
            )}
            {/* Create Key Modal for Wizard */}
            <Modal
                isOpen={isCreateKeyModalOpen}
                onClose={() => setIsCreateKeyModalOpen(false)}
                title="Neuen Verteilerschlüssel erstellen"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsCreateKeyModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={() => handleCreateNewKey(true)}>Speichern</Button>
                    </>
                }
            >
                <div style={{ display: 'grid', gap: '1rem' }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Dieser Schlüssel wird in den Einstellungen gespeichert und steht für zukünftige Abrechnungen zur Verfügung.
                    </p>
                    <Input
                        label="Bezeichnung"
                        value={newKeyName}
                        onChange={e => setNewKeyName(e.target.value)}
                        placeholder="z.B. Sonderumlage Garten"
                    />
                    <Input
                        label="Beschreibung (optional)"
                        value={newKeyDescription}
                        onChange={e => setNewKeyDescription(e.target.value)}
                        placeholder="Kurze Beschreibung des Schlüssels"
                    />
                    {/* The Basistyp selector is now hidden as per instruction, defaulting to 'custom' */}
                    {/* <div style={{ display: 'none' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Basistyp</label>
                        <select
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                            value={newKeyType}
                            onChange={e => setNewKeyType(e.target.value)}
                        >
                            <option value="area">Wohnfläche</option>
                            <option value="persons">Personenanzahl</option>
                            <option value="units">Wohneinheiten</option>
                            <option value="mea">Miteigentumsanteile</option>
                            <option value="direct">Direktzuordnung</option>
                            <option value="custom">Manuell / Zähler</option>
                        </select>
                    </div> */}
                </div>
            </Modal>
        </div>
    );
};

export default UtilityCosts;
