import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
    Plus, X, Megaphone, Calendar, Edit2, Trash2, Pin, Building2,
    Upload, FileText, Image as ImageIcon, Paperclip
} from 'lucide-react';

const Announcements = () => {
    const { user } = useAuth();
    const [announcements, setAnnouncements] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState({ title: '', content: '', property_id: '' });
    const [uploadFiles, setUploadFiles] = useState([]);
    const [existingAttachments, setExistingAttachments] = useState([]);
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef(null);

    const fetchData = async () => {
        setLoading(true);
        const [annRes, propRes] = await Promise.all([
            supabase.from('announcements').select('*, property:properties(street, house_number, city)').order('created_at', { ascending: false }),
            supabase.from('properties').select('id, street, house_number, city').order('street')
        ]);
        setAnnouncements(annRes.data || []);
        setProperties(propRes.data || []);
        setLoading(false);
    };

    useEffect(() => { fetchData(); }, []);

    const handleSave = async () => {
        if (!form.title.trim() || !form.content.trim() || !form.property_id || saving) return;
        setSaving(true);

        try {
            // Upload new files
            const newPaths = [];
            for (const file of uploadFiles) {
                const timestamp = Date.now();
                const filePath = `${form.property_id}/${timestamp}_${file.name}`;
                const { error: uploadError } = await supabase.storage
                    .from('announcements')
                    .upload(filePath, file);
                if (!uploadError) {
                    newPaths.push({ path: filePath, name: file.name, type: file.type });
                }
            }

            const allAttachments = [...existingAttachments, ...newPaths];

            if (editId) {
                await supabase.from('announcements').update({
                    title: form.title, content: form.content,
                    property_id: form.property_id,
                    attachments: allAttachments,
                    updated_at: new Date().toISOString()
                }).eq('id', editId);
            } else {
                await supabase.from('announcements').insert({
                    title: form.title, content: form.content,
                    property_id: form.property_id, created_by: user.id,
                    attachments: allAttachments
                });
            }

            setShowForm(false);
            setEditId(null);
            setForm({ title: '', content: '', property_id: '' });
            setUploadFiles([]);
            setExistingAttachments([]);
            fetchData();
        } catch (err) {
            console.error('Error saving:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = (a) => {
        setForm({ title: a.title, content: a.content, property_id: a.property_id });
        setExistingAttachments(a.attachments || []);
        setUploadFiles([]);
        setEditId(a.id);
        setShowForm(true);
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Aushang wirklich löschen?')) return;
        await supabase.from('announcements').delete().eq('id', id);
        fetchData();
    };

    const removeExistingAttachment = (idx) => {
        setExistingAttachments(prev => prev.filter((_, i) => i !== idx));
    };

    const removeNewFile = (idx) => {
        setUploadFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const getPropertyLabel = (p) => `${p.street} ${p.house_number || ''}, ${p.city}`;

    const isImageFile = (name) => /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
    const isPdfFile = (name) => /\.pdf$/i.test(name);

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
            <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
        </div>;
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Aushänge</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        Erstellen Sie Aushänge für Ihre Mieter.
                    </p>
                </div>
                <button onClick={() => { setShowForm(true); setEditId(null); setForm({ title: '', content: '', property_id: '' }); setUploadFiles([]); setExistingAttachments([]); }}
                    className="btn btn-primary btn-md" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={18} /> Neuer Aushang
                </button>
            </div>

            {announcements.length === 0 ? (
                <div style={{
                    backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)', padding: '60px 40px', textAlign: 'center'
                }}>
                    <Megaphone size={48} color="var(--border-color)" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                        Noch keine Aushänge erstellt.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {announcements.map(a => (
                        <div key={a.id} style={{
                            backgroundColor: 'var(--surface-color)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-color)',
                            padding: '20px 24px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                        <Pin size={16} color="var(--primary-color)" />
                                        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{a.title}</h3>
                                    </div>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '16px',
                                        fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px'
                                    }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Building2 size={12} />
                                            {a.property ? getPropertyLabel(a.property) : '—'}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Calendar size={12} />
                                            {formatDate(a.created_at)}
                                        </span>
                                    </div>
                                    <p style={{
                                        fontSize: '0.88rem', color: 'var(--text-primary)',
                                        lineHeight: 1.6, whiteSpace: 'pre-wrap'
                                    }}>
                                        {a.content}
                                    </p>

                                    {/* Attachments display */}
                                    {a.attachments && a.attachments.length > 0 && (
                                        <div style={{ marginTop: '12px' }}>
                                            <AttachmentGallery attachments={a.attachments} />
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginLeft: '16px' }}>
                                    <button onClick={() => handleEdit(a)}
                                        style={{ color: 'var(--text-secondary)', cursor: 'pointer', background: 'none', border: 'none' }} title="Bearbeiten">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDelete(a.id)}
                                        style={{ color: '#DC2626', cursor: 'pointer', background: 'none', border: 'none' }} title="Löschen">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── FORM MODAL ── */}
            {showForm && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }} onClick={() => setShowForm(false)}>
                    <div style={{
                        backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                        width: '100%', maxWidth: '560px', maxHeight: '90vh', overflow: 'auto',
                        padding: '28px', boxShadow: 'var(--shadow-lg)'
                    }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                                {editId ? 'Aushang bearbeiten' : 'Neuer Aushang'}
                            </h2>
                            <button onClick={() => setShowForm(false)} style={{ color: 'var(--text-secondary)', cursor: 'pointer', background: 'none', border: 'none' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Immobilie *
                                </label>
                                <select value={form.property_id}
                                    onChange={(e) => setForm(prev => ({ ...prev, property_id: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem'
                                    }}>
                                    <option value="">— Immobilie wählen —</option>
                                    {properties.map(p => (
                                        <option key={p.id} value={p.id}>{getPropertyLabel(p)}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Titel *
                                </label>
                                <input type="text" placeholder="z.B. Treppenhausreinigung"
                                    value={form.title}
                                    onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem'
                                    }} />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', display: 'block' }}>
                                    Inhalt *
                                </label>
                                <textarea placeholder="Aushang-Text..."
                                    value={form.content}
                                    onChange={(e) => setForm(prev => ({ ...prev, content: e.target.value }))}
                                    rows={6}
                                    style={{
                                        width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                        resize: 'vertical', fontFamily: 'inherit'
                                    }} />
                            </div>

                            {/* ── FILE UPLOAD ── */}
                            <div>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: '8px', display: 'block' }}>
                                    Anhänge (Bilder & PDF)
                                </label>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/*,.pdf"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const files = Array.from(e.target.files);
                                        if (files.length > 0) {
                                            setUploadFiles(prev => [...prev, ...files]);
                                        }
                                        e.target.value = '';
                                    }}
                                />

                                {/* Existing attachments (during edit) */}
                                {existingAttachments.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                                        {existingAttachments.map((att, idx) => (
                                            <div key={`existing-${idx}`} style={{
                                                position: 'relative', display: 'flex', alignItems: 'center', gap: '6px',
                                                padding: '6px 10px', borderRadius: '8px',
                                                backgroundColor: 'var(--surface-color)', border: '1px solid #BBF7D0',
                                                fontSize: '0.78rem'
                                            }}>
                                                {isImageFile(att.name) ? <ImageIcon size={14} color="#10B981" /> : <FileText size={14} color="#10B981" />}
                                                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {att.name}
                                                </span>
                                                <button onClick={() => removeExistingAttachment(idx)} style={{
                                                    width: '16px', height: '16px', borderRadius: '50%',
                                                    backgroundColor: 'rgba(0,0,0,0.15)', color: 'white',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: 'pointer', border: 'none', fontSize: '10px', flexShrink: 0
                                                }}>×</button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* New files to upload */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {uploadFiles.map((file, idx) => (
                                        <div key={`new-${idx}`} style={{
                                            position: 'relative',
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '6px 10px', borderRadius: '8px',
                                            backgroundColor: 'var(--background-color)', border: '1px solid #BFDBFE',
                                            fontSize: '0.78rem'
                                        }}>
                                            {isImageFile(file.name) ? (
                                                <img src={URL.createObjectURL(file)} alt=""
                                                    style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '4px' }} />
                                            ) : (
                                                <FileText size={14} color="#3B82F6" />
                                            )}
                                            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {file.name}
                                            </span>
                                            <button onClick={() => removeNewFile(idx)} style={{
                                                width: '16px', height: '16px', borderRadius: '50%',
                                                backgroundColor: 'rgba(0,0,0,0.15)', color: 'white',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                cursor: 'pointer', border: 'none', fontSize: '10px', flexShrink: 0
                                            }}>×</button>
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '8px 14px', borderRadius: '8px',
                                            border: '2px dashed var(--border-color)',
                                            backgroundColor: 'var(--background-color)', cursor: 'pointer',
                                            color: 'var(--text-secondary)', fontSize: '0.78rem'
                                        }}
                                    >
                                        <Upload size={14} /> Datei hinzufügen
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '24px' }}>
                            <button onClick={() => setShowForm(false)} className="btn btn-secondary btn-md">Abbrechen</button>
                            <button onClick={handleSave}
                                disabled={!form.title.trim() || !form.content.trim() || !form.property_id || saving}
                                className="btn btn-primary btn-md"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                                {saving && <span style={{ fontSize: '0.8rem' }}>⏳</span>}
                                {editId ? 'Speichern' : 'Aushang erstellen'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ── ATTACHMENT GALLERY (shared display for both investor + tenant views) ──
const AttachmentGallery = ({ attachments }) => {
    const [signedUrls, setSignedUrls] = useState({});

    const getSignedUrl = async (path) => {
        if (signedUrls[path]) return signedUrls[path];
        // If path is already a URL, return directly
        if (path.startsWith('http')) return path;

        const { data } = await supabase.storage
            .from('announcements')
            .createSignedUrl(path, 3600);
        if (data?.signedUrl) {
            setSignedUrls(prev => ({ ...prev, [path]: data.signedUrl }));
            return data.signedUrl;
        }
        return null;
    };

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {attachments.map((att, idx) => (
                <AttachmentItem key={idx} att={att} getSignedUrl={getSignedUrl} />
            ))}
        </div>
    );
};

const AttachmentItem = ({ att, getSignedUrl }) => {
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att.name || att.path);
    const isPdf = /\.pdf$/i.test(att.name || att.path);

    useEffect(() => {
        const load = async () => {
            const signedUrl = await getSignedUrl(att.path);
            setUrl(signedUrl);
            setLoading(false);
        };
        load();
    }, [att.path]);

    if (loading) {
        return (
            <div style={{
                width: isImage ? '120px' : 'auto', height: isImage ? '90px' : 'auto',
                borderRadius: '8px', backgroundColor: 'var(--background-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border-color)',
                padding: isImage ? 0 : '6px 12px',
                fontSize: '0.75rem', color: 'var(--text-secondary)'
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
                    width: '120px', height: '90px', objectFit: 'cover',
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

export default Announcements;
