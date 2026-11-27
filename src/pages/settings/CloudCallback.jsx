import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

// Von CloudSettings beim Start des Vorgangs abgelegt (state, Anbieter, Rücksprung-Adresse, PKCE)
const OAUTH_STORAGE_KEY = 'immo_cloud_oauth';
const OAUTH_MAX_AGE_MS = 15 * 60 * 1000;
const PROVIDERS = ['onedrive', 'googledrive'];

const readStoredOAuthState = () => {
    try {
        const raw = sessionStorage.getItem(OAUTH_STORAGE_KEY);
        // Nur einmal verwendbar
        sessionStorage.removeItem(OAUTH_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const readFunctionError = async (error) => {
    const ctx = error?.context;
    if (ctx && typeof ctx.clone === 'function') {
        try {
            const body = await ctx.clone().json();
            if (body?.error) return body.error;
        } catch {
            // Antwort ohne JSON
        }
    }
    return error?.message || String(error);
};

export const CloudCallback = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [status, setStatus] = useState('Verbinde mit Cloud-Provider...');
    const [error, setError] = useState(null);
    const startedRef = useRef(false);

    useEffect(() => {
        // Der Code ist nur einmal einlösbar (auch bei doppelt ausgeführten Effekten)
        if (startedRef.current) return;
        startedRef.current = true;

        const queryParams = new URLSearchParams(location.search);
        const code = queryParams.get('code');
        const returnedState = queryParams.get('state');
        const providerError = queryParams.get('error');
        const stored = readStoredOAuthState();

        if (providerError) {
            const safeCode = /^[a-z_]{1,64}$/.test(providerError) ? ` (${providerError})` : '';
            setError(`Die Verbindung wurde beim Cloud-Anbieter abgebrochen oder abgelehnt${safeCode}.`);
            return;
        }

        if (!code || !returnedState) {
            setError('Fehlende oder ungültige Rückgabe vom Cloud-Anbieter.');
            return;
        }

        // Schutz gegen untergeschobene Rückgaben (Login-CSRF): state muss zum gestarteten Vorgang passen
        const stateValid = !!stored
            && typeof stored.state === 'string'
            && stored.state.length >= 32
            && stored.state === returnedState
            && PROVIDERS.includes(stored.provider)
            && typeof stored.createdAt === 'number'
            && Date.now() - stored.createdAt < OAUTH_MAX_AGE_MS;

        if (!stateValid) {
            setError('Die Sicherheitsprüfung der Rückgabe ist fehlgeschlagen oder der Vorgang ist abgelaufen. Bitte starten Sie die Verbindung erneut in den Cloud-Einstellungen.');
            return;
        }

        const exchangeCode = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw new Error('Nicht autorisiert. Bitte einloggen.');

                const redirectUri = stored.redirectUri || `${window.location.origin}/settings/cloud/callback`;

                // Das Nutzer-JWT schickt supabase.functions.invoke automatisch mit
                const { data, error: fnError } = await supabase.functions.invoke('cloud-auth', {
                    body: {
                        action: 'exchange',
                        provider: stored.provider,
                        code,
                        redirectUri,
                        scope: stored.scope || undefined,
                        codeVerifier: stored.codeVerifier || undefined
                    }
                });

                if (fnError) throw new Error(await readFunctionError(fnError));
                if (!data?.success) throw new Error(data?.error || 'Fehler bei der Verbindung');

                window.dispatchEvent(new Event('cloud-changed'));
                setStatus(data.email ? `Erfolgreich mit ${data.email} verbunden!` : 'Erfolgreich verbunden!');
                setTimeout(() => {
                    navigate('/settings', { state: { activeTab: 'cloud' } });
                }, 2000);
            } catch (err) {
                console.error(err);
                setError(err.message || String(err));
            }
        };

        exchangeCode();
    }, [location, navigate]);

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--background-color)' }}>
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
                            <Loader2 size={48} color="var(--primary-color)" className="animate-spin" style={{ margin: '0 auto 20px' }} />
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
