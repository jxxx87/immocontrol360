import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertCircle, Mail, CheckCircle2 } from 'lucide-react';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [magicLinkMode, setMagicLinkMode] = useState(false);
    const [magicLinkSent, setMagicLinkSent] = useState(false);
    const { signIn, signInWithGoogle } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setError('');
            setLoading(true);
            const { error } = await signIn({ email, password });
            if (error) throw error;
            navigate('/');
        } catch (error) {
            setError('Fehler beim Anmelden: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleMagicLink = async (e) => {
        e.preventDefault();
        if (!email) {
            setError('Bitte geben Sie Ihre E-Mail-Adresse ein.');
            return;
        }
        try {
            setError('');
            setLoading(true);
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: false // Only login, don't create new users
                }
            });
            if (error) throw error;
            setMagicLinkSent(true);
        } catch (error) {
            setError('Fehler: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        try {
            setError('');
            setLoading(true);
            const { error } = await signInWithGoogle();
            if (error) throw error;
        } catch (error) {
            setError('Google Login fehlgeschlagen: ' + error.message);
            setLoading(false);
        }
    };

    const GoogleIcon = () => (
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '8px' }}>
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
        </svg>
    );

    // ── Magic Link sent success screen ──
    if (magicLinkSent) {
        return (
            <AuthLayout title="E-Mail gesendet!" subtitle="Prüfen Sie Ihren Posteingang">
                <div style={{
                    textAlign: 'center', padding: '20px 0'
                }}>
                    <CheckCircle2 size={48} color="#10B981" style={{ marginBottom: '16px' }} />
                    <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.6 }}>
                        Wir haben einen Login-Link an <strong>{email}</strong> gesendet.
                        Klicken Sie auf den Link in der E-Mail, um sich anzumelden.
                    </p>
                    <Button
                        variant="secondary"
                        onClick={() => { setMagicLinkSent(false); setMagicLinkMode(false); }}
                        style={{ width: '100%' }}
                    >
                        Zurück zum Login
                    </Button>
                </div>
            </AuthLayout>
        );
    }

    // ── Magic Link mode ──
    if (magicLinkMode) {
        return (
            <AuthLayout title="Login per E-Mail-Link" subtitle="Kein Passwort nötig — wir senden Ihnen einen Link">
                {error && (
                    <div style={{
                        backgroundColor: 'var(--surface-color)', color: '#991B1B', padding: '10px',
                        borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)',
                        display: 'flex', alignItems: 'center', fontSize: '0.875rem'
                    }}>
                        <AlertCircle size={16} style={{ marginRight: '8px' }} />
                        {error}
                    </div>
                )}

                <form onSubmit={handleMagicLink}>
                    <Input
                        label="E-Mail"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />

                    <Button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: '100%', marginTop: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                        }}
                    >
                        <Mail size={16} />
                        {loading ? 'Sende...' : 'Login-Link senden'}
                    </Button>
                </form>

                <div style={{ textAlign: 'center', fontSize: '0.875rem' }}>
                    <button
                        onClick={() => { setMagicLinkMode(false); setError(''); }}
                        style={{
                            color: 'var(--primary-color)', fontWeight: 500, cursor: 'pointer',
                            background: 'none', border: 'none', fontSize: 'inherit'
                        }}
                    >
                        Mit Passwort anmelden
                    </button>
                </div>
            </AuthLayout>
        );
    }

    // ── Normal login ──
    return (
        <AuthLayout title="Willkommen zurück" subtitle="Melden Sie sich an, um fortzufahren">
            {error && (
                <div style={{
                    backgroundColor: 'var(--surface-color)', color: '#991B1B', padding: '10px',
                    borderRadius: 'var(--radius-md)', marginBottom: 'var(--spacing-md)',
                    display: 'flex', alignItems: 'center', fontSize: '0.875rem'
                }}>
                    <AlertCircle size={16} style={{ marginRight: '8px' }} />
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <Input
                    label="E-Mail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <Input
                    label="Passwort"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />

                <div style={{ textAlign: 'right', marginBottom: 'var(--spacing-lg)' }}>
                    <Link to="/reset-password" style={{ fontSize: '0.875rem', color: 'var(--primary-color)' }}>
                        Passwort vergessen?
                    </Link>
                </div>

                <Button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', marginBottom: 'var(--spacing-md)' }}
                >
                    {loading ? 'Lade...' : 'Anmelden'}
                </Button>
            </form>

            <div style={{ position: 'relative', margin: 'var(--spacing-lg) 0', textAlign: 'center' }}>
                <div style={{ borderBottom: '1px solid var(--border-color)', position: 'absolute', top: '50%', width: '100%' }}></div>
                <span style={{
                    position: 'relative', backgroundColor: 'var(--surface-color)',
                    padding: '0 10px', color: 'var(--text-secondary)', fontSize: '0.875rem'
                }}>
                    oder
                </span>
            </div>

            <Button
                variant="secondary"
                onClick={handleGoogleLogin}
                disabled={loading}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--spacing-sm)' }}
            >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <GoogleIcon />
                    Mit Google anmelden
                </div>
            </Button>

            <Button
                variant="secondary"
                onClick={() => setMagicLinkMode(true)}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    marginTop: '8px', color: 'var(--primary-color)'
                }}
            >
                <Mail size={16} />
                Als Mieter per E-Mail-Link anmelden
            </Button>

            <div style={{ marginTop: 'var(--spacing-lg)', textAlign: 'center', fontSize: '0.875rem' }}>
                Noch kein Konto?{' '}
                <Link to="/register" style={{ color: 'var(--primary-color)', fontWeight: 500 }}>
                    Jetzt registrieren
                </Link>
            </div>
        </AuthLayout>
    );
};

export default Login;
