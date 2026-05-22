import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Trash2, Mail, Users } from 'lucide-react';

export const ActiveShares = ({ refreshTrigger }) => {
    const { user } = useAuth();
    const [shares, setShares] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchShares = async () => {
        if (!user) return;
        setLoading(true);
        try {
            // Fetch portfolio shares where the associated portfolio belongs to the user
            const { data, error } = await supabase
                .from('portfolio_shares')
                .select(`
                    id,
                    shared_with_email,
                    status,
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
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchShares();
    }, [user, refreshTrigger]);

    const handleRemoveShare = async (shareId) => {
        if (!window.confirm("Zugriff wirklich widerrufen?")) return;
        try {
            const { error } = await supabase.from('portfolio_shares').delete().eq('id', shareId);
            if (error) throw error;
            fetchShares();
        } catch (error) {
            console.error("Error removing share:", error);
        }
    };

    if (loading && shares.length === 0) return null;
    if (shares.length === 0) return null;

    return (
        <div style={{ marginTop: 'var(--spacing-xl)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                <Users size={20} style={{ color: 'var(--primary-color)' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Vergebene Freigaben</h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {shares.map(share => (
                    <div key={share.id} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '16px',
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', flexShrink: 0 }}>
                                <Mail size={20} />
                            </div>
                            <div>
                                <p style={{ margin: 0, fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-color)' }}>
                                    {share.shared_with_email}
                                </p>
                                <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    Portfolio: <strong>{share.portfolios?.name}</strong>
                                </p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            {share.status === 'accepted' 
                                ? <Badge variant="success">Akzeptiert</Badge> 
                                : <Badge variant="warning">Ausstehend</Badge>
                            }
                            <Button 
                                variant="ghost" 
                                icon={Trash2} 
                                style={{ color: 'var(--danger-color)' }}
                                onClick={() => handleRemoveShare(share.id)}
                            >
                                <span className="hidden-mobile">Entfernen</span>
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
