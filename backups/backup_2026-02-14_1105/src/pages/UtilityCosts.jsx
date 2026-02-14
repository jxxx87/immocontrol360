import React, { useState, useEffect, useMemo } from 'react';
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

const formatDate = (dateStr) => {
    if (!dateStr) return '–';
    const d = new Date(dateStr);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// ========== STEP INDICATOR ==========
const StepIndicator = ({ steps, currentStep }) => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem', padding: '0 1rem' }}>
        {steps.map((step, i) => (
            <React.Fragment key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 600, fontSize: '0.85rem',
                        backgroundColor: i <= currentStep ? 'var(--primary-color)' : '#E5E7EB',
                        color: i <= currentStep ? '#fff' : '#6B7280',
                        transition: 'all 0.3s'
                    }}>
                        {i < currentStep ? <Check size={16} /> : i + 1}
                    </div>
                    <span style={{
                        fontSize: '0.85rem', fontWeight: i === currentStep ? 600 : 400,
                        color: i <= currentStep ? 'var(--text-primary)' : 'var(--text-secondary)',
                        whiteSpace: 'nowrap'
                    }}>{step}</span>
                </div>
                {i < steps.length - 1 && (
                    <div style={{
                        flex: 1, height: 2, margin: '0 12px',
                        backgroundColor: i < currentStep ? 'var(--primary-color)' : '#E5E7EB',
                        transition: 'all 0.3s'
                    }} />
                )}
            </React.Fragment>
        ))}
    </div>
);

// ========== MAIN COMPONENT ==========
const UtilityCosts = () => {
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();

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

    const stepLabels = ['Einheiten auswählen', 'Kosten & Verteilerschlüssel', 'Kosten je Einheit', 'Prüfen & Abschließen'];

    // ===== FETCH DATA =====
    useEffect(() => {
        if (user) fetchData();
    }, [user, selectedPortfolioID]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setOpenSettlementMenuId(null);
        if (openSettlementMenuId) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => document.removeEventListener('click', handleClickOutside);
    }, [openSettlementMenuId]);

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
                allSettlements = allSettlements.filter(s => propIds.includes(s.property_id));
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
    const propertyUnits = useMemo(() =>
        units.filter(u => u.property_id === wizardPropertyId),
        [units, wizardPropertyId]
    );

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
        const propUnits = units.filter(u => u.property_id === propertyId);
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
        setWizardPropertyId(settlement.property_id);
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
        // Filter expenses by property and period, only recoverable
        const periodExpenses = expenses.filter(e =>
            e.property_id === wizardPropertyId &&
            e.booking_date >= periodStart &&
            e.booking_date <= periodEnd &&
            e.expense_categories?.is_recoverable === true
        );

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

            const record = {
                user_id: user.id,
                property_id: wizardPropertyId,
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
        return p ? `${p.street} ${p.house_number}` : 'Unbekannt';
    };

    const getPropertyFull = (propId) => {
        return properties.find(p => p.id === propId);
    };

    // ===== SETTLEMENT HTML GENERATION =====
    const generateSettlementHTML = (settlement, singleUnitId = null, targetTenantId = null) => {
        const prop = getPropertyFull(settlement.property_id);
        const data = settlement.data || {};
        const sUnits = data.selectedUnitIds || [];
        const sCosts = data.unitCosts || {};
        const sCostItems = data.costItems || [];
        const logoUrl = window.location.origin + '/logo.png';

        const propAddress = prop ? `${prop.street} ${prop.house_number}` : '–';
        const propCity = prop ? `${prop.zip} ${prop.city}` : '';

        const unitsToProcess = singleUnitId ? sUnits.filter(id => id === singleUnitId) : sUnits;
        const allPropertyUnits = units.filter(u => u.property_id === settlement.property_id);

        // Totals for distribution keys (calculated from current property state)
        const totalArea = allPropertyUnits.reduce((s, u) => s + (u.sqm || 1), 0);
        const totalUnitCount = allPropertyUnits.length;
        // Helper to get active lease occupants - strictly this should use settlement period but approximation from current state/leases is standard fallback
        const getOccHelper = (u) => {
            const l = leases.find(l => l.unit_id === u.id && l.status === 'active');
            return l?.tenant?.occupants || 1;
        };
        const totalPersons = allPropertyUnits.reduce((s, u) => s + getOccHelper(u), 0);

        // Calculate settlement duration in months
        const pStart = new Date(settlement.period_start);
        const pEnd = new Date(settlement.period_end);
        // Approx months (inclusive)
        const settlementMonths = Math.max(1, (pEnd.getFullYear() - pStart.getFullYear()) * 12 + (pEnd.getMonth() - pStart.getMonth()) + 1);
        const fmt = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const keyLabels = { wohnflaeche: 'Wohnfläche', personenanzahl: 'Personen', einheit: 'Einheit', anteil: 'Anteil' };

        // 1. Collect all "pages" (tenant periods) to render
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
                        // Recalculate occupants for this specific lease
                        occupants: p.tenant?.occupants || 1,
                        sqm: unit.sqm || 1
                    });
                });
            }
        });

        let pagesHTML = '';
        allPages.forEach((page, idx) => {
            const unitCostsList = sCosts[page.unitId] || [];

            // Calculate Costs & Prepayment
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

            // Prepayment for the effective period
            // Logic: Monthly Prepayment * Settlement Months * Ratio (Effective Duration Fraction)
            const tenantPrepay = monthlyPrepay * settlementMonths * page.ratio;
            const tenantSvcPrepay = monthlySvc * settlementMonths * page.ratio;
            const tenantHeatPrepay = monthlyHeat * settlementMonths * page.ratio;

            const balance = tenantTotal - tenantPrepay;

            // Generate Page 1
            pagesHTML += `
            <div style="page-break-before:${idx > 0 ? 'always' : 'auto'};min-height:250mm;position:relative;background:#fff">
                <div style="text-align:right;margin-bottom:25px"><img src="${logoUrl}" style="height:135px" alt="Logo" /></div>
                <div style="margin-bottom:16px">
                    <div style="font-size:8px;color:#aaa;border-bottom:1px solid #ddd;display:inline-block;padding-bottom:1px;margin-bottom:3px">${(() => { const pf = portfolios.find(p => p.id === prop?.portfolio_id); return pf?.name || ''; })()}, ${propAddress}, ${propCity}</div>
                    <div style="font-size:11px;line-height:1.5">${page.tenantName}<br>${propAddress}<br>${propCity}</div>
                </div>
                <div style="text-align:right;font-size:11px;margin:10px 0">${formatDate(settlement.created_at)}</div>
                <h2 style="font-size:15px;font-weight:700;margin:0 0 10px">Ihre Betriebskostenabrechnung</h2>
                <div style="border:1px solid #0ea5e9;border-radius:3px;padding:10px 12px;margin-bottom:18px;position:relative">
                    <div style="position:absolute;top:-8px;left:8px;background:#fff;padding:0 5px;font-weight:600;color:#0ea5e9;font-size:11px">Ihre Daten</div>
                    <table style="width:100%;font-size:10px;margin-top:2px">
                        <tr>
                            <td style="width:40%;padding:1px 0"><span style="color:#aaa;font-size:9px">Adresse</span><br><b>${propAddress}<br>${propCity}</b></td>
                            <td style="width:30%;padding:1px 0"><span style="color:#aaa;font-size:9px">Lage</span><br><b>${page.unitName}</b></td>
                            <td style="width:30%;padding:1px 0"><span style="color:#aaa;font-size:9px">Abrechnungszeitraum</span><br><b style="color:#0ea5e9">${formatDate(settlement.period_start)} - ${formatDate(settlement.period_end)}</b></td>
                        </tr>
                        <tr>
                            <td style="padding:5px 0 1px"><span style="color:#aaa;font-size:9px">Erstellungsdatum</span><br><b>${formatDate(settlement.created_at)}</b></td>
                            <td style="padding:5px 0 1px"><span style="color:#aaa;font-size:9px">Ihre Personen</span><br><b>${page.occupants}</b></td>
                            <td style="padding:5px 0 1px"><span style="color:#aaa;font-size:9px">Ihre Wohneinheiten</span><br><b>1</b></td>
                        </tr>
                        <tr><td style="padding:5px 0 1px" colspan="3"><span style="color:#aaa;font-size:9px">Ihr Nutzungszeitraum:</span><br><b>${page.periodText}</b></td></tr>
                    </table>
                </div>
                <h3 style="font-size:13px;font-weight:700;margin:0 0 8px">1. Aufstellung der Gesamtkosten</h3>
                <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td></td><td style="text-align:right;font-weight:600;font-style:italic;padding:2px 0">Brutto</td></tr>
                    <tr style="border-top:2px solid #1f2937"><td style="padding:5px 0">Ihre Gesamtkosten</td><td style="padding:5px 0;text-align:right;font-weight:700">${fmt(tenantTotal)} €</td></tr>
                    <tr style="border-top:1px solid #e5e7eb"><td style="padding:4px 0;color:#555">Ihre Betriebskosten-Vorauszahlung</td><td style="padding:4px 0;text-align:right">${fmt(tenantSvcPrepay)} €</td></tr>
                    <tr><td style="padding:4px 0;color:#555">Ihre Heizkosten-Vorauszahlung</td><td style="padding:4px 0;text-align:right">${fmt(tenantHeatPrepay)} €</td></tr>
                    <tr style="border-top:2px solid #1f2937">
                        <td style="padding:6px 0;font-weight:700;font-size:12px">${balance > 0 ? '➡' : '⬅'} <b style="color:${balance > 0 ? '#dc2626' : '#16a34a'}">Ihre ${balance > 0 ? 'Nachzahlung' : 'Gutschrift'}</b></td>
                        <td style="padding:6px 0;text-align:right;font-weight:700;font-size:12px;color:${balance > 0 ? '#dc2626' : '#16a34a'}">${fmt(Math.abs(balance))} €</td>
                    </tr>
                </table>
                <div style="margin-top:14px;font-size:10px;color:#555;line-height:1.4">Die Aufteilung der Gesamtkosten können Sie den nächsten Seiten entnehmen. ${balance > 0 ? 'Nachzahlungen bitten wir umgehend zu überweisen.' : 'Das Guthaben wird Ihnen umgehend erstattet.'}</div>
                <div style="margin-top:10px;font-size:10px">Mit freundlichen Grüßen</div>
                <div style="position:absolute;bottom:-12mm;left:0;font-size:8px;color:#e6a817;letter-spacing:2px;font-weight:600">SEITE ${idx * 2 + 1} / ${allPages.length * 2}</div>
            </div>
            <div style="page-break-before:always;min-height:250mm;position:relative;background:#fff;padding-top:35px">
                <h3 style="font-size:11px;font-weight:700;margin:0 0 8px">Aufteilung der Gesamtkosten für Ihr Mietobjekt (${page.periodText})</h3>
                <table style="width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed">
                    <colgroup><col style="width:19%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:12%"><col style="width:17%"></colgroup>
                    <thead><tr style="border-bottom:2px solid #1f2937">
                        <th style="text-align:left;padding:3px 2px;font-weight:700;font-size:7.5px">Kostenart</th>
                        <th style="text-align:left;padding:3px 2px;font-weight:700;font-size:7.5px">Verteiler-<br>schlüssel</th>
                        <th style="text-align:right;padding:3px 2px;font-weight:700;font-size:7.5px">Gesamt-<br>kosten</th>
                        <th style="text-align:right;padding:3px 2px;font-weight:700;font-size:7.5px">Gesamt-<br>einheiten</th>
                        <th style="text-align:right;padding:3px 2px;font-weight:700;font-size:7.5px">Kosten /<br>Einheit</th>
                        <th style="text-align:right;padding:3px 2px;font-weight:700;font-size:7.5px">Ihre<br>Einheiten</th>
                        <th style="text-align:right;padding:3px 2px;font-weight:700;font-size:7.5px">Ihr Kostenanteil<br>(zeitanteilig)</th>
                    </tr></thead>
                    <tbody>
                    ${unitCostsList.map(item => {
                // Find matching total cost item
                const sourceItem = sCostItems.find(i => i.category_name === item.label);
                const totalCost = sourceItem ? sourceItem.amount : 0;
                const key = sourceItem ? sourceItem.distribution_key : 'anteil';

                let totalUnits = 0;
                let myUnits = 0;
                let unitLabel = '';

                if (key === 'wohnflaeche') {
                    totalUnits = totalArea;
                    myUnits = page.sqm;
                    unitLabel = 'm²';
                } else if (key === 'personenanzahl') {
                    totalUnits = totalPersons;
                    myUnits = page.occupants;
                    unitLabel = 'P.';
                } else {
                    // Default or 'einheit'
                    totalUnits = totalUnitCount;
                    myUnits = 1;
                    unitLabel = 'Einh.';
                }

                const costPerUnit = totalUnits > 0 ? totalCost / totalUnits : 0;
                let factor = page.ratio;
                if (key === 'personenanzahl' && page.occupants === 0) {
                    factor = 0;
                }
                const itemShare = (item.amount || 0) * factor;

                return `
                        <tr style="border-bottom:1px solid #eee">
                            <td style="padding:3px 2px;font-weight:700">${item.label}</td>
                            <td style="padding:3px 2px">${keyLabels[key] || key}</td>
                            <td style="padding:3px 2px;text-align:right">${totalCost > 0 ? fmt(totalCost) + ' €' : '--'}</td>
                            <td style="padding:3px 2px;text-align:right">${totalUnits > 0 ? fmt(totalUnits) + ' ' + unitLabel : '--'}</td>
                            <td style="padding:3px 2px;text-align:right">${costPerUnit > 0 ? fmt(costPerUnit) + ' €' : '--'}</td>
                            <td style="padding:3px 2px;text-align:right">${myUnits > 0 ? fmt(myUnits) + ' ' + unitLabel : '--'}</td>
                            <td style="padding:3px 2px;text-align:right;font-weight:700">${fmt(itemShare)} €</td>
                        </tr>`;
            }).join('')}
                    <tr style="border-top:2px solid #1f2937">
                        <td colspan="6" style="padding:4px 0;font-weight:700">Gesamtsumme (zeitanteilig)</td>
                        <td style="padding:4px 0;text-align:right;font-weight:700">${fmt(tenantTotal)} €</td>
                    </tr>
                    </tbody>
                </table>
                <div style="position:absolute;bottom:-12mm;left:0;font-size:8px;color:#e6a817;letter-spacing:2px;font-weight:600">SEITE ${idx * 2 + 2} / ${allPages.length * 2}</div>
            </div>`;
        });

        return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Nebenkostenabrechnung ${settlement.year || ''}</title>
        <style>
            @page { size: A4; margin: 14mm 16mm; }
            * { box-sizing: border-box; background-color: transparent; }
            html { background: #fff !important; }
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; line-height: 1.4; max-width: 210mm; margin: 0 auto; padding: 14mm 16mm; background: #fff !important; font-size: 11px; }
            div, table, tr, td, th, thead, tbody, tfoot { background-color: #fff !important; }
            @media print { body { padding: 0; background: #fff !important; } html, div, table, tr, td, th { background: #fff !important; } }
        </style></head><body style="background:#fff">
        ${pagesHTML}
        </body></html>`;
    };


    const previewSettlement = (settlement, unitId = null, tenantId = null) => {
        const html = generateSettlementHTML(settlement, unitId, tenantId);
        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 500);
    };

    const downloadSettlement = async (settlement, unitId = null, tenantId = null) => {
        const html = generateSettlementHTML(settlement, unitId, tenantId);
        const prop = getPropertyFull(settlement.property_id);

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

                    <Card>
                        <StepIndicator steps={stepLabels} currentStep={wizardStep} />

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

                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Kostenart</th>
                                                <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Gesamtkosten (€)</th>
                                                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Verteilerschlüssel</th>
                                                <th style={{ textAlign: 'center', padding: '10px 12px', width: '50px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {costItems.map((item, idx) => (
                                                <tr key={idx} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                                                        <input type="text" value={item.category_name}
                                                            onChange={e => {
                                                                const updated = [...costItems];
                                                                updated[idx].category_name = e.target.value;
                                                                setCostItems(updated);
                                                            }}
                                                            style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 500 }}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                                        <CurrencyInput allowDecimals value={item.amount}
                                                            onChange={e => {
                                                                const updated = [...costItems];
                                                                updated[idx].amount = e.target.value;
                                                                setCostItems(updated);
                                                            }}
                                                            style={{ width: '120px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'right' }}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
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
                                                            style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '160px' }}
                                                        >
                                                            {distributionKeys.map(k => (
                                                                <option key={k.id} value={k.id}>{k.name}</option>
                                                            ))}
                                                            {/* Fallback for legacy keys if not in db */}
                                                            {!distributionKeys.some(k => k.id === item.distribution_key) && item.distribution_key && !item.distribution_key.startsWith('temp-') && (
                                                                <option value={item.distribution_key}>{item.distribution_key}</option>
                                                            )}
                                                            <option disabled>──────────</option>
                                                            <option value="NEW_KEY" style={{ fontWeight: 'bold' }}>+ Eigene hinzufügen</option>
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
                                            return (
                                                <button key={uid}
                                                    onClick={() => setStep3SelectedUnit(uid)}
                                                    style={{
                                                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                                        padding: '10px 16px', borderRadius: 'var(--radius-md)',
                                                        border: `2px solid ${isActive ? 'var(--primary-color)' : 'var(--border-color)'} `,
                                                        backgroundColor: isActive ? '#EFF6FF' : 'transparent',
                                                        cursor: 'pointer', transition: 'all 0.2s', minWidth: '140px',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: isActive ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                                        {unit.unit_name}
                                                    </span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                        {tenant || 'Leerstand'}
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

                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                                            <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Kostenart</th>
                                                            <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Gesamt (€)</th>
                                                            {(() => {
                                                                // Calculate periods for header
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
                                                                <td style={{ padding: '10px 12px' }}>
                                                                    <input type="text" value={c.label}
                                                                        onChange={e => {
                                                                            const updated = { ...unitCosts };
                                                                            updated[activeUid] = [...(updated[activeUid] || [])];
                                                                            updated[activeUid][i] = { ...updated[activeUid][i], label: e.target.value };
                                                                            setUnitCosts(updated);
                                                                        }}
                                                                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 500 }}
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

                                        return (
                                            <div key={uid}
                                                onClick={() => setReviewUnit(uid)}
                                                style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: '14px 16px', borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--border-color)', cursor: 'pointer',
                                                    transition: 'all 0.2s', backgroundColor: reviewUnit === uid ? '#EFF6FF' : 'transparent'
                                                }}>
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{unit.unit_name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{tenant || 'Leerstand'}</div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontWeight: 700 }}>{total.toFixed(2)} €</div>
                                                    <div style={{
                                                        fontSize: '0.8rem', fontWeight: 500,
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
                                    const allPropertyUnits = units.filter(u => u.property_id === wizardPropertyId);

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

                                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                                <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                                                    <tr>
                                                                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Kostenart</th>
                                                                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Schlüssel</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Gesamt</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Einheiten</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Ko./Einh.</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Ihre Einh.</th>
                                                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Anteil</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {unitCostsList.map((item, i) => {
                                                                        const sourceItem = costItems.find(ci => ci.category_name === item.label);
                                                                        const totalCost = sourceItem ? sourceItem.amount : 0;
                                                                        const key = sourceItem ? sourceItem.distribution_key : 'anteil';

                                                                        let totalUnits = 0;
                                                                        let myUnits = 0;
                                                                        let unitLabel = '';

                                                                        if (key === 'wohnflaeche') {
                                                                            totalUnits = totalArea;
                                                                            myUnits = page.sqm;
                                                                            unitLabel = 'm²';
                                                                        } else if (key === 'personenanzahl') {
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
                                                                        if (key === 'personenanzahl' && page.occupants === 0) {
                                                                            factor = 0;
                                                                        }
                                                                        const itemShare = (item.amount || 0) * factor;

                                                                        return (
                                                                            <tr key={i} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                                <td style={{ padding: '8px 12px' }}>{item.label}</td>
                                                                                <td style={{ padding: '8px 12px' }}>{keyLabels[key] || key}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{totalCost > 0 ? totalCost.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €' : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{totalUnits > 0 ? totalUnits.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' ' + unitLabel : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{costPerUnit > 0 ? costPerUnit.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €' : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{myUnits > 0 ? myUnits.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' ' + unitLabel : '--'}</td>
                                                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{itemShare.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                                <tfoot style={{ backgroundColor: 'var(--background-color)', fontWeight: 600 }}>
                                                                    <tr>
                                                                        <td colSpan={6} style={{ padding: '10px 12px' }}>Gesamtsumme (zeitanteilig)</td>
                                                                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{tenantTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td colSpan={6} style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>Vorauszahlungen (zeitanteilig)</td>
                                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>- {tenantPrepay.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</td>
                                                                    </tr>
                                                                    <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                                                        <td colSpan={6} style={{ padding: '10px 12px', color: balance > 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>
                                                                            {balance > 0 ? 'Nachzahlung' : 'Guthaben'}
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: balance > 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>
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
    // Group settlements by property
    const settlementsByProperty = {};
    properties.forEach(p => {
        settlementsByProperty[p.id] = settlements.filter(s => s.property_id === p.id);
    });

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Nebenkostenabrechnung</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Erstellen und verwalten Sie Ihre Betriebskostenabrechnungen</p>
                </div>
            </div>

            {properties.length === 0 ? (
                <Card>
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Immobilien gefunden. Erstellen Sie zunächst eine Immobilie.
                    </div>
                </Card>
            ) : (
                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                    {properties.map(prop => {
                        const propSettlements = settlementsByProperty[prop.id] || [];
                        const propUnits = units.filter(u => u.property_id === prop.id);
                        const isExpanded = expandedProperty === prop.id;

                        return (
                            <Card key={prop.id}>
                                <div
                                    onClick={() => setExpandedProperty(isExpanded ? null : prop.id)}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        cursor: 'pointer', padding: '4px 0'
                                    }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{prop.street} {prop.house_number}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{prop.zip} {prop.city} · {propUnits.length} Einheiten</div>
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
                                                                            <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setOpenSettlementMenuId(openSettlementMenuId === s.id ? null : s.id);
                                                                            }}>Aktionen</Button>

                                                                            {openSettlementMenuId === s.id && (
                                                                                <div onClick={(e) => e.stopPropagation()} style={{
                                                                                    position: 'fixed', zIndex: 9999,
                                                                                    backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                                                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                                                                    minWidth: '200px', display: 'flex',
                                                                                    flexDirection: 'column', padding: '4px',
                                                                                    transform: 'translateY(-100%)', marginTop: '-4px'
                                                                                }}>
                                                                                    <button onClick={() => { setOpenSettlementMenuId(null); editSettlement(s); }}
                                                                                        style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                                                                                        onMouseEnter={(e) => e.target.style.backgroundColor = '#f3f4f6'} onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}>
                                                                                        <Edit2 size={14} /> Bearbeiten
                                                                                    </button>
                                                                                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                    <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Vorschau / Drucken</div>
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
                                                                                        <button key={`prev-${item.key}`} onClick={() => { setOpenSettlementMenuId(null); previewSettlement(s, item.uid, item.tenantId); }}
                                                                                            style={{ textAlign: 'left', padding: '6px 12px 6px 24px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-primary)', borderRadius: '4px' }}
                                                                                            onMouseEnter={(e) => e.target.style.backgroundColor = '#f3f4f6'} onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}>
                                                                                            <Eye size={12} /> {item.unitName} – {item.label}
                                                                                        </button>
                                                                                    ))}
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
                                                                                            onMouseEnter={(e) => e.target.style.backgroundColor = '#f3f4f6'} onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}>
                                                                                            <Download size={12} /> {item.unitName} – {item.label}
                                                                                        </button>
                                                                                    ))}
                                                                                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                                                    <button onClick={() => { setOpenSettlementMenuId(null); deleteSettlement(s.id); }}
                                                                                        style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)', borderRadius: '4px' }}
                                                                                        onMouseEnter={(e) => e.target.style.backgroundColor = '#fef2f2'} onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}>
                                                                                        <Trash2 size={14} /> Löschen
                                                                                    </button>
                                                                                </div>
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

                                                                            <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, backgroundColor: 'var(--bg-secondary)' }}>Vorschau / Drucken</div>
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
                                                                                <button key={`prev-${item.key}`} onClick={() => { setOpenSettlementMenuId(null); previewSettlement(s, item.uid, item.tenantId); }}
                                                                                    style={{ textAlign: 'left', padding: '10px 12px 10px 24px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-primary)', borderBottom: '1px solid #eee' }}>
                                                                                    <Eye size={16} /> {item.unitName} – {item.label}
                                                                                </button>
                                                                            ))}

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
