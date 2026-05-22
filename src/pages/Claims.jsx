import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { createPortal } from 'react-dom';
import { Scale, Plus, AlertCircle, CheckCircle2, Clock, Ban, ArrowRight, ArrowLeft, ChevronDown, ChevronRight, Edit, Trash2, Eye, MoreVertical } from 'lucide-react';

const Claims = () => {
    const navigate = useNavigate();
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

    useEffect(() => {
        loadData();
        const handleClickOutside = () => setActiveDropdown(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Call RPC to update overdue claims
            const { error: rpcError } = await supabase.rpc('update_overdue_claims_status');
            if (rpcError) {
                console.warn('Could not update overdue claims status:', rpcError);
            }

            // 2. Fetch claims with tenant and lease data
            const { data: claimsData, error: claimsError } = await supabase
                .from('claims')
                .select(`
                    id, status, escalation_level, deadline, next_action_at,
                    interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees,
                    tenants ( first_name, last_name ),
                    leases ( 
                        id, 
                        units ( 
                            unit_name,
                            properties ( street, house_number, zip, city )
                        ) 
                    )
                `)
                .order('created_at', { ascending: false });

            if (claimsError) throw claimsError;

            // 3. Fetch totals from view
            const { data: totalsData, error: totalsError } = await supabase
                .from('claim_totals_view')
                .select('*');

            if (totalsError) throw totalsError;

            // 4. Fetch active payment plans
            const { data: plansData, error: plansError } = await supabase
                .from('payment_plans')
                .select('id, claim_id, total_amount, created_at')
                .eq('status', 'active');
                
            // 5. Fetch installments for these plans
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
            const allActiveClaimIds = claimsData ? claimsData.map(c => c.id) : [];
            const { data: itemsTotalsData } = await supabase
                .from('claim_item_totals_view')
                .select('claim_item_id, claim_id, open_amount')
                .in('claim_id', allActiveClaimIds);
                
            // Fetch original items for created_at
            const { data: originalItemsData } = await supabase
                .from('claim_items')
                .select('id, created_at')
                .in('claim_id', allActiveClaimIds);

            // Merge them locally
            if (itemsTotalsData && originalItemsData) {
                allClaimItems = itemsTotalsData.map(tot => {
                    const orig = originalItemsData.find(o => o.id === tot.claim_item_id);
                    return {
                        ...tot,
                        created_at: orig ? orig.created_at : null
                    };
                });
            }

            // 6. Merge data
            const merged = (claimsData || []).map(claim => {
                let totals = (totalsData || []).find(t => t.claim_id === claim.id) || {};
                
                const claimItems = allClaimItems.filter(i => i.claim_id === claim.id);
                const itemCount = claimItems.length;

                const plan = (plansData || []).find(p => p.claim_id === claim.id);
                if (plan) {
                    const planInst = installmentsData.filter(i => i.payment_plan_id === plan.id);
                    const planPaid = planInst.reduce((sum, inst) => sum + Number(inst.paid_amount || 0), 0);
                    const planTotal = Number(plan.total_amount || 0);
                    const planOpen = planTotal - planPaid;
                    
                    const newItems = claimItems.filter(item => new Date(item.created_at) > new Date(plan.created_at || '2026-01-01'));
                    const newItemsPrincipalOpen = newItems.reduce((sum, item) => sum + Number(item.open_amount || 0), 0);
                    
                    // We override the totals for the UI to prevent double counting fees included in plan
                    totals = {
                        ...totals,
                        current_principal_original: planTotal + newItemsPrincipalOpen,
                        principal_paid: planPaid,
                        current_principal_open: planOpen + newItemsPrincipalOpen,
                        total_fees_open: 0,
                        total_interest_open: 0,
                        total_due: planOpen + newItemsPrincipalOpen
                    };
                }
                
                return { ...claim, ...totals, itemCount };
            });

            // Filter out cancelled and archived claims from the main view (optional, but good for UI)
            const activeClaims = merged.filter(c => !['cancelled', 'archived'].includes(c.status));

            setClaims(activeClaims);
            calculateKpis(activeClaims);

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

            const { data: ledgerData, error: ledgerError } = await supabase
                .from('rent_ledger')
                .select(`
                    id, period_month, expected_rent, paid_amount, due_date,
                    leases (
                        id,
                        units (
                            unit_name,
                            properties ( street, house_number, zip, city )
                        ),
                        tenants ( first_name, last_name )
                    )
                `)
                .eq('status', 'open')
                .order('period_month', { ascending: false });

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
            const { data: leasesData, error: leasesError } = await supabase
                .from('leases')
                .select(`
                    id, 
                    tenants (first_name, last_name),
                    units (unit_name, properties(street, house_number, city))
                `)
                .eq('status', 'active');
                
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

            let finalManualItems = [...manualItems];
            const feeAmount = parseFloat(form.fee_amount) || 0;
            if (feeAmount > 0) {
                finalManualItems.push({
                    description: 'Mahnkosten',
                    amount: feeAmount,
                    item_type: 'other'
                });
            }
            if (calculatedInterest > 0) {
                finalManualItems.push({
                    description: 'Verzugszinsen (bis heute)',
                    amount: calculatedInterest,
                    item_type: 'other'
                });
            }

            const { error: rpcError } = await supabase.rpc('create_claim_advanced', {
                p_lease_id: targetLeaseId,
                p_rent_ledger_ids: selectedLedgerIds.length > 0 ? selectedLedgerIds : null,
                p_manual_items: finalManualItems,
                p_fee_amount: 0,
                p_interest_rate: parseFloat(form.interest_rate) || 0,
                p_accumulated_interest: 0,
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

    const calculateKpis = (data) => {
        let openCount = 0;
        let totalDue = 0;
        let actionRequiredCount = 0;
        let paymentPlanCount = 0;

        data.forEach(claim => {
            if (!['settled', 'cancelled', 'archived'].includes(claim.status)) {
                openCount++;
                totalDue += Number(claim.total_due || 0);
            }
            if (claim.status === 'action_required') actionRequiredCount++;
            if (claim.status === 'payment_plan_active') paymentPlanCount++;
        });

        setKpis({ openCount, totalDue, actionRequiredCount, paymentPlanCount });
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
                <Button onClick={openCreateModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Plus size={18} />
                    Forderung erstellen
                </Button>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ padding: '10px', backgroundColor: '#DBEAFE', borderRadius: '12px' }}><Clock size={24} color="#1E40AF" /></div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>Offene Fälle</span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{kpis.openCount}</div>
                </Card>
                
                <Card style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ padding: '10px', backgroundColor: '#FEE2E2', borderRadius: '12px' }}><AlertCircle size={24} color="#991B1B" /></div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>Aktion erforderlich</span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#991B1B' }}>{kpis.actionRequiredCount}</div>
                </Card>

                <Card style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ padding: '10px', backgroundColor: '#FEF3C7', borderRadius: '12px' }}><Scale size={24} color="#92400E" /></div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>Gesamt Offen</span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatCurrency(kpis.totalDue)}</div>
                </Card>

                <Card style={{ padding: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <div style={{ padding: '10px', backgroundColor: '#D1FAE5', borderRadius: '12px' }}><CheckCircle2 size={24} color="#065F46" /></div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>Aktive Ratenpläne</span>
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{kpis.paymentPlanCount}</div>
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
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Rest Miete</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Kosten/Zins</th>
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
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(claim.current_principal_original)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(claim.principal_paid)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(claim.current_principal_open)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right', color: '#B45309' }}>
                                            {formatCurrency(Number(claim.total_fees_open || 0) + Number(claim.total_interest_open || 0))}
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '0.95rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {formatCurrency(claim.total_due)}
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
            <Modal isOpen={isCreateModalOpen} onClose={() => !isSubmitting && setIsCreateModalOpen(false)} title="Forderung aus offener Miete erstellen">
                <div style={{ padding: 'var(--spacing-md) 0', maxWidth: '600px' }}>
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
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Manuelle Positionen (Optional)</label>
                                                <Button 
                                                    variant="secondary" 
                                                    size="sm"
                                                    onClick={() => setManualItems([...manualItems, { description: '', amount: 0, item_type: 'other', dueDate: new Date().toISOString().split('T')[0] }])}
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                >
                                                    <Plus size={14} /> Position hinzufügen
                                                </Button>
                                            </div>
                                            
                                            {manualItems.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                                                    <Input 
                                                        placeholder="Bezeichnung (z.B. Betriebskosten 2024)" 
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
                                                        title="Fällig seit"
                                                    />
                                                    <Input 
                                                        type="number" step="0.01" 
                                                        placeholder="Betrag" 
                                                        value={item.amount}
                                                        onChange={e => {
                                                            const newItems = [...manualItems];
                                                            newItems[idx].amount = parseFloat(e.target.value) || 0;
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
        </div>
    );
};

export default Claims;
