import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Folder, Loader2, CheckCircle2, ChevronRight, FileText, Image as ImageIcon, Building2, HardDrive, Settings, Cloud, UploadCloud, FolderPlus, Trash2 } from 'lucide-react';
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
    const [files, setFiles] = useState([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);

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
            // Calculate display folder names
            finalGrouped.forEach(item => {
                if (item.isGroup) {
                    const groupedByStreet = {};
                    item.members.forEach(m => {
                        if (!m.street) return;
                        if (!groupedByStreet[m.street]) groupedByStreet[m.street] = [];
                        if (m.house_number) {
                            groupedByStreet[m.street].push(m.house_number);
                        }
                    });
                    const parts = Object.keys(groupedByStreet).map(street => {
                        const nums = groupedByStreet[street];
                        if (nums.length > 0) {
                            return `${street} ${nums.join(' & ')}`;
                        }
                        return street;
                    });
                    const displayNames = parts.slice(0, 2).join(' | ');
                    const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames;
                    item.displayFolderName = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`;
                } else {
                    item.displayFolderName = `${item.street} ${item.house_number || ''}`.trim();
                }
            });

            setGroupedProperties(finalGrouped);

            if (finalGrouped.length > 0) {
                setStatus('checking');
                setStatusMessage('Überprüfe Cloud-Ordnerstruktur...');
                
                try {
                    const allExpectedFolders = finalGrouped.map(item => item.displayFolderName);
                    
                    // 3. Ask Edge Function which ones are actually missing in OneDrive
                    const { data: checkData, error: checkError } = await supabase.functions.invoke('cloud-sync', {
                        body: { provider: 'onedrive', action: 'check', foldersToCreate: allExpectedFolders }
                    });
                    
                    if (checkError) throw checkError;
                    if (checkData && checkData.error) throw new Error(checkData.error);
                    
                    const missingFolders = checkData.missingFolders || [];
                    
                    if (missingFolders.length > 0) {
                        setMissingCount(missingFolders.length);
                        setStatus('creating');
                        setStatusMessage(`${missingFolders.length} neue Einheit(en) gefunden. Erstelle Ordnerstruktur in der Cloud...`);
                        
                        const { data: createData, error: createError } = await supabase.functions.invoke('cloud-sync', {
                            body: { provider: 'onedrive', action: 'create', foldersToCreate: missingFolders }
                        });
                        
                        if (createError) throw createError;
                        if (createData && createData.error) throw new Error(createData.error);
                    }
                } catch (err) {
                    console.error("Cloud Sync Error:", err);
                    // Fallback: wait a bit so user sees it tried, even if failed, we will just proceed
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            setStatus('ready');
            setStatusMessage('');
        };

        init();
    }, []);

    const fetchFiles = async (property, pathArray) => {
        setIsLoadingFiles(true);
        try {
            const subPath = pathArray.map(p => p.name).join('/');
            const fullPath = property.displayFolderName + (subPath ? '/' + subPath : '');
            
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'list', provider: 'onedrive', path: fullPath }
            });
            
            if (error) throw error;
            if (data && data.error) throw new Error(data.error);
            
            setFiles(data.files || []);
        } catch (err) {
            console.error("Error fetching files:", err);
            setFiles([]);
        } finally {
            setIsLoadingFiles(false);
        }
    };

    useEffect(() => {
        if (selectedProperty && status === 'ready') {
            fetchFiles(selectedProperty, currentPath);
        }
    }, [selectedProperty, currentPath, status]);

    const handleSelectProperty = (prop) => {
        setSelectedProperty(prop);
        setCurrentPath([]);
    };

    const handleItemClick = (item) => {
        if (item.isFolder) {
            setCurrentPath([...currentPath, { id: item.id, name: item.name }]);
        } else if (item.url) {
            window.open(item.url, '_blank');
        }
    };

    const handleNavigateUp = (index) => {
        setCurrentPath(currentPath.slice(0, index + 1));
    };

    const handleNavigateRoot = () => {
        setCurrentPath([]);
    };

    const handleUploadClick = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file || !selectedProperty) return;
        
        setIsUploading(true);
        try {
            const subPath = currentPath.map(p => p.name).join('/');
            const fullPath = selectedProperty.displayFolderName + (subPath ? '/' + subPath : '');
            
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('provider', 'onedrive');
            formData.append('path', fullPath);
            formData.append('file', file);
            
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: formData
            });
            
            if (error) throw error;
            if (data && data.error) throw new Error(data.error);
            
            // Refresh
            fetchFiles(selectedProperty, currentPath);
        } catch (err) {
            console.error("Upload error:", err);
            alert("Fehler beim Hochladen der Datei.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCreateFolder = async () => {
        const folderName = prompt("Bitte Namen für den neuen Ordner eingeben:");
        if (!folderName || folderName.trim() === '') return;
        
        setIsLoadingFiles(true);
        try {
            const subPath = currentPath.map(p => p.name).join('/');
            const fullPath = selectedProperty.displayFolderName + (subPath ? '/' + subPath : '');
            
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'create_folder', provider: 'onedrive', path: fullPath, folderName: folderName.trim() }
            });
            
            if (error) throw error;
            if (data && data.error) throw new Error(data.error);
            
            fetchFiles(selectedProperty, currentPath);
        } catch (err) {
            console.error("Create folder error:", err);
            alert("Fehler beim Erstellen des Ordners.");
            setIsLoadingFiles(false);
        }
    };

    const handleDelete = async (e, item) => {
        e.stopPropagation();
        const confirmDelete = window.confirm(`Möchten Sie '${item.name}' wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`);
        if (!confirmDelete) return;

        setIsLoadingFiles(true);
        try {
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'delete', provider: 'onedrive', itemId: item.id }
            });
            
            if (error) throw error;
            if (data && data.error) throw new Error(data.error);
            
            fetchFiles(selectedProperty, currentPath);
        } catch (err) {
            console.error("Delete error:", err);
            alert("Fehler beim Löschen.");
            setIsLoadingFiles(false);
        }
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
                    style={{
                        width: '100%',
                        maxWidth: '350px',
                        padding: '12px 16px',
                        backgroundColor: '#0078D4',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        fontSize: '1rem',
                        fontWeight: 600,
                        transition: 'background-color 0.2s',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                >
                    <Cloud size={20} />
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
                                    <div 
                                        key={`group-${item.id}`}
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
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.9rem', fontWeight: selectedProperty?.id === item.id ? 600 : 400, color: selectedProperty?.id === item.id ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                                {item.displayFolderName}
                                            </span>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                                {item.members.length} Objekte
                                            </span>
                                        </div>
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
                            {/* Breadcrumbs & Actions */}
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', backgroundColor: 'var(--bg-secondary)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span 
                                        onClick={handleNavigateRoot}
                                        style={{ cursor: 'pointer', fontWeight: 600, color: currentPath.length === 0 ? 'var(--text-primary)' : 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <Building2 size={16} />
                                        {selectedProperty.displayFolderName}
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
                                
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button 
                                        className="btn btn-outline" 
                                        onClick={handleCreateFolder}
                                        disabled={isUploading || isLoadingFiles}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '0.85rem' }}
                                    >
                                        <FolderPlus size={16} />
                                        Neuer Ordner
                                    </button>
                                    
                                    <input 
                                        type="file" 
                                        ref={fileInputRef} 
                                        style={{ display: 'none' }} 
                                        onChange={handleFileChange} 
                                    />
                                    <button 
                                        className="btn btn-primary" 
                                        onClick={handleUploadClick}
                                        disabled={isUploading || isLoadingFiles}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontSize: '0.85rem' }}
                                    >
                                        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                                        {isUploading ? 'Wird hochgeladen...' : 'Datei hochladen'}
                                    </button>
                                </div>
                            </div>

                            {/* File Grid */}
                            <div style={{ padding: '24px', flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '20px', alignContent: 'start', position: 'relative' }}>
                                {isLoadingFiles && (
                                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 10 }}>
                                        <Loader2 size={32} color="var(--primary-color)" className="animate-spin" />
                                    </div>
                                )}
                                
                                {!isLoadingFiles && files.length === 0 && (
                                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                                        Dieser Ordner ist leer.
                                    </div>
                                )}

                                {files.map(file => {
                                    const isPdf = file.name.toLowerCase().endsWith('.pdf');
                                    const isImage = file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/);
                                    const Icon = file.isFolder ? Folder : (isImage ? ImageIcon : FileText);
                                    
                                    const PROTECTED_FOLDERS = [
                                        "Rechnungen",
                                        "Mietverträge",
                                        "Bilder",
                                        "Schriftverkehr",
                                        "Nebenkosten",
                                        "Versicherungen",
                                        "Energieausweise"
                                    ];
                                    const isProtected = file.isFolder && currentPath.length === 0 && PROTECTED_FOLDERS.includes(file.name);
                                    
                                    return (
                                        <div 
                                            key={file.id} 
                                            onClick={() => handleItemClick(file)}
                                            style={{ 
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', 
                                                padding: '16px', borderRadius: 'var(--radius-md)',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                            title={file.name}
                                        >
                                            <div style={{ position: 'relative' }}>
                                                <Icon size={48} color={file.isFolder ? '#FBBF24' : (isPdf ? '#EF4444' : '#3B82F6')} strokeWidth={1.5} />
                                                {!isProtected && (
                                                    <button 
                                                        onClick={(e) => handleDelete(e, file)}
                                                        style={{ 
                                                            position: 'absolute', top: '-6px', right: '-6px', 
                                                            background: '#EF4444', color: 'white', border: 'none', 
                                                            borderRadius: '50%', width: '22px', height: '22px', 
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            cursor: 'pointer', opacity: 0.8, padding: 0,
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                                        onMouseLeave={(e) => e.currentTarget.style.opacity = 0.8}
                                                        title="Löschen"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}
                                            </div>
                                            <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'center', wordBreak: 'break-word', color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
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
