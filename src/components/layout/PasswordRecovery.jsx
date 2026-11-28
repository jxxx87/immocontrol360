import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle } from 'lucide-react';
import AuthLayout from './AuthLayout';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ResetPassword from '../../pages/auth/ResetPassword';
import { supabase, readRecoveryFlag, writeRecoveryFlag, initialLinkError } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { translateError } from '../../lib/errorTranslator';

// Route /reset-password (und /update-password):
//   - nicht angemeldet            -> Formular "Link anfordern" (ResetPassword)
//   - über einen Reset-Link hier  -> Formular "Neues Passwort festlegen"
//   - sonst angemeldet            -> zur App
// Der Reset-Link erzeugt eine Sitzung; deshalb darf diese Route nicht hinter
// AuthRoute liegen (die sofort auf '/' umleitet).
// Die Erkennung des Reset-Links (URL-Hash, Ereignis PASSWORD_RECOVERY) läuft beim App-Start in
// lib/supabase.js – diese Seite wird nachgeladen und käme dafür zu spät.

const MIN_PASSWORD_LENGTH = 10;

const PasswordRecovery = () => {
    const { session } = useAuth();
    const navigate = useNavigate();
    const [recovery, setRecovery] = useState(readRecoveryFlag);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const handleRecovery = () => setRecovery(true);
        window.addEventListener('password-recovery', handleRecovery);
        return () => window.removeEventListener('password-recovery', handleRecovery);
    }, []);

    if (!session) {
        return (
            <>
                {initialLinkError && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
                        backgroundColor: '#FEF2F2', color: '#991B1B', borderBottom: '1px solid #FECACA',
                        padding: '10px 16px', fontSize: '0.875rem', textAlign: 'center'
                    }}>
                        Der Link zum Zurücksetzen ist abgelaufen oder ungültig. Bitte fordern Sie unten einen neuen Link an.
                    </div>
                )}
                <ResetPassword />
            </>
        );
    }

    if (!recovery && !done) {
        return <Navigate to="/" replace />;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
            return;
        }
        if (password !== confirmPassword) {
            setError('Die Passwörter stimmen nicht überein.');
            return;
        }
        try {
            setSaving(true);
            // password_set: Kennzeichen des Mieterportals („Passwort fehlt“), wird nur dort gelesen
            const { error: updateError } = await supabase.auth.updateUser({ password, data: { password_set: true } });
            if (updateError) throw updateError;
            writeRecoveryFlag(false);
            setDone(true);
        } catch (err) {
            setError('Das Passwort konnte nicht geändert werden: ' + translateError(err));
        } finally {
            setSaving(false);
        }
    };

    if (done) {
        return (
            <AuthLayout title="Passwort geändert">
                <div style={{
                    backgroundColor: '#D1FAE5', color: '#065F46', padding: '10px', borderRadius: 'var(--radius-md)',
                    marginBottom: 'var(--spacing-md)', display: 'flex', alignItems: 'center', fontSize: '0.875rem'
                }}>
                    <CheckCircle size={16} style={{ marginRight: '8px' }} />
                    Ihr neues Passwort ist gespeichert.
                </div>
                <Button style={{ width: '100%' }} onClick={() => navigate('/', { replace: true })}>
                    Weiter zur App
                </Button>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout title="Neues Passwort festlegen" subtitle="Bitte wählen Sie ein neues Passwort für Ihr Konto.">
            {error && (
                <div style={{
                    backgroundColor: 'var(--surface-color)', color: '#991B1B', padding: '10px', borderRadius: 'var(--radius-md)',
                    marginBottom: 'var(--spacing-md)', display: 'flex', alignItems: 'center', fontSize: '0.875rem'
                }}>
                    <AlertCircle size={16} style={{ marginRight: '8px' }} />
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit}>
                <Input
                    label="Neues Passwort"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                />
                <Input
                    label="Neues Passwort wiederholen"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                />
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '-4px' }}>
                    Mindestens {MIN_PASSWORD_LENGTH} Zeichen.
                </p>
                <Button type="submit" disabled={saving} style={{ width: '100%', marginTop: 'var(--spacing-sm)' }}>
                    {saving ? 'Speichert...' : 'Passwort speichern'}
                </Button>
            </form>
        </AuthLayout>
    );
};

export default PasswordRecovery;
