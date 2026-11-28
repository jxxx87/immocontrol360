import React, { useState, useEffect, useCallback } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Mail, CheckCircle2, AlertTriangle, Loader2, Trash2 } from 'lucide-react';

// Das SMTP-Passwort wird nie in den Browser zurückgeladen: Es kann nur gesetzt
// bzw. geändert werden. Leeres Passwortfeld = gespeichertes Passwort bleibt.
// Die Datenbank legt ein mitgeschicktes Passwort verschlüsselt im Supabase Vault ab
// (Trigger auf user_smtp_settings); in der Tabelle selbst steht kein Passwort.
// Wechselt Server oder Benutzername, muss das Passwort neu eingegeben werden.
const EMAIL_PATTERN = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/;

const normalizeHost = (host) => (host || '').trim().toLowerCase();

const extractSenderAddress = (sender) => {
    const value = (sender || '').trim();
    const angle = value.match(/<([^<>]+)>\s*$/);
    return (angle ? angle[1] : value).trim();
};

export const EmailSettings = () => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [isTestModalOpen, setIsTestModalOpen] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);
    const [isConfiguredInDb, setIsConfiguredInDb] = useState(false);
    const [dbSender, setDbSender] = useState('');
    // Gespeicherter Server/Benutzer: Das gespeicherte Passwort gilt nur für genau diese Kombination
    const [storedLogin, setStoredLogin] = useState({ host: '', user: '' });

    const [form, setForm] = useState({
        smtp_host: '',
        smtp_port: '587',
        smtp_user: '',
        smtp_pass: '',
        smtp_sender: ''
    });

    const fetchSettings = useCallback(async () => {
        if (!user) return;
        try {
            setLoading(true);
            setLoadError('');
            // Bewusst ohne smtp_pass
            const { data, error } = await supabase
                .from('user_smtp_settings')
                .select('smtp_host, smtp_port, smtp_user, smtp_sender')
                .eq('user_id', user.id)
                .maybeSingle();

            if (error) throw error;
            if (data) {
                setForm({
                    smtp_host: data.smtp_host || '',
                    smtp_port: String(data.smtp_port || '587'),
                    smtp_user: data.smtp_user || '',
                    smtp_pass: '',
                    smtp_sender: data.smtp_sender || ''
                });
                setIsConfiguredInDb(!!data.smtp_host && !!data.smtp_user);
                setDbSender(data.smtp_sender || data.smtp_user || '');
                setStoredLogin({ host: normalizeHost(data.smtp_host), user: (data.smtp_user || '').trim() });
            } else {
                setIsConfiguredInDb(false);
                setDbSender('');
                setStoredLogin({ host: '', user: '' });
            }
        } catch (err) {
            console.error('Failed to load SMTP settings:', err);
            setLoadError('Die E-Mail-Einstellungen konnten nicht geladen werden. Speichern ist gesperrt, damit keine bestehende Einrichtung überschrieben wird. Bitte laden Sie die Seite neu.');
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    // Gespeichertes Passwort darf nicht für einen anderen Server/Benutzer verwendet werden
    const loginChanged = isConfiguredInDb && (
        normalizeHost(form.smtp_host) !== storedLogin.host || form.smtp_user.trim() !== storedLogin.user
    );
    const passwordRequired = !isConfiguredInDb || loginChanged;

    const validateForm = () => {
        if (!form.smtp_host.trim() || !form.smtp_port || !form.smtp_user.trim() || !form.smtp_sender.trim()) {
            return 'Bitte füllen Sie alle Pflichtfelder aus.';
        }
        if (passwordRequired && !form.smtp_pass) {
            return loginChanged
                ? 'Server oder Benutzername wurden geändert. Bitte geben Sie das Passwort des Postfachs erneut ein.'
                : 'Bitte geben Sie das Passwort des Postfachs ein.';
        }
        const port = Number(form.smtp_port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return 'Bitte einen gültigen SMTP-Port angeben (ganze Zahl von 1 bis 65535, üblich: 465 oder 587).';
        }
        if (!EMAIL_PATTERN.test(extractSenderAddress(form.smtp_sender))) {
            return 'Bitte beim Absender eine gültige E-Mail-Adresse angeben, z. B. „Max Mustermann <info@ihredomain.de>".';
        }
        return null;
    };

    const handleSave = async () => {
        if (loadError) {
            alert(loadError);
            return;
        }
        const validationError = validateForm();
        if (validationError) {
            alert(validationError);
            return;
        }

        try {
            setSaving(true);
            const payload = {
                smtp_host: form.smtp_host.trim(),
                smtp_port: Number(form.smtp_port),
                smtp_user: form.smtp_user.trim(),
                smtp_sender: form.smtp_sender.trim(),
                updated_at: new Date().toISOString()
            };
            // Passwort nur mitschicken, wenn es neu eingegeben wurde
            if (form.smtp_pass) payload.smtp_pass = form.smtp_pass;

            let error;
            if (isConfiguredInDb) {
                ({ error } = await supabase
                    .from('user_smtp_settings')
                    .update(payload)
                    .eq('user_id', user.id));
            } else {
                // Kein Upsert: ON CONFLICT … SET smtp_pass = EXCLUDED.smtp_pass bräuchte Leserecht auf
                // smtp_pass, das der Browser bewusst nicht mehr hat. Daher Insert, bei vorhandener Zeile Update.
                ({ error } = await supabase
                    .from('user_smtp_settings')
                    .insert({ ...payload, user_id: user.id }));
                if (error?.code === '23505') {
                    ({ error } = await supabase
                        .from('user_smtp_settings')
                        .update(payload)
                        .eq('user_id', user.id));
                }
            }

            if (error) throw error;
            setIsConfiguredInDb(true);
            setDbSender(payload.smtp_sender || payload.smtp_user);
            setStoredLogin({ host: normalizeHost(payload.smtp_host), user: payload.smtp_user });
            setForm(prev => ({ ...prev, smtp_pass: '' }));
            window.dispatchEvent(new Event('smtp-changed'));
            alert('E-Mail Server-Einstellungen erfolgreich gespeichert.');
        } catch (err) {
            alert('Fehler beim Speichern: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleUnlink = async () => {
        if (!window.confirm('Möchten Sie die E-Mail-Verbindung wirklich aufheben? Alle SMTP-Einstellungen werden unwiderruflich gelöscht.')) {
            return;
        }

        try {
            setSaving(true);
            const { error } = await supabase
                .from('user_smtp_settings')
                .delete()
                .eq('user_id', user.id);

            if (error) throw error;

            setForm({
                smtp_host: '',
                smtp_port: '587',
                smtp_user: '',
                smtp_pass: '',
                smtp_sender: ''
            });
            setIsConfiguredInDb(false);
            setDbSender('');
            setStoredLogin({ host: '', user: '' });

            window.dispatchEvent(new Event('smtp-changed'));
            alert('E-Mail-Verbindung erfolgreich aufgehoben.');
        } catch (err) {
            alert('Fehler beim Aufheben der Verbindung: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // Testmail geht immer an die eigene Konto-Adresse
    const testRecipient = user?.email || '';

    const handleTestConnection = async () => {
        const validationError = validateForm();
        if (validationError) {
            setStatusMessage({ type: 'error', text: validationError });
            return;
        }
        if (!testRecipient) {
            setStatusMessage({ type: 'error', text: 'Für Ihr Konto ist keine E-Mail-Adresse hinterlegt.' });
            return;
        }

        const usesStoredPassword = !form.smtp_pass;

        try {
            setTesting(true);
            setStatusMessage({ type: 'info', text: 'Verbindung wird getestet und Testmail gesendet...' });

            const settings = {
                smtp_host: form.smtp_host.trim(),
                smtp_port: String(Number(form.smtp_port)),
                smtp_user: form.smtp_user.trim(),
                smtp_sender: form.smtp_sender.trim()
            };
            if (!usesStoredPassword) settings.smtp_pass = form.smtp_pass;

            const { data, error } = await supabase.functions.invoke('send-letting-email', {
                body: {
                    action: 'test_connection',
                    settings,
                    // Ohne neu eingegebenes Passwort soll der Server das gespeicherte verwenden
                    use_stored_password: usesStoredPassword,
                    test_email: testRecipient
                }
            });

            if (error) throw error;

            if (data?.success) {
                setStatusMessage({
                    type: 'success',
                    text: `Erfolgreich! Die Verbindung zum Mailserver konnte hergestellt werden und die Test-E-Mail wurde an ${testRecipient} gesendet.`
                });
            } else {
                setStatusMessage({
                    type: 'error',
                    text: 'Verbindung fehlgeschlagen: ' + (data?.error || 'Unbekannter Fehler')
                        + (usesStoredPassword ? ' – Tipp: Geben Sie das Passwort im Formular erneut ein und testen Sie noch einmal.' : '')
                });
            }
        } catch (err) {
            setStatusMessage({
                type: 'error',
                text: 'Verbindungstest fehlgeschlagen: ' + err.message
                    + (usesStoredPassword ? ' – Tipp: Geben Sie das Passwort im Formular erneut ein und testen Sie noch einmal.' : '')
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
            <Card title="E-Mail-Einrichtung (SMTP)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                        Richten Sie hier Ihren eigenen E-Mail-Server (SMTP) ein. Nach der Einrichtung werden alle automatischen Benachrichtigungen, Bewerbungsbestätigungen, Terminbestätigungen und Mieter-Einladungen direkt von Ihrer E-Mail-Adresse aus versendet.
                    </p>

                    {loadError ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            backgroundColor: '#FEF2F2',
                            border: '1px solid #FECACA',
                            borderRadius: '8px',
                            color: '#991B1B'
                        }}>
                            <AlertTriangle size={20} />
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{loadError}</span>
                        </div>
                    ) : isConfiguredInDb ? (
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
                                E-Mail-Verbindung ist eingerichtet und aktiv. (Absender: {dbSender})
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
                            min="1"
                            max="65535"
                            step="1"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <Input
                            label="Benutzername / E-Mailadresse *"
                            value={form.smtp_user}
                            onChange={e => setForm({ ...form, smtp_user: e.target.value })}
                            placeholder="info@ihredomain.de"
                        />
                        <div>
                            <Input
                                label={passwordRequired
                                    ? (loginChanged ? 'Passwort * (Server/Benutzer geändert)' : 'Passwort *')
                                    : 'Passwort (nur zum Ändern ausfüllen)'}
                                value={form.smtp_pass}
                                onChange={e => setForm({ ...form, smtp_pass: e.target.value })}
                                type="password"
                                autoComplete="new-password"
                                placeholder={passwordRequired ? '••••••••' : 'Gespeichert – leer lassen, um es beizubehalten'}
                            />
                        </div>
                    </div>

                    <Input
                        label="Absendername und E-Mail (z.B. ImmoControl <info@ihredomain.de>) *"
                        value={form.smtp_sender}
                        onChange={e => setForm({ ...form, smtp_sender: e.target.value })}
                        placeholder="Max Mustermann <info@ihredomain.de>"
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setStatusMessage(null);
                                    setIsTestModalOpen(true);
                                }}
                                icon={Mail}
                                disabled={!!loadError}
                            >
                                Verbindung testen
                            </Button>
                            {isConfiguredInDb && (
                                <Button
                                    variant="danger"
                                    onClick={handleUnlink}
                                    disabled={saving}
                                    icon={Trash2}
                                >
                                    Verbindung trennen
                                </Button>
                            )}
                        </div>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !!loadError}
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
                            Mit den Angaben aus dem Formular wird eine Test-Nachricht an Ihre Konto-Adresse
                            <strong> {testRecipient || '–'}</strong> gesendet.
                            {!form.smtp_pass && !passwordRequired && ' Ohne neu eingegebenes Passwort wird das gespeicherte Passwort verwendet.'}
                            {!form.smtp_pass && loginChanged && ' Server oder Benutzername wurden geändert – bitte geben Sie das Passwort erneut ein.'}
                        </p>

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
