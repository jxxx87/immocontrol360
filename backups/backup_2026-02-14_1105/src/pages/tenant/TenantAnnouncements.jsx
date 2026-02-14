import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Pin, Calendar, Megaphone, FileText, Paperclip } from 'lucide-react';

const TenantAnnouncements = () => {
    const { user, roleData } = useAuth();
    const [announcements, setAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetch = async () => {
            if (!roleData?.property_id) {
                setLoading(false);
                return;
            }

            const { data, error } = await supabase
                .from('announcements')
                .select('*')
                .eq('property_id', roleData.property_id)
                .order('created_at', { ascending: false });

            if (error) console.error('Error:', error);
            setAnnouncements(data || []);
            setLoading(false);
        };
        fetch();
    }, [roleData]);

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
                    {announcements.map((a, idx) => (
                        <div key={a.id} style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)',
                            overflow: 'hidden',
                            borderLeft: idx === 0 ? '4px solid var(--primary-color)' : '4px solid var(--border-color)'
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
                                        backgroundColor: idx === 0 ? '#EFF6FF' : '#F8FAFC',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: idx === 0 ? 'var(--primary-color)' : 'var(--text-secondary)'
                                    }}>
                                        <Pin size={16} />
                                    </div>
                                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{a.title}</h3>
                                    {idx === 0 && (
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
                            {a.attachments && a.attachments.length > 0 && (
                                <div style={{
                                    padding: '0 22px 18px',
                                    display: 'flex', flexWrap: 'wrap', gap: '8px'
                                }}>
                                    {a.attachments.map((att, attIdx) => (
                                        <SignedAttachmentItem key={attIdx} att={att} />
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Display attachment with signed URL
const SignedAttachmentItem = ({ att }) => {
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att.name || att.path);
    const isPdf = /\.pdf$/i.test(att.name || att.path);

    useEffect(() => {
        const load = async () => {
            if (att.path.startsWith('http')) {
                setUrl(att.path);
                setLoading(false);
                return;
            }
            const { data } = await supabase.storage
                .from('announcements')
                .createSignedUrl(att.path, 3600);
            if (data?.signedUrl) setUrl(data.signedUrl);
            setLoading(false);
        };
        load();
    }, [att.path]);

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

    if (isImage && url) {
        return (
            <img
                src={url}
                alt={att.name}
                onClick={() => window.open(url, '_blank')}
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
            href={url || '#'}
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

