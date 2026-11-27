import React, { useState, useEffect } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Cloud, Check, Loader2, Trash2, Briefcase, AlertTriangle } from 'lucide-react';
import { translateError } from '../../lib/errorTranslator';

// Zustand des laufenden OAuth-Vorgangs (state, PKCE, Rücksprung-Adresse) – wird von CloudCallback geprüft
const OAUTH_STORAGE_KEY = 'immo_cloud_oauth';

// Scopes, falls die Edge Function cloud-auth noch die ältere Version ist (kein 'config').
// OneDrive muss dann beim alten Scope bleiben, weil die alte Function ihn beim Token-Tausch anfragt.
const FALLBACK_SCOPES = {
    onedrive: 'offline_access Files.ReadWrite.All User.Read',
    googledrive: 'https://www.googleapis.com/auth/drive.file email',
};

const MICROSOFT_REVOKE_HINT = 'Microsoft bietet keinen automatischen Widerruf. Um ImmoControl360 den Zugriff auf Ihr OneDrive vollständig zu entziehen, entfernen Sie die App in Ihrem Microsoft-Konto unter den App-Berechtigungen (privates Konto: account.live.com/consent/Manage, Arbeits- oder Schulkonto: myapps.microsoft.com).';
const GOOGLE_REVOKE_HINT = 'Die Berechtigung bei Google konnte nicht automatisch widerrufen werden. Sie können ImmoControl360 den Zugriff unter myaccount.google.com/permissions entziehen.';

// Rücksprung-Adresse für OAuth – wird nur hier gebildet und im Sitzungsspeicher an den Callback übergeben
const getCloudRedirectUri = () => `${window.location.origin}/settings/cloud/callback`;

const base64Url = (bytes) => {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const randomToken = (byteLength = 32) => {
    const bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
};

// PKCE-Paar (RFC 7636, S256); null, wenn der Browser kein WebCrypto bietet
const createPkcePair = async () => {
    if (!window.crypto?.subtle) return null;
    const verifier = randomToken(32);
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: base64Url(new Uint8Array(digest)) };
};

// Konfiguration der Edge Function (Scopes, PKCE). Ältere Function-Versionen kennen 'config' nicht.
const loadOAuthConfig = async () => {
    try {
        const { data, error } = await supabase.functions.invoke('cloud-auth', { body: { action: 'config' } });
        if (!error && data && data.version >= 2 && data.scopes) return data;
    } catch {
        // ältere Function-Version oder Netzwerkfehler -> Rückfallwerte
    }
    return null;
};

const buildQuery = (params) => Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

export const CloudSettings = ({ portfolios }) => {
    const { user } = useAuth();
    const [connections, setConnections] = useState([]);
    const [links, setLinks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [connecting, setConnecting] = useState(null);

    useEffect(() => {
        if (user) {
            fetchCloudData();
        }
    }, [user]);

    const fetchCloudData = async () => {
        try {
            setLoading(true);
            setLoadError(null);
            // Nur die benötigten Spalten – Tokens werden nie in den Browser geladen
            const [connRes, linksRes] = await Promise.all([
                supabase.from('cloud_connections').select('id, provider, account_email, created_at').order('created_at', { ascending: true }),
                supabase.from('portfolio_cloud_links').select('id, portfolio_id, cloud_connection_id')
            ]);

            if (connRes.error) throw connRes.error;
            if (linksRes.error) throw linksRes.error;

            setConnections(connRes.data || []);
            setLinks(linksRes.data || []);
        } catch (error) {
            console.error('Error fetching cloud settings:', error);
            setLoadError(translateError(error));
        } finally {
            setLoading(false);
        }
    };

    const startOAuth = async (provider) => {
        const isOneDrive = provider === 'onedrive';
        const clientId = isOneDrive ? import.meta.env.VITE_ONEDRIVE_CLIENT_ID : import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) {
            alert(`Fehler: ${isOneDrive ? 'VITE_ONEDRIVE_CLIENT_ID' : 'VITE_GOOGLE_CLIENT_ID'} ist in der .env Datei nicht konfiguriert.`);
            return;
        }
        if (connecting) return;
        setConnecting(provider);

        try {
            const config = await loadOAuthConfig();
            const scope = config?.scopes?.[provider] || FALLBACK_SCOPES[provider];
            // PKCE nur, wenn die Edge Function den code_verifier weiterreicht (neue Version)
            const pkce = config?.pkce ? await createPkcePair() : null;
            const state = randomToken(32);
            const redirectUri = getCloudRedirectUri();

            try {
                sessionStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify({
                    state,
                    provider,
                    redirectUri,
                    scope,
                    codeVerifier: pkce?.verifier || null,
                    createdAt: Date.now()
                }));
            } catch {
                alert('Die Verbindung kann nicht gestartet werden, weil der Browser keinen Sitzungsspeicher zulässt.');
                setConnecting(null);
                return;
            }

            const pkceParams = pkce ? { code_challenge: pkce.challenge, code_challenge_method: 'S256' } : {};
            const url = isOneDrive
                ? `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${buildQuery({
                    client_id: clientId,
                    response_type: 'code',
                    redirect_uri: redirectUri,
                    response_mode: 'query',
                    scope,
                    prompt: 'select_account',
                    state,
                    ...pkceParams
                })}`
                : `https://accounts.google.com/o/oauth2/v2/auth?${buildQuery({
                    client_id: clientId,
                    redirect_uri: redirectUri,
                    response_type: 'code',
                    scope,
                    access_type: 'offline',
                    prompt: 'consent',
                    state,
                    ...pkceParams
                })}`;

            window.location.href = url;
        } catch (error) {
            console.error('Error starting cloud connection:', error);
            alert('Die Verbindung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.');
            setConnecting(null);
        }
    };

    const handleConnectOneDrive = () => startOAuth('onedrive');
    const handleConnectGoogleDrive = () => startOAuth('googledrive');

    const handleDeleteConnection = async (conn) => {
        if (!window.confirm("Möchten Sie diese Verbindung wirklich löschen? Portfolios, denen diese Cloud zugewiesen ist, verlieren ihre Zuweisung.")) return;
        try {
            // Neue Function-Version: löscht die Verbindung und widerruft (Google) die Berechtigung beim Anbieter
            let result = null;
            try {
                const { data, error } = await supabase.functions.invoke('cloud-auth', {
                    body: { action: 'disconnect', connectionId: conn.id }
                });
                if (!error && data?.success) result = data;
            } catch {
                result = null;
            }

            if (!result) {
                // Ältere Function-Version: Verbindung direkt löschen (ohne Widerruf beim Anbieter)
                const { error } = await supabase.from('cloud_connections').delete().eq('id', conn.id);
                if (error) throw error;
            }

            await fetchCloudData();
            window.dispatchEvent(new Event('cloud-changed'));

            if (!result?.revoked) {
                const hint = conn.provider === 'onedrive' ? MICROSOFT_REVOKE_HINT : GOOGLE_REVOKE_HINT;
                alert(`Die Verbindung wurde entfernt.\n\nHinweis: ${hint}`);
            }
        } catch (error) {
            alert(translateError(error));
        }
    };

    const handleLinkPortfolio = async (portfolioId, connectionId) => {
        try {
            // First check if there is an existing link for this portfolio and user
            const existingLink = links.find(l => l.portfolio_id === portfolioId);

            if (connectionId === '') {
                // Remove link
                if (existingLink) {
                    const { error } = await supabase.from('portfolio_cloud_links').delete().eq('id', existingLink.id);
                    if (error) throw error;
                }
            } else {
                // Upsert link
                const payload = {
                    user_id: user.id,
                    portfolio_id: portfolioId,
                    cloud_connection_id: connectionId
                };

                if (existingLink) {
                    const { error } = await supabase.from('portfolio_cloud_links').update({ cloud_connection_id: connectionId }).eq('id', existingLink.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase.from('portfolio_cloud_links').insert(payload);
                    if (error) throw error;
                }
            }

            await fetchCloudData();
            window.dispatchEvent(new Event('cloud-changed'));
        } catch (error) {
            alert(translateError(error));
        }
    };

    const loadErrorBox = loadError && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '12px 16px', marginBottom: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} />
                <span>Die Cloud-Einstellungen konnten nicht geladen werden: {loadError}</span>
            </div>
            <Button variant="secondary" onClick={fetchCloudData} style={{ padding: '4px 12px' }}>Erneut laden</Button>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
            <Card title="Cloud-Verbindungen (OneDrive / Google Drive)" icon={Cloud}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Verbinde deine Cloud-Laufwerke, um Dokumente, Rechnungen und Mietverträge automatisch strukturiert in deiner Cloud abzuspeichern.
                    Jeder Benutzer kann seine eigene Cloud hinterlegen. Später kannst du jedem Portfolio eine Cloud-Verbindung zuweisen.
                </p>

                {loadErrorBox}

                {loading ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}><Loader2 className="animate-spin" /></div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* List of current connections */}
                        {connections.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Ihre verbundenen Accounts</h3>
                                {connections.map(conn => (
                                    <div key={conn.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <Cloud size={20} color="var(--primary-color)" />
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{conn.account_email || 'Unbekanntes Konto'}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    {conn.provider === 'onedrive' ? 'Microsoft OneDrive' : 'Google Drive'}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <Badge variant="success" icon={Check}>Verbunden</Badge>
                                            <Button variant="danger" icon={Trash2} onClick={() => handleDeleteConnection(conn)} style={{ padding: '4px 8px' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add new connection */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Neue Verbindung hinzufügen</h3>
                            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
                                <Button onClick={handleConnectOneDrive} disabled={!!connecting} style={{ backgroundColor: '#0078D4', color: 'white', border: 'none' }}>
                                    {connecting === 'onedrive' ? 'Weiterleitung...' : 'Mit Microsoft OneDrive verbinden'}
                                </Button>
                                <Button onClick={handleConnectGoogleDrive} disabled={!!connecting} style={{ backgroundColor: '#DB4437', color: 'white', border: 'none' }}>
                                    {connecting === 'googledrive' ? 'Weiterleitung...' : 'Mit Google Drive verbinden'}
                                </Button>
                            </div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '6px' }}>
                                Google Drive: ImmoControl360 erhält bei neuen Verbindungen nur Zugriff auf die Ordner und Dateien, die über die App angelegt bzw. hochgeladen werden.
                                Dateien, die Sie direkt in Google Drive in diese Ordner legen, sind im Cloud Explorer dann nicht sichtbar.
                            </p>
                        </div>
                    </div>
                )}
            </Card>

            <Card title="Portfolio-Zuweisung" icon={Briefcase}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Wähle aus, in welcher Cloud die Dokumente für das jeweilige Portfolio abgelegt werden sollen.
                    Wenn ein Portfolio mit anderen geteilt ist, gelten diese Einstellungen nur für deinen Account.
                    Ohne Zuweisung wird nur dann automatisch eine Cloud verwendet, wenn du genau eine Verbindung hast.
                </p>

                {loading ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}><Loader2 className="animate-spin" /></div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                    <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem', width: '40%' }}>PORTFOLIO</th>
                                    <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>ZIEL-CLOUD</th>
                                </tr>
                            </thead>
                            <tbody>
                                {portfolios.map(p => {
                                    const currentLink = links.find(l => l.portfolio_id === p.id);
                                    return (
                                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '12px 16px', fontWeight: 500 }}>
                                                {p.name}
                                                {p.owner_id !== user?.id && (
                                                    <Badge variant="secondary" style={{ marginLeft: '10px' }}>Geteilt</Badge>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <select
                                                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'transparent' }}
                                                    value={currentLink?.cloud_connection_id || ''}
                                                    onChange={(e) => handleLinkPortfolio(p.id, e.target.value)}
                                                >
                                                    <option value="">Keine Cloud zugewiesen</option>
                                                    {connections.map(conn => (
                                                        <option key={conn.id} value={conn.id}>
                                                            {conn.provider === 'onedrive' ? 'OneDrive' : 'Google Drive'} - {conn.account_email || 'Unbekanntes Konto'}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {portfolios.length === 0 && (
                                    <tr>
                                        <td colSpan={2} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                            Keine Portfolios vorhanden.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
};
