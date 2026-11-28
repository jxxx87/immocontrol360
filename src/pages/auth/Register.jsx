import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { translateError } from '../../lib/errorTranslator';
import { AlertCircle, CheckCircle } from 'lucide-react';

// Wie in Einstellungen, Passwort zurücksetzen und register-trial
const MIN_PASSWORD_LENGTH = 10;

// Erlaubte Tarife für die Testphase (wie in register-trial)
const TRIAL_PLANS = {
    starter: 'Starter',
    professional: 'Professional',
    business: 'Business',
};

// Zahlweise von der Website (/abo-starten → ?cycle=…); PaywallModal belegt damit den Umschalter vor
const PREFERRED_CYCLE_KEY = 'preferredBillingCycle';

// Bestehende Adresse (Supabase-Code oder ältere Meldung): neutral antworten – verrät nicht, ob es ein Konto gibt
const isExistingAccountError = (err) =>
    err?.code === 'user_already_exists' || err?.code === 'email_exists'
    || /already (been )?registered/i.test(err?.message || '');
const NEUTRAL_SIGNUP_MESSAGE = 'Die Registrierung mit diesen Daten ist nicht möglich. Falls Sie bereits ein Konto haben, melden Sie sich bitte über „Hier anmelden" an oder setzen Sie dort Ihr Passwort zurück.';

const Register = () => {
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const rawPlan = queryParams.get('plan');
    // Unbekannte Tarif-Werte aus der URL → Standard der Marketing-Seite ('professional')
    const plan = rawPlan
        ? (TRIAL_PLANS[rawPlan.trim().toLowerCase()] ? rawPlan.trim().toLowerCase() : 'professional')
        : null;
    const rawCycle = (queryParams.get('cycle') || '').trim().toLowerCase();
    const cycle = rawCycle === 'monthly' || rawCycle === 'yearly' ? rawCycle : null;

    useEffect(() => {
        if (!cycle) return;
        try { localStorage.setItem(PREFERRED_CYCLE_KEY, cycle); } catch { /* Speicher nicht verfügbar */ }
    }, [cycle]);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [loading, setLoading] = useState(false);
    const { signUp } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            return setError('Passwörter stimmen nicht überein');
        }

        if (password.length < MIN_PASSWORD_LENGTH) {
            return setError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
        }

        try {
            setError('');
            setInfo('');
            setLoading(true);

            if (plan) {
                // SPECIAL FLOW: User comes from "Abo Starten" -> Konto + Testphase in einem Schritt
                const normalizedEmail = email.trim().toLowerCase();

                const { data, error: fnError } = await supabase.functions.invoke('register-trial', {
                    body: { email: normalizedEmail, password, plan }
                });

                if (fnError) throw fnError;
                if (data && !data.success) throw new Error(data.error || 'Registrierung fehlgeschlagen');

                if (data?.confirmation_required) {
                    // Double-Opt-In aktiv: erst nach Klick auf den Bestätigungslink anmelden
                    setInfo('Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben. Danach kannst du dich anmelden.');
                    return;
                }

                // Auto-Login immediately
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password,
                });

                if (signInError) {
                    const m = (signInError.message || '').toLowerCase();
                    if (m.includes('not confirmed')) {
                        setInfo('Bitte bestätige zuerst deine E-Mail-Adresse über den Link in deinem Postfach. Danach kannst du dich anmelden.');
                        return;
                    }
                    if (m.includes('invalid login credentials')) {
                        // Neutral formuliert: verrät nicht, ob die Adresse bereits registriert ist
                        throw new Error('Die Anmeldung mit diesen Zugangsdaten ist nicht möglich. Falls du bereits ein Konto hast, melde dich bitte über „Hier anmelden" an.');
                    }
                    throw signInError;
                }

                // Redirect to Dashboard (Trial active!)
                navigate('/');
            } else {
                // STANDARD FLOW: Normal registration
                const { data, error } = await signUp({ email: email.trim().toLowerCase(), password });
                if (error) throw error;

                if (data?.session) {
                    // E-Mail-Bestätigung ist aus: Supabase meldet direkt an
                    navigate('/');
                    return;
                }
                // Bestätigung nötig (bei bestehender Adresse liefert Supabase dieselbe Antwort ohne Fehler)
                setInfo('Registrierung fast abgeschlossen: Bitte bestätigen Sie Ihre E-Mail-Adresse über den Link, den wir Ihnen geschickt haben. Danach können Sie sich anmelden.');
            }

        } catch (error) {
            console.error(error);
            // Deutsche Meldungen (register-trial, eigene Texte) bleiben, englische Supabase-Texte werden übersetzt
            setError(isExistingAccountError(error)
                ? NEUTRAL_SIGNUP_MESSAGE
                : translateError(error));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title={plan ? "10 Tage testen" : "Konto erstellen"}
            subtitle={plan ? `Registriere dich für den ${TRIAL_PLANS[plan]} Plan` : "Starten Sie mit ImmoControlpro360"}
        >
            {info && (
                <div style={{
                    backgroundColor: '#D1FAE5',
                    color: '#065F46',
                    padding: '10px',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 'var(--spacing-md)',
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '0.875rem'
                }}>
                    <CheckCircle size={16} style={{ marginRight: '8px', flexShrink: 0 }} />
                    {info}
                </div>
            )}

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
                    placeholder={`Min. ${MIN_PASSWORD_LENGTH} Zeichen`}
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
