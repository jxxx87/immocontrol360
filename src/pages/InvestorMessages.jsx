import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { translateError } from '../lib/errorTranslator';
import Messenger from '../components/Messenger';
import { MessageSquare, Users, Circle, Search } from 'lucide-react';
import { useViewMode } from '../context/ViewModeContext';
import { usePortfolio } from '../context/PortfolioContext';
import { usePermission } from '../context/PermissionContext';

// Wie viele der jüngsten eigenen Nachrichten für "letzte Nachricht"/"ungelesen" in
// EINER Abfrage geladen werden. Nur für Gespräche ohne Treffer wird einzeln nachgefragt.
const RECENT_MESSAGES_LIMIT = 1000;

// Datenbank-Funktion noch nicht eingespielt? (PostgREST: PGRST202 / HTTP 404)
const isMissingRpc = (error, status) =>
    !!error && (error.code === 'PGRST202' || error.code === '42883' || status === 404);

const tenantName = (t) => (t && (t.first_name || t.last_name))
    ? `${t.last_name || ''}, ${t.first_name || ''}`
    : 'Unbekannt';

const unitLabel = (street, houseNumber, unitName) =>
    unitName ? `${street || ''} ${houseNumber || ''} / ${unitName}` : '';

// Gesprächspartner = Mieter-Konten in Objekten, für die ich Recht „Mieterportal“ habe.
// Über die Datenbank-Funktion get_message_partners (liefert auch Portfolio und Schreibrecht).
// Fehlt sie noch, direkt aus user_roles (dort sieht man Mieter nur mit Recht „Mietverhältnisse“);
// das Schreibrecht wird dann aus den Freigaben berechnet (canWrite: null).
const loadMessagePartners = async (userId) => {
    const { data, error, status } = await supabase.rpc('get_message_partners');
    if (!error) {
        return (data || []).map(r => ({
            userId: r.user_id,
            portfolioId: r.portfolio_id || null,
            name: tenantName(r),
            unit: unitLabel(r.street, r.house_number, r.unit_name),
            canWrite: r.can_write === true
        }));
    }
    if (!isMissingRpc(error, status)) throw error;

    const { data: tenantRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, tenant_id, unit_id, property_id')
        .eq('role', 'tenant');
    if (rolesError) throw rolesError;

    const roles = (tenantRoles || []).filter(r => r.user_id !== userId);
    if (roles.length === 0) return [];

    const tenantIds = roles.map(r => r.tenant_id).filter(Boolean);
    const unitIds = roles.map(r => r.unit_id).filter(Boolean);

    const [tenantRes, unitRes] = await Promise.all([
        tenantIds.length > 0
            ? supabase.from('tenants').select('id, first_name, last_name').in('id', tenantIds)
            : Promise.resolve({ data: [], error: null }),
        unitIds.length > 0
            ? supabase.from('units').select('id, unit_name, property:properties(street, house_number, portfolio_id)').in('id', unitIds)
            : Promise.resolve({ data: [], error: null })
    ]);
    if (tenantRes.error) throw tenantRes.error;
    if (unitRes.error) throw unitRes.error;

    const tenantData = tenantRes.data || [];
    const unitData = unitRes.data || [];

    return roles.map((role) => {
        const tenant = tenantData.find(t => t.id === role.tenant_id);
        const unit = unitData.find(u => u.id === role.unit_id);
        return {
            userId: role.user_id,
            portfolioId: unit?.property?.portfolio_id || null,
            name: tenantName(tenant),
            unit: unit ? unitLabel(unit.property?.street, unit.property?.house_number, unit.unit_name) : '',
            canWrite: null
        };
    });
};

const InvestorMessages = () => {
    const { user } = useAuth();
    const { clearByType } = useNotifications();
    const { isMobile } = useViewMode();
    const { selectedPortfolioID } = usePortfolio();
    const { canWrite } = usePermission() || {};
    const location = useLocation();
    const [conversations, setConversations] = useState([]);
    const [selectedConvo, setSelectedConvo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [preSelectDone, setPreSelectDone] = useState(false);

    // Clear message notifications when opening messages page
    useEffect(() => {
        clearByType('message');
        clearByType('ticket_comment');
    }, [clearByType]);

    const userId = user?.id;

    // ── BUILD CONVERSATION LIST ─────────────────────────────────────
    // Lade-Zustand nur beim ersten Laden; spätere Aktualisierungen (Realtime) laufen
    // im Hintergrund, damit die Liste nicht flackert.
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        let refreshTimer = null;

        const fetchConversations = async () => {
            try {
                const [partners, recentRes] = await Promise.all([
                    loadMessagePartners(userId),
                    // Jüngste Nachrichten (gesendet und empfangen) in einer Abfrage
                    supabase
                        .from('messages')
                        .select('text, created_at, sender_id, receiver_id, read')
                        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
                        .order('created_at', { ascending: false })
                        .limit(RECENT_MESSAGES_LIMIT)
                ]);

                if (partners.length === 0) {
                    if (!cancelled) {
                        setConversations([]);
                        setListError(null);
                    }
                    return;
                }

                if (recentRes.error) throw recentRes.error;

                const recent = recentRes.data || [];

                const lastByPartner = {};
                recent.forEach(m => {
                    const partner = m.sender_id === userId ? m.receiver_id : m.sender_id;
                    if (!lastByPartner[partner]) lastByPartner[partner] = m;
                });

                // Get unread counts (eigene Abfrage, damit kein ungelesener Eintrag fehlt)
                const { data: unreadMessages, error: unreadError } = await supabase
                    .from('messages')
                    .select('sender_id')
                    .eq('receiver_id', userId)
                    .eq('read', false);
                if (unreadError) throw unreadError;

                const unreadMap = {};
                (unreadMessages || []).forEach(m => {
                    unreadMap[m.sender_id] = (unreadMap[m.sender_id] || 0) + 1;
                });

                // Nur Gespräche ohne Treffer unter den jüngsten Nachrichten einzeln nachladen
                const missing = recent.length < RECENT_MESSAGES_LIMIT
                    ? []
                    : partners.filter(p => !lastByPartner[p.userId]);
                await Promise.all(missing.map(async (partner) => {
                    const { data: lastMsg } = await supabase
                        .from('messages')
                        .select('text, created_at, sender_id, receiver_id')
                        .or(`and(sender_id.eq.${userId},receiver_id.eq.${partner.userId}),and(sender_id.eq.${partner.userId},receiver_id.eq.${userId})`)
                        .order('created_at', { ascending: false })
                        .limit(1);
                    if (lastMsg?.[0]) lastByPartner[partner.userId] = lastMsg[0];
                }));

                const convos = partners.map((partner) => {
                    const lastMsg = lastByPartner[partner.userId];

                    return {
                        ...partner,
                        lastMessage: lastMsg?.text || null,
                        lastMessageTime: lastMsg?.created_at || null,
                        unread: unreadMap[partner.userId] || 0
                    };
                });

                // Sort: unread first, then by last message time
                convos.sort((a, b) => {
                    if (a.unread > 0 && b.unread === 0) return -1;
                    if (b.unread > 0 && a.unread === 0) return 1;
                    if (!a.lastMessageTime) return 1;
                    if (!b.lastMessageTime) return -1;
                    return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
                });

                if (!cancelled) {
                    setConversations(convos);
                    setListError(null);
                }
            } catch (err) {
                console.error('Error:', err);
                if (!cancelled) setListError(`Gespräche konnten nicht geladen werden: ${translateError(err)}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchConversations();

        // Bei neuen bzw. gelesenen Nachrichten still (gebündelt) aktualisieren
        const scheduleRefresh = () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(fetchConversations, 400);
        };

        const channel = supabase
            .channel('investor-msg-list')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages'
            }, scheduleRefresh)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages'
            }, scheduleRefresh)
            .subscribe();

        return () => {
            cancelled = true;
            if (refreshTimer) clearTimeout(refreshTimer);
            supabase.removeChannel(channel);
        };
    }, [userId]);

    // Gespräch öffnen: Zähler sofort zurücksetzen (Messenger markiert als gelesen)
    const openConversation = (convo) => {
        setSelectedConvo(convo);
        setConversations(prev => prev.map(c => (c.userId === convo.userId ? { ...c, unread: 0 } : c)));
    };

    // Auto-select conversation from navigation state
    useEffect(() => {
        if (!preSelectDone && !loading && conversations.length > 0 && location.state?.preSelectUserId) {
            const match = conversations.find(c => c.userId === location.state.preSelectUserId);
            if (match) {
                openConversation(match);
            }
            setPreSelectDone(true);
        }
    }, [loading, conversations, location.state, preSelectDone]);

    // Oben gewähltes Portfolio: nur Mieter aus Objekten dieses Portfolios
    const portfolioConvos = selectedPortfolioID
        ? conversations.filter(c => c.portfolioId === selectedPortfolioID)
        : conversations;

    const filteredConvos = portfolioConvos.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.unit.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Gespräch eines anderen Portfolios nach dem Portfolio-Wechsel nicht weiter anzeigen
    const activeConvo = selectedConvo && selectedPortfolioID && selectedConvo.portfolioId &&
        selectedConvo.portfolioId !== selectedPortfolioID
        ? null
        : selectedConvo;

    // Senden nur mit Schreibrecht „Mieterportal“ auf das Objekt des Mieters (wie rls_message_allowed);
    // die Antwort an einen Mieter, der mir geschrieben hat, erlaubt Messenger trotzdem.
    const canSendTo = (convo) => {
        const current = conversations.find(c => c.userId === convo.userId) || convo;
        if (typeof current.canWrite === 'boolean') return current.canWrite;
        return !!canWrite?.('mieterportal', current.portfolioId || undefined);
    };

    const emptyListText = conversations.length === 0
        ? 'Keine Mieter registriert'
        : portfolioConvos.length === 0
            ? 'Keine Mieter in diesem Portfolio registriert'
            : `Keine Treffer für „${searchTerm.trim()}“`;

    // Kalendertage vergleichen (nicht 24-Stunden-Differenz): gestern 23 Uhr = "Gestern"
    const formatTime = (d) => {
        if (!d) return '';
        const date = new Date(d);
        const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'Gestern';
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    };

    return (
        <div style={{ height: isMobile ? 'calc(100vh - var(--topbar-height) - 60px - env(safe-area-inset-bottom, 0px) - env(safe-area-inset-top, 0px))' : 'calc(100vh - var(--topbar-height) - 4rem)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '16px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nachrichten</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Kommunizieren Sie direkt mit Ihren Mietern.
                </p>
            </div>

            <div style={{
                display: isMobile ? 'flex' : 'grid',
                flexDirection: isMobile ? 'column' : undefined,
                gridTemplateColumns: isMobile ? undefined : '320px 1fr',
                flex: 1,
                minHeight: 0,
                backgroundColor: 'var(--surface-color)',
                borderRadius: isMobile ? 0 : 'var(--radius-lg)',
                border: isMobile ? 'none' : '1px solid var(--border-color)',
                overflow: 'hidden'
            }}>
                {/* ── LEFT: CONVERSATION LIST ── */}
                <div style={{
                    borderRight: isMobile ? 'none' : '1px solid var(--border-color)',
                    display: (!isMobile || !activeConvo) ? 'flex' : 'none', flexDirection: 'column'
                }}>
                    {/* Search */}
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{
                                position: 'absolute', left: '10px', top: '50%',
                                transform: 'translateY(-50%)', color: 'var(--text-secondary)',
                                pointerEvents: 'none', zIndex: 1
                            }} />
                            <input
                                type="text"
                                placeholder="Mieter suchen..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="padded-left-icon"
                                style={{
                                    width: '100%', padding: '8px 10px 8px 32px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    outline: 'none', fontSize: '0.82rem',
                                    backgroundColor: 'var(--background-color)'
                                }}
                            />
                        </div>
                    </div>

                    {/* List */}
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {listError && (
                            <div role="alert" style={{
                                margin: '10px 16px', padding: '8px 12px', borderRadius: '8px',
                                border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.8rem'
                            }}>
                                {listError}
                            </div>
                        )}
                        {loading ? (
                            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                Laden...
                            </div>
                        ) : filteredConvos.length === 0 ? (
                            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                <Users size={32} color="var(--border-color)" style={{ marginBottom: '8px' }} />
                                <p>{emptyListText}</p>
                            </div>
                        ) : (
                            filteredConvos.map(convo => (
                                <div
                                    key={convo.userId}
                                    onClick={() => openConversation(convo)}
                                    style={{
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid var(--border-color)',
                                        backgroundColor: activeConvo?.userId === convo.userId ? '#EFF6FF' : 'transparent',
                                        transition: 'background 0.15s'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{
                                            width: '38px', height: '38px', borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #0066CC, #0EA5E9)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: 'white', fontWeight: 600, fontSize: '0.82rem',
                                            flexShrink: 0, position: 'relative'
                                        }}>
                                            {convo.name.charAt(0).toUpperCase()}
                                            {convo.unread > 0 && (
                                                <div style={{
                                                    position: 'absolute', top: '-2px', right: '-2px',
                                                    width: '16px', height: '16px', borderRadius: '50%',
                                                    backgroundColor: '#DC2626', color: 'white',
                                                    fontSize: '0.6rem', display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center',
                                                    fontWeight: 700, border: '2px solid white'
                                                }}>
                                                    {convo.unread}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                            }}>
                                                <span style={{
                                                    fontWeight: convo.unread > 0 ? 700 : 500,
                                                    fontSize: '0.88rem'
                                                }}>
                                                    {convo.name}
                                                </span>
                                                {convo.lastMessageTime && (
                                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                                                        {formatTime(convo.lastMessageTime)}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{
                                                fontSize: '0.75rem', color: 'var(--text-secondary)',
                                                marginTop: '1px'
                                            }}>
                                                {convo.unit}
                                            </div>
                                            {convo.lastMessage && (
                                                <div style={{
                                                    fontSize: '0.78rem', color: 'var(--text-secondary)',
                                                    marginTop: '3px',
                                                    fontWeight: convo.unread > 0 ? 600 : 400,
                                                    whiteSpace: 'nowrap', overflow: 'hidden',
                                                    textOverflow: 'ellipsis'
                                                }}>
                                                    {convo.lastMessage}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* ── RIGHT: MESSENGER ── */}
                <div style={{ display: (!isMobile || activeConvo) ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                    {activeConvo ? (
                        // key: beim Mieterwechsel neu aufbauen, damit Entwurf und Anhang
                        // nicht an den falschen Mieter gehen
                        <Messenger
                            key={activeConvo.userId}
                            conversationUserId={activeConvo.userId}
                            conversationUserName={activeConvo.name}
                            readOnly={!canSendTo(activeConvo)}
                            onBack={isMobile ? () => setSelectedConvo(null) : undefined}
                        />
                    ) : (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-secondary)'
                        }}>
                            <MessageSquare size={48} color="var(--border-color)" />
                            <p style={{ marginTop: '12px', fontSize: '0.9rem' }}>
                                Wählen Sie einen Mieter aus der Liste
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InvestorMessages;
