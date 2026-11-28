import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Folder, Loader2, ChevronRight, FileText, Image as ImageIcon, Building2, HardDrive, Cloud, UploadCloud, FolderPlus, Trash2, AlertTriangle } from 'lucide-react';
import Card from '../components/ui/Card';

const PROTECTED_FOLDERS = [
    "Rechnungen",
    "Bilder",
    "Mietverhältnisse",
    "Nebenkosten",
    "Versicherungen",
    "Energieausweise",
    "Einheiten",
    "Neuvermietung"
];

// Meldung, HTTP-Status und Fehlercode einer Edge-Function-Antwort ermitteln
const getFunctionError = async (err) => {
    let message = err?.message || String(err);
    let status = typeof err?.status === 'number' ? err.status : null;
    let code = null;
    const ctx = err?.context;
    if (ctx && typeof ctx.status === 'number') status = ctx.status;
    if (ctx && typeof ctx.clone === 'function') {
        try {
            const body = await ctx.clone().json();
            if (body?.error) message = body.error;
            if (body?.code) code = body.code;
        } catch {
            // Antwort ohne JSON
        }
    }
    return { message, status, code };
};

const getErrorMessage = async (err) => (await getFunctionError(err)).message;

const providerLabel = (provider) => (provider === 'googledrive' ? 'Google Drive' : 'OneDrive');

// Ein Name ergibt genau EIN Cloud-Ordnersegment: '/' und '\' würden sonst Unterordner erzeugen.
// Gleiche Regel wie folderSegment in cloud-sync (ebenso in Properties.jsx und TenantDetail.jsx),
// sonst sucht der Explorer einen anderen Ordner als den, den cloud-sync angelegt hat.
const cloudFolderSegment = (value) => String(value ?? '').replace(/[\\/]/g, '-');

const CloudExplorer = () => {
    const { user } = useAuth();
    const userId = user?.id;
    const navigate = useNavigate();
    const [groupedProperties, setGroupedProperties] = useState([]);
    const [status, setStatus] = useState('loading'); // loading, checking, creating, ready, no_connection, error
    const [statusMessage, setStatusMessage] = useState('Überprüfe Cloud-Verbindung...');
    const [reloadKey, setReloadKey] = useState(0);

    const [selectedProperty, setSelectedProperty] = useState(null);
    const [currentPath, setCurrentPath] = useState([]);
    const [files, setFiles] = useState([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Dateien werden geladen...');
    const [isUploading, setIsUploading] = useState(false);
    const [fetchError, setFetchError] = useState(null);
    const fileInputRef = useRef(null);
    // Schutz gegen veraltete Antworten: nur das Ergebnis des letzten Aufrufs wird übernommen
    const requestSeqRef = useRef(0);
    // Ordnerstruktur je Objekt nur einmal pro Sitzung prüfen (nicht bei jedem Öffnen der Objekt-Wurzel)
    const checkedPropertiesRef = useRef(new Set());

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;

        const init = async () => {
            setStatus('loading');
            setStatusMessage('Überprüfe Cloud-Verbindung...');

            // 1. Eigene Cloud-Verbindungen (ohne Tokens)
            const { data: connections, error: connError } = await supabase
                .from('cloud_connections')
                .select('id, provider, account_email, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });
            if (cancelled) return;

            if (connError) {
                console.error('Error loading cloud connections:', connError);
                setStatusMessage('Die Cloud-Verbindungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
                setStatus('error');
                return;
            }
            if (!connections || connections.length === 0) {
                setStatus('no_connection');
                return;
            }

            const connectionMap = {};
            connections.forEach(c => { connectionMap[c.id] = c; });
            // Ohne Zuweisung nur dann eine Cloud verwenden, wenn es genau eine Verbindung gibt
            const singleConnection = connections.length === 1 ? connections[0] : null;

            // Portfolio-Zuweisungen
            const { data: cloudLinks, error: linksError } = await supabase
                .from('portfolio_cloud_links')
                .select('portfolio_id, cloud_connection_id')
                .eq('user_id', userId);
            if (cancelled) return;
            if (linksError) {
                console.error('Error loading portfolio cloud links:', linksError);
                setStatusMessage('Die Portfolio-Zuweisungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
                setStatus('error');
                return;
            }

            const portfolioLinkMap = {};
            (cloudLinks || []).forEach(link => {
                portfolioLinkMap[link.portfolio_id] = link.cloud_connection_id;
            });

            setStatusMessage('Lade Immobilien...');

            // 2. Objekte
            const { data: props, error: propsError } = await supabase
                .from('properties')
                .select('id, street, house_number, city, portfolio_id, economic_unit_id')
                .order('street');
            if (cancelled) return;
            if (propsError) {
                console.error('Error loading properties:', propsError);
                setStatusMessage('Die Immobilien konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
                setStatus('error');
                return;
            }

            const safeProps = props || [];

            // Verbindung je Objekt: Portfolio-Zuweisung, sonst nur die einzige vorhandene Verbindung
            safeProps.forEach(p => {
                const connId = portfolioLinkMap[p.portfolio_id];
                const conn = connId ? (connectionMap[connId] || null) : singleConnection;
                p.cloud_connection = conn;
                p.provider = conn ? conn.provider : null;
            });

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

            // Calculate display folder names and assign connection
            finalGrouped.forEach(item => {
                let conn;
                if (item.isGroup) {
                    const firstMember = item.members[0];
                    conn = firstMember ? firstMember.cloud_connection : null;

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
                            return `${cloudFolderSegment(street)} ${nums.map(cloudFolderSegment).join(' & ')}`;
                        }
                        return cloudFolderSegment(street);
                    });
                    const displayNames = parts.slice(0, 2).join(' | ');
                    const groupName = parts.length > 2 ? `${displayNames} u.a.` : displayNames;
                    item.displayFolderName = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`;
                } else {
                    conn = item.cloud_connection;
                    item.displayFolderName = `${cloudFolderSegment(item.street)} ${cloudFolderSegment(item.house_number || '')}`.trim();
                }
                item.cloud_connection = conn || null;
                item.provider = conn ? conn.provider : null;
            });

            setGroupedProperties(finalGrouped);
            setStatus('ready');
            setStatusMessage('');
        };

        init().catch(err => {
            if (cancelled) return;
            console.error('Error initializing cloud explorer:', err);
            setStatusMessage('Der Cloud Explorer konnte nicht geladen werden. Bitte versuchen Sie es erneut.');
            setStatus('error');
        });

        return () => { cancelled = true; };
    }, [userId, reloadKey]);

    const fetchFiles = useCallback(async (property, pathArray) => {
        const requestId = ++requestSeqRef.current;
        const isCurrent = () => requestId === requestSeqRef.current;
        const connection = property?.cloud_connection;

        // Ohne zugewiesene Cloud keine Abfrage (Hinweis wird in der Ansicht angezeigt)
        if (!connection) {
            setFiles([]);
            setFetchError(null);
            setIsLoadingFiles(false);
            return;
        }

        setIsLoadingFiles(true);
        setLoadingMessage('Dateien werden geladen...');
        setFetchError(null);
        try {
            const subPath = pathArray.map(p => p.name).join('/');
            const fullPath = property.displayFolderName + (subPath ? '/' + subPath : '');
            // connectionId wählt genau die zugewiesene Verbindung (provider bleibt für ältere Function-Versionen)
            const baseBody = { provider: connection.provider, connectionId: connection.id };

            const listFolder = async () => {
                const res = await supabase.functions.invoke('cloud-drive', {
                    body: { ...baseBody, action: 'list', path: fullPath }
                });
                if (!res.error) {
                    if (res.data?.error) throw new Error(res.data.error);
                    return { files: res.data?.files || [], notFound: false };
                }
                const info = await getFunctionError(res.error);
                // Nur eine echte 404-Antwort "Ordner nicht gefunden" zählt als fehlender Ordner
                if (info.status === 404 && (!info.code || info.code === 'folder_not_found')) {
                    return { files: [], notFound: true };
                }
                throw new Error(info.message);
            };

            let { files: fetchedFiles, notFound } = await listFolder();
            if (!isCurrent()) return;

            const isRoot = pathArray.length === 0;
            const syncKey = `${connection.id}:${property.id}`;
            const needsCheck = notFound || (isRoot && (fetchedFiles.length === 0 || !checkedPropertiesRef.current.has(syncKey)));

            if (needsCheck) {
                setLoadingMessage('Prüfe Ordnerstruktur in der Cloud...');
                const { data: checkData, error: checkError } = await supabase.functions.invoke('cloud-sync', {
                    body: { ...baseBody, action: 'check', propertyId: property.id }
                });
                if (checkError) throw checkError;
                if (checkData?.error) throw new Error(checkData.error);
                if (!isCurrent()) return;

                const missingFolders = checkData?.missingFolders || [];
                if (missingFolders.length > 0) {
                    setLoadingMessage('Erstelle fehlende Cloud-Ordner...');
                    const { data: createData, error: createError } = await supabase.functions.invoke('cloud-sync', {
                        body: { ...baseBody, action: 'create', propertyId: property.id, foldersToCreate: missingFolders }
                    });
                    if (createError) throw createError;
                    if (createData?.error) throw new Error(createData.error);
                    if (!isCurrent()) return;

                    // Re-fetch files after creating the folders
                    setLoadingMessage('Lade aktualisierte Dateien...');
                    const refetch = await listFolder();
                    if (!isCurrent()) return;
                    fetchedFiles = refetch.files;
                    notFound = refetch.notFound;
                }
                checkedPropertiesRef.current.add(syncKey);
            }

            if (notFound) {
                setFiles([]);
                setFetchError('Dieser Ordner wurde in der Cloud nicht gefunden. Möglicherweise wurde er umbenannt oder gelöscht.');
                return;
            }

            setFiles(fetchedFiles);
        } catch (err) {
            const errMsg = await getErrorMessage(err);
            if (!isCurrent()) return;
            console.error("Error fetching files:", err);
            setFetchError(errMsg);
            setFiles([]);
        } finally {
            if (isCurrent()) {
                setIsLoadingFiles(false);
                setLoadingMessage('Dateien werden geladen...');
            }
        }
    }, []);

    useEffect(() => {
        if (selectedProperty && status === 'ready') {
            fetchFiles(selectedProperty, currentPath);
        }
    }, [selectedProperty, currentPath, status, fetchFiles]);

    const handleSelectProperty = (prop) => {
        setSelectedProperty(prop);
        setCurrentPath([]);
        setFetchError(null);
    };

    const handleItemClick = (item) => {
        if (item.isFolder) {
            setCurrentPath([...currentPath, { id: item.id, name: item.name }]);
        } else if (item.url) {
            window.open(item.url, '_blank', 'noopener,noreferrer');
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
        const connection = selectedProperty?.cloud_connection;
        if (!file || !selectedProperty || !connection) return;

        setIsUploading(true);
        try {
            const subPath = currentPath.map(p => p.name).join('/');
            const fullPath = selectedProperty.displayFolderName + (subPath ? '/' + subPath : '');

            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('provider', connection.provider);
            formData.append('connectionId', connection.id);
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
            const errMsg = await getErrorMessage(err);
            alert("Fehler beim Hochladen der Datei: " + errMsg);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCreateFolder = async () => {
        const connection = selectedProperty?.cloud_connection;
        if (!connection) return;
        const folderName = prompt("Bitte Namen für den neuen Ordner eingeben:");
        if (!folderName || folderName.trim() === '') return;

        setIsLoadingFiles(true);
        try {
            const subPath = currentPath.map(p => p.name).join('/');
            const fullPath = selectedProperty.displayFolderName + (subPath ? '/' + subPath : '');

            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'create_folder', provider: connection.provider, connectionId: connection.id, path: fullPath, folderName: folderName.trim() }
            });

            if (error) throw error;
            if (data && data.error) throw new Error(data.error);

            fetchFiles(selectedProperty, currentPath);
        } catch (err) {
            console.error("Create folder error:", err);
            const errMsg = await getErrorMessage(err);
            alert("Fehler beim Erstellen des Ordners: " + errMsg);
            setIsLoadingFiles(false);
        }
    };

    const handleDelete = async (e, item) => {
        e.stopPropagation();
        const connection = selectedProperty?.cloud_connection;
        if (!connection) return;
        const confirmDelete = window.confirm(`Möchten Sie '${item.name}' wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`);
        if (!confirmDelete) return;

        setIsLoadingFiles(true);
        try {
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'delete', provider: connection.provider, connectionId: connection.id, itemId: item.id }
            });

            if (error) throw error;
            if (data && data.error) throw new Error(data.error);

            fetchFiles(selectedProperty, currentPath);
        } catch (err) {
            console.error("Delete error:", err);
            const errMsg = await getErrorMessage(err);
            alert("Fehler beim Löschen: " + errMsg);
            setIsLoadingFiles(false);
        }
    };

    const goToCloudSettings = () => navigate('/settings', { state: { activeTab: 'cloud' } });

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
                    onClick={goToCloudSettings}
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

    if (status === 'error') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '20px' }}>
                <AlertTriangle size={56} color="var(--danger-color)" />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
                    {statusMessage}
                </h2>
                <button
                    className="btn btn-primary"
                    onClick={() => setReloadKey(k => k + 1)}
                    style={{ padding: '10px 20px' }}
                >
                    Erneut versuchen
                </button>
            </div>
        );
    }

    if (status !== 'ready') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '20px' }}>
                <div style={{ position: 'relative' }}>
                    {status === 'creating' ? (
                        <Folder size={64} color="var(--primary-color)" />
                    ) : (
                        <HardDrive size={64} color="var(--primary-color)" />
                    )}
                    <Loader2 size={24} color="#10B981" className="animate-spin" style={{ position: 'absolute', bottom: '-10px', right: '-10px', backgroundColor: 'var(--surface-color)', borderRadius: '50%' }} />
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
                    {statusMessage}
                </h2>
                {status === 'creating' && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '400px', textAlign: 'center' }}>
                        Bitte haben Sie einen Moment Geduld. Wir legen automatisch die korrekte Struktur (Rechnungen, Mietverhältnisse etc.) in Ihrer verknüpften Cloud an.
                    </p>
                )}
            </div>
        );
    }

    const selectedConnection = selectedProperty?.cloud_connection || null;

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
                    <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--input-bg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Building2 size={18} color="var(--text-secondary)" />
                        Immobilien
                    </div>
                    <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                        {groupedProperties.map((item) => {
                            const isSelected = selectedProperty?.id === item.id;
                            const notAssigned = !item.cloud_connection && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--warning-color)' }}>
                                    Keine Cloud zugewiesen
                                </span>
                            );
                            if (item.isGroup) {
                                return (
                                    <div
                                        key={`group-${item.id}`}
                                        onClick={() => handleSelectProperty(item)}
                                        style={{
                                            padding: '12px 16px',
                                            cursor: 'pointer',
                                            borderBottom: '1px solid var(--border-color)',
                                            backgroundColor: isSelected ? 'var(--hover-bg)' : 'var(--surface-color)',
                                            borderLeft: isSelected ? '3px solid var(--primary-color)' : '3px solid transparent',
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <Folder size={16} color={isSelected ? 'var(--primary-color)' : '#64748b'} />
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.9rem', fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                                {item.displayFolderName}
                                            </span>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                                {item.members.length} Objekte
                                            </span>
                                            {notAssigned}
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
                                            backgroundColor: isSelected ? 'var(--hover-bg)' : 'var(--surface-color)',
                                            borderLeft: isSelected ? '3px solid var(--primary-color)' : '3px solid transparent',
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <Folder size={16} color={isSelected ? 'var(--primary-color)' : '#64748b'} />
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.9rem', fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                                                {item.isVirtual ? item.street : `${item.street} ${item.house_number}`}
                                            </span>
                                            {notAssigned}
                                        </div>
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
                    ) : !selectedConnection ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <Cloud size={48} color="var(--warning-color)" />
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                Diesem Portfolio ist keine Cloud zugewiesen.
                            </div>
                            <p style={{ maxWidth: '420px', fontSize: '0.9rem' }}>
                                Sie haben mehrere Cloud-Verbindungen. Bitte legen Sie in den Cloud-Einstellungen fest, in welcher Cloud die Dokumente dieses Portfolios abgelegt werden sollen.
                            </p>
                            <button className="btn btn-primary" onClick={goToCloudSettings} style={{ padding: '8px 16px' }}>
                                Zu den Cloud-Einstellungen
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Breadcrumbs & Actions */}
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', backgroundColor: 'var(--input-bg)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        Cloud: {providerLabel(selectedConnection.provider)}{selectedConnection.account_email ? ` – ${selectedConnection.account_email}` : ''}
                                    </span>
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
                                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 10, gap: '12px' }}>
                                        <Loader2 size={32} color="var(--primary-color)" className="animate-spin" />
                                        <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{loadingMessage}</div>
                                    </div>
                                )}

                                {fetchError && (
                                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: '#EF4444' }}>
                                        <div style={{ fontWeight: 600, marginBottom: '8px' }}>Fehler beim Abrufen des Ordners:</div>
                                        <div style={{ fontSize: '0.9rem' }}>{fetchError}</div>
                                    </div>
                                )}

                                {!isLoadingFiles && !fetchError && files.length === 0 && (
                                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                                        Dieser Ordner ist leer.
                                    </div>
                                )}

                                {files.map(file => {
                                    const isPdf = file.name.toLowerCase().endsWith('.pdf');
                                    const isImage = file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/);
                                    const Icon = file.isFolder ? Folder : (isImage ? ImageIcon : FileText);

                                    let isProtected = isLoadingFiles;
                                    if (file.isFolder) {
                                        const pathNames = currentPath.map(p => p.name);

                                        if (pathNames.length === 0) {
                                            if (PROTECTED_FOLDERS.includes(file.name)) {
                                                isProtected = true;
                                            }
                                        } else if (pathNames.length === 1) {
                                            const parentName = pathNames[0];
                                            if (parentName === 'Einheiten') {
                                                if (selectedProperty?.isGroup) {
                                                    // Ordnername wie in cloud-sync: Hausnummer als ein Segment, sonst 'Ohne Hausnummer'
                                                    const hasMatchingHouseNumber = selectedProperty.members?.some(m => cloudFolderSegment(m.house_number || 'Ohne Hausnummer') === file.name);
                                                    if (hasMatchingHouseNumber) {
                                                        isProtected = true;
                                                    }
                                                } else {
                                                    isProtected = true;
                                                }
                                            }
                                        } else if (pathNames.length === 2) {
                                            const [p0] = pathNames;
                                            if (p0 === 'Einheiten') {
                                                if (selectedProperty?.isGroup) {
                                                    isProtected = true;
                                                } else {
                                                    isProtected = file.name === 'Bilder' || file.name === 'Mietverhältnisse';
                                                }
                                            }
                                        } else if (pathNames.length === 3) {
                                            const [p0, , p2] = pathNames;
                                            if (p0 === 'Einheiten') {
                                                if (selectedProperty?.isGroup) {
                                                    isProtected = file.name === 'Bilder' || file.name === 'Mietverhältnisse';
                                                } else if (p2 === 'Mietverhältnisse') {
                                                    isProtected = true;
                                                }
                                            }
                                        } else if (pathNames.length === 4) {
                                            const [p0, , , p3] = pathNames;
                                            if (p0 === 'Einheiten' && selectedProperty?.isGroup && p3 === 'Mietverhältnisse') {
                                                isProtected = true;
                                            }
                                        }
                                    }

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
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
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
