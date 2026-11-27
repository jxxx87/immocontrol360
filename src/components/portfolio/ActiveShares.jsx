import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Trash2, Mail, Users, Settings2, AlertTriangle } from 'lucide-react';
import { PortfolioShareModal } from './PortfolioShareModal';

const CATEGORY_LABELS = {
    immobilien: 'Immobilien',
    mietverhaeltnisse: 'Mietverhältnisse',
    finanzen: 'Finanzen',
    nebenkosten: 'Nebenkosten',
    zaehler: 'Zähler',
    kontakte: 'Kontakte',
    mieterportal: 'Mieterportal',
    investorportal: 'Investorportal'
};

const describePermissions = (permissions) => {
    const entries = Object.entries(permissions || {})
        .filter(([, value]) => value === 'read' || value === 'write')
        .map(([key, value]) => `${CATEGORY_LABELS[key] || key}: ${value === 'write' ? 'Schreiben' : 'Lesen'}`);
    return entries.length > 0 ? entries.join(' · ') : 'Keine Rechte (Person sieht nichts)';
};

export const ActiveShares = ({ refreshTrigger }) => {
    const { user } = useAuth();
    const [shares, setShares] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [editingShare, setEditingShare] = useState(null);

    const fetchShares = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setLoadError('');
        try {
            // Fetch portfolio shares where the associated portfolio belongs to the user
            const { data, error } = await supabase
                .from('portfolio_shares')
                .select(`
                    id,
                    portfolio_id,
                    shared_with_email,
                    status,
                    permissions,
                    created_at,
                    portfolios!inner (
                        name,
                        user_id
                    )
                `)
                .eq('portfolios.user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setShares(data || []);
        } catch (error) {
            console.error("Error fetching active shares:", error);
            setLoadError('Die vergebenen Freigaben konnten nicht geladen werden. Bitte laden Sie die Seite neu.');
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchShares();
    }, [fetchShares, refreshTrigger]);

    const handleRemoveShare = async (share) => {
        if (!window.confirm(`Zugriff von ${share.shared_with_email} auf "${share.portfolios?.name || 'Portfolio'}" wirklich widerrufen?`)) return;
        setActionError('');
        try {
            const { data, error } = await supabase
                .from('portfolio_shares')
                .delete()
                .eq('id', share.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('Die Freigabe wurde nicht gelöscht (keine Berechtigung oder bereits entfernt).');
            }
        } catch (error) {
            console.error("Error removing share:", error);
            setActionError('Der Zugriff konnte nicht widerrufen werden: ' + (error?.message || 'Unbekannter Fehler') + ' Die Freigabe besteht weiterhin.');
        } finally {
            fetchShares();
        }
    };

    if (loading && shares.length === 0 && !loadError) return null;
    if (shares.length === 0 && !loadError) return null;

    return (
        <div style={{ marginTop: 'var(--spacing-xl)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                <Users size={20} style={{ color: 'var(--primary-color)' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Vergebene Freigaben</h2>
            </div>

            {(loadError || actionError) && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', marginBottom: '12px',
                    borderRadius: '8px', fontSize: '0.85rem',
                    backgroundColor: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA'
                }}>
                    <AlertTriangle size={16} />
                    {loadError || actionError}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {shares.map(share => (
                    <div key={share.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '12px',
                        padding: '16px',
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', flexShrink: 0 }}>
                                <Mail size={20} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ margin: 0, fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-color)' }}>
                                    {share.shared_with_email}
                                </p>
                                <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    Portfolio: <strong>{share.portfolios?.name}</strong>
                                </p>
                                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    Rechte: {describePermissions(share.permissions)}
                                </p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {share.status === 'accepted'
                                ? <Badge variant="success">Akzeptiert</Badge>
                                : <Badge variant="warning">Ausstehend</Badge>
                            }
                            <Button
                                variant="ghost"
                                icon={Settings2}
                                onClick={() => setEditingShare(share)}
                            >
                                <span className="hidden-mobile">Rechte</span>
                            </Button>
                            <Button
                                variant="ghost"
                                icon={Trash2}
                                style={{ color: 'var(--danger-color)' }}
                                onClick={() => handleRemoveShare(share)}
                            >
                                <span className="hidden-mobile">Entfernen</span>
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            <PortfolioShareModal
                isOpen={!!editingShare}
                onClose={() => setEditingShare(null)}
                portfolioId={editingShare?.portfolio_id}
                existingShare={editingShare}
                onShareSuccess={fetchShares}
            />
        </div>
    );
};
