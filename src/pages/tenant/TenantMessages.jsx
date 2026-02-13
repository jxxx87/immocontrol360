import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import Messenger from '../../components/Messenger';
import { MessageSquare } from 'lucide-react';

const TenantMessages = () => {
    const { user, roleData } = useAuth();
    const [investorUserId, setInvestorUserId] = useState(null);
    const [investorName, setInvestorName] = useState('Hausverwaltung');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const findInvestor = async () => {
            // Find the investor user (role = 'investor')
            // In a simple setup, there's typically one investor
            try {
                const { data, error } = await supabase
                    .from('user_roles')
                    .select('user_id')
                    .eq('role', 'investor')
                    .limit(1);

                if (data && data.length > 0) {
                    setInvestorUserId(data[0].user_id);
                    setInvestorName('Hausverwaltung');
                } else {
                    // Fallback: check if there are any messages to/from this user
                    // and use the other participant
                    const { data: msgs } = await supabase
                        .from('messages')
                        .select('sender_id, receiver_id')
                        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
                        .limit(1);

                    if (msgs && msgs.length > 0) {
                        const otherId = msgs[0].sender_id === user.id ? msgs[0].receiver_id : msgs[0].sender_id;
                        setInvestorUserId(otherId);
                    }
                }
            } catch (err) {
                console.error('Error finding investor:', err);
            } finally {
                setLoading(false);
            }
        };

        if (user) findInvestor();
    }, [user]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    if (!investorUserId) {
        return (
            <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '16px' }}>Nachrichten</h1>
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '60px 40px', textAlign: 'center'
                }}>
                    <MessageSquare size={48} color="var(--border-color)" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                        Der Messenger ist noch nicht verfügbar. Ihr Verwalter wird bald erreichbar sein.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ height: 'calc(100vh - var(--topbar-height) - 4rem)' }}>
            <div style={{ marginBottom: '16px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nachrichten</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Direkter Chat mit Ihrer Hausverwaltung
                </p>
            </div>
            <div style={{
                height: 'calc(100% - 70px)',
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden'
            }}>
                <Messenger
                    conversationUserId={investorUserId}
                    conversationUserName={investorName}
                />
            </div>
        </div>
    );
};

export default TenantMessages;
