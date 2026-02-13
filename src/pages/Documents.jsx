import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
    Plus, X, Upload, FileText, Image as ImageIcon, Trash2, Download,
    Building2, Globe, Lock, Users, Folder, Loader, Search
} from 'lucide-react';

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
    const fileInputRef = useRef(null);

    // ── FETCH PROPERTIES ─────────────────────────────────────────────
    useEffect(() => {
        const fetchProperties = async () => {
            const { data } = await supabase
                .from('properties')
                .select('id, street, house_number, city')
                .order('street');
            setProperties(data || []);
            if (data && data.length > 0) {
                setSelectedProperty(data[0]);
            }
            setLoading(false);
        };
        fetchProperties();
    }, []);

    // ── FETCH DOCUMENTS FOR SELECTED PROPERTY ────────────────────────
    useEffect(() => {
        if (!selectedProperty) return;
        fetchDocuments();
        fetchTenants();
    }, [selectedProperty]);

    const fetchDocuments = async () => {
        if (!selectedProperty) return;

        // General documents: property_id set, unit_id is null, tenant_id is null
        const { data: genDocs } = await supabase
            .from('documents')
            .select('*')
            .eq('property_id', selectedProperty.id)
            .is('unit_id', null)
            .is('tenant_id', null)
            .order('created_at', { ascending: false });

        setGeneralDocs(genDocs || []);

        // Personal documents: property_id set, tenant_id set
        const { data: persDocs } = await supabase
            .from('documents')
            .select('*, tenant:tenants(first_name, last_name)')
            .eq('property_id', selectedProperty.id)
            .not('tenant_id', 'is', null)
            .order('created_at', { ascending: false });

        setPersonalDocs(persDocs || []);
    };

    const fetchTenants = async () => {
        if (!selectedProperty) return;

        // First get units for this property
        const { data: units } = await supabase
            .from('units')
            .select('id, unit_name')
            .eq('property_id', selectedProperty.id);

        if (!units || units.length === 0) {
            setTenants([]);
            return;
        }

        const unitIds = units.map(u => u.id);
        const unitMap = {};
        units.forEach(u => { unitMap[u.id] = u.unit_name; });

        // Get active leases for those units
        const { data: leases } = await supabase
            .from('leases')
            .select('tenant_id, unit_id, tenant:tenants(id, first_name, last_name)')
            .in('unit_id', unitIds)
            .in('status', ['active', 'Active', 'aktiv']);

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
    };

    // ── UPLOAD ───────────────────────────────────────────────────────
    const handleUpload = async (files) => {
        if (!files || files.length === 0 || !selectedProperty || uploading) return;
        setUploading(true);

        try {
            for (const file of Array.from(files)) {
                if (file.size > 10 * 1024 * 1024) {
                    alert(`${file.name} ist zu groß (max 10MB)`);
                    continue;
                }

                const timestamp = Date.now();
                const filePath = `${selectedProperty.id}/${activeTab === 'general' ? 'general' : `tenant/${selectedTenant?.id}`}/${timestamp}_${file.name}`;

                const { error: uploadError } = await supabase.storage
                    .from('documents')
                    .upload(filePath, file);

                if (uploadError) {
                    console.error('Upload error:', uploadError);
                    continue;
                }

                const docData = {
                    user_id: user.id,
                    property_id: selectedProperty.id,
                    file_name: file.name,
                    file_path: filePath,
                    mime_type: file.type,
                    category: activeTab === 'general' ? 'general' : 'personal',
                };

                if (activeTab === 'personal' && selectedTenant) {
                    docData.tenant_id = selectedTenant.id;
                    docData.unit_id = selectedTenant.unit_id;
                }

                await supabase.from('documents').insert(docData);
            }

            fetchDocuments();
        } catch (err) {
            console.error('Error uploading:', err);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ── DELETE ────────────────────────────────────────────────────────
    const handleDelete = async (doc) => {
        if (!window.confirm(`"${doc.file_name}" wirklich löschen?`)) return;

        try {
            await supabase.storage.from('documents').remove([doc.file_path]);
            await supabase.from('documents').delete().eq('id', doc.id);
            fetchDocuments();
        } catch (err) {
            console.error('Delete error:', err);
        }
    };

    // ── DOWNLOAD ─────────────────────────────────────────────────────
    const handleDownload = async (doc) => {
        const { data } = await supabase.storage
            .from('documents')
            .createSignedUrl(doc.file_path, 3600);
        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
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
                display: 'flex', alignItems: 'center', gap: '12px'
            }}>
                <Building2 size={18} color="var(--primary-color)" />
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Immobilie:</span>
                <select
                    value={selectedProperty?.id || ''}
                    onChange={(e) => {
                        const prop = properties.find(p => p.id === e.target.value);
                        setSelectedProperty(prop);
                        setSelectedTenant(null);
                    }}
                    style={{
                        flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)', outline: 'none',
                        fontSize: '0.9rem', fontFamily: 'inherit'
                    }}
                >
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>{getPropertyLabel(p)}</option>
                    ))}
                </select>
            </div>

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
                    marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px'
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
                            fontSize: '0.9rem', fontFamily: 'inherit', backgroundColor: 'var(--surface-color)'
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
                                PDF, Bilder bis 10MB
                            </div>
                        </div>
                    </div>
                    <div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
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
            />
        </div>
    );
};

// ── DOCUMENT LIST COMPONENT ──────────────────────────────────────────
const DocumentList = ({ docs, activeTab, onDelete, onDownload, getFileIcon, formatDate }) => {
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
        <div style={{
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
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
                        {getFileIcon(doc.file_name)}
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
                                        backgroundColor: 'var(--surface-color)', color: '#92400E',
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
                                backgroundColor: 'var(--surface-color)', color: '#DC2626',
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
    );
};

export default Documents;
