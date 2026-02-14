import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Files, FileText, Download, Folder, Lock, Globe } from 'lucide-react';

const TenantDocuments = () => {
    const { user, roleData } = useAuth();
    const [generalDocs, setGeneralDocs] = useState([]);
    const [personalDocs, setPersonalDocs] = useState([]);
    const [activeTab, setActiveTab] = useState('general');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDocuments = async () => {
            if (!roleData?.property_id) {
                setLoading(false);
                return;
            }

            try {
                // Fetch general documents (for the whole property)
                const { data: generalData } = await supabase
                    .from('documents')
                    .select('*')
                    .eq('property_id', roleData.property_id)
                    .is('unit_id', null)
                    .order('created_at', { ascending: false });

                setGeneralDocs(generalData || []);

                // Fetch personal documents (for this specific unit)
                if (roleData.unit_id) {
                    const { data: personalData } = await supabase
                        .from('documents')
                        .select('*')
                        .eq('unit_id', roleData.unit_id)
                        .order('created_at', { ascending: false });

                    setPersonalDocs(personalData || []);
                }
            } catch (err) {
                console.error('Error fetching documents:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchDocuments();
    }, [roleData]);

    const handleDownload = async (doc) => {
        const path = doc.file_path || doc.storage_path;
        if (path) {
            const { data } = await supabase.storage
                .from('documents')
                .createSignedUrl(path, 3600);

            if (data?.signedUrl) {
                window.open(data.signedUrl, '_blank');
            }
        } else if (doc.file_url) {
            window.open(doc.file_url, '_blank');
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
                    border: '1px solid var(--border-color)',
                    padding: '60px 40px', textAlign: 'center'
                }}>
                    <Folder size={48} color="var(--border-color)" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '12px' }}>
                        {activeTab === 'general'
                            ? 'Keine allgemeinen Dokumente vorhanden.'
                            : 'Keine persönlichen Dokumente vorhanden.'
                        }
                    </p>
                </div>
            ) : (
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    overflow: 'hidden'
                }}>
                    {currentDocs.map((doc, idx) => (
                        <div
                            key={doc.id}
                            style={{
                                padding: '14px 22px',
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between',
                                borderBottom: idx < currentDocs.length - 1 ? '1px solid var(--border-color)' : 'none',
                                transition: 'background 0.2s',
                                cursor: 'pointer'
                            }}
                            onClick={() => handleDownload(doc)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                {getFileIcon(doc.file_name || doc.name)}
                                <div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                        {doc.name || doc.file_name || 'Dokument'}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
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
                                    fontSize: '0.8rem', cursor: 'pointer'
                                }}
                            >
                                <Download size={14} />
                                Download
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TenantDocuments;
