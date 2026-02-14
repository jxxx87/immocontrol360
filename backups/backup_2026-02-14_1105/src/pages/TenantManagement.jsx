import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
    Users, Mail, Send, CheckCircle2, Clock,
    X, Plus, Building2, DoorOpen, Search, RefreshCw, Loader
} from 'lucide-react';

const TenantManagement = () => {
    const { user } = useAuth();
    const [invitations, setInvitations] = useState([]);
    const [tenantRoles, setTenantRoles] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [units, setUnits] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteForm, setInviteForm] = useState({ email: '', tenant_id: '', unit_id: '', property_id: '' });
    const [sending, setSending] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);

    // ── FETCH DATA ──────────────────────────────────────────────────
    const fetchData = async () => {
        setLoading(true);
        try {
            const [invRes, roleRes, tenantRes, unitRes, propRes] = await Promise.all([
                supabase.from('tenant_invitations').select('*').order('created_at', { ascending: false }),
                supabase.from('user_roles').select('*').eq('role', 'tenant'),
                supabase.from('tenants').select('*').order('last_name'),
                supabase.from('units').select('*, property:properties(*)').order('unit_name'),
                supabase.from('properties').select('*').order('street')
            ]);

            setInvitations(invRes.data || []);
            setTenantRoles(roleRes.data || []);
            setTenants(tenantRes.data || []);
            setUnits(unitRes.data || []);
            setProperties(propRes.data || []);
        } catch (err) {
            console.error('Error:', err);
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
            // Find the tenant's active lease to get unit_id and property_id
            const selectedTenant = tenants.find(t => t.id === inviteForm.tenant_id);

            // Get unit/property from active lease
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

            // Send Magic Link via OTP
            const { error: authError } = await supabase.auth.signInWithOtp({
                email: inviteForm.email,
                options: {
                    data: {
                        role: 'tenant',
                        tenant_id: inviteForm.tenant_id,
                        unit_id: unitId,
                        property_id: propertyId
                    },
                    shouldCreateUser: true
                }
            });

            if (authError) throw authError;

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

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    // Combine invitations + registered tenants
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

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Mieter-Verwaltung</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        Laden Sie Mieter zum Portal ein und verwalten Sie deren Zugang.
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
                    <button
                        onClick={() => setShowInvite(true)}
                        className="btn btn-primary btn-md"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <Plus size={18} /> Mieter einladen
                    </button>
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
                                    onChange={(e) => setInviteForm(prev => ({ ...prev, tenant_id: e.target.value }))}
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
