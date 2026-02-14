import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../../components/layout/AuthLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../context/AuthContext';
import { AlertCircle, CheckCircle } from 'lucide-react';

const ResetPassword = () => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const { resetPassword } = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setMessage('');
            setError('');
            setLoading(true);
            const { error } = await resetPassword(email);
            if (error) throw error;
            setMessage('Anweisungen zum Zurücksetzen wurden gesendet.');
        } catch (error) {
            setError('Fehler: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout title="Passwort vergessen?" subtitle="Wir senden Ihnen einen Link zum Zurücksetzen">
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

            {message && (
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
                    <CheckCircle size={16} style={{ marginRight: '8px' }} />
                    {message}
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

                <Button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', marginBottom: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)' }}
                >
                    {loading ? 'Sende...' : 'Link senden'}
                </Button>
            </form>

            <div style={{ marginTop: 'var(--spacing-lg)', textAlign: 'center', fontSize: '0.875rem' }}>
                <Link to="/login" style={{ color: 'var(--primary-color)', fontWeight: 500 }}>
                    Zurück zum Login
                </Link>
            </div>
        </AuthLayout>
    );
};

export default ResetPassword;
