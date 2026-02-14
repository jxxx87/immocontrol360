import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
    Plus, X, Upload, Image, Clock, AlertCircle,
    CheckCircle2, TicketCheck, ChevronRight, Loader
} from 'lucide-react';

const TenantTickets = () => {
    const { user, roleData } = useAuth();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState(null);
    const [form, setForm] = useState({ title: '', description: '', priority: 'normal' });
    const [uploadFiles, setUploadFiles] = useState([]);
    const [creating, setCreating] = useState(false);
    const fileInputRef = useRef(null);

    const statusConfig = {
        received: { label: 'Eingegangen', color: '#F59E0B', bg: '#FEF3C7', icon: Clock, step: 1 },
        in_progress: { label: 'In Bearbeitung', color: '#3B82F6', bg: '#DBEAFE', icon: AlertCircle, step: 2 },
        completed: { label: 'Abgeschlossen', color: '#10B981', bg: '#D1FAE5', icon: CheckCircle2, step: 3 }
    };

    const priorityConfig = {
        low: { label: 'Niedrig', color: '#6B7280' },
        normal: { label: 'Normal', color: '#3B82F6' },
        high: { label: 'Hoch', color: '#F59E0B' },
        urgent: { label: 'Dringend', color: '#DC2626' }
    };

    // ── FETCH TICKETS ───────────────────────────────────────────────
    const fetchTickets = async () => {
        if (!user) return;
        setLoading(true);

        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('tenant_user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) console.error('Error:', error);
        setTickets(data || []);
        setLoading(false);
    };

    useEffect(() => {
        fetchTickets();
    }, [user]);

    // ── REALTIME UPDATES ────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('tenant-tickets')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'tickets',
                filter: `tenant_user_id=eq.${user.id}`
            }, () => {
                fetchTickets();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [user]);

    // ── CREATE TICKET ───────────────────────────────────────────────
    const handleCreate = async () => {
        if (!form.title.trim() || creating) return;
        setCreating(true);

        try {
            // Upload images
            const imageUrls = [];
            for (const file of uploadFiles) {
                const timestamp = Date.now();
                const filePath = `${roleData?.property_id || 'unknown'}/${roleData?.unit_id || 'unknown'}/${timestamp}_${file.name}`;
                const { error: uploadError } = await supabase.storage
                    .from('tickets')
                    .upload(filePath, file);

                if (!uploadError) {
                    // Store file path, not public URL (bucket is private)
                    imageUrls.push(filePath);
                }
            }

            const { error } = await supabase.from('tickets').insert({
                unit_id: roleData?.unit_id,
                property_id: roleData?.property_id,
                tenant_user_id: user.id,
                title: form.title.trim(),
                description: form.description.trim() || null,
                priority: form.priority,
                images: imageUrls
            });

            if (error) throw error;

            setForm({ title: '', description: '', priority: 'normal' });
            setUploadFiles([]);
            setShowCreate(false);
            fetchTickets();
        } catch (err) {
            console.error('Error creating ticket:', err);
            alert('Fehler beim Erstellen des Tickets');
        } finally {
            setCreating(false);
        }
    };

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Meine Tickets</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        Erstellen Sie Tickets für Reparaturen und Anfragen.
                    </p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="btn btn-primary btn-md"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    <Plus size={18} /> Neues Ticket
                </button>
            </div>

            {/* Ticket List */}
            {tickets.length === 0 ? (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '60px 40px', textAlign: 'center'
                }}>
                    <TicketCheck size={48} color="var(--border-color)" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                        Keine Tickets vorhanden. Erstellen Sie Ihr erstes Ticket!
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {tickets.map(ticket => {
                        const st = statusConfig[ticket.status] || statusConfig.received;
                        const pr = priorityConfig[ticket.priority] || priorityConfig.normal;
                        const StIcon = st.icon;

                        return (
                            <div
                                key={ticket.id}
                                onClick={() => setSelectedTicket(ticket)}
                                style={{
                                    backgroundColor: 'var(--surface-color)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--border-color)',
                                    padding: '18px 22px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    borderLeft: `4px solid ${st.color}`
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{ticket.title}</span>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: '10px',
                                                fontSize: '0.7rem', fontWeight: 500,
                                                backgroundColor: st.bg, color: st.color,
                                                display: 'flex', alignItems: 'center', gap: '4px'
                                            }}>
                                                <StIcon size={10} />
                                                {st.label}
                                            </span>
                                            <span style={{ fontSize: '0.7rem', color: pr.color, fontWeight: 500 }}>
                                                {pr.label}
                                            </span>
                                        </div>
                                        {ticket.description && (
                                            <p style={{
                                                fontSize: '0.82rem', color: 'var(--text-secondary)',
                                                marginBottom: '8px', lineHeight: 1.4,
                                                display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                            }}>
                                                {ticket.description}
                                            </p>
                                        )}
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            Erstellt: {formatDate(ticket.created_at)}
                                            {ticket.images?.length > 0 && (
                                                <span style={{ marginLeft: '12px' }}>
                                                    📎 {ticket.images.length} Foto{ticket.images.length > 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Progress */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '16px' }}>
                                        {[1, 2, 3].map(step => (
                                            <div
                                                key={step}
                                                style={{
                                                    width: step <= st.step ? '28px' : '20px',
                                                    height: '6px',
                                                    borderRadius: '3px',
                                                    backgroundColor: step <= st.step ? st.color : '#E5E7EB',
                                                    transition: 'all 0.3s'
                                                }}
                                            />
                                        ))}
                                        <ChevronRight size={16} color="var(--text-secondary)" style={{ marginLeft: '4px' }} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── CREATE TICKET MODAL ────────────────────────────────────── */}
            {showCreate && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }} onClick={() => setShowCreate(false)}>
                    <div
                        style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%', maxWidth: '520px',
                            padding: '28px', boxShadow: 'var(--shadow-lg)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Neues Ticket erstellen</h2>
                            <button onClick={() => setShowCreate(false)} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Titel *
                                </label>
                                <input
                                    type="text"
                                    placeholder="z.B. Heizung funktioniert nicht"
                                    value={form.title}
                                    onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        outline: 'none', fontSize: '0.9rem'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Beschreibung
                                </label>
                                <textarea
                                    placeholder="Beschreiben Sie das Problem ausführlich..."
                                    value={form.description}
                                    onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                                    rows={4}
                                    style={{
                                        width: '100%', padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        outline: 'none', fontSize: '0.9rem',
                                        resize: 'vertical', fontFamily: 'inherit'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Priorität
                                </label>
                                <select
                                    value={form.priority}
                                    onChange={(e) => setForm(prev => ({ ...prev, priority: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        outline: 'none', fontSize: '0.9rem'
                                    }}
                                >
                                    <option value="low">Niedrig</option>
                                    <option value="normal">Normal</option>
                                    <option value="high">Hoch</option>
                                    <option value="urgent">Dringend</option>
                                </select>
                            </div>

                            {/* Photo Upload */}
                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '8px', display: 'block' }}>
                                    Fotos
                                </label>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => setUploadFiles(prev => [...prev, ...Array.from(e.target.files)])}
                                />
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {uploadFiles.map((file, idx) => (
                                        <div key={idx} style={{
                                            position: 'relative', width: '70px', height: '70px',
                                            borderRadius: '8px', overflow: 'hidden',
                                            border: '1px solid var(--border-color)'
                                        }}>
                                            <img
                                                src={URL.createObjectURL(file)}
                                                alt=""
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                            <button
                                                onClick={() => setUploadFiles(prev => prev.filter((_, i) => i !== idx))}
                                                style={{
                                                    position: 'absolute', top: '2px', right: '2px',
                                                    width: '18px', height: '18px', borderRadius: '50%',
                                                    backgroundColor: 'rgba(0,0,0,0.6)', color: 'white',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: 'pointer', border: 'none', fontSize: '10px'
                                                }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        style={{
                                            width: '70px', height: '70px',
                                            borderRadius: '8px',
                                            border: '2px dashed var(--border-color)',
                                            display: 'flex', flexDirection: 'column',
                                            alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer', backgroundColor: 'var(--background-color)',
                                            color: 'var(--text-secondary)', gap: '2px'
                                        }}
                                    >
                                        <Upload size={18} />
                                        <span style={{ fontSize: '0.6rem' }}>Foto</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px' }}>
                            <button
                                onClick={() => setShowCreate(false)}
                                className="btn btn-secondary btn-md"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!form.title.trim() || creating}
                                className="btn btn-primary btn-md"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                                {creating && <Loader size={14} className="animate-spin" />}
                                Ticket erstellen
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── TICKET DETAIL MODAL ────────────────────────────────────── */}
            {selectedTicket && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }} onClick={() => setSelectedTicket(null)}>
                    <div
                        style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%', maxWidth: '600px', maxHeight: '80vh',
                            overflow: 'auto', padding: '28px', boxShadow: 'var(--shadow-lg)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                            <div>
                                <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{selectedTicket.title}</h2>
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '3px 10px', borderRadius: '12px', marginTop: '8px',
                                    fontSize: '0.75rem', fontWeight: 500,
                                    backgroundColor: statusConfig[selectedTicket.status]?.bg,
                                    color: statusConfig[selectedTicket.status]?.color
                                }}>
                                    {React.createElement(statusConfig[selectedTicket.status]?.icon || Clock, { size: 12 })}
                                    {statusConfig[selectedTicket.status]?.label}
                                </span>
                            </div>
                            <button onClick={() => setSelectedTicket(null)} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ marginBottom: '24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                {Object.values(statusConfig).map((s, i) => (
                                    <div key={i} style={{
                                        fontSize: '0.72rem', color: s.step <= statusConfig[selectedTicket.status]?.step ? s.color : 'var(--text-secondary)',
                                        fontWeight: s.step === statusConfig[selectedTicket.status]?.step ? 600 : 400,
                                        textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center',
                                        flex: 1
                                    }}>
                                        {s.label}
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                {[1, 2, 3].map(step => (
                                    <div key={step} style={{
                                        flex: 1, height: '6px',
                                        borderRadius: '3px',
                                        backgroundColor: step <= statusConfig[selectedTicket.status]?.step
                                            ? statusConfig[selectedTicket.status].color
                                            : '#E5E7EB',
                                        transition: 'all 0.4s'
                                    }} />
                                ))}
                            </div>
                        </div>

                        {selectedTicket.description && (
                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                    Beschreibung
                                </h4>
                                <p style={{ fontSize: '0.88rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                    {selectedTicket.description}
                                </p>
                            </div>
                        )}

                        {selectedTicket.images?.length > 0 && (
                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '10px', color: 'var(--text-secondary)' }}>
                                    Fotos
                                </h4>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {selectedTicket.images.map((path, idx) => (
                                        <SignedTicketImage key={idx} path={path} idx={idx} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── VERLAUF ── */}
                        <TicketVerlauf ticket={selectedTicket} userId={user.id} />

                        <div style={{
                            fontSize: '0.75rem', color: 'var(--text-secondary)',
                            borderTop: '1px solid var(--border-color)',
                            paddingTop: '14px', marginTop: '10px'
                        }}>
                            Erstellt am {formatDate(selectedTicket.created_at)} •
                            Priorität: {priorityConfig[selectedTicket.priority]?.label || 'Normal'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Component to display ticket images from private bucket with signed URLs
const SignedTicketImage = ({ path, idx }) => {
    const [url, setUrl] = useState(null);

    useEffect(() => {
        const fetchUrl = async () => {
            // Legacy: if path is a full URL, extract the file path
            let filePath = path;
            if (path.startsWith('http')) {
                const marker = '/object/public/tickets/';
                const idx = path.indexOf(marker);
                if (idx !== -1) {
                    filePath = path.substring(idx + marker.length);
                } else {
                    // Can't parse URL, skip
                    setUrl(null);
                    return;
                }
            }
            const { data } = await supabase.storage
                .from('tickets')
                .createSignedUrl(filePath, 3600);
            if (data?.signedUrl) setUrl(data.signedUrl);
        };
        fetchUrl();
    }, [path]);

    if (!url) {
        return (
            <div style={{
                width: '120px', height: '90px', borderRadius: '8px',
                backgroundColor: 'var(--background-color)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border-color)',
                fontSize: '0.7rem', color: 'var(--text-secondary)'
            }}>
                Laden...
            </div>
        );
    }

    return (
        <img
            src={url}
            alt={`Foto ${idx + 1}`}
            style={{
                width: '120px', height: '90px',
                objectFit: 'cover',
                borderRadius: '8px', cursor: 'pointer',
                border: '1px solid var(--border-color)'
            }}
            onClick={() => window.open(url, '_blank')}
        />
    );
};

// ── TICKET VERLAUF (Timeline + Comments) for Tenant ─────────────────
const TicketVerlauf = ({ ticket, userId }) => {
    const [comments, setComments] = useState([]);
    const [loadingComments, setLoadingComments] = useState(true);
    const [newComment, setNewComment] = useState('');
    const [sending, setSending] = useState(false);
    const verlaufEndRef = useRef(null);

    const fetchComments = async () => {
        setLoadingComments(true);
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('ticket_id', ticket.id)
            .order('created_at', { ascending: true });
        if (!error) setComments(data || []);
        setLoadingComments(false);
    };

    useEffect(() => { fetchComments(); }, [ticket.id]);

    // Auto-scroll to latest comment
    useEffect(() => {
        setTimeout(() => {
            verlaufEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }, [comments, loadingComments]);

    const handleSendComment = async () => {
        if (!newComment.trim() || sending) return;
        setSending(true);

        try {
            // Find the investor by looking at existing messages
            let receiverId = null;

            // Method 1: Check existing ticket comments for the other party
            if (comments.length > 0) {
                const otherMsg = comments.find(m => m.sender_id !== userId);
                if (otherMsg) receiverId = otherMsg.sender_id;
            }

            // Method 2: Check any messages sent to this user
            if (!receiverId) {
                const { data: msgs } = await supabase
                    .from('messages')
                    .select('sender_id, receiver_id')
                    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
                    .limit(5);

                if (msgs && msgs.length > 0) {
                    const otherMsg = msgs.find(m => m.sender_id !== userId);
                    if (otherMsg) {
                        receiverId = otherMsg.sender_id;
                    } else {
                        receiverId = msgs[0].receiver_id;
                    }
                }
            }

            if (!receiverId) {
                console.error('Kein Verwalter gefunden');
                setSending(false);
                return;
            }

            const { data: inserted, error } = await supabase
                .from('messages')
                .insert({
                    sender_id: userId,
                    receiver_id: receiverId,
                    text: newComment.trim(),
                    ticket_id: ticket.id,
                    is_system: false
                })
                .select()
                .single();

            if (!error && inserted) {
                setComments(prev => [...prev, inserted]);
            }
        } catch (err) {
            console.error('Error sending comment:', err);
        }

        setNewComment('');
        setSending(false);
    };

    const formatDateTime = (d) => new Date(d).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    return (
        <div style={{ marginBottom: '16px' }}>
            <h4 style={{
                fontSize: '0.82rem', fontWeight: 600, marginBottom: '10px',
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px'
            }}>
                💬 Verlauf
            </h4>

            <div style={{
                maxHeight: '220px', overflowY: 'auto',
                backgroundColor: 'var(--background-color)', borderRadius: '8px',
                padding: '10px', border: '1px solid var(--border-color)'
            }}>
                {/* Ticket creation */}
                <div style={{
                    display: 'flex', gap: '8px', marginBottom: '8px',
                    padding: '7px 10px', borderRadius: '6px',
                    backgroundColor: 'var(--surface-color)', border: '1px solid #BBF7D0'
                }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981', marginTop: '4px', flexShrink: 0 }} />
                    <div>
                        <div style={{ fontSize: '0.8rem', color: '#15803D', fontWeight: 500 }}>Ticket erstellt</div>
                        <div style={{ fontSize: '0.68rem', color: '#9CA3AF', marginTop: '1px' }}>{formatDateTime(ticket.created_at)}</div>
                    </div>
                </div>

                {loadingComments ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '8px' }}>Laden...</div>
                ) : (
                    comments.map((msg) => {
                        const isSystem = msg.is_system;
                        const isMine = msg.sender_id === userId;

                        let bgColor, borderColor, dotColor, textColor, label;
                        if (isSystem) {
                            bgColor = '#EFF6FF'; borderColor = '#BFDBFE'; dotColor = '#3B82F6'; textColor = '#1E40AF';
                            label = msg.text.startsWith('💬') ? '🔧 Verwalter-Kommentar' : '📋 Statusänderung';
                        } else if (isMine) {
                            bgColor = '#F9FAFB'; borderColor = '#E5E7EB'; dotColor = '#6B7280'; textColor = '#374151';
                            label = '👤 Mein Kommentar';
                        } else {
                            bgColor = '#FFF7ED'; borderColor = '#FED7AA'; dotColor = '#F97316'; textColor = '#C2410C';
                            label = '🔧 Verwalter';
                        }

                        // For system ticket comments, extract the actual comment text
                        let displayText = msg.text;
                        if (isSystem && msg.text.startsWith('💬')) {
                            const lines = msg.text.split('\n');
                            displayText = lines.length > 1 ? lines.slice(1).join('\n') : msg.text;
                        }

                        return (
                            <div key={msg.id} style={{
                                display: 'flex', gap: '8px', marginBottom: '6px',
                                padding: '7px 10px', borderRadius: '6px',
                                backgroundColor: bgColor, border: `1px solid ${borderColor}`
                            }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: dotColor, marginTop: '4px', flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.68rem', fontWeight: 600, color: dotColor, textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '2px' }}>
                                        {label}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: textColor, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {displayText}
                                    </div>
                                    <div style={{ fontSize: '0.66rem', color: '#9CA3AF', marginTop: '2px' }}>
                                        {formatDateTime(msg.created_at)}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}

                {!loadingComments && comments.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '8px' }}>
                        Noch keine Kommentare
                    </div>
                )}
                <div ref={verlaufEndRef} />
            </div>

            {/* Tenant comment input */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendComment();
                        }
                    }}
                    placeholder="Antwort zum Ticket..."
                    style={{
                        flex: 1, padding: '8px 12px', borderRadius: '8px',
                        border: '1px solid var(--border-color)', outline: 'none',
                        fontSize: '0.82rem', fontFamily: 'inherit', backgroundColor: 'var(--background-color)'
                    }}
                />
                <button
                    onClick={handleSendComment}
                    disabled={!newComment.trim() || sending}
                    style={{
                        padding: '8px 14px', borderRadius: '8px',
                        backgroundColor: newComment.trim() ? 'var(--primary-color)' : '#E5E7EB',
                        color: 'white', border: 'none', fontWeight: 600,
                        fontSize: '0.8rem', cursor: newComment.trim() ? 'pointer' : 'default',
                        transition: 'all 0.2s'
                    }}
                >
                    {sending ? '...' : 'Senden'}
                </button>
            </div>
        </div>
    );
};

export default TenantTickets;
