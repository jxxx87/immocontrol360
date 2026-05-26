import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export const CloudCallback = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [status, setStatus] = useState('Verbinde mit Cloud-Provider...');
    const [error, setError] = useState(null);

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const code = queryParams.get('code');
        const state = queryParams.get('state'); // we pass provider as state for simplicity
        
        if (!code || !state) {
            setError('Fehlende oder ungültige Rückgabe vom Cloud-Anbieter.');
            return;
        }

        const exchangeCode = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw new Error('Nicht autorisiert. Bitte einloggen.');

                const redirectUri = `${window.location.origin}/settings/cloud/callback`;

                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const res = await fetch(`${supabaseUrl}/functions/v1/cloud-auth`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        provider: state,
                        code,
                        redirectUri
                    })
                });

                const result = await res.json();
                if (!res.ok) throw new Error(result.error || 'Fehler bei der Verbindung');

                setStatus(`Erfolgreich mit ${result.email} verbunden!`);
                setTimeout(() => {
                    navigate('/settings', { state: { activeTab: 'cloud' } });
                }, 2000);
            } catch (err) {
                console.error(err);
                setError(err.message);
            }
        };

        exchangeCode();
    }, [location, navigate]);

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-color)' }}>
            <div style={{ padding: '40px', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', textAlign: 'center', maxWidth: '400px' }}>
                {error ? (
                    <>
                        <XCircle size={48} color="var(--danger-color)" style={{ margin: '0 auto 20px' }} />
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '10px' }}>Verbindung fehlgeschlagen</h2>
                        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
                        <button onClick={() => navigate('/settings', { state: { activeTab: 'cloud' } })} style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                            Zurück zu Einstellungen
                        </button>
                    </>
                ) : (
                    <>
                        {status.includes('Erfolgreich') ? (
                            <CheckCircle size={48} color="var(--success-color)" style={{ margin: '0 auto 20px' }} />
                        ) : (
                            <Loader2 size={48} color="var(--primary-color)" className="spinner" style={{ margin: '0 auto 20px' }} />
                        )}
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '10px' }}>{status}</h2>
                        {!status.includes('Erfolgreich') && (
                            <p style={{ color: 'var(--text-secondary)' }}>Bitte haben Sie einen Moment Geduld.</p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
