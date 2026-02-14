import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
    DndContext,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    useDroppable
} from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Clock, AlertCircle, CheckCircle2,
    MapPin, User as UserIcon, Calendar, Image as ImageIcon,
    X, ChevronRight, MessageSquare
} from 'lucide-react';

import { useViewMode } from '../context/ViewModeContext';

const TicketKanban = () => {
    const { isMobile } = useViewMode();
    const { user } = useAuth();
    const [tickets, setTickets] = useState([]);
    const [tenants, setTenants] = useState({});
    const [units, setUnits] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeTicket, setActiveTicket] = useState(null);
    const [overId, setOverId] = useState(null);
    const [selectedTicket, setSelectedTicket] = useState(null); // For detail modal
    const [imageUrls, setImageUrls] = useState({}); // cache signed URLs

    const columns = [
        { id: 'received', label: 'Eingegangen', color: '#F59E0B', bg: 'var(--col-bg-received, #FFFBEB)', icon: Clock },
        { id: 'in_progress', label: 'In Bearbeitung', color: '#3B82F6', bg: 'var(--col-bg-progress, #EFF6FF)', icon: AlertCircle },
        { id: 'completed', label: 'Abgeschlossen', color: '#10B981', bg: 'var(--col-bg-completed, #F0FDF4)', icon: CheckCircle2 }
    ];

    const priorityColors = {
        low: '#6B7280', normal: '#3B82F6', high: '#F59E0B', urgent: '#DC2626'
    };

    const statusLabels = {
        received: 'Eingegangen',
        in_progress: 'In Bearbeitung',
        completed: 'Abgeschlossen'
    };

    const priorityLabels = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' };

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 }
        })
    );

    // ── FETCH DATA ──────────────────────────────────────────────────
    const fetchData = async () => {
        setLoading(true);
        try {
            const [ticketRes, unitRes] = await Promise.all([
                supabase.from('tickets').select('*').order('created_at', { ascending: false }),
                supabase.from('units').select('*, property:properties(*)')
            ]);

            setTickets(ticketRes.data || []);

            const unitMap = {};
            (unitRes.data || []).forEach(u => { unitMap[u.id] = u; });
            setUnits(unitMap);

            // Fetch tenant names
            const tenantUserIds = [...new Set((ticketRes.data || []).map(t => t.tenant_user_id).filter(Boolean))];
            if (tenantUserIds.length > 0) {
                const { data: roleData } = await supabase
                    .from('user_roles')
                    .select('user_id, tenant_id')
                    .in('user_id', tenantUserIds);

                const tenantIds = (roleData || []).map(r => r.tenant_id).filter(Boolean);
                if (tenantIds.length > 0) {
                    const { data: tenantData } = await supabase
                        .from('tenants')
                        .select('id, first_name, last_name')
                        .in('id', tenantIds);

                    const tMap = {};
                    (roleData || []).forEach(r => {
                        const tenant = (tenantData || []).find(t => t.id === r.tenant_id);
                        if (tenant) tMap[r.user_id] = `${tenant.last_name}, ${tenant.first_name}`;
                    });
                    setTenants(tMap);
                }
            }
        } catch (err) {
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // ── REALTIME ────────────────────────────────────────────────────
    useEffect(() => {
        const channel = supabase
            .channel('kanban-tickets')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
                fetchData();
            })
            .subscribe();
        return () => supabase.removeChannel(channel);
    }, []);

    // ── GET SIGNED URL FOR IMAGES ───────────────────────────────────
    const getSignedUrl = async (path) => {
        if (imageUrls[path]) return imageUrls[path];

        // Extract file path from legacy full public URLs
        let filePath = path;
        if (path.startsWith('http')) {
            const marker = '/object/public/tickets/';
            const idx = path.indexOf(marker);
            if (idx !== -1) {
                filePath = path.substring(idx + marker.length);
            } else {
                // Can't parse, skip
                return null;
            }
        }

        const { data } = await supabase.storage.from('tickets').createSignedUrl(filePath, 3600);
        if (data?.signedUrl) {
            setImageUrls(prev => ({ ...prev, [path]: data.signedUrl }));
            return data.signedUrl;
        }
        return null;
    };

    // ── DRAG & DROP ─────────────────────────────────────────────────
    const handleDragStart = (event) => {
        const ticket = tickets.find(t => t.id === event.active.id);
        setActiveTicket(ticket);
    };

    const handleDragOver = (event) => {
        const { over } = event;
        setOverId(over ? over.id : null);
    };

    const handleDragEnd = async (event) => {
        setActiveTicket(null);
        setOverId(null);
        const { active, over } = event;
        if (!over) return;

        const ticketId = active.id;
        let newStatus = null;

        // Check if dropped on a column droppable
        if (['received', 'in_progress', 'completed'].includes(over.id)) {
            newStatus = over.id;
        } else {
            // Dropped on another ticket card — find its column
            const overTicket = tickets.find(t => t.id === over.id);
            if (overTicket) newStatus = overTicket.status;
        }

        if (!newStatus) return;

        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket || ticket.status === newStatus) return;

        const oldStatus = ticket.status;

        // Optimistic update
        setTickets(prev => prev.map(t =>
            t.id === ticketId ? { ...t, status: newStatus, updated_at: new Date().toISOString() } : t
        ));

        const { error } = await supabase
            .from('tickets')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', ticketId);

        if (error) {
            console.error('Error updating ticket status:', error);
            setTickets(prev => prev.map(t =>
                t.id === ticketId ? { ...t, status: oldStatus } : t
            ));
            return;
        }

        // Send auto-notification to tenant
        try {
            const statusLabel = statusLabels[newStatus];
            await supabase.from('messages').insert({
                sender_id: user.id,
                receiver_id: ticket.tenant_user_id,
                text: `📋 Ihr Ticket "${ticket.title}" wurde auf "${statusLabel}" aktualisiert.`,
                ticket_id: ticket.id,
                is_system: true
            });
        } catch (err) {
            console.error('Error sending notification:', err);
        }
    };

    const handleDragCancel = () => setActiveTicket(null);

    const formatDate = (d) => {
        const date = new Date(d);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'Heute';
        if (diffDays === 1) return 'Gestern';
        if (diffDays < 7) return `Vor ${diffDays} Tagen`;
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Ticket-Board</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Verwalten Sie Mieter-Tickets per Drag & Drop. Statuswechsel benachrichtigt den Mieter automatisch.
                </p>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
            >
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '20px',
                    minHeight: 'calc(100vh - var(--topbar-height) - 160px)'
                }}>
                    {columns.map(col => {
                        const colTickets = tickets.filter(t => t.status === col.id);
                        return (
                            <DroppableColumn
                                key={col.id}
                                col={col}
                                tickets={colTickets}
                                overId={overId}
                                tenants={tenants}
                                units={units}
                                formatDate={formatDate}
                                priorityColors={priorityColors}
                                priorityLabels={priorityLabels}
                                onTicketClick={setSelectedTicket}
                            />
                        );
                    })}
                </div>

                <DragOverlay dropAnimation={null}>
                    {activeTicket ? (
                        <TicketCard
                            ticket={activeTicket}
                            tenantName={tenants[activeTicket.tenant_user_id]}
                            unit={units[activeTicket.unit_id]}
                            formatDate={formatDate}
                            priorityColors={priorityColors}
                            priorityLabels={priorityLabels}
                            isDragging
                        />
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* ── DETAIL MODAL ────────────────────────────────────────── */}
            {selectedTicket && (
                <TicketDetailModal
                    ticket={selectedTicket}
                    tenantName={tenants[selectedTicket.tenant_user_id]}
                    unit={units[selectedTicket.unit_id]}
                    statusLabels={statusLabels}
                    priorityLabels={priorityLabels}
                    priorityColors={priorityColors}
                    getSignedUrl={getSignedUrl}
                    user={user}
                    onDelete={async (ticketId) => {
                        await supabase.from('tickets').delete().eq('id', ticketId);
                        setTickets(prev => prev.filter(t => t.id !== ticketId));
                        setSelectedTicket(null);
                    }}
                    onClose={() => setSelectedTicket(null)}
                    isMobile={isMobile}
                />
            )}
        </div>
    );
};

// ── DROPPABLE COLUMN ────────────────────────────────────────────────
const DroppableColumn = ({ col, tickets, overId, tenants, units, formatDate, priorityColors, priorityLabels, onTicketClick }) => {
    const { setNodeRef, isOver } = useDroppable({ id: col.id });
    const ColIcon = col.icon;

    // Check if we are over the column or any ticket within this column
    const isTicketInCol = tickets.some(t => t.id === overId);
    const isHighlightActive = isOver || isTicketInCol;

    return (
        <div
            ref={setNodeRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: isHighlightActive ? `${col.color}30` : col.bg,
                borderRadius: 'var(--radius-lg)',
                padding: '16px',
                border: isHighlightActive ? `2px solid ${col.color}` : `1px solid ${col.color}20`,
                minHeight: '450px',
                height: '100%',
                transition: 'all 0.2s',
                boxShadow: isHighlightActive ? `0 0 25px ${col.color}35` : 'none',
                position: 'relative',
                zIndex: isHighlightActive ? 10 : 1
            }}
        >
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '16px', paddingBottom: '12px',
                borderBottom: `2px solid ${col.color}30`,
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ColIcon size={18} color={col.color} />
                    <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{col.label}</span>
                </div>
                <span style={{
                    padding: '2px 10px', borderRadius: '12px',
                    fontSize: '0.75rem', fontWeight: 600,
                    backgroundColor: `${col.color}15`, color: col.color
                }}>
                    {tickets.length}
                </span>
            </div>

            <SortableContext items={tickets.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    flex: 1,
                    minHeight: '100px'
                }}>
                    {tickets.map(ticket => (
                        <SortableTicketCard
                            key={ticket.id}
                            ticket={ticket}
                            tenantName={tenants[ticket.tenant_user_id]}
                            unit={units[ticket.unit_id]}
                            formatDate={formatDate}
                            priorityColors={priorityColors}
                            priorityLabels={priorityLabels}
                            onTicketClick={onTicketClick}
                        />
                    ))}
                    {tickets.length === 0 && (
                        <div style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '30px 16px', textAlign: 'center',
                            color: 'var(--text-secondary)', fontSize: '0.82rem',
                            borderRadius: 'var(--radius-md)',
                            border: '2px dashed var(--border-color)', opacity: 0.6
                        }}>
                            Ticket hierhin ziehen
                        </div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
};

// ── SORTABLE TICKET CARD ────────────────────────────────────────────
const SortableTicketCard = ({ ticket, tenantName, unit, formatDate, priorityColors, priorityLabels, onTicketClick }) => {
    const {
        attributes, listeners, setNodeRef, transform, transition, isDragging
    } = useSortable({ id: ticket.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <TicketCard
                ticket={ticket}
                tenantName={tenantName}
                unit={unit}
                formatDate={formatDate}
                priorityColors={priorityColors}
                priorityLabels={priorityLabels}
                onTicketClick={onTicketClick}
            />
        </div>
    );
};

// ── TICKET CARD ─────────────────────────────────────────────────────
const TicketCard = ({ ticket, tenantName, unit, formatDate, priorityColors, priorityLabels, isDragging, onTicketClick }) => {
    return (
        <div
            onClick={(e) => {
                if (!isDragging && onTicketClick) {
                    e.stopPropagation();
                    onTicketClick(ticket);
                }
            }}
            style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                cursor: isDragging ? 'grabbing' : 'grab',
                boxShadow: isDragging ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                border: '1px solid var(--border-color)',
                transition: 'box-shadow 0.2s, transform 0.2s',
                transform: isDragging ? 'rotate(3deg) scale(1.05)' : 'none',
                userSelect: 'none'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '0.88rem', flex: 1 }}>{ticket.title}</span>
                <span style={{
                    fontSize: '0.62rem', fontWeight: 600,
                    color: priorityColors[ticket.priority] || '#6B7280',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    flexShrink: 0, marginLeft: '8px',
                    padding: '2px 6px', borderRadius: '4px',
                    backgroundColor: `${priorityColors[ticket.priority] || '#6B7280'}12`
                }}>
                    {priorityLabels[ticket.priority] || 'Normal'}
                </span>
            </div>

            {ticket.description && (
                <p style={{
                    fontSize: '0.78rem', color: 'var(--text-secondary)',
                    marginBottom: '10px', lineHeight: 1.4,
                    display: '-webkit-box', WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden'
                }}>
                    {ticket.description}
                </p>
            )}

            <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '8px',
                fontSize: '0.72rem', color: 'var(--text-secondary)'
            }}>
                {tenantName && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <UserIcon size={11} /> {tenantName}
                    </span>
                )}
                {unit && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <MapPin size={11} /> {unit.unit_name}
                    </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Calendar size={11} /> {formatDate(ticket.created_at)}
                </span>
                {ticket.images?.length > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--primary-color)' }}>
                        <ImageIcon size={11} /> {ticket.images.length} Foto{ticket.images.length > 1 ? 's' : ''}
                    </span>
                )}
            </div>
        </div>
    );
};

// ── TICKET DETAIL MODAL ─────────────────────────────────────────────
const TicketDetailModal = ({ ticket, tenantName, unit, statusLabels, priorityLabels, priorityColors, getSignedUrl, user, onDelete, onClose, isMobile }) => {
    const [signedUrls, setSignedUrls] = useState([]);
    const [loadingImages, setLoadingImages] = useState(false);
    const [comments, setComments] = useState([]);
    const [loadingComments, setLoadingComments] = useState(true);
    const [newComment, setNewComment] = useState('');
    const [sendingComment, setSendingComment] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const verlaufEndRef = useRef(null);

    // Load signed URLs for images
    useEffect(() => {
        if (!ticket.images || ticket.images.length === 0) return;
        setLoadingImages(true);
        const loadUrls = async () => {
            const urls = await Promise.all(
                ticket.images.map(async (path) => {
                    const url = await getSignedUrl(path);
                    return { path, url };
                })
            );
            setSignedUrls(urls.filter(u => u.url));
            setLoadingImages(false);
        };
        loadUrls();
    }, [ticket.images]);

    // Load comments (messages with ticket_id)
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

    // Send investor comment
    const handleSendComment = async () => {
        if (!newComment.trim() || sendingComment) return;
        setSendingComment(true);

        const commentText = `💬 Kommentar zu Ticket "${ticket.title}":\n${newComment.trim()}`;

        const { data: inserted, error } = await supabase
            .from('messages')
            .insert({
                sender_id: user.id,
                receiver_id: ticket.tenant_user_id,
                text: commentText,
                ticket_id: ticket.id,
                is_system: true
            })
            .select()
            .single();

        if (!error && inserted) {
            setComments(prev => [...prev, inserted]);
        }
        setNewComment('');
        setSendingComment(false);
    };

    const formatDateTime = (d) => {
        return new Date(d).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const statusColor = {
        received: '#F59E0B',
        in_progress: '#3B82F6',
        completed: '#10B981'
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }} onClick={onClose}>
            <div
                style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: isMobile ? 0 : 'var(--radius-lg)',
                    width: isMobile ? '100%' : '100%',
                    maxWidth: isMobile ? '100%' : '650px',
                    height: isMobile ? '100vh' : 'auto',
                    maxHeight: isMobile ? '100vh' : '90vh',
                    overflow: 'auto',
                    padding: isMobile ? '20px' : '28px',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex',
                    flexDirection: 'column'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    <div>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>
                            {ticket.title}
                        </h2>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '3px 10px', borderRadius: '12px',
                                fontSize: '0.75rem', fontWeight: 600,
                                backgroundColor: `${statusColor[ticket.status]}15`,
                                color: statusColor[ticket.status]
                            }}>
                                {statusLabels[ticket.status]}
                            </span>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '3px 10px', borderRadius: '12px',
                                fontSize: '0.75rem', fontWeight: 600,
                                backgroundColor: `${priorityColors[ticket.priority] || '#6B7280'}15`,
                                color: priorityColors[ticket.priority] || '#6B7280'
                            }}>
                                Priorität: {priorityLabels[ticket.priority]}
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, background: 'none', border: 'none' }}>
                        <X size={22} />
                    </button>
                </div>

                {/* ── Meta Info ── */}
                <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
                    padding: '14px 16px',
                    backgroundColor: 'var(--background-color)', borderRadius: 'var(--radius-md)',
                    marginBottom: '16px', fontSize: '0.85rem'
                }}>
                    <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Mieter</span>
                        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <UserIcon size={14} /> {tenantName || 'Unbekannt'}
                        </div>
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Einheit</span>
                        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <MapPin size={14} /> {unit?.unit_name || '—'}
                        </div>
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Erstellt</span>
                        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <Calendar size={14} /> {formatDateTime(ticket.created_at)}
                        </div>
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Adresse</span>
                        <div style={{ fontWeight: 500, marginTop: '2px', fontSize: '0.82rem' }}>
                            {unit?.property ? `${unit.property.street} ${unit.property.house_number || ''}, ${unit.property.city}` : '—'}
                        </div>
                    </div>
                </div>

                {/* ── Description ── */}
                {ticket.description && (
                    <div style={{ marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            Beschreibung
                        </h3>
                        <p style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                            {ticket.description}
                        </p>
                    </div>
                )}

                {/* ── Images ── */}
                {ticket.images && ticket.images.length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', color: 'var(--text-secondary)' }}>
                            Fotos ({ticket.images.length})
                        </h3>
                        {loadingImages ? (
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Bilder werden geladen...</div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                                {signedUrls.map((item, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => window.open(item.url, '_blank')}
                                        style={{
                                            borderRadius: 'var(--radius-md)', overflow: 'hidden', cursor: 'pointer',
                                            border: '1px solid var(--border-color)', aspectRatio: '4/3', position: 'relative'
                                        }}
                                    >
                                        <img src={item.url} alt={`Foto ${idx + 1}`}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        <div style={{
                                            position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 8px',
                                            background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
                                            color: 'white', fontSize: '0.65rem', textAlign: 'right'
                                        }}>Vergrößern</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── VERLAUF (Comments/Timeline) ── */}
                <div style={{ marginBottom: '16px' }}>
                    <h3 style={{
                        fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px',
                        color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px'
                    }}>
                        <MessageSquare size={15} /> Verlauf
                    </h3>

                    <div style={{
                        maxHeight: '250px', overflowY: 'auto',
                        backgroundColor: 'var(--background-color)', borderRadius: 'var(--radius-md)',
                        padding: '12px', border: '1px solid var(--border-color)'
                    }}>
                        {/* Ticket creation entry */}
                        <div style={{
                            display: 'flex', gap: '10px', marginBottom: '10px',
                            padding: '8px 12px', borderRadius: '8px',
                            backgroundColor: 'var(--col-bg-completed, #F0FDF4)', border: '1px solid var(--border-color)'
                        }}>
                            <div style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                backgroundColor: '#10B981', marginTop: '5px', flexShrink: 0
                            }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '0.82rem', color: '#15803D', fontWeight: 500 }}>
                                    Ticket erstellt
                                </div>
                                <div style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: '2px' }}>
                                    {formatDateTime(ticket.created_at)}
                                </div>
                            </div>
                        </div>

                        {loadingComments ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '10px' }}>
                                Laden...
                            </div>
                        ) : (
                            comments.map((msg) => {
                                const isSystem = msg.is_system;
                                const isInvestor = msg.sender_id === user.id;

                                // Colors: System = Blue, Investor = Orange, Tenant = Grey
                                let bgColor, borderColor, dotColor, textColor;
                                if (isSystem) {
                                    bgColor = 'var(--col-bg-progress, #EFF6FF)'; borderColor = 'var(--border-color)'; dotColor = '#3B82F6'; textColor = '#3B82F6';
                                } else if (isInvestor) {
                                    bgColor = 'var(--col-bg-received, #FFF7ED)'; borderColor = 'var(--border-color)'; dotColor = '#F97316'; textColor = '#F97316';
                                } else {
                                    bgColor = 'var(--surface-color)'; borderColor = 'var(--border-color)'; dotColor = '#6B7280'; textColor = 'var(--text-primary)';
                                }

                                return (
                                    <div key={msg.id} style={{
                                        display: 'flex', gap: '10px', marginBottom: '8px',
                                        padding: '8px 12px', borderRadius: '8px',
                                        backgroundColor: bgColor, border: `1px solid ${borderColor}`
                                    }}>
                                        <div style={{
                                            width: '8px', height: '8px', borderRadius: '50%',
                                            backgroundColor: dotColor, marginTop: '5px', flexShrink: 0
                                        }} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                                <div style={{
                                                    fontSize: '0.82rem', color: textColor, lineHeight: 1.4,
                                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                                                }}>
                                                    {isSystem ? msg.text : (
                                                        <>
                                                            <span style={{ fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                                                {isInvestor ? '🔧 Verwalter' : '👤 Mieter'}:
                                                            </span>{' '}
                                                            {msg.text}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.68rem', color: '#9CA3AF', marginTop: '3px' }}>
                                                {formatDateTime(msg.created_at)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}

                        {!loadingComments && comments.length === 0 && (
                            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '10px' }}>
                                Noch keine Kommentare
                            </div>
                        )}
                        <div ref={verlaufEndRef} />
                    </div>

                    {/* Comment input */}
                    <div style={{
                        display: 'flex', gap: '8px', marginTop: '10px'
                    }}>
                        <input
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendComment();
                                }
                            }}
                            placeholder="Kommentar zum Ticket..."
                            style={{
                                flex: 1, padding: '9px 14px', borderRadius: '8px',
                                border: '1px solid var(--border-color)', outline: 'none',
                                fontSize: '0.85rem', fontFamily: 'inherit',
                                backgroundColor: 'var(--background-color)'
                            }}
                        />
                        <button
                            onClick={handleSendComment}
                            disabled={!newComment.trim() || sendingComment}
                            style={{
                                padding: '9px 16px', borderRadius: '8px',
                                backgroundColor: newComment.trim() ? '#F97316' : 'var(--border-color)',
                                color: 'white', border: 'none', fontWeight: 600,
                                fontSize: '0.82rem', cursor: newComment.trim() ? 'pointer' : 'default',
                                transition: 'all 0.2s', whiteSpace: 'nowrap'
                            }}
                        >
                            {sendingComment ? '...' : 'Senden'}
                        </button>
                    </div>
                </div>

                {/* ── DELETE BUTTON (only for completed tickets) ── */}
                {ticket.status === 'completed' && (
                    <div style={{
                        borderTop: '1px solid var(--border-color)',
                        paddingTop: '16px', marginTop: '8px'
                    }}>
                        {!confirmDelete ? (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                style={{
                                    width: '100%', padding: '10px',
                                    backgroundColor: 'var(--surface-color)', color: '#DC2626',
                                    border: '1px solid #FECACA', borderRadius: 'var(--radius-md)',
                                    fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                🗑️ Ticket löschen
                            </button>
                        ) : (
                            <div style={{
                                padding: '14px', backgroundColor: 'var(--surface-color)',
                                borderRadius: 'var(--radius-md)', border: '1px solid #FECACA',
                                textAlign: 'center'
                            }}>
                                <p style={{ fontSize: '0.85rem', color: '#991B1B', marginBottom: '12px', fontWeight: 500 }}>
                                    Ticket endgültig löschen? Das kann nicht rückgängig gemacht werden.
                                </p>
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                    <button
                                        onClick={() => setConfirmDelete(false)}
                                        style={{
                                            padding: '8px 20px', borderRadius: '6px',
                                            backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                                            fontSize: '0.82rem', cursor: 'pointer'
                                        }}
                                    >
                                        Abbrechen
                                    </button>
                                    <button
                                        onClick={() => onDelete(ticket.id)}
                                        style={{
                                            padding: '8px 20px', borderRadius: '6px',
                                            backgroundColor: '#DC2626', color: 'white', border: 'none',
                                            fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer'
                                        }}
                                    >
                                        Ja, löschen
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TicketKanban;
