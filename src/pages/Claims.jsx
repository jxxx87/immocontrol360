import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { usePermission } from '../context/PermissionContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { createPortal } from 'react-dom';
import { Scale, Plus, AlertCircle, Clock, Ban, ArrowRight, ArrowLeft, ChevronDown, ChevronRight, Edit, Trash2, Eye, MoreVertical, Settings as SettingsIcon, CreditCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ExportDropdown from '../components/ExportDropdown';
import {
    num, round2, toLocalDateString, parseLocalDate, formatDateDE, getDelayDays,
    shiftToBusinessDay, daysBetween, translateClaimError, cancelClaim
} from '../lib/claimPdfGenerator';

// Eine Tabelle für Status-Badge und Export
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

const CLOSED_STATUSES_FILTER = '("settled","cancelled","archived")';
const HIDDEN_STATUSES_FILTER = '("cancelled","archived")';
const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 100;
const MAX_INTEREST_RATE = 20; // Plausibilitätsgrenze in % p.a.
const MAX_DEADLINE_DAYS = 365;
const DEFAULT_FORM = { fee_amount: 5.00, interest_rate: 5.0000, deadline_days: 7, note: '' };
const DEFAULT_INSTALLMENT_OPTIONS = [
    { months: 3, surcharge_percent: 7.00 },
    { months: 6, surcharge_percent: 9.00 },
    { months: 12, surcharge_percent: 12.00 }
];

// Alle Zeilen seitenweise laden (PostgREST liefert höchstens 1000 Zeilen je Abfrage)
const fetchAllRows = async (buildQuery) => {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
};

// IN-Abfragen in Blöcken (lange ID-Listen sprengen sonst die URL-Länge)
const fetchInChunks = async (ids, buildQuery) => {
    const rows = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
        const { data, error } = await buildQuery(ids.slice(i, i + IN_CHUNK_SIZE));
        if (error) throw error;
        rows.push(...(data || []));
    }
    return rows;
};

const normalizeIban = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
const isValidIban = (iban) => {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const ch of rearranged) {
        const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
        for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder === 1;
};
const normalizeBic = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
const isValidBic = (bic) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);

// Fälligkeit einer Monatsmiete: rent_ledger.due_date, sonst Fälligkeitstag des Mietvertrags (begrenzt auf das Monatsende)
const getLedgerDueDate = (ledger) => {
    if (ledger.due_date) return parseLocalDate(ledger.due_date);
    const period = parseLocalDate(ledger.period_month);
    if (!period) return null;
    const dueDay = Number(ledger.leases?.payment_due_day) || 3;
    const lastDay = new Date(period.getFullYear(), period.getMonth() + 1, 0).getDate();
    return new Date(period.getFullYear(), period.getMonth(), Math.min(Math.max(1, dueDay), lastDay));
};

// Im Verzug erst ab dem Tag nach der (nach § 193 BGB ggf. verschobenen) Fälligkeit
const isLedgerOverdue = (ledger, today) => {
    const due = getLedgerDueDate(ledger);
    if (!due) return true;
    return daysBetween(shiftToBusinessDay(due), today) > 0;
};

const getLedgerOpenAmount = (ledger) => round2(num(ledger.expected_rent) - num(ledger.paid_amount));

// Verzugszinsen bis heute – EINE Funktion für Vorschau und Anlage
const calculateCreationInterest = (ledgerItems, manualRows, ratePercent, today) => {
    const rate = num(ratePercent) / 100;
    if (!(rate > 0)) return 0;
    let total = 0;
    ledgerItems.forEach(l => {
        const open = Math.max(0, getLedgerOpenAmount(l));
        const due = getLedgerDueDate(l);
        if (open > 0 && due) total += open * rate * getDelayDays(due, today) / 365;
    });
    manualRows.forEach(item => {
        const open = num(item.amount);
        if (item.dueDate && open > 0 && parseLocalDate(item.dueDate)) {
            total += open * rate * getDelayDays(item.dueDate, today) / 365;
        }
    });
    return round2(total);
};

// Manuelle Positionen prüfen: leere Zeilen ignorieren, Bezeichnung Pflicht, Betrag > 0 (2 Nachkommastellen)
const cleanManualItems = (rows) => {
    const errors = [];
    const cleaned = [];
    rows.forEach((row, idx) => {
        const description = String(row.description || '').trim();
        const rawAmount = row.amount;
        const amountEmpty = rawAmount === '' || rawAmount === null || rawAmount === undefined;
        if (!description && amountEmpty && !row.dueDate) return;
        const amount = round2(parseFloat(rawAmount));
        if (!description) errors.push(`Position ${idx + 1}: Bitte eine Bezeichnung angeben.`);
        if (amountEmpty || !(amount > 0)) errors.push(`Position ${idx + 1}: Bitte einen Betrag größer als 0 angeben.`);
        if (row.dueDate && !parseLocalDate(row.dueDate)) errors.push(`Position ${idx + 1}: Das Fälligkeitsdatum ist ungültig.`);
        cleaned.push({ description, amount, item_type: row.item_type || 'other', dueDate: row.dueDate || '' });
    });
    return { cleaned, errors };
};

const Claims = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { selectedPortfolioID, portfolios } = usePortfolio();
    const perm = usePermission();
    const [claims, setClaims] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [activeDropdownClaim, setActiveDropdownClaim] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0, openUp: false });
    const loadRequestRef = useRef(0);
    // Erledigte Akten (settled) standardmäßig ausblenden; Zugang zu ihnen über den Schalter
    const [showSettled, setShowSettled] = useState(false);

    // Schreibrecht „Finanzen“ wie die RLS (has_lease_access … 'finanzen','write'): im aktuellen Bereich
    // (Neuanlage) bzw. je Forderung über das Portfolio des Objekts. Während die Rechte laden, optimistisch;
    // die Datenbank prüft zusätzlich.
    const canWriteFinance = (portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return perm.canWrite('finanzen', portfolioId || undefined);
    };
    const canCreateClaims = canWriteFinance(selectedPortfolioID || null);
    const canWriteClaim = (claim) => canWriteFinance(claim?.leases?.units?.properties?.portfolio_id || null);

    // Portal-Einstellungen liegen im Profil des angemeldeten Kontos; das Portal liest sie aber beim
    // Eigentümer der Forderung. Für freigegebene Portfolios gelten sie daher nicht.
    const ownPortfolios = (portfolios || []).filter(p => user && p.user_id === user.id);
    const portalSettingsOwnerOnly = selectedPortfolioID
        ? !!perm?.isSharedPortfolio?.(selectedPortfolioID)
        : ownPortfolios.length === 0 && (perm?.sharedPortfolioIds || []).length > 0;
    const portalSettingsMixedScope = !selectedPortfolioID && ownPortfolios.length > 0 && (perm?.sharedPortfolioIds || []).length > 0;
    const ownPortfoliosWithIban = ownPortfolios.filter(p => String(p.iban || '').trim());

    // Create Modal States
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createStep, setCreateStep] = useState(1);
    const [openLedgers, setOpenLedgers] = useState([]);
    const [loadingLedgers, setLoadingLedgers] = useState(false);
    const [ledgerLoadError, setLedgerLoadError] = useState(null);
    const [notDueCount, setNotDueCount] = useState(0);

    const [selectedLedgerIds, setSelectedLedgerIds] = useState([]);
    const [selectedLeaseId, setSelectedLeaseId] = useState('');
    const [buildingFilter, setBuildingFilter] = useState('');
    const [manualItems, setManualItems] = useState([]);
    const [allLeases, setAllLeases] = useState([]);
    const [existingClaim, setExistingClaim] = useState(null);
    const [checkingExistingClaim, setCheckingExistingClaim] = useState(false);
    const autoAdjustedFormRef = useRef(false);

    const [expandedTenant, setExpandedTenant] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [form, setForm] = useState(DEFAULT_FORM);

    // Edit Modal States
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingClaim, setEditingClaim] = useState(null);
    const [editForm, setEditForm] = useState({
        deadline: '',
        interest_rate: 0,
        accumulated_unpaid_interest: 0,
        accumulated_unpaid_fees: 0,
        rate_retroactive: false
    });

    // Storno Modal
    const [cancelTarget, setCancelTarget] = useState(null);
    const [cancelReason, setCancelReason] = useState('');

    // Portal Settings States
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [portalSettings, setPortalSettings] = useState({
        claim_portal_allow_installments: true,
        claim_portal_installment_options: DEFAULT_INSTALLMENT_OPTIONS,
        bank_account_holder: '',
        iban: '',
        bic: ''
    });
    const [portalSettingsOriginal, setPortalSettingsOriginal] = useState(null);
    const [portalSettingsError, setPortalSettingsError] = useState(null);
    const [loadingSettings, setLoadingSettings] = useState(false);

    // Aufruf aus Mieterakte bzw. Buchhaltung: navigate('/forderungen', { state: { openCreate, defaultLeaseId, defaultMonth } })
    const pendingCreateRef = useRef(null);
    const handledLocationKeyRef = useRef(null);
    const [createHint, setCreateHint] = useState(null);

    const loadPortalSettings = async () => {
        setLoadingSettings(true);
        setPortalSettingsError(null);
        setPortalSettingsOriginal(null);
        try {
            if (!user?.id) throw new Error('Nicht angemeldet');
            const { data, error } = await supabase
                .from('profiles')
                .select('claim_portal_allow_installments, claim_portal_installment_options, bank_account_holder, iban, bic')
                .eq('id', user.id)
                .maybeSingle();
            if (error) throw error;
            if (!data) throw new Error('Profil nicht gefunden');
            const loaded = {
                claim_portal_allow_installments: data.claim_portal_allow_installments ?? true,
                claim_portal_installment_options: Array.isArray(data.claim_portal_installment_options)
                    ? data.claim_portal_installment_options.map(o => ({ ...o }))
                    : DEFAULT_INSTALLMENT_OPTIONS.map(o => ({ ...o })),
                bank_account_holder: data.bank_account_holder || '',
                iban: data.iban || '',
                bic: data.bic || ''
            };
            setPortalSettings(loaded);
            setPortalSettingsOriginal(loaded);
        } catch (err) {
            console.error(err);
            setPortalSettingsError('Die Einstellungen konnten nicht geladen werden. Speichern ist gesperrt, damit hinterlegte Bankdaten nicht überschrieben werden.');
        } finally {
            setLoadingSettings(false);
        }
    };

    const openPortalSettings = () => {
        setIsSettingsModalOpen(true);
        // Für freigegebene Portfolios nur Hinweis (Werte gelten nur beim Eigentümer der Forderung)
        if (!portalSettingsOwnerOnly) loadPortalSettings();
    };

    const handleSavePortalSettings = async () => {
        if (isSubmitting || loadingSettings || portalSettingsOwnerOnly) return;
        if (portalSettingsError || !portalSettingsOriginal) {
            alert('Die Einstellungen wurden nicht vollständig geladen und können daher nicht gespeichert werden.');
            return;
        }

        const errors = [];
        const iban = normalizeIban(portalSettings.iban);
        const bic = normalizeBic(portalSettings.bic);
        if (iban && !isValidIban(iban)) errors.push('Die IBAN ist ungültig (Prüfsumme oder Format).');
        if (bic && !isValidBic(bic)) errors.push('Die BIC ist ungültig (8 oder 11 Zeichen).');
        const options = portalSettings.claim_portal_installment_options || [];
        options.forEach((opt, idx) => {
            const months = Number(opt.months);
            const surcharge = Number(opt.surcharge_percent);
            if (!Number.isInteger(months) || months < 2 || months > 48) errors.push(`Raten-Vorschlag ${idx + 1}: Anzahl Raten muss eine ganze Zahl zwischen 2 und 48 sein.`);
            if (!Number.isFinite(surcharge) || surcharge < 0 || surcharge > 100) errors.push(`Raten-Vorschlag ${idx + 1}: Aufschlag muss zwischen 0 und 100 % liegen.`);
        });
        if (errors.length > 0) {
            alert('Bitte prüfen Sie Ihre Eingaben:\n\n' + errors.join('\n'));
            return;
        }

        // Nur geänderte Felder schreiben
        const original = portalSettingsOriginal;
        const payload = {};
        if (portalSettings.claim_portal_allow_installments !== original.claim_portal_allow_installments) {
            payload.claim_portal_allow_installments = portalSettings.claim_portal_allow_installments;
        }
        const normalizedOptions = options.map(o => ({ months: Number(o.months), surcharge_percent: round2(o.surcharge_percent) }));
        if (JSON.stringify(normalizedOptions) !== JSON.stringify(original.claim_portal_installment_options.map(o => ({ months: Number(o.months), surcharge_percent: round2(o.surcharge_percent) })))) {
            payload.claim_portal_installment_options = normalizedOptions;
        }
        const holder = String(portalSettings.bank_account_holder || '').trim();
        if (holder !== String(original.bank_account_holder || '').trim()) payload.bank_account_holder = holder;
        if (iban !== normalizeIban(original.iban)) payload.iban = iban;
        if (bic !== normalizeBic(original.bic)) payload.bic = bic;

        if (Object.keys(payload).length === 0) {
            setIsSettingsModalOpen(false);
            return;
        }
        if (payload.iban === '' && normalizeIban(original.iban) &&
            !window.confirm('Die IBAN wurde geleert. Für Forderungen aus Portfolios ohne eigene Bankverbindung erscheint dann auf Mahnschreiben und im Forderungsportal keine Kontoverbindung (eine im Portfolio hinterlegte IBAN hat Vorrang und bleibt gültig). Trotzdem speichern?')) {
            return;
        }

        setIsSubmitting(true);
        try {
            const { data: savedRows, error } = await supabase.from('profiles').update(payload).eq('id', user.id).select('id');
            if (error) throw error;
            if (!savedRows || savedRows.length === 0) throw new Error('Die Einstellungen konnten nicht gespeichert werden (Profil nicht gefunden).');
            setIsSettingsModalOpen(false);
            alert('Einstellungen gespeichert.');
        } catch (err) {
            alert('Fehler: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const addInstallmentOption = () => {
        setPortalSettings(prev => ({
            ...prev,
            claim_portal_installment_options: [...prev.claim_portal_installment_options, { months: 12, surcharge_percent: 0 }]
        }));
    };

    const removeInstallmentOption = (index) => {
        setPortalSettings(prev => ({
            ...prev,
            claim_portal_installment_options: prev.claim_portal_installment_options.filter((_, i) => i !== index)
        }));
    };

    const updateInstallmentOption = (index, field, value) => {
        setPortalSettings(prev => ({
            ...prev,
            claim_portal_installment_options: prev.claim_portal_installment_options.map((opt, i) => (
                i === index ? { ...opt, [field]: value === '' ? '' : Number(value) } : opt
            ))
        }));
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPortfolioID]);

    useEffect(() => {
        const handleClickOutside = () => setActiveDropdown(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    // „Neue Forderung“ aus Mieterakte/Buchhaltung: Dialog öffnen, Vertrag (und Monat) nach dem Laden vorwählen.
    // Der State wird danach gelöscht, damit ein Neuladen den Dialog nicht erneut öffnet.
    useEffect(() => {
        const state = location.state;
        if (!state?.openCreate || perm?.loadingPermissions) return;
        if (handledLocationKeyRef.current === location.key) return;
        handledLocationKeyRef.current = location.key;
        navigate(location.pathname, { replace: true, state: null });
        if (!canCreateClaims) {
            alert('Für dieses Portfolio haben Sie nur Leserechte (Freigabe). Forderungen können nur mit Schreibrecht „Finanzen“ angelegt werden.');
            return;
        }
        pendingCreateRef.current = { leaseId: state.defaultLeaseId || null, month: state.defaultMonth || null };
        openCreateModal();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key, location.state, perm?.loadingPermissions]);

    useEffect(() => {
        const pending = pendingCreateRef.current;
        if (!pending || !isCreateModalOpen || loadingLedgers) return;
        pendingCreateRef.current = null;
        if (!pending.leaseId) return;
        const leaseLedgers = openLedgers.filter(l => l.leases?.id === pending.leaseId);
        if (leaseLedgers.length > 0) {
            const monthKey = pending.month ? String(pending.month).substring(0, 7) : '';
            const inMonth = monthKey ? leaseLedgers.filter(l => String(l.period_month || '').startsWith(monthKey)) : [];
            setSelectedLeaseId('');
            setSelectedLedgerIds((inMonth.length > 0 ? inMonth : leaseLedgers).map(l => l.id));
            setExpandedTenant(pending.leaseId);
        } else if (allLeases.some(l => l.id === pending.leaseId)) {
            // Keine offenen, fälligen Mieten: freie Forderung für diesen Vertrag vorwählen
            setSelectedLedgerIds([]);
            setSelectedLeaseId(pending.leaseId);
        } else {
            setCreateHint('Der Mietvertrag aus der vorherigen Seite ist in der aktuellen Auswahl nicht enthalten (anderes Portfolio gewählt oder Vertrag nicht aktiv). Bitte Mieter bzw. Mietvertrag hier auswählen.');
        }
    }, [isCreateModalOpen, loadingLedgers, openLedgers, allLeases]);

    // Erledigte Akten nur auf Wunsch; Kennzahlen immer aus der angezeigten Liste
    const settledCount = claims.filter(c => c.status === 'settled').length;
    const visibleClaims = useMemo(
        () => (showSettled ? claims : claims.filter(c => c.status !== 'settled')),
        [claims, showSettled]
    );
    const kpis = useMemo(() => {
        let totalUrsprung = 0;
        let totalGetilgt = 0;
        let totalOffen = 0;
        visibleClaims.forEach(claim => {
            totalUrsprung += num(claim.totalUrsprung);
            totalGetilgt += num(claim.totalGetilgt);
            totalOffen += num(claim.totalOffen);
        });
        return { totalUrsprung: round2(totalUrsprung), totalGetilgt: round2(totalGetilgt), totalOffen: round2(totalOffen) };
    }, [visibleClaims]);

    // Summen ausschließlich aus claim_totals_view (gleiche Quelle wie Forderungsakte und Mieterportal)
    const fetchAndMergeClaims = async (requestId) => {
        const claimsData = await fetchAllRows(() => {
            let claimsQuery = supabase
                .from('claims')
                .select(`
                    id, user_id, status, escalation_level, deadline, next_action_at, created_at, updated_at,
                    interest_rate, interest_start_date, accumulated_unpaid_interest, accumulated_unpaid_fees,
                    tenants ( first_name, last_name ),
                    leases!inner (
                        id,
                        units!inner (
                            unit_name,
                            properties!inner ( id, portfolio_id, street, house_number, zip, city )
                        )
                    )
                `)
                .not('status', 'in', HIDDEN_STATUSES_FILTER)
                .order('created_at', { ascending: false })
                .order('id', { ascending: true });

            if (selectedPortfolioID) {
                claimsQuery = claimsQuery.eq('leases.units.properties.portfolio_id', selectedPortfolioID);
            }
            return claimsQuery;
        });
        if (requestId !== loadRequestRef.current) return;

        const claimIds = claimsData.map(c => c.id);
        const totalsRows = claimIds.length > 0
            ? await fetchInChunks(claimIds, (chunk) => supabase
                .from('claim_totals_view')
                // '*' statt fester Spalten: principal_waived gibt es erst nach der Datenbank-Aktualisierung
                .select('*')
                .in('claim_id', chunk))
            : [];
        if (requestId !== loadRequestRef.current) return;

        const totalsById = new Map(totalsRows.map(t => [t.claim_id, t]));
        const merged = claimsData.map(claim => {
            const t = totalsById.get(claim.id) || null;
            const totalOffen = round2(t?.total_due);
            // principal_paid enthält auch Erlasse/Ausbuchungen (kein Geldeingang); „Getilgt" zeigt nur Geldeingänge
            const totalErlassen = round2(t?.principal_waived);
            const totalGetilgt = round2(num(t?.principal_paid) - totalErlassen + num(t?.fees_paid) + num(t?.interest_paid));
            return {
                ...claim,
                hasTotals: !!t,
                totalOffen,
                totalGetilgt,
                totalErlassen,
                totalUrsprung: round2(totalOffen + totalGetilgt + totalErlassen),
                feesOpen: round2(t?.total_fees_open),
                interestOpen: round2(t?.total_interest_open)
            };
        });

        setClaims(merged);
    };

    const loadData = async () => {
        const requestId = ++loadRequestRef.current;
        setLoading(true);
        setError(null);
        try {
            // 1. Overdue-Status im Hintergrund aktualisieren (non-blocking); veraltete Antworten werden verworfen
            supabase.rpc('update_overdue_claims_status').then(({ data, error }) => {
                if (requestId !== loadRequestRef.current) return;
                if (error) {
                    console.warn('Could not update overdue claims status:', error);
                } else if (data && data > 0) {
                    fetchAndMergeClaims(requestId).catch(err => {
                        console.error('Silent reload failed:', err);
                        if (requestId === loadRequestRef.current) setError(translateClaimError(err, 'Fehler beim Aktualisieren der Forderungen'));
                    });
                }
            }).catch(err => console.warn('Could not update overdue claims status:', err));

            // 2. Daten sofort laden
            await fetchAndMergeClaims(requestId);
        } catch (err) {
            console.error('Error loading claims:', err);
            if (requestId === loadRequestRef.current) setError(translateClaimError(err, 'Fehler beim Laden der Forderungen'));
        } finally {
            if (requestId === loadRequestRef.current) setLoading(false);
        }
    };

    const loadOpenLedgers = async () => {
        setLoadingLedgers(true);
        setLedgerLoadError(null);
        setNotDueCount(0);
        try {
            const { error: syncError } = await supabase.rpc('sync_all_rent_ledgers');
            if (syncError) console.warn('Sync ledger warning:', syncError);

            const ledgerData = await fetchAllRows(() => {
                let ledgerQuery = supabase
                    .from('rent_ledger')
                    .select(`
                        id, period_month, expected_rent, paid_amount, due_date,
                        leases!inner (
                            id, user_id, payment_due_day,
                            units!inner (
                                unit_name,
                                properties!inner ( id, portfolio_id, street, house_number, zip, city )
                            ),
                            tenants ( first_name, last_name )
                        )
                    `)
                    .eq('status', 'open')
                    .order('period_month', { ascending: false })
                    .order('id', { ascending: true });

                if (selectedPortfolioID) {
                    ledgerQuery = ledgerQuery.eq('leases.units.properties.portfolio_id', selectedPortfolioID);
                }
                return ledgerQuery;
            });

            // Mietmonate in aktiven Forderungen ausschließen: altes Einzelfeld rent_ledger_id UND Liste rent_ledger_ids
            const activeClaimItems = await fetchAllRows(() => supabase
                .from('claim_items')
                .select('id, rent_ledger_id, rent_ledger_ids, claims!inner(status)')
                .not('claims.status', 'in', CLOSED_STATUSES_FILTER)
                .order('id', { ascending: true }));

            const excludedIds = new Set();
            activeClaimItems.forEach(ci => {
                if (ci.rent_ledger_id) excludedIds.add(ci.rent_ledger_id);
                if (Array.isArray(ci.rent_ledger_ids)) ci.rent_ledger_ids.forEach(id => { if (id) excludedIds.add(id); });
            });

            const today = new Date();
            let notDue = 0;
            const available = ledgerData.filter(l => {
                if (excludedIds.has(l.id)) return false;
                if (getLedgerOpenAmount(l) <= 0) return false;
                // Noch nicht fällige Mieten (kein Verzug) nicht zur Anmahnung anbieten
                if (!isLedgerOverdue(l, today)) {
                    notDue++;
                    return false;
                }
                return true;
            });

            setOpenLedgers(available);
            setNotDueCount(notDue);
        } catch (err) {
            console.error('Error loading ledgers:', err);
            setOpenLedgers([]);
            setLedgerLoadError('Offene Mieten konnten nicht geladen werden: ' + translateClaimError(err));
        }

        try {
            // Fetch all active leases for manual claims
            const leasesData = await fetchAllRows(() => {
                let leasesQuery = supabase
                    .from('leases')
                    .select(`
                        id, user_id,
                        tenants (first_name, last_name),
                        units!inner (unit_name, properties!inner (id, portfolio_id, street, house_number, city))
                    `)
                    .eq('status', 'active')
                    .order('id', { ascending: true });

                if (selectedPortfolioID) {
                    leasesQuery = leasesQuery.eq('units.properties.portfolio_id', selectedPortfolioID);
                }
                return leasesQuery;
            });
            setAllLeases(leasesData);
        } catch (err) {
            console.error('Error loading leases:', err);
            setAllLeases([]);
            setLedgerLoadError(prev => (prev ? prev + ' ' : '') + 'Mietverträge für freie Forderungen konnten nicht geladen werden.');
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
        setExistingClaim(null);
        setCreateHint(null);
        autoAdjustedFormRef.current = false;
        setForm(DEFAULT_FORM);
        setIsCreateModalOpen(true);
        loadOpenLedgers();
    };

    const selectedLedgerItems = openLedgers.filter(l => selectedLedgerIds.includes(l.id));
    const selectedLedgerLeaseIds = Array.from(new Set(selectedLedgerItems.map(l => l.leases?.id).filter(Boolean)));
    const targetLeaseIdForCreate = selectedLeaseId || (selectedLedgerLeaseIds.length === 1 ? selectedLedgerLeaseIds[0] : '');
    const canProceedToStep2 = !!selectedLeaseId || (selectedLedgerIds.length > 0 && selectedLedgerLeaseIds.length === 1);

    const findActiveClaimForLease = async (leaseId) => {
        const { data, error } = await supabase
            .from('claims')
            .select('id, created_at, updated_at, status, interest_rate, interest_start_date, accumulated_unpaid_interest')
            .eq('lease_id', leaseId)
            .not('status', 'in', CLOSED_STATUSES_FILTER)
            .order('created_at', { ascending: false })
            .limit(1);
        if (error) throw error;
        return data && data.length > 0 ? data[0] : null;
    };

    const goToStep2 = async () => {
        if (!canProceedToStep2) return;
        setCreateStep(2);
        setExistingClaim(null);
        setCheckingExistingClaim(true);
        try {
            const existing = await findActiveClaimForLease(targetLeaseIdForCreate);
            setExistingClaim(existing);
            if (existing) {
                // Beim Anhängen gilt der Zinssatz der bestehenden Akte; erneute Mahnkosten nur bewusst eintragen
                setForm(prev => ({ ...prev, interest_rate: existing.interest_rate ?? prev.interest_rate, fee_amount: 0 }));
                autoAdjustedFormRef.current = true;
            } else if (autoAdjustedFormRef.current) {
                setForm(prev => ({ ...prev, interest_rate: DEFAULT_FORM.interest_rate, fee_amount: DEFAULT_FORM.fee_amount }));
                autoAdjustedFormRef.current = false;
            }
        } catch (err) {
            console.warn('Bestehende Forderung konnte nicht geprüft werden:', err);
        } finally {
            setCheckingExistingClaim(false);
        }
    };

    // Laufende Zinsen der bestehenden Akte bis heute festschreiben, bevor neue Positionen angehängt werden.
    // Sonst verzinst claim_totals_view die neuen Positionen rückwirkend ab dem alten Zinsbeginn (doppelt zu den
    // bereits bis heute berechneten Zinsen). Wertneutral: offener Zinsbetrag bleibt gleich.
    const capitalizeRunningInterest = async (existing, todayStr) => {
        if (!existing.interest_start_date || existing.interest_start_date >= todayStr) return;
        const { data: t, error } = await supabase
            .from('claim_totals_view')
            .select('live_interest_since_start')
            .eq('claim_id', existing.id)
            .maybeSingle();
        if (error) throw error;
        const live = round2(t?.live_interest_since_start);
        // Schutz gegen gleichzeitige Änderung über Zinsbeginn + updated_at (kein Gleichheitsvergleich auf
        // numeric-Beträge: ungerundete Werte verlieren als JS-Zahl Stellen und würden nie übereinstimmen)
        let updateQuery = supabase
            .from('claims')
            .update({
                accumulated_unpaid_interest: round2(num(existing.accumulated_unpaid_interest) + live),
                interest_start_date: todayStr,
                updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
            .eq('interest_start_date', existing.interest_start_date);
        updateQuery = existing.updated_at
            ? updateQuery.eq('updated_at', existing.updated_at)
            : updateQuery.is('updated_at', null);
        const { data: updated, error: updateError } = await updateQuery.select('id');
        if (updateError) throw updateError;
        if (!updated || updated.length === 0) {
            throw new Error('Die bestehende Forderungsakte wurde zwischenzeitlich geändert. Bitte versuchen Sie es erneut.');
        }
    };

    const handleCreateClaim = async () => {
        if (isSubmitting) return;
        const { cleaned: cleanedManualItems, errors: manualErrors } = cleanManualItems(manualItems);
        if (manualErrors.length > 0) {
            alert('Bitte prüfen Sie die manuellen Positionen:\n\n' + manualErrors.join('\n'));
            return;
        }
        if (selectedLedgerIds.length === 0 && cleanedManualItems.length === 0) {
            alert('Bitte wählen Sie mindestens eine Miete aus oder fügen Sie eine manuelle Position hinzu.');
            return;
        }
        if (!targetLeaseIdForCreate) {
            alert('Kein eindeutiger Mietvertrag zugeordnet. Bitte nur Mieten eines Mietvertrags auswählen.');
            return;
        }

        const rateInput = parseFloat(form.interest_rate);
        if (!Number.isFinite(rateInput) || rateInput < 0 || rateInput > MAX_INTEREST_RATE) {
            alert(`Bitte einen Zinssatz zwischen 0 und ${MAX_INTEREST_RATE} % p.a. angeben.`);
            return;
        }
        const feeInput = form.fee_amount === '' ? 0 : parseFloat(form.fee_amount);
        if (!Number.isFinite(feeInput) || feeInput < 0) {
            alert('Die Mahnkosten müssen 0 oder ein positiver Betrag sein.');
            return;
        }
        const deadlineDays = Number(form.deadline_days);
        if (!Number.isInteger(deadlineDays) || deadlineDays < 1 || deadlineDays > MAX_DEADLINE_DAYS) {
            alert(`Bitte eine Frist zwischen 1 und ${MAX_DEADLINE_DAYS} Tagen angeben.`);
            return;
        }

        setIsSubmitting(true);
        try {
            const today = new Date();
            const todayStr = toLocalDateString(today);

            // Besteht bereits eine aktive Akte, hängt create_claim_advanced die Positionen dort an
            const existing = await findActiveClaimForLease(targetLeaseIdForCreate);
            const effectiveRate = existing ? num(existing.interest_rate) : rateInput;
            const calculatedInterest = calculateCreationInterest(selectedLedgerItems, cleanedManualItems, effectiveRate, today);

            if (existing) await capitalizeRunningInterest(existing, todayStr);

            const { error: rpcError } = await supabase.rpc('create_claim_advanced', {
                p_lease_id: targetLeaseIdForCreate,
                p_rent_ledger_ids: selectedLedgerIds.length > 0 ? selectedLedgerIds : null,
                p_manual_items: cleanedManualItems,
                p_fee_amount: round2(feeInput),
                p_interest_rate: effectiveRate,
                p_accumulated_interest: calculatedInterest,
                p_interest_start_date: todayStr,
                p_deadline_days: deadlineDays,
                p_note: form.note || ''
            });

            if (rpcError) throw rpcError;

            setIsCreateModalOpen(false);
            loadData();
            alert(existing
                ? 'Die Positionen wurden an die bestehende Forderungsakte dieses Mietvertrags angehängt.'
                : 'Forderung wurde erfolgreich erstellt!');
        } catch (err) {
            console.error('Error creating claim:', err);
            alert('Fehler: ' + translateClaimError(err, 'Forderung konnte nicht erstellt werden.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const openEditModal = (claim) => {
        setEditingClaim(claim);
        setEditForm({
            deadline: claim.deadline ? claim.deadline.split('T')[0] : '',
            interest_rate: claim.interest_rate ?? '',
            accumulated_unpaid_interest: claim.accumulated_unpaid_interest ?? 0,
            accumulated_unpaid_fees: claim.accumulated_unpaid_fees ?? 0,
            rate_retroactive: false
        });
        setIsEditModalOpen(true);
    };

    // Zinssatz geändert? (Vergleich auf 4 Nachkommastellen wie das Eingabefeld)
    const isRateChanged = (claim, rateValue) => {
        const next = parseFloat(rateValue);
        return !!claim && Number.isFinite(next)
            && Math.round(next * 10000) !== Math.round(num(claim.interest_rate) * 10000);
    };

    const handleEditClaim = async () => {
        if (!editingClaim || isSubmitting) return;
        if (!canWriteClaim(editingClaim)) {
            alert('Für dieses Portfolio haben Sie nur Leserechte (Freigabe). Forderungen können nur mit Schreibrecht „Finanzen“ bearbeitet werden.');
            return;
        }
        const rate = parseFloat(editForm.interest_rate);
        const interest = parseFloat(editForm.accumulated_unpaid_interest);
        const fees = parseFloat(editForm.accumulated_unpaid_fees);
        const errors = [];
        if (!Number.isFinite(rate) || rate < 0 || rate > MAX_INTEREST_RATE) errors.push(`Zinssatz: bitte einen Wert zwischen 0 und ${MAX_INTEREST_RATE} % p.a. angeben.`);
        if (!Number.isFinite(interest) || interest < 0) errors.push('Verbuchte Zinsen: bitte 0 oder einen positiven Betrag angeben.');
        if (!Number.isFinite(fees) || fees < 0) errors.push('Mahnkosten: bitte 0 oder einen positiven Betrag angeben.');
        if (editForm.deadline && !parseLocalDate(editForm.deadline)) errors.push('Fristdatum ist ungültig.');
        if (errors.length > 0) {
            alert('Bitte prüfen Sie Ihre Eingaben:\n\n' + errors.join('\n'));
            return;
        }

        setIsSubmitting(true);
        try {
            const todayStr = toLocalDateString(new Date());
            const payload = {
                deadline: editForm.deadline || null,
                interest_rate: rate,
                accumulated_unpaid_interest: round2(interest),
                accumulated_unpaid_fees: round2(fees),
                updated_at: new Date().toISOString()
            };
            let updateQuery = supabase.from('claims').update(payload).eq('id', editingClaim.id);

            // Neuer Zinssatz gilt ab heute: die bis heute zum bisherigen Satz aufgelaufenen Zinsen festschreiben
            // (wie beim Anhängen an eine Akte, capitalizeRunningInterest). Sonst rechnet claim_totals_view den
            // neuen Satz rückwirkend ab dem alten Zinsbeginn. Rückwirkend nur bewusst (Tippfehler korrigieren).
            const startDate = editingClaim.interest_start_date || null;
            if (isRateChanged(editingClaim, rate) && !editForm.rate_retroactive && startDate && startDate < todayStr) {
                const { data: t, error: totalsError } = await supabase
                    .from('claim_totals_view')
                    .select('live_interest_since_start')
                    .eq('claim_id', editingClaim.id)
                    .maybeSingle();
                if (totalsError) throw totalsError;
                if (!t) throw new Error('Die laufenden Zinsen konnten nicht ermittelt werden. Bitte laden Sie die Seite neu.');
                payload.accumulated_unpaid_interest = round2(interest + num(t.live_interest_since_start));
                payload.interest_start_date = todayStr;
                // Schutz gegen gleichzeitige Änderung (Zinsbeginn + updated_at, wie capitalizeRunningInterest)
                updateQuery = supabase.from('claims').update(payload)
                    .eq('id', editingClaim.id)
                    .eq('interest_start_date', startDate);
                updateQuery = editingClaim.updated_at
                    ? updateQuery.eq('updated_at', editingClaim.updated_at)
                    : updateQuery.is('updated_at', null);
            }

            const { data: updated, error } = await updateQuery.select('id');
            if (error) throw error;
            if (!updated || updated.length === 0) {
                throw new Error('Die Forderung wurde nicht gespeichert: keine Schreibberechtigung für „Finanzen“ oder die Forderung wurde zwischenzeitlich geändert. Bitte laden Sie die Seite neu.');
            }

            setIsEditModalOpen(false);
            setEditingClaim(null);
            loadData();
            alert('Forderung erfolgreich aktualisiert!');
        } catch (err) {
            console.error('Error updating claim:', err);
            alert('Fehler beim Aktualisieren: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const openCancelModal = (claim) => {
        setCancelTarget(claim);
        setCancelReason('');
    };

    // Storno: Ratenplan beenden, Portal-Link sperren, Forderung mit Grund stornieren, Ereignis protokollieren –
    // über die Datenbank-Funktion cancel_claim in einer Transaktion (Rückfall: bisherige Einzelschritte).
    // Bereits gebuchte Zahlungen bleiben gebucht.
    const handleConfirmCancel = async () => {
        if (!cancelTarget || isSubmitting) return;
        const reason = cancelReason.trim();
        if (!reason) {
            alert('Bitte geben Sie einen Stornierungsgrund an.');
            return;
        }
        if (!canWriteClaim(cancelTarget)) {
            alert('Für dieses Portfolio haben Sie nur Leserechte (Freigabe). Forderungen können nur mit Schreibrecht „Finanzen“ storniert werden.');
            return;
        }
        setIsSubmitting(true);
        try {
            const result = await cancelClaim({ claim: cancelTarget, reason, writeOff: false, userId: user?.id || null });

            setCancelTarget(null);
            loadData();
            alert(!result.historySaved
                ? 'Forderung wurde storniert. Hinweis: Der Historien-Eintrag konnte nicht gespeichert werden.'
                : 'Forderung wurde storniert.');
        } catch (err) {
            console.error('Error cancelling claim:', err);
            loadData();
            alert('Fehler beim Stornieren: ' + translateClaimError(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const getStatusBadge = (status) => {
        const config = STATUS_CONFIG[status] || { label: status, variant: 'default' };
        return <Badge variant={config.variant}>{config.label}</Badge>;
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return formatDateDE(dateString) || '-';
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
        acc[leaseId].totalOpen = round2(acc[leaseId].totalOpen + getLedgerOpenAmount(ledger));
        return acc;
    }, {});

    const toggleTenantExpand = (leaseId) => {
        setExpandedTenant(expandedTenant === leaseId ? null : leaseId);
    };

    // Eine Forderung betrifft genau einen Mietvertrag: Auswahl eines anderen Vertrags startet die Auswahl neu
    const toggleLedgerSelection = (ledgerId, leaseId) => {
        setSelectedLeaseId(''); // Clear manual lease selection
        setSelectedLedgerIds(prev => {
            if (prev.includes(ledgerId)) return prev.filter(id => id !== ledgerId);
            const prevLeaseIds = new Set(openLedgers.filter(l => prev.includes(l.id)).map(l => l.leases?.id || 'unknown'));
            if (prevLeaseIds.size > 0 && !prevLeaseIds.has(leaseId)) return [ledgerId];
            return [...prev, ledgerId];
        });
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

    const totalPrincipalSelected = round2(selectedLedgerItems.reduce((sum, l) => sum + getLedgerOpenAmount(l), 0));

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
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <ExportDropdown
                        reportType="mahnwesen"
                        data={visibleClaims.map(claim => {
                            const propData = claim.leases?.units?.properties;
                            const prop = propData ? `${propData.street} ${propData.house_number}`.trim() : '';
                            const unit = claim.leases?.units?.unit_name || '';
                            const immobilie = prop && unit ? `${prop} / ${unit}` : (prop || unit || '–');

                            return {
                                property_id: propData?.id,
                                mietername: getTenantName(claim.tenants),
                                immobilie,
                                ursprung: claim.totalUrsprung || 0,
                                offen: claim.totalOffen || 0,
                                status: STATUS_CONFIG[claim.status]?.label || claim.status,
                                frist: claim.deadline || '',
                                gebuehren: claim.feesOpen || 0,
                                zinsen: claim.interestOpen || 0,
                                erstellt_am: claim.created_at || '',
                                _propertyLabel: prop || '–',
                            };
                        })}
                        properties={Array.from(new Set(visibleClaims.map(c => c.leases?.units?.properties).filter(Boolean).map(p => p.id)))
                            .map(id => {
                                const p = visibleClaims.find(c => c.leases?.units?.properties?.id === id)?.leases?.units?.properties;
                                return { id: p?.id, label: `${p?.street || ''} ${p?.house_number || ''}`.trim() };
                            })}
                        totalRows={visibleClaims.length}
                    />
                    {canCreateClaims ? (
                        <>
                            <Button
                                variant="secondary"
                                onClick={openPortalSettings}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <SettingsIcon size={18} />
                                Portal-Einstellungen
                            </Button>
                            <Button onClick={openCreateModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Plus size={18} />
                                Forderung erstellen
                            </Button>
                        </>
                    ) : (
                        <span
                            style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
                            title="Freigabe nur zum Lesen: Forderungen anlegen, bearbeiten und stornieren erfordert Schreibrecht „Finanzen“."
                        >
                            Nur lesen
                        </span>
                    )}
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
                <div style={{ padding: 'var(--spacing-lg)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>{showSettled ? 'Aktive und erledigte Forderungen' : 'Aktive Forderungen'}</h2>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={showSettled}
                            onChange={(e) => setShowSettled(e.target.checked)}
                        />
                        Erledigte anzeigen{settledCount > 0 ? ` (${settledCount})` : ''}
                    </label>
                </div>

                {error && (
                    <div style={{ margin: 'var(--spacing-lg)', padding: 'var(--spacing-md)', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Ban size={20} />
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--text-secondary)' }}>Lade Daten...</div>
                ) : visibleClaims.length === 0 ? (
                    <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {claims.length === 0
                            ? 'Noch keine Forderungen vorhanden.'
                            : `Keine aktiven Forderungen. ${settledCount} erledigte ${settledCount === 1 ? 'Forderung ist' : 'Forderungen sind'} ausgeblendet („Erledigte anzeigen“).`}
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
                                {visibleClaims.map((claim) => (
                                    <tr
                                        key={claim.id}
                                        onClick={() => navigate(`/forderungen/${claim.id}`)}
                                        style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s', cursor: 'pointer' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <td style={{ padding: '16px', fontSize: '0.95rem', fontWeight: 500 }}>{getTenantName(claim.tenants)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{getLeaseName(claim.leases)}</td>
                                        <td style={{ padding: '16px' }}>{getStatusBadge(claim.status)}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Clock size={14} />
                                                {formatDate(claim.deadline)}
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right' }}>{claim.hasTotals ? formatCurrency(claim.totalUrsprung) : '—'}</td>
                                        <td style={{ padding: '16px', fontSize: '0.9rem', textAlign: 'right', color: '#059669' }}>{claim.hasTotals ? formatCurrency(claim.totalGetilgt) : '—'}</td>
                                        <td style={{ padding: '16px', fontSize: '0.95rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {claim.hasTotals ? formatCurrency(claim.totalOffen) : '—'}
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
                                        type="number" step="0.0001" min="0" max={MAX_INTEREST_RATE}
                                        value={editForm.interest_rate}
                                        onChange={e => setEditForm({...editForm, interest_rate: e.target.value})}
                                    />
                                    {isRateChanged(editingClaim, editForm.interest_rate) && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            {editForm.rate_retroactive
                                                ? 'Der neue Satz gilt rückwirkend ab Zinsbeginn – nur zur Korrektur eines Eingabefehlers.'
                                                : 'Der neue Satz gilt ab heute; die bis heute aufgelaufenen Zinsen werden zum bisherigen Satz unter „Verbuchte Zinsen“ festgeschrieben.'}
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={!!editForm.rate_retroactive}
                                                    onChange={e => setEditForm({ ...editForm, rate_retroactive: e.target.checked })}
                                                />
                                                Rückwirkend ab Zinsbeginn korrigieren (Tippfehler)
                                            </label>
                                        </div>
                                    )}
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
                                <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} disabled={isSubmitting}>Abbrechen</Button>
                                <Button onClick={handleEditClaim} disabled={isSubmitting} style={{ backgroundColor: '#1E40AF', color: 'white' }}>
                                    {isSubmitting ? 'Wird gespeichert...' : 'Änderungen speichern'}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>

            {/* Storno Modal */}
            <Modal isOpen={!!cancelTarget} onClose={() => !isSubmitting && setCancelTarget(null)} title="Forderung stornieren">
                {cancelTarget && (
                    <div style={{ padding: 'var(--spacing-md) 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ padding: '12px 16px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.9rem' }}>
                            <div style={{ fontWeight: 600 }}>{getTenantName(cancelTarget.tenants)}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{getLeaseName(cancelTarget.leases)}</div>
                            {cancelTarget.hasTotals && (
                                <div style={{ marginTop: '6px' }}>Offen: <strong>{formatCurrency(cancelTarget.totalOffen)}</strong></div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', fontSize: '0.85rem', color: '#92400E' }}>
                            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <ul style={{ margin: 0, paddingLeft: '18px' }}>
                                <li>Die Forderung wird storniert und erscheint nicht mehr in der Liste der aktiven Forderungen.</li>
                                <li>Die betroffenen Mietmonate können danach erneut in einer Forderung erfasst werden; am Mietkonto selbst wird nichts geändert.</li>
                                {cancelTarget.status === 'payment_plan_active' && <li>Die aktive Ratenzahlungsvereinbarung wird beendet, offene Raten werden storniert.</li>}
                                {cancelTarget.totalGetilgt > 0 && (
                                    <li>Bereits gebuchte Zahlungen ({formatCurrency(cancelTarget.totalGetilgt)}) bleiben gebucht und werden nicht zurückgebucht.</li>
                                )}
                                <li>Ein aktiver Portal-Link wird deaktiviert.</li>
                                <li>Die Stornierung kann in der App nicht rückgängig gemacht werden.</li>
                            </ul>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Stornierungsgrund (Pflichtfeld)</label>
                            <textarea
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                placeholder="z. B. Forderung irrtümlich angelegt, Zahlung außerhalb der App eingegangen"
                                style={{ width: '100%', minHeight: '80px', padding: '8px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <Button variant="secondary" onClick={() => setCancelTarget(null)} disabled={isSubmitting}>Abbrechen</Button>
                            <Button onClick={handleConfirmCancel} disabled={isSubmitting || !cancelReason.trim()} style={{ backgroundColor: '#991B1B', color: 'white' }}>
                                {isSubmitting ? 'Wird storniert...' : 'Forderung stornieren'}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Create Modal */}
            <Modal isOpen={isCreateModalOpen} onClose={() => !isSubmitting && setIsCreateModalOpen(false)} title="Forderung erstellen" maxWidth="700px">
                <div style={{ padding: 'var(--spacing-md) 0' }}>
                    {createStep === 1 && (
                        <div>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
                                Wählen Sie einen Mieter aus, um eine gebündelte oder einzelne Forderung zu erstellen.
                            </p>

                            {ledgerLoadError && (
                                <div style={{ display: 'flex', gap: '8px', padding: '12px', marginBottom: '16px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '0.85rem', color: '#991B1B' }}>
                                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                    <div>{ledgerLoadError}</div>
                                </div>
                            )}

                            {createHint && !loadingLedgers && (
                                <div style={{ display: 'flex', gap: '8px', padding: '12px', marginBottom: '16px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', fontSize: '0.85rem', color: '#92400E' }}>
                                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                    <div>{createHint}</div>
                                </div>
                            )}

                            {loadingLedgers ? (
                                <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>Lade offene Mieten...</div>
                            ) : openLedgers.length === 0 ? (
                                <div style={{ padding: 'var(--spacing-xl)', textAlign: 'center', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
                                    Es gibt aktuell keine offenen, bereits fälligen Mieten, die noch nicht in Bearbeitung sind.
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
                                                                    const openAmount = getLedgerOpenAmount(l);
                                                                    const monthStr = l.period_month ? l.period_month.substring(0, 7) : '';
                                                                    const isSelected = selectedLedgerIds.includes(l.id);
                                                                    const dueDate = getLedgerDueDate(l);
                                                                    return (
                                                                        <tr key={l.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                                                                            <td style={{ padding: '8px 0', width: '30px' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isSelected}
                                                                                    onChange={() => toggleLedgerSelection(l.id, leaseId)}
                                                                                />
                                                                            </td>
                                                                            <td style={{ padding: '8px 0' }}>
                                                                                Miete {monthStr}
                                                                                {dueDate && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>fällig {dueDate.toLocaleDateString('de-DE')}</span>}
                                                                            </td>
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

                            {!loadingLedgers && notDueCount > 0 && (
                                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {notDueCount} {notDueCount === 1 ? 'Miete ist' : 'Mieten sind'} noch nicht fällig bzw. noch nicht im Verzug und {notDueCount === 1 ? 'wird' : 'werden'} deshalb nicht zur Anmahnung angeboten.
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
                                <Button onClick={goToStep2} disabled={!canProceedToStep2} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                                    : selectedLedgerItems[0]?.leases;
                                const todayDate = new Date();
                                const effectiveRate = existingClaim ? num(existingClaim.interest_rate) : num(form.interest_rate);
                                const previewManual = manualItems.map(item => ({ amount: parseFloat(item.amount) || 0, dueDate: item.dueDate }));
                                const calculatedInterest = calculateCreationInterest(selectedLedgerItems, previewManual, effectiveRate, todayDate);

                                const totalManual = round2(manualItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0));
                                const total = round2(totalPrincipalSelected + totalManual + Math.max(0, num(form.fee_amount)) + calculatedInterest);
                                const deadlineDate = new Date();
                                deadlineDate.setDate(deadlineDate.getDate() + (parseInt(form.deadline_days, 10) || 0));

                                return (
                                    <>
                                        {checkingExistingClaim && (
                                            <div style={{ marginBottom: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Prüfe bestehende Forderungsakten …</div>
                                        )}
                                        {existingClaim && (
                                            <div style={{ display: 'flex', gap: '8px', padding: '12px', marginBottom: 'var(--spacing-lg)', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', fontSize: '0.85rem', color: '#1E3A8A' }}>
                                                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                <div>
                                                    Für diesen Mietvertrag besteht bereits eine offene Forderungsakte (angelegt am {formatDate(existingClaim.created_at)}, Status: {STATUS_CONFIG[existingClaim.status]?.label || existingClaim.status}).
                                                    Die neuen Positionen werden <strong>an diese Akte angehängt</strong>. Es gilt deren Zinssatz ({num(existingClaim.interest_rate).toLocaleString('de-DE', { maximumFractionDigits: 4 })} % p.a.); die bis heute aufgelaufenen Zinsen der Akte werden dabei festgeschrieben.
                                                    Mahnkosten sind voreingestellt auf 0 € – bitte nur eintragen, wenn tatsächlich weitere Kosten entstanden sind.
                                                </div>
                                            </div>
                                        )}
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
                                                    <span style={{ fontWeight: 600 }}>{formatCurrency(parseFloat(item.amount) || 0)}</span>
                                                </div>
                                            ))}

                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', marginTop: '12px' }}>
                                                <span>Mahnkosten:</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(Math.max(0, num(form.fee_amount)))}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#B45309' }}>
                                                <span>Verzugszinsen (bis heute):</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(calculatedInterest)}</span>
                                            </div>
                                            <div style={{ borderTop: '1px solid #D1D5DB', margin: '8px 0' }}></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#991B1B', fontSize: '1.1rem' }}>
                                                <span style={{ fontWeight: 600 }}>{existingClaim ? 'Zusätzliche Forderung (heute):' : 'Gesamtforderung (heute):'}</span>
                                                <span style={{ fontWeight: 700 }}>{formatCurrency(total)}</span>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                                                Zinsen werden je Monat ab dem Tag nach der Fälligkeit berechnet (fällt diese auf ein Wochenende oder einen bundesweiten Feiertag, ab dem Tag nach dem nächsten Werktag).
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '24px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Manuelle Positionen (Optional)</label>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setManualItems(prev => [...prev, { description: '', amount: '', item_type: 'other', dueDate: '' }])}
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                >
                                                    <Plus size={14} /> Position hinzufügen
                                                </Button>
                                            </div>

                                            {manualItems.length > 0 && (
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', paddingLeft: '4px' }}>
                                                    <div style={{ flex: 2, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Bezeichnung *</div>
                                                    <div style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Fällig am</div>
                                                    <div style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Betrag (€) *</div>
                                                    <div style={{ width: '24px' }}></div>
                                                </div>
                                            )}

                                            {manualItems.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                                                    <Input
                                                        placeholder="z.B. Betriebskosten 2024"
                                                        value={item.description}
                                                        onChange={e => {
                                                            const value = e.target.value;
                                                            setManualItems(prev => prev.map((it, i) => (i === idx ? { ...it, description: value } : it)));
                                                        }}
                                                        style={{ flex: 2 }}
                                                    />
                                                    <Input
                                                        type="date"
                                                        value={item.dueDate || ''}
                                                        onChange={e => {
                                                            const value = e.target.value;
                                                            setManualItems(prev => prev.map((it, i) => (i === idx ? { ...it, dueDate: value } : it)));
                                                        }}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <Input
                                                        type="number" step="0.01" min="0.01"
                                                        placeholder="0,00"
                                                        value={item.amount}
                                                        onChange={e => {
                                                            const value = e.target.value;
                                                            setManualItems(prev => prev.map((it, i) => (i === idx ? { ...it, amount: value } : it)));
                                                        }}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <button
                                                        onClick={() => setManualItems(prev => prev.filter((_, i) => i !== idx))}
                                                        style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px' }}
                                                        title="Position entfernen"
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
                                                    type="number" step="0.0001" min="0" max={MAX_INTEREST_RATE}
                                                    value={form.interest_rate}
                                                    disabled={!!existingClaim}
                                                    onChange={e => setForm({...form, interest_rate: e.target.value})}
                                                />
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                    {existingClaim
                                                        ? 'Es gilt der Zinssatz der bestehenden Akte.'
                                                        : `Zinsen bis heute werden automatisch aus ${form.interest_rate}% berechnet.`}
                                                    {' '}Gesetzlicher Verzugszins gegenüber Verbrauchern: 5 Prozentpunkte über dem jeweils gültigen Basiszinssatz (§ 288 Abs. 1 BGB) – bitte den Satz prüfen.
                                                </div>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Mahnkosten (€)</label>
                                                <Input
                                                    type="number" step="0.01" min="0"
                                                    value={form.fee_amount}
                                                    onChange={e => setForm({...form, fee_amount: e.target.value})}
                                                />
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                    Bitte nur angemessene, tatsächlich entstandene Kosten ansetzen (z. B. Porto/Druck).
                                                </div>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Frist (Tage)</label>
                                                <Input
                                                    type="number" min="1" max={MAX_DEADLINE_DAYS} step="1"
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
                                            <Button variant="secondary" onClick={() => setCreateStep(1)} disabled={isSubmitting} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <ArrowLeft size={16} /> Zurück
                                            </Button>
                                            <Button onClick={handleCreateClaim} disabled={isSubmitting || checkingExistingClaim} style={{ backgroundColor: '#991B1B', color: 'white' }}>
                                                {isSubmitting ? 'Wird erstellt...' : existingClaim ? 'An Akte anhängen' : 'Forderung erstellen'}
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
                        {canWriteClaim(activeDropdownClaim) ? (
                            <>
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
                                    onClick={(e) => { e.stopPropagation(); setActiveDropdown(null); openCancelModal(activeDropdownClaim); }}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.9rem', color: '#991B1B', borderRadius: '6px' }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.06)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <Trash2 size={16} /> Stornieren
                                </button>
                            </>
                        ) : (
                            <div style={{ padding: '8px 16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }} title="Freigabe nur zum Lesen">
                                Nur lesen (Schreibrecht „Finanzen“ fehlt)
                            </div>
                        )}
                    </div>
                </>,
                document.body
            )}

            {/* Portal Settings Modal */}
            <Modal isOpen={isSettingsModalOpen} onClose={() => !isSubmitting && setIsSettingsModalOpen(false)} title="Forderungsportal Einstellungen">
                <div style={{ padding: 'var(--spacing-lg)' }}>
                    {portalSettingsOwnerOnly ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', fontSize: '0.9rem', color: '#1E3A8A' }}>
                                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                    Ratenoptionen und Bankverbindung des Forderungsportals legt der Eigentümer des Portfolios fest.
                                    Für Forderungen aus freigegebenen Portfolios gelten immer seine Einstellungen (bzw. die im Portfolio hinterlegte Bankverbindung).
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Button variant="secondary" onClick={() => setIsSettingsModalOpen(false)}>Schließen</Button>
                            </div>
                        </div>
                    ) : loadingSettings ? (
                        <div style={{ textAlign: 'center', padding: '20px' }}>Lade Einstellungen...</div>
                    ) : portalSettingsError ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '0.9rem', color: '#991B1B' }}>
                                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>{portalSettingsError}</div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)' }}>
                                <Button variant="secondary" onClick={() => setIsSettingsModalOpen(false)}>Schließen</Button>
                                <Button onClick={loadPortalSettings}>Erneut laden</Button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
                            {portalSettingsMixedScope && (
                                <div style={{ display: 'flex', gap: '8px', padding: '12px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', fontSize: '0.85rem', color: '#1E3A8A' }}>
                                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                    <div>Diese Einstellungen gelten nur für Forderungen Ihrer eigenen Portfolios. Für freigegebene Portfolios legt sie der jeweilige Eigentümer fest.</div>
                                </div>
                            )}
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
                                                        min="2" max="48" step="1"
                                                        value={opt.months}
                                                        onChange={(e) => updateInstallmentOption(index, 'months', e.target.value)}
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Aufschlag (%)</label>
                                                    <Input
                                                        type="number"
                                                        step="0.01" min="0" max="100"
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
                                        <div style={{ fontSize: '0.78rem', color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '8px 10px' }}>
                                            Hinweis: Ein Aufschlag für eine Ratenzahlung gegenüber Wohnraummietern (Verbrauchern) kann als entgeltlicher Zahlungsaufschub den Vorschriften über Verbraucherkredite (§ 506 BGB) unterliegen – mit Informationspflichten und Widerrufsrecht. Bitte rechtlich prüfen lassen; im Zweifel 0 % verwenden.
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div style={{ padding: '16px', backgroundColor: '#F8FAFC', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                    <CreditCard size={20} color="var(--primary-color)" />
                                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Bankverbindung für Zahlungsportal</h3>
                                </div>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                    Geben Sie Ihre Bankdaten an, damit der Mieter offene Beträge direkt per Überweisung begleichen und einen QR-Code (GiroCode) für schnelles Bezahlen nutzen kann.
                                    {' '}Ist im Portfolio (Einstellungen › Portfolios) eine eigene IBAN hinterlegt, nennen Mahnschreiben und Forderungsportal für dessen Forderungen diese Bankverbindung (Kontoinhaber: Firmenname des Portfolios) – sie hat Vorrang vor den Angaben hier.
                                </p>
                                {ownPortfoliosWithIban.length > 0 && (
                                    <p style={{ fontSize: '0.8rem', color: '#1E3A8A', marginTop: '-8px', marginBottom: '16px' }}>
                                        Eigene Bankverbindung hinterlegt in: {ownPortfoliosWithIban.map(p => p.name).join(', ')}.
                                    </p>
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Kontoinhaber</label>
                                        <Input
                                            type="text"
                                            placeholder="z.B. Max Mustermann"
                                            value={portalSettings.bank_account_holder}
                                            onChange={(e) => setPortalSettings({ ...portalSettings, bank_account_holder: e.target.value })}
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>IBAN</label>
                                            <Input
                                                type="text"
                                                placeholder="DE89..."
                                                value={portalSettings.iban}
                                                onChange={(e) => setPortalSettings({ ...portalSettings, iban: e.target.value })}
                                            />
                                            {normalizeIban(portalSettings.iban) && !isValidIban(normalizeIban(portalSettings.iban)) && (
                                                <div style={{ fontSize: '0.75rem', color: '#B91C1C', marginTop: '-8px' }}>IBAN ungültig</div>
                                            )}
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>BIC</label>
                                            <Input
                                                type="text"
                                                placeholder="z.B. GENO..."
                                                value={portalSettings.bic}
                                                onChange={(e) => setPortalSettings({ ...portalSettings, bic: e.target.value })}
                                            />
                                            {normalizeBic(portalSettings.bic) && !isValidBic(normalizeBic(portalSettings.bic)) && (
                                                <div style={{ fontSize: '0.75rem', color: '#B91C1C', marginTop: '-8px' }}>BIC ungültig</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: '24px' }}>
                                <Button variant="secondary" onClick={() => setIsSettingsModalOpen(false)} disabled={isSubmitting}>Abbrechen</Button>
                                <Button onClick={handleSavePortalSettings} disabled={isSubmitting || !portalSettingsOriginal}>
                                    {isSubmitting ? 'Wird gespeichert...' : 'Speichern'}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default Claims;
