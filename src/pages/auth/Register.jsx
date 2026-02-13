import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { AlertCircle } from 'lucide-react';

const Register = () => {
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

        try {
            setError('');
            setLoading(true);
            const { error } = await signUp({ email, password });
            if (error) throw error;
            // Depending on Supabase settings, user might need to confirm email first
            alert('Registrierung erfolgreich! Bitte prüfen Sie Ihre E-Mails zur Bestätigung.');
            navigate('/login');
        } catch (error) {
            setError('Registrierung fehlgeschlagen: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout title="Konto erstellen" subtitle="Starten Sie mit ImmoControlpro360">
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
                    {loading ? 'Registriere...' : 'Registrieren'}
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
