import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Mail, Check, X, BellDot } from 'lucide-react';

export const PendingInvitations = () => {
    const { user } = useAuth();
    const { refreshPortfolios } = usePortfolio();
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            fetchInvitations();
        }
    }, [user]);

    const fetchInvitations = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_pending_invitations');

            if (error) throw error;
            setInvitations(data || []);
        } catch (error) {
            console.error("Error fetching invitations:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async (shareId) => {
        try {
            const { data, error } = await supabase.rpc('accept_portfolio_share', { share_id: shareId });
            
            if (error) throw error;
            
            if (data) {
                alert('Einladung erfolgreich angenommen!');
                fetchInvitations();
                refreshPortfolios();
            }
        } catch (error) {
            console.error("Error accepting invitation:", error);
            alert("Fehler beim Annehmen der Einladung.");
        }
    };

    const handleDecline = async (shareId) => {
        if (!window.confirm('Einladung wirklich ablehnen?')) return;
        try {
            const { error } = await supabase.rpc('decline_portfolio_share', { share_id: shareId });
            
            if (error) throw error;
            
            fetchInvitations();
        } catch (error) {
            console.error("Error declining invitation:", error);
        }
    };

    if (loading || invitations.length === 0) return null;

    return (
        <div style={{ marginBottom: 'var(--spacing-xl)' }}>
            <Card style={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                    <div style={{ backgroundColor: '#DBEAFE', color: 'var(--primary-color)', padding: '8px', borderRadius: '8px' }}>
                        <BellDot size={22} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1E3A8A', margin: 0 }}>
                            Ausstehende Einladungen ({invitations.length})
                        </h3>
                        <p style={{ fontSize: '0.85rem', color: '#1E40AF', margin: '4px 0 0 0' }}>
                            Andere Nutzer haben Portfolios mit Ihnen geteilt.
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {invitations.map((invitation) => (
                        <div key={invitation.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '16px',
                            backgroundColor: 'white',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid #E0F2FE'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', flexShrink: 0 }}>
                                    <Mail size={20} />
                                </div>
                                <div>
                                    <p style={{ margin: 0, fontWeight: 500, fontSize: '0.95rem', color: 'var(--text-color)' }}>
                                        Portfolio: <strong>{invitation.portfolio_name || 'Unbekannt'}</strong>
                                    </p>
                                    <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        Eingeladen von: <strong>{invitation.sender_name || 'Unbekannt'}</strong>
                                    </p>
                                    <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Eingeladen am {new Date(invitation.created_at).toLocaleDateString('de-DE')}
                                    </p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Button 
                                    variant="primary" 
                                    icon={Check} 
                                    onClick={() => handleAccept(invitation.id)}
                                >
                                    Annehmen
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    icon={X} 
                                    style={{ color: 'var(--danger-color)' }}
                                    onClick={() => handleDecline(invitation.id)}
                                >
                                    Ablehnen
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
};
