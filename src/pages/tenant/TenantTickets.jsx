import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { translateError } from '../../lib/errorTranslator';
import {
    FILE_RULES, acceptAttribute, validateUploadFile, buildStorageObjectName,
    prepareUploadBody, extractStoragePath
} from '../../lib/storageFiles';
import {
    Plus, X, Upload, Clock, AlertCircle,
    CheckCircle2, TicketCheck, ChevronRight, Loader
} from 'lucide-react';

const TICKET_BUCKET = 'tickets';
const MANAGER_COMMENT_PREFIX = '💬';

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

const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

const ErrorNote = ({ message }) => (
    <div role="alert" style={{
        padding: '10px 14px', borderRadius: 'var(--radius-md)',
        border: '1px solid #FECACA', backgroundColor: 'var(--surface-color)',
        color: '#B91C1C', fontSize: '0.82rem', whiteSpace: 'pre-wrap'
    }}>
        {message}
    </div>
);

const TenantTickets = () => {
    const { user, roleData } = useAuth();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true); // nur beim ersten Laden
    const [loadError, setLoadError] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    // Nur die ID merken; das Ticket wird aus der aktuellen Liste abgeleitet (sonst
    // zeigt das Detailfenster nach einem Statuswechsel den alten Stand)
    const [selectedTicketId, setSelectedTicketId] = useState(null);
    const [form, setForm] = useState({ title: '', description: '', priority: 'normal' });
    const [uploadFiles, setUploadFiles] = useState([]); // [{ file, previewUrl }]
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState(null);
    const fileInputRef = useRef(null);
    const previewUrlsRef = useRef([]);

    const userId = user?.id;
    const selectedTicket = selectedTicketId ? tickets.find(t => t.id === selectedTicketId) || null : null;

    // Vorschau-URLs beim Verlassen der Seite freigeben
    useEffect(() => () => {
        previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        previewUrlsRef.current = [];
    }, []);

    // ── FETCH TICKETS ───────────────────────────────────────────────
    // Folgeabrufe (Realtime) laufen im Hintergrund, ohne die Seite durch den
    // Lade-Zustand zu ersetzen – offene Fenster und Eingaben bleiben erhalten.
    const fetchTickets = useCallback(async () => {
        if (!userId) return;

        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('tenant_user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error:', error);
            setLoadError(`Tickets konnten nicht geladen werden: ${translateError(error)}`);
        } else {
            setLoadError(null);
            setTickets(data || []);
        }
        setLoading(false);
    }, [userId]);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);

    // ── REALTIME UPDATES ────────────────────────────────────────────
    useEffect(() => {
        if (!userId) return;

        const channel = supabase
            .channel('tenant-tickets')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'tickets',
                filter: `tenant_user_id=eq.${userId}`
            }, () => {
                fetchTickets();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [userId, fetchTickets]);

    // ── PHOTO SELECTION ─────────────────────────────────────────────
    const addFiles = (fileList) => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        const errors = [];
        const accepted = [];
        files.forEach(file => {
            const validationError = validateUploadFile(file, FILE_RULES.ticketImages);
            if (validationError) {
                errors.push(validationError);
            } else {
                accepted.push(file);
            }
        });

        const free = FILE_RULES.ticketImages.maxFiles - uploadFiles.length;
        if (accepted.length > free) {
            errors.push(`Es sind höchstens ${FILE_RULES.ticketImages.maxFiles} Fotos je Ticket möglich.`);
            accepted.splice(Math.max(free, 0));
        }

        const items = accepted.map(file => {
            const previewUrl = URL.createObjectURL(file);
            previewUrlsRef.current.push(previewUrl);
            return { file, previewUrl };
        });
        setUploadFiles(prev => [...prev, ...items]);
        setCreateError(errors.length > 0 ? errors.join('\n') : null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const releasePreview = (url) => {
        URL.revokeObjectURL(url);
        previewUrlsRef.current = previewUrlsRef.current.filter(u => u !== url);
    };

    const removeFile = (idx) => {
        const item = uploadFiles[idx];
        if (item) releasePreview(item.previewUrl);
        setUploadFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const clearFiles = () => {
        uploadFiles.forEach(item => releasePreview(item.previewUrl));
        setUploadFiles([]);
    };

    const removeUploadedPhotos = async (paths) => {
        if (paths.length === 0) return;
        const { error } = await supabase.storage.from(TICKET_BUCKET).remove(paths);
        if (error) console.error('Cleanup error:', error);
    };

    // ── CREATE TICKET ───────────────────────────────────────────────
    const handleCreate = async () => {
        if (!form.title.trim() || creating) return;

        const propertyId = roleData?.property_id;
        const unitId = roleData?.unit_id;
        if (!userId || !propertyId || !unitId) {
            setCreateError('Ihr Konto ist keiner Wohnung zugeordnet. Bitte wenden Sie sich an Ihre Hausverwaltung.');
            return;
        }

        setCreating(true);
        setCreateError(null);
        const uploadedPaths = [];

        try {
            // Upload images
            // Pfad: <objekt>/<einheit>/<eigene user-id>/<zufalls-id>.<endung>
            for (const { file } of uploadFiles) {
                const filePath = `${propertyId}/${unitId}/${userId}/${buildStorageObjectName(file)}`;
                const { body, contentType } = prepareUploadBody(file);
                const { error: uploadError } = await supabase.storage
                    .from(TICKET_BUCKET)
                    .upload(filePath, body, { contentType });

                if (uploadError) {
                    console.error('Upload error:', uploadError);
                    await removeUploadedPhotos(uploadedPaths);
                    setCreateError(`Das Foto „${file.name}“ konnte nicht hochgeladen werden: ${translateError(uploadError)}\nDas Ticket wurde noch nicht erstellt.`);
                    return;
                }
                // Store file path, not public URL (bucket is private)
                uploadedPaths.push(filePath);
            }

            const { error } = await supabase.from('tickets').insert({
                unit_id: unitId,
                property_id: propertyId,
                tenant_user_id: userId,
                title: form.title.trim(),
                description: form.description.trim() || null,
                priority: form.priority,
                images: uploadedPaths
            });

            if (error) {
                await removeUploadedPhotos(uploadedPaths);
                throw error;
            }

            setForm({ title: '', description: '', priority: 'normal' });
            clearFiles();
            setShowCreate(false);
            fetchTickets();
        } catch (err) {
            console.error('Error creating ticket:', err);
            setCreateError(`Fehler beim Erstellen des Tickets: ${translateError(err)}`);
        } finally {
            setCreating(false);
        }
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
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Meine Tickets</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        Erstellen Sie Tickets für Reparaturen und Anfragen.
                    </p>
                </div>
                <button
                    onClick={() => { setCreateError(null); setShowCreate(true); }}
                    className="btn btn-primary btn-md"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    <Plus size={18} /> Neues Ticket
                </button>
            </div>

            {loadError && (
                <div style={{ marginBottom: '16px' }}>
                    <ErrorNote message={loadError} />
                </div>
            )}

            {/* Ticket List */}
            {tickets.length === 0 ? (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
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
                                onClick={() => setSelectedTicketId(ticket.id)}
                                style={{
                                    backgroundColor: 'var(--surface-color)',
                                    borderRadius: 'var(--radius-lg)',
                                    boxShadow: 'var(--shadow-md)',
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
                                    Fotos <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>(max. {FILE_RULES.ticketImages.maxFiles}, je bis 10 MB)</span>
                                </label>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept={`image/*,${acceptAttribute(FILE_RULES.ticketImages)}`}
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => addFiles(e.target.files)}
                                />
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {uploadFiles.map((item, idx) => (
                                        <div key={item.previewUrl} style={{
                                            position: 'relative', width: '70px', height: '70px',
                                            borderRadius: '8px', overflow: 'hidden',
                                            border: '1px solid var(--border-color)'
                                        }}>
                                            <img
                                                src={item.previewUrl}
                                                alt=""
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                            <button
                                                onClick={() => removeFile(idx)}
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
                                    {uploadFiles.length < FILE_RULES.ticketImages.maxFiles && (
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
                                    )}
                                </div>
                            </div>

                            {createError && <ErrorNote message={createError} />}
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
                <TenantTicketDetail
                    key={selectedTicket.id}
                    ticket={selectedTicket}
                    userId={userId}
                    onClose={() => setSelectedTicketId(null)}
                />
            )}
        </div>
    );
};

// ── TICKET DETAIL MODAL ─────────────────────────────────────────────
const TenantTicketDetail = ({ ticket, userId, onClose }) => {
    const { comments, loading: loadingComments, error: commentsError, appendComment } = useTicketComments(ticket.id);
    const currentStatus = statusConfig[ticket.status] || statusConfig.received;

    return (
        <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }} onClick={onClose}>
            <div
                style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    width: '100%', maxWidth: '600px', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column',
                    boxShadow: 'var(--shadow-lg)',
                    overflow: 'hidden',
                    margin: '0 10px'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Fixed Header */}
                <div style={{ padding: '20px 24px 12px', flexShrink: 0, borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{ticket.title}</h2>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '3px 10px', borderRadius: '12px', marginTop: '8px',
                                fontSize: '0.75rem', fontWeight: 500,
                                backgroundColor: currentStatus.bg,
                                color: currentStatus.color
                            }}>
                                {React.createElement(currentStatus.icon || Clock, { size: 12 })}
                                {currentStatus.label}
                            </span>
                        </div>
                        <button onClick={onClose} style={{ color: 'var(--text-secondary)', cursor: 'pointer', background: 'none', border: 'none' }}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                    {/* Progress Bar */}
                    <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            {Object.values(statusConfig).map((s, i) => (
                                <div key={i} style={{
                                    fontSize: '0.72rem', color: s.step <= currentStatus.step ? s.color : 'var(--text-secondary)',
                                    fontWeight: s.step === currentStatus.step ? 600 : 400,
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
                                    backgroundColor: step <= currentStatus.step
                                        ? currentStatus.color
                                        : '#E5E7EB',
                                    transition: 'all 0.4s'
                                }} />
                            ))}
                        </div>
                    </div>

                    {ticket.description && (
                        <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                Beschreibung
                            </h4>
                            <p style={{ fontSize: '0.88rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                {ticket.description}
                            </p>
                        </div>
                    )}

                    {ticket.images?.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                            <h4 style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '10px', color: 'var(--text-secondary)' }}>
                                Fotos
                            </h4>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {ticket.images.map((path, idx) => (
                                    <SignedTicketImage key={`${path}-${idx}`} path={path} idx={idx} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── VERLAUF (timeline only, no input) ── */}
                    <TicketVerlauf
                        ticket={ticket}
                        userId={userId}
                        comments={comments}
                        loadingComments={loadingComments}
                        commentsError={commentsError}
                    />

                    <div style={{
                        fontSize: '0.75rem', color: 'var(--text-secondary)',
                        borderTop: '1px solid var(--border-color)',
                        paddingTop: '14px', marginTop: '10px'
                    }}>
                        Erstellt am {formatDate(ticket.created_at)} •
                        Priorität: {priorityConfig[ticket.priority]?.label || 'Normal'}
                    </div>
                </div>

                {/* Fixed Comment Input Footer */}
                <TicketCommentInput ticket={ticket} userId={userId} comments={comments} onSent={appendComment} />
            </div>
        </div>
    );
};

// Kommentare (messages mit ticket_id) eines Tickets inkl. Realtime-Aktualisierung
const useTicketComments = (ticketId) => {
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const { data, error: loadError } = await supabase
                .from('messages')
                .select('*')
                .eq('ticket_id', ticketId)
                .order('created_at', { ascending: true });
            if (cancelled) return;
            if (loadError) {
                console.error('Error loading comments:', loadError);
                setError(`Verlauf konnte nicht geladen werden: ${translateError(loadError)}`);
            } else {
                setError(null);
                setComments(prev => {
                    // Bereits per Realtime/optimistisch angehängte Einträge behalten
                    const loaded = data || [];
                    const extra = prev.filter(p => !loaded.some(l => l.id === p.id));
                    return [...loaded, ...extra];
                });
            }
            setLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [ticketId]);

    const appendComment = useCallback((msg) => {
        if (!msg) return;
        setComments(prev => (prev.some(c => c.id === msg.id) ? prev : [...prev, msg]));
    }, []);

    // Realtime subscription for new comments
    useEffect(() => {
        let aborted = false;
        let channel = null;

        const timer = setTimeout(() => {
            if (aborted) return;
            channel = supabase
                .channel('tenant-ticket-comments-' + ticketId + '-' + Date.now())
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `ticket_id=eq.${ticketId}`
                }, (payload) => {
                    appendComment(payload.new);
                })
                .subscribe();
        }, 150);

        return () => {
            aborted = true;
            clearTimeout(timer);
            if (channel) supabase.removeChannel(channel);
        };
    }, [ticketId, appendComment]);

    return { comments, loading, error, appendComment };
};

// Component to display ticket images from private bucket with signed URLs
const SignedTicketImage = ({ path, idx }) => {
    const [url, setUrl] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const fetchUrl = async () => {
            // Legacy: vollständige Storage-URL -> Pfad; fremde Adressen werden nicht angezeigt
            const filePath = extractStoragePath(path, TICKET_BUCKET);
            if (!filePath) {
                setFailed(true);
                return;
            }
            const { data, error } = await supabase.storage
                .from(TICKET_BUCKET)
                .createSignedUrl(filePath, 3600);
            if (cancelled) return;
            if (data?.signedUrl) {
                setUrl(data.signedUrl);
            } else {
                if (error) console.error('Error signing ticket image:', error);
                setFailed(true);
            }
        };
        fetchUrl();
        return () => { cancelled = true; };
    }, [path]);

    if (!url) {
        return (
            <div style={{
                width: '120px', height: '90px', borderRadius: '8px',
                backgroundColor: 'var(--background-color)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border-color)',
                fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '4px'
            }}>
                {failed ? 'Foto nicht verfügbar' : 'Laden...'}
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
            onClick={() => window.open(url, '_blank', 'noopener')}
        />
    );
};

// ── TICKET VERLAUF (Timeline + Comments) for Tenant ─────────────────
// Reine Anzeige; gesendet wird über TicketCommentInput (eine Sendelogik).
const TicketVerlauf = ({ ticket, userId, comments, loadingComments, commentsError }) => {
    const verlaufEndRef = useRef(null);

    // Auto-scroll to latest comment
    useEffect(() => {
        const timer = setTimeout(() => {
            verlaufEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        return () => clearTimeout(timer);
    }, [comments, loadingComments]);

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

            {commentsError && (
                <div style={{ marginBottom: '8px' }}>
                    <ErrorNote message={commentsError} />
                </div>
            )}

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
                        const isMine = msg.sender_id === userId;
                        // System-Hinweise kommen nur von der Verwaltung, nie vom Mieter selbst
                        const isSystem = !!msg.is_system && !isMine;
                        const text = msg.text || '';
                        const isManagerComment = !isMine && text.startsWith(MANAGER_COMMENT_PREFIX);

                        let bgColor, borderColor, dotColor, textColor, label;
                        if (isSystem && !isManagerComment) {
                            bgColor = '#EFF6FF'; borderColor = '#BFDBFE'; dotColor = '#3B82F6'; textColor = '#1E40AF';
                            label = '📋 Statusänderung';
                        } else if (isMine) {
                            bgColor = '#F9FAFB'; borderColor = '#E5E7EB'; dotColor = '#6B7280'; textColor = '#374151';
                            label = '👤 Mein Kommentar';
                        } else {
                            bgColor = '#FFF7ED'; borderColor = '#FED7AA'; dotColor = '#F97316'; textColor = '#C2410C';
                            label = isManagerComment ? '🔧 Verwalter-Kommentar' : '🔧 Verwalter';
                        }

                        // Verwalter-Kommentare beginnen mit einer Kopfzeile ("💬 Kommentar zu Ticket ...")
                        let displayText = text;
                        if (isManagerComment) {
                            const lines = text.split('\n');
                            displayText = lines.length > 1 ? lines.slice(1).join('\n') : text;
                        }
                        if (!displayText && msg.attachment_url) {
                            displayText = '📎 Anhang (im Chat unter „Nachrichten“ ansehen)';
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
        </div>
    );
};

// Empfänger eines Ticket-Kommentars ermitteln:
// 1. Eigentümer des Objekts (über get_my_landlord_info – auch ohne bisherige Nachrichten)
// 2. Verwalter, der in diesem Ticket zuletzt geschrieben hat
// 3. Gesprächspartner der jüngsten eigenen Unterhaltung
const resolveTicketRecipient = async (ticket, userId, comments) => {
    if (ticket.property_id) {
        // Nur die Vermieter-ID zum Ticket-Objekt (keine ganze Objektzeile;
        // Mieter lesen properties/units nicht direkt)
        const { data: info, error: infoError } = await supabase
            .rpc('get_my_landlord_info', { p_property_id: ticket.property_id });
        if (infoError) {
            console.error('Error loading landlord:', infoError);
        } else if (info?.landlord_user_id && info.landlord_user_id !== userId) {
            return info.landlord_user_id;
        }
    }

    const lastOther = [...comments].reverse().find(m => m.sender_id !== userId);
    if (lastOther) return lastOther.sender_id;

    const { data: msgs, error: msgError } = await supabase
        .from('messages')
        .select('sender_id, receiver_id')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(1);
    if (msgError) console.error('Error loading messages:', msgError);
    if (msgs && msgs.length > 0) {
        const other = msgs[0].sender_id === userId ? msgs[0].receiver_id : msgs[0].sender_id;
        if (other && other !== userId) return other;
    }
    return null;
};

// ── STANDALONE COMMENT INPUT (for fixed footer in modal) ────────────
const TicketCommentInput = ({ ticket, userId, comments, onSent }) => {
    const [newComment, setNewComment] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState(null);

    const handleSendComment = async () => {
        const text = newComment.trim();
        if (!text || sending) return;
        setSending(true);
        setSendError(null);

        try {
            const receiverId = await resolveTicketRecipient(ticket, userId, comments);

            if (!receiverId) {
                setSendError('Ihr Verwalter konnte nicht ermittelt werden. Der Kommentar wurde nicht gesendet – bitte versuchen Sie es später erneut.');
                return;
            }

            const { data: inserted, error } = await supabase
                .from('messages')
                .insert({
                    sender_id: userId,
                    receiver_id: receiverId,
                    text,
                    ticket_id: ticket.id,
                    is_system: false
                })
                .select()
                .single();

            if (error) throw error;

            onSent?.(inserted);
            // Nur leeren, wenn während des Sendens nichts Neues getippt wurde
            setNewComment(current => (current.trim() === text ? '' : current));
        } catch (err) {
            console.error('Error sending comment:', err);
            setSendError(`Der Kommentar konnte nicht gesendet werden: ${translateError(err)}`);
        } finally {
            setSending(false);
        }
    };

    return (
        <div style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--surface-color)',
            flexShrink: 0
        }}>
            {sendError && (
                <div style={{ marginBottom: '8px' }}>
                    <ErrorNote message={sendError} />
                </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
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
