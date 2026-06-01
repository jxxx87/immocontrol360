import React, { useState, useEffect } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Mail, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

export const EmailSettings = () => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    const [isTestModalOpen, setIsTestModalOpen] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);

    const [form, setForm] = useState({
        smtp_host: '',
        smtp_port: '587',
        smtp_user: '',
        smtp_pass: '',
        smtp_sender: ''
    });

    useEffect(() => {
        if (user) {
            fetchSettings();
        }
    }, [user]);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('user_smtp_settings')
                .select('*')
                .eq('user_id', user.id)
                .maybeSingle();

            if (error) throw error;
            if (data) {
                setForm({
                    smtp_host: data.smtp_host || '',
                    smtp_port: String(data.smtp_port || '587'),
                    smtp_user: data.smtp_user || '',
                    smtp_pass: data.smtp_pass || '',
                    smtp_sender: data.smtp_sender || ''
                });
            }
        } catch (err) {
            console.error('Failed to load SMTP settings:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!form.smtp_host || !form.smtp_port || !form.smtp_user || !form.smtp_pass || !form.smtp_sender) {
            alert('Bitte füllen Sie alle Pflichtfelder aus.');
            return;
        }

        try {
            setSaving(true);
            const payload = {
                user_id: user.id,
                smtp_host: form.smtp_host,
                smtp_port: parseInt(form.smtp_port),
                smtp_user: form.smtp_user,
                smtp_pass: form.smtp_pass,
                smtp_sender: form.smtp_sender,
                updated_at: new Date().toISOString()
            };

            const { error } = await supabase
                .from('user_smtp_settings')
                .upsert(payload, { onConflict: 'user_id' });

            if (error) throw error;
            alert('E-Mail Server-Einstellungen erfolgreich gespeichert.');
        } catch (err) {
            alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        if (!testEmail) {
            alert('Bitte geben Sie eine Test-E-Mail-Adresse ein.');
            return;
        }

        try {
            setTesting(true);
            setStatusMessage({ type: 'info', text: 'Verbindung wird getestet und Testmail gesendet...' });

            const { data, error } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'test_connection',
                    settings: {
                        smtp_host: form.smtp_host,
                        smtp_port: form.smtp_port,
                        smtp_user: form.smtp_user,
                        smtp_pass: form.smtp_pass,
                        smtp_sender: form.smtp_sender
                    },
                    test_email: testEmail
                }
            });

            if (error) throw error;

            if (data?.success) {
                setStatusMessage({
                    type: 'success',
                    text: 'Erfolgreich! Die Verbindung zum Mailserver konnte hergestellt werden und die Test-E-Mail wurde gesendet.'
                });
            } else {
                setStatusMessage({
                    type: 'error',
                    text: 'Verbindung fehlgeschlagen: ' + (data?.error || 'Unbekannter Fehler')
                });
            }
        } catch (err) {
            setStatusMessage({
                type: 'error',
                text: 'Verbindungstest fehlgeschlagen: ' + err.message
            });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <Card title="E-Mail-Einrichtung">
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                    <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary-color)' }} />
                </div>
            </Card>
        );
    }

    const hasConfigured = form.smtp_host && form.smtp_user;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
            <Card title="E-Mail-Einrichtung (SMTP)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                        Richten Sie hier Ihren eigenen E-Mail-Server (SMTP) ein. Nach der Einrichtung werden alle automatischen Benachrichtigungen, Bewerbungsbestätigungen, Terminbestätigungen und Mieter-Einladungen direkt von Ihrer E-Mail-Adresse aus versendet.
                    </p>

                    {hasConfigured ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            backgroundColor: '#F0FDF4',
                            border: '1px solid #BBF7D0',
                            borderRadius: '8px',
                            color: '#166534'
                        }}>
                            <CheckCircle2 size={20} />
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                E-Mail-Verbindung ist eingerichtet und aktiv. (Absender: {form.smtp_sender})
                            </span>
                        </div>
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            backgroundColor: '#FFFBEB',
                            border: '1px solid #FDE68A',
                            borderRadius: '8px',
                            color: '#92400E'
                        }}>
                            <AlertTriangle size={20} />
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                Bislang ist keine E-Mail-Verbindung eingerichtet. E-Mails werden über die Plattform-Fallbacks versendet.
                            </span>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                        <Input
                            label="SMTP-Host (z.B. mail.ihredomain.de) *"
                            value={form.smtp_host}
                            onChange={e => setForm({ ...form, smtp_host: e.target.value })}
                            placeholder="smtp.example.com"
                        />
                        <Input
                            label="SMTP-Port *"
                            value={form.smtp_port}
                            onChange={e => setForm({ ...form, smtp_port: e.target.value })}
                            placeholder="587"
                            type="number"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <Input
                            label="Benutzername / E-Mailadresse *"
                            value={form.smtp_user}
                            onChange={e => setForm({ ...form, smtp_user: e.target.value })}
                            placeholder="info@ihredomain.de"
                        />
                        <Input
                            label="Passwort *"
                            value={form.smtp_pass}
                            onChange={e => setForm({ ...form, smtp_pass: e.target.value })}
                            type="password"
                            placeholder="••••••••"
                        />
                    </div>

                    <Input
                        label="Absendername und E-Mail (z.B. ImmoControl <info@ihredomain.de>) *"
                        value={form.smtp_sender}
                        onChange={e => setForm({ ...form, smtp_sender: e.target.value })}
                        placeholder="Max Mustermann <info@ihredomain.de>"
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                setStatusMessage(null);
                                setIsTestModalOpen(true);
                            }}
                            icon={Mail}
                        >
                            Verbindung testen
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? 'Speichert...' : 'Einstellungen speichern'}
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Test Connection Modal */}
            {isTestModalOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.6)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        width: '450px',
                        maxWidth: '90%',
                        padding: '24px',
                        boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'
                    }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 12px 0' }}>E-Mail-Verbindung testen</h3>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Geben Sie eine E-Mail-Adresse ein, an die eine Test-Nachricht geschickt werden soll.
                        </p>

                        <div style={{ marginBottom: '16px' }}>
                            <Input
                                label="Empfänger E-Mailadresse"
                                type="email"
                                value={testEmail}
                                onChange={e => setTestEmail(e.target.value)}
                                placeholder="ihre-testmail@domain.de"
                            />
                        </div>

                        {statusMessage && (
                            <div style={{
                                padding: '12px',
                                borderRadius: '6px',
                                fontSize: '0.875rem',
                                marginBottom: '16px',
                                backgroundColor: statusMessage.type === 'success' ? '#F0FDF4' : statusMessage.type === 'error' ? '#FEF2F2' : '#F0F9FF',
                                border: `1px solid ${statusMessage.type === 'success' ? '#BBF7D0' : statusMessage.type === 'error' ? '#FCA5A5' : '#B9E6FE'}`,
                                color: statusMessage.type === 'success' ? '#166534' : statusMessage.type === 'error' ? '#991B1B' : '#0369A1'
                            }}>
                                {statusMessage.text}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <Button variant="ghost" onClick={() => setIsTestModalOpen(false)}>Schließen</Button>
                            <Button onClick={handleTestConnection} disabled={testing}>
                                {testing ? (
                                    <>
                                        <Loader2 className="animate-spin" size={16} style={{ marginRight: '6px' }} />
                                        Testet...
                                    </>
                                ) : 'Senden & Testen'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
