import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { translateError } from '../../lib/errorTranslator';
import { extractStoragePath } from '../../lib/storageFiles';
import { Pin, Calendar, Megaphone, FileText, Paperclip } from 'lucide-react';

// Als "Neu" gelten Aushänge der letzten 7 Tage
const NEW_BADGE_DAYS = 7;

const isRecent = (createdAt) => {
    if (!createdAt) return false;
    const ageMs = Date.now() - new Date(createdAt).getTime();
    return ageMs >= 0 && ageMs < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
};

const TenantAnnouncements = () => {
    const { roleData } = useAuth();
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState(null);

    const propertyId = roleData?.property_id;

    useEffect(() => {
        let cancelled = false;
        const loadAnnouncements = async () => {
            if (!propertyId) {
                setLoading(false);
                return;
            }

            const { data, error } = await supabase
                .from('announcements')
                .select('*')
                .eq('property_id', propertyId)
                .order('created_at', { ascending: false });

            if (cancelled) return;
            if (error) {
                console.error('Error:', error);
                setErrorMessage(`Aushänge konnten nicht geladen werden: ${translateError(error)}`);
            } else {
                setErrorMessage(null);
            }
            setAnnouncements(data || []);
            setLoading(false);
        };
        loadAnnouncements();
        return () => { cancelled = true; };
    }, [propertyId]);

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'long', year: 'numeric'
    });

    const formatTime = (d) => new Date(d).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit'
    });

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
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Pinnwand</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Aushänge und Mitteilungen Ihrer Hausverwaltung
                </p>
            </div>

            {errorMessage && (
                <div role="alert" style={{
                    padding: '10px 14px', marginBottom: '16px', borderRadius: 'var(--radius-md)',
                    border: '1px solid #FECACA', backgroundColor: 'var(--surface-color)',
                    color: '#B91C1C', fontSize: '0.85rem'
                }}>
                    {errorMessage}
                </div>
            )}

            {announcements.length === 0 ? (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '60px 40px', textAlign: 'center'
                }}>
                    <Megaphone size={48} color="var(--border-color)" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                        Keine Aushänge vorhanden.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {announcements.map((a) => {
                        const isNew = isRecent(a.created_at);
                        return (
                        <div key={a.id} style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)',
                            overflow: 'hidden',
                            borderLeft: isNew ? '4px solid var(--primary-color)' : '4px solid var(--border-color)'
                        }}>
                            {/* Header */}
                            <div style={{
                                padding: '16px 22px 12px',
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{
                                        width: '32px', height: '32px', borderRadius: '8px',
                                        backgroundColor: isNew ? '#EFF6FF' : '#F8FAFC',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: isNew ? 'var(--primary-color)' : 'var(--text-secondary)'
                                    }}>
                                        <Pin size={16} />
                                    </div>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{a.title}</h3>
                                    {isNew && (
                                        <span style={{
                                            padding: '2px 8px', borderRadius: '10px',
                                            fontSize: '0.65rem', fontWeight: 600,
                                            backgroundColor: '#DBEAFE', color: '#2563EB',
                                            textTransform: 'uppercase', letterSpacing: '0.5px'
                                        }}>
                                            Neu
                                        </span>
                                    )}
                                </div>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    fontSize: '0.75rem', color: 'var(--text-secondary)'
                                }}>
                                    <Calendar size={12} />
                                    {formatDate(a.created_at)}, {formatTime(a.created_at)}
                                </div>
                            </div>

                            {/* Content */}
                            <div style={{
                                padding: '0 22px 18px',
                                fontSize: '0.88rem', lineHeight: 1.7,
                                color: 'var(--text-primary)',
                                whiteSpace: 'pre-wrap'
                            }}>
                                {a.content}
                            </div>

                            {/* Attachments */}
                            {Array.isArray(a.attachments) && a.attachments.length > 0 && (
                                <div style={{
                                    padding: '0 22px 18px',
                                    display: 'flex', flexWrap: 'wrap', gap: '8px'
                                }}>
                                    {a.attachments.filter(Boolean).map((att, attIdx) => (
                                        <SignedAttachmentItem key={attIdx} att={att} />
                                    ))}
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// Display attachment with signed URL
// Nur Pfade des Buckets 'announcements' werden signiert; fehlender Pfad oder fremde
// Adresse -> Hinweis statt Link (kein Absturz, kein Link auf '#').
const SignedAttachmentItem = ({ att }) => {
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const storagePath = extractStoragePath(att?.path, 'announcements');
    const displayName = att?.name || 'Datei';
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att?.name || att?.path || '');
    const isPdf = /\.pdf$/i.test(att?.name || att?.path || '');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!storagePath) {
                setLoading(false);
                return;
            }
            const { data, error } = await supabase.storage
                .from('announcements')
                .createSignedUrl(storagePath, 3600);
            if (cancelled) return;
            if (error) console.error('Error signing attachment:', error);
            if (data?.signedUrl) setUrl(data.signedUrl);
            setLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [storagePath]);

    if (loading) {
        return (
            <div style={{
                width: isImage ? '120px' : 'auto', height: isImage ? '80px' : 'auto',
                borderRadius: '8px', backgroundColor: 'var(--background-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border-color)',
                padding: isImage ? 0 : '6px 10px',
                fontSize: '0.72rem', color: 'var(--text-secondary)'
            }}>
                Laden...
            </div>
        );
    }

    if (!url) {
        return (
            <span
                title="Der Anhang ist nicht verfügbar."
                style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 12px', borderRadius: '8px',
                    backgroundColor: '#F8FAFC', border: '1px dashed var(--border-color)',
                    fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'not-allowed'
                }}
            >
                <Paperclip size={14} />
                {displayName} (nicht verfügbar)
            </span>
        );
    }

    if (isImage) {
        return (
            <img
                src={url}
                alt={displayName}
                onClick={() => window.open(url, '_blank', 'noopener')}
                style={{
                    width: '120px', height: '80px', objectFit: 'cover',
                    borderRadius: '8px', cursor: 'pointer',
                    border: '1px solid var(--border-color)'
                }}
            />
        );
    }

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 12px', borderRadius: '8px',
                backgroundColor: isPdf ? '#FEF2F2' : '#F8FAFC',
                border: `1px solid ${isPdf ? '#FECACA' : 'var(--border-color)'}`,
                fontSize: '0.78rem', color: isPdf ? '#DC2626' : 'var(--primary-color)',
                textDecoration: 'none', cursor: 'pointer'
            }}
        >
            {isPdf ? <FileText size={14} /> : <Paperclip size={14} />}
            {att.name || 'Datei'}
        </a>
    );
};

export default TenantAnnouncements;

