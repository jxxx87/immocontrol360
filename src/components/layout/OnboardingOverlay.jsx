import React, { useState, useEffect } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { User, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { translateError } from '../../lib/errorTranslator';

const OnboardingOverlay = ({ onComplete }) => {
    const { user } = useAuth();
    const { refreshPortfolios } = usePortfolio();
    const [loading, setLoading] = useState(false);
    const [profileData, setProfileData] = useState({
        salutation: 'Herr',
        name_suffix: '',
        company: '',
        first_name: '',
        last_name: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        phone: '',
        mobile: '',
        bank_name: '',
        iban: '',
        bic: '',
        tax_number: '',
        vat_id: '',
        portfolio_name: '',
        ownership_percent: '',
    });

    // Load existing profile data if any
    useEffect(() => {
        const loadProfile = async () => {
            if (!user) return;
            try {
                const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
                if (data) {
                    setProfileData(prev => ({
                        ...prev,
                        salutation: data.salutation || 'Herr',
                        name_suffix: data.name_suffix || '',
                        company: data.company || '',
                        first_name: data.first_name || '',
                        last_name: data.last_name || '',
                        street: data.street || '',
                        house_number: data.house_number || '',
                        zip: data.zip || '',
                        city: data.city || '',
                        phone: data.phone || '',
                        mobile: data.mobile || '',
                        bank_name: data.bank_name || '',
                        iban: data.iban || '',
                        bic: data.bic || '',
                        tax_number: data.tax_number || '',
                        vat_id: data.vat_id || '',
                        portfolio_name: data.portfolio_name || '',
                        ownership_percent: data.ownership_percent || '',
                    }));
                }
            } catch (e) {
                console.log('No profile yet:', e.message);
            }
        };
        loadProfile();
    }, [user]);

    const handleSave = async () => {
        // Validate required fields
        const required = [
            { key: 'first_name', label: 'Vorname' },
            { key: 'last_name', label: 'Nachname' },
            { key: 'street', label: 'Straße' },
            { key: 'house_number', label: 'Hausnummer' },
            { key: 'zip', label: 'PLZ' },
            { key: 'city', label: 'Stadt' },
            { key: 'portfolio_name', label: 'Bezeichnung Portfolio' },
            { key: 'ownership_percent', label: 'Eigentumsanteil' },
        ];
        const missing = required.filter(f => !profileData[f.key]?.toString().trim());
        if (missing.length > 0) {
            alert(`Bitte füllen Sie folgende Pflichtfelder aus: ${missing.map(f => f.label).join(', ')}`);
            return;
        }

        try {
            setLoading(true);

            // Save profile
            const { error } = await supabase.from('profiles').upsert({
                id: user.id,
                updated_at: new Date(),
                ...profileData,
                onboarding_complete: true
            });
            if (error) throw error;

            // Create primary portfolio
            const { data: existing } = await supabase
                .from('portfolios')
                .select('id')
                .eq('user_id', user.id)
                .eq('is_primary', true)
                .maybeSingle();

            const portfolioPayload = {
                user_id: user.id,
                name: profileData.portfolio_name || `${profileData.first_name} ${profileData.last_name}`,
                company_name: profileData.company || '',
                street: profileData.street,
                house_number: profileData.house_number,
                zip: profileData.zip,
                city: profileData.city,
                bank_name: profileData.bank_name || '',
                iban: profileData.iban || '',
                bic: profileData.bic || '',
                tax_number: profileData.tax_number || '',
                vat_id: profileData.vat_id || '',
                ownership_percent: parseFloat(profileData.ownership_percent) || null,
                is_primary: true,
            };

            if (existing) {
                const { error: upErr } = await supabase.from('portfolios').update(portfolioPayload).eq('id', existing.id);
                if (upErr) throw upErr;
            } else {
                const { error: inErr } = await supabase.from('portfolios').insert([portfolioPayload]);
                if (inErr) throw inErr;
            }

            if (refreshPortfolios) refreshPortfolios();
            onComplete();
        } catch (error) {
            alert(translateError(error));
        } finally {
            setLoading(false);
        }
    };

    const f = (key, val) => setProfileData(prev => ({ ...prev, [key]: val }));

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: 'var(--background-color)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            overflowY: 'auto',
            padding: '40px 16px',
        }}>
            <div style={{ width: '100%', maxWidth: '640px' }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <img src="/logo.svg" alt="ImmoControl Pro 360" style={{ maxHeight: '60px', marginBottom: '16px' }} />
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>Willkommen bei ImmoControl Pro 360</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                        Bitte füllen Sie zunächst Ihre Stammdaten aus, um fortzufahren.
                    </p>
                </div>

                <Card title="Stammdaten bearbeiten">
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        {/* Anrede & Zusatz */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Anrede</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)' }}
                                    value={profileData.salutation}
                                    onChange={e => f('salutation', e.target.value)}
                                >
                                    <option value="Herr">Herr</option>
                                    <option value="Frau">Frau</option>
                                    <option value="Familie">Familie</option>
                                    <option value="Firma">Firma</option>
                                </select>
                            </div>
                            <Input label="Zusatz" value={profileData.name_suffix} onChange={e => f('name_suffix', e.target.value)} />
                        </div>

                        <Input label="Firma" value={profileData.company} onChange={e => f('company', e.target.value)} />

                        {/* Name */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Vorname *" value={profileData.first_name} onChange={e => f('first_name', e.target.value)} required />
                            <Input label="Nachname *" value={profileData.last_name} onChange={e => f('last_name', e.target.value)} required />
                        </div>

                        {/* Adresse */}
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Straße *" value={profileData.street} onChange={e => f('street', e.target.value)} required />
                            <Input label="Hausnummer *" value={profileData.house_number} onChange={e => f('house_number', e.target.value)} required />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                            <Input label="PLZ *" value={profileData.zip} onChange={e => f('zip', e.target.value)} required />
                            <Input label="Stadt *" value={profileData.city} onChange={e => f('city', e.target.value)} required />
                        </div>

                        {/* Kontakt */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Telefon" value={profileData.phone} onChange={e => f('phone', e.target.value)} />
                            <Input label="Handynummer" value={profileData.mobile} onChange={e => f('mobile', e.target.value)} />
                        </div>

                        {/* Portfolio */}
                        <div style={{ borderTop: '1px solid var(--border-color)', margin: 'var(--spacing-sm) 0' }}></div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Portfolio</h3>

                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Bezeichnung Portfolio *" placeholder="z.B. Mein Portfolio" value={profileData.portfolio_name} onChange={e => f('portfolio_name', e.target.value)} required />
                            <Input label="Eigentumsanteil (%) *" type="number" placeholder="100" value={profileData.ownership_percent} onChange={e => f('ownership_percent', e.target.value)} required />
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-8px' }}>
                            Ihr Hauptportfolio wird automatisch aus Ihren Stammdaten erstellt.
                        </p>

                        {/* Bank */}
                        <div style={{ borderTop: '1px solid var(--border-color)', margin: 'var(--spacing-sm) 0' }}></div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Bankverbindung & Steuer</h3>

                        <Input label="Bank" value={profileData.bank_name} onChange={e => f('bank_name', e.target.value)} />

                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="IBAN" value={profileData.iban} onChange={e => f('iban', e.target.value)} />
                            <Input label="BIC" value={profileData.bic} onChange={e => f('bic', e.target.value)} />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="USt-IdNr." value={profileData.vat_id} onChange={e => f('vat_id', e.target.value)} />
                            <Input label="Steuernummer" value={profileData.tax_number} onChange={e => f('tax_number', e.target.value)} />
                        </div>

                        {/* Submit */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-lg)' }}>
                            <Button onClick={handleSave} disabled={loading} style={{ minWidth: '180px' }}>
                                {loading ? <><Loader2 size={16} className="animate-spin" style={{ marginRight: '8px' }} /> Speichern...</> : 'Übernehmen'}
                            </Button>
                        </div>
                    </div>
                </Card>

                <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '24px' }}>
                    Pflichtfelder sind mit * gekennzeichnet.
                </p>
            </div>
        </div>
    );
};

export default OnboardingOverlay;
