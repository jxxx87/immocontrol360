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
    const [pdfForm, setPdfForm] = useState({ type: 'Abmahnung', deadlineDays: 14 });

    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (claimId) {
            loadClaimData();
        }
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

    const handleDeleteEvent = async (eventId) => {
        if (!window.confirm('Möchten Sie dieses Ereignis wirklich löschen?')) return;
        try {
            const { error } = await supabase.from('claim_events').delete().eq('id', eventId);
            if (error) throw error;
            loadClaimData();
        } catch (err) {
            alert('Fehler beim Löschen des Ereignisses: ' + err.message);
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
            const result = await generateClaimPdf(claim, totals, items, pdfForm.type, pdfForm.deadlineDays);
            
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
                <div style={{ display: 'flex', gap: '12px' }}>
                    <Button variant="secondary" onClick={() => setIsStatusModalOpen(true)}>Status ändern</Button>
                </div>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card style={{ padding: '16px', borderLeft: '4px solid #3B82F6' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Hauptforderung offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(totals?.current_principal_open)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #F59E0B' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Gebühren offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(totals?.total_fees_open)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #10B981' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Zinsen offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatCurrency(totals?.total_interest_open)}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #EF4444', backgroundColor: '#FEF2F2' }}>
                    <div style={{ fontSize: '0.85rem', color: '#991B1B', marginBottom: '4px', fontWeight: 600 }}>Gesamt offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#991B1B' }}>{formatCurrency(totals?.total_due)}</div>
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map(item => (
                                            <tr key={item.claim_item_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>
                                                    <div>{item.claim_items?.description || item.claim_items?.item_type}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.claim_items?.period_month ? formatDate(item.claim_items.period_month) : ''}</div>
                                                </td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(item.original_amount)}</td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(item.paid_principal)}</td>
                                                <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.open_amount)}</td>
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
                                                        onClick={() => handleDeleteEvent(event.id)}
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
                                            {event.event_metadata && Object.keys(event.event_metadata).length > 0 && (
                                                <details style={{ fontSize: '0.8rem' }}>
                                                    <summary style={{ cursor: 'pointer', color: '#6B7280' }}>Details anzeigen</summary>
                                                    <pre style={{ backgroundColor: '#F3F4F6', padding: '8px', borderRadius: '4px', marginTop: '4px', overflowX: 'auto' }}>
                                                        {JSON.stringify(event.event_metadata, null, 2)}
                                                    </pre>
                                                </details>
                                            )}
                                        </div>
                                    ))}
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

                    <Card style={{ padding: '16px' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid #E5E7EB', paddingBottom: '8px' }}>Forderungsdaten</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Erstellt am</span>
                                <span>{formatDate(claim.created_at)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Zinssatz</span>
                                <span>{Number(claim.interest_rate || 5.00).toFixed(2)}% p.a.</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Mahnstufe</span>
                                <span>
                                    {claim.escalation_level === 1 ? 'Stufe 1 (Zahlungserinnerung)' : 
                                     claim.escalation_level === 2 ? 'Stufe 2 (Abmahnung)' : 
                                     claim.escalation_level === 3 ? 'Stufe 3 (Letzte Aufforderung)' : 
                                     claim.escalation_level ? `Stufe ${claim.escalation_level}` : 'Keine'}
                                </span>
                            </div>
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
        </div>
    );
};

export default ClaimDetail;
