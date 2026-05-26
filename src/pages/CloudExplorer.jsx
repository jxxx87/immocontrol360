import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Folder, Loader2, CheckCircle2, ChevronRight, FileText, Image as ImageIcon, Building2, HardDrive } from 'lucide-react';
import Card from '../components/ui/Card';

const CloudExplorer = () => {
    const { user } = useAuth();
    const [properties, setProperties] = useState([]);
    const [status, setStatus] = useState('loading'); // loading, checking, creating, ready
    const [statusMessage, setStatusMessage] = useState('Lade Immobilien...');
    const [missingCount, setMissingCount] = useState(0);

    const [selectedProperty, setSelectedProperty] = useState(null);
    const [currentPath, setCurrentPath] = useState([]);
    const [files, setFiles] = useState([]); // mock files

    useEffect(() => {
        const init = async () => {
            setStatus('loading');
            setStatusMessage('Lade Immobilien...');
            
            const { data: props } = await supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id')
                .order('street');
                
            setProperties(props || []);

            if (props && props.length > 0) {
                // Simulate checking cloud structure
                setStatus('checking');
                setStatusMessage('Überprüfe Cloud-Ordnerstruktur...');
                
                await new Promise(r => setTimeout(r, 1500));
                
                // Simulate that 1 property is missing folders
                const missing = Math.min(props.length, 1); // Mock: pretend at least 1 is missing if we have properties
                setMissingCount(missing);
                
                if (missing > 0) {
                    setStatus('creating');
                    setStatusMessage(`${missing} neue Immobilie(n) gefunden. Erstelle Ordnerstruktur in der Cloud...`);
                    await new Promise(r => setTimeout(r, 2500)); // Simulate folder creation
                }
            }

            setStatus('ready');
            setStatusMessage('');
        };

        init();
    }, []);

    const getPropertyLabel = (p) => `${p.street} ${p.house_number || ''}, ${p.city}`;

    const mockRootFolders = [
        { id: '1', name: 'Rechnungen', type: 'folder', icon: Folder },
        { id: '2', name: 'Mietverträge', type: 'folder', icon: Folder },
        { id: '3', name: 'Bilder', type: 'folder', icon: Folder },
        { id: '4', name: 'Schriftverkehr', type: 'folder', icon: Folder },
        { id: '5', name: 'Nebenkosten', type: 'folder', icon: Folder },
        { id: '6', name: 'Versicherungen', type: 'folder', icon: Folder },
        { id: '7', name: 'Energieausweise', type: 'folder', icon: Folder }
    ];

    useEffect(() => {
        if (status === 'ready' && selectedProperty) {
            if (currentPath.length === 0) {
                setFiles(mockRootFolders);
            } else {
                // Mock inner folders/files
                setFiles([
                    { id: 'f1', name: 'Beispieldokument.pdf', type: 'file', icon: FileText },
                    { id: 'f2', name: 'Foto.jpg', type: 'file', icon: ImageIcon }
                ]);
            }
        }
    }, [selectedProperty, currentPath, status]);

    const handleSelectProperty = (prop) => {
        setSelectedProperty(prop);
        setCurrentPath([]);
    };

    const handleItemClick = (file) => {
        if (file.type === 'folder') {
            setCurrentPath([...currentPath, file]);
        }
    };

    const handleNavigateUp = (index) => {
        setCurrentPath(currentPath.slice(0, index + 1));
    };

    const handleNavigateRoot = () => {
        setCurrentPath([]);
    };

    if (status !== 'ready') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '20px' }}>
                <div style={{ position: 'relative' }}>
                    {status === 'creating' ? (
                        <Folder size={64} color="var(--primary-color)" className="animate-pulse" />
                    ) : (
                        <HardDrive size={64} color="var(--primary-color)" className="animate-pulse" />
                    )}
                    <Loader2 size={24} color="#10B981" className="animate-spin" style={{ position: 'absolute', bottom: '-10px', right: '-10px', backgroundColor: 'var(--surface-color)', borderRadius: '50%' }} />
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
                    {statusMessage}
                </h2>
                {status === 'creating' && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '400px', textAlign: 'center' }}>
                        Bitte haben Sie einen Moment Geduld. Wir legen automatisch die korrekte Struktur (Rechnungen, Mietverträge etc.) in Ihrer verknüpften Cloud an.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--font-family)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <HardDrive size={28} color="var(--primary-color)" />
                        Cloud Explorer
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Ihre zentrale Dateiablage direkt in Microsoft OneDrive / Google Drive.
                    </p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                
                {/* Left Sidebar: Properties */}
                <Card style={{ width: '300px', flexShrink: 0, padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Building2 size={18} color="var(--text-secondary)" />
                        Immobilien
                    </div>
                    <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                        {properties.map(p => (
                            <div 
                                key={p.id}
                                onClick={() => handleSelectProperty(p)}
                                style={{
                                    padding: '12px 16px',
                                    cursor: 'pointer',
                                    borderBottom: '1px solid var(--border-color)',
                                    backgroundColor: selectedProperty?.id === p.id ? 'var(--primary-light)' : 'var(--surface-color)',
                                    borderLeft: selectedProperty?.id === p.id ? '3px solid var(--primary-color)' : '3px solid transparent',
                                    display: 'flex', alignItems: 'center', gap: '10px',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <Folder size={16} color={selectedProperty?.id === p.id ? 'var(--primary-color)' : '#64748b'} />
                                <span style={{ fontSize: '0.9rem', fontWeight: selectedProperty?.id === p.id ? 600 : 400, color: selectedProperty?.id === p.id ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                    {p.street} {p.house_number}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Right Area: File Explorer */}
                <Card style={{ flex: 1, padding: 0, minHeight: '600px', display: 'flex', flexDirection: 'column' }}>
                    {!selectedProperty ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                            <HardDrive size={48} color="var(--border-color)" style={{ marginBottom: '16px' }} />
                            <p>Bitte wählen Sie links eine Immobilie aus.</p>
                        </div>
                    ) : (
                        <>
                            {/* Breadcrumbs */}
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', backgroundColor: 'var(--bg-secondary)' }}>
                                <span 
                                    onClick={handleNavigateRoot}
                                    style={{ cursor: 'pointer', fontWeight: 600, color: currentPath.length === 0 ? 'var(--text-primary)' : 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    <Building2 size={16} />
                                    {getPropertyLabel(selectedProperty)}
                                </span>
                                
                                {currentPath.map((path, idx) => (
                                    <React.Fragment key={path.id}>
                                        <ChevronRight size={16} color="var(--text-secondary)" />
                                        <span 
                                            onClick={() => handleNavigateUp(idx)}
                                            style={{ cursor: 'pointer', fontWeight: idx === currentPath.length - 1 ? 600 : 400, color: idx === currentPath.length - 1 ? 'var(--text-primary)' : 'var(--primary-color)' }}
                                        >
                                            {path.name}
                                        </span>
                                    </React.Fragment>
                                ))}
                            </div>

                            {/* File Grid */}
                            <div style={{ padding: '24px', flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '20px', alignContent: 'start' }}>
                                {files.map(file => {
                                    const Icon = file.icon;
                                    return (
                                        <div 
                                            key={file.id} 
                                            onClick={() => handleItemClick(file)}
                                            style={{ 
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', 
                                                padding: '16px', borderRadius: 'var(--radius-md)',
                                                cursor: file.type === 'folder' ? 'pointer' : 'default',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <Icon size={48} color={file.type === 'folder' ? '#FBBF24' : '#3B82F6'} strokeWidth={1.5} />
                                            <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'center', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
                                                {file.name}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    )}
                </Card>

            </div>
        </div>
    );
};

export default CloudExplorer;
