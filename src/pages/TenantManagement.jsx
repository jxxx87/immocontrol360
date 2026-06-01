import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import {
    Users, Mail, Send, CheckCircle2, Clock,
    X, Plus, Building2, DoorOpen, Search, RefreshCw, Loader,
    Link2, Copy, Trash2, Filter
} from 'lucide-react';

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
    const [loading, setLoading] = useState(true);
    
    // Invite portal access states
    const [showInvite, setShowInvite] = useState(false);
    const [inviteForm, setInviteForm] = useState({ email: '', tenant_id: '', unit_id: '', property_id: '' });
    const [sending, setSending] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);

    // Tenant data verification states
    const [filterMode, setFilterMode] = useState('active'); // 'all', 'active', 'old'
    const [searchQuery, setSearchQuery] = useState('');
    const [tenantDataPropertyId, setTenantDataPropertyId] = useState('');
    const [generatingLinkId, setGeneratingLinkId] = useState(null);
    const [sendingLinkTenantId, setSendingLinkTenantId] = useState(null);

    // Update activeTab when URL search parameters change
    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const tab = queryParams.get('tab') === 'tenant-data' ? 'tenant-data' : 'portal-access';
        setActiveTab(tab);
    }, [location.search]);

    // ── FETCH DATA ──────────────────────────────────────────────────
    const fetchData = async () => {
        setLoading(true);
        try {
            const [invRes, roleRes, tenantRes, unitRes, propRes, leasesRes, linksRes] = await Promise.all([
                supabase.from('tenant_invitations').select('*').order('created_at', { ascending: false }),
                supabase.from('user_roles').select('*').eq('role', 'tenant'),
                supabase.from('tenants').select('*').order('last_name'),
                supabase.from('units').select('*, property:properties(*)').order('unit_name'),
                supabase.from('properties').select('*').order('street'),
                supabase.from('leases').select('*'),
                supabase.from('tenant_verification_links').select('*').order('created_at', { ascending: false })
            ]);

            setInvitations(invRes.data || []);
            setTenantRoles(roleRes.data || []);
            setTenants(tenantRes.data || []);
            setUnits(unitRes.data || []);
            setProperties(propRes.data || []);
            setLeases(leasesRes.data || []);
            setVerificationLinks(linksRes.data || []);
        } catch (err) {
            console.error('Error fetching data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // ── SEND INVITATION ─────────────────────────────────────────────
    const handleInvite = async () => {
        if (!inviteForm.email || !inviteForm.tenant_id || sending) return;
        setSending(true);
        setStatusMessage(null);

        try {
            // Find unit/property from active lease
            let unitId = inviteForm.unit_id;
            let propertyId = inviteForm.property_id;

            if (!unitId) {
                const { data: leaseData } = await supabase
                    .from('leases')
                    .select('unit_id, unit:units(property_id)')
                    .eq('tenant_id', inviteForm.tenant_id)
                    .eq('status', 'active')
                    .limit(1);

                if (leaseData?.[0]) {
                    unitId = leaseData[0].unit_id;
                    propertyId = leaseData[0].unit?.property_id;
                }
            }

            // Create invitation record
            const { error: invError } = await supabase.from('tenant_invitations').insert({
                email: inviteForm.email,
                tenant_id: inviteForm.tenant_id,
                unit_id: unitId || null,
                property_id: propertyId || null,
                invited_by: user.id,
                status: 'pending'
            });

            if (invError) throw invError;

            // Send Magic Link via Edge Function using user's custom SMTP (or system fallback)
            const { data: inviteData, error: inviteErr } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'send_tenant_invite',
                    userId: user.id,
                    to: inviteForm.email,
                    tenantId: inviteForm.tenant_id,
                    unitId: unitId || null,
                    propertyId: propertyId || null,
                    origin: window.location.origin
                }
            });

            if (inviteErr) throw inviteErr;
            if (inviteData?.error) throw new Error(inviteData.error);

            setStatusMessage({ type: 'success', text: `Einladung an ${inviteForm.email} gesendet!` });
            setInviteForm({ email: '', tenant_id: '', unit_id: '', property_id: '' });
            setShowInvite(false);
            fetchData();
        } catch (err) {
            console.error('Error sending invite:', err);
            setStatusMessage({ type: 'error', text: `Fehler: ${err.message}` });
        } finally {
            setSending(false);
        }
    };

    // ── GENERATE TEMPORARY VERIFICATION LINK ────────────────────────
    const handleGenerateLink = async (tenantId) => {
        setGeneratingLinkId(tenantId);
        try {
            // Cleanup: delete old, expired, and unused links for this tenant to keep DB tidy
            await supabase
                .from('tenant_verification_links')
                .delete()
                .eq('tenant_id', tenantId)
                .eq('is_updated', false)
                .lt('expires_at', new Date().toISOString());

            // Generate standard UUID token
            const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 14); // 2 weeks

            const { error } = await supabase.from('tenant_verification_links').insert({
                tenant_id: tenantId,
                token: token,
                expires_at: expiresAt.toISOString(),
                created_by: user.id
            });

            if (error) throw error;

            addNotification({
                type: 'success',
                title: 'Link generiert',
                body: 'Der Verifikations-Link für 2 Wochen wurde erfolgreich erstellt.'
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

        setSendingLinkTenantId(tenant.id);
        const url = `${window.location.origin}/mieterdaten/portal/${activeLink.token}`;

        try {
            const { data, error } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'send_custom_email',
                    userId: user.id,
                    to: tenant.email,
                    subject: 'Aktualisierung Ihrer Kontaktdaten - ImmoControlpro360',
                    html: `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                          <div style="background-color: #0ea5e9; color: white; padding: 20px; border-radius: 6px; text-align: center;">
                            <h2 style="margin: 0; font-size: 20px;">Kontaktdaten aktualisieren</h2>
                          </div>
                          <div style="padding: 20px; color: #1e293b; line-height: 1.6;">
                            <p>Hallo ${tenant.first_name} ${tenant.last_name},</p>
                            <p>Ihr Vermieter bittet Sie, Ihre hinterlegten Kontaktdaten im System zu überprüfen und gegebenenfalls zu aktualisieren.</p>
                            <p>Bitte klicken Sie auf den folgenden Link, um das Datenblatt aufzurufen:</p>
                            <div style="text-align: center; margin: 30px 0;">
                              <a href="${url}" style="background-color: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Daten aktualisieren</a>
                            </div>
                            <p style="font-size: 13px; color: #64748b;">Der Link ist für 14 Tage gültig. Falls der Button oben nicht funktioniert, kopieren Sie bitte folgenden Link in Ihren Browser:<br/>${url}</p>
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
            const { error } = await supabase
                .from('tenant_verification_links')
                .update({ expires_at: '1970-01-01T00:00:00Z' })
                .eq('id', linkId);

            if (error) throw error;

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

    // ── AUTO-SELECT UNIT/PROPERTY WHEN TENANT CHANGES ───────────────
    useEffect(() => {
        if (!inviteForm.tenant_id) return;

        const findLease = async () => {
            const { data } = await supabase
                .from('leases')
                .select('unit_id, unit:units(property_id)')
                .eq('tenant_id', inviteForm.tenant_id)
                .eq('status', 'active')
                .limit(1);

            if (data?.[0]) {
                setInviteForm(prev => ({
                    ...prev,
                    unit_id: data[0].unit_id || '',
                    property_id: data[0].unit?.property_id || ''
                }));
            }
        };

        findLease();
    }, [inviteForm.tenant_id]);

    // ── HELPERS ─────────────────────────────────────────────────────
    const getTenantName = (tenantId) => {
        const t = tenants.find(x => x.id === tenantId);
        return t ? `${t.last_name}, ${t.first_name}` : 'Unbekannt';
    };

    const getUnitLabel = (unitId) => {
        const u = units.find(x => x.id === unitId);
        if (!u) return '—';
        const addr = u.property?.street ? `${u.property.street} ${u.property.house_number || ''}` : '';
        return `${addr} / ${u.unit_name}`.trim();
    };

    const getTenantUnitInfo = (tenantId) => {
        const today = new Date().toISOString().split('T')[0];
        const activeLease = leases.find(l => 
            l.tenant_id === tenantId && 
            l.status === 'active' && 
            l.start_date <= today && 
            (!l.end_date || l.end_date >= today)
        );
        if (!activeLease) return 'Keine aktive Zuordnung';
        const u = units.find(x => x.id === activeLease.unit_id);
        if (!u) return 'Unbekannte Einheit';
        const prop = properties.find(p => p.id === u.property_id);
        const addr = prop ? `${prop.street} ${prop.house_number || ''}` : '';
        return `${u.unit_name} (${addr})`;
    };

    const getTenantContactAddress = (tenantId) => {
        const t = tenants.find(x => x.id === tenantId);
        if (t && (t.street || t.house_number || t.postal_code || t.city)) {
            return `${t.street || ''} ${t.house_number || ''}, ${t.postal_code || ''} ${t.city || ''}`.trim().replace(/^,\s*/, '');
        }
        // Fallback to property of active lease
        const activeLease = leases.find(l => 
            l.tenant_id === tenantId && 
            l.status === 'active' && 
            l.start_date <= today && 
            (!l.end_date || l.end_date >= today)
        );
        if (activeLease) {
            const u = units.find(x => x.id === activeLease.unit_id);
            if (u) {
                const prop = properties.find(p => p.id === u.property_id);
                if (prop) {
                    return `${prop.street || ''} ${prop.house_number || ''}, ${prop.postal_code || ''} ${prop.city || ''}`.trim().replace(/^,\s*/, '');
                }
            }
        }
        return 'Keine Adresse hinterlegt';
    };

    const getActiveLink = (tenantId) => {
        const now = new Date().toISOString();
        return verificationLinks.find(l => l.tenant_id === tenantId && l.expires_at > now);
    };

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
        ...tenantRoles.map(r => ({
            type: 'registered',
            tenantId: r.tenant_id,
            unitId: r.unit_id,
            userId: r.user_id,
            createdAt: r.created_at
        })),
        ...invitations
            .filter(inv => !tenantRoles.find(r => r.tenant_id === inv.tenant_id))
            .map(inv => ({
                type: inv.status === 'accepted' ? 'registered' : 'invited',
                tenantId: inv.tenant_id,
                unitId: inv.unit_id,
                email: inv.email,
                createdAt: inv.created_at
            }))
    ];

    // Filter tenants for Tab 2
    const today = new Date().toISOString().split('T')[0];
    const filteredTenants = tenants.filter(t => {
        const activeLeases = leases.filter(l => 
            l.tenant_id === t.id && 
            l.status === 'active' && 
            l.start_date <= today && 
            (!l.end_date || l.end_date >= today)
        );
        const isActive = activeLeases.length > 0;

        if (filterMode === 'active' && !isActive) return false;
        if (filterMode === 'old' && isActive) return false;

        if (tenantDataPropertyId) {
            const tenantLeases = leases.filter(l => l.tenant_id === t.id);
            const matchesProperty = tenantLeases.some(l => {
                const u = units.find(unit => unit.id === l.unit_id);
                return u?.property_id === tenantDataPropertyId;
            });
            if (!matchesProperty) return false;
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const fullName = `${t.first_name} ${t.last_name}`.toLowerCase();
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
                        onClick={fetchData}
                        className="btn btn-secondary btn-md"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <RefreshCw size={16} /> Aktualisieren
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
                                    <th>E-MAIL</th>
                                    <th>STATUS</th>
                                    <th>EINGELADEN AM</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allTenantEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                                            Noch keine Mieter eingeladen. Klicken Sie auf "Mieter einladen".
                                        </td>
                                    </tr>
                                ) : (
                                    allTenantEntries.map((entry, idx) => (
                                        <tr key={idx} className="table-row">
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
                                                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                    {formatDate(entry.createdAt)}
                                                </span>
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
                            allTenantEntries.map((entry, idx) => (
                                <div key={idx} style={{
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
                                            {entry.type === 'registered' ? 'Registriert' : 'Invited'}
                                        </span>
                                    </div>

                                    <div style={{ marginBottom: '6px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                        {getUnitLabel(entry.unitId)}
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {entry.email || '—'}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            {formatDate(entry.createdAt)}
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
                                        const activeLeases = leases.filter(l => 
                                            l.tenant_id === t.id && 
                                            l.status === 'active' && 
                                            l.start_date <= today && 
                                            (!l.end_date || l.end_date >= today)
                                        );
                                        const isActive = activeLeases.length > 0;
                                        const activeLink = getActiveLink(t.id);

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
                                                    {activeLink ? (
                                                        <span style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                            padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 500,
                                                            backgroundColor: activeLink.is_updated ? '#D1FAE5' : '#FEF3C7',
                                                            color: activeLink.is_updated ? '#065F46' : '#92400E'
                                                        }}>
                                                            {activeLink.is_updated ? (
                                                                <><CheckCircle2 size={10} /> Aktualisiert</>
                                                            ) : (
                                                                <><Clock size={10} /> Ausstehend</>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Kein Link</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {activeLink ? (
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button
                                                                onClick={() => {
                                                                    const url = `${window.location.origin}/mieterdaten/portal/${activeLink.token}`;
                                                                    navigator.clipboard.writeText(url);
                                                                    addNotification({
                                                                        type: 'success',
                                                                        title: 'Link kopiert',
                                                                        body: 'Der Update-Link wurde in die Zwischenablage kopiert.'
                                                                    });
                                                                }}
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
                                                    ) : (
                                                        <button
                                                            onClick={() => handleGenerateLink(t.id)}
                                                            disabled={generatingLinkId === t.id}
                                                            className="btn btn-primary btn-sm"
                                                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
                                                        >
                                                            {generatingLinkId === t.id ? (
                                                                <Loader size={13} className="animate-spin" />
                                                            ) : (
                                                                <Link2 size={13} />
                                                            )}
                                                            Link erstellen
                                                        </button>
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
                                const activeLeases = leases.filter(l => 
                                    l.tenant_id === t.id && 
                                    l.status === 'active' && 
                                    l.start_date <= today && 
                                    (!l.end_date || l.end_date >= today)
                                );
                                const isActive = activeLeases.length > 0;
                                const activeLink = getActiveLink(t.id);

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
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'space-between' }}>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                                                        padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 500,
                                                        backgroundColor: activeLink.is_updated ? '#D1FAE5' : '#FEF3C7',
                                                        color: activeLink.is_updated ? '#065F46' : '#92400E'
                                                    }}>
                                                        {activeLink.is_updated ? 'Aktualisiert' : 'Ausstehend'}
                                                    </span>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
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
                                                            onClick={() => {
                                                                const url = `${window.location.origin}/mieterdaten/portal/${activeLink.token}`;
                                                                navigator.clipboard.writeText(url);
                                                                addNotification({
                                                                    type: 'success',
                                                                    title: 'Link kopiert',
                                                                    body: 'Der Link wurde in die Zwischenablage kopiert.'
                                                                });
                                                            }}
                                                            className="btn btn-secondary btn-sm"
                                                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                                        >
                                                            <Copy size={12} /> Kopieren
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeactivateLink(activeLink.id)}
                                                            className="btn btn-secondary btn-sm"
                                                            style={{ color: '#EF4444', borderColor: '#FEE2E2', backgroundColor: '#FEF2F2', padding: '6px' }}
                                                            title="Link deaktivieren"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleGenerateLink(t.id)}
                                                    disabled={generatingLinkId === t.id}
                                                    className="btn btn-primary btn-sm"
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', justifyContent: 'center' }}
                                                >
                                                    {generatingLinkId === t.id ? (
                                                        <Loader size={12} className="animate-spin" />
                                                    ) : (
                                                        <Link2 size={12} />
                                                    )}
                                                    Link erstellen
                                                </button>
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
                                        const tenant = tenants.find(t => t.id === l.tenant_id);
                                        const name = tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Unbekannter Mieter';
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
                                                    am {new Date(l.updated_at).toLocaleDateString('de-DE')} um {new Date(l.updated_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
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
                                        const selectedTenant = tenants.find(t => t.id === tenantId);
                                        const email = selectedTenant?.email || '';
                                        
                                        // Also find unit_id and property_id from active lease of this tenant
                                        let unitId = '';
                                        let propertyId = '';
                                        const activeLease = leases.find(l => l.tenant_id === tenantId && l.status === 'active');
                                        if (activeLease) {
                                            unitId = activeLease.unit_id;
                                            const unitObj = units.find(u => u.id === unitId);
                                            propertyId = unitObj?.property_id || '';
                                        }
                                        
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
                                        <option key={t.id} value={t.id}>
                                            {t.last_name}, {t.first_name}
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

                            {inviteForm.unit_id && (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--background-color)', border: '1px solid #BAE6FD',
                                    fontSize: '0.82rem', color: 'var(--primary-color)'
                                }}>
                                    <strong>Zugeordnete Einheit:</strong> {getUnitLabel(inviteForm.unit_id)}
                                </div>
                            )}

                            <div style={{
                                padding: '12px 14px', borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--surface-color)', border: '1px solid #FDE68A',
                                fontSize: '0.82rem', color: '#92400E'
                            }}>
                                Der Mieter erhält eine E-Mail mit einem Magic Link.
                                Nach dem Klick wird er automatisch im Mieterportal angemeldet.
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
        </div>
    );
};

export default TenantManagement;
