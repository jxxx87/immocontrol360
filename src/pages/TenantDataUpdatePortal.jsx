import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
    User, MapPin, Phone, Mail, Building2,
    CheckCircle2, AlertCircle, Loader, Shield
} from 'lucide-react';

const TenantDataUpdatePortal = () => {
    const { token } = useParams();
    const [loading, setLoading] = useState(true);
    // Ladefehler ersetzen das Formular, Speicherfehler werden über dem Absende-Button angezeigt
    const [loadError, setLoadError] = useState(null);
    const [linkUsed, setLinkUsed] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [tenantData, setTenantData] = useState(null);
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        street: '',
        house_number: '',
        postal_code: '',
        city: '',
        phone: '',
        email: ''
    });
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        const fetchTenantData = async () => {
            setLoading(true);
            try {
                const { data, error: rpcError } = await supabase.rpc('get_tenant_by_token', { p_token: token });

                if (rpcError) throw rpcError;

                if (!data || data.error) {
                    setLinkUsed(!!data?.used);
                    setLoadError(data?.error || 'Link ist ungültig oder abgelaufen.');
                } else {
                    setTenantData(data);
                    setFormData({
                        first_name: data.first_name || '',
                        last_name: data.last_name || '',
                        street: data.street || '',
                        house_number: data.house_number || '',
                        postal_code: data.postal_code || '',
                        city: data.city || '',
                        phone: data.phone || '',
                        email: data.email || ''
                    });
                }
            } catch (err) {
                console.error('Error fetching tenant details:', err);
                setLoadError('Die Details konnten nicht geladen werden. Bitte wenden Sie sich an Ihren Vermieter.');
            } finally {
                setLoading(false);
            }
        };

        if (token) {
            fetchTenantData();
        }
    }, [token]);

    const handleInputChange = (field, val) => {
        setFormData(prev => ({ ...prev, [field]: val }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (saving) return;

        const trimmed = Object.fromEntries(
            Object.entries(formData).map(([key, val]) => [key, (val || '').trim()])
        );
        if (!trimmed.first_name || !trimmed.last_name) {
            setSaveError('Bitte geben Sie Vor- und Nachnamen an.');
            return;
        }

        setSaving(true);
        setSaveError(null);

        try {
            const { data, error: rpcError } = await supabase.rpc('update_tenant_by_token', {
                p_token: token,
                p_first_name: trimmed.first_name,
                p_last_name: trimmed.last_name,
                p_street: trimmed.street,
                p_house_number: trimmed.house_number,
                p_postal_code: trimmed.postal_code,
                p_city: trimmed.city,
                p_phone: trimmed.phone,
                p_email: trimmed.email.toLowerCase()
            });

            if (rpcError) throw rpcError;

            if (data?.used) {
                // Link wurde inzwischen verwendet: Formular durch Hinweis ersetzen
                setLinkUsed(true);
                setLoadError(data.error);
            } else if (data?.error) {
                setSaveError(data.error);
            } else {
                setSuccess(true);
            }
        } catch (err) {
            console.error('Error updating tenant details:', err);
            setSaveError('Speichern fehlgeschlagen. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                height: '100vh', width: '100vw', background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif'
            }}>
                <Loader size={48} className="animate-spin" color="var(--primary-color)" />
                <p style={{ marginTop: '16px', fontWeight: 500, fontSize: '1rem', color: '#64748b' }}>Daten werden geladen...</p>
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                minHeight: '100vh', width: '100vw', background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                padding: '20px', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif'
            }}>
                <div style={{
                    backgroundColor: '#fff', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                    padding: '40px', maxWidth: '480px', width: '100%', textAlign: 'center', border: '1px solid #f1f5f9'
                }}>
                    <div style={{
                        display: 'inline-flex', backgroundColor: '#fee2e2', color: '#ef4444',
                        padding: '16px', borderRadius: '50%', marginBottom: '20px'
                    }}>
                        <AlertCircle size={32} />
                    </div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', marginBottom: '12px' }}>
                        {linkUsed ? 'Link bereits verwendet' : 'Link ungültig oder abgelaufen'}
                    </h1>
                    <p style={{ color: '#64748b', lineHeight: 1.6, fontSize: '0.95rem', marginBottom: '28px' }}>
                        {loadError}
                    </p>
                    <div style={{
                        padding: '12px 16px', borderRadius: '12px', backgroundColor: '#f8fafc',
                        fontSize: '0.85rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center'
                    }}>
                        <Shield size={16} /> Verschlüsselte Verbindung (HTTPS)
                    </div>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                minHeight: '100vh', width: '100vw', background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                padding: '20px', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif'
            }}>
                <div style={{
                    backgroundColor: '#fff', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                    padding: '48px 40px', maxWidth: '480px', width: '100%', textAlign: 'center', border: '1px solid #f1f5f9',
                    animation: 'fadeIn 0.5s ease-out'
                }}>
                    <div style={{
                        display: 'inline-flex', backgroundColor: '#d1fae5', color: '#10b981',
                        padding: '20px', borderRadius: '50%', marginBottom: '24px',
                        boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.2)'
                    }}>
                        <CheckCircle2 size={40} />
                    </div>
                    <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1e293b', marginBottom: '12px' }}>Erfolgreich aktualisiert</h1>
                    <p style={{ color: '#64748b', lineHeight: 1.6, fontSize: '0.98rem', marginBottom: '32px' }}>
                        Vielen Dank! Ihre Kontaktdaten wurden an Ihren Vermieter übermittelt und in dessen Mieterverwaltung gespeichert.
                        Für weitere Änderungen wenden Sie sich bitte an Ihren Vermieter.
                    </p>
                    <div style={{
                        padding: '12px 16px', borderRadius: '12px', backgroundColor: '#f8fafc',
                        fontSize: '0.85rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center'
                    }}>
                        <Shield size={16} /> Die Daten wurden verschlüsselt übertragen (HTTPS)
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            minHeight: '100vh', width: '100vw', background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
            padding: '40px 20px', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif'
        }}>
            <div style={{
                backgroundColor: '#fff', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                maxWidth: '680px', width: '100%', border: '1px solid #f1f5f9', overflow: 'hidden'
            }}>
                {/* Header Banner */}
                <div style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    padding: '32px 40px', color: '#fff', position: 'relative'
                }}>
                    <div style={{
                        position: 'absolute', top: 0, right: 0, opacity: 0.1, pointerEvents: 'none'
                    }}>
                        <Building2 size={120} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.9 }}>
                        <Shield size={14} /> ImmoControlPro360 – Mieterdatenverifizierung
                    </div>
                    <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>Kontaktdaten aktualisieren</h1>
                    <p style={{ margin: '8px 0 0 0', opacity: 0.85, fontSize: '0.9rem', lineHeight: 1.5 }}>
                        Bitte überprüfen Sie Ihre im System hinterlegten Daten und aktualisieren Sie diese bei Bedarf.
                    </p>
                </div>

                {/* Main Form */}
                <form onSubmit={handleSubmit} style={{ padding: '40px' }}>
                    
                    {/* Unit Info Alert */}
                    <div style={{
                        display: 'flex', gap: '12px', padding: '16px', borderRadius: '16px',
                        backgroundColor: '#eff6ff', border: '1px solid #dbeafe', color: '#1e40af',
                        marginBottom: '28px', fontSize: '0.88rem', lineHeight: 1.5
                    }}>
                        <Building2 size={20} style={{ flexShrink: 0, color: '#3b82f6' }} />
                        <div>
                            <strong>Zugeordnete Wohnung/Einheit:</strong><br />
                            {tenantData?.unit_name}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        
                        {/* Section: Name */}
                        <div>
                            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <User size={16} /> Name
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Vorname</label>
                                    <input
                                        type="text"
                                        value={formData.first_name}
                                        onChange={(e) => handleInputChange('first_name', e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                            fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Nachname</label>
                                    <input
                                        type="text"
                                        value={formData.last_name}
                                        onChange={(e) => handleInputChange('last_name', e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                            fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section: Address */}
                        <div>
                            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <MapPin size={16} /> Anschrift / Kontaktadresse
                            </h3>
                            {tenantData?.address_from_property && (
                                <p style={{ fontSize: '0.82rem', color: '#92400e', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 12px', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                                    Bei Ihrem Vermieter ist noch keine eigene Anschrift hinterlegt. Vorgeschlagen ist die Anschrift Ihrer Mietwohnung – bitte prüfen und bei Bedarf korrigieren.
                                </p>
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Straße</label>
                                        <input
                                            type="text"
                                            value={formData.street}
                                            onChange={(e) => handleInputChange('street', e.target.value)}
                                            style={{
                                                width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                                fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Hausnr.</label>
                                        <input
                                            type="text"
                                            value={formData.house_number}
                                            onChange={(e) => handleInputChange('house_number', e.target.value)}
                                            style={{
                                                width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                                fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Postleitzahl</label>
                                        <input
                                            type="text"
                                            value={formData.postal_code}
                                            onChange={(e) => handleInputChange('postal_code', e.target.value)}
                                            style={{
                                                width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                                fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Ort</label>
                                        <input
                                            type="text"
                                            value={formData.city}
                                            onChange={(e) => handleInputChange('city', e.target.value)}
                                            style={{
                                                width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                                fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Section: Erreichbarkeit */}
                        <div>
                            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Phone size={16} /> Erreichbarkeit
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>Telefonnummer</label>
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => handleInputChange('phone', e.target.value)}
                                        style={{
                                            width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                            fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#475569', marginBottom: '6px', display: 'block' }}>E-Mail-Adresse</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => handleInputChange('email', e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #cbd5e1',
                                            fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Datenschutzhinweis */}
                    <p style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5, marginTop: '32px', marginBottom: 0 }}>
                        Ihre Angaben werden an Ihren Vermieter übermittelt und in dessen Mieterverwaltung (ImmoControlPro360)
                        gespeichert. Ihr Vermieter sieht dabei, welche Angaben Sie geändert haben (bisheriger und neuer Wert).
                        Der Link kann nur einmal verwendet werden. Informationen zur Verarbeitung Ihrer Daten erhalten Sie bei Ihrem Vermieter sowie in der{' '}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>Datenschutzerklärung</a>.
                    </p>

                    {saveError && (
                        <div role="alert" style={{
                            display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px', borderRadius: '12px',
                            backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                            marginTop: '20px', fontSize: '0.88rem', lineHeight: 1.5
                        }}>
                            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                            <span>{saveError}</span>
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={saving}
                        style={{
                            width: '100%', padding: '14px 20px', borderRadius: '14px', border: 'none',
                            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                            color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                            marginTop: '24px', boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.3)',
                            transition: 'all 0.2s'
                        }}
                    >
                        {saving ? (
                            <Loader size={20} className="animate-spin" />
                        ) : (
                            'Daten aktualisieren'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default TenantDataUpdatePortal;
