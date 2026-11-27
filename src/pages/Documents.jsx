import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import {
    FILE_RULES, acceptAttribute, validateUploadFile, buildStorageObjectName,
    prepareUploadBody, openSignedUrlInNewTab, isImageName
} from '../lib/storageFiles';
import {
    Plus, X, Upload, FileText, Image as ImageIcon, Trash2, Download,
    Building2, Globe, Lock, Users, Folder, Loader, AlertCircle
} from 'lucide-react';

const BUCKET = 'documents';

// Speicherpfad eines Dokuments (neue Datensätze: file_path, ältere ggf. storage_path)
const getDocPath = (doc) => doc?.file_path || doc?.storage_path || null;

const Documents = () => {
    const { user } = useAuth();
    const [properties, setProperties] = useState([]);
    const [selectedProperty, setSelectedProperty] = useState(null);
    const [activeTab, setActiveTab] = useState('general'); // 'general' | 'personal'
    const [generalDocs, setGeneralDocs] = useState([]);
    const [personalDocs, setPersonalDocs] = useState([]); // grouped by tenant
    const [tenants, setTenants] = useState([]);
    const [selectedTenant, setSelectedTenant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [thumbUrls, setThumbUrls] = useState({}); // file_path -> signierte Vorschau-URL
    const [feedback, setFeedback] = useState(null); // { type: 'error' | 'warning' | 'success', messages: [] }
    const fileInputRef = useRef(null);
    // Schutz gegen veraltete Antworten bei schnellem Objektwechsel
    const docsRequestRef = useRef(0);
    const tenantsRequestRef = useRef(0);

    const showFeedback = useCallback(
        (type, messages) => setFeedback({ type, messages: Array.isArray(messages) ? messages : [messages] }),
        []
    );

    // ── FETCH PROPERTIES ─────────────────────────────────────────────
    useEffect(() => {
        const fetchProperties = async () => {
            const { data, error } = await supabase
                .from('properties')
                .select('id, street, house_number, city')
                .order('street');
            if (error) {
                console.error('Error fetching properties:', error);
                showFeedback('error', `Immobilien konnten nicht geladen werden: ${translateError(error)}`);
            }
            setProperties(data || []);
            if (data && data.length > 0) {
                setSelectedProperty(data[0]);
            }
            setLoading(false);
        };
        fetchProperties();
    }, [showFeedback]);

    // ── FETCH DOCUMENTS FOR SELECTED PROPERTY ────────────────────────
    const fetchDocuments = useCallback(async (propertyId) => {
        if (!propertyId) return;
        const requestId = ++docsRequestRef.current;

        // General documents: property_id set, unit_id is null, tenant_id is null
        const genPromise = supabase
            .from('documents')
            .select('*')
            .eq('property_id', propertyId)
            .is('unit_id', null)
            .is('tenant_id', null)
            .order('created_at', { ascending: false });

        // Personal documents: property_id set, tenant_id set
        const persPromise = supabase
            .from('documents')
            .select('*, tenant:tenants(first_name, last_name)')
            .eq('property_id', propertyId)
            .not('tenant_id', 'is', null)
            .order('created_at', { ascending: false });

        const [genRes, persRes] = await Promise.all([genPromise, persPromise]);
        if (requestId !== docsRequestRef.current) return; // inzwischen anderes Objekt gewählt

        const loadError = genRes.error || persRes.error;
        if (loadError) {
            console.error('Error fetching documents:', loadError);
            showFeedback('error', `Dokumente konnten nicht geladen werden: ${translateError(loadError)}`);
        }

        const genDocs = genRes.data || [];
        const persDocs = persRes.data || [];
        setGeneralDocs(genDocs);
        setPersonalDocs(persDocs);

        // Vorschaubilder einmal gebündelt signieren (statt je Zeile und Ansicht)
        const imagePaths = [...genDocs, ...persDocs]
            .filter(d => isImageName(d.file_name) && getDocPath(d))
            .map(getDocPath);
        if (imagePaths.length === 0) {
            setThumbUrls({});
            return;
        }
        const { data: signed, error: signError } = await supabase.storage
            .from(BUCKET)
            .createSignedUrls(imagePaths, 3600);
        if (requestId !== docsRequestRef.current) return;
        if (signError) {
            console.error('Error signing thumbnails:', signError);
            setThumbUrls({});
            return;
        }
        const map = {};
        (signed || []).forEach(s => {
            if (s?.path && s.signedUrl && !s.error) map[s.path] = s.signedUrl;
        });
        setThumbUrls(map);
    }, [showFeedback]);

    const fetchTenants = useCallback(async (propertyId) => {
        if (!propertyId) return;
        const requestId = ++tenantsRequestRef.current;

        // First get units for this property
        const { data: units, error: unitError } = await supabase
            .from('units')
            .select('id, unit_name')
            .eq('property_id', propertyId);

        if (requestId !== tenantsRequestRef.current) return;
        if (unitError) {
            console.error('Error fetching units:', unitError);
            showFeedback('error', `Mieter konnten nicht geladen werden: ${translateError(unitError)}`);
            setTenants([]);
            return;
        }

        if (!units || units.length === 0) {
            setTenants([]);
            return;
        }

        const unitIds = units.map(u => u.id);
        const unitMap = {};
        units.forEach(u => { unitMap[u.id] = u.unit_name; });

        // Get active leases for those units
        const { data: leases, error: leaseError } = await supabase
            .from('leases')
            .select('tenant_id, unit_id, tenant:tenants(id, first_name, last_name)')
            .in('unit_id', unitIds)
            .in('status', ['active', 'Active', 'aktiv']);

        if (requestId !== tenantsRequestRef.current) return;
        if (leaseError) {
            console.error('Error fetching leases:', leaseError);
            showFeedback('error', `Mieter konnten nicht geladen werden: ${translateError(leaseError)}`);
            setTenants([]);
            return;
        }

        if (leases && leases.length > 0) {
            const uniqueTenants = [];
            const seen = new Set();
            leases.forEach(l => {
                if (l.tenant && !seen.has(l.tenant_id)) {
                    seen.add(l.tenant_id);
                    uniqueTenants.push({
                        ...l.tenant,
                        unit_name: unitMap[l.unit_id] || '—',
                        unit_id: l.unit_id
                    });
                }
            });
            setTenants(uniqueTenants);
        } else {
            setTenants([]);
        }
    }, [showFeedback]);

    const selectedPropertyId = selectedProperty?.id;
    useEffect(() => {
        if (!selectedPropertyId) return;
        fetchDocuments(selectedPropertyId);
        fetchTenants(selectedPropertyId);
    }, [selectedPropertyId, fetchDocuments, fetchTenants]);

    // ── UPLOAD ───────────────────────────────────────────────────────
    const handleUpload = async (files) => {
        if (!files || files.length === 0 || !selectedProperty || uploading) return;
        const propertyId = selectedProperty.id;
        const isGeneral = activeTab === 'general';
        const tenant = isGeneral ? null : selectedTenant;

        if (!isGeneral && !tenant?.id) {
            showFeedback('error', 'Bitte wählen Sie zuerst einen Mieter aus.');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setUploading(true);
        setFeedback(null);
        const errors = [];
        let uploadedCount = 0;

        try {
            for (const file of Array.from(files)) {
                const validationError = validateUploadFile(file, FILE_RULES.documents);
                if (validationError) {
                    errors.push(validationError);
                    continue;
                }

                // Schlüssel ohne Originalnamen (Umlaute/Sonderzeichen führen sonst zu "Invalid key")
                const folder = isGeneral ? 'general' : `tenant/${tenant.id}`;
                const filePath = `${propertyId}/${folder}/${buildStorageObjectName(file)}`;
                const { body, contentType } = prepareUploadBody(file);

                const { error: uploadError } = await supabase.storage
                    .from(BUCKET)
                    .upload(filePath, body, { contentType });

                if (uploadError) {
                    console.error('Upload error:', uploadError);
                    errors.push(`„${file.name}“ konnte nicht hochgeladen werden: ${translateError(uploadError)}`);
                    continue;
                }

                const docData = {
                    user_id: user.id,
                    property_id: propertyId,
                    file_name: file.name,
                    file_path: filePath,
                    mime_type: contentType,
                    category: isGeneral ? 'general' : 'personal',
                };

                if (!isGeneral) {
                    docData.tenant_id = tenant.id;
                    docData.unit_id = tenant.unit_id;
                }

                const { error: insertError } = await supabase.from('documents').insert(docData);
                if (insertError) {
                    console.error('Insert error:', insertError);
                    // Datei wieder entfernen, damit sie nicht verwaist im Speicher liegt
                    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([filePath]);
                    if (cleanupError) console.error('Cleanup error:', cleanupError);
                    errors.push(`„${file.name}“ konnte nicht gespeichert werden: ${translateError(insertError)}`);
                    continue;
                }
                uploadedCount += 1;
            }

            if (errors.length > 0) {
                showFeedback('error', uploadedCount > 0
                    ? [`${uploadedCount} Datei(en) hochgeladen, aber:`, ...errors]
                    : errors);
            } else if (uploadedCount > 0) {
                showFeedback('success', uploadedCount === 1 ? 'Dokument hochgeladen.' : `${uploadedCount} Dokumente hochgeladen.`);
            }

            fetchDocuments(propertyId);
        } catch (err) {
            console.error('Error uploading:', err);
            showFeedback('error', `Fehler beim Hochladen: ${translateError(err)}`);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ── DELETE ────────────────────────────────────────────────────────
    // Erst die Datei im Speicher löschen, dann den Datensatz. Bleibt die Datei liegen
    // (z. B. fehlende Löschberechtigung), wird das angezeigt statt still übergangen.
    const handleDelete = async (doc) => {
        if (!window.confirm(`"${doc.file_name}" wirklich löschen?`)) return;
        setFeedback(null);

        try {
            const path = getDocPath(doc);
            let fileStillStored = false;

            if (path) {
                const { data: removed, error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
                if (removeError) {
                    console.error('Storage delete error:', removeError);
                    showFeedback('error', `Die Datei konnte nicht gelöscht werden: ${translateError(removeError)}`);
                    return;
                }
                if (!removed || removed.length === 0) {
                    // Nichts gelöscht: existiert die Datei noch (dann fehlt die Berechtigung)?
                    const { data: probe, error: probeError } = await supabase.storage
                        .from(BUCKET)
                        .createSignedUrl(path, 60);
                    fileStillStored = !probeError && !!probe?.signedUrl;
                }
            }

            if (fileStillStored && !window.confirm(
                'Die Datei konnte nicht aus dem Speicher gelöscht werden (keine Löschberechtigung).\n\n' +
                'Soll der Eintrag trotzdem aus der Liste entfernt werden? Die Datei bleibt dann im Speicher erhalten.'
            )) {
                return;
            }

            const { data: deletedRows, error: dbError } = await supabase
                .from('documents')
                .delete()
                .eq('id', doc.id)
                .select('id');
            if (dbError) throw dbError;
            if (!deletedRows || deletedRows.length === 0) {
                showFeedback('error', 'Der Eintrag konnte nicht gelöscht werden (keine Berechtigung).');
                fetchDocuments(selectedPropertyId);
                return;
            }

            if (fileStillStored) {
                showFeedback('warning', 'Der Eintrag wurde entfernt. Die Datei selbst liegt weiterhin im Speicher, weil die Löschberechtigung fehlt.');
            }
            fetchDocuments(selectedPropertyId);
        } catch (err) {
            console.error('Delete error:', err);
            showFeedback('error', `Fehler beim Löschen: ${translateError(err)}`);
        }
    };

    // ── DOWNLOAD ─────────────────────────────────────────────────────
    const handleDownload = async (doc) => {
        const path = getDocPath(doc);
        if (!path) {
            showFeedback('error', 'Zu diesem Dokument ist keine Datei hinterlegt.');
            return;
        }
        const err = await openSignedUrlInNewTab(async () => {
            const { data, error } = await supabase.storage
                .from(BUCKET)
                .createSignedUrl(path, 3600);
            if (error) throw error;
            return data?.signedUrl;
        });
        if (err) {
            console.error('Download error:', err);
            showFeedback('error', `Download nicht möglich: ${translateError(err)}`);
        }
    };

    const getPropertyLabel = (p) => `${p.street} ${p.house_number || ''}, ${p.city}`;

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    const getFileIcon = (name) => {
        if (!name) return <FileText size={18} color="#6B7280" />;
        const ext = name.split('.').pop().toLowerCase();
        if (ext === 'pdf') return <FileText size={18} color="#DC2626" />;
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return <ImageIcon size={18} color="#2563EB" />;
        return <FileText size={18} color="#6B7280" />;
    };

    // Filter personal docs by selected tenant
    const filteredPersonalDocs = selectedTenant
        ? personalDocs.filter(d => d.tenant_id === selectedTenant.id)
        : personalDocs;

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
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Dokumente</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                        Verwalten Sie Dokumente für Ihre Immobilien und Mieter.
                    </p>
                </div>
            </div>

            {/* Property Selector */}
            <div style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                padding: '16px 20px',
                marginBottom: '20px',
                display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap'
            }}>
                <Building2 size={18} color="var(--primary-color)" />
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Immobilie:</span>
                <select
                    value={selectedProperty?.id || ''}
                    onChange={(e) => {
                        const prop = properties.find(p => p.id === e.target.value);
                        // Listen sofort leeren, damit nie Dokumente des vorherigen Objekts
                        // unter dem neuen stehen
                        setGeneralDocs([]);
                        setPersonalDocs([]);
                        setTenants([]);
                        setThumbUrls({});
                        setFeedback(null);
                        setSelectedProperty(prop);
                        setSelectedTenant(null);
                    }}
                    style={{
                        flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)', outline: 'none',
                        fontSize: '0.9rem', fontFamily: 'inherit', minWidth: 0, maxWidth: '100%'
                    }}
                >
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>{getPropertyLabel(p)}</option>
                    ))}
                </select>
            </div>

            {/* Rückmeldungen (Fehler beim Laden, Hochladen, Löschen) */}
            {feedback && feedback.messages.length > 0 && (
                <div
                    role={feedback.type === 'error' ? 'alert' : 'status'}
                    style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px',
                        padding: '12px 16px', marginBottom: '16px',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${feedback.type === 'error' ? '#FECACA' : feedback.type === 'warning' ? '#FDE68A' : '#BBF7D0'}`,
                        backgroundColor: 'var(--surface-color)',
                        color: feedback.type === 'error' ? '#B91C1C' : feedback.type === 'warning' ? '#92400E' : '#15803D',
                        fontSize: '0.85rem'
                    }}
                >
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1 }}>
                        {feedback.messages.map((m, i) => (
                            <div key={i}>{m}</div>
                        ))}
                    </div>
                    <button
                        onClick={() => setFeedback(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                        title="Schließen"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Tabs */}
            <div style={{
                display: 'flex', gap: '0', marginBottom: '20px',
                borderBottom: '2px solid var(--border-color)'
            }}>
                <button
                    onClick={() => setActiveTab('general')}
                    style={{
                        padding: '10px 20px', background: 'none', border: 'none',
                        fontSize: '0.9rem', fontWeight: activeTab === 'general' ? 600 : 400,
                        color: activeTab === 'general' ? 'var(--primary-color)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'general' ? '2px solid var(--primary-color)' : '2px solid transparent',
                        cursor: 'pointer', display: 'flex',
                        alignItems: 'center', gap: '8px',
                        marginBottom: '-2px', transition: 'all 0.2s'
                    }}
                >
                    <Globe size={16} />
                    Allgemein
                    {generalDocs.length > 0 && (
                        <span style={{
                            backgroundColor: 'var(--surface-color)', color: 'var(--primary-color)',
                            borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem', fontWeight: 600
                        }}>{generalDocs.length}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('personal')}
                    style={{
                        padding: '10px 20px', background: 'none', border: 'none',
                        fontSize: '0.9rem', fontWeight: activeTab === 'personal' ? 600 : 400,
                        color: activeTab === 'personal' ? 'var(--primary-color)' : 'var(--text-secondary)',
                        borderBottom: activeTab === 'personal' ? '2px solid var(--primary-color)' : '2px solid transparent',
                        cursor: 'pointer', display: 'flex',
                        alignItems: 'center', gap: '8px',
                        marginBottom: '-2px', transition: 'all 0.2s'
                    }}
                >
                    <Lock size={16} />
                    Persönlich
                    {personalDocs.length > 0 && (
                        <span style={{
                            backgroundColor: 'var(--surface-color)', color: '#D97706',
                            borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem', fontWeight: 600
                        }}>{personalDocs.length}</span>
                    )}
                </button>
            </div>

            {/* Personal Tab: Tenant Selector */}
            {activeTab === 'personal' && (
                <div style={{
                    backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-lg)',
                    border: '1px solid #FDE68A', padding: '14px 20px',
                    marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap'
                }}>
                    <Users size={18} color="#D97706" />
                    <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#92400E' }}>Mieter:</span>
                    <select
                        value={selectedTenant?.id || ''}
                        onChange={(e) => {
                            const t = tenants.find(t => t.id === e.target.value);
                            setSelectedTenant(t || null);
                        }}
                        style={{
                            flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                            border: '1px solid #FDE68A', outline: 'none',
                            fontSize: '0.9rem', fontFamily: 'inherit', minWidth: 0, maxWidth: '100%', backgroundColor: 'var(--surface-color)'
                        }}
                    >
                        <option value="">— Alle Mieter —</option>
                        {tenants.map(t => (
                            <option key={t.id} value={t.id}>
                                {t.first_name} {t.last_name} ({t.unit_name})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Upload Area */}
            {(activeTab === 'general' || (activeTab === 'personal' && selectedTenant)) && (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '16px 20px',
                    marginBottom: '20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Upload size={18} color="var(--primary-color)" />
                        <div>
                            <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>
                                {activeTab === 'general'
                                    ? 'Allgemeines Dokument hochladen'
                                    : `Dokument für ${selectedTenant?.first_name} ${selectedTenant?.last_name} hochladen`
                                }
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {FILE_RULES.documents.label} bis 10 MB
                            </div>
                            {activeTab === 'general' && (
                                <div style={{ fontSize: '0.75rem', color: '#92400E', marginTop: '4px' }}>
                                    Hinweis: Allgemeine Dokumente sind für alle Mieter dieser Immobilie im Mieterportal sichtbar.
                                    Interne Unterlagen (z. B. Kaufvertrag, Versicherungen) bitte nicht hier ablegen.
                                </div>
                            )}
                        </div>
                    </div>
                    <div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept={acceptAttribute(FILE_RULES.documents)}
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => handleUpload(e.target.files)}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="btn btn-primary btn-md"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            {uploading ? <Loader size={14} className="animate-spin" /> : <Plus size={16} />}
                            {uploading ? 'Lädt hoch...' : 'Hochladen'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'personal' && !selectedTenant && (
                <div style={{
                    backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-md)',
                    padding: '12px 16px', marginBottom: '16px',
                    fontSize: '0.82rem', color: '#92400E',
                    border: '1px solid #FDE68A'
                }}>
                    💡 Wählen Sie einen Mieter aus, um persönliche Dokumente hochzuladen.
                </div>
            )}

            {/* Document List */}
            <DocumentList
                docs={activeTab === 'general' ? generalDocs : filteredPersonalDocs}
                activeTab={activeTab}
                onDelete={handleDelete}
                onDownload={handleDownload}
                getFileIcon={getFileIcon}
                formatDate={formatDate}
                thumbUrls={thumbUrls}
            />
        </div>
    );
};

// ── DOCUMENT THUMBNAIL COMPONENT ─────────────────────────────────────────
// Die signierte Vorschau-URL kommt gebündelt aus der Liste (thumbUrls).
const DocumentThumbnail = ({ doc, getFileIcon, url }) => {
    if (isImageName(doc.file_name) && url) {
        return (
            <img
                src={url}
                alt={doc.file_name}
                style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }}
            />
        );
    }

    return (
        <div style={{ width: '36px', height: '36px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)' }}>
            {getFileIcon(doc.file_name)}
        </div>
    );
};

// ── DOCUMENT LIST COMPONENT ──────────────────────────────────────────
const DocumentList = ({ docs, activeTab, onDelete, onDownload, getFileIcon, formatDate, thumbUrls = {} }) => {
    if (docs.length === 0) {
        return (
            <div style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                padding: '60px 40px', textAlign: 'center'
            }}>
                <Folder size={48} color="var(--border-color)" />
                <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                    {activeTab === 'general'
                        ? 'Keine allgemeinen Dokumente für diese Immobilie.'
                        : 'Keine persönlichen Dokumente.'
                    }
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="hidden-mobile" style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden'
            }}>
                {docs.map((doc, idx) => (
                    <div
                        key={doc.id}
                        style={{
                            padding: '14px 22px',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between',
                            borderBottom: idx < docs.length - 1 ? '1px solid var(--border-color)' : 'none',
                            transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
                            <DocumentThumbnail doc={doc} getFileIcon={getFileIcon} url={thumbUrls[getDocPath(doc)]} />
                            <div style={{ minWidth: 0 }}>
                                <div style={{
                                    fontSize: '0.9rem', fontWeight: 500,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                }}>
                                    {doc.file_name}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <span>{formatDate(doc.created_at)}</span>
                                    {doc.tenant && (
                                        <span style={{
                                            backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)',
                                            padding: '0 6px', borderRadius: '4px', fontSize: '0.7rem'
                                        }}>
                                            {doc.tenant.first_name} {doc.tenant.last_name}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button
                                onClick={() => onDownload(doc)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    padding: '6px 12px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--surface-color)', color: 'var(--primary-color)',
                                    fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit'
                                }}
                                title="Herunterladen"
                            >
                                <Download size={14} />
                                Download
                            </button>
                            <button
                                onClick={() => onDelete(doc)}
                                style={{
                                    display: 'flex', alignItems: 'center',
                                    padding: '6px 8px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--surface-color)', color: 'var(--danger-color)',
                                    cursor: 'pointer'
                                }}
                                title="Löschen"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                {docs.map((doc) => (
                    <div key={doc.id} style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--spacing-md)',
                        backgroundColor: 'var(--surface-color)',
                        position: 'relative'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                            <div style={{ flexShrink: 0 }}>
                                <DocumentThumbnail doc={doc} getFileIcon={getFileIcon} url={thumbUrls[getDocPath(doc)]} />
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem', wordBreak: 'break-all' }}>{doc.file_name}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {formatDate(doc.created_at)}
                                </div>
                                {doc.tenant && (
                                    <div style={{ marginTop: '4px' }}>
                                        <span style={{
                                            backgroundColor: 'var(--bg-secondary)',
                                            color: 'var(--text-primary)',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontSize: '0.75rem'
                                        }}>
                                            {doc.tenant.first_name} {doc.tenant.last_name}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                            <button
                                onClick={() => onDownload(doc)}
                                style={{
                                    flex: 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                    padding: '8px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--surface-color)', color: 'var(--primary-color)',
                                    fontSize: '0.85rem', cursor: 'pointer'
                                }}
                            >
                                <Download size={16} /> Download
                            </button>
                            <button
                                onClick={() => onDelete(doc)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--surface-color)', color: 'var(--danger-color)',
                                    cursor: 'pointer'
                                }}
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};

export default Documents;
