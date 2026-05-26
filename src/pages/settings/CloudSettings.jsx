import React, { useState, useEffect } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Cloud, Check, Loader2, Trash2, Briefcase } from 'lucide-react';
import { translateError } from '../../lib/errorTranslator';

export const CloudSettings = ({ portfolios }) => {
    const { user } = useAuth();
    const [connections, setConnections] = useState([]);
    const [links, setLinks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            fetchCloudData();
        }
    }, [user]);

    const fetchCloudData = async () => {
        try {
            setLoading(true);
            const [connRes, linksRes] = await Promise.all([
                supabase.from('cloud_connections').select('*').order('created_at', { ascending: true }),
                supabase.from('portfolio_cloud_links').select('*')
            ]);
            
            if (connRes.error) throw connRes.error;
            if (linksRes.error) throw linksRes.error;

            setConnections(connRes.data || []);
            setLinks(linksRes.data || []);
        } catch (error) {
            console.error('Error fetching cloud settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleConnectOneDrive = () => {
        const clientId = import.meta.env.VITE_ONEDRIVE_CLIENT_ID;
        if (!clientId) return alert("Fehler: VITE_ONEDRIVE_CLIENT_ID ist in der .env Datei nicht konfiguriert.");
        
        const redirectUri = encodeURIComponent(`${window.location.origin}/settings/cloud/callback`);
        const scope = encodeURIComponent('offline_access Files.ReadWrite.All User.Read');
        const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=${scope}&prompt=select_account&state=onedrive`;
        
        window.location.href = url;
    };

    const handleConnectGoogleDrive = () => {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) return alert("Fehler: VITE_GOOGLE_CLIENT_ID ist in der .env Datei nicht konfiguriert.");
        
        const redirectUri = encodeURIComponent(`${window.location.origin}/settings/cloud/callback`);
        const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file email');
        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=googledrive`;
        
        window.location.href = url;
    };

    const handleDeleteConnection = async (id) => {
        if (!window.confirm("Möchten Sie diese Verbindung wirklich löschen?")) return;
        try {
            const { error } = await supabase.from('cloud_connections').delete().eq('id', id);
            if (error) throw error;
            await fetchCloudData();
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
        } catch (error) {
            alert(translateError(error));
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
            <Card title="Cloud-Verbindungen (OneDrive / Google Drive)" icon={Cloud}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Verbinde deine Cloud-Laufwerke, um Dokumente, Rechnungen und Mietverträge automatisch strukturiert in deiner Cloud abzuspeichern. 
                    Jeder Benutzer kann seine eigene Cloud hinterlegen. Später kannst du jedem Portfolio eine Cloud-Verbindung zuweisen.
                </p>

                {loading ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}><Loader2 className="spinner" /></div>
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
                                                <div style={{ fontWeight: 500 }}>{conn.account_email}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    {conn.provider === 'onedrive' ? 'Microsoft OneDrive' : 'Google Drive'}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <Badge variant="success" icon={Check}>Verbunden</Badge>
                                            <Button variant="danger" icon={Trash2} onClick={() => handleDeleteConnection(conn.id)} style={{ padding: '4px 8px' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Add new connection */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Neue Verbindung hinzufügen</h3>
                            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
                                <Button onClick={handleConnectOneDrive} style={{ backgroundColor: '#0078D4', color: 'white', border: 'none' }}>
                                    Mit Microsoft OneDrive verbinden
                                </Button>
                                <Button onClick={handleConnectGoogleDrive} style={{ backgroundColor: '#DB4437', color: 'white', border: 'none' }}>
                                    Mit Google Drive verbinden
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            <Card title="Portfolio-Zuweisung" icon={Briefcase}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Wähle aus, in welcher Cloud die Dokumente für das jeweilige Portfolio abgelegt werden sollen. 
                    Wenn ein Portfolio mit anderen geteilt ist, gelten diese Einstellungen nur für deinen Account.
                </p>

                {loading ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}><Loader2 className="spinner" /></div>
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
                                                            {conn.provider === 'onedrive' ? 'OneDrive' : 'Google Drive'} - {conn.account_email}
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
