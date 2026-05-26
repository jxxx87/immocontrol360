import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Folder, Loader2, CheckCircle2, ChevronRight, FileText, Image as ImageIcon, Building2, HardDrive, Settings } from 'lucide-react';
import Card from '../components/ui/Card';

const CloudExplorer = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [properties, setProperties] = useState([]);
    const [groupedProperties, setGroupedProperties] = useState([]);
    const [status, setStatus] = useState('loading'); // loading, checking, creating, ready, no_connection
    const [statusMessage, setStatusMessage] = useState('Überprüfe Cloud-Verbindung...');
    const [missingCount, setMissingCount] = useState(0);

    const [selectedProperty, setSelectedProperty] = useState(null);
    const [currentPath, setCurrentPath] = useState([]);
    const [files, setFiles] = useState([]); // mock files

    useEffect(() => {
        const init = async () => {
            if (!user) return;
            
            setStatus('loading');
            setStatusMessage('Überprüfe Cloud-Verbindung...');
            
            // 1. Check for active cloud connection
            const { data: connections, error: connError } = await supabase
                .from('cloud_connections')
                .select('id')
                .eq('user_id', user.id);
                
            if (connError || !connections || connections.length === 0) {
                setStatus('no_connection');
                return;
            }

            setStatusMessage('Lade Immobilien...');
            
            // 2. Fetch properties
            const { data: props } = await supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id, economic_unit_id')
                .order('street');
                
            const safeProps = props || [];
            setProperties(safeProps);
            
            // Group properties by economic_unit_id
            const groups = {};
            const ungrouped = [];
            
            safeProps.forEach(p => {
                if (p.economic_unit_id) {
                    if (!groups[p.economic_unit_id]) {
                        groups[p.economic_unit_id] = {
                            id: p.economic_unit_id,
                            isGroup: true,
                            name: 'Wirtschaftsgemeinschaft',
                            members: []
                        };
                    }
                    groups[p.economic_unit_id].members.push(p);
                } else {
                    ungrouped.push({ ...p, isGroup: false });
                }
            });
            
            const finalGrouped = [...Object.values(groups), ...ungrouped];
            setGroupedProperties(finalGrouped);

            if (safeProps.length > 0) {
                setStatus('checking');
                setStatusMessage('Überprüfe Cloud-Ordnerstruktur...');
                
                await new Promise(r => setTimeout(r, 800));
                
                // 3. Check missing folders (using localStorage as mock tracker)
                const missingProps = safeProps.filter(p => !localStorage.getItem(`cloud_synced_${p.id}`));
                setMissingCount(missingProps.length);
                
                if (missingProps.length > 0) {
                    setStatus('creating');
                    setStatusMessage(`${missingProps.length} neue Immobilie(n) gefunden. Erstelle Ordnerstruktur in der Cloud...`);
                    await new Promise(r => setTimeout(r, 2000 + (missingProps.length * 500))); // Simulate processing
                    
                    // Mark as synced
                    missingProps.forEach(p => localStorage.setItem(`cloud_synced_${p.id}`, 'true'));
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

    if (status === 'no_connection') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '20px' }}>
                <HardDrive size={64} color="var(--text-secondary)" />
                <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
                    Keine Cloud-Verbindung gefunden
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '450px', textAlign: 'center', marginBottom: '10px' }}>
                    Um den Dokumenten-Explorer zu nutzen, verknüpfen Sie bitte zuerst ein Microsoft OneDrive oder Google Drive Konto mit Ihrem Profil.
                </p>
                <button 
                    onClick={() => navigate('/settings', { state: { activeTab: 'cloud' } })}
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <Settings size={18} />
                    Zu den Cloud-Einstellungen
                </button>
            </div>
        );
    }

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
                        {groupedProperties.map((item, idx) => {
                            if (item.isGroup) {
                                return (
                                    <div key={`group-${item.id}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <div style={{ padding: '8px 16px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Building2 size={12} />
                                            {item.name}
                                        </div>
                                        {item.members.map(p => (
                                            <div 
                                                key={p.id}
                                                onClick={() => handleSelectProperty(p)}
                                                style={{
                                                    padding: '12px 16px',
                                                    paddingLeft: '24px',
                                                    cursor: 'pointer',
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
                                );
                            } else {
                                return (
                                    <div 
                                        key={item.id}
                                        onClick={() => handleSelectProperty(item)}
                                        style={{
                                            padding: '12px 16px',
                                            cursor: 'pointer',
                                            borderBottom: '1px solid var(--border-color)',
                                            backgroundColor: selectedProperty?.id === item.id ? 'var(--primary-light)' : 'var(--surface-color)',
                                            borderLeft: selectedProperty?.id === item.id ? '3px solid var(--primary-color)' : '3px solid transparent',
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <Folder size={16} color={selectedProperty?.id === item.id ? 'var(--primary-color)' : '#64748b'} />
                                        <span style={{ fontSize: '0.9rem', fontWeight: selectedProperty?.id === item.id ? 600 : 400, color: selectedProperty?.id === item.id ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                            {item.street} {item.house_number}
                                        </span>
                                    </div>
                                );
                            }
                        })}
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
