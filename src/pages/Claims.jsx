import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { createPortal } from 'react-dom';
import { Scale, Plus, AlertCircle, CheckCircle2, Clock, Ban, ArrowRight, ArrowLeft, ChevronDown, ChevronRight, Edit, Trash2, Eye, MoreVertical, Settings as SettingsIcon, CreditCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Claims = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { selectedPortfolioID } = usePortfolio();
    const [claims, setClaims] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [activeDropdownClaim, setActiveDropdownClaim] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0, openUp: false });
    
    const [kpis, setKpis] = useState({
        openCount: 0,
        totalDue: 0,
        actionRequiredCount: 0,
        paymentPlanCount: 0
    });

    // Create Modal States
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createStep, setCreateStep] = useState(1);
    const [openLedgers, setOpenLedgers] = useState([]);
    const [loadingLedgers, setLoadingLedgers] = useState(false);
    
    const [selectedLedgerIds, setSelectedLedgerIds] = useState([]);
    const [selectedLeaseId, setSelectedLeaseId] = useState('');
    const [buildingFilter, setBuildingFilter] = useState('');
    const [manualItems, setManualItems] = useState([]);
    const [allLeases, setAllLeases] = useState([]);
    
    const [expandedTenant, setExpandedTenant] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [form, setForm] = useState({
        fee_amount: 5.00,
        interest_rate: 5.0000,
        deadline_days: 7,
        note: ''
    });

    // Edit Modal States
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingClaim, setEditingClaim] = useState(null);
    const [editForm, setEditForm] = useState({
        deadline: '',
        interest_rate: 0,
        accumulated_unpaid_interest: 0,
        accumulated_unpaid_fees: 0
    });

    // Portal Settings States
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [portalSettings, setPortalSettings] = useState({
        claim_portal_allow_installments: true,
        claim_portal_allow_stripe: true,
        claim_portal_installment_options: [
            { months: 3, surcharge_percent: 7.00 },
            { months: 6, surcharge_percent: 9.00 },
            { months: 12, surcharge_percent: 12.00 }
        ],
        stripe_connect_id: null,
        stripe_connect_enabled: false
    });
    const [loadingSettings, setLoadingSettings] = useState(false);
    const [isStripeConnecting, setIsStripeConnecting] = useState(false);

    const loadPortalSettings = async () => {
        setLoadingSettings(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('claim_portal_allow_installments, claim_portal_allow_stripe, claim_portal_installment_options, stripe_connect_id, stripe_connect_enabled')
                .eq('id', user.id)
                .single();
            if (error) throw error;
            if (data) {
                setPortalSettings({
                    claim_portal_allow_installments: data.claim_portal_allow_installments ?? true,
                    claim_portal_allow_stripe: data.claim_portal_allow_stripe ?? true,
                    claim_portal_installment_options: data.claim_portal_installment_options || [
                        { months: 3, surcharge_percent: 7.00 },
                        { months: 6, surcharge_percent: 9.00 },
                        { months: 12, surcharge_percent: 12.00 }
                    ],
                    stripe_connect_id: data.stripe_connect_id || null,
                    stripe_connect_enabled: data.stripe_connect_enabled ?? false
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingSettings(false);
        }
    };

    const handleStripeConnect = async () => {
        setIsStripeConnecting(true);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
                body: { origin: window.location.origin }
            });
            if (error) throw error;
            if (data?.url) {
                window.location.href = data.url;
            } else {
                throw new Error('Keine Onboarding-URL von Stripe Connect empfangen.');
            }
        } catch (err) {
            console.error(err);
            let detailedMsg = err.message;
            // Attempt to extract error message from response context
            if (err.context && typeof err.context.text === 'function') {
                try {
                    const responseText = await err.context.text();
                    try {
                        const parsed = JSON.parse(responseText);
                        if (parsed && parsed.error) {
                            detailedMsg = parsed.error;
                        } else if (parsed && parsed.message) {
                            detailedMsg = parsed.message;
                        } else {
                            detailedMsg = responseText;
                        }
                    } catch (_) {
                        detailedMsg = responseText;
                    }
                } catch (_) {}
            }
            alert('Fehler bei der Verbindung mit Stripe: ' + detailedMsg);
        } finally {
            setIsStripeConnecting(false);
        }
    };

    const handleStripeDisconnect = async () => {
        if (!window.confirm('Möchten Sie die Stripe-Verbindung wirklich trennen? Mieter können dann nicht mehr online bezahlen.')) return;
        setIsStripeConnecting(true);
        try {
            const { error } = await supabase.from('profiles').update({
                stripe_connect_id: null,
                stripe_connect_enabled: false
            }).eq('id', user.id);
            
            if (error) throw error;
            
            setPortalSettings(prev => ({
                ...prev,
                stripe_connect_id: null,
                stripe_connect_enabled: false
            }));
            alert('Verbindung mit Stripe wurde getrennt.');
        } catch (err) {
            console.error(err);
            alert('Fehler beim Trennen der Verbindung: ' + err.message);
        } finally {
            setIsStripeConnecting(false);
        }
    };

    const handleSavePortalSettings = async () => {
        try {
            const { error } = await supabase.from('profiles').update({
                claim_portal_allow_installments: portalSettings.claim_portal_allow_installments,
                claim_portal_allow_stripe: portalSettings.claim_portal_allow_stripe,
                claim_portal_installment_options: portalSettings.claim_portal_installment_options
            }).eq('id', user.id);
            if (error) throw error;
            setIsSettingsModalOpen(false);
            alert('Einstellungen gespeichert.');
        } catch (err) {
            alert('Fehler: ' + err.message);
        }
    };

    const addInstallmentOption = () => {
        setPortalSettings(prev => ({
            ...prev,
            claim_portal_installment_options: [...prev.claim_portal_installment_options, { months: 12, surcharge_percent: 10.00 }]
        }));
    };

    const removeInstallmentOption = (index) => {
        setPortalSettings(prev => ({
            ...prev,
            claim_portal_installment_options: prev.claim_portal_installment_options.filter((_, i) => i !== index)
        }));
    };

    const updateInstallmentOption = (index, field, value) => {
        const newOptions = [...portalSettings.claim_portal_installment_options];
        newOptions[index][field] = parseFloat(value) || 0;
        setPortalSettings(prev => ({ ...prev, claim_portal_installment_options: newOptions }));
    };

    useEffect(() => {
        loadData();
    }, [selectedPortfolioID]);

    useEffect(() => {
        const handleClickOutside = () => setActiveDropdown(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const stripeStatus = params.get('stripe_status');
        if (stripeStatus) {
            // Clean URL from search params
            const cleanUrl = window.location.pathname + (window.location.hash || '');
            window.history.replaceState({}, document.title, cleanUrl);

            if (stripeStatus === 'success') {
                alert('Stripe-Konto erfolgreich verbunden/aktualisiert!');
                // Auto-open settings modal to show connected state
                loadPortalSettings().then(() => {
                    setIsSettingsModalOpen(true);
                });
            } else if (stripeStatus === 'refresh') {
                alert('Das Stripe-Onboarding wurde abgebrochen oder muss fortgesetzt werden.');
                loadPortalSettings().then(() => {
                    setIsSettingsModalOpen(true);
                });
            }
        }
    }, []);

    const fetchAndMergeClaims = async () => {
        // Fetch claims with tenant and lease data
        let claimsQuery = supabase
            .from('claims')
            .select(`
                id, status, escalation_level, deadline, next_action_at,
                interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
                tenants ( first_name, last_name ),
                leases!inner ( 
                    id, 
                    units!inner ( 
                        unit_name,
                        properties!inner ( id, portfolio_id, street, house_number, zip, city )
                    ) 
                )
            `)
            .order('created_at', { ascending: false });

        if (selectedPortfolioID) {
            claimsQuery = claimsQuery.eq('leases.units.properties.portfolio_id', selectedPortfolioID);
        }

        const { data: claimsData, error: claimsError } = await claimsQuery;

        if (claimsError) throw claimsError;

        const allActiveClaimIds = claimsData ? claimsData.map(c => c.id) : [];

        // Fetch totals from view (filtered by active claim IDs)
        let totalsData = [];
        if (allActiveClaimIds.length > 0) {
            const { data: tData, error: totalsError } = await supabase
                .from('claim_totals_view')
                .select('*')
                .in('claim_id', allActiveClaimIds);
            if (totalsError) throw totalsError;
            totalsData = tData || [];
        }

        // Fetch active payment plans (including fees_at_creation, interest_at_creation) for active claims
        let plansData = [];
        if (allActiveClaimIds.length > 0) {
            const { data: pData, error: plansError } = await supabase
                .from('payment_plans')
                .select('id, claim_id, total_amount, created_at, fees_at_creation, interest_at_creation')
                .eq('status', 'active')
                .in('claim_id', allActiveClaimIds);
            if (plansError) throw plansError;
            plansData = pData || [];
        }
            
        // Fetch installments for these plans
        let installmentsData = [];
        let allClaimItems = [];
        if (plansData && plansData.length > 0) {
            const planIds = plansData.map(p => p.id);
            const { data: instData } = await supabase
                .from('payment_plan_installments')
                .select('payment_plan_id, paid_amount')
                .in('payment_plan_id', planIds);
            installmentsData = instData || [];
        }

        // Fetch totals for ALL active claims
        let itemsTotalsData = [];
        let originalItemsData = [];
        if (allActiveClaimIds.length > 0) {
            const { data: iTotals } = await supabase
                .from('claim_item_totals_view')
                .select('claim_item_id, claim_id, open_amount, original_amount, paid_principal')
                .in('claim_id', allActiveClaimIds);
            itemsTotalsData = iTotals || [];
                
            // Fetch original items for created_at
            const { data: oItems } = await supabase
                .from('claim_items')
                .select('id, created_at, fee_amount, interest_amount')
                .in('claim_id', allActiveClaimIds);
            originalItemsData = oItems || [];
        }

        // Merge them locally
        if (itemsTotalsData && originalItemsData) {
            allClaimItems = itemsTotalsData.map(tot => {
                const orig = originalItemsData.find(o => o.id === tot.claim_item_id);
                return {
                    ...tot,
                    created_at: orig ? orig.created_at : null,
                    claim_items: orig ? { fee_amount: orig.fee_amount, interest_amount: orig.interest_amount } : {}
                };
            });
        }

        const calcItemTotal = (itemList) => {
            let ursprung = 0;
            let getilgt = 0;
            let offen = 0;
            itemList.forEach(item => {
                const baseAmt = Number(item.original_amount || 0);
                const feeAmt = Number(item.claim_items?.fee_amount || 0);
                const intAmt = Number(item.claim_items?.interest_amount || 0);
                const itemTotal = baseAmt + feeAmt + intAmt;
                
                const paidPrincipal = Number(item.paid_principal || 0);
                let paidTotal = 0;
                if (paidPrincipal > 0 || item.open_amount === 0) {
                    paidTotal = feeAmt + intAmt + paidPrincipal;
                }
                if (item.open_amount === 0) {
                    paidTotal = itemTotal;
                }
                const openTotal = Math.max(0, itemTotal - paidTotal);

                ursprung += itemTotal;
                getilgt += paidTotal;
                offen += openTotal;
            });
            return { ursprung, getilgt, offen };
        };

        // Merge data
        const merged = (claimsData || []).map(claim => {
            let totals = (totalsData || []).find(t => t.claim_id === claim.id) || {};
            
            const claimItems = allClaimItems.filter(i => i.claim_id === claim.id);
            const itemCount = claimItems.length;

            let claimTotalUrsprung = 0;
            let claimTotalGetilgt = 0;
            let claimTotalOffen = 0;

            const plan = (plansData || []).find(p => p.claim_id === claim.id);
            if (plan) {
                const planInst = installmentsData.filter(i => i.payment_plan_id === plan.id);
                const planPaid = planInst.reduce((sum, inst) => sum + Number(inst.paid_amount || 0), 0);
                const planTotal = Number(plan.total_amount || 0);
                const planOpen = Math.max(0, planTotal - planPaid);
                
                const newItems = claimItems.filter(item => new Date(item.created_at) > new Date(plan.created_at || '2026-01-01'));
                const newItemsCalc = calcItemTotal(newItems);
                
                claimTotalUrsprung = planTotal + newItemsCalc.ursprung;
                claimTotalGetilgt = planPaid + newItemsCalc.getilgt;
                claimTotalOffen = planOpen + newItemsCalc.offen;
            } else {
                const allItemsCalc = calcItemTotal(claimItems);
                claimTotalUrsprung = allItemsCalc.ursprung;
                claimTotalGetilgt = allItemsCalc.getilgt;
                claimTotalOffen = allItemsCalc.offen;
            }
            
            return { 
                ...claim, 
                ...totals, 
                itemCount, 
                totalUrsprung: claimTotalUrsprung, 
                totalGetilgt: claimTotalGetilgt, 
                totalOffen: claimTotalOffen 
            };
        });

        // Filter out cancelled and archived claims from the main view (optional, but good for UI)
        const activeClaims = merged.filter(c => !['cancelled', 'archived'].includes(c.status));

        setClaims(activeClaims);
        calculateKpis(activeClaims);
    };

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Overdue-Status im Hintergrund aktualisieren (non-blocking)
            supabase.rpc('update_overdue_claims_status').then(({ data, error }) => {
                if (error) {
                    console.warn('Could not update overdue claims status:', error);
                } else if (data && data > 0) {
                    console.log(`Updated ${data} overdue claims in background. Reloading silently...`);
                    fetchAndMergeClaims().catch(err => console.error('Silent reload failed:', err));
                }
            });

            // 2. Daten sofort laden
            await fetchAndMergeClaims();
        } catch (err) {
            console.error('Error loading claims:', err);
            setError(err.message || 'Fehler beim Laden der Forderungen');
        } finally {
            setLoading(false);
        }
    };

    const loadOpenLedgers = async () => {
        setLoadingLedgers(true);
        try {
            const { error: syncError } = await supabase.rpc('sync_all_rent_ledgers');
            if (syncError) console.warn('Sync ledger warning:', syncError);

            let ledgerQuery = supabase
                .from('rent_ledger')
                .select(`
                    id, period_month, expected_rent, paid_amount, due_date,
                    leases!inner (
                        id,
                        units!inner (
                            unit_name,
                            properties!inner ( id, portfolio_id, street, house_number, zip, city )
                        ),
                        tenants ( first_name, last_name )
                    )
                `)
                .eq('status', 'open')
                .order('period_month', { ascending: false });

            if (selectedPortfolioID) {
                ledgerQuery = ledgerQuery.eq('leases.units.properties.portfolio_id', selectedPortfolioID);
            }

            const { data: ledgerData, error: ledgerError } = await ledgerQuery;

            if (ledgerError) throw ledgerError;

            const { data: activeClaims, error: claimsError } = await supabase
                .from('claim_items')
                .select('rent_ledger_id, claims!inner(status)')
                .not('claims.status', 'in', '("settled","cancelled","archived")')
                .not('rent_ledger_id', 'is', null);

            if (claimsError) throw claimsError;

            const excludedIds = (activeClaims || []).map(c => c.rent_ledger_id);
            const available = (ledgerData || []).filter(l => !excludedIds.includes(l.id));

            setOpenLedgers(available);
            
            // Fetch all active leases for manual claims
            let leasesQuery = supabase
                .from('leases')
                .select(`
                    id, 
                    tenants (first_name, last_name),
                    units!inner (unit_name, properties!inner (id, portfolio_id, street, house_number, city))
                `)
                .eq('status', 'active');

            if (selectedPortfolioID) {
                leasesQuery = leasesQuery.eq('units.properties.portfolio_id', selectedPortfolioID);
            }

            const { data: leasesData, error: leasesError } = await leasesQuery;
                
            if (!leasesError && leasesData) {
                setAllLeases(leasesData);
            }
        } catch (err) {
            console.error('Error loading ledgers:', err);
            alert('Fehler beim Laden offener Mieten.');
        } finally {
            setLoadingLedgers(false);
        }
    };

    const openCreateModal = () => {
        setCreateStep(1);
        setSelectedLedgerIds([]);
        setSelectedLeaseId('');
        setBuildingFilter('');
        setManualItems([]);
        setExpandedTenant(null);
        setForm({ fee_amount: 5.00, interest_rate: 5.0000, deadline_days: 7, note: '' });
        setIsCreateModalOpen(true);
        loadOpenLedgers();
    };

    const handleCreateClaim = async () => {
        if (selectedLedgerIds.length === 0 && manualItems.length === 0) {
            alert('Bitte wählen Sie mindestens eine Miete aus oder fügen Sie eine manuelle Position hinzu.');
            return;
        }
        
        let targetLeaseId = selectedLeaseId;
        if (!targetLeaseId && selectedLedgerIds.length > 0) {
            const firstLedger = openLedgers.find(l => l.id === selectedLedgerIds[0]);
            if (firstLedger) targetLeaseId = firstLedger.leases?.id;
        }
        
        if (!targetLeaseId) {
            alert('Kein Mietvertrag zugeordnet.');
            return;
        }

        setIsSubmitting(true);
        try {
            const selectedLedgerItems = openLedgers.filter(l => selectedLedgerIds.includes(l.id));
            const interestRateDecimal = (parseFloat(form.interest_rate) || 0) / 100;
            let calculatedInterest = 0;
            const todayDate = new Date();
            
            selectedLedgerItems.forEach(l => {
                const openAmount = Number(l.expected_rent || 0) - Number(l.paid_amount || 0);
                let dueDate = l.due_date ? new Date(l.due_date) : null;
                if (!dueDate && l.period_month) {
                    const d = new Date(l.period_month);
                    dueDate = new Date(d.getFullYear(), d.getMonth(), 5);
                }
                if (dueDate && todayDate > dueDate) {
                    const diffTime = todayDate - dueDate;
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    calculatedInterest += openAmount * interestRateDecimal * (diffDays / 365);
                }
            });

            manualItems.forEach(item => {
                const openAmount = Number(item.amount || 0);
                if (item.dueDate && openAmount > 0) {
                    const dueDate = new Date(item.dueDate);
                    if (todayDate > dueDate) {
                        const diffTime = todayDate - dueDate;
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        calculatedInterest += openAmount * interestRateDecimal * (diffDays / 365);
                    }
                }
            });

            const { error: rpcError } = await supabase.rpc('create_claim_advanced', {
                p_lease_id: targetLeaseId,
                p_rent_ledger_ids: selectedLedgerIds.length > 0 ? selectedLedgerIds : null,
                p_manual_items: manualItems,
                p_fee_amount: parseFloat(form.fee_amount) || 0,
                p_interest_rate: parseFloat(form.interest_rate) || 0,
                p_accumulated_interest: calculatedInterest,
                p_interest_start_date: todayDate.toISOString().split('T')[0],
                p_deadline_days: parseInt(form.deadline_days, 10) || 7,
                p_note: form.note || ''
            });

            if (rpcError) throw rpcError;

            setIsCreateModalOpen(false);
            loadData();
            alert('Forderung wurde erfolgreich erstellt!');
        } catch (err) {
            console.error('Error creating claim:', err);
            alert('Fehler: ' + (err.message || 'Forderung konnte nicht erstellt werden.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const openEditModal = (claim) => {
        setEditingClaim(claim);
        setEditForm({
            deadline: claim.deadline ? claim.deadline.split('T')[0] : '',
            interest_rate: claim.interest_rate || 5,
            accumulated_unpaid_interest: claim.accumulated_unpaid_interest || 0,
            accumulated_unpaid_fees: claim.accumulated_unpaid_fees || 0
        });
        setIsEditModalOpen(true);
    };

    const handleEditClaim = async () => {
        if (!editingClaim) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase
                .from('claims')
                .update({
                    deadline: editForm.deadline,
                    interest_rate: parseFloat(editForm.interest_rate),
                    accumulated_unpaid_interest: parseFloat(editForm.accumulated_unpaid_interest),
                    accumulated_unpaid_fees: parseFloat(editForm.accumulated_unpaid_fees),
                    updated_at: new Date().toISOString()
                })
                .eq('id', editingClaim.id);

            if (error) throw error;

            setIsEditModalOpen(false);
            setEditingClaim(null);
            loadData();
            alert('Forderung erfolgreich aktualisiert!');
        } catch (err) {
            console.error('Error updating claim:', err);
            alert('Fehler beim Aktualisieren: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancelClaim = async (claimId) => {
        if (!window.confirm('Möchten Sie diese Forderung wirklich stornieren/löschen? Die Mieten werden dadurch wieder als offen markiert und können neu angemahnt werden.')) {
            return;
        }
        
        try {
            const { error } = await supabase
                .from('claims')
                .update({ 
                    status: 'cancelled', 
                    cancelled_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', claimId);

            if (error) throw error;
            
            loadData();
            alert('Forderung wurde erfolgreich storniert/gelöscht.');
        } catch (err) {
            console.error('Error cancelling claim:', err);
            alert('Fehler beim Löschen: ' + err.message);
        }
    };

    const calculateKpis = (activeClaims) => {
        let totalUrsprung = 0;
        let totalGetilgt = 0;
        let totalOffen = 0;

        activeClaims.forEach(claim => {
            totalUrsprung += (claim.totalUrsprung || 0);
            totalGetilgt += (claim.totalGetilgt || 0);
            totalOffen += (claim.totalOffen || 0);
        });

        setKpis({ totalUrsprung, totalGetilgt, totalOffen });
    };

    const getStatusBadge = (status) => {
        const mapping = {
            draft: { label: 'Entwurf', variant: 'default' },
            open: { label: 'Offen', variant: 'blue' },
            sent: { label: 'Versendet', variant: 'blue' },
            action_required: { label: 'Aktion erforderlich', variant: 'danger' },
            payment_plan_requested: { label: 'Ratenzahlung angefragt', variant: 'warning' },
            payment_plan_active: { label: 'Ratenzahlung aktiv', variant: 'success' },
            settled: { label: 'Erledigt', variant: 'success' },
            cancelled: { label: 'Storniert', variant: 'default' },
            archived: { label: 'Archiviert', variant: 'default' }
        };
        const config = mapping[status] || { label: status, variant: 'default' };
        return <Badge variant={config.variant}>{config.label}</Badge>;
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('de-DE');
    };

    const getTenantName = (tenant) => {
        if (!tenant) return 'Unbekannt';
        return `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'Unbekannt';
    };

    const getLeaseName = (lease) => {
        if (!lease) return '-';
        const propData = lease.units?.properties;
        const prop = propData ? `${propData.street} ${propData.house_number}`.trim() : '';
        const unit = lease.units?.unit_name || '';
        if (prop && unit) return `${prop} - ${unit}`;
        return prop || unit || '-';
    };

    const groupedLedgers = openLedgers.reduce((acc, ledger) => {
        const leaseId = ledger.leases?.id || 'unknown';
        if (!acc[leaseId]) {
            acc[leaseId] = { lease: ledger.leases, tenant: ledger.leases?.tenants, ledgers: [], totalOpen: 0 };
        }
        acc[leaseId].ledgers.push(ledger);
        acc[leaseId].totalOpen += (Number(ledger.expected_rent || 0) - Number(ledger.paid_amount || 0));
        return acc;
    }, {});

    const toggleTenantExpand = (leaseId) => {
        setExpandedTenant(expandedTenant === leaseId ? null : leaseId);
    };

    const toggleLedgerSelection = (ledgerId, leaseId) => {
        setSelectedLeaseId(''); // Clear manual lease selection
        setSelectedLedgerIds(prev => prev.includes(ledgerId) ? prev.filter(id => id !== ledgerId) : [...prev, ledgerId]);
    };

    const toggleAllForLease = (leaseId, ledgerIds) => {
        setSelectedLeaseId(''); // Clear manual lease selection
        const allSelected = ledgerIds.every(id => selectedLedgerIds.includes(id));
        if (allSelected) {
            setSelectedLedgerIds(prev => prev.filter(id => !ledgerIds.includes(id)));
        } else {
            setSelectedLedgerIds(ledgerIds);
        }
    };

    const selectedLedgerItems = openLedgers.filter(l => selectedLedgerIds.includes(l.id));
    const totalPrincipalSelected = selectedLedgerItems.reduce((sum, l) => sum + (Number(l.expected_rent || 0) - Number(l.paid_amount || 0)), 0);

    return (
        <div style={{ padding: 'var(--spacing-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Scale size={28} color="var(--primary-color)" />
                        Forderungsmanagement
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Verwalten Sie Mietrückstände, Mahnungen und Ratenzahlungen.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <Button 
                        variant="secondary" 
                        onClick={() => { loadPortalSettings(); setIsSettingsModalOpen(true); }} 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <SettingsIcon size={18} />
                        Portal-Einstellungen
                    </Button>
                    <Button onClick={openCreateModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Plus size={18} />
                        Forderung erstellen
                    </Button>
                </div>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card style={{ padding: 'var(--spacing-lg)', borderLeft: '4px solid #3B82F6' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Ursprung</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(kpis.totalUrsprung || 0)}</div>
                </Card>
                
                <Card style={{ padding: 'var(--spacing-lg)', borderLeft: '4px solid #10B981' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Getilgt</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#059669' }}>{formatCurrency(kpis.totalGetilgt || 0)}</div>
                </Card>

                <Card style={{ padding: 'var(--spacing-lg)', borderLeft: '4px solid #EF4444', backgroundColor: '#FEF2F2' }}>
                    <div style={{ fontSize: '0.85rem', color: '#991B1B', marginBottom: '4px', fontWeight: 600 }}>Gesamt offen</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#991B1B' }}>{formatCurrency(kpis.totalOffen || 0)}</div>
                </Card>
            </div>

            {/* Claims Table */}
            <Card style={{ overflow: 'visible' }}>
                <div style={{ padding: 'var(--spacing-lg)', borderBottom: '1px solid var(--border-color)' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Aktive Forderungen</h2>
                </div>
                
                {error && (
                    <div style={{ margin: 'var(--spacing-lg)', padding: 'var(--spacing-md)', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Ban size={20} />
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Daten...</div>
                ) : claims.length === 0 ? (
                    <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Noch keine Forderungen vorhanden.
                    </div>
                ) : (
                    <div style={{ overflow: 'visible' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Mieter</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Objekt / Einheit</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Frist</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Ursprung</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Getilgt</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 700, textAlign: 'right' }}>Gesamt Offen</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Aktionen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claims.map((claim) => (
                                    <tr 
                                        key={claim.id} 
                                        onClick={() => navigate(`/forderungen/${claim.id}`)}
                                        style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s', cursor: 'pointer' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <td style={{ padding: '16px', fontSize: '0.95rem', fontWeight: 500 }}>{getTenantName(claim.tenants)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{getLeaseName(claim.leases)}</td>
                                        <td style={{ padding: '16px' }}>{claim.itemCount > 1 ? <span style={{ color: 'var(--text-secondary)' }}>-</span> : getStatusBadge(claim.status)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            {claim.itemCount > 1 ? <span>-</span> : (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Clock size={14} />
                                                    {formatDate(claim.deadline)}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(claim.totalUrsprung)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(claim.totalGetilgt)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.95rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {formatCurrency(claim.totalOffen)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        if (activeDropdown === claim.id) {
                                                            setActiveDropdown(null);
                                                            setActiveDropdownClaim(null);
                                                        } else {
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            const spaceBelow = window.innerHeight - rect.bottom;
                                                            const openUp = spaceBelow < 200;
                                                            setMenuPos({
                                                                top: openUp ? rect.top : rect.bottom + 4,
                                                                left: rect.left,
                                                                openUp
                                                            });
                                                            setActiveDropdown(claim.id);
                                                            setActiveDropdownClaim(claim);
                                                        }
                                                    }}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-secondary)' }}
                                                >
                                                    <MoreVertical size={20} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Edit Modal */}
            <Modal isOpen={isEditModalOpen} onClose={() => !isSubmitting && setIsEditModalOpen(false)} title="Forderung bearbeiten">
                <div style={{ padding: 'var(--spacing-md) 0', maxWidth: '600px' }}>
                    {editingClaim && (
                        <>
                            <div style={{ backgroundColor: '#F3F4F6', padding: '16px', borderRadius: '8px', marginBottom: 'var(--spacing-lg)' }}>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    <strong>Hinweis zur Miete:</strong> Die Werte für "Ursprung", "Getilgt" und "Rest Miete" basieren auf der Buchhaltung (Mietkonto). 
                                    Wenn Sie die Miete oder eine Zahlung anpassen möchten, tun Sie dies bitte im Reiter "Finanzen". Diese Forderung aktualisiert sich dann automatisch!
                                </p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Fristdatum</label>
                                    <Input 
                                        type="date" 
                                        value={editForm.deadline} 
                                        onChange={e => setEditForm({...editForm, deadline: e.target.value})} 
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Zinssatz (% p.a.)</label>
                                    <Input 
                                        type="number" step="0.0001" min="0" 
                                        value={editForm.interest_rate} 
                                        onChange={e => setEditForm({...editForm, interest_rate: e.target.value})} 
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Verbuchte Zinsen (€)</label>
                                    <Input 
                                        type="number" step="0.01" min="0" 
                                        value={editForm.accumulated_unpaid_interest} 
                                        onChange={e => setEditForm({...editForm, accumulated_unpaid_interest: e.target.value})} 
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Mahnkosten (€)</label>
                                    <Input 
                                        type="number" step="0.01" min="0" 
                                        value={editForm.accumulated_unpaid_fees} 
                                        onChange={e => setEditForm({...editForm, accumulated_unpaid_fees: e.target.value})} 
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 'var(--spacing-xl)' }}>
                                <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Abbrechen</Button>
                                <Button onClick={handleEditClaim} disabled={isSubmitting} style={{ backgroundColor: '#1E40AF', color: 'white' }}>
                                    {isSubmitting ? 'Wird gespeichert...' : 'Änderungen speichern'}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>

            {/* Create Modal */}
            <Modal isOpen={isCreateModalOpen} onClose={() => !isSubmitting && setIsCreateModalOpen(false)} title="Forderung erstellen" maxWidth="700px">
                <div style={{ padding: 'var(--spacing-md) 0' }}>
                    {createStep === 1 && (
                        <div>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
                                Wählen Sie einen Mieter aus, um eine gebündelte oder einzelne Forderung zu erstellen.
                            </p>
                            
                            {loadingLedgers ? (
                                <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>Lade offene Mieten...</div>
                            ) : openLedgers.length === 0 ? (
                                <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
                                    Es gibt aktuell keine offenen Mieten, die noch nicht in Bearbeitung sind.
                                </div>
                            ) : (
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                    {Object.entries(groupedLedgers).map(([leaseId, group]) => {
                                        const isExpanded = expandedTenant === leaseId;
                                        const ledgerIds = group.ledgers.map(l => l.id);
                                        const allSelected = ledgerIds.every(id => selectedLedgerIds.includes(id));
                                        const someSelected = ledgerIds.some(id => selectedLedgerIds.includes(id));
                                        
                                        return (
                                            <div key={leaseId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <div 
                                                    style={{ 
                                                        display: 'flex', alignItems: 'center', padding: '12px 16px', 
                                                        backgroundColor: (someSelected || allSelected) ? '#EFF6FF' : '#F9FAFB',
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={() => toggleTenantExpand(leaseId)}
                                                >
                                                    <div style={{ marginRight: '12px' }} onClick={e => e.stopPropagation()}>
                                                        <input 
                                                            type="checkbox" 
                                                            checked={allSelected}
                                                            ref={input => { if(input) input.indeterminate = (someSelected && !allSelected) }}
                                                            onChange={() => toggleAllForLease(leaseId, ledgerIds)}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                    </div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: 600 }}>{getTenantName(group.tenant)}</div>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{getLeaseName(group.lease)}</div>
                                                    </div>
                                                    <div style={{ textAlign: 'right', marginRight: '16px' }}>
                                                        <div style={{ fontWeight: 700, color: '#991B1B' }}>{formatCurrency(group.totalOpen)}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{group.ledgers.length} {group.ledgers.length === 1 ? 'Monat' : 'Monate'}</div>
                                                    </div>
                                                    <div>
                                                        {isExpanded ? <ChevronDown size={20} color="var(--text-secondary)" /> : <ChevronRight size={20} color="var(--text-secondary)" />}
                                                    </div>
                                                </div>

                                                {isExpanded && (
                                                    <div style={{ padding: '8px 16px 16px 44px', backgroundColor: 'white' }}>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                            <tbody>
                                                                {group.ledgers.map(l => {
                                                                    const openAmount = Number(l.expected_rent || 0) - Number(l.paid_amount || 0);
                                                                    const monthStr = l.period_month ? l.period_month.substring(0, 7) : '';
                                                                    const isSelected = selectedLedgerIds.includes(l.id);
                                                                    return (
                                                                        <tr key={l.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                                                                            <td style={{ padding: '8px 0', width: '30px' }}>
                                                                                <input 
                                                                                    type="checkbox" 
                                                                                    checked={isSelected}
                                                                                    onChange={() => toggleLedgerSelection(l.id, leaseId)}
                                                                                />
                                                                            </td>
                                                                            <td style={{ padding: '8px 0' }}>Miete {monthStr}</td>
                                                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 500 }}>{formatCurrency(openAmount)}</td>
                                                                        </tr>
                                                                    )
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '12px' }}>Freie Forderung (z.B. Betriebskosten)</h4>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                    Erstellen Sie eine Forderungsakte ohne offene Miete, z.B. für Nachzahlungen.
                                </p>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                    <select 
                                        style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
                                        value={buildingFilter}
                                        onChange={(e) => {
                                            setBuildingFilter(e.target.value);
                                            setSelectedLeaseId('');
                                        }}
                                    >
                                        <option value="">-- Alle Häuser --</option>
                                        {Array.from(new Set(allLeases.map(l => l.units?.properties ? `${l.units.properties.street} ${l.units.properties.house_number}, ${l.units.properties.city}` : ''))).filter(Boolean).map(address => (
                                            <option key={address} value={address}>{address}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select 
                                        style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
                                        value={selectedLeaseId}
                                        onChange={(e) => {
                                            setSelectedLeaseId(e.target.value);
                                            setSelectedLedgerIds([]); // Clear ledger selections
                                        }}
                                    >
                                        <option value="">-- Mietvertrag auswählen --</option>
                                        {allLeases.filter(l => !buildingFilter || (l.units?.properties && `${l.units.properties.street} ${l.units.properties.house_number}, ${l.units.properties.city}` === buildingFilter)).map(lease => (
                                            <option key={lease.id} value={lease.id}>
                                                {getTenantName(lease.tenants)} ({getLeaseName(lease)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 'var(--spacing-lg)' }}>
                                <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Abbrechen</Button>
                                <Button onClick={() => setCreateStep(2)} disabled={selectedLedgerIds.length === 0 && !selectedLeaseId} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    Weiter <ArrowRight size={16} />
                                </Button>
                            </div>
                        </div>
                    )}

                    {createStep === 2 && (
                        <div>
                            {(() => {
                                const targetLease = selectedLeaseId 
                                    ? allLeases.find(l => l.id === selectedLeaseId)
                                    : openLedgers.find(l => l.id === selectedLedgerIds[0])?.leases;
                                const interestRateDecimal = (parseFloat(form.interest_rate) || 0) / 100;
                                let calculatedInterest = 0;
                                const todayDate = new Date();
                                
                                selectedLedgerItems.forEach(l => {
                                    const openAmount = Number(l.expected_rent || 0) - Number(l.paid_amount || 0);
                                    let dueDate = l.due_date ? new Date(l.due_date) : null;
                                    if (!dueDate && l.period_month) {
                                        const d = new Date(l.period_month);
                                        dueDate = new Date(d.getFullYear(), d.getMonth(), 5);
                                    }
                                    if (dueDate && todayDate > dueDate) {
                                        const diffTime = todayDate - dueDate;
                                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                                        calculatedInterest += openAmount * interestRateDecimal * (diffDays / 365);
                                    }
                                });

                                manualItems.forEach(item => {
                                    const openAmount = Number(item.amount || 0);
                                    if (item.dueDate && openAmount > 0) {
                                        const dueDate = new Date(item.dueDate);
                                        if (todayDate > dueDate) {
                                            const diffTime = todayDate - dueDate;
                                            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                                            calculatedInterest += openAmount * interestRateDecimal * (diffDays / 365);
                                        }
                                    }
                                });

                                const totalManual = manualItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                                const total = totalPrincipalSelected + totalManual + Number(form.fee_amount || 0) + calculatedInterest;
                                const deadlineDate = new Date();
                                deadlineDate.setDate(deadlineDate.getDate() + Number(form.deadline_days || 0));

                                return (
                                    <>
                                        <div style={{ backgroundColor: '#F3F4F6', padding: '16px', borderRadius: '8px', marginBottom: 'var(--spacing-lg)' }}>
                                            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                                Zusammenfassung ({targetLease ? getTenantName(targetLease.tenants) : ''})
                                            </h3>
                                            
                                            {selectedLedgerIds.length > 0 && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                    <span>Offene Mieten ({selectedLedgerIds.length} {selectedLedgerIds.length === 1 ? 'Monat' : 'Monate'}):</span>
                                                    <span style={{ fontWeight: 600 }}>{formatCurrency(totalPrincipalSelected)}</span>
                                                </div>
                                            )}
                                            
                                            {manualItems.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', paddingLeft: '8px', borderLeft: '2px solid #D1D5DB' }}>
                                                    <span>{item.description || 'Manuelle Position'}:</span>
                                                    <span style={{ fontWeight: 600 }}>{formatCurrency(item.amount)}</span>
                                                </div>
                                            ))}
                                            
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', marginTop: '12px' }}>
                                                <span>Mahnkosten:</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(form.fee_amount)}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#B45309' }}>
                                                <span>Verzugszinsen (bis heute):</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(calculatedInterest)}</span>
                                            </div>
                                            <div style={{ borderTop: '1px solid #D1D5DB', margin: '8px 0' }}></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#991B1B', fontSize: '1.1rem' }}>
                                                <span style={{ fontWeight: 600 }}>Gesamtforderung (heute):</span>
                                                <span style={{ fontWeight: 700 }}>{formatCurrency(total)}</span>
                                            </div>
                                        </div>
                                        
                                        <div style={{ marginBottom: '24px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Manuelle Positionen (Optional)</label>
                                                <Button 
                                                    variant="secondary" 
                                                    size="sm"
                                                    onClick={() => setManualItems([...manualItems, { description: '', amount: '', item_type: 'other', dueDate: '' }])}
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                >
                                                    <Plus size={14} /> Position hinzufügen
                                                </Button>
                                            </div>
                                            
                                            {manualItems.length > 0 && (
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '4px' }}>
                                                    <div style={{ flex: 2, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Bezeichnung</div>
                                                    <div style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Fällig am</div>
                                                    <div style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Betrag (€)</div>
                                                    <div style={{ width: '24px' }}></div>
                                                </div>
                                            )}
                                            
                                            {manualItems.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                                                    <Input 
                                                        placeholder="z.B. Betriebskosten 2024" 
                                                        value={item.description}
                                                        onChange={e => {
                                                            const newItems = [...manualItems];
                                                            newItems[idx].description = e.target.value;
                                                            setManualItems(newItems);
                                                        }}
                                                        style={{ flex: 2 }}
                                                    />
                                                    <Input 
                                                        type="date"
                                                        value={item.dueDate || ''}
                                                        onChange={e => {
                                                            const newItems = [...manualItems];
                                                            newItems[idx].dueDate = e.target.value;
                                                            setManualItems(newItems);
                                                        }}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <Input 
                                                        type="number" step="0.01" 
                                                        placeholder="0,00" 
                                                        value={item.amount === '' || item.amount === 0 ? '' : item.amount}
                                                        onChange={e => {
                                                            const newItems = [...manualItems];
                                                            newItems[idx].amount = e.target.value === '' ? '' : (parseFloat(e.target.value) || 0);
                                                            setManualItems(newItems);
                                                        }}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <button 
                                                        onClick={() => setManualItems(manualItems.filter((_, i) => i !== idx))}
                                                        style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px' }}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Zinssatz (% p.a.)</label>
                                                <Input 
                                                    type="number" step="0.0001" min="0" 
                                                    value={form.interest_rate} 
                                                    onChange={e => setForm({...form, interest_rate: e.target.value})} 
                                                />
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                    Zinsen bis heute werden automatisch aus {form.interest_rate}% berechnet.
                                                </div>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Mahnkosten (€)</label>
                                                <Input 
                                                    type="number" step="0.01" min="0" 
                                                    value={form.fee_amount} 
                                                    onChange={e => setForm({...form, fee_amount: e.target.value})} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Frist (Tage)</label>
                                                <Input 
                                                    type="number" min="1" 
                                                    value={form.deadline_days} 
                                                    onChange={e => setForm({...form, deadline_days: e.target.value})} 
                                                />
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                    Fristdatum: {deadlineDate.toLocaleDateString('de-DE')}
                                                </div>
                                            </div>
                                            <div style={{ gridColumn: 'span 2' }}>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Interne Notiz (Optional)</label>
                                                <Input 
                                                    type="text" 
                                                    placeholder="Notiz zur Forderung"
                                                    value={form.note} 
                                                    onChange={e => setForm({...form, note: e.target.value})} 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--spacing-xl)' }}>
                                            <Button variant="secondary" onClick={() => setCreateStep(1)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <ArrowLeft size={16} /> Zurück
                                            </Button>
                                            <Button onClick={handleCreateClaim} disabled={isSubmitting} style={{ backgroundColor: '#991B1B', color: 'white' }}>
                                                {isSubmitting ? 'Wird erstellt...' : 'Forderung erstellen'}
                                            </Button>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>
            </Modal>

            {activeDropdown && activeDropdownClaim && createPortal(
                <>
                    <div onClick={() => { setActiveDropdown(null); setActiveDropdownClaim(null); }} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
                    <div style={{
                        position: 'fixed',
                        top: menuPos.openUp ? 'auto' : menuPos.top,
                        bottom: menuPos.openUp ? `${window.innerHeight - menuPos.top}px` : 'auto',
                        left: menuPos.left,
                        transform: 'translateX(-100%)',
                        backgroundColor: 'var(--surface-color, white)',
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
                            onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); navigate(`/forderungen/${activeDropdownClaim.id}`); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem', color: 'var(--text-primary)', borderRadius: '6px' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-color, #F3F4F6)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Eye size={16} /> Akte öffnen
                        </button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); openEditModal(activeDropdownClaim); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem', color: 'var(--text-primary)', borderRadius: '6px' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-color, #F3F4F6)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Edit size={16} /> Bearbeiten
                        </button>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-color, #E5E7EB)', margin: '4px 0' }} />
                        <button 
                            onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); handleCancelClaim(activeDropdownClaim.id); }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem', color: '#991B1B', borderRadius: '6px' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.06)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Trash2 size={16} /> Stornieren
                        </button>
                    </div>
                </>,
                document.body
            )}

            {/* Portal Settings Modal */}
            <Modal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} title="Forderungsportal Einstellungen">
                <div style={{ padding: 'var(--spacing-lg)' }}>
                    {loadingSettings ? (
                        <div style={{ textAlign: 'center', padding: '20px' }}>Lade Einstellungen...</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <input 
                                    type="checkbox" 
                                    id="allow_installments" 
                                    checked={portalSettings.claim_portal_allow_installments}
                                    onChange={(e) => setPortalSettings({ ...portalSettings, claim_portal_allow_installments: e.target.checked })}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                <div>
                                    <label htmlFor="allow_installments" style={{ fontWeight: 600, display: 'block', cursor: 'pointer' }}>Ratenzahlung im Portal anbieten</label>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mieter können Ratenzahlungen selbstständig anfragen.</span>
                                </div>
                            </div>

                            {portalSettings.claim_portal_allow_installments && (
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>Raten-Vorschläge (Standard)</h3>
                                        <Button variant="secondary" onClick={addInstallmentOption} style={{ padding: '4px 8px', fontSize: '0.8rem', display: 'flex', gap: '4px' }}>
                                            <Plus size={14} /> Hinzufügen
                                        </Button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {portalSettings.claim_portal_installment_options.map((opt, index) => (
                                            <div key={index} style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', paddingBottom: '12px', borderBottom: index < portalSettings.claim_portal_installment_options.length - 1 ? '1px dashed #E5E7EB' : 'none' }}>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Anzahl Raten</label>
                                                    <Input 
                                                        type="number" 
                                                        min="2" max="48"
                                                        value={opt.months}
                                                        onChange={(e) => updateInstallmentOption(index, 'months', e.target.value)}
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Aufschlag (%)</label>
                                                    <Input 
                                                        type="number" 
                                                        step="0.01"
                                                        value={opt.surcharge_percent}
                                                        onChange={(e) => updateInstallmentOption(index, 'surcharge_percent', e.target.value)}
                                                    />
                                                </div>
                                                <Button variant="secondary" onClick={() => removeInstallmentOption(index)} style={{ padding: '8px', height: '38px', color: '#EF4444', borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}>
                                                    <Trash2 size={16} />
                                                </Button>
                                            </div>
                                        ))}
                                        {portalSettings.claim_portal_installment_options.length === 0 && (
                                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>Keine Vorschläge definiert. Der Mieter wird keine Auswahl haben.</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div style={{ padding: '16px', backgroundColor: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE', marginTop: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                    <CreditCard size={20} color="#1D4ED8" />
                                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1E40AF', margin: 0 }}>Online-Bezahlung (Stripe)</h3>
                                </div>
                                <p style={{ fontSize: '0.85rem', color: '#1E3A8A', marginBottom: '16px' }}>
                                    Ermöglichen Sie Mietern die sofortige Bezahlung per Kreditkarte, SEPA-Lastschrift oder Apple Pay.
                                </p>
                                
                                {portalSettings.stripe_connect_enabled ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#059669', fontWeight: 500, fontSize: '0.9rem' }}>
                                            <CheckCircle2 size={18} />
                                            <span>Erfolgreich mit Stripe verbunden</span>
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            Stripe Konto-ID: <code style={{ backgroundColor: 'white', padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>{portalSettings.stripe_connect_id}</code>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #BFDBFE', marginTop: '4px', marginBottom: '4px' }}>
                                            <input 
                                                type="checkbox" 
                                                id="allow_stripe" 
                                                checked={portalSettings.claim_portal_allow_stripe}
                                                onChange={(e) => setPortalSettings({ ...portalSettings, claim_portal_allow_stripe: e.target.checked })}
                                                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                            />
                                            <div>
                                                <label htmlFor="allow_stripe" style={{ fontWeight: 600, display: 'block', cursor: 'pointer', color: '#1E3A8A' }}>Stripe Direktzahlung anbieten</label>
                                                <span style={{ fontSize: '0.8rem', color: '#1D4ED8' }}>Mieter können offene Beträge direkt über den Portal-Link begleichen.</span>
                                            </div>
                                        </div>
                                        <Button 
                                            variant="secondary" 
                                            onClick={handleStripeDisconnect}
                                            disabled={isStripeConnecting}
                                            style={{ color: '#DC2626', borderColor: '#FCA5A5', backgroundColor: '#FEF2F2', width: 'fit-content' }}
                                        >
                                            Verbindung trennen
                                        </Button>
                                    </div>
                                ) : portalSettings.stripe_connect_id ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D97706', fontWeight: 500, fontSize: '0.9rem' }}>
                                            <Clock size={18} />
                                            <span>Verbindung ausstehend (Onboarding unvollständig)</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <Button 
                                                onClick={handleStripeConnect}
                                                disabled={isStripeConnecting}
                                                style={{ backgroundColor: '#D97706', color: 'white' }}
                                            >
                                                {isStripeConnecting ? 'Lade...' : 'Onboarding fortsetzen'}
                                            </Button>
                                            <Button 
                                                variant="secondary" 
                                                onClick={handleStripeDisconnect}
                                                disabled={isStripeConnecting}
                                                style={{ color: '#DC2626', borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }}
                                            >
                                                Abbrechen
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Button 
                                        onClick={handleStripeConnect} 
                                        disabled={isStripeConnecting}
                                        style={{ backgroundColor: '#635BFF', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}
                                    >
                                        {isStripeConnecting ? 'Verbinde...' : 'Mit Stripe verbinden'}
                                    </Button>
                                )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: '24px' }}>
                                <Button variant="secondary" onClick={() => setIsSettingsModalOpen(false)}>Abbrechen</Button>
                                <Button onClick={handleSavePortalSettings}>Speichern</Button>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default Claims;
