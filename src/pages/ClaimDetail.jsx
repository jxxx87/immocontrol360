import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { 
    ArrowLeft, Calendar, FileText, Activity, AlertCircle, 
    CheckCircle, MessageSquare, Clock, Edit, CheckCircle2, Printer, Trash2
} from 'lucide-react';
import { generateClaimPdf } from '../lib/claimPdfGenerator';

const ClaimDetail = () => {
    const { claimId } = useParams();
    const navigate = useNavigate();

    const [claim, setClaim] = useState(null);
    const [totals, setTotals] = useState(null);
    const [items, setItems] = useState([]);
    const [events, setEvents] = useState([]);
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal States
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [noteText, setNoteText] = useState('');
    
    const [isDeadlineModalOpen, setIsDeadlineModalOpen] = useState(false);
    const [deadlineForm, setDeadlineForm] = useState({ date: '', note: '' });

    const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
    const [statusForm, setStatusForm] = useState({ status: '', reason: '' });

    const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
    const [pdfForm, setPdfForm] = useState({ type: 'Zahlungserinnerung', deadlineDays: 7, targetItemId: null });

    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().split('T')[0], amount: '', note: '', paymentType: 'installment', linkToInstallment: false, installmentId: '' });

    // Ratenzahlung Modal State
    const [isPaymentPlanModalOpen, setIsPaymentPlanModalOpen] = useState(false);
    const [paymentPlanForm, setPaymentPlanForm] = useState({ 
        startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
        installmentCount: 3, 
        adjustmentAmount: 0, 
        interestRate: 5.00,
        calculationMethod: 'interest',
        note: '' 
    });
    
    const [paymentPlan, setPaymentPlan] = useState(null);
    const [installments, setInstallments] = useState([]);

    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (paymentPlanForm.calculationMethod === 'interest' && totals?.total_due && paymentPlanForm.interestRate > 0) {
            const principal = parseFloat(totals.total_due) || 0;
            const annualRate = parseFloat(paymentPlanForm.interestRate) || 0;
            const months = parseInt(paymentPlanForm.installmentCount) || 1;
            
            if (principal > 0 && annualRate > 0) {
                const r = (annualRate / 100) / 12; // monthly rate
                const pmt = (principal * r) / (1 - Math.pow(1 + r, -months));
                const totalPaid = pmt * months;
                const totalInterest = totalPaid - principal;
                setPaymentPlanForm(prev => ({ ...prev, adjustmentAmount: totalInterest.toFixed(2) }));
            } else {
                setPaymentPlanForm(prev => ({ ...prev, adjustmentAmount: 0 }));
            }
        }
    }, [paymentPlanForm.calculationMethod, paymentPlanForm.interestRate, paymentPlanForm.installmentCount, totals?.total_due]);

    useEffect(() => {
        if (claimId) {
            loadClaimData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claimId]);

    const loadClaimData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch A & E) claim + tenant + lease
            const { data: claimData, error: claimError } = await supabase
                .from('claims')
                .select(`
                    id, user_id, lease_id, tenant_id, status, escalation_level,
                    interest_start_date, interest_rate, accumulated_unpaid_interest,
                    accumulated_unpaid_fees, deadline, next_action_at, created_at,
                    tenants ( first_name, last_name, email, phone ),
                    leases ( 
                        id, start_date,
                        units ( 
                            unit_name,
                            properties ( street, house_number, zip, city, portfolio_id )
                        ) 
                    )
                `)
                .eq('id', claimId)
                .single();

            if (claimError) throw claimError;
            setClaim(claimData);

            // Fetch B) claim_totals_view
            const { data: totalsData, error: totalsError } = await supabase
                .from('claim_totals_view')
                .select('*')
                .eq('claim_id', claimId)
                .single();
            
            if (!totalsError) setTotals(totalsData);

            // Fetch C1) claim_items
            const { data: rawItems, error: rawItemsError } = await supabase
                .from('claim_items')
                .select('*')
                .eq('claim_id', claimId);

            // Fetch C2) claim_item_totals_view
            const { data: totalsItemsData, error: totalsItemsError } = await supabase
                .from('claim_item_totals_view')
                .select('*')
                .eq('claim_id', claimId);

            if (totalsItemsError) console.error('items error:', totalsItemsError);
            if (rawItemsError) console.error('raw items error:', rawItemsError);

            if (!rawItemsError && !totalsItemsError && rawItems && totalsItemsData) {
                const mergedItems = totalsItemsData.map(tv => {
                    const matchedItem = rawItems.find(ri => ri.id === tv.claim_item_id);
                    return {
                        ...tv,
                        claim_items: matchedItem
                    };
                });
                setItems(mergedItems);
            } else {
                setItems([]);
            }

            // Fetch D) claim_events
            const { data: eventsData, error: eventsError } = await supabase
                .from('claim_events')
                .select('*')
                .eq('claim_id', claimId)
                .order('event_date', { ascending: false });

            if (!eventsError) setEvents(eventsData || []);

            // Fetch E) payment_plans (active only)
            const { data: planData, error: planError } = await supabase
                .from('payment_plans')
                .select('*')
                .eq('claim_id', claimId)
                .eq('status', 'active')
                .maybeSingle();

            if (!planError && planData) {
                setPaymentPlan(planData);
                const { data: instData } = await supabase
                    .from('payment_plan_installments')
                    .select('*')
                    .eq('payment_plan_id', planData.id)
                    .order('due_date', { ascending: true });
                setInstallments(instData || []);
            } else {
                setPaymentPlan(null);
                setInstallments([]);
            }

        } catch (err) {
            console.error('Error loading claim details:', err);
            setError('Forderungsakte konnte nicht geladen werden. Möglicherweise haben Sie keine Berechtigung.');
        } finally {
            setLoading(false);
        }
    };

    const handleAddNote = async () => {
        if (!noteText.trim()) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('claim_events').insert([{
                user_id: claim.user_id,
                claim_id: claim.id,
                event_type: 'note_added',
                description: noteText,
                event_metadata: {}
            }]);
            
            if (error) throw error;
            setIsNoteModalOpen(false);
            setNoteText('');
            loadClaimData();
            alert('Notiz erfolgreich hinzugefügt');
        } catch (err) {
            alert('Fehler beim Speichern der Notiz: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteEvent = async (eventId, eventType, eventMetadata) => {
        if (!window.confirm('Möchten Sie dieses Ereignis wirklich löschen?')) return;
        try {
            // Reverse actual payment in the backend if this is a payment event
            if (eventType === 'payment_received' && eventMetadata?.payment_id) {
                const { error: rpcError } = await supabase.rpc('reverse_claim_payment', { p_payment_id: eventMetadata.payment_id });
                if (rpcError) throw rpcError;
            }

            // Reverse payment plan if this is a payment plan accepted event
            if (eventType === 'payment_plan_accepted') {
                const { error: rpcError } = await supabase.rpc('reverse_payment_plan', { p_claim_id: claim.id });
                // We ignore errors if the plan is already cancelled/deleted
                if (rpcError && !rpcError.message.includes('Kein aktiver Ratenplan')) {
                    throw rpcError;
                }
            }

            // Reverse appended claims
            if (eventType === 'note_added' && eventMetadata?.source === 'append_advanced') {
                const { error: rpcError } = await supabase.rpc('reverse_appended_claim', { p_event_id: eventId });
                if (rpcError) throw rpcError;
            }

            const { error } = await supabase.from('claim_events').delete().eq('id', eventId);
            if (error) throw error;
            
            loadClaimData();
            alert('Gelöscht und ggf. rückabgewickelt.');
        } catch (err) {
            alert('Fehler beim Löschen des Ereignisses: ' + err.message);
        }
    };

    const handleDeleteItem = async (itemId) => {
        if (!window.confirm('Möchten Sie diese Forderungsposition wirklich löschen? Wenn sie Teil eines Ratenplans ist, wird dies nicht empfohlen.')) return;
        try {
            const { error } = await supabase.rpc('delete_claim_item', { p_item_id: itemId });
            if (error) throw error;
            loadClaimData();
            alert('Position erfolgreich gelöscht.');
        } catch (err) {
            alert('Fehler beim Löschen: ' + err.message);
        }
    };

    const handleSettleItem = async (itemId) => {
        if (!window.confirm('Möchten Sie diese Position als erledigt markieren? (Eine Erlass-Zahlung wird gebucht)')) return;
        try {
            const { error } = await supabase.rpc('settle_claim_item', { p_item_id: itemId });
            if (error) throw error;
            loadClaimData();
            alert('Position erfolgreich als erledigt markiert.');
        } catch (err) {
            alert('Fehler beim Markieren: ' + err.message);
        }
    };

    const handleRecordPayment = async () => {
        if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
            alert('Bitte einen gültigen Betrag größer als 0 eingeben.');
            return;
        }
        const amount = parseFloat(paymentForm.amount);
        if (amount > totals.total_due + 0.01) {
            alert('Zahlungsbetrag darf die offene Gesamtforderung nicht übersteigen.');
            return;
        }

        // Installment cascade logic is now handled in the backend.
        // We no longer block payments larger than a single installment.

        setIsSubmitting(true);
        try {
            const targetType = paymentForm.paymentType === 'specific_item' ? 'specific_item' : 
                               (paymentForm.paymentType === 'new_item' ? 'claim_items' : 'auto');
                               
            let installmentId = null;
            if (paymentForm.paymentType === 'installment') {
                installmentId = installments.find(i => i.status !== 'paid')?.id || null;
            }

            const { error: rpcError } = await supabase.rpc('record_claim_payment', {
                p_claim_id: claimId,
                p_payment_date: paymentForm.date,
                p_amount: parseFloat(paymentForm.amount),
                p_note: paymentForm.note || '',
                p_installment_id: installmentId,
                p_target_type: targetType,
                p_target_claim_item_id: paymentForm.targetItemId || null
            });
            
            if (rpcError) {
                console.warn("SQL Error:", rpcError);
                throw rpcError; 
            }

            setIsPaymentModalOpen(false);
            setPaymentForm({ date: new Date().toISOString().split('T')[0], amount: '', note: '' });
            loadClaimData();
            alert('Zahlung wurde erfolgreich verbucht.');
        } catch (err) {
            console.error('Error recording payment:', err);
            alert('Fehler beim Buchen der Zahlung: ' + (err.message || err.details || 'Unbekannter Fehler'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateDeadline = async () => {
        if (!deadlineForm.date) return;
        setIsSubmitting(true);
        try {
            const { error: updateError } = await supabase
                .from('claims')
                .update({ 
                    deadline: deadlineForm.date,
                    next_action_at: deadlineForm.date,
                    updated_at: new Date().toISOString()
                })
                .eq('id', claim.id);

            if (updateError) throw updateError;

            const { error: eventError } = await supabase.from('claim_events').insert([{
                user_id: claim.user_id,
                claim_id: claim.id,
                event_type: 'deadline_set',
                description: 'Frist geändert',
                event_metadata: {
                    old_deadline: claim.deadline,
                    new_deadline: deadlineForm.date,
                    note: deadlineForm.note
                }
            }]);

            if (eventError) throw eventError;

            setIsDeadlineModalOpen(false);
            setDeadlineForm({ date: '', note: '' });
            loadClaimData();
            alert('Frist erfolgreich aktualisiert');
        } catch (err) {
            alert('Fehler beim Ändern der Frist: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreatePaymentPlan = async () => {
        if (!paymentPlanForm.startDate || !paymentPlanForm.installmentCount) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.rpc('create_payment_plan', {
                p_claim_id: claim.id,
                p_first_due_date: paymentPlanForm.startDate,
                p_installment_count: parseInt(paymentPlanForm.installmentCount),
                p_adjustment_amount: parseFloat(paymentPlanForm.adjustmentAmount) || 0,
                p_note: paymentPlanForm.note
            });

            if (error) throw error;

            setIsPaymentPlanModalOpen(false);
            loadClaimData();
            alert('Ratenzahlungsvereinbarung wurde erstellt');
        } catch (err) {
            alert('Fehler beim Erstellen der Ratenzahlung: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateStatus = async () => {
        if (!statusForm.status) return;
        setIsSubmitting(true);
        try {
            const updatePayload = { 
                status: statusForm.status,
                updated_at: new Date().toISOString()
            };
            if (statusForm.status === 'cancelled') {
                updatePayload.cancelled_at = new Date().toISOString();
                updatePayload.cancellation_reason = statusForm.reason;
            }

            const { error: updateError } = await supabase
                .from('claims')
                .update(updatePayload)
                .eq('id', claim.id);

            if (updateError) throw updateError;

            const { error: eventError } = await supabase.from('claim_events').insert([{
                user_id: claim.user_id,
                claim_id: claim.id,
                event_type: 'status_changed',
                description: 'Status geändert',
                event_metadata: {
                    old_status: claim.status,
                    new_status: statusForm.status,
                    reason: statusForm.reason
                }
            }]);

            if (eventError) throw eventError;

            setIsStatusModalOpen(false);
            setStatusForm({ status: '', reason: '' });
            loadClaimData();
            alert('Status erfolgreich geändert');
        } catch (err) {
            alert('Fehler beim Ändern des Status: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGeneratePdf = async () => {
        setIsSubmitting(true);
        try {
            await generateClaimPdf(claim, totals, items, pdfForm.type, pdfForm.deadlineDays, '', pdfForm.targetItemId);
            
            // Determine new escalation level based on document sent
            let newLevel = claim.escalation_level;
            if (pdfForm.type === 'Zahlungserinnerung') newLevel = 1;
            else if (pdfForm.type === 'Abmahnung' || pdfForm.type === 'Mahnung') newLevel = 2;
            else if (pdfForm.type === 'Letzte Zahlungsaufforderung') newLevel = 3;

            const updatePayload = {
                escalation_level: newLevel,
                updated_at: new Date().toISOString()
            };

            // Optional: Update Claim status to sent if it was draft or open
            if (claim.status === 'draft' || claim.status === 'open') {
                updatePayload.status = 'sent';
            }
            
            // Also update the next action deadline automatically if they set a deadline
            const newDeadline = new Date();
            newDeadline.setDate(newDeadline.getDate() + parseInt(pdfForm.deadlineDays));
            updatePayload.deadline = newDeadline.toISOString();
            updatePayload.next_action_at = newDeadline.toISOString();
            
            await supabase.from('claims').update(updatePayload).eq('id', claim.id);

            setIsPdfModalOpen(false);
            loadClaimData();
            // window.open triggers in the generator script
        } catch (err) {
            console.error(err);
            alert('Fehler beim Erstellen des PDFs: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
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
        if (!dateString) return '—';
        return new Date(dateString).toLocaleDateString('de-DE');
    };

    const translateEventType = (type) => {
        const mapping = {
            created: 'Forderung erstellt',
            status_changed: 'Status geändert',
            dunning_sent: 'Mahnung versendet',
            deadline_set: 'Frist gesetzt',
            deadline_expired: 'Frist abgelaufen',
            tenant_contacted: 'Mieter kontaktierte uns',
            payment_received: 'Zahlung erfasst',
            payment_reversed: 'Zahlung storniert',
            payment_plan_requested: 'Ratenzahlung angefragt',
            payment_plan_accepted: 'Ratenzahlung angenommen',
            payment_plan_failed: 'Ratenzahlung geplatzt',
            escalated: 'Eskaliert',
            cancelled: 'Storniert',
            archived: 'Archiviert',
            note_added: 'Notiz hinzugefügt',
            closed: 'Geschlossen'
        };
        return mapping[type] || type;
    };

    const translateStatus = (status) => {
        const mapping = {
            'open': 'Offen',
            'settled': 'Erledigt / Bezahlt',
            'cancelled': 'Storniert',
            'archived': 'Archiviert'
        };
        return mapping[status] || status;
    };

    const renderEventDetails = (event) => {
        const meta = event.event_metadata;
        if (!meta || Object.keys(meta).length === 0) return null;

        if (event.event_type === 'payment_received') {
            const isPaymentPlan = !!meta.payment_plan_id;
            
            return (
                <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    <div style={{ color: '#166534', fontWeight: 'bold', marginBottom: '8px' }}>Zahlung erfasst</div>
                    <div style={{ fontSize: '1rem', color: '#166534', fontWeight: 'bold', marginBottom: '12px' }}>+ {formatCurrency(meta.amount)} {meta.payment_date ? `am ${formatDate(meta.payment_date)}` : ''}</div>
                    
                    {isPaymentPlan ? (
                        <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #BBF7D0' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Verrechnung Ratenplan:</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>- Getilgt:</span><span>{formatCurrency(meta.amount)}</span></div>
                        </div>
                    ) : (
                        <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #BBF7D0' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Verrechnung:</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>- Mahnkosten:</span><span>{formatCurrency(meta.allocated_to_fees)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>- Verzugszinsen:</span><span>{formatCurrency(meta.allocated_to_interest)}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>- Hauptforderung:</span><span>{formatCurrency(meta.allocated_to_principal)}</span></div>
                        </div>
                    )}
                    
                    {meta.modified_installments && meta.modified_installments.length > 0 && (
                        <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #BBF7D0' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Zugeordnete Raten:</div>
                            {meta.modified_installments.map((inst, idx) => {
                                const isPaid = (inst.new_status || inst.old_status) === 'paid';
                                const label = inst.due_date ? formatDate(inst.due_date) : inst.id.substring(0,6) + '...';
                                return (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', color: '#166534' }}>
                                        <span>- Rate {label}</span>
                                        <span style={{ fontWeight: 600, color: isPaid ? '#166534' : '#92400E' }}>
                                            {isPaid ? 'Bezahlt' : 'Teilweise getilgt'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    
                    {!isPaymentPlan && (
                        <div>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Restforderung nach Zahlung:</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>- Gesamt offen:</span>
                                <span style={{ fontWeight: 'bold' }}>{formatCurrency(meta.remaining_total_due)}</span>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (event.event_type === 'payment_reversed') {
            return (
                <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '12px', borderRadius: '6px', marginTop: '8px' }}>
                    <div style={{ color: '#991B1B', fontWeight: 'bold', marginBottom: '8px', fontSize: '1rem' }}>
                        - {formatCurrency(meta.amount)} am {formatDate(meta.reversal_date || event.event_date)}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#991B1B' }}>
                        <strong>Storniert wurde:</strong>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                            <li>Ursprüngliche Zahlung vom: {formatDate(meta.original_payment_date || meta.payment_date)}</li>
                            <li>Grund: {meta.reason || 'Rücklastschrift / Manuell storniert'}</li>
                        </ul>
                    </div>
                </div>
            );
        }

        if (event.event_type === 'dunning_sent') {
            return (
                <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    {meta.document_type && <div style={{ marginBottom: '4px' }}><strong>Dokumenttyp:</strong> {meta.document_type}</div>}
                    {meta.total_due_at_generation !== undefined && (
                        <div style={{ marginBottom: '4px' }}><strong>Gesamtforderung Stand Dokument:</strong> {formatCurrency(meta.total_due_at_generation)}</div>
                    )}
                    {meta.deadline_date && (
                        <div style={{ marginBottom: '8px' }}><strong>Frist:</strong> {formatDate(meta.deadline_date)}</div>
                    )}
                    {(meta.document_url || (meta.document_path && meta.document_path.startsWith('http'))) && (
                        <Button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); window.open(meta.document_url || meta.document_path, '_blank'); }} 
                            style={{ padding: '6px 12px', fontSize: '0.8rem', marginTop: '4px', backgroundColor: '#fff', color: '#374151', border: '1px solid #D1D5DB' }}
                        >
                            PDF öffnen
                        </Button>
                    )}
                </div>
            );
        }

        if (event.event_type === 'deadline_set') {
            return (
                <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    {meta.old_deadline && <div style={{ marginBottom: '4px' }}><strong>Alte Frist:</strong> {formatDate(meta.old_deadline)}</div>}
                    <div style={{ marginBottom: '4px' }}><strong>Neue Frist:</strong> {formatDate(meta.new_deadline)}</div>
                    {meta.note && <div style={{ marginTop: '4px' }}><strong>Notiz:</strong> {meta.note}</div>}
                </div>
            );
        }

        if (event.event_type === 'status_changed') {
            return (
                <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    {meta.old_status && <div style={{ marginBottom: '4px' }}><strong>Von:</strong> {translateStatus(meta.old_status)}</div>}
                    <div style={{ marginBottom: '4px' }}><strong>Auf:</strong> {translateStatus(meta.new_status)}</div>
                    {meta.reason && <div style={{ marginTop: '4px' }}><strong>Grund:</strong> {meta.reason}</div>}
                </div>
            );
        }

        if (event.event_type === 'payment_plan_accepted') {
            return (
                <div style={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    <div style={{ color: '#0369A1', fontWeight: 'bold', marginBottom: '8px' }}>Ratenzahlungsvereinbarung aktiv</div>
                    <div style={{ marginBottom: '4px' }}><strong>Gesamtbetrag Ratenplan:</strong> {formatCurrency(meta.plan_total)}</div>
                    <div style={{ marginBottom: '4px' }}><strong>Anzahl Raten:</strong> {meta.installment_count} x {formatCurrency(meta.monthly_rate)}</div>
                    <div style={{ marginBottom: '4px' }}><strong>Laufzeit:</strong> {formatDate(meta.first_due_date)} bis {formatDate(meta.last_due_date)}</div>
                    {meta.adjustment > 0 && <div style={{ marginBottom: '4px' }}><strong>Aufschlag / Kosten:</strong> {formatCurrency(meta.adjustment)}</div>}
                    {meta.note && <div style={{ marginTop: '4px' }}><strong>Notiz:</strong> {meta.note}</div>}
                </div>
            );
        }

        // Fallback: Debug view
        return (
            <details style={{ fontSize: '0.8rem', marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', color: '#6B7280' }}>Technische Details anzeigen</summary>
                <pre style={{ backgroundColor: '#F3F4F6', padding: '8px', borderRadius: '4px', marginTop: '4px', overflowX: 'auto' }}>
                    {JSON.stringify(meta, null, 2)}
                </pre>
            </details>
        );
    };

    if (loading) return <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>Lade Forderungsakte...</div>;
    
    if (error) return (
        <div style={{ padding: 'var(--spacing-xl)' }}>
            <div style={{ padding: '16px', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: '8px' }}>
                {error}
            </div>
            <Button onClick={() => navigate('/forderungen')} style={{ marginTop: '16px' }}>Zurück zur Übersicht</Button>
        </div>
    );

    if (!claim) return null;

    const tenantName = claim.tenants ? `${claim.tenants.first_name || ''} ${claim.tenants.last_name || ''}`.trim() : '—';
    const propData = claim.leases?.units?.properties;
    const unitName = claim.leases?.units?.unit_name;
    const propertyString = propData ? `${propData.street} ${propData.house_number}, ${propData.zip} ${propData.city}` : '—';
    const unitString = unitName ? `Einheit: ${unitName}` : '—';

    const isLocked = ['settled', 'cancelled', 'archived'].includes(claim.status);

    let displayTotals = { ...totals };
    let planItems = [];
    let newItems = items;
    
    if (paymentPlan) {
        const planDate = new Date(paymentPlan.created_at);
        planItems = items.filter(item => new Date(item.claim_items?.created_at) <= planDate);
        newItems = items.filter(item => new Date(item.claim_items?.created_at) > planDate);
        
        const planPaidAmount = installments.reduce((sum, inst) => sum + Number(inst.paid_amount || 0), 0);
        const newItemsPrincipalOpen = newItems.reduce((sum, item) => sum + Number(item.open_amount || 0), 0);
        const planPrincipalOpen = Number(paymentPlan.total_amount || 0) - planPaidAmount;
        
        displayTotals = {
            current_principal_open: planPrincipalOpen + newItemsPrincipalOpen,
            total_fees_open: 0, 
            total_interest_open: 0, 
            total_due: planPrincipalOpen + newItemsPrincipalOpen
        };
    }

    return (
        <div style={{ padding: 'var(--spacing-lg)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <button 
                        onClick={() => navigate('/forderungen')}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: '12px' }}
                    >
                        <ArrowLeft size={16} /> Zurück zur Übersicht
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Forderungsakte</h1>
                        {getStatusBadge(claim.status)}
                    </div>
                </div>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card style={{ padding: '16px', borderLeft: '4px solid #3B82F6' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Hauptforderung offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(displayTotals.current_principal_open)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #F59E0B' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Gebühren offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(displayTotals.total_fees_open)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #10B981' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Zinsen offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(displayTotals.total_interest_open)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #EF4444', backgroundColor: '#FEF2F2' }}>
                    <div style={{ fontSize: '0.85rem', color: '#991B1B', marginBottom: '4px', fontWeight: 600 }}>Gesamt offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#991B1B' }}>{formatCurrency(displayTotals.total_due)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid var(--text-secondary)' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Aktuelle Frist</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Clock size={18} /> {formatDate(claim.deadline)}
                    </div>
                </Card>
            </div>

            {/* Main Content Grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-xl)', alignItems: 'flex-start' }}>
                
                {/* LEFT PANEL */}
                <div style={{ flex: '2 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                    
                    {/* Positionen */}
                    <Card>
                        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={20} color="var(--primary-color)" />
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Forderungspositionen</h2>
                        </div>
                        {items.length === 0 ? (
                            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>Keine Forderungspositionen vorhanden</div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid var(--border-color)' }}>
                                            <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Beschreibung</th>
                                            <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Ursprung</th>
                                            <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Getilgt</th>
                                            <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Offen</th>
                                            <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', width: '80px' }}>Aktionen</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paymentPlan && (() => {
                                            const planPaidAmount = installments.reduce((sum, inst) => sum + Number(inst.paid_amount || 0), 0);
                                            return (
                                            <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: '#F0FDF4' }}>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>
                                                    <div style={{ fontWeight: 600, color: '#166534' }}>Vereinbarte Ratenzahlung</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#166534', opacity: 0.8 }}>
                                                        (Ursprung: {planItems.map(i => i.claim_items?.description || i.claim_items?.item_type).join(', ')})
                                                    </div>
                                                </td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(paymentPlan.total_amount)}</td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(planPaidAmount)}</td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(paymentPlan.total_amount - planPaidAmount)}</td>
                                                <td style={{ padding: '12px 16px' }}></td>
                                            </tr>
                                        )})()}
                                        {newItems.map(item => (
                                            <tr key={item.claim_item_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>
                                                    <div>{item.claim_items?.description || item.claim_items?.item_type}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.claim_items?.period_month ? formatDate(item.claim_items.period_month) : ''}</div>
                                                </td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(item.original_amount)}</td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(item.paid_principal)}</td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.open_amount)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                        <button onClick={() => handleSettleItem(item.claim_item_id)} title="Als erledigt markieren" style={{ color: '#166534', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}><CheckCircle size={16} /></button>
                                                        <button onClick={() => handleDeleteItem(item.claim_item_id)} title="Position löschen" style={{ color: '#DC2626', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>

                    {/* Timeline */}
                    <Card>
                        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Activity size={20} color="var(--primary-color)" />
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Timeline / Ereignisse</h2>
                        </div>
                        <div style={{ padding: '24px 24px 24px 32px' }}>
                            {events.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Keine Ereignisse</div>
                            ) : (
                                <div style={{ position: 'relative' }}>
                                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: '-16px', width: '2px', backgroundColor: '#E5E7EB' }}></div>
                                    {events.map((event, index) => (
                                        <div key={event.id} style={{ position: 'relative', marginBottom: index === events.length - 1 ? 0 : '24px' }}>
                                            <div style={{ position: 'absolute', left: '-21px', top: '4px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-color)', border: '2px solid white' }}></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{translateEventType(event.event_type)}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{new Date(event.event_date).toLocaleString('de-DE')}</div>
                                                    <button 
                                                        onClick={() => handleDeleteEvent(event.id, event.event_type, event.event_metadata)}
                                                        style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                        title="Ereignis löschen"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                            {event.description && (
                                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                    {event.description}
                                                </div>
                                            )}
                                            {renderEventDetails(event)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Ratenzahlungsvereinbarung */}
                    <Card>
                        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Activity size={20} color="var(--primary-color)" />
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Ratenzahlungsvereinbarung</h2>
                        </div>
                        <div style={{ padding: '24px' }}>
                            {!paymentPlan ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Keine aktive Ratenzahlungsvereinbarung</div>
                            ) : (
                                <div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status</div>
                                            <div style={{ fontWeight: 600 }}>Aktiv</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Gesamtbetrag Ratenplan</div>
                                            <div style={{ fontWeight: 600 }}>{formatCurrency(paymentPlan.total_amount)}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Anzahl Raten</div>
                                            <div style={{ fontWeight: 600 }}>{installments.length}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Nächste Fälligkeit</div>
                                            <div style={{ fontWeight: 600 }}>{installments.find(i => i.status === 'open') ? formatDate(installments.find(i => i.status === 'open').due_date) : '-'}</div>
                                        </div>
                                    </div>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
                                            <thead>
                                                <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid var(--border-color)' }}>
                                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Fällig am</th>
                                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Betrag</th>
                                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Bezahlt</th>
                                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Offen</th>
                                                    <th style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {installments.map((inst) => (
                                                    <tr key={inst.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>{formatDate(inst.due_date)}</td>
                                                        <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(inst.amount)}</td>
                                                        <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(inst.paid_amount)}</td>
                                                        <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(inst.amount - inst.paid_amount)}</td>
                                                        <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'center' }}>
                                                            <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: inst.status === 'open' ? '#FEF3C7' : inst.status === 'partial' ? '#DBEAFE' : '#D1FAE5', color: inst.status === 'open' ? '#92400E' : inst.status === 'partial' ? '#1E40AF' : '#065F46' }}>
                                                                {inst.status === 'open' ? 'Offen' : inst.status === 'partial' ? 'Teilweise bezahlt' : 'Bezahlt'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>

                {/* RIGHT PANEL */}
                <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                    <Card style={{ padding: '16px', height: 'auto' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid #E5E7EB', paddingBottom: '8px' }}>Aktionen</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '4px' }}>
                            <Button 
                                variant="secondary" 
                                style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px' }}
                                onClick={() => {
                                    setPaymentForm({ date: new Date().toISOString().split('T')[0], amount: '', note: '' });
                                    setIsPaymentModalOpen(true);
                                }}
                                disabled={isLocked}
                            >
                                <CheckCircle size={16} /> Zahlung erfassen
                            </Button>
                            <Button 
                                variant="secondary" 
                                style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px' }}
                                onClick={() => {
                                    if (paymentPlan) {
                                        alert('Für diese Forderung besteht bereits eine aktive Ratenzahlungsvereinbarung.');
                                        return;
                                    }
                                    setPaymentPlanForm(prev => ({ ...prev, startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0] }));
                                    setIsPaymentPlanModalOpen(true);
                                }}
                                disabled={isLocked}
                            >
                                <CheckCircle size={16} /> Ratenzahlung vereinbaren
                            </Button>
                            <Button 
                                variant="secondary" 
                                style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px' }}
                                onClick={() => setIsNoteModalOpen(true)}
                            >
                                <MessageSquare size={16} /> Notiz hinzufügen
                            </Button>
                            <Button 
                                variant="secondary" 
                                style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px' }}
                                onClick={() => {
                                    setDeadlineForm({ date: claim.deadline ? claim.deadline.split('T')[0] : '', note: '' });
                                    setIsDeadlineModalOpen(true);
                                }}
                                disabled={isLocked}
                            >
                                <Calendar size={16} /> Frist ändern
                            </Button>
                            <Button 
                                variant="secondary" 
                                style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px', backgroundColor: '#FEF2F2', color: '#991B1B', borderColor: '#FCA5A5', whiteSpace: 'normal', textAlign: 'left' }}
                                onClick={() => setIsPdfModalOpen(true)}
                                disabled={isLocked}
                            >
                                <Printer size={16} style={{ flexShrink: 0 }} /> PDF erzeugen
                            </Button>
                        </div>
                    </Card>

                    <Card style={{ padding: '16px', height: 'auto' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid #E5E7EB', paddingBottom: '8px' }}>Mieter & Objekt</h3>
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mieter</div>
                            <div style={{ fontWeight: 500 }}>{tenantName}</div>
                            {(claim.tenants?.email || claim.tenants?.phone) && (
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {claim.tenants?.email && <div>{claim.tenants.email}</div>}
                                    {claim.tenants?.phone && <div>{claim.tenants.phone}</div>}
                                </div>
                            )}
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Objekt</div>
                            <div style={{ fontWeight: 500 }}>{propertyString}</div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{unitString}</div>
                        </div>
                    </Card>

                </div>
            </div>

            {/* Modals */}
            <Modal isOpen={isNoteModalOpen} onClose={() => !isSubmitting && setIsNoteModalOpen(false)} title="Notiz hinzufügen">
                <div style={{ padding: '16px 0' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Ihre Notiz</label>
                    <textarea 
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        style={{ width: '100%', minHeight: '100px', padding: '8px', borderRadius: '4px', border: '1px solid #D1D5DB' }}
                        placeholder="Zusätzliche Informationen..."
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <Button variant="secondary" onClick={() => setIsNoteModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleAddNote} disabled={isSubmitting || !noteText.trim()}>Speichern</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isDeadlineModalOpen} onClose={() => !isSubmitting && setIsDeadlineModalOpen(false)} title="Frist ändern">
                <div style={{ padding: '16px 0' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Neues Fristdatum</label>
                    <Input 
                        type="date" 
                        value={deadlineForm.date} 
                        onChange={(e) => setDeadlineForm({...deadlineForm, date: e.target.value})} 
                        style={{ marginBottom: '16px' }}
                    />
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Grund / Notiz (optional)</label>
                    <Input 
                        type="text" 
                        value={deadlineForm.note} 
                        onChange={(e) => setDeadlineForm({...deadlineForm, note: e.target.value})} 
                        placeholder="z. B. Kulanzverlängerung nach Telefonat"
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <Button variant="secondary" onClick={() => setIsDeadlineModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleUpdateDeadline} disabled={isSubmitting || !deadlineForm.date}>Frist setzen</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isStatusModalOpen} onClose={() => !isSubmitting && setIsStatusModalOpen(false)} title="Status manuell ändern">
                <div style={{ padding: '16px 0' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Neuer Status</label>
                    <select 
                        value={statusForm.status} 
                        onChange={(e) => setStatusForm({...statusForm, status: e.target.value})}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #D1D5DB', marginBottom: '16px' }}
                    >
                        <option value="">Bitte wählen...</option>
                        <option value="open">Offen</option>
                        <option value="sent">Versendet</option>
                        <option value="action_required">Aktion erforderlich</option>
                        <option value="settled">Erledigt (Manuell)</option>
                        <option value="cancelled">Storniert</option>
                    </select>
                    
                    {statusForm.status === 'cancelled' && (
                        <>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Stornierungsgrund</label>
                            <Input 
                                type="text" 
                                value={statusForm.reason} 
                                onChange={(e) => setStatusForm({...statusForm, reason: e.target.value})} 
                                placeholder="Warum wird storniert?"
                            />
                        </>
                    )}
                    
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                        <Button variant="secondary" onClick={() => setIsStatusModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleUpdateStatus} disabled={isSubmitting || !statusForm.status}>Status übernehmen</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isPdfModalOpen} onClose={() => !isSubmitting && setIsPdfModalOpen(false)} title="Mahnung / Abmahnung erzeugen">
                <div style={{ padding: '16px 0' }}>
                    <div style={{ backgroundColor: '#F3F4F6', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Erzeugt ein rechtssicheres PDF inklusive Forderungsaufstellung und Zinsberechnung auf Basis der Vorlage. Es wird automatisch ein Historien-Eintrag erstellt.
                    </div>

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Was soll gemahnt werden?</label>
                    <select 
                        value={pdfForm.targetItemId || ''} 
                        onChange={(e) => setPdfForm({...pdfForm, targetItemId: e.target.value || null})}
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #D1D5DB', marginBottom: '16px', fontSize: '0.95rem' }}
                    >
                        <option value="">Gesamte Akte (Alle offenen Positionen)</option>
                        {items.filter(i => Number(i.open_amount) > 0).map(i => (
                            <option key={i.claim_item_id} value={i.claim_item_id}>
                                {i.claim_items?.description || i.claim_items?.item_type} ({formatCurrency(i.open_amount)})
                            </option>
                        ))}
                    </select>

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Dokumenttyp</label>
                    <select 
                        value={pdfForm.type} 
                        onChange={(e) => setPdfForm({...pdfForm, type: e.target.value})}
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #D1D5DB', marginBottom: '16px', fontSize: '0.95rem' }}
                    >
                        <option value="Zahlungserinnerung">Stufe 1: Zahlungserinnerung</option>
                        <option value="Abmahnung">Stufe 2: Abmahnung wegen Zahlungsverzug</option>
                        <option value="Letzte Zahlungsaufforderung">Stufe 3: Letzte Zahlungsaufforderung</option>
                    </select>
                    
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Zahlungsfrist (Tage)</label>
                    <Input 
                        type="number" 
                        min="1"
                        value={pdfForm.deadlineDays} 
                        onChange={(e) => setPdfForm({...pdfForm, deadlineDays: e.target.value})} 
                    />
                    
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                        <Button variant="secondary" onClick={() => setIsPdfModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleGeneratePdf} disabled={isSubmitting || !pdfForm.type} style={{ backgroundColor: '#991B1B', color: 'white' }}>
                            {isSubmitting ? 'PDF wird erzeugt...' : 'PDF jetzt erzeugen'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isPaymentModalOpen} onClose={() => !isSubmitting && setIsPaymentModalOpen(false)} title="Zahlung erfassen">
                <div style={{ padding: '16px 0' }}>
                    {items.filter(item => item.open_amount > 0).length > 0 && (
                        <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE' }}>
                            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1E3A8A', marginBottom: '12px' }}>Was wird bezahlt?</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                
                                {paymentPlan && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <input 
                                            type="radio" 
                                            name="paymentType"
                                            value="installment"
                                            checked={paymentForm.paymentType === 'installment'}
                                            onChange={() => setPaymentForm({...paymentForm, paymentType: 'installment', linkToInstallment: true, targetItemId: null})}
                                        />
                                        <span style={{ fontWeight: 500 }}>Ratenplan (Rate)</span>
                                    </label>
                                )}

                                {(() => {
                                    let selectableItems = [];
                                    if (paymentPlan) {
                                        selectableItems = items.filter(item => item.open_amount > 0 && new Date(item.claim_items?.created_at) > new Date(paymentPlan.created_at));
                                    } else {
                                        selectableItems = items.filter(item => item.open_amount > 0);
                                    }

                                    return selectableItems.map(item => (
                                        <label key={item.claim_item_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <input 
                                                type="radio" 
                                                name="paymentType"
                                                value={`item_${item.claim_item_id}`}
                                                checked={paymentForm.targetItemId === item.claim_item_id}
                                                onChange={() => setPaymentForm({...paymentForm, paymentType: 'specific_item', linkToInstallment: false, targetItemId: item.claim_item_id})}
                                            />
                                            <span style={{ fontWeight: 500 }}>
                                                {item.claim_items?.description || item.claim_items?.item_type} ({formatCurrency(item.open_amount)} offen)
                                            </span>
                                        </label>
                                    ));
                                })()}
                                
                                {!paymentPlan && items.filter(item => item.open_amount > 0).length > 1 && (
                                     <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                         <input 
                                             type="radio" 
                                             name="paymentType"
                                             value="auto"
                                             checked={paymentForm.paymentType === 'auto' && !paymentForm.targetItemId}
                                             onChange={() => setPaymentForm({...paymentForm, paymentType: 'auto', linkToInstallment: false, targetItemId: null})}
                                         />
                                         <span style={{ fontWeight: 500 }}>Automatische Verteilung (Älteste zuerst)</span>
                                     </label>
                                )}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px', padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Offene Hauptforderung</div>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(paymentForm.paymentType === 'installment' ? totals?.current_principal_open : displayTotals.current_principal_open)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Offene Gebühren</div>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(paymentForm.paymentType === 'installment' ? totals?.total_fees_open : displayTotals.total_fees_open)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Offene Zinsen</div>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(paymentForm.paymentType === 'installment' ? totals?.total_interest_open : displayTotals.total_interest_open)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#991B1B', fontWeight: 600 }}>Gesamt Offen</div>
                            <div style={{ fontWeight: 700, color: '#991B1B' }}>{formatCurrency(paymentForm.paymentType === 'installment' ? totals?.total_due : displayTotals.total_due)}</div>
                        </div>
                    </div>

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Zahlungsdatum</label>
                    <Input 
                        type="date" 
                        value={paymentForm.date} 
                        onChange={(e) => setPaymentForm({...paymentForm, date: e.target.value})} 
                        style={{ marginBottom: '16px' }}
                    />
                    
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Betrag (€)</label>
                    <Input 
                        type="number" 
                        step="0.01"
                        min="0.01"
                        max={paymentForm.paymentType === 'installment' ? totals?.total_due : displayTotals.total_due}
                        value={paymentForm.amount} 
                        onChange={(e) => setPaymentForm({...paymentForm, amount: e.target.value})} 
                        style={{ marginBottom: '16px' }}
                    />

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Notiz (optional)</label>
                    <Input 
                        type="text" 
                        value={paymentForm.note} 
                        onChange={(e) => setPaymentForm({...paymentForm, note: e.target.value})} 
                        placeholder="z.B. Überweisungseingang Sparkasse"
                    />

                    {paymentForm.amount && parseFloat(paymentForm.amount) > 0 && (
                        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#166534', marginBottom: '12px' }}>Verteilungsvorschau</h4>
                            {(() => {
                                let rem = parseFloat(paymentForm.amount);
                                let allocFees = 0;
                                let allocInterest = 0;
                                
                                if (paymentForm.paymentType === 'installment' || !paymentPlan) {
                                    allocFees = Math.min(rem, totals?.total_fees_open || 0);
                                    rem -= allocFees;
                                    allocInterest = Math.min(rem, totals?.total_interest_open || 0);
                                    rem -= allocInterest;
                                }
                                
                                const allocPrincipal = rem;

                                return (
                                    <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Mahnkosten:</span>
                                            <span>{formatCurrency(allocFees)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Zinsen:</span>
                                            <span>{formatCurrency(allocInterest)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Hauptforderung:</span>
                                            <span style={{ fontWeight: 600 }}>{formatCurrency(allocPrincipal)}</span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    
                    {paymentForm.paymentType === 'installment' && paymentPlan && installments.filter(i => i.status !== 'paid').length > 0 && (
                        <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0F172A', marginBottom: '12px' }}>Ratenzahlung</h4>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', marginBottom: '12px' }}>
                                <input 
                                    type="checkbox" 
                                    checked={paymentForm.linkToInstallment}
                                    onChange={(e) => {
                                        const isChecked = e.target.checked;
                                        const openInst = installments.find(i => i.status !== 'paid');
                                        setPaymentForm({...paymentForm, linkToInstallment: isChecked, installmentId: isChecked && openInst ? openInst.id : ''});
                                    }}
                                />
                                Zahlung einer Rate zuordnen
                            </label>
                            
                            {paymentForm.linkToInstallment && (
                                <select 
                                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
                                    value={paymentForm.installmentId}
                                    onChange={(e) => setPaymentForm({...paymentForm, installmentId: e.target.value})}
                                >
                                    <option value="">-- Bitte Rate auswählen --</option>
                                    {installments.filter(i => i.status !== 'paid').map((inst) => (
                                        <option key={inst.id} value={inst.id}>
                                            Rate {installments.findIndex(x => x.id === inst.id) + 1} - fällig am {formatDate(inst.due_date)} - offen {formatCurrency(inst.amount - inst.paid_amount)}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                        <Button variant="secondary" onClick={() => setIsPaymentModalOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleRecordPayment} disabled={isSubmitting || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0}>Zahlung buchen</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isPaymentPlanModalOpen} onClose={() => !isSubmitting && setIsPaymentPlanModalOpen(false)} title="Ratenzahlung vereinbaren">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ padding: '12px', backgroundColor: '#F3F4F6', borderRadius: '8px', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span>Gesamtforderung aktuell:</span>
                            <strong>{formatCurrency(totals?.total_due)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span>Vereinbarungskosten (Aufschlag):</span>
                            <strong>{formatCurrency(paymentPlanForm.adjustmentAmount || 0)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #D1D5DB', paddingTop: '4px', marginTop: '4px' }}>
                            <span>Ratenplan gesamt:</span>
                            <strong style={{ color: '#166534' }}>{formatCurrency((parseFloat(totals?.total_due) || 0) + (parseFloat(paymentPlanForm.adjustmentAmount) || 0))}</strong>
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Startdatum (1. Rate)</label>
                        <Input 
                            type="date" 
                            value={paymentPlanForm.startDate}
                            onChange={(e) => setPaymentPlanForm({...paymentPlanForm, startDate: e.target.value})}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Anzahl Raten</label>
                        <select 
                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
                            value={paymentPlanForm.installmentCount}
                            onChange={(e) => setPaymentPlanForm({...paymentPlanForm, installmentCount: parseInt(e.target.value)})}
                        >
                            <option value="2">2 Raten</option>
                            <option value="3">3 Raten</option>
                            <option value="4">4 Raten</option>
                            <option value="6">6 Raten</option>
                            <option value="12">12 Raten</option>
                            <option value="24">24 Raten</option>
                        </select>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Kosten / Aufschlag berechnen über:</label>
                            <select 
                                style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #D1D5DB', fontSize: '0.8rem' }}
                                value={paymentPlanForm.calculationMethod}
                                onChange={(e) => setPaymentPlanForm({...paymentPlanForm, calculationMethod: e.target.value})}
                            >
                                <option value="interest">Zinssatz (p.a.)</option>
                                <option value="manual">Fester Betrag</option>
                            </select>
                        </div>
                        
                        {paymentPlanForm.calculationMethod === 'interest' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Input 
                                    type="number" 
                                    step="0.1"
                                    value={paymentPlanForm.interestRate}
                                    onChange={(e) => setPaymentPlanForm({...paymentPlanForm, interestRate: e.target.value})}
                                    style={{ flex: 1 }}
                                />
                                <span style={{ color: 'var(--text-secondary)' }}>% p.a.</span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Input 
                                    type="number" 
                                    step="0.01"
                                    value={paymentPlanForm.adjustmentAmount}
                                    onChange={(e) => setPaymentPlanForm({...paymentPlanForm, adjustmentAmount: e.target.value})}
                                    style={{ flex: 1 }}
                                />
                                <span style={{ color: 'var(--text-secondary)' }}>€</span>
                            </div>
                        )}
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Notiz (Optional)</label>
                        <Input 
                            type="text" 
                            value={paymentPlanForm.note}
                            onChange={(e) => setPaymentPlanForm({...paymentPlanForm, note: e.target.value})}
                        />
                    </div>
                    
                    <div style={{ marginTop: '8px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Vorschau:</div>
                        <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '6px', padding: '12px', fontSize: '0.85rem' }}>
                            {(() => {
                                const total = (parseFloat(totals?.total_due) || 0) + (parseFloat(paymentPlanForm.adjustmentAmount) || 0);
                                const count = paymentPlanForm.installmentCount;
                                const rate = total / count;
                                const start = new Date(paymentPlanForm.startDate);
                                const preview = [];
                                for (let i = 0; i < Math.min(count, 3); i++) {
                                    const d = new Date(start);
                                    d.setMonth(d.getMonth() + i);
                                    preview.push(
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span>Rate {i+1} am {d.toLocaleDateString('de-DE')}:</span>
                                            <strong>{formatCurrency(rate)}</strong>
                                        </div>
                                    );
                                }
                                return (
                                    <>
                                        {preview}
                                        {count > 3 && <div style={{ color: '#6B7280', marginTop: '4px' }}>... ({count - 3} weitere Raten)</div>}
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                        <Button variant="secondary" onClick={() => setIsPaymentPlanModalOpen(false)} disabled={isSubmitting}>Abbrechen</Button>
                        <Button onClick={handleCreatePaymentPlan} disabled={isSubmitting || !paymentPlanForm.startDate || !paymentPlanForm.installmentCount}>
                            {isSubmitting ? 'Wird gespeichert...' : 'Vereinbarung anlegen'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ClaimDetail;
