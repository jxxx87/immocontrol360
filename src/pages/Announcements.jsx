import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import {
    FILE_RULES, acceptAttribute, validateUploadFile, buildStorageObjectName,
    prepareUploadBody, extractStoragePath
} from '../lib/storageFiles';
import {
    Plus, X, Megaphone, Calendar, Edit2, Trash2, Pin, Building2,
    Upload, FileText, Image as ImageIcon, Paperclip, AlertCircle
} from 'lucide-react';

const BUCKET = 'announcements';

// Speicherpfade (nur Bucket-Pfade) einer Anhangsliste
const storagePathsOf = (attachments) => (Array.isArray(attachments) ? attachments : [])
    .map(att => extractStoragePath(att?.path, BUCKET))
    .filter(Boolean);

const removeStorageFiles = async (paths) => {
    if (!paths || paths.length === 0) return;
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.error('Error removing announcement files:', error);
};

const Announcements = () => {
    const { user } = useAuth();
    const [announcements, setAnnouncements] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true); // nur beim ersten Laden
    const [pageError, setPageError] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState({ title: '', content: '', property_id: '' });
    const [uploadFiles, setUploadFiles] = useState([]); // [{ file, previewUrl }]
    const [existingAttachments, setExistingAttachments] = useState([]);
    const [originalAttachments, setOriginalAttachments] = useState([]); // Stand beim Öffnen (Bearbeiten)
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState(null);
    const fileInputRef = useRef(null);
    const previewUrlsRef = useRef([]);

    // Vorschau-URLs beim Verlassen der Seite freigeben
    useEffect(() => () => {
        previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        previewUrlsRef.current = [];
    }, []);

    const fetchData = useCallback(async () => {
        const [annRes, propRes] = await Promise.all([
            supabase.from('announcements').select('*, property:properties(street, house_number, city)').order('created_at', { ascending: false }),
            supabase.from('properties').select('id, street, house_number, city').order('street')
        ]);
        const loadError = annRes.error || propRes.error;
        if (loadError) {
            console.error('Error loading announcements:', loadError);
            setPageError(`Aushänge konnten nicht geladen werden: ${translateError(loadError)}`);
        } else {
            setPageError(null);
            setAnnouncements(annRes.data || []);
            setProperties(propRes.data || []);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ── Dateiauswahl / Vorschau ─────────────────────────────────────
    const releasePreview = (url) => {
        URL.revokeObjectURL(url);
        previewUrlsRef.current = previewUrlsRef.current.filter(u => u !== url);
    };

    const clearNewFiles = () => {
        uploadFiles.forEach(item => releasePreview(item.previewUrl));
        setUploadFiles([]);
    };

    const addFiles = (fileList) => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        const errors = [];
        const items = [];
        files.forEach(file => {
            const validationError = validateUploadFile(file, FILE_RULES.announcements);
            if (validationError) {
                errors.push(validationError);
                return;
            }
            const previewUrl = URL.createObjectURL(file);
            previewUrlsRef.current.push(previewUrl);
            items.push({ file, previewUrl });
        });
        setUploadFiles(prev => [...prev, ...items]);
        setFormError(errors.length > 0 ? errors.join('\n') : null);
    };

    const resetForm = () => {
        setShowForm(false);
        setEditId(null);
        setForm({ title: '', content: '', property_id: '' });
        clearNewFiles();
        setExistingAttachments([]);
        setOriginalAttachments([]);
        setFormError(null);
    };

    // Speichern: Bei Fehlern bleibt das Formular offen, bereits hochgeladene Dateien
    // werden wieder entfernt und der Nutzer sieht eine Meldung.
    const handleSave = async () => {
        if (!form.title.trim() || !form.content.trim() || !form.property_id || saving) return;
        setSaving(true);
        setFormError(null);

        const propertyId = form.property_id;
        const createdPaths = []; // in diesem Vorgang neu angelegte Dateien (für Rücknahme)

        try {
            // Wurde die Immobilie gewechselt, Anhänge in den Ordner der neuen Immobilie
            // kopieren – sonst können deren Mieter sie nicht öffnen.
            const keptAttachments = [];
            for (const att of existingAttachments) {
                const oldPath = extractStoragePath(att?.path, BUCKET);
                if (!oldPath || oldPath.startsWith(`${propertyId}/`)) {
                    keptAttachments.push(att);
                    continue;
                }
                const newPath = `${propertyId}/${buildStorageObjectName(att.name || oldPath)}`;
                const { error: copyError } = await supabase.storage.from(BUCKET).copy(oldPath, newPath);
                if (copyError) {
                    throw new Error(`Anhang „${att.name || 'Datei'}“ konnte nicht in die neue Immobilie übernommen werden: ${translateError(copyError)}`);
                }
                createdPaths.push(newPath);
                keptAttachments.push({ ...att, path: newPath });
            }

            // Upload new files
            const newPaths = [];
            for (const { file } of uploadFiles) {
                const filePath = `${propertyId}/${buildStorageObjectName(file)}`;
                const { body, contentType } = prepareUploadBody(file);
                const { error: uploadError } = await supabase.storage
                    .from(BUCKET)
                    .upload(filePath, body, { contentType });
                if (uploadError) {
                    throw new Error(`„${file.name}“ konnte nicht hochgeladen werden: ${translateError(uploadError)}`);
                }
                createdPaths.push(filePath);
                newPaths.push({ path: filePath, name: file.name, type: contentType });
            }

            const allAttachments = [...keptAttachments, ...newPaths];

            if (editId) {
                const { data: updated, error } = await supabase.from('announcements').update({
                    title: form.title, content: form.content,
                    property_id: propertyId,
                    attachments: allAttachments,
                    updated_at: new Date().toISOString()
                }).eq('id', editId).select('id');
                if (error) throw error;
                if (!updated || updated.length === 0) {
                    throw new Error('Der Aushang konnte nicht gespeichert werden (keine Berechtigung).');
                }
            } else {
                const { error } = await supabase.from('announcements').insert({
                    title: form.title, content: form.content,
                    property_id: propertyId, created_by: user.id,
                    attachments: allAttachments
                });
                if (error) throw error;
            }

            // Nicht mehr verwendete Dateien entfernen (entfernte Anhänge, alte Kopien)
            const stillUsed = new Set(storagePathsOf(allAttachments));
            const obsolete = storagePathsOf(originalAttachments).filter(p => !stillUsed.has(p));
            await removeStorageFiles(obsolete);

            resetForm();
            fetchData();
        } catch (err) {
            console.error('Error saving:', err);
            await removeStorageFiles(createdPaths);
            setFormError(err?.message && !err.code ? err.message : `Fehler beim Speichern: ${translateError(err)}`);
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = (a) => {
        setForm({ title: a.title, content: a.content, property_id: a.property_id });
        const attachments = Array.isArray(a.attachments) ? a.attachments.filter(Boolean) : [];
        setExistingAttachments(attachments);
        setOriginalAttachments(attachments);
        clearNewFiles();
        setFormError(null);
        setEditId(a.id);
        setShowForm(true);
    };

    const handleDelete = async (announcement) => {
        if (!window.confirm('Aushang wirklich löschen?')) return;
        setPageError(null);
        const { data: deleted, error } = await supabase
            .from('announcements')
            .delete()
            .eq('id', announcement.id)
            .select('id');
        if (error) {
            console.error('Error deleting announcement:', error);
            setPageError(`Der Aushang konnte nicht gelöscht werden: ${translateError(error)}`);
            return;
        }
        if (!deleted || deleted.length === 0) {
            setPageError('Der Aushang konnte nicht gelöscht werden (keine Berechtigung).');
            return;
        }
        // Anhänge ebenfalls aus dem Speicher entfernen
        await removeStorageFiles(storagePathsOf(announcement.attachments));
        fetchData();
    };

    const removeExistingAttachment = (idx) => {
        setExistingAttachments(prev => prev.filter((_, i) => i !== idx));
    };

    const removeNewFile = (idx) => {
        const item = uploadFiles[idx];
        if (item) releasePreview(item.previewUrl);
        setUploadFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const getPropertyLabel = (p) => `${p.street} ${p.house_number || ''}, ${p.city}`;

    const isImageFile = (name) => /\.(jpg|jpeg|png|gif|webp)$/i.test(name || '');

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
                <button onClick={() => { resetForm(); setShowForm(true); }}
                    className="btn btn-primary btn-md" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={18} /> Neuer Aushang
                </button>
            </div>

            {pageError && (
                <div role="alert" style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 14px', marginBottom: '16px', borderRadius: 'var(--radius-md)',
                    border: '1px solid #FECACA', backgroundColor: 'var(--surface-color)',
                    color: '#B91C1C', fontSize: '0.85rem'
                }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span style={{ flex: 1 }}>{pageError}</span>
                    <button onClick={() => setPageError(null)} title="Schließen"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>
                        <X size={16} />
                    </button>
                </div>
            )}

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
                                    <button onClick={() => handleDelete(a)}
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
                                    accept={`image/*,${acceptAttribute(FILE_RULES.announcements)}`}
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        addFiles(e.target.files);
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
                                    {uploadFiles.map(({ file, previewUrl }, idx) => (
                                        <div key={previewUrl} style={{
                                            position: 'relative',
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '6px 10px', borderRadius: '8px',
                                            backgroundColor: 'var(--background-color)', border: '1px solid #BFDBFE',
                                            fontSize: '0.78rem'
                                        }}>
                                            {isImageFile(file.name) ? (
                                                <img src={previewUrl} alt=""
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

                        {formError && (
                            <div role="alert" style={{
                                marginTop: '16px', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                                border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.82rem',
                                whiteSpace: 'pre-wrap'
                            }}>
                                {formError}
                            </div>
                        )}

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
// Nur Pfade des Buckets werden signiert; fremde Adressen werden nicht verlinkt.
const AttachmentGallery = ({ attachments }) => {
    const signedUrlsRef = useRef({});

    const getSignedUrl = useCallback(async (path) => {
        const storagePath = extractStoragePath(path, BUCKET);
        if (!storagePath) return null;
        if (signedUrlsRef.current[storagePath]) return signedUrlsRef.current[storagePath];

        const { data, error } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(storagePath, 3600);
        if (error) console.error('Error signing attachment:', error);
        if (data?.signedUrl) {
            signedUrlsRef.current = { ...signedUrlsRef.current, [storagePath]: data.signedUrl };
            return data.signedUrl;
        }
        return null;
    }, []);

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {(attachments || []).filter(Boolean).map((att, idx) => (
                <AttachmentItem key={idx} att={att} getSignedUrl={getSignedUrl} />
            ))}
        </div>
    );
};

const AttachmentItem = ({ att, getSignedUrl }) => {
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(att?.name || att?.path || '');
    const isPdf = /\.pdf$/i.test(att?.name || att?.path || '');
    const attPath = att?.path;

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const signedUrl = await getSignedUrl(attPath);
            if (cancelled) return;
            setUrl(signedUrl);
            setLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [attPath, getSignedUrl]);

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
                {att?.name || 'Datei'} (nicht verfügbar)
            </span>
        );
    }

    if (isImage) {
        return (
            <img
                src={url}
                alt={att.name}
                onClick={() => window.open(url, '_blank', 'noopener')}
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

export default Announcements;
