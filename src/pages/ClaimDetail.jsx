import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import {
    ArrowLeft, Calendar, FileText, Activity, AlertCircle,
    CheckCircle, MessageSquare, CheckCircle2, Printer, Trash2, Globe
} from 'lucide-react';
import {
    generateClaimPdf, getDunningLevel, parseDeadlineDays, buildClaimPortalUrl, translateClaimError,
    toLocalDateString, parseLocalDate, addMonthsClamped, num, round2, formatDateDE, CLAIM_DOCUMENT_BUCKET
} from '../lib/claimPdfGenerator';

const STATUS_CONFIG = {
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

const LOCKED_STATUSES = ['settled', 'cancelled', 'archived'];
const FINAL_STATUSES = ['cancelled', 'archived'];
const INSTALLMENT_COUNT_OPTIONS = [2, 3, 4, 6, 12, 24];
const MAX_INSTALLMENTS = 60;
// Kennzeichnung des Historien-Eintrags, mit dem ein Ratenplan-Aufschlag als Kosten gebucht wurde
const SURCHARGE_SOURCE = 'payment_plan_surcharge';
// Gültigkeit eines neuen Mieterportal-Links (Tage)
const PORTAL_LINK_DAYS = 14;

// PostgREST: RPC existiert (noch) nicht – älterer Datenbank-Stand
const isMissingRpcError = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(String(err?.message || ''));

// Erlass/Ausbuchung (settle_claim_item): Buchung ohne Geldeingang
const isWaiverMeta = (meta) => meta?.waiver === true || meta?.waiver === 'true' || meta?.allocation_type === 'waiver';

const getFirstOfNextMonth = () => {
    const d = new Date();
    return toLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 1));
};

const createInitialPaymentForm = (hasPlan) => ({
    date: toLocalDateString(),
    amount: '',
    note: '',
    paymentType: hasPlan ? 'installment' : 'auto',
    targetItemId: null
});

const createInitialPlanForm = () => ({
    startDate: getFirstOfNextMonth(),
    installmentCount: 3,
    adjustmentAmount: 0,
    interestRate: 5.00,
    calculationMethod: 'interest',
    note: ''
});

// Ratenplan wie create_payment_plan: Monatsrate gerundet, Rest in der letzten Rate, Fälligkeit jeweils +1 Monat
const buildPlanSchedule = (total, count, startDate) => {
    const rows = [];
    const start = parseLocalDate(startDate);
    if (!start || !(count > 0) || !(total > 0)) return rows;
    const monthly = round2(total / count);
    let remaining = round2(total);
    let due = start;
    for (let i = 1; i <= count; i++) {
        const amount = i === count ? round2(remaining) : monthly;
        rows.push({ index: i, due, amount });
        remaining = round2(remaining - amount);
        due = addMonthsClamped(due, 1);
    }
    return rows;
};

const ClaimDetail = () => {
    const { claimId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [claim, setClaim] = useState(null);
    const [totals, setTotals] = useState(null);
    const [items, setItems] = useState([]);
    const [events, setEvents] = useState([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [loadWarnings, setLoadWarnings] = useState([]);

    // Modal States
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [noteText, setNoteText] = useState('');

    const [isDeadlineModalOpen, setIsDeadlineModalOpen] = useState(false);
    const [deadlineForm, setDeadlineForm] = useState({ date: '', note: '' });

    const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
    const [pdfForm, setPdfForm] = useState({ type: 'Zahlungserinnerung', deadlineDays: 7, targetItemId: null });

    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentForm, setPaymentForm] = useState(() => createInitialPaymentForm(false));

    // Ratenzahlung Modal State
    const [isPaymentPlanModalOpen, setIsPaymentPlanModalOpen] = useState(false);
    const [paymentPlanForm, setPaymentPlanForm] = useState(createInitialPlanForm);
    // Ratenzahlungsanfrage, die erst nach erfolgreicher Plan-Anlage als angenommen markiert wird
    const [pendingRequestId, setPendingRequestId] = useState(null);

    const [paymentPlan, setPaymentPlan] = useState(null);
    const [installments, setInstallments] = useState([]);

    // Portal State: claimAccessLink = Status des aktiven Links (ohne Token/PIN).
    // Token und PIN gibt es nur direkt nach dem Erzeugen (portalSecret, nur im Speicher dieser Seite).
    const [claimAccessLink, setClaimAccessLink] = useState(null);
    const [portalSecret, setPortalSecret] = useState(null);
    const [pdfNewPortalAccess, setPdfNewPortalAccess] = useState(false);
    const [paymentPlanRequests, setPaymentPlanRequests] = useState([]);
    const [isPortalModalOpen, setIsPortalModalOpen] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);

    // Aufschlag über Zinssatz berechnen (Annuität). Bei Zinssatz 0/leer wird der Aufschlag ausdrücklich auf 0 gesetzt.
    useEffect(() => {
        if (paymentPlanForm.calculationMethod !== 'interest') return;
        const principal = num(totals?.total_due);
        const annualRate = parseFloat(paymentPlanForm.interestRate);
        const months = parseInt(paymentPlanForm.installmentCount, 10);
        let adjustment = 0;
        if (principal > 0 && annualRate > 0 && months > 0) {
            const r = (annualRate / 100) / 12; // monthly rate
            const pmt = (principal * r) / (1 - Math.pow(1 + r, -months));
            adjustment = Math.max(0, round2(pmt * months - principal));
        }
        setPaymentPlanForm(prev => (round2(prev.adjustmentAmount) === adjustment && String(prev.adjustmentAmount) !== ''
            ? prev
            : { ...prev, adjustmentAmount: adjustment.toFixed(2) }));
    }, [paymentPlanForm.calculationMethod, paymentPlanForm.interestRate, paymentPlanForm.installmentCount, totals?.total_due, isPaymentPlanModalOpen]);

    useEffect(() => {
        if (claimId) {
            loadClaimData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claimId]);

    const loadClaimData = async () => {
        setLoading(true);
        setError(null);
        const failed = [];
        try {
            // Fetch A & E) claim + tenant + lease
            const { data: claimData, error: claimError } = await supabase
                .from('claims')
                .select(`
                    id, user_id, lease_id, tenant_id, status, escalation_level,
                    interest_start_date, interest_rate, accumulated_unpaid_interest,
                    accumulated_unpaid_fees, deadline, next_action_at, created_at,
                    tenants ( first_name, last_name, email, phone, street, house_number, postal_code, city ),
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

            // Fetch B) claim_totals_view – maßgebliche Summen (gleiche Quelle wie Zahlungsbuchung und Mieterportal)
            const { data: totalsData, error: totalsError } = await supabase
                .from('claim_totals_view')
                .select('*')
                .eq('claim_id', claimId)
                .maybeSingle();

            if (totalsError || !totalsData) {
                if (totalsError) console.error('totals error:', totalsError);
                failed.push('Forderungssummen');
                setTotals(null);
            } else {
                setTotals(totalsData);
            }

            // Fetch C1) claim_items + C2) claim_item_totals_view
            const [{ data: rawItems, error: rawItemsError }, { data: totalsItemsData, error: totalsItemsError }] = await Promise.all([
                supabase.from('claim_items').select('*').eq('claim_id', claimId),
                supabase.from('claim_item_totals_view').select('*').eq('claim_id', claimId)
            ]);

            if (rawItemsError || totalsItemsError) {
                console.error('items error:', rawItemsError || totalsItemsError);
                failed.push('Forderungspositionen');
                setItems([]);
            } else {
                const rawById = new Map((rawItems || []).map(ri => [ri.id, ri]));
                const mergedItems = (totalsItemsData || []).map(tv => ({
                    ...tv,
                    claim_items: rawById.get(tv.claim_item_id) || {}
                }));
                mergedItems.sort((a, b) => {
                    const pa = a.claim_items?.period_month || '';
                    const pb = b.claim_items?.period_month || '';
                    if (pa !== pb) return pa < pb ? -1 : 1;
                    return String(a.claim_items?.created_at || '').localeCompare(String(b.claim_items?.created_at || ''));
                });
                setItems(mergedItems);
            }

            // Fetch D) claim_events
            const { data: eventsData, error: eventsError } = await supabase
                .from('claim_events')
                .select('*')
                .eq('claim_id', claimId)
                .order('event_date', { ascending: false });

            if (eventsError) {
                console.error('events error:', eventsError);
                failed.push('Ereignisse');
                setEvents([]);
            } else {
                setEvents(eventsData || []);
            }

            // Fetch E) payment_plans (active only)
            const { data: planRows, error: planError } = await supabase
                .from('payment_plans')
                .select('*')
                .eq('claim_id', claimId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1);

            const planData = planRows && planRows.length > 0 ? planRows[0] : null;
            if (planError) {
                console.error('plan error:', planError);
                failed.push('Ratenzahlungsvereinbarung');
                setPaymentPlan(null);
                setInstallments([]);
            } else if (planData) {
                setPaymentPlan(planData);
                const { data: instData, error: instError } = await supabase
                    .from('payment_plan_installments')
                    .select('*')
                    .eq('payment_plan_id', planData.id)
                    .order('due_date', { ascending: true });
                if (instError) {
                    console.error('installments error:', instError);
                    failed.push('Raten');
                }
                setInstallments(instData || []);
            } else {
                setPaymentPlan(null);
                setInstallments([]);
            }

            // Fetch F) claim_access_links (nur aktiver, nicht widerrufener, nicht abgelaufener Link).
            // Nur Statusspalten: Token und PIN werden nicht (mehr) aus der Datenbank gelesen.
            const { data: linkData, error: linkError } = await supabase
                .from('claim_access_links')
                .select('id, claim_id, expires_at, revoked_at, is_active, created_at')
                .eq('claim_id', claimId)
                .eq('is_active', true)
                .is('revoked_at', null)
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (linkError) {
                console.error('link error:', linkError);
                failed.push('Portal-Link');
                setClaimAccessLink(null);
            } else {
                setClaimAccessLink(linkData);
            }

            // Fetch G) payment_plan_requests
            const { data: requestsData, error: requestsError } = await supabase
                .from('payment_plan_requests')
                .select('*')
                .eq('claim_id', claimId)
                .order('created_at', { ascending: false });

            if (requestsError) {
                console.error('requests error:', requestsError);
                failed.push('Ratenzahlungsanfragen');
                setPaymentPlanRequests([]);
            } else {
                setPaymentPlanRequests(requestsData || []);
            }

            setLoadWarnings(failed);
        } catch (err) {
            console.error('Error loading claim details:', err);
            setError('Forderungsakte konnte nicht geladen werden. Möglicherweise haben Sie keine Berechtigung.');
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    // Reine Datumswerte als lokales Datum, Zeitstempel in lokaler Zeit
    const formatDate = (dateString) => {
        if (!dateString) return '—';
        return formatDateDE(dateString) || '—';
    };

    const statusLabel = (status) => STATUS_CONFIG[status]?.label || status || '—';

    const getStatusBadge = (status) => {
        const config = STATUS_CONFIG[status] || { label: status, variant: 'default' };
        return <Badge variant={config.variant}>{config.label}</Badge>;
    };

    const isOwnClaim = !!(claim && user && claim.user_id === user.id);

    // Token und PIN des aktiven Links sind nur bekannt, wenn er auf dieser Seite gerade erzeugt wurde
    const portalSecretActive = !!(portalSecret && claimAccessLink && portalSecret.linkId === claimAccessLink.id);

    const openPdfModal = () => {
        // Bestehender Link ohne bekannte PIN: für das neue Schreiben standardmäßig neuen Zugang erzeugen
        setPdfNewPortalAccess(!!claimAccessLink && !portalSecretActive);
        setIsPdfModalOpen(true);
    };

    // Zahlungen bucht record_claim_payment derzeit nur für den Eigentümer der Forderung
    const paymentErrorMessage = (err) => {
        const raw = String(err?.message || '');
        if (!isOwnClaim && /Forderung nicht gefunden|Rate nicht gefunden/i.test(raw)) {
            return 'Zahlungen können derzeit nur vom Eigentümer der Forderung gebucht werden.';
        }
        return translateClaimError(err, 'Unbekannter Fehler');
    };

    const handleAddNote = async () => {
        if (!noteText.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('claim_events').insert([{
                user_id: claim.user_id,
                claim_id: claim.id,
                event_type: 'note_added',
                description: noteText.trim(),
                event_metadata: {}
            }]);

            if (error) throw error;
            setIsNoteModalOpen(false);
            setNoteText('');
            loadClaimData();
            alert('Notiz erfolgreich hinzugefügt');
        } catch (err) {
            alert('Fehler beim Speichern der Notiz: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Kryptografisch zufällige 6-stellige PIN (100000–999999, ohne Modulo-Verzerrung)
    const generatePin = () => {
        const range = 900000;
        const limit = Math.floor(0x100000000 / range) * range;
        const buf = new Uint32Array(1);
        let value;
        do {
            crypto.getRandomValues(buf);
            value = buf[0];
        } while (value >= limit);
        return String(100000 + (value % range));
    };

    // Neuer Portal-Zugang. Die Datenbank speichert nur Hashes; Token und PIN gibt es nur in
    // dieser Antwort. Ältere Datenbank ohne create_claim_portal_link: bisheriger Weg, Token und
    // PIN werden dann im Browser erzeugt (generate_claim_access_link übernimmt gültige Werte).
    const createPortalAccess = async () => {
        const { data, error } = await supabase.rpc('create_claim_portal_link', {
            p_claim_id: claim.id,
            p_expires_days: PORTAL_LINK_DAYS
        });
        if (!error) {
            if (!data?.link_id || !data?.token || !data?.pin) {
                throw new Error('Der Portal-Link konnte nicht erzeugt werden.');
            }
            return { linkId: data.link_id, token: data.token, pin: String(data.pin) };
        }
        if (!isMissingRpcError(error)) throw error;

        const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const pin = generatePin();
        const { data: linkId, error: legacyError } = await supabase.rpc('generate_claim_access_link', {
            p_claim_id: claim.id,
            p_token: token,
            p_pin: pin,
            p_expires_days: PORTAL_LINK_DAYS
        });
        if (legacyError) throw legacyError;
        if (!linkId) throw new Error('Der Portal-Link konnte nicht erzeugt werden.');
        return { linkId, token, pin };
    };

    const handleCreatePortalLink = async () => {
        if (isSubmitting) return;
        if (claimAccessLink && !window.confirm(
            'Neuen Portal-Link erzeugen?\n\nDer bisherige Link und die bisherige PIN werden sofort ungültig. ' +
            'QR-Code und Zugangscode auf bereits verschickten Schreiben funktionieren danach nicht mehr.'
        )) return;
        setIsSubmitting(true);
        try {
            const secret = await createPortalAccess();
            setPortalSecret(secret);
            await loadClaimData();
            // Link und PIN sind nur jetzt sichtbar – direkt anzeigen
            setIsPortalModalOpen(true);
        } catch (err) {
            console.error(err);
            alert('Fehler beim Erstellen des Links: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRevokePortalLink = async () => {
        if (!claimAccessLink || isSubmitting) return;
        if (!window.confirm('Möchten Sie diesen Link wirklich widerrufen? Der Mieter kann die Forderung danach nicht mehr über das Portal einsehen.')) return;
        setIsSubmitting(true);
        try {
            // is_active=false sperrt den Link sofort auch für get_public_claim_by_token
            const { data, error } = await supabase
                .from('claim_access_links')
                .update({ revoked_at: new Date().toISOString(), is_active: false })
                .eq('id', claimAccessLink.id)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Der Link konnte nicht widerrufen werden (keine Berechtigung).');
            }
            setClaimAccessLink(null);
            setPortalSecret(null);
            alert('Link wurde widerrufen.');
        } catch (err) {
            console.error(err);
            alert('Fehler beim Widerrufen: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const copyToClipboard = async (text) => {
        try {
            if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(text);
            alert('Link kopiert!');
        } catch {
            alert('Der Link konnte nicht automatisch kopiert werden. Bitte markieren Sie ihn und kopieren Sie ihn manuell.');
        }
    };

    // Annehmen: erst Ratenplan anlegen – der Anfrage-Status wird erst nach erfolgreicher Anlage gesetzt
    const handleAcceptPaymentPlanRequest = (request) => {
        if (paymentPlan) {
            alert('Für diese Forderung besteht bereits eine aktive Ratenzahlungsvereinbarung.');
            return;
        }
        const requestedMonths = parseInt(request.requested_months, 10);
        setPaymentPlanForm({
            ...createInitialPlanForm(),
            installmentCount: Number.isInteger(requestedMonths) && requestedMonths > 0 ? requestedMonths : 3,
            adjustmentAmount: Math.max(0, round2(request.adjustment_amount)).toFixed(2),
            calculationMethod: 'manual',
            note: 'Ratenzahlungsanfrage angenommen'
        });
        setPendingRequestId(request.id);
        setIsPaymentPlanModalOpen(true);
    };

    const handleRejectPaymentPlanRequest = async (request) => {
        if (isSubmitting) return;
        if (!window.confirm(`Ratenzahlungsanfrage über ${request.requested_months} Monate ablehnen?`)) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase
                .from('payment_plan_requests')
                .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: user?.id || null })
                .eq('id', request.id);

            if (error) throw error;
            alert('Anfrage wurde abgelehnt.');
            loadClaimData();
        } catch (err) {
            console.error(err);
            alert('Fehler beim Aktualisieren der Anfrage: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeletePaymentPlanRequest = async (requestId) => {
        if (isSubmitting) return;
        if (!window.confirm('Möchten Sie diese Ratenzahlungsanfrage wirklich löschen?')) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('payment_plan_requests').delete().eq('id', requestId);
            if (error) throw error;
            loadClaimData();
        } catch (err) {
            console.error(err);
            alert('Fehler beim Löschen der Anfrage: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Ableitungen für Anzeige und Prüfungen ────────────────────────────────
    const isLocked = !!claim && LOCKED_STATUSES.includes(claim.status);
    const isFinal = !!claim && FINAL_STATUSES.includes(claim.status);

    // Gleiche Regel wie record_claim_payment: Positionen bis zur Plananlage gehören zum Ratenplan
    const isPlanItem = (item) => !!paymentPlan && new Date(item.claim_items?.created_at) <= new Date(paymentPlan.created_at);
    // Neuere Ereignisse tragen die Plan-ID, ältere werden über den Zeitstempel der Plananlage zugeordnet
    const isEventOfActivePlan = (event) => !!paymentPlan && (event.event_metadata?.payment_plan_id
        ? event.event_metadata.payment_plan_id === paymentPlan.id
        : Math.abs(new Date(event.event_date) - new Date(paymentPlan.created_at)) < 5000);

    const feesPaid = num(totals?.fees_paid);
    const interestPaid = num(totals?.interest_paid);
    const feesOpen = num(totals?.total_fees_open);
    const interestOpen = num(totals?.total_interest_open);
    const principalOpen = num(totals?.current_principal_open);
    const totalDue = num(totals?.total_due);

    const planPaidAmount = installments.reduce((sum, inst) => sum + num(inst.paid_amount), 0);
    const planTotal = num(paymentPlan?.total_amount);
    const planOpen = Math.max(0, round2(planTotal - planPaidAmount));
    const unpaidInstallments = installments.filter(i => !['paid', 'cancelled'].includes(i.status));
    const nextOpenInstallment = unpaidInstallments[0] || null;
    const hasPaidInstallments = installments.some(i => num(i.paid_amount) > 0);
    const planExceedsClaim = !!paymentPlan && !!totals && planOpen > totalDue + 0.01;
    const planItemsPrincipalOpen = items.filter(isPlanItem).reduce((sum, i) => sum + num(i.open_amount), 0);

    // Offene Gebühren/Zinsen einer Position so, wie record_claim_payment sie bei 'specific_item' verrechnet
    const getItemFeeInterestOpen = (item) => ({
        fee: Math.max(0, num(item?.claim_items?.fee_amount) - feesPaid),
        interest: Math.max(0, num(item?.claim_items?.interest_amount) - interestPaid)
    });

    const reversedPaymentIds = new Set(
        events.filter(e => e.event_type === 'payment_reversed')
            .map(e => e.event_metadata?.payment_id || e.event_metadata?.original_payment_id)
            .filter(Boolean)
    );
    const latestReversiblePaymentEvent = events.find(e => e.event_type === 'payment_received'
        && e.event_metadata?.payment_id && !reversedPaymentIds.has(e.event_metadata.payment_id));

    // Rückabgewickelte Vorgänge bleiben in der Historie und werden gekennzeichnet
    const reversedPlanIds = new Set(
        events.filter(e => e.event_type === 'note_added' && e.event_metadata?.source === 'payment_plan_reversed')
            .map(e => e.event_metadata?.payment_plan_id)
            .filter(Boolean)
    );
    const reversedAppendEventIds = new Set(
        events.filter(e => e.event_type === 'note_added' && e.event_metadata?.source === 'append_reversed')
            .map(e => e.event_metadata?.reversed_event_id)
            .filter(Boolean)
    );

    // Erlass/Ausbuchung je Position: aus claim_item_totals_view.waived_principal; bei älterem
    // Datenbankstand ohne diese Spalte aus den (nicht stornierten) Erlass-Einträgen der Historie
    const waivedFromEvents = new Map();
    events.forEach(e => {
        const meta = e.event_metadata || {};
        if (e.event_type !== 'payment_received' || !isWaiverMeta(meta) || !meta.target_item_id) return;
        if (meta.payment_id && reversedPaymentIds.has(meta.payment_id)) return;
        waivedFromEvents.set(meta.target_item_id,
            round2(num(waivedFromEvents.get(meta.target_item_id)) + num(meta.allocated_to_principal ?? meta.amount)));
    });
    const getItemWaived = (item) => (item && item.waived_principal !== undefined && item.waived_principal !== null
        ? num(item.waived_principal)
        : num(waivedFromEvents.get(item?.claim_item_id)));
    const principalWaived = totals && totals.principal_waived !== undefined && totals.principal_waived !== null
        ? num(totals.principal_waived)
        : round2(items.reduce((sum, i) => sum + getItemWaived(i), 0));

    // Welche Historien-Einträge dürfen gelöscht/storniert werden? Mahn- und Systemereignisse bleiben unveränderlich.
    const getEventDeletePolicy = (event) => {
        if (!claim || isFinal) return { allowed: false };
        const meta = event.event_metadata || {};
        if (event.event_type === 'payment_received') {
            if (!meta.payment_id || reversedPaymentIds.has(meta.payment_id)) return { allowed: false };
            if (latestReversiblePaymentEvent && latestReversiblePaymentEvent.id !== event.id) {
                return { allowed: false, reason: 'Bitte zuerst die neueren Zahlungen stornieren.' };
            }
            return { allowed: true, kind: 'payment', title: 'Zahlung stornieren' };
        }
        if (event.event_type === 'payment_plan_accepted') {
            if (isLocked || !isEventOfActivePlan(event)) return { allowed: false };
            if (hasPaidInstallments) return { allowed: false, reason: 'Auf den Ratenplan wurden bereits Zahlungen gebucht. Bitte zuerst diese Zahlungen stornieren.' };
            return { allowed: true, kind: 'plan', title: 'Ratenplan aufheben' };
        }
        if (event.event_type === 'note_added') {
            if (meta.source === 'append_advanced') {
                if (isLocked || reversedAppendEventIds.has(event.id)) return { allowed: false };
                // Vor der Plananlage angehängte Positionen gehören zum aktiven Ratenplan
                if (paymentPlan && new Date(event.event_date) <= new Date(paymentPlan.created_at)) return { allowed: false };
                return { allowed: true, kind: 'append', title: 'Angehängte Positionen entfernen' };
            }
            if (meta.source || meta.item_id) return { allowed: false };
            return { allowed: true, kind: 'note', title: 'Notiz löschen' };
        }
        return { allowed: false };
    };

    const readClaimFees = async () => {
        const { data, error } = await supabase.from('claims').select('accumulated_unpaid_fees').eq('id', claim.id).single();
        if (error) throw error;
        return num(data?.accumulated_unpaid_fees);
    };

    const handleDeleteEvent = async (event) => {
        if (isSubmitting) return;
        const policy = getEventDeletePolicy(event);
        if (!policy.allowed) {
            if (policy.reason) alert(policy.reason);
            return;
        }
        const meta = event.event_metadata || {};
        let confirmText = 'Möchten Sie diesen Eintrag wirklich löschen?';
        if (policy.kind === 'payment') {
            confirmText = `Zahlung über ${formatCurrency(meta.amount)}${meta.payment_date ? ` vom ${formatDate(meta.payment_date)}` : ''} stornieren?\n\n` +
                'Die Buchung wird vollständig rückgängig gemacht (einschließlich der Verrechnung im Mietkonto und ggf. der Raten).';
        } else if (policy.kind === 'plan') {
            const surchargeMarker = events.find(e => e.event_type === 'note_added' && e.event_metadata?.source === SURCHARGE_SOURCE && e.event_metadata?.payment_plan_id === paymentPlan?.id);
            confirmText = 'Ratenzahlungsvereinbarung aufheben?\n\n' +
                'Der aktive Ratenplan und alle Raten werden gelöscht, die Forderung wird wieder auf „Offen“ gesetzt.' +
                (surchargeMarker ? `\nDer als Kosten gebuchte Aufschlag (${formatCurrency(surchargeMarker.event_metadata?.amount)}) wird wieder ausgebucht.` : '');
        } else if (policy.kind === 'append') {
            confirmText = 'Nachträglich angehängte Positionen entfernen?\n\nDie Positionen sowie die dabei berechneten Mahnkosten und Zinsen werden aus der Forderungsakte entfernt.';
        } else if (policy.kind === 'note') {
            confirmText = 'Möchten Sie diese Notiz wirklich löschen?';
        }
        if (!window.confirm(confirmText)) return;

        setIsSubmitting(true);
        const notices = [];
        try {
            if (policy.kind === 'payment') {
                const { error: rpcError } = await supabase.rpc('reverse_claim_payment', { p_payment_id: meta.payment_id });
                if (rpcError) throw rpcError;
            }

            if (policy.kind === 'plan') {
                const planId = paymentPlan?.id;
                const marker = events.find(e => e.event_type === 'note_added' && e.event_metadata?.source === SURCHARGE_SOURCE && e.event_metadata?.payment_plan_id === planId);
                const feesBefore = marker ? await readClaimFees() : 0;
                const { error: rpcError } = await supabase.rpc('reverse_payment_plan', { p_claim_id: claim.id });
                if (rpcError && !String(rpcError.message || '').includes('Kein aktiver Ratenplan')) {
                    throw rpcError;
                }
                if (marker) {
                    // Aufschlag zurückbuchen, sofern der Server das nicht bereits getan hat
                    const amount = round2(marker.event_metadata?.amount);
                    const feesAfter = await readClaimFees();
                    if (amount > 0 && feesBefore - feesAfter < amount - 0.005) {
                        const { data: upd, error: updError } = await supabase
                            .from('claims')
                            .update({ accumulated_unpaid_fees: Math.max(0, round2(feesAfter - amount)), updated_at: new Date().toISOString() })
                            .eq('id', claim.id)
                            .eq('accumulated_unpaid_fees', feesAfter)
                            .select('id');
                        if (updError || !upd || upd.length === 0) {
                            notices.push(`Der Ratenplan wurde aufgehoben, der Aufschlag (${formatCurrency(amount)}) konnte aber nicht automatisch ausgebucht werden. Bitte die Mahnkosten über „Bearbeiten“ in der Forderungsliste korrigieren.`);
                        }
                    }
                    // Der Aufschlag-Eintrag bleibt als Nachweis in der Historie
                }
            }

            if (policy.kind === 'append') {
                const appendedLedgerIds = (Array.isArray(meta.items) ? meta.items : []).map(i => i?.rent_ledger_id).filter(Boolean);
                const eventTime = new Date(event.event_date).getTime();
                const { error: rpcError } = await supabase.rpc('reverse_appended_claim', { p_event_id: event.id });
                if (rpcError) throw rpcError;

                // reverse_appended_claim erkennt gebündelte Mietpositionen (rent_ledger_ids) derzeit nicht:
                // verbliebene, im selben Vorgang angehängte Positionen hier gezielt entfernen.
                if (appendedLedgerIds.length > 0) {
                    const { data: leftovers, error: leftoverError } = await supabase
                        .from('claim_items')
                        .select('id, created_at, description')
                        .eq('claim_id', claim.id)
                        .overlaps('rent_ledger_ids', appendedLedgerIds);
                    if (leftoverError) {
                        notices.push('Bitte prüfen Sie, ob die angehängten Mietpositionen entfernt wurden.');
                    } else {
                        const candidates = (leftovers || []).filter(ci => Math.abs(new Date(ci.created_at).getTime() - eventTime) < 5000);
                        for (const ci of candidates) {
                            const totalsRow = items.find(i => i.claim_item_id === ci.id);
                            if (num(totalsRow?.paid_principal) > 0) {
                                notices.push(`Die Position „${ci.description || 'Mietrückstand'}“ hat bereits Zahlungen und wurde nicht entfernt.`);
                                continue;
                            }
                            const { error: deleteItemError } = await supabase.rpc('delete_claim_item', { p_item_id: ci.id });
                            if (deleteItemError) {
                                notices.push(`Die Position „${ci.description || 'Mietrückstand'}“ konnte nicht entfernt werden: ${translateClaimError(deleteItemError)}`);
                            }
                        }
                    }
                }
            }

            // Nur eigene Notizen werden gelöscht. Stornierte Zahlungen, aufgehobene Ratenpläne und
            // rückgängig gemachte Nachträge bleiben als Nachweis in der Historie und werden gekennzeichnet.
            if (policy.kind === 'note') {
                const { data: deleted, error: deleteError } = await supabase
                    .from('claim_events')
                    .delete()
                    .eq('id', event.id)
                    .select('id');
                if (deleteError) throw deleteError;
                if (!deleted || deleted.length === 0) {
                    throw new Error('Die Notiz konnte nicht gelöscht werden (keine Berechtigung).');
                }
            }

            await loadClaimData();
            alert([policy.kind === 'note' ? 'Notiz gelöscht.' : 'Rückabwicklung erfolgreich durchgeführt.', ...notices].join('\n\n'));
        } catch (err) {
            await loadClaimData();
            alert('Fehler bei der Rückabwicklung: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteItem = async (item) => {
        if (isSubmitting || isLocked) return;
        if (num(item.paid_principal) > 0) {
            alert('Diese Position hat bereits Zahlungen und kann nicht gelöscht werden. Bitte zuerst die betreffenden Zahlungen stornieren.');
            return;
        }
        if (isPlanItem(item)) {
            alert('Diese Position gehört zur aktiven Ratenzahlungsvereinbarung. Bitte zuerst den Ratenplan aufheben.');
            return;
        }
        if (items.length <= 1) {
            alert('Die letzte Position einer Forderung kann nicht gelöscht werden. Bitte stornieren Sie stattdessen die Forderung.');
            return;
        }
        if (!window.confirm(`Forderungsposition „${item.claim_items?.description || item.claim_items?.item_type || 'Position'}“ (${formatCurrency(item.original_amount)}) wirklich löschen?`)) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.rpc('delete_claim_item', { p_item_id: item.claim_item_id });
            if (error) throw error;
            await loadClaimData();
            alert('Position erfolgreich gelöscht.');
        } catch (err) {
            alert('Fehler beim Löschen: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSettleItem = async (item) => {
        if (isSubmitting || isLocked) return;
        if (isPlanItem(item)) {
            alert('Diese Position gehört zur aktiven Ratenzahlungsvereinbarung und kann nicht einzeln ausgebucht werden.');
            return;
        }
        if (!window.confirm(`Restbetrag ${formatCurrency(item.open_amount)} der Position „${item.claim_items?.description || item.claim_items?.item_type || 'Position'}“ als erledigt markieren?\n\nEs wird eine Ausbuchung (Erlass) über den offenen Betrag gebucht.`)) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.rpc('settle_claim_item', { p_item_id: item.claim_item_id });
            if (error) throw error;
            await loadClaimData();
            alert('Position erfolgreich als erledigt markiert.');
        } catch (err) {
            alert('Fehler beim Markieren: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const openPaymentModal = () => {
        setPaymentForm(createInitialPaymentForm(!!paymentPlan));
        setIsPaymentModalOpen(true);
    };

    const handleRecordPayment = async () => {
        if (isSubmitting) return;
        if (!totals) {
            alert('Die Forderungssummen sind nicht geladen. Bitte laden Sie die Seite neu.');
            return;
        }
        const amount = round2(parseFloat(paymentForm.amount));
        if (!(amount > 0)) {
            alert('Bitte einen gültigen Betrag größer als 0 eingeben.');
            return;
        }
        if (!parseLocalDate(paymentForm.date)) {
            alert('Bitte ein gültiges Zahlungsdatum angeben.');
            return;
        }
        if (paymentForm.date > toLocalDateString()) {
            alert('Das Zahlungsdatum darf nicht in der Zukunft liegen.');
            return;
        }

        const isSpecific = paymentForm.paymentType === 'specific_item' && !!paymentForm.targetItemId;
        if (isSpecific) {
            const targetItem = items.find(i => i.claim_item_id === paymentForm.targetItemId);
            if (!targetItem) {
                alert('Die gewählte Position wurde nicht gefunden. Bitte die Seite neu laden.');
                return;
            }
            const open = getItemFeeInterestOpen(targetItem);
            const maxForItem = round2(num(targetItem.open_amount) + open.fee + open.interest);
            if (amount > maxForItem + 0.01) {
                alert(`Der Betrag übersteigt den offenen Betrag dieser Position (${formatCurrency(maxForItem)}). Bitte einen kleineren Betrag eingeben oder eine andere Zuordnung wählen.`);
                return;
            }
        }

        if (amount > totalDue + 0.01) {
            if (paymentPlan && amount <= planOpen + 0.01) {
                alert(`Der Betrag übersteigt die gebuchte Forderung (${formatCurrency(totalDue)}). Der Ratenplan enthält vermutlich einen Aufschlag, der nicht als Kosten in der Forderung gebucht ist. Bitte höchstens ${formatCurrency(totalDue)} buchen.`);
            } else {
                alert(`Zahlungsbetrag darf die offene Gesamtforderung (${formatCurrency(totalDue)}) nicht übersteigen.`);
            }
            return;
        }

        setIsSubmitting(true);
        try {
            // Raten werden serverseitig immer ab der ältesten offenen Rate verrechnet
            let installmentId = null;
            if (paymentForm.paymentType === 'installment' && paymentPlan) {
                installmentId = nextOpenInstallment?.id || null;
            }

            const { error: rpcError } = await supabase.rpc('record_claim_payment', {
                p_claim_id: claim.id,
                p_payment_date: paymentForm.date,
                p_amount: amount,
                p_note: paymentForm.note || '',
                p_installment_id: installmentId,
                p_target_type: isSpecific ? 'specific_item' : 'auto',
                p_target_claim_item_id: isSpecific ? paymentForm.targetItemId : null
            });

            if (rpcError) throw rpcError;

            setIsPaymentModalOpen(false);
            setPaymentForm(createInitialPaymentForm(!!paymentPlan));
            await loadClaimData();
            alert('Zahlung wurde erfolgreich verbucht.');
        } catch (err) {
            console.error('Error recording payment:', err);
            alert('Fehler beim Buchen der Zahlung: ' + paymentErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateDeadline = async () => {
        if (!deadlineForm.date || isSubmitting) return;
        if (!parseLocalDate(deadlineForm.date)) {
            alert('Bitte ein gültiges Datum angeben.');
            return;
        }
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
            alert('Fehler beim Ändern der Frist: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Ratenplan-Aufschlag als Kosten in die Forderung buchen, damit alle Raten (inkl. Aufschlag) verbucht werden können.
    // Bucht der Server den Aufschlag künftig selbst, wird das am Gebührenstand erkannt und hier übersprungen.
    const bookPlanSurcharge = async (planIdResult, adjustment, feesBefore) => {
        let feesAfter;
        try {
            feesAfter = await readClaimFees();
        } catch {
            return 'Hinweis: Es konnte nicht geprüft werden, ob der Aufschlag als Kosten in der Forderung gebucht ist.';
        }
        if (feesAfter - feesBefore >= adjustment - 0.005) return null;

        const { data: upd, error: updError } = await supabase
            .from('claims')
            .update({ accumulated_unpaid_fees: round2(feesAfter + adjustment), updated_at: new Date().toISOString() })
            .eq('id', claim.id)
            .eq('accumulated_unpaid_fees', feesAfter)
            .select('id');
        if (updError || !upd || upd.length === 0) {
            return `Achtung: Der Aufschlag (${formatCurrency(adjustment)}) konnte nicht als Kosten in die Forderung gebucht werden. Die letzte Rate lässt sich dann ggf. nicht vollständig buchen.`;
        }

        let planId = typeof planIdResult === 'string' ? planIdResult : null;
        if (!planId) {
            const { data: rows } = await supabase
                .from('payment_plans')
                .select('id')
                .eq('claim_id', claim.id)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1);
            planId = rows && rows.length > 0 ? rows[0].id : null;
        }
        const { error: eventError } = await supabase.from('claim_events').insert([{
            user_id: claim.user_id,
            claim_id: claim.id,
            event_type: 'note_added',
            description: `Aufschlag aus der Ratenzahlungsvereinbarung (${formatCurrency(adjustment)}) als Kosten in die Forderung gebucht`,
            event_metadata: { source: SURCHARGE_SOURCE, payment_plan_id: planId, amount: adjustment }
        }]);
        if (eventError) {
            return 'Hinweis: Der Aufschlag wurde als Kosten gebucht, der zugehörige Historien-Eintrag konnte aber nicht gespeichert werden.';
        }
        return null;
    };

    const closePaymentPlanModal = () => {
        if (isSubmitting) return;
        setIsPaymentPlanModalOpen(false);
        setPendingRequestId(null);
    };

    const handleCreatePaymentPlan = async () => {
        if (isSubmitting) return;
        if (!totals) {
            alert('Die Forderungssummen sind nicht geladen. Bitte laden Sie die Seite neu.');
            return;
        }
        if (!parseLocalDate(paymentPlanForm.startDate)) {
            alert('Bitte ein gültiges Startdatum für die erste Rate angeben.');
            return;
        }
        if (paymentPlanForm.startDate < toLocalDateString()) {
            alert('Das Startdatum der ersten Rate darf nicht in der Vergangenheit liegen.');
            return;
        }
        const count = Number(paymentPlanForm.installmentCount);
        if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
            alert(`Bitte eine Ratenanzahl zwischen 1 und ${MAX_INSTALLMENTS} wählen.`);
            return;
        }
        const adjustmentRaw = paymentPlanForm.adjustmentAmount === '' ? 0 : parseFloat(paymentPlanForm.adjustmentAmount);
        if (!Number.isFinite(adjustmentRaw) || adjustmentRaw < 0) {
            alert('Der Aufschlag muss 0 oder ein positiver Betrag sein.');
            return;
        }
        const adjustment = round2(adjustmentRaw);
        if (!(totalDue > 0)) {
            alert('Für diese Forderung ist kein Betrag offen.');
            return;
        }

        setIsSubmitting(true);
        try {
            const feesBefore = await readClaimFees();
            const { data: planIdResult, error } = await supabase.rpc('create_payment_plan', {
                p_claim_id: claim.id,
                p_first_due_date: paymentPlanForm.startDate,
                p_installment_count: count,
                p_adjustment_amount: adjustment,
                p_note: paymentPlanForm.note || ''
            });

            if (error) throw error;

            const notices = [];
            if (adjustment > 0) {
                const surchargeNotice = await bookPlanSurcharge(planIdResult, adjustment, feesBefore);
                if (surchargeNotice) notices.push(surchargeNotice);
            }

            if (pendingRequestId) {
                const { error: requestError } = await supabase
                    .from('payment_plan_requests')
                    .update({ status: 'accepted', decided_at: new Date().toISOString(), decided_by: user?.id || null })
                    .eq('id', pendingRequestId);
                if (requestError) {
                    notices.push('Die Ratenzahlungsanfrage konnte nicht als angenommen markiert werden: ' + translateClaimError(requestError));
                }
            }

            setPendingRequestId(null);
            setIsPaymentPlanModalOpen(false);
            await loadClaimData();
            alert(['Ratenzahlungsvereinbarung wurde erstellt.', ...notices].join('\n\n'));
        } catch (err) {
            alert('Fehler beim Erstellen der Ratenzahlung: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGeneratePdf = async () => {
        if (isSubmitting) return;
        const days = parseDeadlineDays(pdfForm.deadlineDays);
        if (days === null) {
            alert('Bitte eine gültige Zahlungsfrist angeben (ganze Zahl von 1 bis 365 Tagen).');
            return;
        }
        if (!totals) {
            alert('Die Forderungssummen sind nicht geladen. Bitte laden Sie die Seite neu.');
            return;
        }

        // Fenster direkt im Klick öffnen, damit Popup-Blocker nach den Ladevorgängen nicht greifen
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        let pdfWindow = null;
        if (!isNative) {
            pdfWindow = window.open('', '_blank');
            if (pdfWindow) {
                try {
                    pdfWindow.document.title = 'PDF wird erstellt …';
                    pdfWindow.document.body.innerHTML = '<p style="font-family: sans-serif; padding: 24px;">PDF wird erstellt …</p>';
                } catch {
                    // Fenster nicht beschreibbar – PDF wird trotzdem hineingeladen
                }
            }
        }

        setIsSubmitting(true);
        let pdfCreated = false;
        let portalAccessCreated = false;
        try {
            // QR-Code und PIN nur, wenn sie bekannt sind (gerade erzeugt) bzw. jetzt neu erzeugt werden
            let portalAccess = portalSecretActive ? portalSecret : null;
            if (!portalAccess && pdfNewPortalAccess) {
                portalAccess = await createPortalAccess();
                portalAccessCreated = true;
                setPortalSecret(portalAccess);
            }
            const pdfItems = items.map(i => ({ ...i, waived_amount: getItemWaived(i) }));
            const result = await generateClaimPdf(
                claim, totals, pdfItems, pdfForm.type, days, '', pdfForm.targetItemId,
                portalAccess ? { token: portalAccess.token, pin: portalAccess.pin } : null,
                { targetWindow: pdfWindow }
            );
            pdfCreated = true;
            setIsPdfModalOpen(false);

            const notes = [...(result.warnings || [])];
            if (result.downloaded) notes.push('Das PDF wurde heruntergeladen, weil kein neues Fenster geöffnet werden konnte.');

            if (!result.historySaved) {
                alert([
                    'Das PDF wurde erstellt, der Historien-Eintrag konnte aber nicht gespeichert werden' + (result.historyError ? `: ${result.historyError}` : '.'),
                    'Mahnstufe, Status und Frist wurden deshalb nicht geändert.',
                    ...notes
                ].join('\n\n'));
                await loadClaimData();
                return;
            }
            if (notes.length > 0) alert('Hinweise zum Schreiben:\n\n' + notes.join('\n\n'));

            // Versand erst nach Bestätigung vermerken (eine reine Vorschau ändert die Akte nicht)
            const newLevel = Math.max(num(claim.escalation_level), getDunningLevel(pdfForm.type));
            const willSetSent = ['draft', 'open', 'action_required'].includes(claim.status);
            const confirmText = [
                `Das PDF „${pdfForm.type}“ wurde erstellt.`,
                '',
                'Soll der Versand jetzt in der Forderungsakte vermerkt werden?',
                `• Zahlungsfrist: ${formatDate(result.deadlineDate)}`,
                `• Mahnstufe: ${newLevel}`,
                willSetSent ? '• Status: Versendet' : null,
                '',
                '„Abbrechen“: Das Schreiben bleibt nur als erstellt in der Historie, die Akte wird nicht geändert.'
            ].filter(line => line !== null).join('\n');

            if (window.confirm(confirmText)) {
                const updatePayload = {
                    escalation_level: newLevel,
                    deadline: result.deadlineDate,
                    next_action_at: result.deadlineDate,
                    updated_at: new Date().toISOString()
                };
                if (willSetSent) updatePayload.status = 'sent';

                const { error: updateError } = await supabase.from('claims').update(updatePayload).eq('id', claim.id);
                if (updateError) throw new Error('Die Forderungsakte konnte nicht aktualisiert werden: ' + translateClaimError(updateError));

                const { error: eventError } = await supabase.from('claim_events').insert([willSetSent && claim.status !== 'sent'
                    ? {
                        user_id: claim.user_id,
                        claim_id: claim.id,
                        event_type: 'status_changed',
                        description: `${pdfForm.type} versendet`,
                        event_metadata: { old_status: claim.status, new_status: 'sent', reason: `${pdfForm.type} versendet, Frist bis ${formatDate(result.deadlineDate)}`, escalation_level: newLevel }
                    }
                    : {
                        user_id: claim.user_id,
                        claim_id: claim.id,
                        event_type: 'deadline_set',
                        description: `${pdfForm.type} versendet – Frist gesetzt`,
                        event_metadata: { old_deadline: claim.deadline, new_deadline: result.deadlineDate, note: `Mahnstufe ${newLevel}` }
                    }]);
                if (eventError) console.warn('Versand-Eintrag konnte nicht gespeichert werden:', eventError);
            }
            await loadClaimData();
        } catch (err) {
            console.error(err);
            // Das Fenster nur schließen, wenn darin noch kein PDF angezeigt wird
            if (!pdfCreated && pdfWindow && !pdfWindow.closed) {
                try { pdfWindow.close(); } catch { /* ignore */ }
            }
            alert((pdfCreated ? 'Fehler: ' : 'Fehler beim Erstellen des PDFs: ') + translateClaimError(err));
            // Der neue Portal-Zugang ist bereits aktiv (der bisherige gesperrt): Akte neu laden, damit
            // die Anzeige stimmt und ein erneuter Versuch diesen Zugang verwendet statt einen weiteren
            if (portalAccessCreated) await loadClaimData();
        } finally {
            setIsSubmitting(false);
        }
    };

    const translateEventType = (type) => {
        const mapping = {
            created: 'Forderung erstellt',
            status_changed: 'Status geändert',
            dunning_sent: 'Mahnschreiben erstellt',
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

    // Überschrift eines Historien-Eintrags inkl. Kennzeichnung rückabgewickelter Vorgänge
    const getEventTitle = (event) => {
        const meta = event.event_metadata || {};
        if (event.event_type === 'payment_received') {
            const title = isWaiverMeta(meta) ? 'Erlass/Ausbuchung' : translateEventType(event.event_type);
            return meta.payment_id && reversedPaymentIds.has(meta.payment_id) ? `${title} (storniert)` : title;
        }
        if (event.event_type === 'payment_plan_accepted' && meta.payment_plan_id && reversedPlanIds.has(meta.payment_plan_id)) {
            return `${translateEventType(event.event_type)} (aufgehoben)`;
        }
        if (event.event_type === 'note_added' && meta.source === 'append_advanced') {
            return reversedAppendEventIds.has(event.id) ? 'Positionen hinzugefügt (rückgängig gemacht)' : 'Positionen hinzugefügt';
        }
        return translateEventType(event.event_type);
    };

    // Nur https-Adressen der eigenen App bzw. des eigenen Supabase-Speichers öffnen
    const getSafeDocumentUrl = (meta) => {
        const raw = meta?.document_url || meta?.document_path;
        if (!raw) return null;
        try {
            const url = new URL(raw, window.location.origin);
            if (url.protocol !== 'https:') return null;
            let storageHost = null;
            try {
                storageHost = new URL(import.meta.env.VITE_SUPABASE_URL).host;
            } catch {
                storageHost = null;
            }
            if (url.origin !== window.location.origin && url.host !== storageHost) return null;
            return url.href;
        } catch {
            return null;
        }
    };

    // Archiviertes Mahnschreiben (privater Bucket) über eine kurzlebige signierte Adresse öffnen.
    // Lesbar nur für Eigentümer bzw. Mitnutzer mit Schreibrecht – das Schreiben enthält die Portal-PIN.
    const openArchivedDocument = async (storagePath) => {
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        const win = isNative ? null : window.open('', '_blank');
        if (win) win.opener = null;
        try {
            const { data, error } = await supabase.storage.from(CLAIM_DOCUMENT_BUCKET).createSignedUrl(storagePath, 120);
            if (error || !data?.signedUrl) throw error || new Error('no url');
            if (win && !win.closed) {
                win.location.href = data.signedUrl;
            } else {
                window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
            }
        } catch {
            if (win && !win.closed) {
                try { win.close(); } catch { /* ignore */ }
            }
            alert('Das archivierte PDF konnte nicht geöffnet werden. Möglicherweise fehlt die Berechtigung (nur mit Schreibrecht für Finanzen) oder die Datei ist nicht mehr vorhanden.');
        }
    };

    const renderEventDetails = (event) => {
        const meta = event.event_metadata;
        if (!meta || Object.keys(meta).length === 0) return null;

        if (event.event_type === 'payment_received') {
            const isPaymentPlan = !!meta.payment_plan_id;
            const isWaiver = isWaiverMeta(meta);
            const isReversed = !!meta.payment_id && reversedPaymentIds.has(meta.payment_id);
            // Geldeingang grün, Erlass neutral, stornierte Buchung grau
            const palette = isReversed
                ? { bg: '#F9FAFB', border: '#E5E7EB', text: '#6B7280' }
                : isWaiver
                    ? { bg: '#F8FAFC', border: '#CBD5E1', text: '#334155' }
                    : { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534' };

            return (
                <div style={{ backgroundColor: palette.bg, border: `1px solid ${palette.border}`, padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    <div style={{ color: palette.text, fontWeight: 'bold', marginBottom: '8px' }}>
                        {isWaiver ? 'Erlass/Ausbuchung (kein Geldeingang)' : 'Zahlung erfasst'}
                        {isReversed && (
                            <span style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#FEE2E2', color: '#991B1B' }}>Storniert</span>
                        )}
                    </div>
                    <div style={{ fontSize: '1rem', color: palette.text, fontWeight: 'bold', marginBottom: '12px', textDecoration: isReversed ? 'line-through' : 'none' }}>
                        {isWaiver ? '' : '+ '}{formatCurrency(meta.amount)} {isWaiver ? 'ausgebucht' : ''} {meta.payment_date ? `am ${formatDate(meta.payment_date)}` : ''}
                    </div>
                    {isReversed && (
                        <div style={{ marginBottom: '8px', color: palette.text }}>
                            Diese Buchung wurde storniert (siehe Eintrag „Zahlung storniert“) und ist in den Summen nicht mehr enthalten.
                        </div>
                    )}

                    {isPaymentPlan ? (
                        <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #BBF7D0' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Verrechnung Ratenplan:</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>- Getilgt:</span><span>{formatCurrency(meta.amount)}</span></div>
                        </div>
                    ) : (
                        <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #BBF7D0' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                Verrechnung{meta.target_item_description ? ` (${meta.target_item_description})` : ''}:
                            </div>
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
                                const label = inst.due_date ? formatDate(inst.due_date) : String(inst.id || '').substring(0,6) + '...';
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

                    {!isPaymentPlan && (meta.target_item_open_after !== undefined || meta.remaining_total_due !== undefined) && (
                        <div>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                {meta.target_item_description
                                    ? `Rest "${meta.target_item_description}" nach Zahlung:`
                                    : 'Restforderung nach Zahlung:'}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>- {meta.target_item_description ? 'Position offen' : 'Gesamt offen'}:</span>
                                <span style={{ fontWeight: 'bold' }}>
                                    {formatCurrency(meta.target_item_open_after !== undefined ? meta.target_item_open_after : meta.remaining_total_due)}
                                </span>
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
            const archived = meta.document_bucket === CLAIM_DOCUMENT_BUCKET && typeof meta.document_storage_path === 'string';
            const safeUrl = archived ? null : getSafeDocumentUrl(meta);
            return (
                <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    {meta.document_type && <div style={{ marginBottom: '4px' }}><strong>Dokumenttyp:</strong> {meta.document_type}</div>}
                    {(meta.total_due_at_generation !== undefined || meta.total_snapshot !== undefined) && (
                        <div style={{ marginBottom: '4px' }}><strong>Gesamtforderung Stand Dokument:</strong> {formatCurrency(meta.total_due_at_generation ?? meta.total_snapshot)}</div>
                    )}
                    {(meta.deadline_date || meta.deadline) && (
                        <div style={{ marginBottom: '4px' }}><strong>Frist im Schreiben:</strong> {formatDate(meta.deadline_date || meta.deadline)}</div>
                    )}
                    {(meta.document_file_name || meta.document_path) && (
                        <div style={{ marginBottom: '4px', color: 'var(--text-secondary)' }}>
                            <strong>Datei:</strong> {meta.document_file_name || meta.document_path}
                            {meta.document_stored === false && ' (nicht in der App archiviert – bitte das PDF selbst ablegen)'}
                            {archived && ' (in der App archiviert)'}
                        </div>
                    )}
                    {archived && (
                        <Button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openArchivedDocument(meta.document_storage_path); }}
                            style={{ padding: '6px 12px', fontSize: '0.8rem', marginTop: '4px', backgroundColor: '#fff', color: '#374151', border: '1px solid #D1D5DB' }}
                        >
                            Archiviertes PDF öffnen
                        </Button>
                    )}
                    {safeUrl && (
                        <Button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); window.open(safeUrl, '_blank', 'noopener,noreferrer'); }}
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

        if (event.event_type === 'status_changed' || event.event_type === 'deadline_expired' || event.event_type === 'cancelled') {
            return (
                <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    {meta.old_status && <div style={{ marginBottom: '4px' }}><strong>Von:</strong> {statusLabel(meta.old_status)}</div>}
                    {meta.new_status && <div style={{ marginBottom: '4px' }}><strong>Auf:</strong> {statusLabel(meta.new_status)}</div>}
                    {meta.reason && <div style={{ marginTop: '4px' }}><strong>Grund:</strong> {meta.reason}</div>}
                </div>
            );
        }

        if (event.event_type === 'payment_plan_accepted') {
            return (
                <div style={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', padding: '12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.85rem' }}>
                    <div style={{ color: '#0369A1', fontWeight: 'bold', marginBottom: '8px' }}>Ratenzahlungsvereinbarung</div>
                    <div style={{ marginBottom: '4px' }}><strong>Gesamtbetrag Ratenplan:</strong> {formatCurrency(meta.plan_total)}</div>
                    <div style={{ marginBottom: '4px' }}><strong>Anzahl Raten:</strong> {meta.installment_count} x {formatCurrency(meta.monthly_rate)}</div>
                    <div style={{ marginBottom: '4px' }}><strong>Laufzeit:</strong> {formatDate(meta.first_due_date)} bis {formatDate(meta.last_due_date)}</div>
                    {meta.adjustment > 0 && <div style={{ marginBottom: '4px' }}><strong>Aufschlag / Kosten:</strong> {formatCurrency(meta.adjustment)}</div>}
                    {meta.note && <div style={{ marginTop: '4px' }}><strong>Notiz:</strong> {meta.note}</div>}
                    {meta.payment_plan_id && reversedPlanIds.has(meta.payment_plan_id) && (
                        <div style={{ marginTop: '8px', color: '#991B1B', fontWeight: 600 }}>
                            Diese Vereinbarung wurde aufgehoben (siehe Eintrag „Ratenzahlungsvereinbarung rückgängig gemacht“).
                        </div>
                    )}
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

    if (loading && !claim) return <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>Lade Forderungsakte...</div>;

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

    // Kopfzahlen ausschließlich aus claim_totals_view (gleiche Quelle wie Zahlungsprüfung, Ratenplan und Portal)
    const principalOriginal = num(totals?.current_principal_original);
    // principal_paid enthält Zahlungen UND Erlasse; „Getilgt" zeigt nur Geldeingänge, der Erlass steht getrennt
    const principalPaid = num(totals?.principal_paid);
    const kpiGetilgt = round2(principalPaid - principalWaived + feesPaid + interestPaid);
    const kpiOffen = round2(totalDue);
    const kpiUrsprung = round2(principalOriginal + feesOpen + feesPaid + interestOpen + interestPaid);

    const selectableItems = items.filter(item => num(item.open_amount) > 0 && !isPlanItem(item));
    const installmentOptions = Array.from(new Set([...INSTALLMENT_COUNT_OPTIONS, Number(paymentPlanForm.installmentCount)]))
        .filter(n => Number.isInteger(n) && n > 0 && n <= MAX_INSTALLMENTS)
        .sort((a, b) => a - b);

    const portalUrl = portalSecretActive ? buildClaimPortalUrl(portalSecret.token) : '';
    const actionsBlockedByLoad = !totals;

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
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Verwendungszweck für Überweisungen: <strong style={{ color: 'var(--primary-color)', fontFamily: 'monospace', fontSize: '0.9rem' }}>Mahnung-{claim.id.substring(0, 8).toUpperCase()}</strong>
                    </div>
                </div>
            </div>

            {loadWarnings.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '12px 16px', marginBottom: 'var(--spacing-lg)', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', color: '#991B1B', fontSize: '0.9rem' }}>
                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        <strong>Einige Daten konnten nicht geladen werden:</strong> {loadWarnings.join(', ')}.
                        {actionsBlockedByLoad ? ' Zahlungen, Ratenpläne und Mahnschreiben sind gesperrt, bis die Summen geladen sind.' : ''}
                        {' '}
                        <button onClick={loadClaimData} style={{ background: 'none', border: 'none', color: '#991B1B', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Erneut laden</button>
                    </div>
                </div>
            )}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card style={{ padding: '16px', borderLeft: '4px solid #3B82F6' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Ursprung</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totals ? formatCurrency(kpiUrsprung) : '—'}</div>
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #10B981' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Getilgt</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669' }}>{totals ? formatCurrency(kpiGetilgt) : '—'}</div>
                    {totals && principalWaived > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            zzgl. Erlass/Ausbuchung {formatCurrency(principalWaived)} (kein Geldeingang)
                        </div>
                    )}
                </Card>
                <Card style={{ padding: '16px', borderLeft: '4px solid #EF4444', backgroundColor: '#FEF2F2' }}>
                    <div style={{ fontSize: '0.85rem', color: '#991B1B', marginBottom: '4px', fontWeight: 600 }}>Gesamt offen</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#991B1B' }}>{totals ? formatCurrency(kpiOffen) : '—'}</div>
                    {totals && interestOpen > 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: '2px' }}>inkl. Zinsen bis heute</div>
                    )}
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
                                        {items.map(item => {
                                            const feeAmt = num(item.claim_items?.fee_amount);
                                            const intAmt = num(item.claim_items?.interest_amount);
                                            const inPlan = isPlanItem(item);
                                            const canSettle = !isLocked && !inPlan && num(item.open_amount) > 0;
                                            // Die letzte Position bleibt (sonst leere Forderung) – stattdessen die Forderung stornieren
                                            const canDelete = !isLocked && !inPlan && num(item.paid_principal) === 0 && items.length > 1;
                                            const itemWaived = getItemWaived(item);
                                            return (
                                                <tr key={item.claim_item_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>
                                                        <div>
                                                            {item.claim_items?.description || item.claim_items?.item_type}
                                                            {inPlan && <span style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#DCFCE7', color: '#166534' }}>Ratenplan</span>}
                                                        </div>
                                                        {(feeAmt > 0 || intAmt > 0) && (
                                                            <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '2px' }}>
                                                                (bei Anlage berechnet{feeAmt > 0 ? `: Mahnkosten ${formatCurrency(feeAmt)}` : ''}{intAmt > 0 ? `${feeAmt > 0 ? ',' : ':'} Zinsen ${formatCurrency(intAmt)}` : ''} – siehe Kostenzeilen unten)
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(item.original_amount)}</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>
                                                        {formatCurrency(round2(num(item.paid_principal) - itemWaived))}
                                                        {itemWaived > 0 && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                                erlassen: {formatCurrency(itemWaived)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.open_amount)}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                            {canSettle && (
                                                                <button onClick={() => handleSettleItem(item)} disabled={isSubmitting} title="Als erledigt markieren (Erlass/Ausbuchung)" style={{ color: '#166534', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}><CheckCircle size={16} /></button>
                                                            )}
                                                            {canDelete && (
                                                                <button onClick={() => handleDeleteItem(item)} disabled={isSubmitting} title="Position löschen" style={{ color: '#DC2626', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {totals && (
                                            <>
                                                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: '#FAFAFA' }}>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>Mahnkosten / Gebühren</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(feesOpen + feesPaid)}</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(feesPaid)}</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(feesOpen)}</td>
                                                    <td style={{ padding: '12px 16px' }}></td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: '#FAFAFA' }}>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>
                                                        <div>Verzugszinsen</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '2px' }}>
                                                            {num(claim.interest_rate).toLocaleString('de-DE', { maximumFractionDigits: 4 })} % p.a.{claim.interest_start_date ? `, laufend seit ${formatDate(claim.interest_start_date)}` : ''}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(interestOpen + interestPaid)}</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(interestPaid)}</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(interestOpen)}</td>
                                                    <td style={{ padding: '12px 16px' }}></td>
                                                </tr>
                                                <tr style={{ backgroundColor: '#F9FAFB' }}>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', fontWeight: 700 }}>Summe</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(kpiUrsprung)}</td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                                                        {formatCurrency(kpiGetilgt)}
                                                        {principalWaived > 0 && (
                                                            <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                                zzgl. erlassen: {formatCurrency(principalWaived)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(kpiOffen)}</td>
                                                    <td style={{ padding: '12px 16px' }}></td>
                                                </tr>
                                            </>
                                        )}
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
                                    {events.map((event, index) => {
                                        const deletePolicy = getEventDeletePolicy(event);
                                        return (
                                        <div key={event.id} style={{ position: 'relative', marginBottom: index === events.length - 1 ? 0 : '24px' }}>
                                            <div style={{ position: 'absolute', left: '-21px', top: '4px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-color)', border: '2px solid white' }}></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{getEventTitle(event)}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{new Date(event.event_date).toLocaleString('de-DE')}</div>
                                                    {deletePolicy.allowed && (
                                                        <button
                                                            onClick={() => handleDeleteEvent(event)}
                                                            disabled={isSubmitting}
                                                            style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                            title={deletePolicy.title || 'Ereignis löschen'}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            {event.description && (
                                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                                    {event.description}
                                                </div>
                                            )}
                                            {renderEventDetails(event)}
                                        </div>
                                        );
                                    })}
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
                                            <div style={{ fontWeight: 600 }}>{formatCurrency(planTotal)}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Bezahlt / Offen</div>
                                            <div style={{ fontWeight: 600 }}>{formatCurrency(planPaidAmount)} / {formatCurrency(planOpen)}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Anzahl Raten</div>
                                            <div style={{ fontWeight: 600 }}>{installments.length}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Nächste Fälligkeit</div>
                                            <div style={{ fontWeight: 600 }}>{nextOpenInstallment ? formatDate(nextOpenInstallment.due_date) : '-'}</div>
                                        </div>
                                    </div>
                                    {planExceedsClaim && (
                                        <div style={{ display: 'flex', gap: '8px', padding: '12px', marginBottom: '16px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', fontSize: '0.85rem', color: '#92400E' }}>
                                            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                            <div>
                                                Der offene Planbetrag ({formatCurrency(planOpen)}) ist höher als die gebuchte Forderung ({formatCurrency(totalDue)}), z. B. weil ein Aufschlag nicht als Kosten gebucht ist. Zahlungen können höchstens bis zur gebuchten Forderung verbucht werden.
                                            </div>
                                        </div>
                                    )}
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
                                                {installments.map((inst) => {
                                                    const instStatus = {
                                                        open: { label: 'Offen', bg: '#FEF3C7', color: '#92400E' },
                                                        partial: { label: 'Teilweise bezahlt', bg: '#DBEAFE', color: '#1E40AF' },
                                                        paid: { label: 'Bezahlt', bg: '#D1FAE5', color: '#065F46' },
                                                        overdue: { label: 'Überfällig', bg: '#FEE2E2', color: '#991B1B' },
                                                        cancelled: { label: 'Storniert', bg: '#F3F4F6', color: '#4B5563' }
                                                    }[inst.status] || { label: inst.status, bg: '#F3F4F6', color: '#4B5563' };
                                                    return (
                                                        <tr key={inst.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                            <td style={{ padding: '12px 16px', fontSize: '0.9rem' }}>{formatDate(inst.due_date)}</td>
                                                            <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right' }}>{formatCurrency(inst.amount)}</td>
                                                            <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{formatCurrency(inst.paid_amount)}</td>
                                                            <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(Math.max(0, num(inst.amount) - num(inst.paid_amount)))}</td>
                                                            <td style={{ padding: '12px 16px', fontSize: '0.9rem', textAlign: 'center' }}>
                                                                <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: instStatus.bg, color: instStatus.color }}>
                                                                    {instStatus.label}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Ratenzahlungsanfragen */}
                    {paymentPlanRequests.length > 0 && (
                        <Card>
                            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#F0FDF4' }}>
                                <Globe size={20} color="#059669" />
                                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: '#065F46' }}>Ratenzahlungsanfragen (Portal)</h2>
                            </div>
                            <div style={{ padding: '24px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {paymentPlanRequests.map(request => (
                                        <div key={request.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', backgroundColor: request.status === 'requested' ? '#FFFBEB' : '#F9FAFB' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{request.requested_months} Monate Laufzeit</div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Angefragt am: {formatDate(request.created_at)}</div>
                                                </div>
                                                <Badge variant={request.status === 'requested' ? 'warning' : request.status === 'accepted' ? 'success' : 'neutral'}>
                                                    {request.status === 'requested' ? 'Neu / Offen' : request.status === 'accepted' ? 'Angenommen' : request.status === 'rejected' ? 'Abgelehnt' : 'Storniert'}
                                                </Badge>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px', backgroundColor: 'white', padding: '12px', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                                                <div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Vorgeschlagene Rate</div>
                                                    <div style={{ fontWeight: 600 }}>{formatCurrency(request.requested_rate)} / Monat</div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Aufschlag</div>
                                                    <div style={{ fontWeight: 500 }}>{formatCurrency(request.adjustment_amount)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gesamtbetrag</div>
                                                    <div style={{ fontWeight: 600, color: '#166534' }}>{formatCurrency(request.requested_total)}</div>
                                                </div>
                                            </div>
                                            {request.tenant_message && (
                                                <div style={{ padding: '12px', backgroundColor: 'white', borderLeft: '3px solid #D1D5DB', marginBottom: '16px', fontSize: '0.9rem', fontStyle: 'italic' }}>
                                                    "{request.tenant_message}"
                                                </div>
                                            )}
                                            {request.status === 'requested' && (
                                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', gap: '12px' }}>
                                                        <Button
                                                            onClick={() => handleAcceptPaymentPlanRequest(request)}
                                                            disabled={isSubmitting || isLocked || !!paymentPlan || actionsBlockedByLoad}
                                                            title={paymentPlan ? 'Es besteht bereits eine aktive Ratenzahlungsvereinbarung' : 'Ratenplan auf Basis der Anfrage anlegen'}
                                                            style={{ backgroundColor: '#10B981', color: 'white' }}
                                                        >
                                                            Annehmen
                                                        </Button>
                                                        <Button
                                                            variant="secondary"
                                                            onClick={() => handleRejectPaymentPlanRequest(request)}
                                                            disabled={isSubmitting}
                                                        >
                                                            Ablehnen
                                                        </Button>
                                                    </div>
                                                    <Button
                                                        variant="secondary"
                                                        style={{ color: '#EF4444', borderColor: '#FCA5A5' }}
                                                        onClick={() => handleDeletePaymentPlanRequest(request.id)}
                                                        disabled={isSubmitting}
                                                    >
                                                        <Trash2 size={16} /> Löschen
                                                    </Button>
                                                </div>
                                            )}
                                            {request.status !== 'requested' && (
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                                                    <Button
                                                        variant="secondary"
                                                        style={{ color: '#EF4444', borderColor: '#FCA5A5', padding: '6px 12px', fontSize: '0.85rem' }}
                                                        onClick={() => handleDeletePaymentPlanRequest(request.id)}
                                                        disabled={isSubmitting}
                                                    >
                                                        <Trash2 size={14} style={{ marginRight: '6px' }} /> Anfrage löschen
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Card>
                    )}
                </div>

                {/* RIGHT PANEL */}
                <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                    <Card style={{ padding: '16px', height: 'auto' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid #E5E7EB', paddingBottom: '8px' }}>Aktionen</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '4px' }}>
                            <Button
                                variant="secondary"
                                style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px' }}
                                onClick={openPaymentModal}
                                disabled={isLocked || actionsBlockedByLoad}
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
                                    setPendingRequestId(null);
                                    setPaymentPlanForm(createInitialPlanForm());
                                    setIsPaymentPlanModalOpen(true);
                                }}
                                disabled={isLocked || actionsBlockedByLoad}
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
                            {!claimAccessLink ? (
                                <Button
                                    variant="secondary"
                                    style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px' }}
                                    onClick={handleCreatePortalLink}
                                    disabled={isSubmitting || isLocked}
                                >
                                    <Globe size={16} /> Portal-Link erstellen
                                </Button>
                            ) : (
                                <Button
                                    variant="secondary"
                                    style={{ display: 'flex', justifyContent: 'flex-start', gap: '8px', color: '#1D4ED8', backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }}
                                    onClick={() => setIsPortalModalOpen(true)}
                                >
                                    <Globe size={16} /> Portal-Link anzeigen
                                </Button>
                            )}
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
                                onClick={openPdfModal}
                                disabled={isLocked || actionsBlockedByLoad}
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
                            {(claim.tenants?.street || claim.tenants?.city) && (
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    Anschrift: {`${claim.tenants.street || ''} ${claim.tenants.house_number || ''}`.trim()}{claim.tenants.city ? `, ${`${claim.tenants.postal_code || ''} ${claim.tenants.city}`.trim()}` : ''}
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

            <Modal isOpen={isPdfModalOpen} onClose={() => !isSubmitting && setIsPdfModalOpen(false)} title="Mahnung / Abmahnung erzeugen">
                <div style={{ padding: '16px 0' }}>
                    <div style={{ backgroundColor: '#F3F4F6', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Erzeugt ein PDF inklusive Forderungsaufstellung und Zinsberechnung auf Basis der Vorlage. Die Beträge entsprechen der Forderungsakte. Die Erstellung wird in der Historie vermerkt; Mahnstufe, Status und Frist werden erst nach Ihrer Bestätigung des Versands übernommen.
                    </div>

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Was soll gemahnt werden?</label>
                    <select
                        value={pdfForm.targetItemId || ''}
                        onChange={(e) => setPdfForm({...pdfForm, targetItemId: e.target.value || null})}
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #D1D5DB', marginBottom: '16px', fontSize: '0.95rem' }}
                    >
                        <option value="">Gesamte Akte (Alle offenen Positionen)</option>
                        {items.filter(i => num(i.open_amount) > 0).map(i => (
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
                        max="365"
                        step="1"
                        value={pdfForm.deadlineDays}
                        onChange={(e) => setPdfForm({...pdfForm, deadlineDays: e.target.value})}
                    />
                    {parseDeadlineDays(pdfForm.deadlineDays) === null && (
                        <div style={{ fontSize: '0.8rem', color: '#B91C1C', marginTop: '-8px' }}>Bitte eine ganze Zahl von 1 bis 365 eingeben.</div>
                    )}

                    {portalSecretActive && (
                        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#F0FDF4', borderRadius: '8px', border: '1px solid #BBF7D0', fontSize: '0.85rem', color: '#166534' }}>
                            <strong>Portal-Link aktiv:</strong> QR-Code und Zugangscode (PIN: {portalSecret.pin}) werden auf der ersten Seite des PDFs abgedruckt.
                        </div>
                    )}

                    {!portalSecretActive && (
                        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: claimAccessLink ? '#FFFBEB' : '#F3F4F6', borderRadius: '8px', border: claimAccessLink ? '1px solid #FDE68A' : '1px solid #E5E7EB', fontSize: '0.85rem', color: claimAccessLink ? '#92400E' : '#4B5563' }}>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: isLocked ? 'default' : 'pointer', fontWeight: 600 }}>
                                <input
                                    type="checkbox"
                                    checked={pdfNewPortalAccess}
                                    onChange={(e) => setPdfNewPortalAccess(e.target.checked)}
                                    disabled={isSubmitting || isLocked}
                                    style={{ marginTop: '2px' }}
                                />
                                <span>
                                    {claimAccessLink
                                        ? 'Neuen Portal-Zugang (QR-Code und PIN) für dieses Schreiben erzeugen'
                                        : 'Portal-Zugang (QR-Code und PIN) erzeugen und auf dem Schreiben abdrucken'}
                                </span>
                            </label>
                            <div style={{ marginTop: '6px', marginLeft: '24px' }}>
                                {claimAccessLink
                                    ? 'Link und PIN des bestehenden Zugangs sind aus Sicherheitsgründen nur direkt nach dem Erzeugen sichtbar. Ein neuer Zugang macht den bisherigen Link und die bisherige PIN ungültig – auch auf bereits verschickten Schreiben. Ohne Haken wird das Schreiben ohne QR-Code und PIN erstellt.'
                                    : 'Der Mieter kann die Forderung damit online einsehen und eine Ratenzahlung anfragen.'}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                        <Button variant="secondary" onClick={() => setIsPdfModalOpen(false)} disabled={isSubmitting}>Abbrechen</Button>
                        <Button onClick={handleGeneratePdf} disabled={isSubmitting || !pdfForm.type || parseDeadlineDays(pdfForm.deadlineDays) === null} style={{ backgroundColor: '#991B1B', color: 'white' }}>
                            {isSubmitting ? 'PDF wird erzeugt...' : 'PDF jetzt erzeugen'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isPaymentModalOpen} onClose={() => !isSubmitting && setIsPaymentModalOpen(false)} title="Zahlung erfassen">
                <div style={{ padding: '16px 0' }}>
                    {(paymentPlan || selectableItems.length > 0) && (
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
                                            onChange={() => setPaymentForm({...paymentForm, paymentType: 'installment', targetItemId: null})}
                                        />
                                        <span style={{ fontWeight: 500 }}>Ratenplan (Rate)</span>
                                    </label>
                                )}

                                {!paymentPlan && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <input
                                            type="radio"
                                            name="paymentType"
                                            value="auto"
                                            checked={paymentForm.paymentType === 'auto'}
                                            onChange={() => setPaymentForm({...paymentForm, paymentType: 'auto', targetItemId: null})}
                                        />
                                        <span style={{ fontWeight: 500 }}>Automatische Verteilung (Kosten, Zinsen, dann älteste Position zuerst)</span>
                                    </label>
                                )}

                                {selectableItems.map(item => (
                                    <label key={item.claim_item_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <input
                                            type="radio"
                                            name="paymentType"
                                            value={`item_${item.claim_item_id}`}
                                            checked={paymentForm.paymentType === 'specific_item' && paymentForm.targetItemId === item.claim_item_id}
                                            onChange={() => setPaymentForm({...paymentForm, paymentType: 'specific_item', targetItemId: item.claim_item_id})}
                                        />
                                        <span style={{ fontWeight: 500 }}>
                                            {item.claim_items?.description || item.claim_items?.item_type} ({formatCurrency(item.open_amount)} offen)
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px', padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Offene Hauptforderung</div>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(principalOpen)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Offene Gebühren</div>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(feesOpen)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Offene Zinsen</div>
                            <div style={{ fontWeight: 500 }}>{formatCurrency(interestOpen)}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.85rem', color: '#991B1B', fontWeight: 600 }}>Gesamt Offen</div>
                            <div style={{ fontWeight: 700, color: '#991B1B' }}>{formatCurrency(totalDue)}</div>
                        </div>
                    </div>

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Zahlungsdatum</label>
                    <Input
                        type="date"
                        value={paymentForm.date}
                        max={toLocalDateString()}
                        onChange={(e) => setPaymentForm({...paymentForm, date: e.target.value})}
                        style={{ marginBottom: '16px' }}
                    />

                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Betrag (€)</label>
                    <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={totalDue}
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
                                // Vorschau nach derselben Logik wie record_claim_payment
                                let rem = round2(parseFloat(paymentForm.amount));
                                let allocFees = 0;
                                let allocInterest = 0;
                                let allocPrincipal = 0;

                                if (paymentForm.paymentType === 'installment' && paymentPlan) {
                                    allocPrincipal = Math.min(rem, planItemsPrincipalOpen);
                                    rem = round2(rem - allocPrincipal);
                                    allocFees = rem; // Restbetrag verbucht der Server als Kosten
                                    rem = 0;
                                } else if (paymentForm.paymentType === 'specific_item' && paymentForm.targetItemId) {
                                    const tItem = items.find(i => i.claim_item_id === paymentForm.targetItemId);
                                    if (tItem) {
                                        const open = getItemFeeInterestOpen(tItem);
                                        allocFees = Math.min(rem, open.fee);
                                        rem = round2(rem - allocFees);
                                        allocInterest = Math.min(rem, open.interest);
                                        rem = round2(rem - allocInterest);
                                        allocPrincipal = Math.min(rem, num(tItem.open_amount));
                                        rem = round2(rem - allocPrincipal);
                                    }
                                } else {
                                    allocFees = Math.min(rem, feesOpen);
                                    rem = round2(rem - allocFees);
                                    allocInterest = Math.min(rem, interestOpen);
                                    rem = round2(rem - allocInterest);
                                    allocPrincipal = rem;
                                    rem = 0;
                                }

                                return (
                                    <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Mahnkosten{paymentForm.paymentType === 'installment' && paymentPlan ? ' / Restbetrag' : ''}:</span>
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
                                        {rem > 0.009 && (
                                            <div style={{ color: '#B91C1C', marginTop: '4px' }}>
                                                Nicht zuordenbar: {formatCurrency(rem)} – der Betrag übersteigt den offenen Betrag der Position.
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {paymentForm.paymentType === 'installment' && paymentPlan && (
                        <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.85rem', color: '#0F172A' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>Ratenzahlung</h4>
                            {nextOpenInstallment ? (
                                <div>
                                    Die Zahlung wird automatisch der ältesten offenen Rate zugeordnet
                                    (Rate {installments.findIndex(x => x.id === nextOpenInstallment.id) + 1}, fällig am {formatDate(nextOpenInstallment.due_date)}, offen {formatCurrency(Math.max(0, num(nextOpenInstallment.amount) - num(nextOpenInstallment.paid_amount)))}).
                                    Ein Mehrbetrag wird auf die folgenden Raten verrechnet.
                                </div>
                            ) : (
                                <div>Alle Raten sind bereits bezahlt.</div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                        <Button variant="secondary" onClick={() => setIsPaymentModalOpen(false)} disabled={isSubmitting}>Abbrechen</Button>
                        <Button onClick={handleRecordPayment} disabled={isSubmitting || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0}>Zahlung buchen</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isPaymentPlanModalOpen} onClose={closePaymentPlanModal} title="Ratenzahlung vereinbaren">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {pendingRequestId && (
                        <div style={{ padding: '10px 12px', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '8px', fontSize: '0.85rem', color: '#065F46' }}>
                            Ratenplan auf Basis der Mieter-Anfrage. Die Anfrage gilt erst als angenommen, wenn die Vereinbarung angelegt wurde.
                        </div>
                    )}
                    <div style={{ padding: '12px', backgroundColor: '#F3F4F6', borderRadius: '8px', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span>Gesamtforderung aktuell:</span>
                            <strong>{formatCurrency(totalDue)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span>Vereinbarungskosten (Aufschlag):</span>
                            <strong>{formatCurrency(num(paymentPlanForm.adjustmentAmount))}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #D1D5DB', paddingTop: '4px', marginTop: '4px' }}>
                            <span>Ratenplan gesamt:</span>
                            <strong style={{ color: '#166534' }}>{formatCurrency(round2(totalDue + Math.max(0, num(paymentPlanForm.adjustmentAmount))))}</strong>
                        </div>
                        {num(paymentPlanForm.adjustmentAmount) > 0 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                                Der Aufschlag wird als Kosten in die Forderung gebucht, damit alle Raten vollständig verbucht werden können.
                                Hinweis: Ein entgeltlicher Zahlungsaufschub gegenüber Verbrauchern kann den Vorschriften über Verbraucherkredite (§ 506 BGB) unterliegen – bitte rechtlich prüfen.
                            </div>
                        )}
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Startdatum (1. Rate)</label>
                        <Input
                            type="date"
                            min={toLocalDateString()}
                            value={paymentPlanForm.startDate}
                            onChange={(e) => setPaymentPlanForm({...paymentPlanForm, startDate: e.target.value})}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Anzahl Raten</label>
                        <select
                            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
                            value={paymentPlanForm.installmentCount}
                            onChange={(e) => setPaymentPlanForm({...paymentPlanForm, installmentCount: parseInt(e.target.value, 10)})}
                        >
                            {installmentOptions.map(n => (
                                <option key={n} value={n}>{n} {n === 1 ? 'Rate' : 'Raten'}</option>
                            ))}
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
                                    min="0"
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
                                    min="0"
                                    value={paymentPlanForm.adjustmentAmount}
                                    onChange={(e) => setPaymentPlanForm({...paymentPlanForm, adjustmentAmount: e.target.value})}
                                    style={{ flex: 1 }}
                                />
                                <span style={{ color: 'var(--text-secondary)' }}>€</span>
                            </div>
                        )}
                        {num(paymentPlanForm.adjustmentAmount) < 0 && (
                            <div style={{ fontSize: '0.8rem', color: '#B91C1C', marginTop: '-8px' }}>Der Aufschlag darf nicht negativ sein.</div>
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
                                const total = round2(totalDue + Math.max(0, num(paymentPlanForm.adjustmentAmount)));
                                const count = Number(paymentPlanForm.installmentCount);
                                const schedule = buildPlanSchedule(total, count, paymentPlanForm.startDate);
                                if (schedule.length === 0) {
                                    return <div style={{ color: '#6B7280' }}>Bitte Startdatum und Ratenanzahl angeben.</div>;
                                }
                                const shown = schedule.length > 4 ? [...schedule.slice(0, 3), schedule[schedule.length - 1]] : schedule;
                                return (
                                    <>
                                        {shown.map((row, idx) => (
                                            <React.Fragment key={row.index}>
                                                {schedule.length > 4 && idx === 3 && (
                                                    <div style={{ color: '#6B7280', margin: '4px 0' }}>... ({schedule.length - 4} weitere Raten)</div>
                                                )}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <span>Rate {row.index} am {row.due.toLocaleDateString('de-DE')}:</span>
                                                    <strong>{formatCurrency(row.amount)}</strong>
                                                </div>
                                            </React.Fragment>
                                        ))}
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                        <Button variant="secondary" onClick={closePaymentPlanModal} disabled={isSubmitting}>Abbrechen</Button>
                        <Button onClick={handleCreatePaymentPlan} disabled={isSubmitting || !paymentPlanForm.startDate || !paymentPlanForm.installmentCount || num(paymentPlanForm.adjustmentAmount) < 0}>
                            {isSubmitting ? 'Wird gespeichert...' : 'Vereinbarung anlegen'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Portal Modal */}
            <Modal isOpen={isPortalModalOpen} onClose={() => setIsPortalModalOpen(false)} title="Forderungsportal">
                <div style={{ padding: 'var(--spacing-lg)' }}>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
                        Sie können dem Mieter einen gesicherten Link zur Verfügung stellen. Darüber kann der Mieter die aktuelle Forderung einsehen und z.B. eine Ratenzahlung anfragen.
                    </p>

                    <div style={{ padding: '16px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: 'var(--spacing-lg)' }}>
                        {claimAccessLink && (
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Portal Link</label>
                                {portalSecretActive ? (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <Input
                                            readOnly
                                            value={portalUrl}
                                            onFocus={(e) => e.target.select()}
                                            style={{ flex: 1, backgroundColor: 'white' }}
                                        />
                                        <Button variant="secondary" onClick={() => copyToClipboard(portalUrl)}>
                                            Kopieren
                                        </Button>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                                        Aus Sicherheitsgründen nicht mehr einsehbar (nur direkt nach dem Erzeugen).
                                    </div>
                                )}
                                {claimAccessLink.expires_at && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: portalSecretActive ? '-8px' : 0 }}>
                                        Gültig bis {new Date(claimAccessLink.expires_at).toLocaleDateString('de-DE')}
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Zugangscode (PIN)</label>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '4px', color: 'var(--primary-color)' }}>
                                    {portalSecretActive ? portalSecret.pin : (claimAccessLink ? '••••••' : '-----')}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    Wird zur Authentifizierung benötigt.
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Status</label>
                                {claimAccessLink ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#059669', fontSize: '0.9rem', fontWeight: 500 }}>
                                        <CheckCircle2 size={16} />
                                        Aktiv
                                    </span>
                                ) : (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#9CA3AF', fontSize: '0.9rem', fontWeight: 500 }}>
                                        Inaktiv
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {!claimAccessLink && (
                        <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE', marginBottom: 'var(--spacing-lg)' }}>
                            <AlertCircle size={18} color="#1D4ED8" style={{ marginTop: '2px' }} />
                            <div style={{ fontSize: '0.85rem', color: '#1E3A8A' }}>
                                Klicken Sie auf "Link generieren", um einen neuen Zugangscode zu erstellen. Dies widerruft automatisch alte Links dieser Forderung.
                            </div>
                        </div>
                    )}

                    {portalSecretActive && (
                        <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE', marginBottom: 'var(--spacing-lg)' }}>
                            <AlertCircle size={18} color="#1D4ED8" style={{ marginTop: '2px', flexShrink: 0 }} />
                            <div style={{ fontSize: '0.85rem', color: '#1E3A8A' }}>
                                Link und PIN werden aus Sicherheitsgründen nur jetzt angezeigt und nicht gespeichert. Erzeugen Sie das Schreiben (PDF erzeugen) am besten gleich – QR-Code und PIN werden dort abgedruckt. Nach dem Verlassen der Seite sind sie nicht mehr abrufbar.
                            </div>
                        </div>
                    )}

                    {claimAccessLink && !portalSecretActive && (
                        <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#EFF6FF', borderRadius: '8px', border: '1px solid #BFDBFE', marginBottom: 'var(--spacing-lg)' }}>
                            <AlertCircle size={18} color="#1D4ED8" style={{ marginTop: '2px', flexShrink: 0 }} />
                            <div style={{ fontSize: '0.85rem', color: '#1E3A8A' }}>
                                Link und PIN des aktiven Zugangs sind nur direkt nach dem Erzeugen sichtbar. Für ein neues Schreiben mit QR-Code setzen Sie beim Erzeugen des PDFs den Haken „Neuen Portal-Zugang … erzeugen“ oder klicken Sie hier auf „Neu generieren“.
                            </div>
                        </div>
                    )}

                    {claimAccessLink && (
                        <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#FFFBEB', borderRadius: '8px', border: '1px solid #FDE68A', marginBottom: 'var(--spacing-lg)' }}>
                            <AlertCircle size={18} color="#92400E" style={{ marginTop: '2px', flexShrink: 0 }} />
                            <div style={{ fontSize: '0.85rem', color: '#92400E' }}>
                                „Neu generieren“ macht den bisherigen Link und die PIN ungültig – auch auf bereits verschickten Schreiben.
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--spacing-lg)' }}>
                        <Button variant="secondary" onClick={() => setIsPortalModalOpen(false)}>
                            Schließen
                        </Button>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            {claimAccessLink && (
                                <Button onClick={handleRevokePortalLink} disabled={isSubmitting} style={{ backgroundColor: '#EF4444', color: 'white' }}>
                                    Link widerrufen
                                </Button>
                            )}
                            <Button onClick={handleCreatePortalLink} disabled={isSubmitting || isLocked}>
                                {isSubmitting ? 'Generiere...' : claimAccessLink ? 'Neu generieren' : 'Link generieren'}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ClaimDetail;
