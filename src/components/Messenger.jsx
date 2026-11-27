import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import {
    FILE_RULES, acceptAttribute, validateUploadFile, buildStorageObjectName,
    prepareUploadBody, extractStoragePath, isImageName
} from '../lib/storageFiles';
import { Send, Paperclip, Image, X, Bot, Clock, ChevronLeft } from 'lucide-react';

const ATTACHMENT_BUCKET = 'chat-attachments';
// Anzahl Nachrichten je Ladevorgang (PostgREST liefert ohnehin höchstens 1000 Zeilen)
const PAGE_SIZE = 200;

const Messenger = ({ conversationUserId, conversationUserName, ticketId = null, onBack }) => {
    const { user, userRole } = useAuth();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState(null);
    const [attachmentFile, setAttachmentFile] = useState(null);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const skipNextAutoScroll = useRef(false);

    const userId = user?.id;

    // Abfrage aller Nachrichten dieses Gesprächs (optional nur eines Tickets)
    const buildConversationQuery = useCallback(() => {
        let query = supabase
            .from('messages')
            .select('*')
            .or(
                `and(sender_id.eq.${userId},receiver_id.eq.${conversationUserId}),and(sender_id.eq.${conversationUserId},receiver_id.eq.${userId})`
            );
        if (ticketId) {
            query = query.eq('ticket_id', ticketId);
        }
        return query;
    }, [userId, conversationUserId, ticketId]);

    // Ungelesene Nachrichten des Gesprächspartners als gelesen markieren
    const markConversationRead = useCallback(async () => {
        let query = supabase
            .from('messages')
            .update({ read: true })
            .eq('receiver_id', userId)
            .eq('sender_id', conversationUserId)
            .eq('read', false);
        if (ticketId) {
            query = query.eq('ticket_id', ticketId);
        }
        const { error } = await query;
        if (error) console.error('Error marking messages as read:', error);
    }, [userId, conversationUserId, ticketId]);

    // ── FETCH MESSAGES ──────────────────────────────────────────────
    // Neueste Nachrichten zuerst laden (sonst fehlen bei langen Verläufen die neuesten),
    // für die Anzeige umdrehen. Ältere Nachrichten per "Ältere Nachrichten laden".
    useEffect(() => {
        if (!userId || !conversationUserId) return;
        let cancelled = false;

        const load = async () => {
            const { data, error } = await buildConversationQuery()
                .order('created_at', { ascending: false })
                .limit(PAGE_SIZE);

            if (cancelled) return; // Antwort einer inzwischen gewechselten Konversation

            if (error) {
                console.error('Error fetching messages:', error);
                setLoadError(`Nachrichten konnten nicht geladen werden: ${translateError(error)}`);
            } else {
                setLoadError(null);
                setMessages((data || []).slice().reverse());
                setHasMore((data || []).length === PAGE_SIZE);
            }
            setLoading(false);

            if (!error) await markConversationRead();
        };
        load();

        return () => { cancelled = true; };
    }, [userId, conversationUserId, buildConversationQuery, markConversationRead]);

    const loadOlderMessages = async () => {
        if (loadingOlder || messages.length === 0) return;
        setLoadingOlder(true);
        const oldest = messages[0].created_at;
        const { data, error } = await buildConversationQuery()
            .lt('created_at', oldest)
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE);
        if (error) {
            console.error('Error fetching older messages:', error);
            setLoadError(`Ältere Nachrichten konnten nicht geladen werden: ${translateError(error)}`);
        } else {
            const older = (data || []).slice().reverse();
            skipNextAutoScroll.current = true;
            setMessages(prev => [...older.filter(o => !prev.some(p => p.id === o.id)), ...prev]);
            setHasMore((data || []).length === PAGE_SIZE);
        }
        setLoadingOlder(false);
    };

    // ── REALTIME SUBSCRIPTION ───────────────────────────────────────
    useEffect(() => {
        if (!userId || !conversationUserId) return;

        const channel = supabase
            .channel(`messages-${userId}-${conversationUserId}-${ticketId || 'direct'}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
            }, (payload) => {
                const msg = payload.new;
                // Only add if it's part of our conversation
                const inConversation =
                    (msg.sender_id === userId && msg.receiver_id === conversationUserId) ||
                    (msg.sender_id === conversationUserId && msg.receiver_id === userId);
                // Im Ticket-Chat nur Nachrichten genau dieses Tickets
                if (!inConversation || (ticketId && msg.ticket_id !== ticketId)) return;

                setMessages(prev => {
                    // Avoid duplicates
                    if (prev.find(m => m.id === msg.id)) return prev;
                    return [...prev, msg];
                });

                // Auto-mark as read if we're the receiver
                if (msg.receiver_id === userId && !msg.read) {
                    supabase
                        .from('messages')
                        .update({ read: true })
                        .eq('id', msg.id)
                        .then(({ error }) => {
                            if (error) console.error('Error marking message as read:', error);
                        });
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userId, conversationUserId, ticketId]);

    // ── AUTO-SCROLL ─────────────────────────────────────────────────
    const isInitialLoad = useRef(true);
    const scrollToBottom = useCallback((behavior = 'smooth') => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, []);

    useEffect(() => {
        if (messages.length === 0) return;
        if (skipNextAutoScroll.current) {
            // Ältere Nachrichten wurden oben angefügt – Position beibehalten
            skipNextAutoScroll.current = false;
            return;
        }
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

    // System-Hinweise stammen immer vom Vermieter/Verwalter (Statuswechsel im Ticket-Board).
    // Eine als "System" markierte Nachricht eines Mieters wird deshalb normal angezeigt.
    const isTrustedSystemMessage = (msg) => {
        if (!msg.is_system) return false;
        return userRole === 'tenant' ? msg.sender_id !== userId : msg.sender_id === userId;
    };

    // ── ATTACHMENT SELECTION ────────────────────────────────────────
    const handleAttachmentSelected = (file) => {
        if (!file) return;
        const validationError = validateUploadFile(file, FILE_RULES.chat);
        if (validationError) {
            setSendError(validationError);
            setAttachmentFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
        setSendError(null);
        setAttachmentFile(file);
    };

    const clearAttachment = () => {
        setAttachmentFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // ── SEND MESSAGE ────────────────────────────────────────────────
    // Eingabe und Anhang werden erst nach erfolgreichem Speichern geleert; bei einem
    // Fehler bleiben sie erhalten und der Nutzer sieht eine Meldung.
    const handleSend = async () => {
        const messageText = newMessage.trim();
        if ((!messageText && !attachmentFile) || sending) return;
        setSending(true);
        setSendError(null);

        let attachmentPath = null;

        // Upload attachment if present
        if (attachmentFile) {
            const validationError = validateUploadFile(attachmentFile, FILE_RULES.chat);
            if (validationError) {
                setSendError(validationError);
                setSending(false);
                return;
            }
            // Pfad: <eigene user-id>/<zufalls-id>.<endung> (Originalname führt bei Umlauten zu "Invalid key")
            const filePath = `${userId}/${buildStorageObjectName(attachmentFile)}`;
            const { body, contentType } = prepareUploadBody(attachmentFile);
            const { error: uploadError } = await supabase.storage
                .from(ATTACHMENT_BUCKET)
                .upload(filePath, body, { contentType });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                setSendError(`Der Anhang konnte nicht hochgeladen werden: ${translateError(uploadError)}`);
                setSending(false);
                return;
            }
            // Store the file path, not public URL (bucket is private)
            attachmentPath = filePath;
        }

        const messagePayload = {
            sender_id: userId,
            receiver_id: conversationUserId,
            text: messageText || null,
            attachment_url: attachmentPath,
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
            if (attachmentPath) {
                // Hochgeladenen Anhang wieder entfernen, er gehört zu keiner Nachricht
                const { error: cleanupError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachmentPath]);
                if (cleanupError) console.error('Cleanup error:', cleanupError);
            }
            setSendError(`Die Nachricht konnte nicht gesendet werden: ${translateError(error)}`);
            setSending(false);
            return;
        }

        if (insertedMsg) {
            // Optimistic: add message to local state immediately
            setMessages(prev => {
                if (prev.find(m => m.id === insertedMsg.id)) return prev;
                return [...prev, insertedMsg];
            });
        }

        // Nur leeren, wenn während des Sendens nichts Neues getippt wurde
        setNewMessage(current => (current.trim() === messageText ? '' : current));
        clearAttachment();
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
            display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
            backgroundColor: 'var(--background-color)', overflow: 'hidden'
        }}>
            {/* ── HEADER (sticky) ── */}
            <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                flexShrink: 0
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
                {loadError && (
                    <div role="alert" style={{
                        textAlign: 'center', padding: '8px 12px', margin: '4px 0 8px',
                        borderRadius: '8px', border: '1px solid #FECACA',
                        color: '#B91C1C', fontSize: '0.8rem', backgroundColor: 'var(--surface-color)'
                    }}>
                        {loadError}
                    </div>
                )}
                {!loading && hasMore && (
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 8px' }}>
                        <button
                            onClick={loadOlderMessages}
                            disabled={loadingOlder}
                            style={{
                                padding: '4px 14px', borderRadius: '12px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)',
                                color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer'
                            }}
                        >
                            {loadingOlder ? 'Lädt...' : 'Ältere Nachrichten laden'}
                        </button>
                    </div>
                )}
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
                            {/* Date Separator (sticky like WhatsApp) */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '12px 0',
                                position: 'sticky',
                                top: 0,
                                zIndex: 5
                            }}>
                                <div style={{
                                    padding: '4px 14px', borderRadius: '12px',
                                    backgroundColor: 'rgba(226, 232, 240, 0.95)', fontSize: '0.72rem',
                                    color: '#64748B', fontWeight: 500,
                                    backdropFilter: 'blur(4px)'
                                }}>
                                    {date}
                                </div>
                            </div>
                            {msgs.map((msg) => {
                                const isMine = msg.sender_id === userId;
                                const isSystem = isTrustedSystemMessage(msg);

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

            {/* ── SEND ERROR ── */}
            {sendError && (
                <div role="alert" style={{
                    padding: '8px 20px',
                    borderTop: '1px solid #FECACA',
                    backgroundColor: 'var(--surface-color)',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    color: '#B91C1C', fontSize: '0.8rem',
                    flexShrink: 0
                }}>
                    <span style={{ flex: 1 }}>{sendError}</span>
                    <button
                        onClick={() => setSendError(null)}
                        style={{ color: 'inherit', cursor: 'pointer', background: 'none', border: 'none' }}
                        title="Schließen"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* ── ATTACHMENT PREVIEW ── */}
            {attachmentFile && (
                <div style={{
                    padding: '8px 20px',
                    borderTop: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-color)',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    flexShrink: 0
                }}>
                    <Image size={16} color="var(--primary-color)" />
                    <span style={{ fontSize: '0.82rem', flex: 1, color: 'var(--text-secondary)' }}>
                        {attachmentFile.name}
                    </span>
                    <button
                        onClick={clearAttachment}
                        style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* ── INPUT BAR (fixed at bottom) ── */}
            <div style={{
                padding: '12px 20px',
                paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                display: 'flex',
                alignItems: 'flex-end',
                gap: '10px',
                flexShrink: 0
            }}>
                <input
                    type="file"
                    ref={fileInputRef}
                    accept={acceptAttribute(FILE_RULES.chat)}
                    style={{ display: 'none' }}
                    onChange={(e) => handleAttachmentSelected(e.target.files?.[0])}
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
                    placeholder="Schreiben..."
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
                        backgroundColor: 'var(--primary-color)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', cursor: 'pointer',
                        border: 'none', transition: 'all 0.2s', flexShrink: 0,
                        opacity: (!newMessage.trim() && !attachmentFile) ? 0.7 : 1
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
// Nur Pfade des eigenen Buckets werden signiert und angezeigt; fremde Adressen
// (attachment_url ist frei setzbar) werden nicht als Bild/Link gerendert.
const SignedAttachment = ({ path, isMine, hasText, onLoad }) => {
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const fetchUrl = async () => {
            const filePath = extractStoragePath(path, ATTACHMENT_BUCKET);
            if (!filePath) {
                if (!cancelled) setLoading(false);
                return;
            }

            const { data, error } = await supabase.storage
                .from(ATTACHMENT_BUCKET)
                .createSignedUrl(filePath, 3600); // 1 hour

            if (cancelled) return;
            if (error) console.error('Error signing attachment:', error);
            if (data?.signedUrl) {
                setUrl(data.signedUrl);
            }
            setLoading(false);
        };
        fetchUrl();
        return () => { cancelled = true; };
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

    const isImage = isImageName(extractStoragePath(path, ATTACHMENT_BUCKET) || '');

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
                    onClick={() => window.open(url, '_blank', 'noopener')}
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
