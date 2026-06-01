import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { User, Lock, Key, CheckCircle, AlertCircle, Phone, Mail, Home, Calendar, ShieldCheck, Wallet } from 'lucide-react';

const TenantStamdaten = () => {
    const { user, roleData } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    // Stammdaten Form
    const [tenantData, setTenantData] = useState({
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
        street: '',
        house_number: '',
        postal_code: '',
        city: ''
    });

    // Lease details
    const [leaseData, setLeaseData] = useState(null);

    // Password Form
    const [passwordForm, setPasswordForm] = useState({
        password: '',
        confirmPassword: ''
    });
    const [passwordStatus, setPasswordStatus] = useState({ type: '', message: '' });

    // Toast/Message state
    const [message, setMessage] = useState({ type: '', text: '' });

    useEffect(() => {
        const fetchAllData = async () => {
            if (!roleData?.tenant_id) {
                setLoading(false);
                return;
            }

            try {
                // 1. Fetch Tenant master data
                const { data: tenant, error: tenantErr } = await supabase
                    .from('tenants')
                    .select('*')
                    .eq('id', roleData.tenant_id)
                    .maybeSingle();

                if (tenantErr) throw tenantErr;
                if (tenant) {
                    setTenantData({
                        first_name: tenant.first_name || '',
                        last_name: tenant.last_name || '',
                        phone: tenant.phone || '',
                        email: tenant.email || '',
                        street: tenant.street || '',
                        house_number: tenant.house_number || '',
                        postal_code: tenant.postal_code || '',
                        city: tenant.city || ''
                    });
                }

                // 2. Fetch Lease & Unit details
                const { data: lease, error: leaseErr } = await supabase
                    .from('leases')
                    .select('*, unit:units(*, property:properties(*))')
                    .eq('tenant_id', roleData.tenant_id)
                    .eq('status', 'active')
                    .maybeSingle();

                if (leaseErr) throw leaseErr;
                if (lease) {
                    setLeaseData(lease);
                }
            } catch (err) {
                console.error('Error fetching tenant details:', err);
                setMessage({ type: 'error', text: 'Fehler beim Laden der Daten.' });
            } finally {
                setLoading(false);
            }
        };

        fetchAllData();
    }, [roleData]);

    const handleSaveStammdaten = async (e) => {
        e.preventDefault();
        if (!roleData?.tenant_id) return;

        setSaving(true);
        setMessage({ type: '', text: '' });

        try {
            const { error } = await supabase
                .from('tenants')
                .update({
                    first_name: tenantData.first_name,
                    last_name: tenantData.last_name,
                    phone: tenantData.phone,
                    street: tenantData.street,
                    house_number: tenantData.house_number,
                    postal_code: tenantData.postal_code,
                    city: tenantData.city
                })
                .eq('id', roleData.tenant_id);

            if (error) throw error;
            setMessage({ type: 'success', text: 'Stammdaten erfolgreich gespeichert.' });
        } catch (err) {
            console.error('Error updating tenant:', err);
            setMessage({ type: 'error', text: 'Fehler beim Speichern der Stammdaten.' });
        } finally {
            setSaving(false);
        }
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        setPasswordStatus({ type: '', message: '' });

        if (passwordForm.password.length < 6) {
            setPasswordStatus({ type: 'error', message: 'Das Passwort muss mindestens 6 Zeichen lang sein.' });
            return;
        }

        if (passwordForm.password !== passwordForm.confirmPassword) {
            setPasswordStatus({ type: 'error', message: 'Die Passwörter stimmen nicht überein.' });
            return;
        }

        setSaving(true);

        try {
            // Update auth password and set metadata flag
            const { error } = await supabase.auth.updateUser({
                password: passwordForm.password,
                data: { password_set: true }
            });

            if (error) throw error;

            setPasswordStatus({ type: 'success', message: 'Passwort erfolgreich eingerichtet! Sie können sich nun zukünftig mit Ihrer E-Mail und diesem Passwort anmelden.' });
            setPasswordForm({ password: '', confirmPassword: '' });
            
            // Reload user session to update user metadata in frontend context
            await supabase.auth.getSession();
        } catch (err) {
            console.error('Error setting password:', err);
            setPasswordStatus({ type: 'error', message: 'Fehler beim Einrichten des Passworts.' });
        } finally {
            setSaving(false);
        }
    };

    const isPasswordSet = user?.user_metadata?.password_set === true;

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', border: '3px solid #E2E8F0', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Laden...</div>
                </div>
                <style>{`
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '1.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <User size={26} color="var(--primary-color)" /> Stammdaten & Sicherheit
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                    Verwalten Sie Ihre persönlichen Angaben und richten Sie Ihr Passwort für den Login ein.
                </p>
            </div>

            {/* General message info */}
            {message.text && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 18px',
                    borderRadius: 'var(--radius-lg)',
                    marginBottom: '24px',
                    backgroundColor: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                    border: `1px solid ${message.type === 'success' ? '#BBF7D0' : '#FCA5A5'}`,
                    color: message.type === 'success' ? '#166534' : '#991B1B',
                    fontSize: '0.9rem'
                }}>
                    {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    <span>{message.text}</span>
                </div>
            )}

            {/* Main Layout Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '24px' }}>
                
                {/* Left Side: Personal Data & Lease */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    {/* Personal Data Form */}
                    <div style={{
                        backgroundColor: 'var(--surface-color)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-color)',
                        padding: '24px'
                    }}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            Persönliche Angaben
                        </h2>
                        
                        <form onSubmit={handleSaveStammdaten} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>Vorname</label>
                                    <input
                                        type="text"
                                        value={tenantData.first_name}
                                        onChange={e => setTenantData({ ...tenantData, first_name: e.target.value })}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.9rem', outline: 'none' }}
                                        required
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>Nachname</label>
                                    <input
                                        type="text"
                                        value={tenantData.last_name}
                                        onChange={e => setTenantData({ ...tenantData, last_name: e.target.value })}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.9rem', outline: 'none' }}
                                        required
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>E-Mail-Adresse</label>
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <Mail size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: '12px' }} />
                                        <input
                                            type="email"
                                            value={tenantData.email}
                                            style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: '#F8FAFC', color: 'var(--text-secondary)', fontSize: '0.9rem', outline: 'none', cursor: 'not-allowed' }}
                                            disabled
                                            title="E-Mail kann nicht geändert werden"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>Telefonnummer</label>
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <Phone size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: '12px' }} />
                                        <input
                                            type="text"
                                            value={tenantData.phone}
                                            onChange={e => setTenantData({ ...tenantData, phone: e.target.value })}
                                            placeholder="z.B. +49 170 1234567"
                                            style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.9rem', outline: 'none' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border-color)', margin: '8px 0', padding: '16px 0 0 0' }}>
                                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>Anschrift (Meldeadresse)</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Straße</label>
                                        <input
                                            type="text"
                                            value={tenantData.street}
                                            onChange={e => setTenantData({ ...tenantData, street: e.target.value })}
                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.88rem' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Hausnr.</label>
                                        <input
                                            type="text"
                                            value={tenantData.house_number}
                                            onChange={e => setTenantData({ ...tenantData, house_number: e.target.value })}
                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.88rem' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>PLZ</label>
                                        <input
                                            type="text"
                                            value={tenantData.postal_code}
                                            onChange={e => setTenantData({ ...tenantData, postal_code: e.target.value })}
                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.88rem' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '4px' }}>Ort</label>
                                        <input
                                            type="text"
                                            value={tenantData.city}
                                            onChange={e => setTenantData({ ...tenantData, city: e.target.value })}
                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.88rem' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    alignSelf: 'flex-start',
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    backgroundColor: 'var(--primary-color)',
                                    color: 'white',
                                    border: 'none',
                                    fontWeight: 600,
                                    fontSize: '0.88rem',
                                    cursor: saving ? 'not-allowed' : 'pointer',
                                    opacity: saving ? 0.7 : 1,
                                    transition: 'background-color 0.2s',
                                    marginTop: '8px'
                                }}
                            >
                                {saving ? 'Wird gespeichert...' : 'Änderungen speichern'}
                            </button>
                        </form>
                    </div>

                    {/* Lease details */}
                    {leaseData && (
                        <div style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)',
                            padding: '24px'
                        }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Home size={18} color="var(--primary-color)" /> Details zum Mietverhältnis
                            </h2>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Mietobjekt & Einheit</div>
                                    <div style={{ fontWeight: 500, fontSize: '0.92rem' }}>
                                        {leaseData.unit?.property?.street} {leaseData.unit?.property?.house_number}, {leaseData.unit?.property?.zip} {leaseData.unit?.property?.city}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                        Einheit: <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{leaseData.unit?.unit_name}</span>
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Mietbeginn</div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Calendar size={14} color="var(--text-secondary)" />
                                            {new Date(leaseData.start_date).toLocaleDateString('de-DE')}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>Mietende</div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Calendar size={14} color="var(--text-secondary)" />
                                            {leaseData.end_date ? new Date(leaseData.end_date).toLocaleDateString('de-DE') : 'Unbefristet'}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Mietkosten & Zahlungen</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                                        <div style={{ padding: '8px 10px', backgroundColor: 'var(--background-color)', borderRadius: '6px' }}>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Kaltmiete</div>
                                            <div style={{ fontWeight: 600, fontSize: '0.88rem', marginTop: '2px' }}>
                                                {(leaseData.cold_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                            </div>
                                        </div>
                                        <div style={{ padding: '8px 10px', backgroundColor: 'var(--background-color)', borderRadius: '6px' }}>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>Nebenkosten</div>
                                            <div style={{ fontWeight: 600, fontSize: '0.88rem', marginTop: '2px' }}>
                                                {((leaseData.service_charge || 0) + (leaseData.heating_cost || 0) + (leaseData.other_costs || 0)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                            </div>
                                        </div>
                                        <div style={{ padding: '8px 10px', backgroundColor: '#EFF6FF', borderRadius: '6px', border: '1px solid #BFDBFE' }}>
                                            <div style={{ fontSize: '0.68rem', color: '#1D4ED8' }}>Gesamtmiete</div>
                                            <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: '2px', color: '#1E40AF' }}>
                                                {((leaseData.cold_rent || 0) + (leaseData.service_charge || 0) + (leaseData.heating_cost || 0) + (leaseData.other_costs || 0)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Wallet size={12} />
                                        Miete fällig am <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{leaseData.payment_due_day}. Werktag</span> des Monats.
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Side: Security & Password setup */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    {/* Password Card */}
                    <div style={{
                        backgroundColor: 'var(--surface-color)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-color)',
                        padding: '24px',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        {/* Decorative background border for premium look */}
                        <div style={{ position: 'absolute', top: 0, right: 0, width: '4px', height: '100%', backgroundColor: isPasswordSet ? '#10B981' : '#F59E0B' }} />

                        <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', marginBottom: '18px' }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                <Lock size={18} color={isPasswordSet ? '#10B981' : '#F59E0B'} /> Login-Passwort
                            </h2>
                            <span style={{
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                backgroundColor: isPasswordSet ? '#D1FAE5' : '#FEF3C7',
                                color: isPasswordSet ? '#065F46' : '#92400E',
                                marginLeft: 'auto'
                            }}>
                                {isPasswordSet ? 'Eingerichtet' : 'Passwort fehlt'}
                            </span>
                        </div>

                        {!isPasswordSet && (
                            <div style={{
                                backgroundColor: '#FFFBEB',
                                border: '1px solid #FDE68A',
                                borderRadius: '8px',
                                padding: '12px 14px',
                                color: '#92400E',
                                fontSize: '0.82rem',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                marginBottom: '18px',
                                lineHeight: 1.4
                            }}>
                                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                                <div>
                                    <strong>Wichtiger Hinweis:</strong> Sie haben derzeit noch kein Passwort für Ihren Account eingerichtet. Um sich zukünftig regulär im Mieterportal anmelden zu können, richten Sie bitte jetzt ein Passwort ein.
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleUpdatePassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                    {isPasswordSet ? 'Neues Passwort' : 'Passwort festlegen'}
                                </label>
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <Key size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: '12px' }} />
                                    <input
                                        type="password"
                                        placeholder="Mindestens 6 Zeichen"
                                        value={passwordForm.password}
                                        onChange={e => setPasswordForm({ ...passwordForm, password: e.target.value })}
                                        style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.9rem', outline: 'none' }}
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>Passwort bestätigen</label>
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <Key size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: '12px' }} />
                                    <input
                                        type="password"
                                        placeholder="Passwort erneut eingeben"
                                        value={passwordForm.confirmPassword}
                                        onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                                        style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--background-color)', fontSize: '0.9rem', outline: 'none' }}
                                        required
                                    />
                                </div>
                            </div>

                            {passwordStatus.message && (
                                <div style={{
                                    padding: '10px 12px',
                                    borderRadius: '6px',
                                    fontSize: '0.8rem',
                                    backgroundColor: passwordStatus.type === 'success' ? '#F0FDF4' : '#FEF2F2',
                                    border: `1px solid ${passwordStatus.type === 'success' ? '#BBF7D0' : '#FCA5A5'}`,
                                    color: passwordStatus.type === 'success' ? '#166534' : '#991B1B',
                                    lineHeight: 1.4
                                }}>
                                    {passwordStatus.message}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    backgroundColor: isPasswordSet ? 'var(--primary-color)' : '#D97706',
                                    color: 'white',
                                    border: 'none',
                                    fontWeight: 600,
                                    fontSize: '0.88rem',
                                    cursor: saving ? 'not-allowed' : 'pointer',
                                    opacity: saving ? 0.7 : 1,
                                    transition: 'background-color 0.2s',
                                    marginTop: '4px'
                                }}
                            >
                                {saving ? 'Speichert...' : (isPasswordSet ? 'Passwort ändern' : 'Passwort aktivieren')}
                            </button>
                        </form>
                    </div>

                    {/* Security Checklist Info */}
                    <div style={{
                        backgroundColor: 'var(--surface-color)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-color)',
                        padding: '24px',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5
                    }}>
                        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ShieldCheck size={16} color="var(--primary-color)" /> Sicherheitshinweise
                        </h3>
                        <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <li>Verwenden Sie ein sicheres Passwort mit mindestens 6 Zeichen (idealerweise bestehend aus Groß-/Kleinschreibung, Zahlen und Sonderzeichen).</li>
                            <li>Geben Sie Ihre Zugangsdaten niemals an Dritte weiter.</li>
                            <li>Ihr Passwort wird verschlüsselt in unserem sicheren Datenzentrum (Supabase) gespeichert und ist für niemanden (auch nicht für Ihren Vermieter) einsehbar.</li>
                            <li>Nachdem Sie das Passwort eingerichtet haben, können Sie sich jederzeit regulär über die Anmeldeseite einloggen.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TenantStamdaten;
