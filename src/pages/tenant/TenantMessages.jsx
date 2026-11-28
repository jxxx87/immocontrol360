import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import Messenger from '../../components/Messenger';
import { MessageSquare } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';

const TenantMessages = () => {
    const { user, roleData } = useAuth();
    const { clearByType } = useNotifications();
    const { isMobile } = useViewMode();
    // Gesprächspartner: Vermieter zuerst, dazu Mitnutzer/Mitarbeiter, die dem Mieter direkt geschrieben haben
    const [partners, setPartners] = useState([]); // [{ id, label, unread }]
    const [selectedPartnerId, setSelectedPartnerId] = useState(null);
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

                // Nur die Vermieter-ID über die Datenbank-Funktion (keine ganze Objektzeile;
                // Mieter lesen properties/units nicht direkt)
                const { data: info, error: infoError } = await supabase.rpc('get_my_landlord_info');
                if (infoError) {
                    console.error('Error loading landlord:', infoError);
                } else {
                    landlordId = info?.landlord_user_id || null;
                }

                if (landlordId === userId) landlordId = null;

                // Weitere Gesprächspartner aus den eigenen direkten Nachrichten (ohne Ticket-Nachrichten,
                // die stehen im Ticket). Sonst bleiben Nachrichten eines Mitnutzers des Vermieters
                // (eigenes Konto als Absender) unsichtbar und unbeantwortbar.
                const { data: msgs, error: msgError } = await supabase
                    .from('messages')
                    .select('sender_id, receiver_id, ticket_id, read, created_at')
                    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
                    .order('created_at', { ascending: false })
                    .limit(1000);
                if (msgError) console.error('Error loading messages:', msgError);

                // Neueste zuerst: Einfügereihenfolge der Map = jüngstes Gespräch zuerst
                const stats = new Map(); // partnerId -> { unread, lastUnreadAt }
                let latestAnyPartner = null;
                for (const m of msgs || []) {
                    const other = m.sender_id === userId ? m.receiver_id : m.sender_id;
                    if (!other || other === userId) continue;
                    if (!latestAnyPartner) latestAnyPartner = other;
                    if (m.ticket_id) continue;
                    const s = stats.get(other) || { unread: 0, lastUnreadAt: null };
                    if (m.receiver_id === userId && !m.read) {
                        s.unread += 1;
                        if (!s.lastUnreadAt) s.lastUnreadAt = m.created_at;
                    }
                    stats.set(other, s);
                }

                // Wie bisher: ohne Vermieter und ohne direktes Gespräch der Partner der jüngsten Nachricht
                if (!landlordId && stats.size === 0 && latestAnyPartner) {
                    stats.set(latestAnyPartner, { unread: 0, lastUnreadAt: null });
                }

                const ids = [];
                if (landlordId) ids.push(landlordId);
                for (const id of stats.keys()) {
                    if (!ids.includes(id)) ids.push(id);
                }
                const primaryId = ids[0] || null;
                const otherCount = ids.length - 1;
                let otherNo = 0;
                const list = ids.map(id => {
                    let label = 'Hausverwaltung';
                    if (id !== primaryId) {
                        otherNo += 1;
                        label = otherCount > 1 ? `Hausverwaltung (Mitarbeiter ${otherNo})` : 'Hausverwaltung (Mitarbeiter)';
                    }
                    return { id, label, unread: stats.get(id)?.unread || 0 };
                });

                // Vorauswahl: Gespräch mit der jüngsten ungelesenen Nachricht, sonst der Vermieter
                let initialId = primaryId;
                let newestUnread = null;
                for (const [id, s] of stats.entries()) {
                    if (s.lastUnreadAt && (!newestUnread || s.lastUnreadAt > newestUnread)) {
                        newestUnread = s.lastUnreadAt;
                        initialId = id;
                    }
                }

                if (!cancelled) {
                    // Das vorausgewählte Gespräch markiert der Chat beim Öffnen als gelesen (wie selectPartner)
                    setPartners(list.map(p => (p.id === initialId ? { ...p, unread: 0 } : p)));
                    setSelectedPartnerId(initialId);
                }
            } catch (err) {
                console.error('Error finding landlord:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        findLandlord();
        return () => { cancelled = true; };
        // propertyId: neu ermitteln, wenn sich die Mieterrolle ändert (die Funktion liest sie serverseitig)
    }, [userId, propertyId]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    const selectedPartner = partners.find(p => p.id === selectedPartnerId) || null;

    const selectPartner = (id) => {
        setSelectedPartnerId(id);
        // Der Chat markiert die Nachrichten beim Öffnen als gelesen
        setPartners(prev => prev.map(p => (p.id === id ? { ...p, unread: 0 } : p)));
    };

    if (!selectedPartner) {
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
            {/* Mehrere Gesprächspartner (z. B. Mitarbeiter der Hausverwaltung): Auswahl über dem Chat */}
            {partners.length > 1 && (
                <div role="tablist" aria-label="Gesprächspartner" style={{
                    display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px'
                }}>
                    {partners.map(p => {
                        const active = p.id === selectedPartnerId;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => selectPartner(p.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '6px 14px', borderRadius: 'var(--radius-md)',
                                    border: `1px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                    backgroundColor: 'var(--surface-color)',
                                    color: active ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    fontSize: '0.85rem', fontWeight: active ? 600 : 400, cursor: 'pointer'
                                }}
                            >
                                {p.label}
                                {p.unread > 0 && (
                                    <span style={{
                                        backgroundColor: 'var(--primary-color)', color: 'white',
                                        borderRadius: '10px', padding: '1px 7px', fontSize: '0.7rem', fontWeight: 600
                                    }}>{p.unread}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
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
                    key={selectedPartner.id}
                    conversationUserId={selectedPartner.id}
                    conversationUserName={selectedPartner.label}
                />
            </div>
        </div>
    );
};

export default TenantMessages;
