import React, { useState, useEffect, useRef } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { UploadCloud, FileText, Image as ImageIcon, MoreVertical, Loader2, Download, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';

const Documents = () => {
    const { user } = useAuth();
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    const fetchDocuments = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('documents')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDocuments(data || []);
        } catch (error) {
            console.error('Error fetching documents:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchDocuments();
        }
    }, [user]);

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Limit size 10MB
        if (file.size > 10 * 1024 * 1024) {
            alert('Datei ist zu groß (Max 10MB)');
            return;
        }

        try {
            setUploading(true);
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const category = 'other'; // Default category
            const filePath = `${user.id}/${category}/${fileName}`;

            // 1. Upload to Storage
            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Insert into DB
            const { error: dbError } = await supabase.from('documents').insert([
                {
                    user_id: user.id,
                    category: category,
                    file_name: file.name,
                    file_path: filePath,
                    mime_type: file.type,
                    related_type: null,
                    related_id: null
                }
            ]);

            if (dbError) throw dbError;

            fetchDocuments();
        } catch (error) {
            console.error('Upload error:', error);
            alert(translateError(error));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDownload = async (doc) => {
        try {
            const { data, error } = await supabase.storage
                .from('documents')
                .createSignedUrl(doc.file_path, 60); // 60 seconds

            if (error) throw error;
            window.open(data.signedUrl, '_blank');
        } catch (error) {
            alert(translateError(error));
        }
    };

    if (loading && !uploading && documents.length === 0) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Dokumente</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Zentrales Dokumentenarchiv</p>
                </div>
                <div style={{ position: 'relative' }}>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    />
                    <Button icon={UploadCloud} onClick={() => fileInputRef.current.click()} disabled={uploading}>
                        {uploading ? 'Lädt hoch...' : 'Dokument hochladen'}
                    </Button>
                </div>
            </div>

            {/* Upload Area */}
            <Card className="mb-6">
                <div
                    onClick={() => !uploading && fileInputRef.current.click()}
                    style={{
                        border: '2px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--spacing-xl)',
                        textAlign: 'center',
                        backgroundColor: '#F9FAFB',
                        cursor: uploading ? 'default' : 'pointer',
                        marginBottom: 'var(--spacing-lg)'
                    }}
                >
                    {uploading ? (
                        <Loader2 size={48} className="animate-spin" style={{ color: 'var(--primary-color)', margin: '0 auto', marginBottom: 'var(--spacing-md)' }} />
                    ) : (
                        <UploadCloud size={48} style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }} />
                    )}
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        {uploading ? 'Wird hochgeladen...' : 'Datei hier ablegen oder klicken zum Auswählen'}
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>PDF, PNG, JPG bis zu 10MB</p>
                </div>
            </Card>

            {/* Document Grid */}
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--spacing-md)' }}>Zuletzt hinzugefügt</h3>

            {documents.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>Keine Dokumente vorhanden.</div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 'var(--spacing-md)'
                }}>
                    {documents.map((doc) => (
                        <div key={doc.id}
                            onClick={() => handleDownload(doc)}
                            style={{
                                backgroundColor: 'var(--surface-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--spacing-md)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                textAlign: 'center',
                                position: 'relative',
                                cursor: 'pointer',
                                transition: 'border-color 0.2s',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                        >
                            <div style={{
                                width: '48px',
                                height: '48px',
                                backgroundColor: '#E0F2FE',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--primary-color)',
                                marginBottom: 'var(--spacing-md)'
                            }}>
                                {doc.mime_type?.includes('image') ? <ImageIcon size={24} /> : <FileText size={24} />}
                            </div>
                            <div style={{ fontWeight: 500, fontSize: '0.875rem', marginBottom: '4px', wordBreak: 'break-all', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>
                                {doc.file_name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {new Date(doc.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Documents;
