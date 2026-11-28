import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import Messenger from '../../components/Messenger';
import { MessageSquare } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';

// Neue Datenbank-Funktion noch nicht eingespielt? (PostgREST: PGRST202 / HTTP 404)
const isMissingRpc = (error, status) =>
    !!error && (error.code === 'PGRST202' || error.code === '42883' || status === 404);

const TenantMessages = () => {
    const { user, roleData } = useAuth();
    const { clearByType } = useNotifications();
    const { isMobile } = useViewMode();
    const [investorUserId, setInvestorUserId] = useState(null);
    const [investorName, setInvestorName] = useState('Hausverwaltung');
    const [loading, setLoading] = useState(true);

    // Clear message notifications when opening messages page
    useEffect(() => {
        clearByType('message');
        clearByType('ticket_comment');
    }, [clearByType]);

    const userId = user?.id;
    const propertyId = roleData?.property_id;

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;

        // Vermieter deterministisch aus dem eigenen Objekt ableiten (Eigentümer des Objekts –
        // derselbe Nutzer, dem der Mieter in "Nachrichten" des Vermieters angezeigt wird).
        // Früher: irgendein Konto mit Rolle 'investor' (limit 1) – falscher Empfänger.
        const findLandlord = async () => {
            try {
                let landlordId = null;

                // Nur die Vermieter-ID über die Datenbank-Funktion (keine ganze Objektzeile)
                const { data: info, error: infoError, status: infoStatus } = await supabase.rpc('get_my_landlord_info');
                if (!infoError) {
                    landlordId = info?.landlord_user_id || null;
                } else if (isMissingRpc(infoError, infoStatus)) {
                    // Bisheriger Weg (Funktion noch nicht eingespielt)
                    if (propertyId) {
                        const { data: property, error: propError } = await supabase
                            .from('properties')
                            .select('user_id')
                            .eq('id', propertyId)
                            .maybeSingle();
                        if (propError) console.error('Error loading property owner:', propError);
                        if (property?.user_id) landlordId = property.user_id;
                    }
                } else {
                    console.error('Error loading landlord:', infoError);
                }

                if (!landlordId) {
                    // Fallback: Gesprächspartner der jüngsten Nachricht
                    const { data: msgs, error: msgError } = await supabase
                        .from('messages')
                        .select('sender_id, receiver_id')
                        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
                        .order('created_at', { ascending: false })
                        .limit(1);
                    if (msgError) console.error('Error loading messages:', msgError);

                    if (msgs && msgs.length > 0) {
                        landlordId = msgs[0].sender_id === userId ? msgs[0].receiver_id : msgs[0].sender_id;
                    }
                }

                if (!cancelled && landlordId && landlordId !== userId) {
                    setInvestorUserId(landlordId);
                    setInvestorName('Hausverwaltung');
                }
            } catch (err) {
                console.error('Error finding landlord:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        findLandlord();
        return () => { cancelled = true; };
    }, [userId, propertyId]);

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
        <div style={{ height: isMobile ? 'calc(100vh - var(--topbar-height) - 60px - env(safe-area-inset-bottom, 0px) - env(safe-area-inset-top, 0px))' : 'calc(100vh - var(--topbar-height) - 4rem)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '16px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nachrichten</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Direkter Chat mit Ihrer Hausverwaltung
                </p>
            </div>
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'var(--surface-color)',
                borderRadius: isMobile ? 0 : 'var(--radius-lg)',
                border: isMobile ? 'none' : '1px solid var(--border-color)',
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
