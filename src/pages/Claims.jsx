import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { Scale, Plus, AlertCircle, CheckCircle2, Clock, Ban, ArrowRight, ArrowLeft } from 'lucide-react';

const Claims = () => {
    const [claims, setClaims] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    const [kpis, setKpis] = useState({
        openCount: 0,
        totalDue: 0,
        actionRequiredCount: 0,
        paymentPlanCount: 0
    });

    // Modal States
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createStep, setCreateStep] = useState(1);
    const [openLedgers, setOpenLedgers] = useState([]);
    const [loadingLedgers, setLoadingLedgers] = useState(false);
    const [selectedLedgerId, setSelectedLedgerId] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [form, setForm] = useState({
        fee_amount: 5.00,
        interest_rate: 5.0000,
        interest_start_date: '',
        deadline_days: 7,
        note: ''
    });

    useEffect(() => {
        loadData();
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

            // 4. Merge data
            const merged = (claimsData || []).map(claim => {
                const totals = (totalsData || []).find(t => t.claim_id === claim.id) || {};
                return { ...claim, ...totals };
            });

            setClaims(merged);
            calculateKpis(merged);

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
        } catch (err) {
            console.error('Error loading ledgers:', err);
            alert('Fehler beim Laden offener Mieten.');
        } finally {
            setLoadingLedgers(false);
        }
    };

    const openCreateModal = () => {
        setCreateStep(1);
        setSelectedLedgerId(null);
        
        const today = new Date();
        const fifthOfMonth = new Date(today.getFullYear(), today.getMonth(), 5);
        
        setForm({
            fee_amount: 5.00,
            interest_rate: 5.0000,
            interest_start_date: fifthOfMonth.toISOString().split('T')[0],
            deadline_days: 7,
            note: ''
        });
        
        setIsCreateModalOpen(true);
        loadOpenLedgers();
    };

    const handleCreateClaim = async () => {
        if (!selectedLedgerId) return;
        setIsSubmitting(true);
        try {
            const { error: rpcError } = await supabase.rpc('create_claim_from_rent_ledger', {
                p_rent_ledger_id: selectedLedgerId,
                p_fee_amount: parseFloat(form.fee_amount) || 0,
                p_interest_rate: parseFloat(form.interest_rate) || 0,
                p_interest_start_date: form.interest_start_date,
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

    const getSelectedLedger = () => {
        return openLedgers.find(l => l.id === selectedLedgerId);
    };

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
            <Card>
                <div style={{ padding: 'var(--spacing-lg)', borderBottom: '1px solid var(--border-color)' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Alle Forderungen</h2>
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
                    <div style={{ overflowX: 'auto' }}>
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
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Kosten / Zinsen</th>
                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 700, textAlign: 'right' }}>Gesamt Offen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claims.map((claim) => (
                                    <tr key={claim.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }}>
                                        <td style={{ padding: '16px', fontSize: '0.95rem', fontWeight: 500 }}>{getTenantName(claim.tenants)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{getLeaseName(claim.leases)}</td>
                                        <td style={{ padding: '16px' }}>{getStatusBadge(claim.status)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Clock size={14} />
                                                {formatDate(claim.deadline)}
                                            </div>
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
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* Create Modal */}
            <Modal isOpen={isCreateModalOpen} onClose={() => !isSubmitting && setIsCreateModalOpen(false)} title="Forderung aus offener Miete erstellen">
                <div style={{ padding: 'var(--spacing-md) 0' }}>
                    {createStep === 1 && (
                        <div>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
                                Wählen Sie eine offene Miete aus dem Mieterkonto, um den Forderungsprozess zu starten.
                            </p>
                            
                            {loadingLedgers ? (
                                <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>Lade offene Mieten...</div>
                            ) : openLedgers.length === 0 ? (
                                <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
                                    Es gibt aktuell keine offenen Mieten, die noch nicht in Bearbeitung sind.
                                </div>
                            ) : (
                                <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                                                <th style={{ padding: '12px', fontSize: '0.85rem' }}>Auswahl</th>
                                                <th style={{ padding: '12px', fontSize: '0.85rem' }}>Monat</th>
                                                <th style={{ padding: '12px', fontSize: '0.85rem' }}>Mieter / Einheit</th>
                                                <th style={{ padding: '12px', fontSize: '0.85rem', textAlign: 'right' }}>Offen</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {openLedgers.map(l => {
                                                const openAmount = Number(l.expected_rent || 0) - Number(l.paid_amount || 0);
                                                const monthStr = l.period_month ? l.period_month.substring(0, 7) : '';
                                                return (
                                                    <tr key={l.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: selectedLedgerId === l.id ? '#EFF6FF' : 'transparent' }} onClick={() => setSelectedLedgerId(l.id)}>
                                                        <td style={{ padding: '12px' }}>
                                                            <input type="radio" name="ledger_select" checked={selectedLedgerId === l.id} onChange={() => setSelectedLedgerId(l.id)} />
                                                        </td>
                                                        <td style={{ padding: '12px', fontWeight: 500 }}>{monthStr}</td>
                                                        <td style={{ padding: '12px', fontSize: '0.9rem' }}>
                                                            <div>{getTenantName(l.leases?.tenants)}</div>
                                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{getLeaseName(l.leases)}</div>
                                                        </td>
                                                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600, color: '#991B1B' }}>
                                                            {formatCurrency(openAmount)}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 'var(--spacing-lg)' }}>
                                <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>Abbrechen</Button>
                                <Button onClick={() => setCreateStep(2)} disabled={!selectedLedgerId} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    Weiter <ArrowRight size={16} />
                                </Button>
                            </div>
                        </div>
                    )}

                    {createStep === 2 && (
                        <div>
                            {(() => {
                                const l = getSelectedLedger();
                                const openAmount = l ? (Number(l.expected_rent || 0) - Number(l.paid_amount || 0)) : 0;
                                const total = openAmount + Number(form.fee_amount || 0);
                                const deadlineDate = new Date();
                                deadlineDate.setDate(deadlineDate.getDate() + Number(form.deadline_days || 0));

                                return (
                                    <>
                                        <div style={{ backgroundColor: '#F3F4F6', padding: '16px', borderRadius: '8px', marginBottom: 'var(--spacing-lg)' }}>
                                            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Zusammenfassung</h3>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                <span>Hauptforderung (Miete {l?.period_month?.substring(0,7)}):</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(openAmount)}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                <span>Mahnkosten:</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(form.fee_amount)}</span>
                                            </div>
                                            <div style={{ borderTop: '1px solid #D1D5DB', margin: '8px 0' }}></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#991B1B', fontSize: '1.1rem' }}>
                                                <span style={{ fontWeight: 600 }}>Gesamtforderung (heute):</span>
                                                <span style={{ fontWeight: 700 }}>{formatCurrency(total)}</span>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Mahnkosten (€)</label>
                                                <Input 
                                                    type="number" step="0.01" min="0" 
                                                    value={form.fee_amount} 
                                                    onChange={e => setForm({...form, fee_amount: e.target.value})} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Verzugszins ab</label>
                                                <Input 
                                                    type="date" 
                                                    value={form.interest_start_date} 
                                                    onChange={e => setForm({...form, interest_start_date: e.target.value})} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Zinssatz (%)</label>
                                                <Input 
                                                    type="number" step="0.0001" min="0" 
                                                    value={form.interest_rate} 
                                                    onChange={e => setForm({...form, interest_rate: e.target.value})} 
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
        </div>
    );
};

export default Claims;
