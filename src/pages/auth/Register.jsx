import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { AlertCircle } from 'lucide-react';

const Register = () => {
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const plan = queryParams.get('plan');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { signUp } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            return setError('Passwörter stimmen nicht überein');
        }

        if (password.length < 6) {
            return setError('Passwort muss mindestens 6 Zeichen lang sein');
        }

        try {
            setError('');
            setLoading(true);

            if (plan) {
                // SPECIAL FLOW: User comes from "Abo Starten" -> Auto-Confirm + Trial
                // We use our Edge Function to handle everything in one go
                console.log('Starting trial registration for plan:', plan);

                const { data, error: fnError } = await supabase.functions.invoke('register-trial', {
                    body: { email, password, plan }
                });

                if (fnError) throw new Error(fnError.message || 'Verbindungsfehler');
                if (data && !data.success) throw new Error(data.error || 'Registrierung fehlgeschlagen');

                // Auto-Login immediately
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (signInError) throw signInError;

                // Redirect to Dashboard (Trial active!)
                navigate('/');
            } else {
                // STANDARD FLOW: Normal registration (requires email confirmation usually)
                const { error } = await signUp({ email, password });
                if (error) throw error;

                alert('Registrierung erfolgreich! Bitte prüfen Sie Ihre E-Mails zur Bestätigung.');
                navigate('/login');
            }

        } catch (error) {
            console.error(error);
            let msg = error.message;
            if (msg.includes('already registered')) msg = 'Diese E-Mail wird bereits verwendet.';
            setError('Registrierung fehlgeschlagen: ' + msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title={plan ? "10 Tage testen" : "Konto erstellen"}
            subtitle={plan ? `Registriere dich für den ${plan} Plan` : "Starten Sie mit ImmoControlpro360"}
        >
            {error && (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    color: '#991B1B',
                    padding: '10px',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 'var(--spacing-md)',
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '0.875rem'
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
                    placeholder="Min. 6 Zeichen"
                />
                <Input
                    label="Passwort bestätigen"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                />

                <Button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', marginBottom: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)' }}
                >
                    {loading ? 'Verarbeite...' : (plan ? 'Jetzt testen' : 'Registrieren')}
                </Button>
            </form>

            <div style={{ marginTop: 'var(--spacing-lg)', textAlign: 'center', fontSize: '0.875rem' }}>
                Bereits registriert?{' '}
                <Link to="/login" style={{ color: 'var(--primary-color)', fontWeight: 500 }}>
                    Hier anmelden
                </Link>
            </div>
        </AuthLayout>
    );
};

export default Register;
