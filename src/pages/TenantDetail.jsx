import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../context/PermissionContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import CurrencyInput from '../components/ui/CurrencyInput';
import {
    ArrowLeft, User, Phone, Mail, Users, Home, Calendar,
    FileText, Trash2, Edit, Plus, Upload, Download, Loader2,
    Lock, RefreshCw, Building2, MessageSquare,
    AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Eye, Cloud, TrendingUp
} from 'lucide-react';
import {
    RENT_PERIOD_FIELDS, localISODate, monthStart, addMonths, formatDateDE, formatMonthDE, formatEUR,
    isValidISODate, sumRent, getLeaseTimeState, fetchRentPeriods, getEffectivePeriod, saveRentPeriod,
    deleteRentPeriod, checkLeaseDeletion, describeDeletionBlock, deletionConfirmText,
    translateLeaseDeleteError, findOverlappingLeases, describeLease, buildTemplateTenantData,
    TENANT_SALUTATIONS, TENANT_SALUTATION_OPTIONS
} from '../lib/leaseRentPeriods';
import { validateUploadFile, prepareUploadBody } from '../lib/storageFiles';
import { translateError } from '../lib/errorTranslator';

// Status der Forderungen (wie im Forderungsmodul / ClaimDetail)
const CLAIM_STATUS = {
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
const CLOSED_CLAIM_STATUSES = ['settled', 'cancelled', 'archived'];
const HIDDEN_CLAIM_STATUSES = ['cancelled', 'archived'];

// Status/Priorität der Tickets (wie im Mieterportal)
const TICKET_STATUS = {
    received: { label: 'Eingegangen', variant: 'warning' },
    in_progress: { label: 'In Bearbeitung', variant: 'blue' },
    completed: { label: 'Abgeschlossen', variant: 'success' }
};
const TICKET_PRIORITY = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' };

const LEASE_TYPE_LABELS = { normal: 'Normalmietvertrag', staffel: 'Staffelmietvertrag', index: 'Indexmietvertrag' };

const ALLOWED_UPLOAD_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Dokumente der Mieterakte (Bucket "documents"): gleiche Prüfung wie Documents.jsx (storageFiles.js)
const TENANT_DOCUMENT_RULE = {
    label: 'PDF, PNG, JPG, DOC und DOCX',
    maxBytes: MAX_UPLOAD_BYTES,
    extensions: ALLOWED_UPLOAD_EXTENSIONS
};

const RETRO_CONFIRM_LABEL = 'Ich habe verstanden, dass die Änderung rückwirkend auf alle Monate seit Vertragsbeginn wirkt.';

const toAmount = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
};

// Datum + n Monate, Tag bleibt erhalten
const addMonthsKeepDay = (iso, months) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return localISODate(new Date(y, m - 1 + months, d));
};

// Speicher-Schlüssel: ASCII, keine Sonderzeichen (Supabase Storage lehnt Umlaute ab)
const sanitizeFileName = (name) => {
    const map = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
    const replaced = String(name || 'datei').replace(/[äöüÄÖÜß]/g, ch => map[ch]);
    const ascii = replaced.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const cleaned = ascii.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '');
    return (cleaned || 'datei').slice(-120);
};

const getFileExtension = (name) => {
    const match = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return match ? match[1].toLowerCase() : '';
};

// Fehler von supabase.functions.invoke auswerten (FunctionsHttpError trägt die Response)
const getFunctionErrorStatus = (err) => err?.context?.status ?? err?.status ?? null;
const readFunctionErrorMessage = async (err) => {
    try {
        if (err?.context && typeof err.context.json === 'function') {
            const body = await err.context.json();
            if (body?.error) return String(body.error);
        }
    } catch {
        // Antwort ohne JSON-Inhalt
    }
    return err?.message || String(err);
};
// Status, Fehlercode und Meldung in einem Schritt (die Antwort lässt sich nur einmal lesen)
const readFunctionError = async (err) => {
    const info = { status: getFunctionErrorStatus(err), code: '', message: err?.message || String(err) };
    try {
        if (err?.context && typeof err.context.json === 'function') {
            const body = await err.context.json();
            if (body?.code) info.code = String(body.code);
            if (body?.error) info.message = String(body.error);
        }
    } catch {
        // Antwort ohne JSON-Inhalt
    }
    return info;
};

// Ein Name ergibt genau EIN Cloud-Ordnersegment: '/' und '\' würden sonst Unterordner erzeugen.
// Gleiche Regel wie folderSegment in cloud-sync (ebenso in Properties.jsx und sync-applicant-files).
const cloudFolderSegment = (value) => String(value ?? '').replace(/[\\/]/g, '-');

// Tabelle/Spalte (noch) nicht vorhanden – z. B. lease_cloud_folders vor dem Einspielen der Migration
const isMissingTableError = (error) => ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''));

// Pfad ohne leere Segmente (Form, in der er in lease_cloud_folders gespeichert wird)
const normalizeCloudPath = (path) => String(path || '').split('/').filter(Boolean).join('/');

// Letzte Mieterhöhung aus der Miethistorie (aufsteigend nach valid_from): Monatsanfang des letzten Zeitraums,
// dessen Kaltmiete über der des vorherigen liegt; ohne Erhöhung null (dann gilt der Mietbeginn).
const lastRentIncreaseFromPeriods = (periods) => {
    let result = null;
    for (let i = 1; i < (periods || []).length; i++) {
        if (toAmount(periods[i].cold_rent) > toAmount(periods[i - 1].cold_rent) + 0.005) {
            result = monthStart(periods[i].valid_from);
        }
    }
    return result;
};

// Formular geändert? (Schutz vor versehentlichem Schließen eines Dialogs per Esc/X/Abbrechen)
const isFormDirty = (current, initial) => JSON.stringify(current) !== JSON.stringify(initial);
const DISCARD_CHANGES_PROMPT = 'Ungespeicherte Änderungen verwerfen?';

const buildTenantForm = (t = {}) => ({
    // Anrede (tenants.salutation): '' = keine Angabe → neutrale Briefanrede
    salutation: TENANT_SALUTATIONS.includes(t.salutation) ? t.salutation : '',
    first_name: t.first_name || '',
    last_name: t.last_name || '',
    phone: t.phone || '',
    email: t.email || '',
    occupants: t.occupants || 1,
    street: t.street || '',
    house_number: t.house_number || '',
    postal_code: t.postal_code || '',
    city: t.city || ''
});

const buildLeaseForm = (l) => ({
    start_date: l?.start_date || '',
    end_date: l?.end_date || '',
    deposit: l?.deposit ?? '',
    lease_type: l?.lease_type || 'normal',
    last_rent_increase: l?.last_rent_increase || '',
    // Buchungsbeginn des Mietkontos (leases.booking_start_date); leer = automatisch
    booking_start_date: l?.booking_start_date || ''
});

const buildRentForm = (l, periodsState) => {
    const today = localISODate();
    const nextMonth = addMonths(today, 1);
    const validFrom = l?.start_date && l.start_date > nextMonth ? monthStart(l.start_date) : nextMonth;
    const source = periodsState?.supported ? (getEffectivePeriod(periodsState.periods, validFrom) || l) : l;
    return {
        valid_from: validFrom,
        cold_rent: toAmount(source?.cold_rent),
        service_charge: toAmount(source?.service_charge),
        heating_cost: toAmount(source?.heating_cost),
        other_costs: toAmount(source?.other_costs),
        payment_due_day: source?.payment_due_day || 3,
        mark_increase: true
    };
};

const infoBoxStyle = {
    fontSize: '0.8rem', lineHeight: 1.45, padding: '10px 12px', borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.2)', color: 'var(--text-primary)'
};
const warnBoxStyle = {
    fontSize: '0.8rem', lineHeight: 1.45, padding: '10px 12px', borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', color: 'var(--text-primary)'
};
const dangerBoxStyle = {
    fontSize: '0.82rem', lineHeight: 1.5, padding: '12px 14px', borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--text-primary)'
};
const tileErrorStyle = {
    padding: '12px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.05)',
    border: '1px solid rgba(239, 68, 68, 0.15)', fontSize: '0.8rem', color: 'var(--danger-color)',
    display: 'flex', alignItems: 'center', gap: '6px'
};
const selectStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
    backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)'
};
const modalFooterStyle = { display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', flexWrap: 'wrap' };

const TenantDetail = () => {
    const { id: leaseId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, userRole } = useAuth();
    const perm = usePermission();

    // Navigationswunsch aus der Mieterübersicht (Bearbeiten / Mietänderung direkt öffnen)
    const initialNavState = useRef(location.state || null);

    // Data States
    const [lease, setLease] = useState(null);

    // UI-Rechte für Freigabe-Nutzer, bezogen auf das Portfolio dieses Mietverhältnisses
    // (die Datenbank prüft zusätzlich per RLS)
    const canWriteFor = (category, portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId ? perm.canWrite(category, portfolioId) : perm.canWrite(category);
    };
    const leasePortfolioId = lease?.unit?.property?.portfolio_id || null;
    const canEditLease = canWriteFor('mietverhaeltnisse', leasePortfolioId);
    const canEditFinance = canWriteFor('finanzen', leasePortfolioId);
    const canEditDocuments = canWriteFor('immobilien', leasePortfolioId);
    const canEditTickets = canWriteFor('mieterportal', leasePortfolioId);
    const [tickets, setTickets] = useState([]);
    const [ticketsError, setTicketsError] = useState(null);
    const [tenantUserId, setTenantUserId] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [documentsError, setDocumentsError] = useState(null);
    const [claims, setClaims] = useState([]);
    const [hiddenClaimsCount, setHiddenClaimsCount] = useState(0);
    const [claimsError, setClaimsError] = useState(null);
    const [rentPeriods, setRentPeriods] = useState({ supported: null, periods: [], error: null });
    const [cloudFiles, setCloudFiles] = useState([]);
    const [loadingCloud, setLoadingCloud] = useState(false);
    const [cloudLoadingMessage, setCloudLoadingMessage] = useState('Lade Cloud-Dateien...');
    const [cloudError, setCloudError] = useState(null);
    const [cloudFolderMissing, setCloudFolderMissing] = useState(false);
    const [tenantCloudPath, setTenantCloudPath] = useState('');
    const [cloudCoUserNotice, setCloudCoUserNotice] = useState(false);
    // Ordner dieses Mietverhältnisses: gemerkter Ordner (lease_cloud_folders) und Ordner aus den aktuellen Namen
    const cloudPathsRef = useRef({ primary: '', fallback: '' });
    const leaseFolderRef = useRef(null); // { connectionId, path } – zuletzt bekannter Eintrag in lease_cloud_folders
    const leaseFolderSupportedRef = useRef(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modals
    const [isEditTenantOpen, setIsEditTenantOpen] = useState(false);
    const [isEditLeaseOpen, setIsEditLeaseOpen] = useState(false);
    const [isRentChangeOpen, setIsRentChangeOpen] = useState(false);
    const [isTerminateOpen, setIsTerminateOpen] = useState(false);
    const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
    const [paymentClaim, setPaymentClaim] = useState(null);
    const [writeOffClaim, setWriteOffClaim] = useState(null);
    const [retroWarning, setRetroWarning] = useState(null); // { title, message, onConfirm }
    const [retroAccepted, setRetroAccepted] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Forms
    const [tenantForm, setTenantForm] = useState(buildTenantForm());
    const [leaseForm, setLeaseForm] = useState(buildLeaseForm(null));
    const [rentForm, setRentForm] = useState(buildRentForm(null, null));
    const [terminateForm, setTerminateForm] = useState({ end_date: '' });
    const [ticketForm, setTicketForm] = useState({ title: '', description: '', priority: 'normal' });
    const [paymentForm, setPaymentForm] = useState({ amount: '', date: '', note: '' });
    const [writeOffForm, setWriteOffForm] = useState({ reason: '' });
    // Formularstand beim Öffnen der Dialoge (Rückfrage vor dem Verwerfen geänderter Eingaben)
    const formSnapshotRef = useRef({ tenant: null, lease: null, rent: null });

    // Interne Notizen: in der Datenbank (lease_notes, nicht für Mieter sichtbar). Fehlt die Tabelle
    // noch (Migration nicht eingespielt), wie bisher nur lokal im Browser.
    const [notes, setNotes] = useState('');
    const [notesMode, setNotesMode] = useState('loading'); // 'loading' | 'db' | 'local' | 'unavailable'
    const [notesStatus, setNotesStatus] = useState(null); // null | 'pending' | 'saving' | 'saved' | 'error'
    const [notesError, setNotesError] = useState(null);
    const notesLeaseRef = useRef(null);      // Mietverhältnis, zu dem die angezeigten Notizen gehören
    const notesTimerRef = useRef(null);
    const notesPendingRef = useRef(null);    // { leaseId, value } – noch nicht gesendete Änderung
    const notesChainRef = useRef(Promise.resolve()); // Speichervorgänge nacheinander

    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    // Heute gültige Miete: aus der Miethistorie, sonst die Vertragswerte
    const today = localISODate();
    const currentPeriod = rentPeriods.supported === true ? getEffectivePeriod(rentPeriods.periods, today) : null;
    const currentRent = currentPeriod || lease;

    const localNotesKey = (id) => `tenant_notes_${id}`;
    const readLocalNotes = (id) => {
        try {
            return localStorage.getItem(localNotesKey(id)) || '';
        } catch {
            return '';
        }
    };
    const removeLocalNotes = (id) => {
        try {
            localStorage.removeItem(localNotesKey(id));
        } catch {
            // Speicher nicht verfügbar (privates Fenster o. Ä.)
        }
    };

    // Notizen speichern; Anfragen laufen nacheinander, damit keine ältere Fassung eine neuere überholt
    const persistNotes = (targetLeaseId, value) => {
        notesChainRef.current = notesChainRef.current.then(async () => {
            if (notesLeaseRef.current === targetLeaseId) setNotesStatus('saving');
            const { error: saveError } = await supabase
                .from('lease_notes')
                .upsert({ lease_id: targetLeaseId, notes: value }, { onConflict: 'lease_id' });
            if (!saveError) removeLocalNotes(targetLeaseId);
            if (notesLeaseRef.current !== targetLeaseId) return;
            if (saveError) {
                setNotesStatus('error');
                setNotesError('Die Notizen konnten nicht gespeichert werden: ' + translateError(saveError));
            } else if (!notesPendingRef.current) {
                setNotesStatus('saved');
                setNotesError(null);
            }
        });
        return notesChainRef.current;
    };

    const flushPendingNotes = () => {
        if (notesTimerRef.current) {
            clearTimeout(notesTimerRef.current);
            notesTimerRef.current = null;
        }
        const pending = notesPendingRef.current;
        notesPendingRef.current = null;
        if (pending) persistNotes(pending.leaseId, pending.value);
    };

    const loadNotes = async (targetLeaseId) => {
        const localValue = readLocalNotes(targetLeaseId);
        const { data, error: notesLoadError } = await supabase
            .from('lease_notes')
            .select('notes')
            .eq('lease_id', targetLeaseId)
            .maybeSingle();
        if (notesLeaseRef.current !== targetLeaseId) return;
        if (notesLoadError) {
            if (isMissingTableError(notesLoadError)) {
                setNotes(localValue);
                setNotesMode('local');
            } else {
                // Nicht bearbeitbar, damit keine leere Fassung gespeicherte Notizen überschreibt
                setNotes('');
                setNotesMode('unavailable');
                setNotesError('Die Notizen konnten nicht geladen werden: ' + translateError(notesLoadError));
            }
            return;
        }
        if (data) {
            setNotes(data.notes || '');
            setNotesMode('db');
            return;
        }
        // Noch kein Eintrag: bisher nur in diesem Browser gespeicherte Notizen einmalig übernehmen
        setNotes(localValue);
        setNotesMode('db');
        if (localValue.trim()) persistNotes(targetLeaseId, localValue);
    };

    useEffect(() => {
        if (!leaseId || userRole === 'tenant') return;
        // Notizen beim Wechsel des Mietverhältnisses immer neu laden (nicht vom vorherigen übernehmen)
        notesLeaseRef.current = leaseId;
        setNotes('');
        setNotesMode('loading');
        setNotesStatus(null);
        setNotesError(null);
        loadNotes(leaseId);
        loadTenantData();
        // Beim Verlassen noch nicht gesendete Änderungen speichern
        return () => flushPendingNotes();
    }, [leaseId, userRole]);

    // Ordner dieses Mietverhältnisses merken (lease_cloud_folders): Eine spätere Umbenennung von Mieter
    // oder Einheit führt dann nicht zu einem neuen, leeren Ordner. Fehler sind unkritisch – der Pfad
    // wird dann wie bisher aus den Namen gebildet.
    const rememberLeaseCloudFolder = async (connectionId, path) => {
        const folderPath = normalizeCloudPath(path);
        if (!leaseFolderSupportedRef.current || !user?.id || !connectionId || !folderPath) return;
        const known = leaseFolderRef.current;
        if (known && known.connectionId === connectionId && known.path === folderPath) return;
        const { error: upsertError } = await supabase
            .from('lease_cloud_folders')
            .upsert({
                lease_id: leaseId,
                cloud_connection_id: connectionId,
                user_id: user.id,
                folder_path: folderPath,
                updated_at: new Date().toISOString()
            }, { onConflict: 'lease_id,cloud_connection_id' });
        if (!upsertError) {
            leaseFolderRef.current = { connectionId, path: folderPath };
        } else if (isMissingTableError(upsertError)) {
            leaseFolderSupportedRef.current = false;
        }
    };

    // path = gemerkter Ordner (falls vorhanden), fallbackPath = Ordner aus den aktuellen Namen
    const loadCloudFiles = async (connection, path, fallbackPath = '') => {
        if (!connection || !path) return;
        setLoadingCloud(true);
        setCloudLoadingMessage('Lese Cloud-Ordner...');
        setCloudError(null);
        setCloudFolderMissing(false);
        const listFolder = (folderPath) => supabase.functions.invoke('cloud-drive', {
            body: { action: 'list', provider: connection.provider, connectionId: connection.id, path: folderPath }
        });
        // Nur ein echter 404 "Ordner nicht gefunden" bedeutet "Ordner fehlt"; alle anderen Fehler werden angezeigt
        const isFolderMissing = (info) => info.status === 404 && (!info.code || info.code === 'folder_not_found');
        try {
            let usedPath = path;
            let { data, error: fnError } = await listFolder(path);
            let errorInfo = fnError ? await readFunctionError(fnError) : null;
            // Gemerkter Ordner existiert nicht mehr -> Ordner aus den aktuellen Namen versuchen
            if (errorInfo && isFolderMissing(errorInfo) && fallbackPath && fallbackPath !== path) {
                usedPath = fallbackPath;
                ({ data, error: fnError } = await listFolder(fallbackPath));
                errorInfo = fnError ? await readFunctionError(fnError) : null;
            }
            setTenantCloudPath(usedPath);

            if (errorInfo) {
                if (isFolderMissing(errorInfo)) {
                    setCloudFolderMissing(true);
                    setCloudFiles([]);
                    return;
                }
                throw new Error(errorInfo.message);
            }
            if (data?.error) throw new Error(data.error);
            setCloudFiles(data?.files || []);
            rememberLeaseCloudFolder(connection.id, usedPath);
        } catch (err) {
            console.error('Error loading cloud files:', err);
            setCloudError(err.message || String(err));
            setCloudFiles([]);
        } finally {
            setLoadingCloud(false);
            setCloudLoadingMessage('Lade Cloud-Dateien...');
        }
    };

    const reloadCloudFiles = () => {
        const connection = lease?.unit?.property?.cloud_connection;
        const { primary, fallback } = cloudPathsRef.current;
        if (connection) loadCloudFiles(connection, primary || tenantCloudPath, fallback);
    };

    const handleCreateCloudFolder = async () => {
        const prop = lease?.unit?.property;
        const connection = prop?.cloud_connection;
        if (!connection || !tenantCloudPath) return;
        if (!window.confirm('Der Cloud-Ordner für dieses Mietverhältnis existiert noch nicht.\n\nJetzt die Ordnerstruktur für dieses Objekt in der Cloud anlegen?')) return;

        setLoadingCloud(true);
        setCloudLoadingMessage('Erstelle Cloud-Ordner...');
        setCloudError(null);
        try {
            const syncRes = await supabase.functions.invoke('cloud-sync', {
                body: { provider: connection.provider, connectionId: connection.id, action: 'create', propertyId: prop.id }
            });
            if (syncRes.error) throw new Error(await readFunctionErrorMessage(syncRes.error));
            if (syncRes.data?.error) throw new Error(syncRes.data.error);
        } catch (err) {
            setCloudError(err.message || String(err));
            setLoadingCloud(false);
            setCloudLoadingMessage('Lade Cloud-Dateien...');
            return;
        }
        // Angelegt wird der Ordner aus den aktuellen Namen
        const createdPath = cloudPathsRef.current.fallback || tenantCloudPath;
        cloudPathsRef.current = { primary: createdPath, fallback: createdPath };
        await loadCloudFiles(connection, createdPath);
    };

    const loadTenantData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch Lease with related unit, property, tenant
            const { data: leaseData, error: leaseError } = await supabase
                .from('leases')
                .select(`
                    *,
                    tenant:tenants(*),
                    unit:units(
                        *,
                        property:properties(*)
                    )
                `)
                .eq('id', leaseId)
                .maybeSingle();

            if (leaseError) throw leaseError;
            if (!leaseData) throw new Error('Mietverhältnis nicht gefunden oder keine Berechtigung.');

            const today = localISODate();
            const mayEditLease = canWriteFor('mietverhaeltnisse', leaseData.unit?.property?.portfolio_id || null);

            // Status nachziehen: Vertragsende abgelaufen -> beendet (Vertrag bleibt bis zum Ende aktiv)
            if (leaseData.status === 'active' && leaseData.end_date && leaseData.end_date < today && mayEditLease) {
                const { data: stData, error: stError } = await supabase
                    .from('leases')
                    .update({ status: 'ended' })
                    .eq('id', leaseId)
                    .select('id');
                if (!stError && stData && stData.length > 0) leaseData.status = 'ended';
            }

            // Cloud-Verbindung über portfolio_cloud_links (nur Provider, keine Tokens laden)
            let cloudLinkError = null;
            if (leaseData.unit?.property?.portfolio_id) {
                const { data: linkData, error: linkError } = await supabase
                    .from('portfolio_cloud_links')
                    .select('cloud_connection_id')
                    .eq('portfolio_id', leaseData.unit.property.portfolio_id)
                    .maybeSingle();
                if (linkError) cloudLinkError = linkError.message;

                if (linkData?.cloud_connection_id) {
                    const { data: connData, error: connError } = await supabase
                        .from('cloud_connections')
                        .select('id, provider')
                        .eq('id', linkData.cloud_connection_id)
                        .maybeSingle();
                    if (connError) cloudLinkError = connError.message;

                    if (connData && leaseData.unit.property) {
                        leaseData.unit.property.cloud_connection = connData;
                    }
                }
            }

            setLease(leaseData);
            setTenantForm(buildTenantForm(leaseData.tenant || {}));
            setLeaseForm(buildLeaseForm(leaseData));

            // Miethistorie ("gültig ab") – fehlt die Tabelle noch, gilt der bisherige Modus
            const periodsResult = await fetchRentPeriods(leaseId);
            setRentPeriods(periodsResult);

            // Portalzugang des Mieters (für Tickets)
            let portalUserId = null;
            if (leaseData.tenant_id) {
                const { data: roleRows } = await supabase
                    .from('user_roles')
                    .select('user_id')
                    .eq('tenant_id', leaseData.tenant_id)
                    .eq('role', 'tenant')
                    .limit(1);
                portalUserId = roleRows?.[0]?.user_id || null;
            }
            setTenantUserId(portalUserId);

            // Tickets dieses Mieters (nicht aller Mieter der Einheit)
            setTicketsError(null);
            if (leaseData.unit_id && portalUserId) {
                const { data: ticketData, error: ticketErr } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('unit_id', leaseData.unit_id)
                    .eq('tenant_user_id', portalUserId)
                    .order('created_at', { ascending: false });
                if (ticketErr) {
                    setTicketsError(ticketErr.message);
                    setTickets([]);
                } else {
                    setTickets(ticketData || []);
                }
            } else {
                setTickets([]);
            }

            // Dokumente (lokale Ablage)
            setDocumentsError(null);
            if (leaseData.tenant_id) {
                const { data: docData, error: docErr } = await supabase
                    .from('documents')
                    .select('*')
                    .eq('tenant_id', leaseData.tenant_id)
                    .order('created_at', { ascending: false });
                if (docErr) {
                    setDocumentsError(docErr.message);
                    setDocuments([]);
                } else {
                    setDocuments(docData || []);
                }
            } else {
                setDocuments([]);
            }

            // Forderungen zu diesem Mietverhältnis
            setClaimsError(null);
            const { data: claimsData, error: claimsErr } = await supabase
                .from('claims')
                .select(`
                    id, user_id, status, escalation_level, deadline, created_at,
                    interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees
                `)
                .eq('lease_id', leaseId)
                .order('created_at', { ascending: false });

            if (claimsErr) {
                setClaimsError(claimsErr.message);
                setClaims([]);
                setHiddenClaimsCount(0);
            } else {
                const allClaims = claimsData || [];
                const visibleClaims = allClaims.filter(c => !HIDDEN_CLAIM_STATUSES.includes(c.status));
                setHiddenClaimsCount(allClaims.length - visibleClaims.length);

                let totalsData = [];
                if (visibleClaims.length > 0) {
                    const { data: tData, error: tErr } = await supabase
                        .from('claim_totals_view')
                        .select('claim_id, total_due, current_principal_open, total_fees_open, total_interest_open')
                        .in('claim_id', visibleClaims.map(c => c.id));
                    if (tErr) {
                        setClaimsError('Die Beträge der Forderungen konnten nicht geladen werden: ' + tErr.message);
                    } else {
                        totalsData = tData || [];
                    }
                }

                setClaims(visibleClaims.map(c => {
                    const total = totalsData.find(t => t.claim_id === c.id);
                    return {
                        ...c,
                        hasTotals: !!total,
                        total_due: total ? toAmount(total.total_due) : null,
                        principal_open: total ? toAmount(total.current_principal_open) : null,
                        fees_open: total ? toAmount(total.total_fees_open) : null,
                        interest_open: total ? toAmount(total.total_interest_open) : null
                    };
                }));
            }

            // Compute cloud folder path and fetch files if cloud connection exists
            let displayFolderName = '';
            const prop = leaseData.unit?.property;
            if (prop) {
                if (prop.economic_unit_id) {
                    // Gleiche Reihenfolge wie cloud-sync (nach Straße), sonst entsteht ein anderer Ordnername
                    const { data: siblingProps } = await supabase
                        .from('properties')
                        .select('street, house_number')
                        .eq('economic_unit_id', prop.economic_unit_id)
                        .order('street');

                    const groupedByStreet = {};
                    (siblingProps || []).forEach(m => {
                        if (!m.street) return;
                        if (!groupedByStreet[m.street]) groupedByStreet[m.street] = [];
                        if (m.house_number) {
                            groupedByStreet[m.street].push(m.house_number);
                        }
                    });
                    const parts = Object.keys(groupedByStreet).map(street => {
                        const nums = groupedByStreet[street];
                        if (nums.length > 0) {
                            return `${cloudFolderSegment(street)} ${nums.map(cloudFolderSegment).join(' & ')}`;
                        }
                        return cloudFolderSegment(street);
                    });
                    const displayNames = parts.slice(0, 2).join(' | ');
                    const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames;
                    displayFolderName = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`;
                } else {
                    displayFolderName = `${cloudFolderSegment(prop.street)} ${cloudFolderSegment(prop.house_number || '')}`.trim();
                }
            }

            // Jeder Name ergibt genau ein Ordnersegment (gleiche Regel wie cloud-sync)
            const tenantFolderName = cloudFolderSegment(`${leaseData.tenant?.first_name || ''} ${leaseData.tenant?.last_name || ''}`.trim());
            const unitName = leaseData.unit?.unit_name || '';
            let fullCloudPath = '';
            if (displayFolderName && unitName && tenantFolderName) {
                if (prop?.economic_unit_id) {
                    const houseNumber = cloudFolderSegment(prop.house_number || 'Ohne Hausnummer');
                    fullCloudPath = `${displayFolderName}/Einheiten/${houseNumber}/${cloudFolderSegment(unitName)}/Mietverhältnisse/${tenantFolderName}`;
                } else {
                    fullCloudPath = `${displayFolderName}/Einheiten/${cloudFolderSegment(unitName)}/Mietverhältnisse/${tenantFolderName}`;
                }
            }

            // Gemerkter Ordner dieses Mietverhältnisses (bleibt nach Umbenennung von Mieter/Einheit gültig)
            const cloudConnection = prop?.cloud_connection || null;
            let storedFolderPath = '';
            leaseFolderRef.current = null;
            if (cloudConnection && leaseFolderSupportedRef.current) {
                const { data: folderRow, error: folderError } = await supabase
                    .from('lease_cloud_folders')
                    .select('folder_path')
                    .eq('lease_id', leaseId)
                    .eq('cloud_connection_id', cloudConnection.id)
                    .maybeSingle();
                if (folderError) {
                    if (isMissingTableError(folderError)) leaseFolderSupportedRef.current = false;
                    else console.error('Error loading lease cloud folder:', folderError);
                } else if (folderRow?.folder_path) {
                    storedFolderPath = folderRow.folder_path;
                    leaseFolderRef.current = { connectionId: cloudConnection.id, path: storedFolderPath };
                }
            }
            const primaryCloudPath = storedFolderPath || fullCloudPath;
            cloudPathsRef.current = { primary: primaryCloudPath, fallback: fullCloudPath };
            setTenantCloudPath(primaryCloudPath);

            // Mitnutzer ohne eigene Cloud-Zuweisung: die Cloud des Eigentümers ist für ihn nicht nutzbar
            setCloudCoUserNotice(!cloudConnection && !cloudLinkError && !!prop?.user_id && !!user?.id && prop.user_id !== user.id);

            if (cloudLinkError) {
                setCloudError('Die Cloud-Verbindung konnte nicht geprüft werden: ' + cloudLinkError);
            } else if (cloudConnection && primaryCloudPath) {
                loadCloudFiles(cloudConnection, primaryCloudPath, fullCloudPath);
            }

            // Direkt "Bearbeiten" bzw. "Mietänderung" öffnen, wenn aus der Übersicht gewünscht
            const navState = initialNavState.current;
            if (navState && (navState.openRentChange || navState.openEditLease)) {
                initialNavState.current = null;
                if (mayEditLease) {
                    if (navState.openRentChange) {
                        const initialRent = buildRentForm(leaseData, periodsResult);
                        formSnapshotRef.current.rent = initialRent;
                        setRentForm(initialRent);
                        setIsRentChangeOpen(true);
                    } else {
                        const initialLease = buildLeaseForm(leaseData);
                        formSnapshotRef.current.lease = initialLease;
                        setLeaseForm(initialLease);
                        setIsEditLeaseOpen(true);
                    }
                }
                navigate(location.pathname, { replace: true, state: {} });
            }

        } catch (err) {
            console.error('Error loading tenant data:', err);
            setError(err.message || 'Mietverhältnis konnte nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    };

    // Notizen ändern: in der Datenbank entprellt speichern, sonst (Altstand) lokal im Browser
    const handleSaveNotes = (val) => {
        setNotes(val);
        if (notesMode === 'local') {
            try {
                localStorage.setItem(localNotesKey(leaseId), val);
            } catch {
                // Speicher nicht verfügbar (privates Fenster o. Ä.)
            }
            return;
        }
        if (notesMode !== 'db') return;
        notesPendingRef.current = { leaseId, value: val };
        setNotesStatus('pending');
        if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
        notesTimerRef.current = setTimeout(flushPendingNotes, 800);
    };

    const openRetroWarning = (config) => {
        setRetroAccepted(false);
        setRetroWarning(config);
    };

    // Ist-/Soll-Werte der Einheit nur für den heute laufenden Vertrag angleichen
    const syncUnitFromLease = async (leaseLike, rentValues) => {
        if (!leaseLike?.unit_id || getLeaseTimeState(leaseLike) !== 'running') return null;
        // Kaution ohne Angabe (NULL) auch in der Einheit als NULL führen, nicht als 0 (G03-16)
        const depositRaw = leaseLike.deposit;
        const { data: unitRows, error: unitError } = await supabase
            .from('units')
            .update({
                cold_rent_ist: toAmount(rentValues?.cold_rent),
                service_charge_soll: toAmount(rentValues?.service_charge),
                heating_cost_soll: toAmount(rentValues?.heating_cost),
                other_costs_soll: toAmount(rentValues?.other_costs),
                deposit_soll: depositRaw === null || depositRaw === undefined || depositRaw === '' ? null : toAmount(depositRaw)
            })
            .eq('id', leaseLike.unit_id)
            .select('id');
        if (unitError) return 'Hinweis: Die Werte der Einheit konnten nicht angeglichen werden: ' + unitError.message;
        // RLS units_update verlangt Schreibrecht „Immobilien“ – ohne dieses ändert das Update still 0 Zeilen
        if (!unitRows || unitRows.length === 0) {
            return 'Hinweis: Die Werte der Einheit (Kaltmiete Ist/NK-Soll/Kaution) konnten nicht angeglichen werden – dafür ist das Schreibrecht „Immobilien“ nötig.';
        }
        return null;
    };

    // Nach einer Mietänderung: heute gültige Werte erneut laden und in die Einheit übernehmen
    const refreshUnitAfterRentChange = async (leaseLike) => {
        const refreshed = await fetchRentPeriods(leaseId);
        if (refreshed.supported !== true) return null;
        const effective = getEffectivePeriod(refreshed.periods, localISODate());
        if (!effective) return null;
        return syncUnitFromLease(leaseLike, effective);
    };

    // ---------------------------------------------------------------------
    // Mieter-Stammdaten
    // ---------------------------------------------------------------------
    const openEditTenant = () => {
        const initial = buildTenantForm(lease?.tenant || {});
        formSnapshotRef.current.tenant = initial;
        setTenantForm(initial);
        setIsEditTenantOpen(true);
    };

    // Esc, X und „Abbrechen“: nur nach Rückfrage schließen, wenn Eingaben geändert wurden
    const confirmDiscardForm = (current, key) =>
        !isFormDirty(current, formSnapshotRef.current[key]) || window.confirm(DISCARD_CHANGES_PROMPT);
    const closeEditTenant = () => {
        if (confirmDiscardForm(tenantForm, 'tenant')) setIsEditTenantOpen(false);
    };
    const closeEditLease = () => {
        if (confirmDiscardForm(leaseForm, 'lease')) setIsEditLeaseOpen(false);
    };
    const closeRentChange = () => {
        if (confirmDiscardForm(rentForm, 'rent')) setIsRentChangeOpen(false);
    };

    const handleSaveTenant = async () => {
        if (!tenantForm.first_name.trim() || !tenantForm.last_name.trim()) {
            alert('Bitte Vor- und Nachnamen ausfüllen.');
            return;
        }
        if (!lease?.tenant_id) {
            alert('Diesem Mietverhältnis ist kein Mieter zugeordnet.');
            return;
        }
        setIsSaving(true);
        try {
            const { data, error: tError } = await supabase
                .from('tenants')
                .update({
                    salutation: TENANT_SALUTATIONS.includes(tenantForm.salutation) ? tenantForm.salutation : null,
                    first_name: tenantForm.first_name.trim(),
                    last_name: tenantForm.last_name.trim(),
                    phone: tenantForm.phone,
                    email: tenantForm.email,
                    occupants: parseInt(tenantForm.occupants) || 1,
                    street: tenantForm.street,
                    house_number: tenantForm.house_number,
                    postal_code: tenantForm.postal_code,
                    city: tenantForm.city
                })
                .eq('id', lease.tenant_id)
                .select('id');

            if (tError) throw tError;
            if (!data || data.length === 0) throw new Error('Keine Berechtigung, diesen Mieter zu ändern.');

            setIsEditTenantOpen(false);
            await loadTenantData();
        } catch (err) {
            alert('Fehler beim Speichern der Mieterdaten: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // ---------------------------------------------------------------------
    // Vertragsdaten (Laufzeit, Vertragsart, Kaution, letzte Mieterhöhung)
    // ---------------------------------------------------------------------
    const openEditLease = () => {
        const initial = buildLeaseForm(lease);
        formSnapshotRef.current.lease = initial;
        setLeaseForm(initial);
        setIsEditLeaseOpen(true);
    };

    const handleSaveLease = async () => {
        const f = leaseForm;
        const today = localISODate();

        if (!isValidISODate(f.start_date)) return alert('Bitte ein gültiges Datum für den Mietbeginn angeben.');
        if (f.end_date && !isValidISODate(f.end_date)) return alert('Bitte ein gültiges Datum für das Mietende angeben.');
        if (f.end_date && f.end_date < f.start_date) return alert('Das Mietende darf nicht vor dem Mietbeginn liegen.');
        if (f.last_rent_increase && !isValidISODate(f.last_rent_increase)) return alert('Bitte ein gültiges Datum für die letzte Mieterhöhung angeben.');
        if (f.booking_start_date && !isValidISODate(f.booking_start_date)) return alert('Bitte ein gültiges Datum für „Mietkonto geführt ab“ angeben.');
        // Ausgewertet wird monatsweise (rentArrears.js) → nur ein Monat vor dem Mietbeginn ist unzulässig
        if (f.booking_start_date && f.booking_start_date.slice(0, 7) < f.start_date.slice(0, 7)) return alert('„Mietkonto geführt ab“ darf nicht vor dem Monat des Mietbeginns liegen.');

        const deposit = f.deposit === '' || f.deposit === null || f.deposit === undefined ? null : toAmount(f.deposit);
        if (deposit !== null && deposit < 0) return alert('Die Kaution darf nicht negativ sein.');

        const coldRentNow = toAmount(currentRent?.cold_rent);
        if (deposit && coldRentNow > 0 && deposit > coldRentNow * 3 + 0.005) {
            if (!window.confirm(
                `Hinweis: Die Kaution (${formatEUR(deposit)}) übersteigt drei Monatskaltmieten (${formatEUR(coldRentNow * 3)}).\n` +
                'Nach § 551 BGB darf die Mietsicherheit höchstens das Dreifache der Nettokaltmiete betragen.\n\nTrotzdem speichern?'
            )) return;
        }

        const startChanged = f.start_date !== lease.start_date;
        const endChanged = (f.end_date || null) !== (lease.end_date || null);

        // Überschneidung mit anderen Verträgen der Einheit
        if (startChanged || endChanged) {
            const { error: ovErr, overlaps } = await findOverlappingLeases({
                unitId: lease.unit_id, startDate: f.start_date, endDate: f.end_date || null, excludeLeaseId: leaseId
            });
            if (ovErr) return alert('Die Prüfung auf überschneidende Mietverträge ist fehlgeschlagen: ' + ovErr.message);
            if (overlaps.length > 0) {
                return alert(
                    'Die neue Laufzeit überschneidet sich mit einem anderen Mietvertrag dieser Einheit:\n\n' +
                    overlaps.map(describeLease).join('\n') +
                    '\n\nBitte passen Sie zuerst den anderen Vertrag an.'
                );
            }
        }

        const payload = {
            start_date: f.start_date,
            end_date: f.end_date || null,
            deposit,
            lease_type: f.lease_type || 'normal',
            last_rent_increase: f.last_rent_increase || null,
            // Leer = NULL: Buchungsbeginn wieder automatisch (Mietbeginn bzw. Erfassung, siehe rentArrears.js)
            booking_start_date: f.booking_start_date || null,
            // Status folgt dem Vertragsende: beendet erst nach Ablauf
            status: f.end_date && f.end_date < today ? 'ended' : 'active'
        };

        const doSave = async () => {
            setIsSaving(true);
            try {
                const { data, error: lError } = await supabase
                    .from('leases')
                    .update(payload)
                    .eq('id', leaseId)
                    .select('id');

                if (lError) throw lError;
                if (!data || data.length === 0) throw new Error('Keine Berechtigung, diesen Mietvertrag zu ändern.');

                const unitWarning = await syncUnitFromLease({ ...lease, ...payload }, currentRent);

                setIsEditLeaseOpen(false);
                await loadTenantData();
                if (unitWarning) alert(unitWarning);
            } catch (err) {
                alert('Fehler beim Speichern des Mietvertrags: ' + (err.message || err));
            } finally {
                setIsSaving(false);
            }
        };

        if (startChanged && (f.start_date <= today || lease.start_date <= today)) {
            if (rentPeriods.supported !== true) {
                openRetroWarning({
                    title: 'Achtung: Änderung wirkt rückwirkend',
                    message:
                        `Der Mietbeginn wird von ${formatDateDE(lease.start_date)} auf ${formatDateDE(f.start_date)} geändert. ` +
                        'Die Miethistorie („gültig ab") ist in der Datenbank noch nicht eingerichtet: Die Änderung wirkt rückwirkend auf alle Monate seit Vertragsbeginn. ' +
                        'Die Datenbank berechnet dabei das Soll jedes Monats mit der heutigen Miete neu – frühere Mieterhöhungen gehen im Mietkonto verloren, ' +
                        'bereits bezahlte Monate können als offen (Rückstand) erscheinen und in Forderungen bzw. Mahnungen übernommen werden.',
                    onConfirm: doSave
                });
                return;
            }
            if (!window.confirm(
                `Der Mietbeginn wird von ${formatDateDE(lease.start_date)} auf ${formatDateDE(f.start_date)} geändert.\n\n` +
                'Das Mietkonto wird für die neue Laufzeit neu berechnet: Für hinzukommende Monate werden Sollstellungen angelegt, ' +
                'unbezahlte Sollstellungen vor dem neuen Mietbeginn entfallen. Fortfahren?'
            )) return;
        }

        await doSave();
    };

    // ---------------------------------------------------------------------
    // Mietänderung ab Datum (Miethistorie) bzw. bisheriger Modus mit Warnung
    // ---------------------------------------------------------------------
    const openRentChange = () => {
        const initial = buildRentForm(lease, rentPeriods);
        formSnapshotRef.current.rent = initial;
        setRentForm(initial);
        setIsRentChangeOpen(true);
    };

    const handleSaveRentChange = async () => {
        const f = rentForm;
        const today = localISODate();
        const currentMonth = monthStart(today);

        const values = {
            cold_rent: toAmount(f.cold_rent),
            service_charge: toAmount(f.service_charge),
            heating_cost: toAmount(f.heating_cost),
            other_costs: toAmount(f.other_costs),
            payment_due_day: parseInt(f.payment_due_day, 10)
        };

        if ([values.cold_rent, values.service_charge, values.heating_cost, values.other_costs].some(v => v < 0)) {
            return alert('Beträge dürfen nicht negativ sein.');
        }
        if (!values.payment_due_day || values.payment_due_day < 1 || values.payment_due_day > 28) {
            return alert('Bitte einen Zahltag zwischen 1 und 28 angeben (Kalendertag im Monat).');
        }

        if (rentPeriods.supported === true) {
            if (!isValidISODate(f.valid_from)) return alert('Bitte ein gültiges Datum für „gültig ab" angeben.');

            const target = monthStart(f.valid_from);
            const periods = rentPeriods.periods;
            const reference = getEffectivePeriod(periods, target) || lease;
            const unchanged = RENT_PERIOD_FIELDS.every(k => toAmount(reference?.[k]) === toAmount(values[k]));
            if (unchanged) return alert('Die Werte entsprechen bereits der ab diesem Monat gültigen Miete. Es wurde nichts geändert.');

            const first = periods[0];
            const isCorrection = (first ? target <= monthStart(first.valid_from) : false) || target <= monthStart(lease.start_date);

            if (isCorrection) {
                if (!window.confirm(
                    `Korrektur der Anfangsmiete: Die Werte gelten ab Vertragsbeginn (${formatDateDE(lease.start_date)}). ` +
                    'Alle Monate im Mietkonto werden mit den neuen Werten neu berechnet; bereits bezahlte Monate können dadurch wieder als offen erscheinen.\n\n' +
                    'Bitte nur für die Korrektur von Erfassungsfehlern verwenden. Für eine Mieterhöhung wählen Sie den Monat, ab dem die neue Miete gilt.\n\nFortfahren?'
                )) return;
            } else if (target < currentMonth) {
                if (!window.confirm(
                    `Die Mietänderung gilt rückwirkend ab ${formatMonthDE(target)}. ` +
                    'Die Sollstellungen ab diesem Monat werden neu berechnet, frühere Monate bleiben unverändert.\n\nFortfahren?'
                )) return;
            }

            setIsSaving(true);
            try {
                let basePeriods = periods;
                if (!first) {
                    // Vertrag ohne Zeitraum (Altdaten): zuerst die Anfangsmiete aus den Vertragswerten sichern
                    const { data: baseData, error: baseError } = await supabase
                        .from('lease_rent_periods')
                        .insert([{
                            lease_id: leaseId,
                            valid_from: lease.start_date,
                            cold_rent: toAmount(lease.cold_rent),
                            service_charge: toAmount(lease.service_charge),
                            heating_cost: toAmount(lease.heating_cost),
                            other_costs: toAmount(lease.other_costs),
                            payment_due_day: lease.payment_due_day || 3
                        }])
                        .select('id, lease_id, valid_from, cold_rent, service_charge, heating_cost, other_costs, payment_due_day, created_at');
                    if (baseError) throw baseError;
                    basePeriods = baseData || [];
                }

                const { error: pErr, corrected } = await saveRentPeriod({
                    leaseId, periods: basePeriods, validFrom: target, leaseStartDate: lease.start_date, values
                });
                if (pErr) throw pErr;

                const warnings = [];
                const isIncrease = values.cold_rent > toAmount(reference?.cold_rent);
                if (f.mark_increase && isIncrease && !corrected) {
                    const { error: incErr } = await supabase
                        .from('leases')
                        .update({ last_rent_increase: target })
                        .eq('id', leaseId);
                    if (incErr) warnings.push('Das Datum der letzten Mieterhöhung konnte nicht gespeichert werden: ' + incErr.message);
                }

                const unitWarning = await refreshUnitAfterRentChange(lease);
                if (unitWarning) warnings.push(unitWarning);

                setIsRentChangeOpen(false);
                await loadTenantData();
                alert(
                    (corrected
                        ? 'Die Anfangsmiete wurde korrigiert.'
                        : `Die Mietänderung ab ${formatMonthDE(target)} wurde gespeichert.`) +
                    (warnings.length ? '\n\n' + warnings.join('\n') : '')
                );
            } catch (err) {
                alert('Fehler beim Speichern der Mietänderung: ' + (err.message || err));
            } finally {
                setIsSaving(false);
            }
            return;
        }

        if (rentPeriods.supported === false) {
            const unchanged = RENT_PERIOD_FIELDS.every(k => toAmount(lease?.[k]) === toAmount(values[k]));
            if (unchanged) return alert('Es wurde nichts geändert.');

            const doLegacySave = async () => {
                setIsSaving(true);
                try {
                    const { data, error: lError } = await supabase
                        .from('leases')
                        .update(values)
                        .eq('id', leaseId)
                        .select('id');
                    if (lError) throw lError;
                    if (!data || data.length === 0) throw new Error('Keine Berechtigung, diesen Mietvertrag zu ändern.');

                    const unitWarning = await syncUnitFromLease(lease, values);
                    setIsRentChangeOpen(false);
                    await loadTenantData();
                    if (unitWarning) alert(unitWarning);
                } catch (err) {
                    alert('Fehler beim Speichern der Mietänderung: ' + (err.message || err));
                } finally {
                    setIsSaving(false);
                }
            };

            if (lease.start_date && lease.start_date <= today) {
                openRetroWarning({
                    title: 'Achtung: Änderung wirkt rückwirkend',
                    message:
                        `Die Miethistorie („gültig ab") ist in der Datenbank noch nicht eingerichtet. Diese Änderung wirkt rückwirkend auf alle Monate seit Vertragsbeginn (${formatDateDE(lease.start_date)}): ` +
                        'Die Datenbank berechnet das Soll jedes Monats mit den neuen Werten neu. Nach einer Erhöhung erscheinen bereits bezahlte Monate als offen (Rückstand) ' +
                        'und können in Forderungen bzw. Mahnungen übernommen werden; nach einer Senkung entstehen rückwirkend Überzahlungen.\n\n' +
                        'Für eine Mietänderung ab einem bestimmten Monat speichern Sie bitte erst, wenn die Miethistorie eingerichtet ist.',
                    onConfirm: doLegacySave
                });
                return;
            }
            await doLegacySave();
            return;
        }

        alert('Die Miethistorie konnte nicht geladen werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.');
    };

    const handleDeleteRentPeriod = async (period) => {
        if (!window.confirm(
            `Mietänderung ab ${formatMonthDE(period.valid_from)} löschen?\n\n` +
            'Ab diesem Monat gelten dann wieder die Werte des vorherigen Zeitraums; das Mietkonto wird entsprechend neu berechnet.'
        )) return;
        setIsSaving(true);
        try {
            const { error: delError } = await deleteRentPeriod(period.id);
            if (delError) throw delError;
            const warnings = [];
            // Gehörte „Letzte Mieterhöhung“ zu diesem Zeitraum, aus der verbleibenden Historie neu bestimmen
            // (ein abweichend von Hand eingetragenes Datum bleibt unberührt)
            if (lease.last_rent_increase && monthStart(lease.last_rent_increase) === monthStart(period.valid_from)) {
                const remaining = (rentPeriods.periods || []).filter(p => p.id !== period.id);
                const { data: incRows, error: incErr } = await supabase
                    .from('leases')
                    .update({ last_rent_increase: lastRentIncreaseFromPeriods(remaining) })
                    .eq('id', leaseId)
                    .select('id');
                if (incErr || !incRows || incRows.length === 0) {
                    warnings.push('Hinweis: Das Datum der letzten Mieterhöhung konnte nicht zurückgesetzt werden'
                        + (incErr ? ': ' + incErr.message : ' (keine Berechtigung).')
                        + ' Bitte unter „Mietvertrag bearbeiten“ prüfen.');
                }
            }
            const unitWarning = await refreshUnitAfterRentChange(lease);
            if (unitWarning) warnings.push(unitWarning);
            await loadTenantData();
            if (warnings.length) alert(warnings.join('\n'));
        } catch (err) {
            alert('Fehler beim Löschen der Mietänderung: ' + (err.message || err));
        } finally {
            setIsSaving(false);
        }
    };

    // ---------------------------------------------------------------------
    // Beenden / Reaktivieren / Löschen
    // ---------------------------------------------------------------------
    const openTerminate = () => {
        setTerminateForm({ end_date: lease?.end_date || localISODate() });
        setIsTerminateOpen(true);
    };

    const handleTerminateLease = async () => {
        const endDate = terminateForm.end_date;
        if (!isValidISODate(endDate)) return alert('Bitte ein gültiges Datum für das Vertragsende angeben.');
        if (lease.start_date && endDate < lease.start_date) return alert('Das Vertragsende darf nicht vor dem Mietbeginn liegen.');

        const today = localISODate();
        const newStatus = endDate < today ? 'ended' : 'active';

        setIsSaving(true);
        try {
            const { data, error: termError } = await supabase
                .from('leases')
                .update({ end_date: endDate, status: newStatus })
                .eq('id', leaseId)
                .select('id');

            if (termError) throw termError;
            if (!data || data.length === 0) throw new Error('Keine Berechtigung, diesen Mietvertrag zu ändern.');
            setIsTerminateOpen(false);
            await loadTenantData();
        } catch (err) {
            alert('Fehler beim Beenden des Mietverhältnisses: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReactivateLease = async () => {
        setIsSaving(true);
        try {
            const { error: ovErr, overlaps } = await findOverlappingLeases({
                unitId: lease.unit_id, startDate: lease.start_date, endDate: null, excludeLeaseId: leaseId
            });
            if (ovErr) {
                alert('Die Prüfung auf andere Mietverträge der Einheit ist fehlgeschlagen: ' + ovErr.message);
                return;
            }
            if (overlaps.length > 0) {
                alert(
                    'Das Mietverhältnis kann nicht unbefristet fortgesetzt werden, weil für die Einheit ein anderer Mietvertrag besteht:\n\n' +
                    overlaps.map(describeLease).join('\n') +
                    '\n\nBitte legen Sie bei Bedarf ein neues Mietverhältnis an.'
                );
                return;
            }

            const message = lease.end_date
                ? `Das Vertragsende (${formatDateDE(lease.end_date)}) wird entfernt; das Mietverhältnis läuft unbefristet weiter.\n\n` +
                  'Für alle Monate seit dem bisherigen Vertragsende werden wieder Sollmieten angelegt. Sie erscheinen als offen, bis Zahlungen gebucht sind.\n\nFortfahren?'
                : 'Möchten Sie dieses Mietverhältnis wirklich reaktivieren?';
            if (!window.confirm(message)) return;

            const { data, error: reactError } = await supabase
                .from('leases')
                .update({ end_date: null, status: 'active' })
                .eq('id', leaseId)
                .select('id');

            if (reactError) throw reactError;
            if (!data || data.length === 0) throw new Error('Keine Berechtigung, diesen Mietvertrag zu ändern.');

            const unitWarning = await syncUnitFromLease({ ...lease, end_date: null, status: 'active' }, currentRent);
            await loadTenantData();
            if (unitWarning) alert(unitWarning);
        } catch (err) {
            alert('Fehler beim Reaktivieren: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteLease = async () => {
        setIsSaving(true);
        try {
            const info = await checkLeaseDeletion(leaseId);
            if (!info.ok) {
                alert('Die Prüfung vor dem Löschen ist fehlgeschlagen: ' + (info.error?.message || 'Unbekannter Fehler') + '\n\nDas Mietverhältnis wurde nicht gelöscht.');
                return;
            }
            if (info.blocked) {
                alert(describeDeletionBlock(info));
                return;
            }
            if (!window.confirm(deletionConfirmText(info))) return;

            const { data, error: delError } = await supabase
                .from('leases')
                .delete()
                .eq('id', leaseId)
                .select('id');

            if (delError) throw delError;
            if (!data || data.length === 0) throw new Error('Keine Berechtigung, dieses Mietverhältnis zu löschen.');
            alert('Mietverhältnis gelöscht.');
            navigate('/tenants');
        } catch (err) {
            alert('Fehler beim Löschen: ' + translateLeaseDeleteError(err));
        } finally {
            setIsSaving(false);
        }
    };

    // ---------------------------------------------------------------------
    // Forderungen: Zahlung über das Forderungsmodul buchen, Ausfall mit Grund
    // ---------------------------------------------------------------------
    const openPaymentModal = (claim) => {
        setPaymentForm({
            amount: claim.total_due !== null ? Math.round(claim.total_due * 100) / 100 : '',
            date: localISODate(),
            note: ''
        });
        setPaymentClaim(claim);
    };

    const handleRecordClaimPayment = async () => {
        const claim = paymentClaim;
        if (!claim) return;
        const amount = toAmount(paymentForm.amount);
        if (!(amount > 0)) return alert('Bitte einen Betrag größer als 0 eingeben.');
        if (claim.total_due !== null && amount > claim.total_due + 0.01) {
            return alert('Der Zahlungsbetrag darf die offene Gesamtforderung nicht übersteigen.');
        }
        if (!isValidISODate(paymentForm.date)) return alert('Bitte ein gültiges Zahlungsdatum angeben.');
        if (!window.confirm(`Zahlung über ${formatEUR(amount)} vom ${formatDateDE(paymentForm.date)} auf diese Forderung buchen?`)) return;

        setIsSaving(true);
        try {
            const { error: rpcError } = await supabase.rpc('record_claim_payment', {
                p_claim_id: claim.id,
                p_payment_date: paymentForm.date,
                p_amount: amount,
                p_note: paymentForm.note || '',
                p_installment_id: null,
                p_target_type: 'auto',
                p_target_claim_item_id: null
            });
            if (rpcError) throw rpcError;

            setPaymentClaim(null);
            await loadTenantData();
            alert('Die Zahlung wurde verbucht.');
        } catch (err) {
            console.error('Error recording claim payment:', err);
            alert('Fehler beim Buchen der Zahlung: ' + (err.message || err.details || 'Unbekannter Fehler'));
        } finally {
            setIsSaving(false);
        }
    };

    const openWriteOffModal = (claim) => {
        setWriteOffForm({ reason: '' });
        setWriteOffClaim(claim);
    };

    const handleWriteOffClaim = async () => {
        const claim = writeOffClaim;
        if (!claim) return;
        const reason = writeOffForm.reason.trim();
        if (!reason) return alert('Bitte geben Sie einen Grund für den Forderungsausfall an.');

        setIsSaving(true);
        try {
            // Datenbank-Funktion cancel_claim (eine Transaktion: Status, Portal-Link, Verlauf); läuft ein Ratenplan,
            // lehnt sie ab (Ratenplan zuerst in der Forderungsakte beenden). Ohne die Funktion: bisheriger Ablauf.
            // Dynamisch geladen, damit die Mieterakte das PDF-Modul nicht mitlädt.
            const { cancelClaim, translateClaimError } = await import('../lib/claimPdfGenerator');
            let result;
            try {
                result = await cancelClaim({ claim, reason, writeOff: true, userId: user?.id || null });
            } catch (cancelErr) {
                throw new Error(translateClaimError(cancelErr, 'Unbekannter Fehler'));
            }

            setWriteOffClaim(null);
            await loadTenantData();
            alert(!result.historySaved
                ? 'Die Forderung wurde als Ausfall storniert. Der Eintrag im Verlauf konnte nicht gespeichert werden: ' + (result.historyError?.message || 'unbekannter Fehler')
                : 'Die Forderung wurde als Ausfall storniert.');
        } catch (err) {
            alert('Fehler beim Buchen des Forderungsausfalls: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // ---------------------------------------------------------------------
    // Dokumente
    // ---------------------------------------------------------------------
    const handleCloudUpload = async (files) => {
        if (!files || files.length === 0 || uploading) return;
        const file = files[0];

        setUploading(true);
        try {
            if (file.size > MAX_UPLOAD_BYTES) {
                alert('Datei ist zu groß (max. 10 MB).');
                return;
            }
            if (!ALLOWED_UPLOAD_EXTENSIONS.includes(getFileExtension(file.name))) {
                alert('Dieser Dateityp wird nicht unterstützt. Erlaubt sind PDF, PNG, JPG, DOC und DOCX.');
                return;
            }
            const connection = lease.unit.property.cloud_connection;
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('provider', connection.provider);
            // Genau die zugewiesene Verbindung (bei mehreren Konten desselben Anbieters)
            formData.append('connectionId', connection.id);
            formData.append('path', tenantCloudPath);
            formData.append('file', file);

            const { data, error: fnError } = await supabase.functions.invoke('cloud-drive', {
                body: formData
            });

            if (fnError) throw new Error(await readFunctionErrorMessage(fnError));
            if (data?.error) throw new Error(data.error);

            loadCloudFiles(connection, tenantCloudPath);
            alert('Dokument erfolgreich in die Cloud hochgeladen.');
        } catch (err) {
            console.error('Cloud upload error:', err);
            alert('Fehler beim Cloud-Upload: ' + err.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCloudDelete = async (item) => {
        if (!window.confirm(`Möchten Sie '${item.name}' wirklich aus der Cloud löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
        setLoadingCloud(true);
        try {
            const connection = lease.unit.property.cloud_connection;
            const { data, error: fnError } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'delete', provider: connection.provider, connectionId: connection.id, itemId: item.id }
            });

            if (fnError) throw new Error(await readFunctionErrorMessage(fnError));
            if (data?.error) throw new Error(data.error);

            loadCloudFiles(connection, tenantCloudPath);
            alert('Datei erfolgreich gelöscht.');
        } catch (err) {
            console.error('Cloud delete error:', err);
            alert('Fehler beim Löschen: ' + err.message);
            setLoadingCloud(false);
        }
    };

    const handleUploadDocument = async (files) => {
        if (!files || files.length === 0 || uploading) return;
        setUploading(true);
        try {
            const file = files[0];
            const validationError = validateUploadFile(file, TENANT_DOCUMENT_RULE);
            if (validationError) {
                alert(validationError);
                return;
            }

            const propertyId = lease.unit?.property?.id;
            const tenantId = lease.tenant_id;
            if (!propertyId || !tenantId) throw new Error('Zuweisungsdaten unvollständig');

            const timestamp = Date.now();
            // Originalname bleibt in documents.file_name, der Speicher-Schlüssel wird bereinigt
            const filePath = `${propertyId}/tenant/${tenantId}/${timestamp}_${sanitizeFileName(file.name)}`;

            // Content-Type aus der Dateiendung (Browser melden für Office-Dateien oft '' bzw.
            // application/octet-stream; der Bucket erlaubt nur bestimmte Typen)
            const { body, contentType } = prepareUploadBody(file);
            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, body, { contentType });

            if (uploadError) throw uploadError;

            const { error: dbError } = await supabase
                .from('documents')
                .insert({
                    user_id: user.id,
                    property_id: propertyId,
                    unit_id: lease.unit_id,
                    tenant_id: tenantId,
                    file_name: file.name,
                    file_path: filePath,
                    mime_type: contentType,
                    category: 'personal'
                });

            if (dbError) {
                // Datei ohne Datensatz nicht liegen lassen
                await supabase.storage.from('documents').remove([filePath]);
                throw dbError;
            }

            await loadTenantData();
            alert('Dokument erfolgreich hochgeladen.');
        } catch (err) {
            console.error(err);
            alert('Fehler beim Hochladen: ' + err.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteDocument = async (doc) => {
        if (!window.confirm(`Möchten Sie das Dokument "${doc.file_name}" wirklich löschen?`)) return;
        try {
            if (doc.file_path) {
                const { error: removeError } = await supabase.storage.from('documents').remove([doc.file_path]);
                if (removeError) throw new Error('Die Datei konnte nicht aus dem Speicher entfernt werden: ' + removeError.message);
            }
            const { error: delError } = await supabase.from('documents').delete().eq('id', doc.id);
            if (delError) throw delError;
            await loadTenantData();
        } catch (err) {
            alert('Fehler beim Löschen des Dokuments: ' + err.message);
        }
    };

    const handleDownloadDocument = async (doc) => {
        try {
            const { data, error: urlError } = await supabase.storage
                .from('documents')
                .createSignedUrl(doc.file_path, 3600);
            if (urlError) throw urlError;
            if (data?.signedUrl) {
                window.open(data.signedUrl, '_blank');
            }
        } catch (err) {
            alert('Fehler beim Download: ' + err.message);
        }
    };

    // ---------------------------------------------------------------------
    // Tickets
    // ---------------------------------------------------------------------
    const openTicketModal = () => {
        setTicketForm({ title: '', description: '', priority: 'normal' });
        setIsTicketModalOpen(true);
    };

    const handleCreateTicket = async () => {
        if (!ticketForm.title.trim()) {
            alert('Bitte geben Sie einen Titel für das Ticket an.');
            return;
        }
        if (!tenantUserId) {
            alert('Für diesen Mieter besteht kein Zugang zum Mieterportal. Tickets können nur für Mieter mit Portalzugang angelegt werden.');
            return;
        }
        const propertyId = lease?.unit?.property?.id || lease?.unit?.property_id;
        if (!propertyId || !lease?.unit_id) {
            alert('Objekt oder Einheit des Mietvertrags fehlt.');
            return;
        }
        setIsSaving(true);
        try {
            const { error: ticketError } = await supabase
                .from('tickets')
                .insert({
                    unit_id: lease.unit_id,
                    property_id: propertyId,
                    tenant_user_id: tenantUserId,
                    title: ticketForm.title.trim(),
                    description: ticketForm.description.trim() || null,
                    priority: ticketForm.priority,
                    status: 'received'
                });

            if (ticketError) throw ticketError;

            setIsTicketModalOpen(false);
            await loadTenantData();
            alert('Ticket wurde erstellt.');
        } catch (err) {
            alert('Fehler beim Erstellen des Tickets: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // ---------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------
    if (userRole === 'tenant') {
        return <Navigate to="/tenant" replace />;
    }

    if (loading && !lease) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', padding: '60px', color: 'var(--text-secondary)' }}>
                <Loader2 className="animate-spin" /> Lade Mietverhältnis...
            </div>
        );
    }

    if (error || !lease) {
        return (
            <div style={{ maxWidth: '640px', margin: '40px auto' }}>
                <Card title="Mietverhältnis konnte nicht geladen werden">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={tileErrorStyle}>
                            <AlertCircle size={16} /> {error || 'Mietverhältnis nicht gefunden.'}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/tenants')}>Zurück zur Übersicht</Button>
                            <Button variant="ghost" icon={RefreshCw} onClick={() => loadTenantData()}>Erneut versuchen</Button>
                        </div>
                    </div>
                </Card>
            </div>
        );
    }

    const timeState = getLeaseTimeState(lease, today);
    // Dokumente der App-Ablage (documents mit tenant_id); auch bei Cloud-Verbindung anzeigen (Altbestand,
    // Uploads von Mitnutzern, die die Cloud des Eigentümers nicht nutzen können)
    const renderAppDocuments = (emptyText) => (documentsError ? (
        <div style={tileErrorStyle}>
            <AlertCircle size={14} /> Dokumente konnten nicht geladen werden: {documentsError}
        </div>
    ) : documents.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <FileText size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
            {emptyText}
        </div>
    ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {documents.map(doc => (
                <div
                    key={doc.id}
                    style={{
                        padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        backgroundColor: 'rgba(255,255,255,0.01)'
                    }}
                >
                    <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>
                            {doc.file_name}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {formatDateDE(doc.created_at)}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                            onClick={() => handleDownloadDocument(doc)}
                            style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--primary-color)', cursor: 'pointer' }}
                            title="Herunterladen"
                        >
                            <Download size={15} />
                        </button>
                        {canEditDocuments && (
                            <button
                                onClick={() => handleDeleteDocument(doc)}
                                style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--danger-color)', cursor: 'pointer' }}
                                title="Löschen"
                            >
                                <Trash2 size={15} />
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    ));

    const totalWarmRent = sumRent(currentRent);
    const firstPeriodId = rentPeriods.periods[0]?.id;

    // Mieterhöhung nach § 558 BGB: Verlangen frühestens 12 Monate nach Einzug bzw. letzter
    // Erhöhung, wirksam frühestens zu Beginn des dritten Kalendermonats nach Zugang
    const isStaffelOrIndex = lease.lease_type === 'staffel' || lease.lease_type === 'index';
    const increaseBase = lease.last_rent_increase || lease.start_date;
    const earliestIncreaseRequest = increaseBase ? addMonthsKeepDay(increaseBase, 12) : null;
    const earliestIncreaseEffective = earliestIncreaseRequest ? addMonths(earliestIncreaseRequest, 3) : null;
    const increaseLocked = !!earliestIncreaseRequest && earliestIncreaseRequest > today;

    // Vorschau im Dialog "Mietänderung"
    const rentFormTarget = isValidISODate(rentForm.valid_from) ? monthStart(rentForm.valid_from) : null;
    const rentFormReference = rentPeriods.supported === true && rentFormTarget
        ? (getEffectivePeriod(rentPeriods.periods, rentFormTarget) || lease)
        : lease;
    const rentFormIsCorrection = rentPeriods.supported === true && !!rentFormTarget && (
        (rentPeriods.periods[0] ? rentFormTarget <= monthStart(rentPeriods.periods[0].valid_from) : false) ||
        rentFormTarget <= monthStart(lease.start_date)
    );
    const rentFormIsIncrease = toAmount(rentForm.cold_rent) > toAmount(rentFormReference?.cold_rent);

    const statusBadge = timeState === 'ended'
        ? <Badge variant="default">Beendet</Badge>
        : timeState === 'future'
            ? <Badge variant="blue">Beginnt am {formatDateDE(lease.start_date)}</Badge>
            : lease.end_date
                ? <Badge variant="warning">Gekündigt zum {formatDateDE(lease.end_date)}</Badge>
                : <Badge variant="success">Aktiv</Badge>;

    return (
        <div style={{ paddingBottom: '60px' }}>
            {/* Navigation Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <div>
                    <button
                        onClick={() => navigate('/tenants')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: 'none', border: 'none', color: 'var(--text-secondary)',
                            fontSize: '0.85rem', cursor: 'pointer', padding: '0', marginBottom: '8px',
                            fontFamily: 'inherit'
                        }}
                    >
                        <ArrowLeft size={14} /> Zurück zur Übersicht
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                            {lease.tenant?.first_name} {lease.tenant?.last_name}
                        </h1>
                        {statusBadge}
                        {loading && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />}
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Building2 size={15} />
                        {lease.unit?.property?.street} {lease.unit?.property?.house_number}, {lease.unit?.property?.city}
                        <ChevronRight size={14} />
                        Einheit: {lease.unit?.unit_name}
                    </p>
                </div>
            </div>

            {/* Main Grid Layout */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '24px',
                alignItems: 'start'
            }}>
                {/* LEFT SIDE TILES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Tile 1: Stammdaten (Persönliche Daten) */}
                    <Card
                        title="Stammdaten"
                        action={canEditLease && lease.tenant_id ? (
                            <Button variant="ghost" size="sm" onClick={openEditTenant} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Edit size={14} /> Bearbeiten
                            </Button>
                        ) : null}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                    <User size={18} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Name</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{lease.tenant?.first_name} {lease.tenant?.last_name}</div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Phone size={16} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Telefon</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>{lease.tenant?.phone || '—'}</div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Mail size={16} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>E-Mail</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lease.tenant?.email || '—'}</div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Users size={16} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Personenanzahl</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>{lease.tenant?.occupants || 1} {(lease.tenant?.occupants || 1) === 1 ? 'Person' : 'Personen'}</div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Home size={16} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Kontaktadresse</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                                            {lease.tenant?.street ? `${lease.tenant.street} ${lease.tenant.house_number || ''}` : 'Wie Mietobjekt'}
                                            {lease.tenant?.city && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lease.tenant.postal_code} {lease.tenant.city}</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Tile 2: Zahlungen & Forderungen */}
                    <Card
                        title="Zahlungen & Forderungen"
                        action={canEditFinance ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                icon={Plus}
                                onClick={() => navigate('/forderungen', { state: { openCreate: true, defaultLeaseId: leaseId } })}
                            >
                                Neue Forderung
                            </Button>
                        ) : null}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                Übersicht der Zahlungsrückstände und laufenden Forderungen für dieses Mietverhältnis.
                            </div>

                            {claimsError && (
                                <div style={tileErrorStyle}>
                                    <AlertCircle size={14} /> Forderungen konnten nicht vollständig geladen werden: {claimsError}
                                </div>
                            )}

                            {/* Claims list */}
                            {claims.length === 0 ? (
                                !claimsError && (
                                    <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', backgroundColor: 'rgba(255,255,255,0.01)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
                                        <CheckCircle2 size={24} style={{ margin: '0 auto 6px', color: 'var(--success-color)' }} />
                                        Keine offenen Forderungen vorhanden.
                                    </div>
                                )
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {claims.map(claim => {
                                        const statusCfg = CLAIM_STATUS[claim.status] || { label: claim.status, variant: 'default' };
                                        const isClosed = CLOSED_CLAIM_STATUSES.includes(claim.status);
                                        const formatOrDash = (v) => (v === null ? '—' : formatEUR(v));

                                        return (
                                            <div
                                                key={claim.id}
                                                style={{
                                                    padding: '12px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--border-color)',
                                                    backgroundColor: 'rgba(255,255,255,0.01)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px'
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Stufe {claim.escalation_level}</span>
                                                    </div>
                                                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: (claim.total_due || 0) > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }} title="Offener Gesamtbetrag">
                                                        {formatOrDash(claim.total_due)}
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                    <div><strong>Hauptforderung offen:</strong> {formatOrDash(claim.principal_open)}</div>
                                                    <div><strong>Gebühren/Zinsen offen:</strong> {claim.fees_open === null ? '—' : formatEUR((claim.fees_open || 0) + (claim.interest_open || 0))}</div>
                                                    {claim.deadline && <div><strong>Frist:</strong> {formatDateDE(claim.deadline)}</div>}
                                                    <div><strong>Erstellt am:</strong> {formatDateDE(claim.created_at)}</div>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                                                    <Button
                                                        size="xs"
                                                        variant="ghost"
                                                        icon={Eye}
                                                        onClick={() => navigate(`/forderungen/${claim.id}`)}
                                                    >
                                                        Details
                                                    </Button>
                                                    {!isClosed && canEditFinance && (
                                                        <>
                                                            <Button
                                                                size="xs"
                                                                variant="secondary"
                                                                onClick={() => openPaymentModal(claim)}
                                                                disabled={isSaving}
                                                            >
                                                                Zahlung erfassen
                                                            </Button>
                                                            <Button
                                                                size="xs"
                                                                variant="ghost"
                                                                onClick={() => openWriteOffModal(claim)}
                                                                disabled={isSaving}
                                                            >
                                                                Ausfall buchen
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {hiddenClaimsCount > 0 && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {hiddenClaimsCount} stornierte bzw. archivierte Forderung{hiddenClaimsCount === 1 ? '' : 'en'} ausgeblendet (siehe Forderungsmanagement).
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Tile 3: Verknüpfte Tickets */}
                    <Card
                        title="Verknüpfte Tickets"
                        action={canEditTickets && tenantUserId ? (
                            <Button variant="ghost" size="sm" onClick={openTicketModal} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Plus size={14} /> Neues Ticket
                            </Button>
                        ) : null}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {ticketsError ? (
                                <div style={tileErrorStyle}>
                                    <AlertCircle size={14} /> Tickets konnten nicht geladen werden: {ticketsError}
                                </div>
                            ) : !tenantUserId ? (
                                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    <MessageSquare size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                    Dieser Mieter hat keinen Zugang zum Mieterportal – Tickets sind daher nicht verfügbar.
                                </div>
                            ) : tickets.length === 0 ? (
                                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    <MessageSquare size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                    Keine Tickets dieses Mieters vorhanden.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {tickets.map(ticket => {
                                        const st = TICKET_STATUS[ticket.status] || { label: ticket.status, variant: 'default' };
                                        return (
                                            <div
                                                key={ticket.id}
                                                onClick={() => navigate('/ticket-board', { state: { openTicketId: ticket.id } })}
                                                title="Ticket im Ticket-Board öffnen"
                                                style={{
                                                    padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                                                    transition: 'all 0.2s', backgroundColor: 'rgba(255,255,255,0.01)'
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = 'var(--primary-color)'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                                            >
                                                <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
                                                    <div style={{ fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</div>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '8px' }}>
                                                        <span>{formatDateDE(ticket.created_at)}</span>
                                                        <span>•</span>
                                                        <span>Priorität: {TICKET_PRIORITY[ticket.priority] || ticket.priority || 'Normal'}</span>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <Badge variant={st.variant}>{st.label}</Badge>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Tile 4: Interne Notizen */}
                    <Card title="Interne Notizen">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                {notesMode === 'local'
                                    ? 'Die Notizen werden nur lokal in diesem Browser gespeichert – nicht auf anderen Geräten und nicht für Mitnutzer sichtbar. Beim Löschen der Browserdaten gehen sie verloren. Mieter haben keinen Zugriff darauf.'
                                    : 'Nur intern: sichtbar für Sie und Nutzer mit Zugriff auf die Mietverhältnisse dieses Portfolios, nicht für Mieter. Änderungen werden automatisch gespeichert.'}
                            </div>
                            <textarea
                                value={notes}
                                onChange={(e) => handleSaveNotes(e.target.value)}
                                onBlur={flushPendingNotes}
                                maxLength={20000}
                                readOnly={notesMode === 'loading' || notesMode === 'unavailable' || (notesMode === 'db' && !canEditLease)}
                                placeholder={notesMode === 'loading' ? 'Notizen werden geladen…' : 'Geben Sie hier wichtige Details, Absprachen oder Besonderheiten zum Mieter ein...'}
                                style={{
                                    width: '100%', height: '110px', padding: '12px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'rgba(0,0,0,0.01)',
                                    fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.4
                                }}
                            />
                            {notesError ? (
                                <div style={tileErrorStyle}>
                                    <AlertCircle size={14} /> {notesError}
                                </div>
                            ) : notesMode === 'db' && !canEditLease ? (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    Nur lesend – Sie haben kein Schreibrecht für Mietverhältnisse in diesem Portfolio.
                                </div>
                            ) : notesMode === 'db' && notesStatus ? (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {notesStatus === 'saved' ? 'Gespeichert.' : 'Wird gespeichert…'}
                                </div>
                            ) : null}
                        </div>
                    </Card>
                </div>

                {/* RIGHT SIDE TILES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Tile 5: Mietvertrag */}
                    <Card
                        title="Mietvertrag"
                        action={canEditLease ? (
                            <Button variant="ghost" size="sm" onClick={openEditLease} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Edit size={14} /> Bearbeiten
                            </Button>
                        ) : null}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mietbeginn</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                        <Calendar size={14} color="var(--primary-color)" /> {formatDateDE(lease.start_date)}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mietende</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                        <Calendar size={14} color="var(--primary-color)" /> {lease.end_date ? formatDateDE(lease.end_date) : 'Unbefristet'}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Vertragsart</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, marginTop: '2px' }}>
                                        {LEASE_TYPE_LABELS[lease.lease_type] || 'Normalmietvertrag'}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Kaution</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, marginTop: '2px' }}>{lease.deposit === null || lease.deposit === undefined ? '—' : formatEUR(lease.deposit)}</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Letzte Mieterhöhung</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500, marginTop: '2px' }}>{formatDateDE(lease.last_rent_increase, 'Bisher keine')}</div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={FileText}
                                        disabled={isStaffelOrIndex}
                                        title={isStaffelOrIndex ? 'Bei Staffel- oder Indexmiete ist eine Mieterhöhung nach § 558 BGB ausgeschlossen.' : undefined}
                                        onClick={() => navigate('/settings', {
                                            state: {
                                                activeTab: 'document-templates',
                                                templateId: 'rent_increase',
                                                tenant: buildTemplateTenantData({
                                                    lease: { ...lease, ...currentRent, id: lease.id, deposit: lease.deposit },
                                                    tenant: lease.tenant,
                                                    unit: lease.unit,
                                                    property: lease.unit?.property
                                                })
                                            }
                                        })}
                                    >
                                        Mieterhöhungsschreiben erstellen
                                    </Button>
                                </div>
                                {isStaffelOrIndex ? (
                                    <div style={infoBoxStyle}>
                                        Bei einer {lease.lease_type === 'staffel' ? 'Staffelmiete' : 'Indexmiete'} ist eine Erhöhung auf die ortsübliche
                                        Vergleichsmiete (§ 558 BGB) ausgeschlossen; Anpassungen richten sich nach der vereinbarten
                                        {lease.lease_type === 'staffel' ? ' Staffel (§ 557a BGB)' : ' Indexklausel (§ 557b BGB)'}.
                                    </div>
                                ) : earliestIncreaseRequest && (
                                    <div style={increaseLocked ? warnBoxStyle : infoBoxStyle}>
                                        Mieterhöhungsverlangen nach § 558 BGB frühestens ab <strong>{formatDateDE(earliestIncreaseRequest)}</strong> möglich
                                        (12 Monate nach {lease.last_rent_increase ? 'der letzten Erhöhung' : 'Mietbeginn'}); wirksam frühestens ab{' '}
                                        <strong>{formatDateDE(earliestIncreaseEffective)}</strong> (§ 558b BGB). Kappungsgrenze und ortsübliche Vergleichsmiete beachten.
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Tile 6: Finanzen / Mietkosten */}
                    <Card
                        title="Mietkosten & Fälligkeit"
                        action={canEditLease ? (
                            <Button variant="ghost" size="sm" onClick={openRentChange} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <TrendingUp size={14} /> Mietänderung
                            </Button>
                        ) : null}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {currentPeriod ? `Heute gültige Miete (seit ${currentPeriod.id === firstPeriodId ? 'Vertragsbeginn' : formatMonthDE(currentPeriod.valid_from)})` : 'Aktuelle Miete laut Vertrag'}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Kaltmiete:</span>
                                <span style={{ fontWeight: 500 }}>{formatEUR(currentRent?.cold_rent)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Nebenkostenvorauszahlung:</span>
                                <span style={{ fontWeight: 500 }}>{formatEUR(currentRent?.service_charge)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Heizkostenvorauszahlung:</span>
                                <span style={{ fontWeight: 500 }}>{formatEUR(currentRent?.heating_cost)}</span>
                            </div>
                            {toAmount(currentRent?.other_costs) > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Sonstige Kosten:</span>
                                    <span style={{ fontWeight: 500 }}>{formatEUR(currentRent?.other_costs)}</span>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', fontSize: '1.05rem', fontWeight: 700 }}>
                                <span>Warmmiete Gesamt:</span>
                                <span style={{ color: 'var(--primary-color)' }}>{formatEUR(totalWarmRent)}</span>
                            </div>

                            <div style={{ borderTop: '1px dotted var(--border-color)', marginTop: '8px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                <span>Mietzahlung fällig am:</span>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentRent?.payment_due_day || 3}. des Monats (Kalendertag)</span>
                            </div>

                            {rentPeriods.supported === true && rentPeriods.periods.length > 0 && (
                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Miethistorie</div>
                                    {[...rentPeriods.periods].reverse().map(p => {
                                        const isFirst = p.id === firstPeriodId;
                                        const isPlanned = monthStart(p.valid_from) > monthStart(today);
                                        const isCurrent = currentPeriod && p.id === currentPeriod.id;
                                        return (
                                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontWeight: 600, fontSize: '0.82rem' }}>
                                                        {isFirst ? `ab Vertragsbeginn (${formatDateDE(lease.start_date)})` : `ab ${formatMonthDE(p.valid_from)}`}
                                                        {isCurrent && <Badge variant="success">aktuell</Badge>}
                                                        {isPlanned && <Badge variant="blue">geplant</Badge>}
                                                    </div>
                                                    <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                        Kalt {formatEUR(p.cold_rent)} · NK {formatEUR(p.service_charge)} · Heizung {formatEUR(p.heating_cost)}
                                                        {toAmount(p.other_costs) > 0 ? ` · Sonstiges ${formatEUR(p.other_costs)}` : ''} · Warm {formatEUR(sumRent(p))} · fällig am {p.payment_due_day}.
                                                    </div>
                                                </div>
                                                {!isFirst && canEditLease && (
                                                    <button
                                                        onClick={() => handleDeleteRentPeriod(p)}
                                                        disabled={isSaving}
                                                        style={{ background: 'none', border: 'none', padding: '4px', color: 'var(--danger-color)', cursor: 'pointer' }}
                                                        title="Mietänderung löschen"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {rentPeriods.supported === false && (
                                <div style={warnBoxStyle}>
                                    Die Miethistorie („gültig ab") ist in der Datenbank noch nicht eingerichtet. Änderungen von Miete,
                                    Nebenkosten oder Zahltag wirken derzeit rückwirkend auf alle Monate seit Vertragsbeginn.
                                </div>
                            )}
                            {rentPeriods.supported === null && rentPeriods.error && (
                                <div style={tileErrorStyle}>
                                    <AlertCircle size={14} /> Miethistorie konnte nicht geladen werden: {rentPeriods.error.message}
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Tile 7: Dokumente & Cloud-Explorer */}
                    <Card
                        title="Dokumente & Verträge"
                        action={canEditDocuments ? (
                            <div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                    onChange={(e) => {
                                        if (lease.unit?.property?.cloud_connection) {
                                            handleCloudUpload(e.target.files);
                                        } else {
                                            handleUploadDocument(e.target.files);
                                        }
                                    }}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading || loadingCloud || (!!lease.unit?.property?.cloud_connection && (cloudFolderMissing || !tenantCloudPath))}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Hochladen
                                </Button>
                            </div>
                        ) : null}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {lease.unit?.property?.cloud_connection ? (
                                <>
                                    {/* Cloud folder path badge */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <Cloud size={14} style={{ color: 'var(--primary-color)' }} />
                                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tenantCloudPath}>
                                            Cloud: {tenantCloudPath || '—'}
                                        </span>
                                    </div>

                                    {loadingCloud ? (
                                        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                                            {cloudLoadingMessage}
                                        </div>
                                    ) : cloudError ? (
                                        <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', fontSize: '0.8rem', color: 'var(--danger-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                                <AlertCircle size={16} /> Fehler beim Laden der Cloud-Dateien
                                            </div>
                                            <div>{cloudError}</div>
                                            {tenantCloudPath && (
                                                <Button size="xs" variant="secondary" onClick={reloadCloudFiles} style={{ alignSelf: 'flex-start' }}>Erneut versuchen</Button>
                                            )}
                                        </div>
                                    ) : cloudFolderMissing ? (
                                        <div style={{ ...warnBoxStyle, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div>Der Cloud-Ordner für dieses Mietverhältnis existiert noch nicht.</div>
                                            {canEditDocuments && (
                                                <Button size="xs" variant="secondary" onClick={handleCreateCloudFolder} style={{ alignSelf: 'flex-start' }}>Cloud-Ordner anlegen</Button>
                                            )}
                                        </div>
                                    ) : cloudFiles.length === 0 ? (
                                        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            <FileText size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                            Keine Dokumente im Cloud-Ordner gefunden.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {cloudFiles.map(file => (
                                                <div
                                                    key={file.id}
                                                    style={{
                                                        padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        backgroundColor: 'rgba(255,255,255,0.01)'
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                                                            {file.name}
                                                        </div>
                                                        {file.size && (
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                                {(file.size / 1024 / 1024).toFixed(2)} MB
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        {file.url && (
                                                            <button
                                                                onClick={() => window.open(file.url, '_blank')}
                                                                style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--primary-color)', cursor: 'pointer' }}
                                                                title="Anzeigen / Herunterladen"
                                                            >
                                                                <Download size={15} />
                                                            </button>
                                                        )}
                                                        {canEditDocuments && (
                                                            <button
                                                                onClick={() => handleCloudDelete(file)}
                                                                style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--danger-color)', cursor: 'pointer' }}
                                                                title="Löschen"
                                                            >
                                                                <Trash2 size={15} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {(documents.length > 0 || documentsError) && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                In der App-Ablage (z. B. ältere oder von Mitnutzern hochgeladene Dokumente – für den Mieter im Mieterportal unter „Persönlich“ sichtbar)
                                            </div>
                                            {renderAppDocuments('')}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    {cloudError ? (
                                        <div style={tileErrorStyle}>
                                            <AlertCircle size={14} /> {cloudError}
                                        </div>
                                    ) : cloudCoUserNotice ? (
                                        // Mitnutzer: die Cloud-Verbindung des Eigentümers ist nur für diesen nutzbar
                                        <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.15)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '4px' }}>
                                            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                                            <span>Die Cloud-Ablage des Eigentümers steht Mitnutzern nicht zur Verfügung. Dokumente werden daher in der App-Ablage gespeichert. Eine eigene Cloud können Sie diesem Portfolio unter Einstellungen &gt; Cloud-Verbindungen zuweisen.</span>
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.15)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                            <AlertCircle size={14} /> Keine Cloud-Verbindung eingerichtet. Dateien werden lokal gespeichert.
                                        </div>
                                    )}
                                    {canEditDocuments && (
                                        <div style={{ ...infoBoxStyle, display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                            <Eye size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                                            <span>Hochgeladene Dateien sind für den Mieter im Mieterportal unter „Persönlich“ sichtbar (sofern er einen Portalzugang hat). Interne Unterlagen bitte nicht hier ablegen.</span>
                                        </div>
                                    )}
                                    {renderAppDocuments('Keine Dokumente für diesen Mieter hinterlegt.')}
                                </>
                            )}
                        </div>
                    </Card>

                    {/* Tile 8: Schnellaktionen & Gefahrenzone */}
                    <Card title="Gefahrenzone & Aktionen">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <Button
                                variant="outline"
                                fullWidth
                                onClick={() => {
                                    const params = new URLSearchParams();
                                    const propertyId = lease.unit?.property?.id || lease.unit?.property_id;
                                    if (propertyId) params.set('propertyId', propertyId);
                                    if (lease.unit_id) params.set('unitId', lease.unit_id);
                                    navigate(`/properties?${params.toString()}`);
                                }}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            >
                                <Home size={16} /> Einheit in Immobilien anzeigen
                            </Button>

                            {canEditLease && (
                                <>
                                    {timeState !== 'ended' && (
                                        <Button
                                            variant="warning"
                                            fullWidth
                                            onClick={openTerminate}
                                            disabled={isSaving}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                        >
                                            <Lock size={16} /> {lease.end_date ? 'Vertragsende ändern' : 'Mietverhältnis beenden'}
                                        </Button>
                                    )}
                                    {(timeState === 'ended' || lease.end_date) && (
                                        <Button
                                            variant="success"
                                            fullWidth
                                            onClick={handleReactivateLease}
                                            disabled={isSaving}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                        >
                                            <RefreshCw size={16} /> {timeState === 'ended' ? 'Mietverhältnis reaktivieren' : 'Kündigung aufheben'}
                                        </Button>
                                    )}

                                    <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '14px' }}>
                                        <Button
                                            variant="danger"
                                            fullWidth
                                            onClick={handleDeleteLease}
                                            disabled={isSaving}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                        >
                                            <Trash2 size={16} /> Mietverhältnis löschen
                                        </Button>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                                            Nur möglich, solange keine Zahlungen und Forderungen erfasst sind. Sonst bitte das Mietverhältnis beenden.
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>

                </div>
            </div>

            {/* EDIT TENANT MODAL */}
            <Modal isOpen={isEditTenantOpen} title="Mieter-Stammdaten bearbeiten" onClose={closeEditTenant}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label htmlFor="edit-tenant-salutation" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Anrede</label>
                        <select
                            id="edit-tenant-salutation"
                            value={tenantForm.salutation}
                            onChange={(e) => setTenantForm({ ...tenantForm, salutation: e.target.value })}
                            style={selectStyle}
                        >
                            {TENANT_SALUTATION_OPTIONS.map(opt => (
                                <option key={opt.value || 'none'} value={opt.value}>{opt.label}</option>
                            ))}
                            {/* Gespeicherter Wert ohne eigene Auswahl (z. B. 'diverse') bleibt erhalten */}
                            {tenantForm.salutation && !TENANT_SALUTATION_OPTIONS.some(opt => opt.value === tenantForm.salutation) && (
                                <option value={tenantForm.salutation}>Divers</option>
                            )}
                        </select>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Für die Briefanrede in Schreibvorlagen („Sehr geehrte Frau …“ / „Sehr geehrter Herr …“).
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <Input
                            label="Vorname"
                            value={tenantForm.first_name}
                            onChange={(e) => setTenantForm({ ...tenantForm, first_name: e.target.value })}
                        />
                        <Input
                            label="Nachname"
                            value={tenantForm.last_name}
                            onChange={(e) => setTenantForm({ ...tenantForm, last_name: e.target.value })}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <Input
                            label="Telefon"
                            value={tenantForm.phone}
                            onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })}
                        />
                        <Input
                            label="E-Mail"
                            type="email"
                            value={tenantForm.email}
                            onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
                        />
                    </div>
                    <Input
                        label="Anzahl der Personen"
                        type="number"
                        min="1"
                        value={tenantForm.occupants}
                        onChange={(e) => setTenantForm({ ...tenantForm, occupants: e.target.value })}
                    />

                    <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '16px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>Kontakt- & Rechnungsadresse (falls abweichend)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', marginBottom: '12px' }}>
                            <Input
                                label="Straße"
                                value={tenantForm.street}
                                onChange={(e) => setTenantForm({ ...tenantForm, street: e.target.value })}
                            />
                            <Input
                                label="Hausnummer"
                                value={tenantForm.house_number}
                                onChange={(e) => setTenantForm({ ...tenantForm, house_number: e.target.value })}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                            <Input
                                label="PLZ"
                                value={tenantForm.postal_code}
                                onChange={(e) => setTenantForm({ ...tenantForm, postal_code: e.target.value })}
                            />
                            <Input
                                label="Stadt"
                                value={tenantForm.city}
                                onChange={(e) => setTenantForm({ ...tenantForm, city: e.target.value })}
                            />
                        </div>
                    </div>

                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={closeEditTenant} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleSaveTenant} disabled={isSaving}>
                            {isSaving ? 'Speichert...' : 'Speichern'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* EDIT LEASE MODAL (Vertragsdaten) */}
            <Modal isOpen={isEditLeaseOpen} title="Mietvertrag bearbeiten" onClose={closeEditLease}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <Input
                            label="Mietbeginn"
                            type="date"
                            value={leaseForm.start_date}
                            onChange={(e) => setLeaseForm({ ...leaseForm, start_date: e.target.value })}
                        />
                        <Input
                            label="Mietende (optional)"
                            type="date"
                            value={leaseForm.end_date}
                            onChange={(e) => setLeaseForm({ ...leaseForm, end_date: e.target.value })}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Vertragsart</label>
                            <select
                                value={leaseForm.lease_type}
                                onChange={(e) => setLeaseForm({ ...leaseForm, lease_type: e.target.value })}
                                style={selectStyle}
                            >
                                <option value="normal">Normalmietvertrag</option>
                                <option value="staffel">Staffelmietvertrag</option>
                                <option value="index">Indexmietvertrag</option>
                            </select>
                        </div>
                        <CurrencyInput
                            label="Kaution (€)"
                            allowDecimals
                            allowEmpty
                            value={leaseForm.deposit}
                            onChange={(e) => setLeaseForm({ ...leaseForm, deposit: e.target.value })}
                        />
                    </div>

                    <Input
                        label="Letzte Mieterhöhung (wirksam ab)"
                        type="date"
                        value={leaseForm.last_rent_increase}
                        onChange={(e) => setLeaseForm({ ...leaseForm, last_rent_increase: e.target.value })}
                    />

                    <div>
                        <Input
                            label="Mietkonto geführt ab (optional)"
                            type="date"
                            value={leaseForm.booking_start_date}
                            onChange={(e) => setLeaseForm({ ...leaseForm, booking_start_date: e.target.value })}
                        />
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            Monate davor zählen nicht als Mietrückstand (maßgeblich ist der Monat des Datums).
                            Leer lassen = automatisch: ab Mietbeginn, bei nachträglich erfassten Altverträgen ab dem Monat der Erfassung.
                        </div>
                    </div>

                    <div style={infoBoxStyle}>
                        Miete, Nebenkosten und Zahltag ändern Sie über <strong>„Mietänderung"</strong> in der Kachel „Mietkosten & Fälligkeit" –
                        dort mit Datum, ab dem die neuen Werte gelten.
                    </div>

                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={closeEditLease} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleSaveLease} disabled={isSaving}>
                            {isSaving ? 'Speichert...' : 'Speichern'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* RENT CHANGE MODAL (Mietänderung ab Datum) */}
            <Modal isOpen={isRentChangeOpen} title="Mietänderung" onClose={closeRentChange}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                    {rentPeriods.supported === true ? (
                        <>
                            <div style={infoBoxStyle}>
                                Die neuen Werte gelten ab dem gewählten Monat. Frühere Monate im Mietkonto bleiben unverändert.
                                Das Mietkonto wird monatsweise geführt – maßgeblich ist der Monat des Datums.
                            </div>
                            <Input
                                label="Gültig ab"
                                type="date"
                                value={rentForm.valid_from}
                                onChange={(e) => setRentForm({ ...rentForm, valid_from: e.target.value })}
                            />
                            {rentFormTarget && (
                                <div style={rentFormIsCorrection ? warnBoxStyle : { fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    {rentFormIsCorrection
                                        ? `Korrektur der Anfangsmiete: gilt ab Vertragsbeginn (${formatDateDE(lease.start_date)}) – alle Monate werden neu berechnet.`
                                        : `Wirksam ab ${formatMonthDE(rentFormTarget)}${rentFormTarget < monthStart(today) ? ' (rückwirkend)' : ''}.`}
                                </div>
                            )}
                        </>
                    ) : rentPeriods.supported === false ? (
                        <div style={dangerBoxStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '4px', color: 'var(--danger-color)' }}>
                                <AlertTriangle size={16} /> Achtung: Änderungen wirken rückwirkend
                            </div>
                            Die Miethistorie („gültig ab") ist in der Datenbank noch nicht eingerichtet. Eine Änderung von Miete,
                            Nebenkosten oder Zahltag wirkt rückwirkend auf alle Monate seit Vertragsbeginn
                            ({formatDateDE(lease.start_date)}). Vor dem Speichern müssen Sie dies ausdrücklich bestätigen.
                        </div>
                    ) : (
                        <div style={tileErrorStyle}>
                            <AlertCircle size={14} /> Die Miethistorie konnte nicht geladen werden. Speichern ist erst nach erneutem Laden möglich.
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <CurrencyInput
                            label="Kaltmiete (€)"
                            allowDecimals
                            value={rentForm.cold_rent}
                            onChange={(e) => setRentForm({ ...rentForm, cold_rent: e.target.value })}
                        />
                        <CurrencyInput
                            label="Nebenkostenvorauszahlung (€)"
                            allowDecimals
                            value={rentForm.service_charge}
                            onChange={(e) => setRentForm({ ...rentForm, service_charge: e.target.value })}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <CurrencyInput
                            label="Heizkostenvorauszahlung (€)"
                            allowDecimals
                            value={rentForm.heating_cost}
                            onChange={(e) => setRentForm({ ...rentForm, heating_cost: e.target.value })}
                        />
                        <CurrencyInput
                            label="Sonstige Nebenkosten (€)"
                            allowDecimals
                            value={rentForm.other_costs}
                            onChange={(e) => setRentForm({ ...rentForm, other_costs: e.target.value })}
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'end' }}>
                        <Input
                            label="Zahltag (Kalendertag 1–28)"
                            type="number"
                            min="1"
                            max="28"
                            value={rentForm.payment_due_day}
                            onChange={(e) => setRentForm({ ...rentForm, payment_due_day: e.target.value })}
                        />
                        <div style={{ marginBottom: 'var(--spacing-md)', fontSize: '0.9rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Neue Warmmiete</div>
                            <div style={{ fontWeight: 700 }}>{formatEUR(sumRent(rentForm))}</div>
                        </div>
                    </div>

                    {rentPeriods.supported === true && rentFormIsIncrease && !rentFormIsCorrection && rentFormTarget && (
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.82rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={!!rentForm.mark_increase}
                                onChange={(e) => setRentForm({ ...rentForm, mark_increase: e.target.checked })}
                                style={{ marginTop: '2px' }}
                            />
                            Als Mieterhöhung vermerken („Letzte Mieterhöhung" = {formatDateDE(rentFormTarget)})
                        </label>
                    )}

                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={closeRentChange} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleSaveRentChange} disabled={isSaving || rentPeriods.supported === null}>
                            {isSaving ? 'Speichert...' : 'Speichern'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* TERMINATE MODAL */}
            <Modal isOpen={isTerminateOpen} title={lease.end_date ? 'Vertragsende ändern' : 'Mietverhältnis beenden'} onClose={() => setIsTerminateOpen(false)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                    <Input
                        label="Vertragsende (letzter Miettag)"
                        type="date"
                        min={lease.start_date || undefined}
                        value={terminateForm.end_date}
                        onChange={(e) => setTerminateForm({ end_date: e.target.value })}
                    />
                    <div style={infoBoxStyle}>
                        Bis einschließlich zu diesem Datum bleibt das Mietverhältnis aktiv (z. B. während der Kündigungsfrist);
                        danach gilt es als beendet. Sollmieten werden bis einschließlich des Monats des Vertragsendes geführt.
                    </div>
                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={() => setIsTerminateOpen(false)} disabled={isSaving}>Abbrechen</Button>
                        <Button variant="danger" onClick={handleTerminateLease} disabled={isSaving}>
                            {isSaving ? 'Speichert...' : 'Vertragsende speichern'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* CLAIM PAYMENT MODAL */}
            <Modal isOpen={!!paymentClaim} title="Zahlung auf Forderung erfassen" onClose={() => setPaymentClaim(null)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                    <div style={infoBoxStyle}>
                        Die Zahlung wird über das Forderungsmodul gebucht (Verrechnung auf Gebühren, Zinsen und Hauptforderung,
                        Eintrag im Verlauf). Offen: <strong>{paymentClaim?.total_due === null || paymentClaim?.total_due === undefined ? '—' : formatEUR(paymentClaim.total_due)}</strong>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <CurrencyInput
                            label="Betrag (€)"
                            allowDecimals
                            value={paymentForm.amount}
                            onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                        />
                        <Input
                            label="Zahlungsdatum"
                            type="date"
                            value={paymentForm.date}
                            onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                        />
                    </div>
                    <Input
                        label="Notiz (optional)"
                        value={paymentForm.note}
                        onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                    />
                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={() => setPaymentClaim(null)} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleRecordClaimPayment} disabled={isSaving}>
                            {isSaving ? 'Bucht...' : 'Zahlung buchen'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* CLAIM WRITE-OFF MODAL */}
            <Modal isOpen={!!writeOffClaim} title="Forderungsausfall buchen" onClose={() => setWriteOffClaim(null)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                    <div style={warnBoxStyle}>
                        Die Forderung wird mit dem Status <strong>„Storniert"</strong> und dem Grund „Forderungsausfall" abgeschlossen und im
                        Verlauf protokolliert. Es wird keine Zahlung gebucht; die betroffenen Mietmonate bleiben im Mietkonto offen.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Grund (Pflichtfeld)</label>
                        <textarea
                            value={writeOffForm.reason}
                            onChange={(e) => setWriteOffForm({ reason: e.target.value })}
                            placeholder="z. B. Mieter unbekannt verzogen, Insolvenz, Vollstreckung erfolglos"
                            style={{
                                width: '100%', height: '90px', padding: '10px 12px', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical'
                            }}
                        />
                    </div>
                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={() => setWriteOffClaim(null)} disabled={isSaving}>Abbrechen</Button>
                        <Button variant="danger" onClick={handleWriteOffClaim} disabled={isSaving || !writeOffForm.reason.trim()}>
                            {isSaving ? 'Speichert...' : 'Ausfall buchen'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* CREATE TICKET MODAL */}
            <Modal isOpen={isTicketModalOpen} title="Ticket erstellen" onClose={() => setIsTicketModalOpen(false)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                    <Input
                        label="Titel / Betreff"
                        placeholder="z.B. Heizung im Wohnzimmer defekt"
                        value={ticketForm.title}
                        onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })}
                    />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Beschreibung</label>
                        <textarea
                            placeholder="Genaue Beschreibung des Problems..."
                            value={ticketForm.description}
                            onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
                            style={{
                                width: '100%', height: '100px', padding: '10px 12px', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontFamily: 'inherit',
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Priorität</label>
                        <select
                            value={ticketForm.priority}
                            onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                            style={selectStyle}
                        >
                            <option value="low">Niedrig</option>
                            <option value="normal">Normal</option>
                            <option value="high">Hoch</option>
                            <option value="urgent">Dringend</option>
                        </select>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Das Ticket wird dem Mieter zugeordnet und ist für ihn im Mieterportal sichtbar.
                    </div>

                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={() => setIsTicketModalOpen(false)} disabled={isSaving}>Abbrechen</Button>
                        <Button onClick={handleCreateTicket} disabled={isSaving}>
                            {isSaving ? 'Erstellt...' : 'Ticket erstellen'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* RÜCKWIRKUNGS-WARNUNG (solange die Miethistorie in der DB fehlt) */}
            <Modal isOpen={!!retroWarning} title={retroWarning?.title || 'Achtung'} onClose={() => setRetroWarning(null)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
                    <div style={{ ...dangerBoxStyle, whiteSpace: 'pre-line' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '6px', color: 'var(--danger-color)' }}>
                            <AlertTriangle size={16} /> Diese Änderung wirkt rückwirkend auf alle Monate seit Vertragsbeginn
                        </div>
                        {retroWarning?.message}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={retroAccepted}
                            onChange={(e) => setRetroAccepted(e.target.checked)}
                            style={{ marginTop: '3px' }}
                        />
                        {RETRO_CONFIRM_LABEL}
                    </label>
                    <div style={modalFooterStyle}>
                        <Button variant="ghost" onClick={() => setRetroWarning(null)} disabled={isSaving}>Abbrechen</Button>
                        <Button
                            variant="danger"
                            disabled={!retroAccepted || isSaving}
                            onClick={async () => {
                                const confirmFn = retroWarning?.onConfirm;
                                setRetroWarning(null);
                                setRetroAccepted(false);
                                if (confirmFn) await confirmFn();
                            }}
                        >
                            Trotzdem rückwirkend speichern
                        </Button>
                    </div>
                </div>
            </Modal>

        </div>
    );
};

export default TenantDetail;
