import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Messenger from '../components/Messenger';
import { MessageSquare, Users, Circle, Search } from 'lucide-react';

const InvestorMessages = () => {
    const { user } = useAuth();
    const [conversations, setConversations] = useState([]);
    const [selectedConvo, setSelectedConvo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // ── BUILD CONVERSATION LIST ─────────────────────────────────────
    useEffect(() => {
        const fetchConversations = async () => {
            if (!user) return;
            setLoading(true);

            try {
                // Get all tenant roles with tenant info
                const { data: tenantRoles } = await supabase
                    .from('user_roles')
                    .select('user_id, tenant_id, unit_id, property_id')
                    .eq('role', 'tenant');

                if (!tenantRoles || tenantRoles.length === 0) {
                    setConversations([]);
                    setLoading(false);
                    return;
                }

                // Fetch tenant names
                const tenantIds = tenantRoles.map(r => r.tenant_id).filter(Boolean);
                const { data: tenantData } = await supabase
                    .from('tenants')
                    .select('id, first_name, last_name')
                    .in('id', tenantIds);

                // Fetch units
                const unitIds = tenantRoles.map(r => r.unit_id).filter(Boolean);
                let unitData = [];
                if (unitIds.length > 0) {
                    const { data } = await supabase
                        .from('units')
                        .select('id, unit_name, property:properties(street, house_number)')
                        .in('id', unitIds);
                    unitData = data || [];
                }

                // Get unread counts
                const { data: unreadMessages } = await supabase
                    .from('messages')
                    .select('sender_id')
                    .eq('receiver_id', user.id)
                    .eq('read', false);

                const unreadMap = {};
                (unreadMessages || []).forEach(m => {
                    unreadMap[m.sender_id] = (unreadMap[m.sender_id] || 0) + 1;
                });

                // Get last message for each conversation
                const convos = await Promise.all(tenantRoles.map(async (role) => {
                    const tenant = (tenantData || []).find(t => t.id === role.tenant_id);
                    const unit = unitData.find(u => u.id === role.unit_id);

                    const { data: lastMsg } = await supabase
                        .from('messages')
                        .select('text, created_at, sender_id, is_system')
                        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${role.user_id}),and(sender_id.eq.${role.user_id},receiver_id.eq.${user.id})`)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    return {
                        userId: role.user_id,
                        name: tenant ? `${tenant.last_name}, ${tenant.first_name}` : 'Unbekannt',
                        unit: unit ? `${unit.property?.street || ''} ${unit.property?.house_number || ''} / ${unit.unit_name}` : '',
                        lastMessage: lastMsg?.[0]?.text || null,
                        lastMessageTime: lastMsg?.[0]?.created_at || null,
                        unread: unreadMap[role.user_id] || 0
                    };
                }));

                // Sort: unread first, then by last message time
                convos.sort((a, b) => {
                    if (a.unread > 0 && b.unread === 0) return -1;
                    if (b.unread > 0 && a.unread === 0) return 1;
                    if (!a.lastMessageTime) return 1;
                    if (!b.lastMessageTime) return -1;
                    return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
                });

                setConversations(convos);
            } catch (err) {
                console.error('Error:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchConversations();

        // Refresh on new messages
        const channel = supabase
            .channel('investor-msg-list')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages'
            }, () => {
                fetchConversations();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [user]);

    const filteredConvos = conversations.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.unit.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const formatTime = (d) => {
        if (!d) return '';
        const date = new Date(d);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'Gestern';
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    };

    return (
        <div style={{ height: 'calc(100vh - var(--topbar-height) - 4rem)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '16px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Nachrichten</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Kommunizieren Sie direkt mit Ihren Mietern.
                </p>
            </div>

            <div style={{
                display: 'grid', gridTemplateColumns: '320px 1fr',
                height: 'calc(100% - 70px)',
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden'
            }}>
                {/* ── LEFT: CONVERSATION LIST ── */}
                <div style={{
                    borderRight: '1px solid var(--border-color)',
                    display: 'flex', flexDirection: 'column'
                }}>
                    {/* Search */}
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{
                                position: 'absolute', left: '10px', top: '50%',
                                transform: 'translateY(-50%)', color: 'var(--text-secondary)'
                            }} />
                            <input
                                type="text"
                                placeholder="Mieter suchen..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
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
                        {loading ? (
                            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                Laden...
                            </div>
                        ) : filteredConvos.length === 0 ? (
                            <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                <Users size={32} color="var(--border-color)" style={{ marginBottom: '8px' }} />
                                <p>Keine Mieter registriert</p>
                            </div>
                        ) : (
                            filteredConvos.map(convo => (
                                <div
                                    key={convo.userId}
                                    onClick={() => setSelectedConvo(convo)}
                                    style={{
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid var(--border-color)',
                                        backgroundColor: selectedConvo?.userId === convo.userId ? '#EFF6FF' : 'transparent',
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
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                    {selectedConvo ? (
                        <Messenger
                            conversationUserId={selectedConvo.userId}
                            conversationUserName={selectedConvo.name}
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
