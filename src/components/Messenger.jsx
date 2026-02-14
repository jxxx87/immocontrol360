import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Send, Paperclip, Image, X, Bot, Clock, ChevronLeft } from 'lucide-react';

const Messenger = ({ conversationUserId, conversationUserName, ticketId = null, onBack }) => {
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [attachmentFile, setAttachmentFile] = useState(null);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    // ── FETCH MESSAGES ──────────────────────────────────────────────
    const fetchMessages = async () => {
        if (!user || !conversationUserId) return;
        setLoading(true);

        let query = supabase
            .from('messages')
            .select('*')
            .or(
                `and(sender_id.eq.${user.id},receiver_id.eq.${conversationUserId}),and(sender_id.eq.${conversationUserId},receiver_id.eq.${user.id})`
            )
            .order('created_at', { ascending: true });

        if (ticketId) {
            query = query.eq('ticket_id', ticketId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching messages:', error);
        } else {
            setMessages(data || []);
        }
        setLoading(false);

        // Mark unread messages as read
        await supabase
            .from('messages')
            .update({ read: true })
            .eq('receiver_id', user.id)
            .eq('sender_id', conversationUserId)
            .eq('read', false);
    };

    useEffect(() => {
        fetchMessages();
    }, [user, conversationUserId, ticketId]);

    // ── REALTIME SUBSCRIPTION ───────────────────────────────────────
    useEffect(() => {
        if (!user || !conversationUserId) return;

        const channel = supabase
            .channel(`messages-${user.id}-${conversationUserId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
            }, (payload) => {
                const msg = payload.new;
                // Only add if it's part of our conversation
                if (
                    (msg.sender_id === user.id && msg.receiver_id === conversationUserId) ||
                    (msg.sender_id === conversationUserId && msg.receiver_id === user.id)
                ) {
                    setMessages(prev => {
                        // Avoid duplicates
                        if (prev.find(m => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });

                    // Auto-mark as read if we're the receiver
                    if (msg.receiver_id === user.id) {
                        supabase
                            .from('messages')
                            .update({ read: true })
                            .eq('id', msg.id);
                    }
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, conversationUserId]);

    // ── AUTO-SCROLL ─────────────────────────────────────────────────
    const isInitialLoad = useRef(true);
    const scrollToBottom = useCallback((behavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    useEffect(() => {
        if (messages.length === 0) return;
        if (isInitialLoad.current) {
            // Multiple scroll attempts to catch async image loads
            scrollToBottom('instant');
            setTimeout(() => scrollToBottom('instant'), 200);
            setTimeout(() => scrollToBottom('instant'), 600);
            setTimeout(() => scrollToBottom('instant'), 1500);
            isInitialLoad.current = false;
        } else {
            setTimeout(() => scrollToBottom('smooth'), 50);
        }
    }, [messages, loading, scrollToBottom]);

    // ── SEND MESSAGE ────────────────────────────────────────────────
    const handleSend = async () => {
        if ((!newMessage.trim() && !attachmentFile) || sending) return;
        setSending(true);

        const messageText = newMessage.trim();
        setNewMessage('');

        let attachmentUrl = null;

        // Upload attachment if present
        if (attachmentFile) {
            const timestamp = Date.now();
            const filePath = `${user.id}/${timestamp}_${attachmentFile.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('chat-attachments')
                .upload(filePath, attachmentFile);

            if (uploadError) {
                console.error('Upload error:', uploadError);
            } else {
                // Store the file path, not public URL (bucket is private)
                attachmentUrl = filePath;
            }
        }

        const messagePayload = {
            sender_id: user.id,
            receiver_id: conversationUserId,
            text: messageText || null,
            attachment_url: attachmentUrl,
            ticket_id: ticketId || null,
            is_system: false
        };

        const { data: insertedMsg, error } = await supabase
            .from('messages')
            .insert(messagePayload)
            .select()
            .single();

        if (error) {
            console.error('Error sending message:', error);
        } else if (insertedMsg) {
            // Optimistic: add message to local state immediately
            setMessages(prev => {
                if (prev.find(m => m.id === insertedMsg.id)) return prev;
                return [...prev, insertedMsg];
            });
        }

        setAttachmentFile(null);
        setSending(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // ── FORMAT TIME ─────────────────────────────────────────────────
    const formatTime = (dateStr) => {
        const d = new Date(dateStr);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();

        const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

        if (isToday) return time;
        if (isYesterday) return `Gestern ${time}`;
        return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${time}`;
    };

    // ── GROUP MESSAGES BY DATE ──────────────────────────────────────
    const groupedMessages = messages.reduce((groups, msg) => {
        const date = new Date(msg.created_at).toLocaleDateString('de-DE', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
        if (!groups[date]) groups[date] = [];
        groups[date].push(msg);
        return groups;
    }, {});

    if (!conversationUserId) {
        return (
            <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-secondary)', fontSize: '0.95rem'
            }}>
                Wählen Sie eine Konversation aus
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', height: '100%',
            backgroundColor: 'var(--background-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden'
        }}>
            {/* ── HEADER ── */}
            <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }}>
                {onBack && (
                    <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', padding: '0', cursor: 'pointer', color: 'var(--text-primary)', marginRight: '-4px' }}>
                        <ChevronLeft size={24} />
                    </button>
                )}
                <div style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0066CC 0%, #0EA5E9 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 600, fontSize: '0.85rem'
                }}>
                    {(conversationUserName || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{conversationUserName || 'Unbekannt'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {ticketId ? 'Ticket-Chat' : 'Direktnachricht'}
                    </div>
                </div>
            </div>

            {/* ── MESSAGES AREA ── */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '16px 20px',
                display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                        Nachrichten werden geladen...
                    </div>
                ) : messages.length === 0 ? (
                    <div style={{
                        textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px'
                    }}>
                        <MessageCircleIcon />
                        <p style={{ fontSize: '0.9rem' }}>Noch keine Nachrichten</p>
                        <p style={{ fontSize: '0.8rem' }}>Schreiben Sie die erste Nachricht!</p>
                    </div>
                ) : (
                    Object.entries(groupedMessages).map(([date, msgs]) => (
                        <div key={date}>
                            {/* Date Separator */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '12px 0'
                            }}>
                                <div style={{
                                    padding: '4px 14px', borderRadius: '12px',
                                    backgroundColor: 'var(--border-color)', fontSize: '0.72rem',
                                    color: '#64748B', fontWeight: 500
                                }}>
                                    {date}
                                </div>
                            </div>
                            {msgs.map((msg) => {
                                const isMine = msg.sender_id === user.id;
                                const isSystem = msg.is_system;

                                if (isSystem) {
                                    return (
                                        <div key={msg.id} style={{
                                            display: 'flex', justifyContent: 'center', margin: '8px 0'
                                        }}>
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                padding: '6px 14px', borderRadius: '16px',
                                                backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                                fontSize: '0.78rem', color: '#3B82F6'
                                            }}>
                                                <Bot size={14} />
                                                {msg.text}
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={msg.id} style={{
                                        display: 'flex',
                                        justifyContent: isMine ? 'flex-end' : 'flex-start',
                                        marginBottom: '6px'
                                    }}>
                                        <div style={{
                                            maxWidth: '70%',
                                            padding: '10px 14px',
                                            borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                            backgroundColor: isMine ? 'var(--primary-color)' : 'var(--surface-color)',
                                            color: isMine ? 'white' : 'var(--text-primary)',
                                            boxShadow: isMine ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
                                            border: isMine ? 'none' : '1px solid var(--border-color)'
                                        }}>
                                            {msg.attachment_url && (
                                                <SignedAttachment path={msg.attachment_url} isMine={isMine} hasText={!!msg.text} onLoad={scrollToBottom} />
                                            )}
                                            {msg.text && (
                                                <div style={{
                                                    fontSize: '0.88rem', lineHeight: 1.5,
                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                                                }}>
                                                    {msg.text}
                                                </div>
                                            )}
                                            <div style={{
                                                fontSize: '0.68rem', marginTop: '4px',
                                                opacity: 0.7, textAlign: 'right',
                                                display: 'flex', alignItems: 'center',
                                                justifyContent: 'flex-end', gap: '4px'
                                            }}>
                                                <Clock size={10} />
                                                {formatTime(msg.created_at)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ── ATTACHMENT PREVIEW ── */}
            {attachmentFile && (
                <div style={{
                    padding: '8px 20px',
                    borderTop: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-color)',
                    display: 'flex', alignItems: 'center', gap: '10px'
                }}>
                    <Image size={16} color="var(--primary-color)" />
                    <span style={{ fontSize: '0.82rem', flex: 1, color: 'var(--text-secondary)' }}>
                        {attachmentFile.name}
                    </span>
                    <button
                        onClick={() => setAttachmentFile(null)}
                        style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* ── INPUT BAR ── */}
            <div style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                display: 'flex',
                alignItems: 'flex-end',
                gap: '10px'
            }}>
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => setAttachmentFile(e.target.files[0])}
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        width: '38px', height: '38px',
                        borderRadius: '50%', backgroundColor: 'var(--background-color)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-secondary)', cursor: 'pointer',
                        border: '1px solid var(--border-color)',
                        transition: 'all 0.2s', flexShrink: 0
                    }}
                    title="Datei anhängen"
                >
                    <Paperclip size={18} />
                </button>

                <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Nachricht schreiben..."
                    rows={1}
                    style={{
                        flex: 1, padding: '8px 12px', minHeight: '40px',
                        borderRadius: '20px',
                        border: '1px solid var(--border-color)',
                        outline: 'none', resize: 'none',
                        fontFamily: 'inherit', fontSize: '0.88rem',
                        lineHeight: 1.5, maxHeight: '100px',
                        backgroundColor: 'var(--background-color)'
                    }}
                />

                <button
                    onClick={handleSend}
                    disabled={(!newMessage.trim() && !attachmentFile) || sending}
                    style={{
                        width: '38px', height: '38px',
                        borderRadius: '50%',
                        backgroundColor: (!newMessage.trim() && !attachmentFile) ? 'var(--border-color)' : 'var(--primary-color)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', cursor: (!newMessage.trim() && !attachmentFile) ? 'default' : 'pointer',
                        border: 'none', transition: 'all 0.2s', flexShrink: 0
                    }}
                    title="Senden"
                >
                    <Send size={16} />
                </button>
            </div>
        </div>
    );
};

// Simple placeholder icon for empty state
const MessageCircleIcon = () => (
    <div style={{
        width: '64px', height: '64px', borderRadius: '50%',
        backgroundColor: 'var(--surface-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--primary-color)'
    }}>
        <Send size={28} />
    </div>
);

// Component to display attachment with signed URL from private bucket
const SignedAttachment = ({ path, isMine, hasText, onLoad }) => {
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUrl = async () => {
            // Legacy full URLs: extract file path for signed URL
            let filePath = path;
            if (path.startsWith('http')) {
                const marker = '/object/public/chat-attachments/';
                const idx = path.indexOf(marker);
                if (idx !== -1) {
                    filePath = path.substring(idx + marker.length);
                } else {
                    // Try using the URL directly as fallback
                    setUrl(path);
                    setLoading(false);
                    return;
                }
            }

            const { data, error } = await supabase.storage
                .from('chat-attachments')
                .createSignedUrl(filePath, 3600); // 1 hour

            if (data?.signedUrl) {
                setUrl(data.signedUrl);
            }
            setLoading(false);
        };
        fetchUrl();
    }, [path]);

    if (loading) {
        return (
            <div style={{
                padding: '8px', fontSize: '0.78rem',
                color: isMine ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)'
            }}>
                Anhang wird geladen...
            </div>
        );
    }

    if (!url) {
        return (
            <div style={{
                padding: '8px', fontSize: '0.78rem',
                color: isMine ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)'
            }}>
                Anhang nicht verfügbar
            </div>
        );
    }

    const isImage = path.match(/\.(jpg|jpeg|png|gif|webp)$/i);

    return (
        <div style={{ marginBottom: hasText ? '8px' : 0 }}>
            {isImage ? (
                <img
                    src={url}
                    alt="Anhang"
                    style={{
                        maxWidth: '100%', maxHeight: '200px',
                        borderRadius: '8px', cursor: 'pointer'
                    }}
                    onClick={() => window.open(url, '_blank')}
                    onLoad={() => onLoad?.('instant')}
                />
            ) : (
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        color: isMine ? '#E0F2FE' : 'var(--primary-color)',
                        fontSize: '0.82rem', textDecoration: 'underline'
                    }}
                >
                    <Paperclip size={14} /> Anhang herunterladen
                </a>
            )}
        </div>
    );
};

export default Messenger;
