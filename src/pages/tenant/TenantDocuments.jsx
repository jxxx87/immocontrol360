import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { translateError } from '../../lib/errorTranslator';
import { openSignedUrlInNewTab } from '../../lib/storageFiles';
import { Files, FileText, Download, Folder, Lock, Globe } from 'lucide-react';

const TenantDocuments = () => {
    const { roleData } = useAuth();
    const [generalDocs, setGeneralDocs] = useState([]);
    const [personalDocs, setPersonalDocs] = useState([]);
    const [activeTab, setActiveTab] = useState('general');
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState(null);

    const propertyId = roleData?.property_id;
    const tenantId = roleData?.tenant_id;

    useEffect(() => {
        let cancelled = false;
        const fetchDocuments = async () => {
            // Persönliche Dokumente brauchen nur die Mieter-ID – nicht abbrechen, wenn die Rolle kein Objekt hat
            if (!propertyId && !tenantId) {
                setLoading(false);
                return;
            }

            try {
                // Allgemein: Dokumente des Objekts ohne Mieterbezug (wie die Freigabe in der
                // Datenbank: tenant_id IS NULL). Persönlich: genau die eigenen (tenant_id),
                // nicht nach Einheit – sonst fehlen Dokumente nach Umzug/ohne Einheit.
                const generalPromise = propertyId
                    ? supabase
                        .from('documents')
                        .select('*')
                        .eq('property_id', propertyId)
                        .is('tenant_id', null)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null });

                const personalPromise = tenantId
                    ? supabase
                        .from('documents')
                        .select('*')
                        .eq('tenant_id', tenantId)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null });

                const [generalRes, personalRes] = await Promise.all([generalPromise, personalPromise]);
                if (cancelled) return;

                const loadError = generalRes.error || personalRes.error;
                if (loadError) {
                    console.error('Error fetching documents:', loadError);
                    setErrorMessage(`Dokumente konnten nicht geladen werden: ${translateError(loadError)}`);
                } else {
                    setErrorMessage(null);
                }
                setGeneralDocs(generalRes.data || []);
                setPersonalDocs(personalRes.data || []);
            } catch (err) {
                console.error('Error fetching documents:', err);
                if (!cancelled) setErrorMessage(`Dokumente konnten nicht geladen werden: ${translateError(err)}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchDocuments();
        return () => { cancelled = true; };
    }, [propertyId, tenantId]);

    const handleDownload = async (doc) => {
        const path = doc.file_path || doc.storage_path;
        if (!path) {
            setErrorMessage('Zu diesem Dokument ist keine Datei hinterlegt.');
            return;
        }
        // Fenster noch im Klick öffnen (sonst blockiert iOS Safari den Download)
        const err = await openSignedUrlInNewTab(async () => {
            const { data, error } = await supabase.storage
                .from('documents')
                .createSignedUrl(path, 3600);
            if (error) throw error;
            return data?.signedUrl;
        });
        if (err) {
            console.error('Download error:', err);
            setErrorMessage(`Das Dokument konnte nicht geöffnet werden: ${translateError(err)}`);
        } else {
            setErrorMessage(null);
        }
    };

    const formatDate = (d) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    const getFileIcon = (name) => {
        if (!name) return <FileText size={20} color="#6B7280" />;
        const ext = name.split('.').pop().toLowerCase();
        if (ext === 'pdf') return <FileText size={20} color="#DC2626" />;
        if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return <FileText size={20} color="#2563EB" />;
        if (['doc', 'docx'].includes(ext)) return <FileText size={20} color="#2563EB" />;
        if (['xls', 'xlsx'].includes(ext)) return <FileText size={20} color="#16A34A" />;
        return <FileText size={20} color="#6B7280" />;
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    const currentDocs = activeTab === 'general' ? generalDocs : personalDocs;

    return (
        <div>
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Dokumente</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>
                    Ihre Unterlagen und allgemeine Hausdokumente
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

            {/* Tabs */}
            <div style={{
                display: 'flex', gap: '0', marginBottom: '20px',
                borderBottom: '2px solid var(--border-color)'
            }}>
                <button
                    onClick={() => setActiveTab('general')}
                    style={{
                        padding: '10px 20px',
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
                        padding: '10px 20px',
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
                            backgroundColor: 'var(--surface-color)', color: 'var(--primary-color)',
                            borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem', fontWeight: 600
                        }}>{personalDocs.length}</span>
                    )}
                </button>
            </div>

            {/* Document List */}
            {currentDocs.length === 0 ? (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-sm)',
                    padding: '60px 40px', textAlign: 'center'
                }}>
                    <Folder size={48} color="var(--border-color)" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                        {activeTab === 'general'
                            ? (propertyId
                                ? 'Keine allgemeinen Dokumente vorhanden.'
                                : 'Ihrem Konto ist noch kein Objekt zugeordnet. Allgemeine Hausdokumente erscheinen hier, sobald Ihr Vermieter die Zuordnung ergänzt hat.')
                            : 'Keine persönlichen Dokumente vorhanden.'
                        }
                    </p>
                </div>
            ) : (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-md)',
                    overflow: 'hidden'
                }}>
                    {currentDocs.map((doc, idx) => (
                        <div
                            key={doc.id}
                            style={{
                                padding: '14px 22px',
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between',
                                borderBottom: idx < currentDocs.length - 1 ? '1px solid var(--border-color-soft)' : 'none',
                                transition: 'background 0.2s',
                                cursor: 'pointer'
                            }}
                            onClick={() => handleDownload(doc)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
                                <div style={{ flexShrink: 0 }}>
                                    {getFileIcon(doc.file_name || doc.name)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {doc.name || doc.file_name || 'Dokument'}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {formatDate(doc.created_at)}
                                        {doc.description && ` • ${doc.description}`}
                                    </div>
                                </div>
                            </div>
                            <button
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '6px 14px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--surface-color)', color: 'var(--primary-color)',
                                    fontSize: '0.8rem', cursor: 'pointer',
                                    flexShrink: 0, marginLeft: '8px'
                                }}
                            >
                                <Download size={14} />
                                <span className="hidden-mobile">Download</span>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TenantDocuments;
