import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import {
    Mail, Send, CheckCircle2, Clock,
    X, Plus, Search, RefreshCw, Loader,
    Link2, Copy, Trash2, Filter, QrCode, UserX, AlertCircle
} from 'lucide-react';

// ── Hilfsfunktionen ─────────────────────────────────────────────────

// Lokales Datum (YYYY-MM-DD) – toISOString() liefert UTC und verschiebt kurz nach Mitternacht den Tag
const localDateString = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const isLeaseActive = (lease, today) =>
    lease.status === 'active' &&
    lease.start_date <= today &&
    (!lease.end_date || lease.end_date >= today);

// Öffentliche Adresse für Links an Mieter. In der Android-App (https://localhost) bzw. im
// lokalen Entwicklungsbetrieb wäre window.location.origin für den Mieter nicht erreichbar.
const PUBLIC_APP_ORIGIN = 'https://app.immocontrol360.de';
const getPublicAppOrigin = () => {
    const { origin, hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
    if (isLocal || (protocol !== 'https:' && protocol !== 'http:')) {
        return (import.meta.env.VITE_APP_URL || PUBLIC_APP_ORIGIN).replace(/\/$/, '');
    }
    return origin;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const isValidEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

// Zufälliges Token für Mieterdaten-Links (192 Bit). Die Datenbank speichert künftig nur den Hash.
const createLinkToken = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');

// Gespeicherter Wert ist nur ein Marker, wenn die Datenbank das Token gehasht hat
const isStoredTokenUsable = (token) => !!token && !String(token).startsWith('hashed:');

const copyTextToClipboard = async (text) => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fallback unten (z. B. fehlende Berechtigung oder WebView)
    }
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
};

const TenantManagement = () => {
    const { user } = useAuth();
    const { addNotification } = useNotifications();
    const location = useLocation();

    // Parse URL tab parameter
    const queryParams = new URLSearchParams(location.search);
    const initialTab = queryParams.get('tab') === 'tenant-data' ? 'tenant-data' : 'portal-access';

    const [activeTab, setActiveTab] = useState(initialTab);
    const [invitations, setInvitations] = useState([]);
    const [tenantRoles, setTenantRoles] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [units, setUnits] = useState([]);
    const [properties, setProperties] = useState([]);
    const [leases, setLeases] = useState([]);
    const [verificationLinks, setVerificationLinks] = useState([]);
    const [tenantAuthInfo, setTenantAuthInfo] = useState([]);
    const [loading, setLoading] = useState(true);       // nur beim ersten Laden (Vollbild)
    const [refreshing, setRefreshing] = useState(false); // spätere Aktualisierungen
    const [loadErrors, setLoadErrors] = useState([]);

    // Invite portal access states
    const [showInvite, setShowInvite] = useState(false);
    const [inviteForm, setInviteForm] = useState({ email: '', tenant_id: '', unit_id: '', property_id: '' });
    const [sending, setSending] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);
    const [qrModalData, setQrModalData] = useState(null);
    const [busyEntryKey, setBusyEntryKey] = useState(null);

    // Tenant data verification states
    const [filterMode, setFilterMode] = useState('active'); // 'all', 'active', 'old'
    const [searchQuery, setSearchQuery] = useState('');
    const [tenantDataPropertyId, setTenantDataPropertyId] = useState('');
    const [generatingLinkId, setGeneratingLinkId] = useState(null);
    const [sendingLinkTenantId, setSendingLinkTenantId] = useState(null);
    // Klartext-Tokens frisch erstellter Links (nur in dieser Sitzung; die Datenbank speichert nur den Hash)
    const [createdLinkTokens, setCreatedLinkTokens] = useState({});

    // Update activeTab when URL search parameters change
    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const tab = queryParams.get('tab') === 'tenant-data' ? 'tenant-data' : 'portal-access';
        setActiveTab(tab);
    }, [location.search]);

    // ── FETCH DATA ──────────────────────────────────────────────────
    const fetchData = useCallback(async ({ initial = false } = {}) => {
        if (initial) setLoading(true);
        else setRefreshing(true);
        try {
            const results = await Promise.all([
                supabase.from('tenant_invitations').select('id, email, tenant_id, unit_id, property_id, invited_by, status, created_at').order('created_at', { ascending: false }),
                supabase.from('user_roles').select('id, user_id, role, tenant_id, unit_id, property_id, created_at').eq('role', 'tenant'),
                supabase.from('tenants').select('id, user_id, first_name, last_name, email, phone, street, house_number, postal_code, city').order('last_name'),
                supabase.from('units').select('id, unit_name, property_id, property:properties(street, house_number)').order('unit_name'),
                supabase.from('properties').select('id, street, house_number, zip, city').order('street'),
                supabase.from('leases').select('id, tenant_id, unit_id, status, start_date, end_date'),
                // Nur Links zu Mietern, die dieses Konto sehen darf (Inner Join auf tenants)
                supabase.from('tenant_verification_links')
                    .select('id, tenant_id, token, created_at, expires_at, is_updated, updated_at, created_by, tenant:tenants!inner(id)')
                    .order('created_at', { ascending: false }),
                supabase.from('tenant_auth_info').select('*')
            ]);

            const labels = ['Einladungen', 'Portal-Rollen', 'Mieter', 'Einheiten', 'Objekte', 'Mietverträge', 'Mieterdaten-Links', 'Portal-Konten'];
            const setters = [setInvitations, setTenantRoles, setTenants, setUnits, setProperties, setLeases, setVerificationLinks, setTenantAuthInfo];
            const failed = [];
            results.forEach((res, i) => {
                if (res.error) {
                    console.error(`Error fetching ${labels[i]}:`, res.error);
                    failed.push(`${labels[i]}: ${res.error.message}`);
                } else {
                    setters[i](res.data || []);
                }
            });
            setLoadErrors(failed);
        } catch (err) {
            console.error('Error fetching data:', err);
            setLoadErrors([err.message || String(err)]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchData({ initial: true }); }, [fetchData]);

    // ── ABGELEITETE DATEN ───────────────────────────────────────────
    const today = localDateString();

    const tenantById = useMemo(() => new Map(tenants.map(t => [t.id, t])), [tenants]);
    const unitById = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
    const propertyById = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties]);

    // Je Mieter der aktive Vertrag (neuester Beginn zuerst) und alle Objekte seiner Verträge
    const { activeLeaseByTenant, propertyIdsByTenant } = useMemo(() => {
        const active = new Map();
        const props = new Map();
        const sorted = [...leases].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
        sorted.forEach(l => {
            if (!l.tenant_id) return;
            if (!active.has(l.tenant_id) && isLeaseActive(l, today)) active.set(l.tenant_id, l);
            const propId = unitById.get(l.unit_id)?.property_id;
            if (propId) {
                if (!props.has(l.tenant_id)) props.set(l.tenant_id, new Set());
                props.get(l.tenant_id).add(propId);
            }
        });
        return { activeLeaseByTenant: active, propertyIdsByTenant: props };
    }, [leases, unitById, today]);

    const registeredTenantIds = useMemo(() => new Set(tenantRoles.map(r => r.tenant_id).filter(Boolean)), [tenantRoles]);

    // ── SEND INVITATION ─────────────────────────────────────────────
    const handleInvite = async () => {
        const email = (inviteForm.email || '').trim().toLowerCase();
        const tenantId = inviteForm.tenant_id;
        if (!email || !tenantId || sending) return;
        setStatusMessage(null);

        if (!isValidEmail(email)) {
            setStatusMessage({ type: 'error', text: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' });
            return;
        }
        if (user?.email && email === user.email.trim().toLowerCase()) {
            setStatusMessage({ type: 'error', text: 'Sie können sich nicht selbst als Mieter einladen.' });
            return;
        }
        if (registeredTenantIds.has(tenantId)) {
            setStatusMessage({ type: 'error', text: 'Dieser Mieter hat bereits einen Portalzugang.' });
            return;
        }

        setSending(true);
        let createdInvitationId = null;

        try {
            // Einheit/Objekt aus dem aktiven Vertrag (lokal ermittelt, mit Datumsprüfung)
            const activeLease = activeLeaseByTenant.get(tenantId);
            const unitId = inviteForm.unit_id || activeLease?.unit_id || null;
            const propertyId = inviteForm.property_id || (unitId ? unitById.get(unitId)?.property_id : null) || null;

            // Bestehende Einladung für diesen Mieter + diese E-Mail wiederverwenden (keine Dubletten)
            const { data: existingInvites, error: existingErr } = await supabase
                .from('tenant_invitations')
                .select('id, status')
                .eq('tenant_id', tenantId)
                .eq('email', email)
                .limit(1);
            if (existingErr) throw existingErr;

            const existing = existingInvites?.[0];
            if (existing?.status === 'accepted') {
                throw new Error('Diese Einladung wurde bereits angenommen.');
            }

            if (!existing) {
                const { data: inserted, error: invError } = await supabase
                    .from('tenant_invitations')
                    .insert({
                        email,
                        tenant_id: tenantId,
                        unit_id: unitId,
                        property_id: propertyId,
                        invited_by: user.id,
                        status: 'pending'
                    })
                    .select('id')
                    .single();

                if (invError) throw invError;
                createdInvitationId = inserted?.id || null;
            }

            // Send Magic Link via Edge Function using user's custom SMTP (or system fallback)
            const { data: inviteData, error: inviteErr } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'send_tenant_invite',
                    userId: user.id,
                    to: email,
                    tenantId,
                    unitId,
                    propertyId,
                    origin: getPublicAppOrigin()
                }
            });

            if (inviteErr) throw inviteErr;
            if (inviteData?.error) throw new Error(inviteData.error);

            // Ältere offene Einladungen dieses Mieters an andere Adressen sind damit überholt
            await supabase
                .from('tenant_invitations')
                .delete()
                .eq('tenant_id', tenantId)
                .eq('status', 'pending')
                .neq('email', email);

            setStatusMessage({ type: 'success', text: `Einladung an ${email} gesendet!` });
            setInviteForm({ email: '', tenant_id: '', unit_id: '', property_id: '' });
            setShowInvite(false);
            fetchData();
        } catch (err) {
            console.error('Error sending invite:', err);
            // Versand gescheitert: gerade angelegte Einladung wieder entfernen, damit ein neuer Versuch sauber startet
            if (createdInvitationId) {
                await supabase.from('tenant_invitations').delete().eq('id', createdInvitationId);
            }
            setStatusMessage({ type: 'error', text: `Fehler: ${err.message}` });
        } finally {
            setSending(false);
        }
    };

    const handleCancelInvitation = async (entry) => {
        if (!window.confirm(`Möchten Sie die Einladung für ${getTenantName(entry.tenantId)} wirklich stornieren?\n\nDer Mieter erhält dadurch keinen Zugang zum Mieterportal. Mieterdaten-Links (Tab „Mieterdaten") bleiben unberührt.`)) {
            return;
        }

        setBusyEntryKey(entry.key);
        try {
            // Nur diese Einladung löschen (Mieterdaten-Links gehören zum Tab „Mieterdaten")
            const { data: removed, error: invErr } = await supabase
                .from('tenant_invitations')
                .delete()
                .eq('id', entry.id)
                .select('id');
            if (invErr) throw invErr;
            if (!removed || removed.length === 0) {
                throw new Error('Die Einladung konnte nicht gelöscht werden (fehlende Berechtigung oder bereits entfernt).');
            }

            addNotification({
                type: 'success',
                title: 'Einladung storniert',
                body: `Die Einladung für ${getTenantName(entry.tenantId)} wurde storniert.`
            });
            fetchData();
        } catch (err) {
            console.error('Error cancelling invitation:', err);
            addNotification({
                type: 'error',
                title: 'Fehler',
                body: 'Fehler beim Stornieren der Einladung: ' + err.message
            });
        } finally {
            setBusyEntryKey(null);
        }
    };

    // Nur den Portalzugang entziehen: Rolle + Einladungen entfernen, Mieter und Konto bleiben
    const handleRevokePortalAccess = async (entry) => {
        const tenantName = getTenantName(entry.tenantId);
        if (!window.confirm(`Portalzugang für ${tenantName} entziehen?\n\nDie Rollenzuordnung und die Einladungen dieses Mieters werden entfernt. Danach hat das Konto keinen Zugriff mehr auf das Mieterportal.\n\nMieterdaten, Mietverträge, Mietkonto und Forderungen bleiben unverändert. Das Benutzerkonto selbst wird nicht gelöscht.`)) {
            return;
        }

        setBusyEntryKey(entry.key);
        try {
            const { data: removedRoles, error: roleErr } = await supabase
                .from('user_roles')
                .delete()
                .eq('tenant_id', entry.tenantId)
                .eq('role', 'tenant')
                .select('id');
            if (roleErr) throw roleErr;

            // Heutiger DB-Stand: Rollen ohne Objektbezug sind für den Vermieter nicht sichtbar und nicht
            // löschbar, erscheinen aber in tenant_auth_info – dann keinen Erfolg melden (Zugang bestünde weiter).
            const roleStillExists = !!entry.userId ||
                (tenantAuthInfo || []).some(a => a.tenant_id === entry.tenantId);
            if (roleStillExists && (!removedRoles || removedRoles.length === 0)) {
                throw new Error('Die Rollenzuordnung konnte nicht entfernt werden (fehlende Berechtigung) – der Portalzugang besteht weiter.');
            }

            const { error: invErr } = await supabase
                .from('tenant_invitations')
                .delete()
                .eq('tenant_id', entry.tenantId);
            if (invErr) throw invErr;

            addNotification({
                type: 'success',
                title: 'Portalzugang entzogen',
                body: `${tenantName} hat keinen Zugang mehr zum Mieterportal. Die Mieterdaten bleiben erhalten.`
            });
            fetchData();
        } catch (err) {
            console.error('Error revoking portal access:', err);
            addNotification({
                type: 'error',
                title: 'Fehler',
                body: 'Portalzugang konnte nicht entzogen werden: ' + err.message
            });
        } finally {
            setBusyEntryKey(null);
        }
    };

    const handleDeleteTenantCompletely = async (entry) => {
        const tenantName = getTenantName(entry.tenantId);
        if (!window.confirm(
            `Mieter ${tenantName} endgültig löschen?\n\n` +
            'Gelöscht werden: die Mieterstammdaten sowie Portalzugang, Einladungen und Mieterdaten-Links dieses Mieters. ' +
            'Das Mieter-Benutzerkonto wird ebenfalls entfernt, sofern es nur für diesen Mieter besteht.\n\n' +
            'Mietverträge, Mietkonto, Forderungen, Dokumente und Kontakte bleiben erhalten, verlieren aber unwiderruflich ' +
            'den Bezug zu diesem Mieter (Name und Anschrift des Mieters fehlen dort danach).\n\n' +
            'Wenn Sie nur den Zugang zum Mieterportal beenden möchten, wählen Sie stattdessen „Zugang entziehen".\n\n' +
            'Dieser Schritt kann nicht rückgängig gemacht werden.'
        )) {
            return;
        }

        setBusyEntryKey(entry.key);
        try {
            const { error } = await supabase.rpc('delete_tenant_completely', { p_tenant_id: entry.tenantId });
            if (error) throw error;

            addNotification({
                type: 'success',
                title: 'Mieter gelöscht',
                body: `Der Mieter ${tenantName} wurde erfolgreich entfernt.`
            });
            fetchData();
        } catch (err) {
            console.error('Error deleting tenant completely:', err);
            addNotification({
                type: 'error',
                title: 'Fehler',
                body: 'Fehler beim Löschen des Mieters: ' + err.message
            });
        } finally {
            setBusyEntryKey(null);
        }
    };

    // QR/Link-Dialog: Link erst auf ausdrücklichen Wunsch erzeugen, weil ein neuer Link
    // den zuletzt per E-Mail versendeten Einladungslink ungültig macht.
    const handleOpenQrModal = (entry) => {
        setQrModalData({
            entry,
            tenantName: getTenantName(entry.tenantId),
            email: entry.email,
            link: null,
            qrDataUrl: null,
            generating: false,
            error: null
        });
    };

    const handleGenerateInviteLink = async () => {
        if (!qrModalData?.entry || qrModalData.generating) return;
        const { entry } = qrModalData;
        setQrModalData(prev => prev && ({ ...prev, generating: true, error: null }));
        try {
            const { data, error } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'get_invite_link',
                    userId: user.id,
                    to: entry.email,
                    tenantId: entry.tenantId,
                    unitId: entry.unitId || null,
                    propertyId: entry.propertyId || null,
                    origin: getPublicAppOrigin(),
                    redirectPath: '/tenant/stammdaten'
                }
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            if (!data?.actionLink) throw new Error('Kein Link zurückgegeben');

            // QR-Code lokal im Browser erzeugen – der Login-Link geht an keinen Drittanbieter
            const qrDataUrl = await QRCode.toDataURL(data.actionLink, { width: 200, margin: 1 });
            setQrModalData(prev => prev && ({ ...prev, link: data.actionLink, qrDataUrl, generating: false }));
        } catch (err) {
            console.error('Error fetching invite link:', err);
            setQrModalData(prev => prev && ({ ...prev, generating: false, error: 'Fehler beim Abrufen des Einladungslinks: ' + err.message }));
        }
    };

    // ── MIETERDATEN-LINKS ───────────────────────────────────────────
    const getLinkToken = (link) => {
        if (!link) return null;
        if (createdLinkTokens[link.id]) return createdLinkTokens[link.id];
        return isStoredTokenUsable(link.token) ? link.token : null;
    };

    const buildLinkUrl = (token) => `${getPublicAppOrigin()}/mieterdaten/portal/${token}`;

    const handleCopyLink = async (link) => {
        const token = getLinkToken(link);
        if (!token) {
            addNotification({
                type: 'error',
                title: 'Link nicht mehr abrufbar',
                body: 'Aus Sicherheitsgründen ist der Link nur direkt nach dem Erstellen verfügbar. Bitte erstellen Sie einen neuen Link.'
            });
            return;
        }
        const ok = await copyTextToClipboard(buildLinkUrl(token));
        addNotification(ok ? {
            type: 'success',
            title: 'Link kopiert',
            body: 'Der Update-Link wurde in die Zwischenablage kopiert.'
        } : {
            type: 'error',
            title: 'Kopieren nicht möglich',
            body: 'Die Zwischenablage ist nicht verfügbar. Bitte versenden Sie den Link per E-Mail.'
        });
    };

    // ── GENERATE TEMPORARY VERIFICATION LINK ────────────────────────
    const handleGenerateLink = async (tenantId) => {
        setGeneratingLinkId(tenantId);
        try {
            const nowIso = new Date().toISOString();

            // Cleanup: delete old, expired, and unused links for this tenant to keep DB tidy
            await supabase
                .from('tenant_verification_links')
                .delete()
                .eq('tenant_id', tenantId)
                .eq('is_updated', false)
                .lt('expires_at', nowIso);

            // Es gilt immer nur der neueste Link: noch laufende ältere Links dieses Mieters beenden
            await supabase
                .from('tenant_verification_links')
                .update({ expires_at: nowIso })
                .eq('tenant_id', tenantId)
                .gt('expires_at', nowIso);

            const token = createLinkToken();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 14); // 2 weeks

            const { data: inserted, error } = await supabase
                .from('tenant_verification_links')
                .insert({
                    tenant_id: tenantId,
                    token: token,
                    expires_at: expiresAt.toISOString(),
                    created_by: user.id
                })
                .select('id')
                .single();

            if (error) throw error;

            if (inserted?.id) {
                setCreatedLinkTokens(prev => ({ ...prev, [inserted.id]: token }));
            }

            addNotification({
                type: 'success',
                title: 'Link generiert',
                body: 'Der Link ist 2 Wochen gültig. Kopieren oder versenden Sie ihn jetzt – aus Sicherheitsgründen wird er später nicht mehr angezeigt.'
            });

            await fetchData();
        } catch (err) {
            console.error('Error generating link:', err);
            addNotification({
                type: 'error',
                title: 'Fehler',
                body: 'Der Link konnte nicht generiert werden: ' + err.message
            });
        } finally {
            setGeneratingLinkId(null);
        }
    };

    const handleSendVerificationLinkEmail = async (tenant, activeLink) => {
        if (!tenant.email) {
            addNotification({
                type: 'error',
                title: 'E-Mail fehlt',
                body: 'Dieser Mieter hat keine E-Mail-Adresse hinterlegt.'
            });
            return;
        }

        const token = getLinkToken(activeLink);
        if (!token) {
            addNotification({
                type: 'error',
                title: 'Link nicht mehr abrufbar',
                body: 'Aus Sicherheitsgründen ist der Link nur direkt nach dem Erstellen verfügbar. Bitte erstellen Sie einen neuen Link.'
            });
            return;
        }

        setSendingLinkTenantId(tenant.id);
        const url = buildLinkUrl(token);
        const safeUrl = escapeHtml(url);
        const salutation = [tenant.first_name, tenant.last_name].filter(Boolean).map(escapeHtml).join(' ');

        try {
            const { data, error } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'send_custom_email',
                    userId: user.id,
                    tenantId: tenant.id,
                    linkId: activeLink.id,
                    purpose: 'tenant_data_update',
                    to: tenant.email,
                    subject: 'Aktualisierung Ihrer Kontaktdaten - ImmoControlpro360',
                    html: `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
                            <h2 style="margin: 0; font-size: 20px;">Kontaktdaten aktualisieren</h2>
                          </div>
                          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
                            <p>${salutation ? `Hallo ${salutation},` : 'Hallo,'}</p>
                            <p>Ihr Vermieter bittet Sie, Ihre hinterlegten Kontaktdaten im System zu überprüfen und gegebenenfalls zu aktualisieren.</p>
                            <p>Bitte klicken Sie auf den folgenden Link, um das Datenblatt aufzurufen:</p>
                            <div style="text-align: center; margin: 30px 0;">
                              <a href="${safeUrl}" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Daten aktualisieren</a>
                            </div>
                            <p style="font-size: 13px; color: #64748b;">Der Link ist für 14 Tage gültig. Falls der Button oben nicht funktioniert, kopieren Sie bitte folgenden Link in Ihren Browser:<br/>${safeUrl}</p>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;"/>
                            <p style="font-size: 14px; color: #64748b; margin: 0;">Freundliche Grüße,<br/>Ihr Vermieter-Team</p>
                          </div>
                        </div>
                    `
                }
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            addNotification({
                type: 'success',
                title: 'E-Mail gesendet',
                body: `Der Update-Link wurde erfolgreich an ${tenant.email} gesendet.`
            });
        } catch (err) {
            console.error('Error sending verification link:', err);
            addNotification({
                type: 'error',
                title: 'Fehler',
                body: 'E-Mail konnte nicht gesendet werden: ' + err.message
            });
        } finally {
            setSendingLinkTenantId(null);
        }
    };

    // ── DEACTIVATE TEMPORARY VERIFICATION LINK ──────────────────────
    const handleDeactivateLink = async (linkId) => {
        try {
            const { data: updated, error } = await supabase
                .from('tenant_verification_links')
                .update({ expires_at: '1970-01-01T00:00:00Z' })
                .eq('id', linkId)
                .select('id');

            if (error) throw error;
            if (!updated || updated.length === 0) {
                throw new Error('Keine Berechtigung oder Link nicht gefunden.');
            }

            addNotification({
                type: 'success',
                title: 'Link deaktiviert',
                body: 'Der Verifikations-Link wurde erfolgreich deaktiviert.'
            });

            await fetchData();
        } catch (err) {
            console.error('Error deactivating link:', err);
            addNotification({
                type: 'error',
                title: 'Fehler',
                body: 'Deaktivieren fehlgeschlagen: ' + err.message
            });
        }
    };

    // ── HELPERS ─────────────────────────────────────────────────────
    const getTenantName = (tenantId) => {
        const t = tenantById.get(tenantId);
        return t ? `${t.last_name || ''}, ${t.first_name || ''}` : 'Unbekannt';
    };

    const getUnitLabel = (unitId) => {
        const u = unitById.get(unitId);
        if (!u) return '—';
        const addr = u.property?.street ? `${u.property.street} ${u.property.house_number || ''}` : '';
        return `${addr} / ${u.unit_name}`.trim();
    };

    const getTenantUnitInfo = (tenantId) => {
        const activeLease = activeLeaseByTenant.get(tenantId);
        if (!activeLease) return 'Keine aktive Zuordnung';
        const u = unitById.get(activeLease.unit_id);
        if (!u) return 'Unbekannte Einheit';
        const prop = propertyById.get(u.property_id);
        const addr = prop ? `${prop.street} ${prop.house_number || ''}` : '';
        return `${u.unit_name} (${addr})`;
    };

    const getTenantContactAddress = (tenantId) => {
        const t = tenantById.get(tenantId);
        if (t && (t.street || t.house_number || t.postal_code || t.city)) {
            return `${t.street || ''} ${t.house_number || ''}, ${t.postal_code || ''} ${t.city || ''}`.trim().replace(/^,\s*/, '');
        }
        // Fallback to property of active lease
        const activeLease = activeLeaseByTenant.get(tenantId);
        if (activeLease) {
            const u = unitById.get(activeLease.unit_id);
            const prop = u ? propertyById.get(u.property_id) : null;
            if (prop) {
                return `${prop.street || ''} ${prop.house_number || ''}, ${prop.zip || ''} ${prop.city || ''}`.trim().replace(/^,\s*/, '');
            }
        }
        return 'Keine Adresse hinterlegt';
    };

    // Neuester noch nicht abgelaufener Link (Liste ist nach Erstellung absteigend sortiert)
    const getActiveLink = (tenantId) => {
        const now = new Date().toISOString();
        return verificationLinks.find(l => l.tenant_id === tenantId && l.expires_at > now);
    };

    // Link kann noch weitergegeben werden: nicht verwendet und Token in dieser Sitzung bekannt
    const isLinkShareable = (link) => !!link && !link.is_updated && !!getLinkToken(link);

    const getLinkValidityLabel = (link) => {
        if (!link) return '—';
        const now = new Date();
        const expires = new Date(link.expires_at);
        const diffTime = expires - now;

        if (diffTime <= 0) return 'Abgelaufen';

        const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        const remainingHours = diffHours % 24;

        if (diffDays > 0) {
            if (remainingHours > 0) {
                return `Noch ${diffDays} t, ${remainingHours} Std.`;
            }
            return `Noch ${diffDays} Tage`;
        }

        if (diffHours > 0) {
            return `Noch ${diffHours} Std.`;
        }

        const diffMinutes = Math.floor(diffTime / (1000 * 60));
        if (diffMinutes > 0) {
            return `Noch ${diffMinutes} Min.`;
        }

        return 'Läuft gleich ab';
    };

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    // Combine invitations + registered tenants for Tab 1
    const allTenantEntries = [
        ...tenantRoles.map(r => {
            const info = (tenantAuthInfo || []).find(a => a.tenant_user_id === r.user_id);
            return {
                key: `role-${r.id}`,
                type: 'registered',
                tenantId: r.tenant_id,
                unitId: r.unit_id,
                propertyId: r.property_id,
                userId: r.user_id,
                createdAt: r.created_at,
                email: info?.registered_email || '—',
                lastSignIn: info?.last_sign_in_at || null
            };
        }),
        ...invitations
            .filter(inv => !registeredTenantIds.has(inv.tenant_id))
            .map(inv => ({
                key: `inv-${inv.id}`,
                id: inv.id,
                type: inv.status === 'accepted' ? 'registered' : 'invited',
                tenantId: inv.tenant_id,
                unitId: inv.unit_id,
                propertyId: inv.property_id,
                email: inv.email,
                createdAt: inv.created_at,
                lastSignIn: null
            }))
    ];

    // Filter tenants for Tab 2
    const filteredTenants = tenants.filter(t => {
        const isActive = activeLeaseByTenant.has(t.id);

        if (filterMode === 'active' && !isActive) return false;
        if (filterMode === 'old' && isActive) return false;

        if (tenantDataPropertyId && !propertyIdsByTenant.get(t.id)?.has(tenantDataPropertyId)) {
            return false;
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const fullName = `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase();
            const email = (t.email || '').toLowerCase();
            const phone = (t.phone || '').toLowerCase();
            return fullName.includes(query) || email.includes(query) || phone.includes(query);
        }

        return true;
    });

    // Stats calculations (current cycle / active links only for filtered tenants)
    const now = new Date();
    const filteredTenantIds = new Set(filteredTenants.map(t => t.id));

    const openLinksCount = verificationLinks.filter(l =>
        !l.is_updated &&
        new Date(l.expires_at) > now &&
        filteredTenantIds.has(l.tenant_id)
    ).length;

    const updatedLinksCount = verificationLinks.filter(l =>
        l.is_updated &&
        new Date(l.expires_at) > now &&
        filteredTenantIds.has(l.tenant_id)
    ).length;

    const totalCurrentLinks = openLinksCount + updatedLinksCount;
    const responseRate = totalCurrentLinks > 0 ? Math.round((updatedLinksCount / totalCurrentLinks) * 100) : 0;

    // ── AKTIONEN JE EINTRAG (Desktop und Mobil) ─────────────────────
    const actionButtonStyle = (color, compact) => ({
        background: 'none',
        border: 'none',
        color,
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        fontSize: compact ? undefined : '0.8rem',
        fontWeight: compact ? undefined : 600,
        transition: 'color 0.2s'
    });

    const renderPortalActions = (entry, compact = false) => {
        const iconSize = compact ? 16 : 14;
        const isBusy = busyEntryKey === entry.key;
        const isGenerating = qrModalData?.entry?.key === entry.key && qrModalData.generating;

        if (entry.type === 'invited') {
            return (
                <>
                    <button
                        onClick={() => handleOpenQrModal(entry)}
                        disabled={isGenerating || isBusy}
                        style={{ ...actionButtonStyle('var(--primary-color)', compact), opacity: isGenerating ? 0.6 : 1 }}
                        title="Einladungslink & QR-Code anzeigen"
                    >
                        {isGenerating ? <Loader className="animate-spin" size={iconSize} /> : <QrCode size={iconSize} />}
                        {!compact && 'QR / Link'}
                    </button>
                    <button
                        onClick={() => handleCancelInvitation(entry)}
                        disabled={isBusy}
                        style={actionButtonStyle('#EF4444', compact)}
                        title="Einladung stornieren"
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#EF4444'; }}
                    >
                        {isBusy ? <Loader className="animate-spin" size={iconSize} /> : <Trash2 size={iconSize} />}
                        {!compact && 'Stornieren'}
                    </button>
                </>
            );
        }

        return (
            <>
                <button
                    onClick={() => handleRevokePortalAccess(entry)}
                    disabled={isBusy}
                    style={actionButtonStyle('#B45309', compact)}
                    title="Portalzugang entziehen (Mieterdaten bleiben erhalten)"
                >
                    {isBusy ? <Loader className="animate-spin" size={iconSize} /> : <UserX size={iconSize} />}
                    {!compact && 'Zugang entziehen'}
                </button>
                <button
                    onClick={() => handleDeleteTenantCompletely(entry)}
                    disabled={isBusy}
                    style={actionButtonStyle('#EF4444', compact)}
                    title="Mieter endgültig löschen"
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#EF4444'; }}
                >
                    <Trash2 size={iconSize} />
                    {!compact && 'Mieter löschen'}
                </button>
            </>
        );
    };

    const renderLinkStatusBadge = (activeLink, small = false) => (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            padding: '2px 8px', borderRadius: '10px', fontSize: small ? '0.7rem' : '0.72rem', fontWeight: 500,
            backgroundColor: activeLink.is_updated ? '#D1FAE5' : '#FEF3C7',
            color: activeLink.is_updated ? '#065F46' : '#92400E'
        }}>
            {activeLink.is_updated ? (
                <>{!small && <CheckCircle2 size={10} />} Aktualisiert</>
            ) : (
                <>{!small && <Clock size={10} />} Ausstehend</>
            )}
        </span>
    );

    const renderGenerateLinkButton = (tenantId, label, fullWidth = false) => (
        <button
            onClick={() => handleGenerateLink(tenantId)}
            disabled={generatingLinkId === tenantId}
            className="btn btn-primary btn-sm"
            style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: fullWidth ? undefined : '6px 12px',
                width: fullWidth ? '100%' : undefined,
                justifyContent: fullWidth ? 'center' : undefined
            }}
        >
            {generatingLinkId === tenantId ? (
                <Loader size={13} className="animate-spin" />
            ) : (
                <Link2 size={13} />
            )}
            {label}
        </button>
    );

    const renderLinkHint = (activeLink) => (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {activeLink.is_updated
                ? 'Link wurde verwendet.'
                : 'Link nur direkt nach dem Erstellen abrufbar.'}
        </span>
    );

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                        {activeTab === 'portal-access' ? 'Mieter-Verwaltung' : 'Mieterdaten'}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        {activeTab === 'portal-access'
                            ? 'Laden Sie Mieter zum Portal ein und verwalten Sie deren Zugang.'
                            : 'Verwalten und verifizieren Sie die persönlichen Kontaktdaten Ihrer Mieter.'
                        }
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={() => fetchData()}
                        disabled={refreshing}
                        className="btn btn-secondary btn-md"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        {refreshing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />} Aktualisieren
                    </button>
                    {activeTab === 'portal-access' && (
                        <button
                            onClick={() => setShowInvite(true)}
                            className="btn btn-primary btn-md"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Plus size={18} /> Mieter einladen
                        </button>
                    )}
                </div>
            </div>

            {/* Ladefehler */}
            {loadErrors.length > 0 && (
                <div role="alert" style={{
                    padding: '12px 18px',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '16px',
                    backgroundColor: '#FEE2E2',
                    color: '#991B1B',
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px'
                }}>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.88rem' }}>
                        <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                        <div>
                            <strong>Einige Daten konnten nicht geladen werden.</strong> Die Anzeige ist daher unvollständig.
                            <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: '0.8rem' }}>
                                {loadErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                            </ul>
                        </div>
                    </div>
                    <button onClick={() => fetchData()} disabled={refreshing} className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                        Erneut laden
                    </button>
                </div>
            )}

            {/* Status Message */}
            {statusMessage && (
                <div style={{
                    padding: '12px 18px',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '16px',
                    backgroundColor: statusMessage.type === 'success' ? '#D1FAE5' : '#FEE2E2',
                    color: statusMessage.type === 'success' ? '#065F46' : '#991B1B',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                    <span style={{ fontSize: '0.88rem' }}>{statusMessage.text}</span>
                    <button onClick={() => setStatusMessage(null)} style={{ cursor: 'pointer' }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* TAB 1: PORTAL ACCESS */}
            {activeTab === 'portal-access' && (
                <>
                    {/* Desktop Table */}
                    <div className="hidden-mobile" style={{
                        backgroundColor: 'var(--surface-color)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-color)',
                        overflow: 'hidden'
                    }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>MIETER</th>
                                    <th>EINHEIT</th>
                                    <th>REGISTRIERTE E-MAIL</th>
                                    <th>STATUS</th>
                                    <th>ZULETZT ONLINE</th>
                                    <th>EINGELADEN AM</th>
                                    <th style={{ textAlign: 'right' }}>AKTIONEN</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allTenantEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                                            Noch keine Mieter eingeladen. Klicken Sie auf "Mieter einladen".
                                        </td>
                                    </tr>
                                ) : (
                                    allTenantEntries.map((entry) => (
                                        <tr key={entry.key} className="table-row">
                                            <td>
                                                <div style={{ fontWeight: 500 }}>{getTenantName(entry.tenantId)}</div>
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                    {getUnitLabel(entry.unitId)}
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.85rem' }}>
                                                    {entry.email || '—'}
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                    padding: '3px 10px', borderRadius: '12px',
                                                    fontSize: '0.75rem', fontWeight: 500,
                                                    backgroundColor: entry.type === 'registered' ? '#D1FAE5' : '#FEF3C7',
                                                    color: entry.type === 'registered' ? '#065F46' : '#92400E'
                                                }}>
                                                    {entry.type === 'registered' ? (
                                                        <><CheckCircle2 size={12} /> Registriert</>
                                                    ) : (
                                                        <><Clock size={12} /> Eingeladen</>
                                                    )}
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                    {entry.lastSignIn ? new Date(entry.lastSignIn).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Nie'}
                                                </span>
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                    {formatDate(entry.createdAt)}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                                    {renderPortalActions(entry)}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {allTenantEntries.length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)',
                                backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)'
                            }}>
                                Noch keine Mieter eingeladen. Klicken Sie auf "Mieter einladen".
                            </div>
                        ) : (
                            allTenantEntries.map((entry) => (
                                <div key={entry.key} style={{
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-md)',
                                    backgroundColor: 'var(--surface-color)',
                                    position: 'relative'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{getTenantName(entry.tenantId)}</div>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                                            padding: '3px 8px', borderRadius: '12px',
                                            fontSize: '0.7rem', fontWeight: 500,
                                            backgroundColor: entry.type === 'registered' ? '#D1FAE5' : '#FEF3C7',
                                            color: entry.type === 'registered' ? '#065F46' : '#92400E',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {entry.type === 'registered' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                                            {entry.type === 'registered' ? 'Registriert' : 'Eingeladen'}
                                        </span>
                                    </div>

                                    <div style={{ marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                        {getUnitLabel(entry.unitId)}
                                    </div>

                                    <div style={{ marginBottom: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        <strong>E-Mail:</strong> {entry.email || '—'}
                                    </div>

                                    <div style={{ marginBottom: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        <strong>Zuletzt online:</strong> {entry.lastSignIn ? new Date(entry.lastSignIn).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Nie'}
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            Geladen: {formatDate(entry.createdAt)}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {renderPortalActions(entry, true)}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}

            {/* TAB 2: TENANT DATA (MIETERDATEN) */}
            {activeTab === 'tenant-data' && (
                <div>
                    {/* Stats summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                        <div style={{
                            backgroundColor: 'var(--surface-color)', padding: '20px', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '16px'
                        }}>
                            <div style={{ backgroundColor: '#EFF6FF', color: '#3B82F6', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                <Link2 size={24} />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{openLinksCount}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Offene Links (Wartend)</div>
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: 'var(--surface-color)', padding: '20px', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '16px'
                        }}>
                            <div style={{ backgroundColor: '#ECFDF5', color: '#10B981', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                <CheckCircle2 size={24} />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{updatedLinksCount}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Aktualisierte Links</div>
                            </div>
                        </div>

                        <div style={{
                            backgroundColor: 'var(--surface-color)', padding: '20px', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '16px'
                        }}>
                            <div style={{ backgroundColor: '#FDF2F8', color: '#EC4899', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                <RefreshCw size={24} />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{responseRate}%</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Rücklaufquote (Aktuell)</div>
                            </div>
                        </div>
                    </div>

                    {/* Search and Count */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', position: 'relative', width: '100%', maxWidth: '300px' }}>
                            <Search size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
                            <input
                                type="text"
                                placeholder="Mieter suchen..."
                                className="search-input-padding"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%', padding: '10px 12px 10px 44px',
                                    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                    outline: 'none', fontSize: '0.9rem', backgroundColor: 'var(--surface-color)'
                                }}
                            />
                        </div>
                    </div>

                    {/* Filter Bar */}
                    <div style={{
                        marginBottom: 'var(--spacing-lg)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-md)',
                        flexWrap: 'wrap',
                        backgroundColor: 'rgba(0, 0, 0, 0.02)',
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>Filter:</span>
                        </div>

                        <div>
                            <select
                                value={filterMode}
                                onChange={e => setFilterMode(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    minWidth: '160px',
                                    fontSize: '0.875rem',
                                    backgroundColor: 'var(--surface-color)',
                                    color: 'var(--text-primary)',
                                    outline: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="active">Aktive Mieter</option>
                                <option value="old">Alte Mieter</option>
                                <option value="all">Alle Mieter</option>
                            </select>
                        </div>

                        <div>
                            <select
                                value={tenantDataPropertyId}
                                onChange={e => setTenantDataPropertyId(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    minWidth: '200px',
                                    fontSize: '0.875rem',
                                    backgroundColor: 'var(--surface-color)',
                                    color: 'var(--text-primary)',
                                    outline: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="">Alle Immobilien</option>
                                {properties.map(p => (
                                    <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Desktop Table */}
                    <div className="hidden-mobile" style={{
                        backgroundColor: 'var(--surface-color)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-color)',
                        overflow: 'hidden'
                    }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>MIETER</th>
                                    <th>MIETOBJEKT</th>
                                    <th>KONTAKTADRESSE</th>
                                    <th>KONTAKTDATEN</th>
                                    <th>GÜLTIGKEIT</th>
                                    <th>STATUS</th>
                                    <th>UPDATE-LINK</th>
                                    <th style={{ textAlign: 'right' }}>AKTIONEN</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTenants.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                                            Keine Mieter gefunden, die den Kriterien entsprechen.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredTenants.map(t => {
                                        const isActive = activeLeaseByTenant.has(t.id);
                                        const activeLink = getActiveLink(t.id);
                                        const shareable = isLinkShareable(activeLink);

                                        return (
                                            <tr key={t.id} className="table-row">
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontWeight: 600 }}>{t.last_name}, {t.first_name}</span>
                                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                                            <span style={{
                                                                width: '6px', height: '6px', borderRadius: '50%',
                                                                backgroundColor: isActive ? '#10B981' : '#9CA3AF'
                                                            }} />
                                                            {isActive ? 'Aktiver Mieter' : 'Alter Mieter'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ fontSize: '0.85rem' }}>
                                                        {getTenantUnitInfo(t.id)}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ fontSize: '0.85rem' }}>
                                                        {getTenantContactAddress(t.id)}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column' }}>
                                                        <span>{t.email || '—'}</span>
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t.phone || '—'}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ fontSize: '0.85rem', fontWeight: 500, color: activeLink ? '#1e293b' : 'var(--text-secondary)' }}>
                                                        {getLinkValidityLabel(activeLink)}
                                                    </div>
                                                </td>
                                                <td>
                                                    {activeLink ? renderLinkStatusBadge(activeLink) : (
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Kein Link</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {activeLink && shareable ? (
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button
                                                                onClick={() => handleCopyLink(activeLink)}
                                                                className="btn btn-secondary btn-sm"
                                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
                                                            >
                                                                <Copy size={13} /> Link kopieren
                                                            </button>
                                                            <button
                                                                onClick={() => handleSendVerificationLinkEmail(t, activeLink)}
                                                                disabled={sendingLinkTenantId === t.id}
                                                                className="btn btn-secondary btn-sm"
                                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
                                                            >
                                                                {sendingLinkTenantId === t.id ? (
                                                                    <Loader size={13} className="animate-spin" />
                                                                ) : (
                                                                    <Mail size={13} />
                                                                )}
                                                                Per E-Mail senden
                                                            </button>
                                                        </div>
                                                    ) : activeLink ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                                                            {renderLinkHint(activeLink)}
                                                            {renderGenerateLinkButton(t.id, 'Neuen Link erstellen')}
                                                        </div>
                                                    ) : (
                                                        renderGenerateLinkButton(t.id, 'Link erstellen')
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {activeLink ? (
                                                        <button
                                                            onClick={() => handleDeactivateLink(activeLink.id)}
                                                            className="btn btn-secondary btn-sm"
                                                            style={{
                                                                color: '#EF4444', borderColor: '#FEE2E2', backgroundColor: '#FEF2F2',
                                                                padding: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                                                            }}
                                                            title="Link deaktivieren"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        {filteredTenants.length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)',
                                backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)'
                            }}>
                                Keine Mieter gefunden.
                            </div>
                        ) : (
                            filteredTenants.map(t => {
                                const isActive = activeLeaseByTenant.has(t.id);
                                const activeLink = getActiveLink(t.id);
                                const shareable = isLinkShareable(activeLink);

                                return (
                                    <div key={t.id} style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--spacing-md)',
                                        backgroundColor: 'var(--surface-color)',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '1rem' }}>{t.last_name}, {t.first_name}</div>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                padding: '3px 8px', borderRadius: '12px',
                                                fontSize: '0.7rem', fontWeight: 500,
                                                backgroundColor: isActive ? '#D1FAE5' : '#E5E7EB',
                                                color: isActive ? '#065F46' : '#374151',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {isActive ? 'Aktiver Mieter' : 'Alter Mieter'}
                                            </span>
                                        </div>

                                        <div style={{ marginBottom: '8px', fontSize: '0.85rem' }}>
                                            <strong>Objekt:</strong> {getTenantUnitInfo(t.id)}
                                        </div>

                                        <div style={{ marginBottom: '8px', fontSize: '0.85rem' }}>
                                            <strong>Kontaktadresse:</strong> {getTenantContactAddress(t.id)}
                                        </div>

                                        <div style={{ marginBottom: '8px', fontSize: '0.85rem' }}>
                                            <strong>Kontakt:</strong> {t.email || '—'} {t.phone ? `/ ${t.phone}` : ''}
                                        </div>

                                        {activeLink && (
                                            <div style={{ marginBottom: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                <strong>Gültigkeit:</strong> {getLinkValidityLabel(activeLink)}
                                            </div>
                                        )}

                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                            {activeLink ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                                                    {renderLinkStatusBadge(activeLink, true)}
                                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                                        {shareable ? (
                                                            <>
                                                                <button
                                                                    onClick={() => handleSendVerificationLinkEmail(t, activeLink)}
                                                                    disabled={sendingLinkTenantId === t.id}
                                                                    className="btn btn-secondary btn-sm"
                                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                                >
                                                                    {sendingLinkTenantId === t.id ? (
                                                                        <Loader size={12} className="animate-spin" />
                                                                    ) : (
                                                                        <Mail size={12} />
                                                                    )}
                                                                    Senden
                                                                </button>
                                                                <button
                                                                    onClick={() => handleCopyLink(activeLink)}
                                                                    className="btn btn-secondary btn-sm"
                                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                                >
                                                                    <Copy size={12} /> Kopieren
                                                                </button>
                                                            </>
                                                        ) : (
                                                            renderGenerateLinkButton(t.id, 'Neuer Link')
                                                        )}
                                                        <button
                                                            onClick={() => handleDeactivateLink(activeLink.id)}
                                                            className="btn btn-secondary btn-sm"
                                                            style={{ color: '#EF4444', borderColor: '#FEE2E2', backgroundColor: '#FEF2F2', padding: '6px' }}
                                                            title="Link deaktivieren"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                    {!shareable && (
                                                        <div style={{ width: '100%' }}>{renderLinkHint(activeLink)}</div>
                                                    )}
                                                </div>
                                            ) : (
                                                renderGenerateLinkButton(t.id, 'Link erstellen', true)
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* History of updates */}
                    <div style={{
                        marginTop: '40px',
                        backgroundColor: 'var(--surface-color)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-color)',
                        padding: '24px'
                    }}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <RefreshCw size={18} color="var(--primary-color)" />
                            Verlauf der Aktualisierungen
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {verificationLinks.filter(l => l.is_updated).length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', fontStyle: 'italic' }}>
                                    Es wurden noch keine Daten über die Verifikationslinks aktualisiert.
                                </div>
                            ) : (
                                verificationLinks
                                    .filter(l => l.is_updated)
                                    .map(l => {
                                        const tenant = tenantById.get(l.tenant_id);
                                        const name = tenant ? `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() : 'Unbekannter Mieter';
                                        return (
                                            <div key={l.id} style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                                backgroundColor: 'var(--background-color)', border: '1px solid var(--border-color)'
                                            }}>
                                                <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                                                    Mieter <strong>{name}</strong> hat seine Kontaktdaten aktualisiert.
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    {l.updated_at
                                                        ? `am ${new Date(l.updated_at).toLocaleDateString('de-DE')} um ${new Date(l.updated_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
                                                        : '—'}
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── INVITE MODAL ───────────────────────────────────────────── */}
            {showInvite && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }} onClick={() => setShowInvite(false)}>
                    <div
                        style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%', maxWidth: '480px',
                            padding: '28px', boxShadow: 'var(--shadow-lg)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Mail size={20} color="var(--primary-color)" />
                                Mieter einladen
                            </h2>
                            <button onClick={() => setShowInvite(false)} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Mieter auswählen *
                                </label>
                                <select
                                    value={inviteForm.tenant_id}
                                    onChange={(e) => {
                                        const tenantId = e.target.value;
                                        const selectedTenant = tenantById.get(tenantId);
                                        const email = selectedTenant?.email || '';

                                        // Einheit/Objekt aus dem aktiven Vertrag (mit Datumsprüfung) – nur lokal,
                                        // damit keine verspätete Antwort eines anderen Mieters das Formular füllt
                                        const activeLease = activeLeaseByTenant.get(tenantId);
                                        const unitId = activeLease?.unit_id || '';
                                        const propertyId = unitId ? (unitById.get(unitId)?.property_id || '') : '';

                                        setInviteForm({
                                            tenant_id: tenantId,
                                            email: email,
                                            unit_id: unitId,
                                            property_id: propertyId
                                        });
                                    }}
                                    style={{
                                        width: '100%', padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        outline: 'none', fontSize: '0.9rem'
                                    }}
                                >
                                    <option value="">— Mieter wählen —</option>
                                    {tenants.map(t => (
                                        <option key={t.id} value={t.id} disabled={registeredTenantIds.has(t.id)}>
                                            {t.last_name}, {t.first_name}{registeredTenantIds.has(t.id) ? ' (bereits registriert)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    E-Mail-Adresse *
                                </label>
                                <input
                                    type="email"
                                    placeholder="mieter@beispiel.de"
                                    value={inviteForm.email}
                                    onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        outline: 'none', fontSize: '0.9rem'
                                    }}
                                />
                            </div>

                            {inviteForm.unit_id ? (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--background-color)', border: '1px solid #BAE6FD',
                                    fontSize: '0.82rem', color: 'var(--primary-color)'
                                }}>
                                    <strong>Zugeordnete Einheit:</strong> {getUnitLabel(inviteForm.unit_id)}
                                </div>
                            ) : inviteForm.tenant_id ? (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--background-color)', border: '1px solid var(--border-color)',
                                    fontSize: '0.82rem', color: 'var(--text-secondary)'
                                }}>
                                    Für diesen Mieter gibt es heute keinen aktiven Mietvertrag. Ohne zugeordnete Einheit sieht der Mieter
                                    im Portal keine Objekt- und Vertragsdaten.
                                </div>
                            ) : null}

                            <div style={{
                                padding: '12px 14px', borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--surface-color)', border: '1px solid #FDE68A',
                                fontSize: '0.82rem', color: '#92400E'
                            }}>
                                Der Mieter erhält eine E-Mail mit einem Magic Link.
                                Nach dem Klick wird er automatisch im Mieterportal angemeldet.
                                Bitte laden Sie nur die E-Mail-Adresse des Mieters ein – Adressen bestehender Vermieter-Konten werden abgelehnt.
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px' }}>
                            <button onClick={() => setShowInvite(false)} className="btn btn-secondary btn-md">
                                Abbrechen
                            </button>
                            <button
                                onClick={handleInvite}
                                disabled={!inviteForm.email || !inviteForm.tenant_id || sending}
                                className="btn btn-primary btn-md"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                                {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                                Einladung senden
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── QR CODE & LINK MODAL ───────────────────────────────────── */}
            {qrModalData && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }} onClick={() => setQrModalData(null)}>
                    <div
                        style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%', maxWidth: '440px',
                            padding: '28px', boxSizing: 'border-box',
                            boxShadow: 'var(--shadow-lg)',
                            textAlign: 'center'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <QrCode size={20} color="var(--primary-color)" />
                                QR-Code & Einladungslink
                            </h3>
                            <button onClick={() => setQrModalData(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Für Mieter: <strong style={{ color: 'var(--text-primary)' }}>{qrModalData.tenantName}</strong> ({qrModalData.email})
                        </div>

                        {!qrModalData.link ? (
                            <>
                                <div style={{
                                    fontSize: '0.82rem',
                                    color: '#92400E',
                                    backgroundColor: '#FFFBEB',
                                    padding: '12px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid #FDE68A',
                                    lineHeight: 1.5,
                                    marginBottom: '20px',
                                    textAlign: 'left'
                                }}>
                                    Hinweis: Ein neu erzeugter Einladungslink ersetzt den zuletzt per E-Mail versendeten Link –
                                    der alte Link funktioniert danach nicht mehr. Der Link meldet den Mieter ohne Passwort an;
                                    geben Sie ihn nur an den Mieter selbst weiter.
                                </div>
                                {qrModalData.error && (
                                    <div style={{ fontSize: '0.82rem', color: '#991B1B', marginBottom: '16px', textAlign: 'left' }}>
                                        {qrModalData.error}
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                    <button onClick={() => setQrModalData(null)} className="btn btn-secondary btn-md">
                                        Abbrechen
                                    </button>
                                    <button
                                        onClick={handleGenerateInviteLink}
                                        disabled={qrModalData.generating}
                                        className="btn btn-primary btn-md"
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        {qrModalData.generating ? <Loader size={14} className="animate-spin" /> : <QrCode size={14} />}
                                        Neuen Einladungslink erzeugen
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* QR Code Container (lokal erzeugt) */}
                                <div style={{
                                    backgroundColor: '#fff',
                                    padding: '16px',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'inline-block',
                                    border: '1px solid var(--border-color)',
                                    marginBottom: '20px'
                                }}>
                                    {qrModalData.qrDataUrl && (
                                        <img
                                            src={qrModalData.qrDataUrl}
                                            alt="QR Code"
                                            style={{ display: 'block', width: '200px', height: '200px' }}
                                        />
                                    )}
                                </div>

                                {/* Copy Link Section */}
                                <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                        Einladungslink (Magic Link)
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="text"
                                            readOnly
                                            value={qrModalData.link}
                                            style={{
                                                flex: 1,
                                                padding: '10px 12px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--border-color)',
                                                fontSize: '0.82rem',
                                                backgroundColor: 'var(--background-color)',
                                                color: 'var(--text-primary)',
                                                outline: 'none'
                                            }}
                                            onClick={(e) => e.target.select()}
                                        />
                                        <button
                                            onClick={async () => {
                                                const ok = await copyTextToClipboard(qrModalData.link);
                                                addNotification(ok ? {
                                                    type: 'success',
                                                    title: 'Kopiert',
                                                    body: 'Einladungslink wurde in die Zwischenablage kopiert.'
                                                } : {
                                                    type: 'error',
                                                    title: 'Kopieren nicht möglich',
                                                    body: 'Bitte markieren Sie den Link im Feld und kopieren Sie ihn manuell.'
                                                });
                                            }}
                                            className="btn btn-secondary"
                                            style={{ padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            title="Link kopieren"
                                        >
                                            <Copy size={16} />
                                        </button>
                                    </div>
                                </div>

                                <div style={{
                                    fontSize: '0.78rem',
                                    color: 'var(--text-secondary)',
                                    backgroundColor: 'var(--background-color)',
                                    padding: '12px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    lineHeight: 1.4,
                                    marginBottom: '20px',
                                    textAlign: 'left'
                                }}>
                                    💡 Sie können den QR-Code scannen, herunterladen (Rechtsklick → Bild speichern) oder den Link kopieren, um ihn z.B. per E-Post, Brief oder WhatsApp an den Mieter zu schicken.
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setQrModalData(null)} className="btn btn-primary btn-md">
                                        Fertig
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TenantManagement;
