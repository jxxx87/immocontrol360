import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Building2, ChevronDown, ChevronRight, MoreVertical, Edit, Edit3, Trash2, AlertCircle, Home, Key, LayoutGrid, List, Check, Filter, Upload, Image, Loader2, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { translateError } from '../lib/errorTranslator';
import { useViewMode } from '../context/ViewModeContext';
import { useSubscription } from '../context/SubscriptionContext';
import ExportDropdown from '../components/ExportDropdown';
import { getLoanSnapshot } from '../lib/loanSchedule';

import LoadingOverlay from '../components/ui/LoadingOverlay';

// Darlehen: Restschuld und aktuelle Monatsrate wie auf der Darlehen-Seite und im Cockpit (src/lib/loanSchedule.js).
// Getilgte Darlehen zählen mit 0 € Rate, die letzte Rate ist auf Restschuld + Zins begrenzt.
const sumLoanFigures = (loanList, now = new Date()) => loanList.reduce((acc, loan) => {
    const snapshot = getLoanSnapshot(loan, now);
    acc.debt += snapshot.debt;
    acc.payment += snapshot.payment;
    return acc;
}, { debt: 0, payment: 0 });

// ---------------------------------------------------------------------------
// Gemeinsame Helfer: Stichtag, Vermietungsstatus, Ist-Miete (Liste, Detail, Export)
// ---------------------------------------------------------------------------

// Lokales Datum als YYYY-MM-DD (toISOString() liefert UTC und kippt nachts um einen Tag)
const getLocalDateString = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// Ein Mietvertrag zählt nur, wenn er aktiv ist UND der Stichtag im Vertragszeitraum liegt
const isLeaseActiveOn = (lease, today) =>
    !!lease &&
    lease.status === 'active' &&
    (!lease.start_date || lease.start_date <= today) &&
    (!lease.end_date || lease.end_date >= today);

const getUnitRentInfo = (unit, today) => {
    if (unit?.is_vacation_rental) {
        return { status: 'vacation_rental', actualRent: parseFloat(unit.cold_rent_ist) || parseFloat(unit.target_rent) || 0 };
    }
    // Bei mehreren laufenden Verträgen den zuletzt begonnenen verwenden
    const currentLease = (unit?.leases || [])
        .filter(l => isLeaseActiveOn(l, today))
        .reduce((latest, l) => (!latest || (l.start_date || '') > (latest.start_date || '') ? l : latest), null);
    return {
        status: currentLease ? 'rented' : 'vacant',
        actualRent: currentLease ? (parseFloat(currentLease.cold_rent) || 0) : 0
    };
};

const withRentInfo = (unit, today) => {
    const info = getUnitRentInfo(unit, today);
    return { ...unit, status: info.status, actual_rent: info.actualRent };
};

const PROPERTY_TYPE_LABELS = { residential: 'Wohnen', commercial: 'Gewerbe', mixed: 'Gemischt' };
const PROPERTY_TYPE_BADGE_COLORS = {
    residential: 'rgba(59, 130, 246, 0.85)',
    commercial: 'rgba(245, 158, 11, 0.85)',
    mixed: 'rgba(16, 185, 129, 0.85)'
};
const getPropertyTypeKey = (type) => (PROPERTY_TYPE_LABELS[type] ? type : 'residential');
const getPropertyTypeLabel = (type) => PROPERTY_TYPE_LABELS[getPropertyTypeKey(type)];

const CATEGORY_LABELS = {
    immobilien: 'Immobilien',
    mietverhaeltnisse: 'Mietverhältnisse',
    finanzen: 'Finanzen',
    nebenkosten: 'Nebenkosten',
    zaehler: 'Zähler'
};

const PROVIDER_LABELS = { onedrive: 'OneDrive', googledrive: 'Google Drive' };

const NO_WRITE_PERMISSION_MESSAGE = 'Sie haben für dieses Portfolio keine Schreibberechtigung für Immobilien.';

const formatPropertyLabel = (p) => `${p?.street || ''} ${p?.house_number || ''}`.trim() || 'Ohne Adresse';
const formatPropertyList = (list) => list.map(formatPropertyLabel).join(', ');
const formatEuro = (value) => (parseFloat(value) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const sameAmount = (a, b) => (parseFloat(a) || 0) === (parseFloat(b) || 0);
const countLabel = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

const createUserError = (message) => Object.assign(new Error(message), { isUserMessage: true });
const getErrorMessage = (error) => (error?.isUserMessage ? error.message : translateError(error));

// Bild-Uploads: nur Formate, die die Bildliste auch anzeigt
const ALLOWED_IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;
const MAX_IMAGE_SIZE_MB = 20;
const validateImageFile = (file) => {
    if (!file) return 'keine Datei';
    if (!ALLOWED_IMAGE_EXTENSIONS.test(file.name || '')) return 'nicht unterstütztes Format (erlaubt: JPG, PNG, GIF, WebP)';
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) return `Datei größer als ${MAX_IMAGE_SIZE_MB} MB`;
    return null;
};

// Ein Name ergibt genau EIN Cloud-Ordnersegment: '/' und '\' würden sonst Unterordner erzeugen.
// Gleiche Regel wie folderSegment in cloud-sync (ebenso in TenantDetail.jsx und sync-applicant-files).
const cloudFolderSegment = (value) => String(value ?? '').replace(/[\\/]/g, '-');

// Relativer Ordner einer Einheit – muss der Ordnerstruktur von cloud-sync entsprechen
const getUnitFolderRelativePath = (property, unitName) => {
    if (!property || !unitName) return '';
    return property.economic_unit_id
        ? `Einheiten/${cloudFolderSegment(property.house_number || 'Ohne Hausnummer')}/${cloudFolderSegment(unitName)}`
        : `Einheiten/${cloudFolderSegment(unitName)}`;
};

// Relativer Bilder-Pfad einer Einheit
const getUnitImagesRelativePath = (property, unitName) => {
    const unitFolder = getUnitFolderRelativePath(property, unitName);
    return unitFolder ? `${unitFolder}/Bilder` : '';
};

// Fehler von supabase.functions.invoke auswerten (Status, Fehlercode, Meldung)
const readFunctionError = async (err) => {
    const info = { status: err?.context?.status ?? err?.status ?? null, code: '', message: err?.message || String(err) };
    try {
        if (err?.context && typeof err.context.json === 'function') {
            const body = await err.context.json();
            if (body?.code) info.code = String(body.code);
            if (body?.error) info.message = String(body.error);
        }
    } catch {
        // Antwort ohne JSON-Inhalt
    }
    return info;
};

// Clouds, in denen cloud-sync die Ordner eines Portfolios anlegt: die zugewiesene Verbindung,
// sonst je Anbieter die älteste Verbindung. null = Verbindungen konnten nicht gelesen werden.
const loadCloudFolderTargets = async (portfolioId) => {
    try {
        const [connRes, linkRes] = await Promise.all([
            supabase.from('cloud_connections').select('id, provider').order('created_at', { ascending: true }),
            portfolioId
                ? supabase.from('portfolio_cloud_links').select('cloud_connection_id').eq('portfolio_id', portfolioId).maybeSingle()
                : Promise.resolve({ data: null, error: null })
        ]);
        if (connRes.error) throw connRes.error;
        if (linkRes.error) throw linkRes.error;
        const connections = connRes.data || [];
        const linkedId = linkRes.data?.cloud_connection_id;
        const linked = linkedId ? connections.find(c => c.id === linkedId) : null;
        if (linked) return [linked];
        const oldestPerProvider = new Map();
        connections.forEach(c => {
            if (c.provider && !oldestPerProvider.has(c.provider)) oldestPerProvider.set(c.provider, c);
        });
        return Array.from(oldestPerProvider.values());
    } catch (e) {
        console.error('Error loading cloud connections:', e);
        return null;
    }
};

// Cloud-Ordner nach einer Umbenennung mitziehen (cloud-drive "move"), damit Bilder und Dokumente
// nicht in einem verwaisten Ordner liegen bleiben. Liefert Hinweise für den Nutzer.
const moveCloudFolder = async (targets, fromPath, toPath) => {
    const notices = [];
    if (!targets || !fromPath || !toPath || fromPath === toPath) return notices;
    for (const conn of targets) {
        const { error } = await supabase.functions.invoke('cloud-drive', {
            body: { action: 'move', provider: conn.provider, connectionId: conn.id, fromPath, toPath }
        });
        if (!error) continue;
        const info = await readFunctionError(error);
        // Kein Ordner unter dem alten Namen vorhanden -> nichts zu verschieben
        if (info.status === 404 && info.code === 'source_not_found') continue;
        console.error('Cloud folder move error:', info.status, info.code);
        const label = PROVIDER_LABELS[conn.provider] || conn.provider;
        notices.push(info.status === 409
            ? `${label}: Der Cloud-Ordner „${fromPath}“ wurde nicht umbenannt, weil „${toPath}“ bereits existiert. Bitte führen Sie die Ordner bei Bedarf selbst zusammen.`
            : `${label}: Der Cloud-Ordner „${fromPath}“ konnte nicht in „${toPath}“ umbenannt werden. Bereits abgelegte Bilder und Dokumente bleiben im bisherigen Ordner.`);
    }
    return notices;
};

// ---------------------------------------------------------------------------
// Zählhilfen für die Lösch-Prüfung (es werden nur Anzahlen geladen, keine Inhalte)
// ---------------------------------------------------------------------------
const IN_CHUNK_SIZE = 100;

const countRows = async (table, applyFilter) => {
    const { count, error } = await applyFilter(supabase.from(table).select('*', { count: 'exact', head: true }));
    if (error) throw error;
    return count || 0;
};

// .in()-Abfragen blockweise, damit die URL bei vielen IDs nicht zu lang wird
const countRowsIn = async (table, column, ids, applyExtra = (q) => q) => {
    let total = 0;
    for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
        total += await countRows(table, q => applyExtra(q.in(column, chunk)));
    }
    return total;
};

const fetchRowsIn = async (table, columns, column, ids) => {
    const rows = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
        const { data, error } = await supabase.from(table).select(columns).in(column, ids.slice(i, i + IN_CHUNK_SIZE));
        if (error) throw error;
        rows.push(...(data || []));
    }
    return rows;
};

// Für reine Hinweis-Zählungen: Fehler nicht als Abbruch werten, sondern als "unbekannt" (null)
const safeCount = (promise) => promise.catch((e) => {
    console.error('Error counting dependencies:', e);
    return null;
});

const EFFECT_DELETED = ['wird mitgelöscht', 'werden mitgelöscht'];
const EFFECT_UNLINKED = ['bleibt erhalten, die Zuordnung wird entfernt', 'bleiben erhalten, die Zuordnung wird entfernt'];

const describeDependencies = (entries) => entries
    .filter(e => e.count === null || e.count > 0)
    .map(e => (e.count === null
        ? `${e.plural}: Anzahl konnte nicht ermittelt werden`
        : `${countLabel(e.count, e.singular, e.plural)} – ${e.count === 1 ? e.effect[0] : e.effect[1]}`));

const collectUnitDependencies = async (unitId) => {
    const { data: leaseRows, error: leaseError } = await supabase
        .from('leases')
        .select('id, status')
        .eq('unit_id', unitId);
    if (leaseError) throw leaseError;
    const leaseIds = (leaseRows || []).map(l => l.id);

    // Verträge, Zahlungen und Dokumente sind ausschlaggebend für die Sperre -> Fehler brechen ab
    const [payments, documents] = await Promise.all([
        countRowsIn('rent_payments', 'lease_id', leaseIds),
        countRows('documents', q => q.eq('unit_id', unitId))
    ]);
    const [invoices, meters, settlements, tickets, rentalProcesses, expenses, floorPlans] = await Promise.all([
        safeCount(countRows('invoices', q => q.eq('unit_id', unitId))),
        safeCount(countRows('meters', q => q.eq('unit_id', unitId))),
        safeCount(countRows('utility_settlements', q => q.contains('data', { selectedUnitIds: [unitId] }))),
        safeCount(countRows('tickets', q => q.eq('unit_id', unitId))),
        safeCount(countRows('rental_processes', q => q.eq('unit_id', unitId))),
        safeCount(countRows('expenses', q => q.eq('unit_id', unitId))),
        safeCount(countRows('floor_plans', q => q.eq('unit_id', unitId)))
    ]);

    return {
        leases: leaseIds.length,
        activeLeases: (leaseRows || []).filter(l => l.status === 'active').length,
        payments,
        documents,
        invoices,
        meters,
        settlements,
        tickets,
        rentalProcesses,
        expenses,
        floorPlans
    };
};

const collectPropertyDependencies = async (propertyId) => {
    const { data: unitRows, error: unitError } = await supabase
        .from('units')
        .select('id')
        .eq('property_id', propertyId);
    if (unitError) throw unitError;
    const unitIds = (unitRows || []).map(u => u.id);

    const leaseRows = await fetchRowsIn('leases', 'id, status', 'unit_id', unitIds);
    const leaseIds = leaseRows.map(l => l.id);

    // Ausschlaggebend für die Sperre -> Fehler brechen ab
    const [payments, loans, documentsOnProperty, documentsOnUnits, settlements] = await Promise.all([
        countRowsIn('rent_payments', 'lease_id', leaseIds),
        countRows('loans', q => q.eq('property_id', propertyId)),
        countRows('documents', q => q.eq('property_id', propertyId)),
        countRowsIn('documents', 'unit_id', unitIds, q => q.or(`property_id.is.null,property_id.neq.${propertyId}`)),
        countRows('utility_settlements', q => q.eq('property_id', propertyId))
    ]);

    let meterIds = null;
    try {
        const { data: meterRows, error: meterError } = await supabase.from('meters').select('id').eq('property_id', propertyId);
        if (meterError) throw meterError;
        meterIds = (meterRows || []).map(m => m.id);
    } catch (e) {
        console.error('Error counting meters:', e);
    }

    const [meterReadings, invoices, expenses, tickets, announcements, renovationProjects, calendarEvents, rentalProcesses, floorPlans] = await Promise.all([
        meterIds === null ? Promise.resolve(null) : safeCount(countRowsIn('meter_readings', 'meter_id', meterIds)),
        safeCount(countRows('invoices', q => q.eq('property_id', propertyId))),
        safeCount(countRows('expenses', q => q.eq('property_id', propertyId))),
        safeCount(countRows('tickets', q => q.eq('property_id', propertyId))),
        safeCount(countRows('announcements', q => q.eq('property_id', propertyId))),
        safeCount(countRows('renovation_projects', q => q.eq('property_id', propertyId))),
        safeCount(countRows('objektkalender_events', q => q.eq('property_id', propertyId))),
        safeCount(countRowsIn('rental_processes', 'unit_id', unitIds)),
        safeCount(countRows('floor_plans', q => q.eq('property_id', propertyId)))
    ]);

    return {
        units: unitIds.length,
        leases: leaseIds.length,
        activeLeases: leaseRows.filter(l => l.status === 'active').length,
        payments,
        loans,
        documents: documentsOnProperty + documentsOnUnits,
        settlements,
        meters: meterIds === null ? null : meterIds.length,
        meterReadings,
        invoices,
        expenses,
        tickets,
        announcements,
        renovationProjects,
        calendarEvents,
        rentalProcesses,
        floorPlans
    };
};

// Bild-Links aus der Cloud zwischenspeichern: verhindert je Bild und Render einen erneuten
// Edge-Function-Aufruf. Die Links der Anbieter sind nur begrenzt gültig -> nach 30 Minuten neu holen.
const DOWNLOAD_LINK_TTL_MS = 30 * 60 * 1000;
const downloadLinkCache = new Map();

// connectionId wählt genau die zugewiesene Verbindung (mehrere Konten desselben Anbieters)
const downloadLinkKey = (provider, itemId, connectionId) => `${provider}:${connectionId || ''}:${itemId}`;

const getCachedDownloadLink = (provider, itemId, connectionId) => {
    const entry = downloadLinkCache.get(downloadLinkKey(provider, itemId, connectionId));
    return entry?.url && Date.now() - entry.ts < DOWNLOAD_LINK_TTL_MS ? entry.url : null;
};

const rememberDownloadLink = (provider, itemId, url, connectionId) => {
    if (url) downloadLinkCache.set(downloadLinkKey(provider, itemId, connectionId), { url, ts: Date.now() });
};

const forgetDownloadLink = (provider, itemId, connectionId) => {
    downloadLinkCache.delete(downloadLinkKey(provider, itemId, connectionId));
};

const fetchDownloadLink = (provider, itemId, connectionId) => {
    const key = downloadLinkKey(provider, itemId, connectionId);
    const cachedUrl = getCachedDownloadLink(provider, itemId, connectionId);
    if (cachedUrl) return Promise.resolve(cachedUrl);
    const pending = downloadLinkCache.get(key);
    if (pending?.promise) return pending.promise;

    const promise = supabase.functions.invoke('cloud-drive', {
        body: {
            action: 'get_download_link',
            provider,
            ...(connectionId ? { connectionId } : {}),
            itemId
        }
    }).then(({ data, error }) => {
        if (error || !data?.downloadUrl) {
            downloadLinkCache.delete(key);
            return null;
        }
        downloadLinkCache.set(key, { url: data.downloadUrl, ts: Date.now() });
        return data.downloadUrl;
    }).catch((e) => {
        downloadLinkCache.delete(key);
        console.error("Error loading thumbnail:", e);
        return null;
    });
    downloadLinkCache.set(key, { promise });
    return promise;
};


// CloudImage Component
const CloudImage = ({ provider, connectionId = null, itemId, initialUrl = null, fallbackIcon, style, premiumView = false }) => {
    const FallbackIcon = fallbackIcon;
    const resolvedProvider = provider || 'onedrive';
    const [imgSrc, setImgSrc] = useState(() => (itemId ? (initialUrl || getCachedDownloadLink(resolvedProvider, itemId, connectionId)) : null));
    const [loading, setLoading] = useState(() => !!itemId && !initialUrl && !getCachedDownloadLink(resolvedProvider, itemId, connectionId));

    useEffect(() => {
        let isMounted = true;
        const loadThumbnail = async () => {
            if (!itemId) {
                if (isMounted) {
                    setImgSrc(null);
                    setLoading(false);
                }
                return;
            }
            // Die Liste liefert bei manchen Anbietern bereits einen Vorschau-Link -> kein Zusatzaufruf
            if (initialUrl) {
                rememberDownloadLink(resolvedProvider, itemId, initialUrl, connectionId);
                if (isMounted) {
                    setImgSrc(initialUrl);
                    setLoading(false);
                }
                return;
            }
            const url = await fetchDownloadLink(resolvedProvider, itemId, connectionId);
            if (isMounted) {
                setImgSrc(url);
                setLoading(false);
            }
        };
        loadThumbnail();
        return () => { isMounted = false; };
    }, [itemId, resolvedProvider, initialUrl, connectionId]);

    const handleImageError = () => {
        forgetDownloadLink(resolvedProvider, itemId, connectionId);
        setImgSrc(null);
    };

    if (loading) {
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 'var(--radius-sm)', ...style }}>
                <Loader2 className="animate-spin" size={16} color="var(--primary-color)" />
            </div>
        );
    }

    if (!imgSrc) {
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', ...style }}>
                <FallbackIcon size={24} strokeWidth={1.5} />
            </div>
        );
    }

    if (premiumView) {
        return (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-sm)', ...style }}>
                {/* Blurred background glow */}
                <img
                    src={imgSrc}
                    alt=""
                    style={{
                        position: 'absolute',
                        top: '-10px',
                        left: '-10px',
                        width: 'calc(100% + 20px)',
                        height: 'calc(100% + 20px)',
                        objectFit: 'cover',
                        filter: 'blur(8px) brightness(0.6)',
                        zIndex: 1
                    }}
                />
                {/* Main uncropped image */}
                <img
                    src={imgSrc}
                    alt="Vorschau"
                    style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        zIndex: 2
                    }}
                    onError={handleImageError}
                />
            </div>
        );
    }

    return (
        <img
            src={imgSrc}
            alt="Vorschau"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)', ...style }}
            onError={handleImageError}
        />
    );
};

// Vorschau einer lokal gewählten Datei: Die Object-URL wird im Effekt erzeugt und beim
// Entfernen/Unmount wieder freigegeben (vorher wurde bei jedem Render eine neue URL erzeugt).
const LocalImagePreview = ({ file }) => {
    const imgRef = React.useRef(null);

    useEffect(() => {
        if (!file) return undefined;
        const objectUrl = URL.createObjectURL(file);
        if (imgRef.current) imgRef.current.src = objectUrl;
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    return (
        <img
            ref={imgRef}
            alt="Vorschau"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
    );
};

// CloudImageManager Component
const CloudImageManager = ({
    provider,
    connectionId = null,
    propertyFolderName,
    relativePath,
    currentThumbnailId,
    onSelectThumbnail,
    isNewEntity,
    localFiles = [],
    onLocalFilesChange,
    pendingThumbnailIndex,
    onSelectPendingThumbnail
}) => {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = React.useRef(null);
    const listRequestRef = React.useRef(0);

    const fullPath = propertyFolderName + (relativePath ? '/' + relativePath : '');

    const fetchImages = async () => {
        if (isNewEntity || !propertyFolderName) {
            // Evtl. noch laufende Anfrage für einen anderen Ordner verwerfen
            listRequestRef.current++;
            setLoading(false);
            setImages([]);
            return;
        }
        // Nur die Antwort der zuletzt gestellten Anfrage übernehmen (Schutz gegen veraltete Antworten)
        const requestId = ++listRequestRef.current;
        setLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: {
                    action: 'list',
                    provider: provider || 'onedrive',
                    ...(connectionId ? { connectionId } : {}),
                    path: fullPath
                }
            });
            if (requestId !== listRequestRef.current) return;
            if (error) throw error;
            const list = (data?.files || []).filter(f =>
                !f.isFolder && f.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/)
            );
            setImages(list);
        } catch (e) {
            if (requestId !== listRequestRef.current) return;
            console.error("Error fetching images:", e);
            setImages([]);
        } finally {
            if (requestId === listRequestRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        fetchImages();
    }, [provider, connectionId, propertyFolderName, relativePath, isNewEntity]);

    const resetFileInput = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleUpload = async (e) => {
        if (isNewEntity) {
            const selectedFiles = Array.from(e.target.files || []);
            const rejected = [];
            const accepted = selectedFiles.filter(file => {
                const reason = validateImageFile(file);
                if (reason) rejected.push(`${file.name}: ${reason}`);
                return !reason;
            });
            if (rejected.length > 0) {
                alert(`Folgende Dateien wurden nicht übernommen:\n${rejected.join('\n')}`);
            }
            if (accepted.length > 0) {
                onLocalFilesChange([...localFiles, ...accepted]);
                if (pendingThumbnailIndex === null || pendingThumbnailIndex === undefined) {
                    onSelectPendingThumbnail(0);
                }
            }
            resetFileInput();
            return;
        }

        const file = e.target.files?.[0];
        if (!file || !propertyFolderName) return;
        const invalidReason = validateImageFile(file);
        if (invalidReason) {
            alert(`„${file.name}“ kann nicht hochgeladen werden: ${invalidReason}.`);
            resetFileInput();
            return;
        }
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('provider', provider || 'onedrive');
            if (connectionId) formData.append('connectionId', connectionId);
            formData.append('path', fullPath);
            formData.append('file', file);

            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: formData
            });
            if (error) throw error;
            if (!data?.success) throw new Error('Upload fehlgeschlagen');
            fetchImages();
        } catch (err) {
            console.error("Upload error:", err);
            alert("Fehler beim Hochladen des Bildes.");
        } finally {
            setUploading(false);
            resetFileInput();
        }
    };

    const handleDeleteCloudImage = async (e, imgId) => {
        e.stopPropagation();
        if (!confirm("Möchten Sie dieses Bild wirklich aus der Cloud löschen?")) return;
        setLoading(true);
        try {
            const { error } = await supabase.functions.invoke('cloud-drive', {
                body: {
                    action: 'delete',
                    provider: provider || 'onedrive',
                    ...(connectionId ? { connectionId } : {}),
                    itemId: imgId
                }
            });
            if (error) throw error;
            forgetDownloadLink(provider || 'onedrive', imgId, connectionId);
            if (imgId === currentThumbnailId) {
                onSelectThumbnail(null);
            }
            fetchImages();
        } catch (err) {
            console.error("Delete image error:", err);
            alert("Fehler beim Löschen des Bildes.");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteLocalFile = (e, idx) => {
        e.stopPropagation();
        const updated = localFiles.filter((_, i) => i !== idx);
        onLocalFilesChange(updated);

        if (pendingThumbnailIndex === idx) {
            onSelectPendingThumbnail(updated.length > 0 ? 0 : null);
        } else if (pendingThumbnailIndex > idx) {
            onSelectPendingThumbnail(pendingThumbnailIndex - 1);
        }
    };

    return (
        <div style={{
            backgroundColor: 'rgba(0,0,0,0.02)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--spacing-md)',
            marginTop: 'var(--spacing-sm)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {isNewEntity ? 'Lokale Bilder (Werden beim Speichern hochgeladen)' : 'Bilder in der Cloud'}
                </span>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleUpload}
                    style={{ display: 'none' }}
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple={isNewEntity}
                />
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={uploading ? undefined : Upload}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || loading}
                >
                    {uploading ? 'Wird hochgeladen...' : 'Bilder hinzufügen'}
                </Button>
            </div>

            {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px', color: 'var(--primary-color)' }} />
                    Lade Bilder aus der Cloud...
                </div>
            ) : isNewEntity ? (
                localFiles.length === 0 ? (
                    <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--surface-color)'
                    }}>
                        Keine Bilder ausgewählt. Klicken Sie auf "Bilder hinzufügen".
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px', maxHeight: '200px', overflowY: 'auto', padding: '4px' }}>
                        {localFiles.map((file, idx) => {
                            const isSelected = idx === pendingThumbnailIndex;
                            return (
                                <div
                                    key={idx}
                                    onClick={() => onSelectPendingThumbnail(idx)}
                                    style={{
                                        position: 'relative',
                                        aspectRatio: '1.25',
                                        cursor: 'pointer',
                                        border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        overflow: 'hidden',
                                        boxShadow: isSelected ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'var(--shadow-sm)',
                                        transition: 'all 0.15s ease',
                                        transform: isSelected ? 'scale(1.02)' : 'none'
                                    }}
                                >
                                    <LocalImagePreview file={file} />

                                    {isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '4px',
                                            left: '4px',
                                            backgroundColor: 'var(--primary-color)',
                                            color: 'white',
                                            borderRadius: '12px',
                                            padding: '2px 6px',
                                            fontSize: '0.65rem',
                                            fontWeight: 700,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}>
                                            Titelbild
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={(e) => handleDeleteLocalFile(e, idx)}
                                        style={{
                                            position: 'absolute',
                                            top: '4px',
                                            right: '4px',
                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '50%',
                                            width: '20px',
                                            height: '20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                            transition: 'transform 0.15s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                images.length === 0 ? (
                    <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--surface-color)'
                    }}>
                        Keine Bilder in der Cloud unter /Bilder vorhanden.
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px', maxHeight: '200px', overflowY: 'auto', padding: '4px' }}>
                        {images.map(img => {
                            const isSelected = img.id === currentThumbnailId;
                            return (
                                <div
                                    key={img.id}
                                    onClick={() => onSelectThumbnail(img.id)}
                                    style={{
                                        position: 'relative',
                                        aspectRatio: '1.25',
                                        cursor: 'pointer',
                                        border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        overflow: 'hidden',
                                        boxShadow: isSelected ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'var(--shadow-sm)',
                                        transition: 'all 0.15s ease',
                                        transform: isSelected ? 'scale(1.02)' : 'none'
                                    }}
                                >
                                    {/* Google liefert in der Liste bereits den Vorschau-Link (identisch zu get_download_link) */}
                                    <CloudImage
                                        provider={provider}
                                        connectionId={connectionId}
                                        itemId={img.id}
                                        initialUrl={provider === 'googledrive' ? (img.thumbnailUrl || null) : null}
                                        fallbackIcon={Home}
                                    />

                                    {isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '4px',
                                            left: '4px',
                                            backgroundColor: 'var(--primary-color)',
                                            color: 'white',
                                            borderRadius: '12px',
                                            padding: '2px 6px',
                                            fontSize: '0.65rem',
                                            fontWeight: 700,
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}>
                                            Titelbild
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={(e) => handleDeleteCloudImage(e, img.id)}
                                        style={{
                                            position: 'absolute',
                                            top: '4px',
                                            right: '4px',
                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '50%',
                                            width: '20px',
                                            height: '20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                            transition: 'transform 0.15s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )
            )}
        </div>
    );
};

const resolveCloudConnection = async (portfolioId) => {
    if (!portfolioId) return null;
    try {
        const { data: linkData } = await supabase
            .from('portfolio_cloud_links')
            .select('cloud_connection_id')
            .eq('portfolio_id', portfolioId)
            .maybeSingle();

        // Nur die benötigten Spalten laden – keine OAuth-Tokens in den Browser
        if (linkData?.cloud_connection_id) {
            const { data: connData } = await supabase
                .from('cloud_connections')
                .select('id, provider')
                .eq('id', linkData.cloud_connection_id)
                .maybeSingle();
            return connData;
        }

        const { data: fallbackConns } = await supabase
            .from('cloud_connections')
            .select('id, provider')
            .order('created_at', { ascending: true })
            .limit(1);
        if (fallbackConns && fallbackConns.length > 0) {
            return fallbackConns[0];
        }
    } catch (e) {
        console.error("Error resolving cloud connection:", e);
    }
    return null;
};

const getPropertyFolderName = (property, allProperties = []) => {
    if (!property) return '';

    if (property.isGroup) {
        return property.displayFolderName || '';
    }

    if (property.economic_unit_id) {
        const members = allProperties.filter(p => p.economic_unit_id === property.economic_unit_id);
        if (members.length > 0) {
            const groupedByStreet = {};
            members.forEach(m => {
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
            return `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`;
        }
    }

    return `${cloudFolderSegment(property.street)} ${cloudFolderSegment(property.house_number)}`.trim();
};

const Properties = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios, loading: portfoliosLoading } = usePortfolio();
    const { checkUsageLimit, checkGlobalAccess } = useSubscription();
    const { isMobile } = useViewMode();
    const [properties, setProperties] = useState([]);
    const [loans, setLoans] = useState([]);
    const [economicUnits, setEconomicUnits] = useState([]);
    const [economicUnitsLoadFailed, setEconomicUnitsLoadFailed] = useState(false); // WE-Gesamtwerte unbekannt -> WE nicht speichern
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [loadWarnings, setLoadWarnings] = useState([]);
    const [sharePermissions, setSharePermissions] = useState({}); // Map: portfolioId -> permissions (nur Freigaben an mich)
    const [sharesLoaded, setSharesLoaded] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [busyMessage, setBusyMessage] = useState(null); // Fortschrittsanzeige außerhalb der Modals (Löschen)
    const [returnTo, setReturnTo] = useState(null); // Track where to redirect after save
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('properties_view_mode') || 'grid');
    const [newPropertyImages, setNewPropertyImages] = useState([]);
    const [newUnitImages, setNewUnitImages] = useState([]);
    const [pendingPropertyThumbnailIndex, setPendingPropertyThumbnailIndex] = useState(null);
    const [pendingUnitThumbnailIndex, setPendingUnitThumbnailIndex] = useState(null);
    const [propertyProvider, setPropertyProvider] = useState('onedrive');
    const [unitProvider, setUnitProvider] = useState('onedrive');
    // Verbindungs-ID zum Anbieter (mehrere Konten desselben Anbieters möglich)
    const [propertyConnectionId, setPropertyConnectionId] = useState(null);
    const [unitConnectionId, setUnitConnectionId] = useState(null);
    const fetchRequestRef = React.useRef(0);
    const propertyProviderRequestRef = React.useRef(0);
    const unitProviderRequestRef = React.useRef(0);

    // Property Modal State
    const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
    const [propertyForm, setPropertyForm] = useState({
        portfolio_id: '',
        street: '',
        house_number: '',
        zip: '',
        city: '',
        construction_year: '',
        property_type: 'residential', // residential, commercial, mixed
        economic_unit_members: [], // Array of property IDs
        _original_economic_unit_id: null,
        _we_prefill: null, // Gesamtwerte der Wirtschaftseinheit beim Öffnen
        _add_member_values: true // Eigene Werte neu hinzugefügter Mitglieder zur WE addieren
    });

    // Units and Group Logic
    const [expandedPropertyId, setExpandedPropertyId] = useState(null);
    const [expandedWEId, setExpandedWEId] = useState(null); // For Economic Units
    const [units, setUnits] = useState({}); // Map: propertyId -> [units]
    const [loadingUnits, setLoadingUnits] = useState({}); // Map: propertyId -> boolean
    const [unitLoadErrors, setUnitLoadErrors] = useState({}); // Map: propertyId -> Fehlermeldung

    // Unit Modal State
    const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
    const [currentPropertyForUnit, setCurrentPropertyForUnit] = useState(null);
    const [editingUnitId, setEditingUnitId] = useState(null); // Track if editing
    const [editingUnitOriginalName, setEditingUnitOriginalName] = useState(''); // Gespeicherter Name (Cloud-Ordner)
    const [unitForm, setUnitForm] = useState({
        unit_name: '',
        floor: '',
        sqm: '',
        rooms: '',
        bathrooms: 1,
        bedrooms: 1,
        balcony: false,
        fitted_kitchen: false,
        is_vacation_rental: false,
        cold_rent_ist: '', service_charge_soll: '', heating_cost_soll: '', other_costs_soll: '', deposit_soll: ''
    });

    // Unit Action Menu State
    const [openActionMenuId, setOpenActionMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

    // Property Action Menu State
    const [openPropertyActionMenuId, setOpenPropertyActionMenuId] = useState(null);
    const [propertyMenuPos, setPropertyMenuPos] = useState({ top: 0, left: 0 });
    const [editingPropertyId, setEditingPropertyId] = useState(null);

    useEffect(() => {
        localStorage.setItem('properties_view_mode', viewMode);
    }, [viewMode]);

    // ---------------------------------------------------------------------
    // Rechte je Portfolio (Eigentümer = alles; Freigabe = portfolio_shares.permissions)
    // PermissionContext kennt nur das gewählte Portfolio und gibt bei "Alle Portfolios"
    // Vollrechte – hier wird deshalb je Objekt anhand seines Portfolios geprüft.
    // ---------------------------------------------------------------------
    useEffect(() => {
        let cancelled = false;
        const loadSharePermissions = async () => {
            if (!user?.email) {
                if (!cancelled) {
                    setSharePermissions({});
                    setSharesLoaded(!!user);
                }
                return;
            }
            try {
                const { data, error } = await supabase
                    .from('portfolio_shares')
                    .select('portfolio_id, permissions, shared_with_email')
                    .eq('status', 'accepted');
                if (error) throw error;
                if (cancelled) return;
                const myEmail = user.email.toLowerCase();
                const map = {};
                (data || [])
                    .filter(s => (s.shared_with_email || '').toLowerCase() === myEmail)
                    .forEach(s => { map[s.portfolio_id] = s.permissions || {}; });
                setSharePermissions(map);
            } catch (e) {
                console.error('Error loading share permissions:', e);
                if (!cancelled) setSharePermissions({});
            } finally {
                if (!cancelled) setSharesLoaded(true);
            }
        };
        loadSharePermissions();
        return () => { cancelled = true; };
    }, [user, portfolios]);

    const isPortfolioOwner = (portfolioId) => {
        if (!user || !portfolioId) return false;
        const portfolio = portfolios.find(pf => pf.id === portfolioId);
        return !!portfolio && portfolio.user_id === user.id;
    };

    const hasPortfolioPermission = (portfolioId, category, level = 'read') => {
        if (!user || !portfolioId) return false;
        if (isPortfolioOwner(portfolioId)) return true;
        const perm = sharePermissions[portfolioId]?.[category];
        return level === 'write' ? perm === 'write' : (perm === 'read' || perm === 'write');
    };

    const canEditProperty = (property) => {
        if (!property || property.isGroup || !user) return false;
        if (hasPortfolioPermission(property.portfolio_id, 'immobilien', 'write')) return true;
        // Eigenes Objekt, dessen Portfolio (noch) nicht in der Liste steht
        return property.user_id === user.id && !portfolios.some(pf => pf.id === property.portfolio_id);
    };

    // Für die Lösch-Prüfung müssen die verknüpften Daten sichtbar sein, sonst zählt die Prüfung 0
    const getMissingReadCategories = (portfolioId, categories) => (
        isPortfolioOwner(portfolioId) ? [] : categories.filter(c => !hasPortfolioPermission(portfolioId, c, 'read'))
    );

    // Eigentümer des Portfolios: dessen user_id erhalten neu angelegte Datensätze
    const getPortfolioOwnerId = (portfolioId) => portfolios.find(pf => pf.id === portfolioId)?.user_id || null;

    const writablePortfolios = portfolios.filter(pf => hasPortfolioPermission(pf.id, 'immobilien', 'write'));

    // Fetch Properties with Aggregated Data
    const fetchProperties = async () => {
        // Nur die Antwort der zuletzt gestellten Anfrage übernehmen (z. B. bei schnellem Portfoliowechsel)
        const requestId = ++fetchRequestRef.current;
        const isCurrent = () => requestId === fetchRequestRef.current;
        try {
            setLoading(true);
            setLoadError(null);
            let query = supabase
                .from('properties')
                .select(`
                    *,
                    units (
                        id,
                        unit_name,
                        floor,
                        sqm,
                        rooms,
                        target_rent,
                        cold_rent_ist,
                        is_vacation_rental,
                        balcony,
                        fitted_kitchen,
                        leases (
                            cold_rent,
                            status,
                            start_date,
                            end_date
                        )
                    )
                `)
                .order('street');

            if (selectedPortfolioID) {
                query = query.eq('portfolio_id', selectedPortfolioID);
            }

            const { data, error } = await query;
            if (!isCurrent()) return;
            if (error) throw error;

            // Nebenabfragen einzeln abfangen, damit die Objekte auch bei Teilfehlern erscheinen
            let loanQuery = supabase.from('loans').select('*');
            if (selectedPortfolioID) {
                loanQuery = loanQuery.eq('portfolio_id', selectedPortfolioID);
            }
            const [loanRes, weRes, connRes, linkRes] = await Promise.all([
                loanQuery,
                supabase.from('economic_units').select('*'),
                supabase.from('cloud_connections').select('id, provider').order('created_at', { ascending: true }),
                supabase.from('portfolio_cloud_links').select('portfolio_id, cloud_connection_id')
            ]);
            if (!isCurrent()) return;

            const warnings = [];
            if (loanRes.error) {
                console.error('Error fetching loans:', loanRes.error);
                warnings.push('Darlehen konnten nicht geladen werden – Restschuld und Bankrate sind unvollständig.');
            }
            if (weRes.error) {
                console.error('Error fetching economic units:', weRes.error);
                warnings.push('Wirtschaftseinheiten konnten nicht geladen werden – deren Gesamtwerte fehlen.');
            }
            if (connRes.error || linkRes.error) {
                console.error('Error fetching cloud connections:', connRes.error || linkRes.error);
            }

            const loanData = loanRes.error ? [] : (loanRes.data || []);
            setLoans(loanData);
            setEconomicUnits(weRes.error ? [] : (weRes.data || []));
            setEconomicUnitsLoadFailed(!!weRes.error);

            // Map cloud providers per portfolio
            const connData = connRes.error ? [] : (connRes.data || []);
            const linkData = linkRes.error ? [] : (linkRes.data || []);
            const providerMap = {};
            const connectionMap = {};
            const defaultConnection = connData.length > 0 ? connData[0] : null;
            const defaultProvider = defaultConnection ? defaultConnection.provider : 'onedrive';
            linkData.forEach(link => {
                const conn = connData.find(c => c.id === link.cloud_connection_id);
                if (conn) {
                    providerMap[link.portfolio_id] = conn.provider;
                    connectionMap[link.portfolio_id] = conn.id;
                }
            });

            // Calculate Aggregations
            const now = new Date();
            const today = getLocalDateString(now);
            const propertiesWithStats = (data || []).map(p => {
                const propUnits = (p.units || []).map(u => withRentInfo(u, today));
                const totalUnits = propUnits.length;
                const totalArea = propUnits.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0);
                const totalTargetRent = propUnits.reduce((sum, u) => sum + (parseFloat(u.target_rent) || 0), 0);
                // Ist-Miete: nur Verträge, die heute laufen (gleiche Regel wie in der Einheitenansicht)
                const totalActualRent = propUnits.reduce((sum, u) => sum + (u.actual_rent || 0), 0);
                const vacantUnits = propUnits.filter(u => u.status === 'vacant').length;

                // Calculate Loan Stats
                const { debt: remainingDebt, payment: monthlyLoanPayment } = sumLoanFigures(loanData.filter(l => l.property_id === p.id), now);

                return {
                    ...p,
                    units: propUnits,
                    cloud_provider: providerMap[p.portfolio_id] || defaultProvider,
                    // Genau diese Verbindung für Titelbilder (sonst nähme cloud-drive die älteste des Anbieters)
                    cloud_connection_id: connectionMap[p.portfolio_id] || defaultConnection?.id || null,
                    remaining_debt: remainingDebt,
                    monthly_loan_payment: monthlyLoanPayment,
                    stats: {
                        totalUnits,
                        totalArea,
                        totalTargetRent,
                        totalActualRent,
                        occupiedUnits: totalUnits - vacantUnits,
                        vacantUnits
                    }
                };
            });

            setProperties(propertiesWithStats);
            setLoadWarnings(warnings);

            // If expanded property is no longer in list (e.g. portfolio switch), collapse
            if (expandedPropertyId && !propertiesWithStats.find(p => p.id === expandedPropertyId)) {
                setExpandedPropertyId(null);
            }
        } catch (error) {
            if (!isCurrent()) return;
            console.error('Error fetching properties:', error);
            setLoadError(getErrorMessage(error));
        } finally {
            if (isCurrent()) setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            // Ältere, noch laufende Anfragen werden über fetchRequestRef verworfen
            fetchProperties();
        }
    }, [user, selectedPortfolioID]);



    // Fetch Units for a Property
    const fetchUnitsForProperty = async (propertyId) => {
        try {
            setLoadingUnits(prev => ({ ...prev, [propertyId]: true }));
            const { data, error } = await supabase
                .from('units')
                .select('*, leases(status, start_date, end_date, cold_rent)')
                .eq('property_id', propertyId)
                .order('unit_name');

            if (error) throw error;

            const today = getLocalDateString();
            const processedUnits = (data || []).map(u => withRentInfo(u, today));

            setUnits(prev => ({ ...prev, [propertyId]: processedUnits }));
            setUnitLoadErrors(prev => ({ ...prev, [propertyId]: null }));
        } catch (error) {
            console.error('Error fetching units:', error);
            setUnitLoadErrors(prev => ({ ...prev, [propertyId]: getErrorMessage(error) }));
        } finally {
            setLoadingUnits(prev => ({ ...prev, [propertyId]: false }));
        }
    };

    // Nach Speichern/Löschen Daten neu laden (statt komplettem Seiten-Reload)
    const refreshData = async (propertyIdsToReload = []) => {
        await fetchProperties();
        const ids = new Set(propertyIdsToReload.filter(Boolean));
        if (expandedPropertyId) ids.add(expandedPropertyId);
        ids.forEach(id => fetchUnitsForProperty(id));
    };

    const toggleExpand = (propertyId) => {
        if (expandedPropertyId === propertyId) {
            setExpandedPropertyId(null);
        } else {
            setExpandedPropertyId(propertyId);
            fetchUnitsForProperty(propertyId);
        }
    };

    const updatePropertyProvider = async (portfolioId) => {
        const requestId = ++propertyProviderRequestRef.current;
        const conn = await resolveCloudConnection(portfolioId);
        // Nur übernehmen, wenn inzwischen kein anderes Portfolio gewählt wurde
        if (requestId === propertyProviderRequestRef.current) {
            setPropertyProvider(conn?.provider || 'onedrive');
            setPropertyConnectionId(conn?.id || null);
        }
    };

    const updateUnitProvider = async (portfolioId) => {
        const requestId = ++unitProviderRequestRef.current;
        const conn = await resolveCloudConnection(portfolioId);
        if (requestId === unitProviderRequestRef.current) {
            setUnitProvider(conn?.provider || 'onedrive');
            setUnitConnectionId(conn?.id || null);
        }
    };

    // Ordner in den verbundenen Clouds anlegen und lokal gewählte Bilder hochladen.
    // Liefert Hinweise für den Nutzer (statt Fehler stillschweigend zu verschlucken).
    const syncFoldersAndUploadImages = async ({ propertyId, files, provider, connectionId = null, targetPath, thumbnailIndex, table, rowId }) => {
        const notices = [];
        let connectedProviders = [];
        try {
            const { data, error } = await supabase.from('cloud_connections').select('provider');
            if (error) throw error;
            connectedProviders = Array.from(new Set((data || []).map(c => c.provider).filter(Boolean)));
        } catch (e) {
            console.error('Error loading cloud connections:', e);
            notices.push('Die Cloud-Verbindungen konnten nicht geprüft werden. Ordner und Bilder wurden nicht angelegt.');
            return notices;
        }

        if (connectedProviders.length === 0) {
            if (files.length > 0) {
                notices.push(`${countLabel(files.length, 'ausgewähltes Bild wurde', 'ausgewählte Bilder wurden')} nicht hochgeladen, da keine Cloud (OneDrive/Google Drive) verbunden ist.`);
            }
            return notices;
        }

        // Nur für tatsächlich verbundene Anbieter und nur für dieses Objekt synchronisieren
        for (const prov of connectedProviders) {
            try {
                const { error } = await supabase.functions.invoke('cloud-sync', {
                    body: { provider: prov, action: 'create', propertyId }
                });
                if (error) throw error;
            } catch (e) {
                console.error(`Cloud folder sync error (${prov}):`, e);
                notices.push(`Die Ordnerstruktur in ${PROVIDER_LABELS[prov] || prov} konnte nicht angelegt werden.`);
            }
        }

        if (files.length === 0) return notices;
        if (!connectedProviders.includes(provider)) {
            notices.push(`Die Bilder wurden nicht hochgeladen: Für ${PROVIDER_LABELS[provider] || provider} besteht keine Cloud-Verbindung.`);
            return notices;
        }

        let uploadedThumbnailId = null;
        const failed = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const formData = new FormData();
                formData.append('action', 'upload');
                formData.append('provider', provider);
                // Dieselbe Verbindung, in der cloud-sync die Ordner angelegt hat
                if (connectionId) formData.append('connectionId', connectionId);
                formData.append('path', targetPath);
                formData.append('file', file);

                const { data, error } = await supabase.functions.invoke('cloud-drive', { body: formData });
                if (error) throw error;
                if (!data?.success) throw new Error('Upload fehlgeschlagen');
                if (i === thumbnailIndex && data?.file?.id) {
                    uploadedThumbnailId = data.file.id;
                }
            } catch (uploadErr) {
                console.error("Error uploading initial file:", uploadErr);
                failed.push(file.name);
            }
        }

        if (failed.length > 0) {
            notices.push(`Folgende Bilder konnten nicht hochgeladen werden: ${failed.join(', ')}`);
        }

        if (uploadedThumbnailId) {
            const { error: thumbError } = await supabase
                .from(table)
                .update({ thumbnail_image: uploadedThumbnailId })
                .eq('id', rowId);
            if (thumbError) {
                console.error('Error saving thumbnail:', thumbError);
                notices.push('Das Titelbild konnte nicht gespeichert werden.');
            }
        }
        return notices;
    };

    // Nach dem Bearbeiten einer Immobilie: Cloud-Ordner umbenennen, wenn sich die Adresse geändert hat.
    // Ändert sich die Zusammensetzung der Wirtschaftseinheit, müssten Ordner zusammengeführt werden –
    // dann wird nichts verschoben, sondern nur darauf hingewiesen.
    const renameCloudFoldersAfterPropertyEdit = async ({ editingProperty, portfolioId, street, houseNumber, finalEconomicUnitId, membershipChanged }) => {
        const oldHouseNumber = (editingProperty.house_number || '').trim();
        const addressChanged = street !== (editingProperty.street || '').trim() || houseNumber !== oldHouseNumber;
        if (!addressChanged && !membershipChanged) return [];

        const targets = await loadCloudFolderTargets(portfolioId);
        if (targets === null) {
            return ['Die Cloud-Verbindungen konnten nicht geprüft werden. Falls zu dieser Immobilie Cloud-Ordner bestehen, benennen Sie diese bitte selbst um.'];
        }
        if (targets.length === 0) return [];

        const oldFolderName = getPropertyFolderName(editingProperty, properties);
        if (membershipChanged) {
            return [`Hinweis: Durch die geänderte Wirtschaftseinheit ändert sich der Cloud-Ordner dieser Immobilie. Bereits abgelegte Bilder und Dokumente bleiben im bisherigen Ordner „${oldFolderName}“ und werden nicht automatisch verschoben.`];
        }

        // Neuer Ordnername wie in cloud-sync (bei Wirtschaftseinheiten aus allen Mitgliedern, nach Straße sortiert)
        let newFolderName = `${cloudFolderSegment(street)} ${cloudFolderSegment(houseNumber)}`.trim();
        let otherMembers = [];
        if (finalEconomicUnitId) {
            const { data: members, error: membersError } = await supabase
                .from('properties')
                .select('id, street, house_number, economic_unit_id')
                .eq('economic_unit_id', finalEconomicUnitId)
                .order('street');
            if (membersError || !members || members.length === 0) {
                return [`Der Cloud-Ordner „${oldFolderName}“ konnte nicht umbenannt werden, weil die Wirtschaftseinheit nicht gelesen werden konnte. Bitte benennen Sie ihn bei Bedarf selbst um.`];
            }
            newFolderName = getPropertyFolderName({ economic_unit_id: finalEconomicUnitId }, members);
            otherMembers = members.filter(m => m.id !== editingProperty.id);
        }

        const notices = await moveCloudFolder(targets, oldFolderName, newFolderName);

        // Wirtschaftseinheit: Einheiten liegen unter "Einheiten/<Hausnummer>" – bei neuer Hausnummer mitziehen
        if (finalEconomicUnitId && houseNumber !== oldHouseNumber && notices.length === 0) {
            const oldSegment = cloudFolderSegment(editingProperty.house_number || 'Ohne Hausnummer');
            const newSegment = cloudFolderSegment(houseNumber || 'Ohne Hausnummer');
            if (otherMembers.some(m => cloudFolderSegment(m.house_number || 'Ohne Hausnummer') === oldSegment)) {
                notices.push(`Hinweis: Der Cloud-Ordner „${newFolderName}/Einheiten/${oldSegment}“ gehört auch zu einem anderen Objekt der Wirtschaftseinheit und wurde daher nicht umbenannt.`);
            } else {
                notices.push(...(await moveCloudFolder(targets, `${newFolderName}/Einheiten/${oldSegment}`, `${newFolderName}/Einheiten/${newSegment}`)));
            }
        }
        return notices;
    };

    // Verwaiste Wirtschaftseinheit (keine Mitglieder mehr) entfernen – aber nur, wenn
    // weder Darlehen noch Nebenkostenabrechnungen darauf verweisen.
    const removeEconomicUnitIfUnused = async (economicUnitId) => {
        if (!economicUnitId) return;
        try {
            const [memberCount, loanCount, settlementCount] = await Promise.all([
                countRows('properties', q => q.eq('economic_unit_id', economicUnitId)),
                countRows('loans', q => q.eq('economic_unit_id', economicUnitId)),
                countRows('utility_settlements', q => q.eq('economic_unit_id', economicUnitId))
            ]);
            if (memberCount > 0 || loanCount > 0 || settlementCount > 0) return;
            const { error } = await supabase.from('economic_units').delete().eq('id', economicUnitId);
            if (error) throw error;
        } catch (e) {
            console.error('Error cleaning up economic unit:', e);
        }
    };

    // Save Property
    const handleSaveProperty = async () => {
        if (isSaving) return;
        const isNew = !editingPropertyId;
        const editingProperty = isNew ? null : properties.find(p => p.id === editingPropertyId);
        // Beim Bearbeiten bleibt das Portfolio unverändert (abhängige Daten tragen eigene portfolio_id)
        const portfolioId = isNew ? propertyForm.portfolio_id : (editingProperty?.portfolio_id || propertyForm.portfolio_id);

        if (!portfolioId) {
            alert(portfolios.length === 0
                ? 'Bitte legen Sie zuerst unter Einstellungen ein Portfolio an.'
                : 'Bitte wählen Sie ein Portfolio aus.');
            return;
        }
        if (isNew ? !hasPortfolioPermission(portfolioId, 'immobilien', 'write') : !canEditProperty(editingProperty)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }

        const street = (propertyForm.street || '').trim();
        const houseNumber = (propertyForm.house_number || '').trim();
        if (!street || !houseNumber) {
            alert('Bitte geben Sie Straße und Hausnummer an.');
            return;
        }
        // Schrägstriche würden in der Cloud-Ablage zusätzliche Unterordner erzeugen (nur neue/geänderte Werte prüfen)
        const originalStreet = (editingProperty?.street || '').trim();
        const originalHouseNumber = (editingProperty?.house_number || '').trim();
        if ((/[\\/]/.test(street) && (isNew || street !== originalStreet))
            || (/[\\/]/.test(houseNumber) && (isNew || houseNumber !== originalHouseNumber))) {
            alert('Straße und Hausnummer dürfen keine Schrägstriche („/“ oder „\\“) enthalten, da daraus der Ordner in der Cloud-Ablage gebildet wird. Bitte schreiben Sie z. B. „12-14“ statt „12/14“.');
            return;
        }
        const formInvestment = parseFloat(propertyForm.total_investment_cost) || 0;
        const formEquity = parseFloat(propertyForm.equity_invested) || 0;
        if (formInvestment < 0 || formEquity < 0) {
            alert('Gesamtinvestition und Eigenkapital dürfen nicht negativ sein.');
            return;
        }
        if (isNew && !checkGlobalAccess()) return;

        // Wirtschaftseinheit: Auswahl prüfen
        const originalWeId = propertyForm._original_economic_unit_id || null;
        const memberIds = Array.from(new Set((propertyForm.economic_unit_members || []).filter(id => id && id !== editingPropertyId)));
        const memberProps = memberIds.map(id => properties.find(p => p.id === id));
        if (memberProps.some(p => !p)) {
            alert('Mindestens ein ausgewähltes Objekt der Wirtschaftseinheit ist nicht mehr verfügbar. Bitte prüfen Sie die Auswahl.');
            return;
        }
        const otherPortfolioMembers = memberProps.filter(p => p.portfolio_id !== portfolioId);
        if (otherPortfolioMembers.length > 0) {
            alert(`Eine Wirtschaftseinheit kann nur Objekte desselben Portfolios enthalten. Bitte entfernen Sie: ${formatPropertyList(otherPortfolioMembers)}`);
            return;
        }
        const otherWeMembers = memberProps.filter(p => p.economic_unit_id && p.economic_unit_id !== originalWeId);
        if (otherWeMembers.length > 0) {
            alert(`Folgende Objekte gehören bereits zu einer anderen Wirtschaftseinheit: ${formatPropertyList(otherWeMembers)}. Bitte lösen Sie sie zuerst dort heraus.`);
            return;
        }
        const readOnlyMembers = memberProps.filter(p => !canEditProperty(p));
        if (readOnlyMembers.length > 0) {
            alert(`Für folgende Objekte fehlt die Schreibberechtigung: ${formatPropertyList(readOnlyMembers)}`);
            return;
        }

        const finalEconomicUnitId = memberIds.length > 0 ? (originalWeId || crypto.randomUUID()) : null;
        // Ohne geladene WE-Gesamtwerte würde das Formular (Einzelwert 0) die Gesamtwerte überschreiben
        if (finalEconomicUnitId && economicUnitsLoadFailed) {
            alert('Die Wirtschaftseinheiten konnten nicht geladen werden. Bitte laden Sie die Seite neu, bevor Sie Objekte einer Wirtschaftseinheit speichern – sonst könnten deren Gesamtwerte überschrieben werden.');
            return;
        }
        // Neu hinzukommende Mitglieder: deren eigene Werte gehen in die WE ein (statt still auf 0 gesetzt zu werden)
        const joiningMembers = finalEconomicUnitId ? memberProps.filter(p => p.economic_unit_id !== finalEconomicUnitId) : [];
        const removedMembers = (originalWeId && finalEconomicUnitId)
            ? properties.filter(p => p.economic_unit_id === originalWeId && p.id !== editingPropertyId && !memberIds.includes(p.id))
            : [];
        const leavingWe = !!originalWeId && !finalEconomicUnitId;

        const notices = [];
        let currentPropId = editingPropertyId;

        try {
            setIsSaving(true);

            // 1.–3. Wirtschaftseinheit (Gesamtwerte), Immobilie und Mitglieder (Zuordnen mit Einzelwert 0, Lösen)
            // in EINER Datenbank-Transaktion: scheitert ein Schritt (z. B. fehlende Berechtigung), bleibt alles
            // unverändert. Die Werte neu zugeordneter Objekte addiert die Datenbank aus dem aktuellen Stand.
            // Eigentümer und Portfolio bestehender Objekte bleiben unverändert; neue Objekte und Wirtschafts-
            // einheiten gehören dem Eigentümer des Portfolios (auch wenn ein Freigabe-Nutzer anlegt).
            const { data: savedId, error: saveError } = await supabase.rpc('save_property_economic_unit', {
                p_property_id: isNew ? null : editingPropertyId,
                p_portfolio_id: portfolioId,
                p_property: {
                    street,
                    house_number: houseNumber,
                    zip: (propertyForm.zip || '').trim(),
                    city: (propertyForm.city || '').trim(),
                    construction_year: parseInt(propertyForm.construction_year) || null,
                    property_type: propertyForm.property_type || null,
                    total_investment_cost: formInvestment,
                    equity_invested: formEquity,
                    thumbnail_image: propertyForm.thumbnail_image || null
                },
                p_we_id: finalEconomicUnitId,
                p_join_ids: joiningMembers.map(p => p.id),
                p_remove_ids: removedMembers.map(p => p.id),
                p_add_member_values: propertyForm._add_member_values !== false
            });
            if (saveError) throw saveError;
            if (!savedId) throw createUserError('Die Immobilie konnte nicht gespeichert werden. Es wurde nichts geändert.');
            currentPropId = savedId;

            if (removedMembers.length > 0) {
                notices.push(`Aus der Wirtschaftseinheit entfernt: ${formatPropertyList(removedMembers)}. Bitte tragen Sie dort die Einzelwerte für Gesamtinvestition und Eigenkapital ein und prüfen Sie die Gesamtwerte der Wirtschaftseinheit.`);
            }

            // 4. Wirtschaftseinheit verlassen: verwaiste WE aufräumen bzw. auf Gesamtwerte hinweisen
            if (leavingWe) {
                const remaining = properties.filter(p => p.economic_unit_id === originalWeId && p.id !== editingPropertyId);
                if (remaining.length === 0) {
                    await removeEconomicUnitIfUnused(originalWeId);
                } else {
                    notices.push('Die Immobilie wurde aus der Wirtschaftseinheit gelöst. Bitte prüfen Sie die Gesamtwerte (Investition/Eigenkapital) der verbleibenden Wirtschaftseinheit.');
                }
            }

            // 5a. Cloud (nur Bearbeiten): Ordner nach geänderter Adresse umbenennen, damit Bilder und
            //     Dokumente nicht im alten Ordner verwaisen
            if (!isNew && editingProperty) {
                notices.push(...(await renameCloudFoldersAfterPropertyEdit({
                    editingProperty,
                    portfolioId,
                    street,
                    houseNumber,
                    finalEconomicUnitId,
                    membershipChanged: joiningMembers.length > 0 || removedMembers.length > 0 || leavingWe || (!!finalEconomicUnitId && !originalWeId)
                })));
            }

            // 5. Cloud: Ordnerstruktur und Bilder (nur bei Neuanlage)
            if (isNew && currentPropId) {
                // Ordnername wie in cloud-sync (bei Wirtschaftseinheit "WG: ..."), damit die Bilder auffindbar sind
                let folderName = `${cloudFolderSegment(street)} ${cloudFolderSegment(houseNumber)}`.trim();
                if (finalEconomicUnitId && newPropertyImages.length > 0) {
                    const { data: weMembers, error: weMembersError } = await supabase
                        .from('properties')
                        .select('id, street, house_number, economic_unit_id')
                        .eq('economic_unit_id', finalEconomicUnitId)
                        .order('street');
                    if (!weMembersError && weMembers && weMembers.length > 0) {
                        folderName = getPropertyFolderName({ id: currentPropId, economic_unit_id: finalEconomicUnitId }, weMembers);
                    }
                }
                const cloudNotices = await syncFoldersAndUploadImages({
                    propertyId: currentPropId,
                    files: newPropertyImages,
                    provider: propertyProvider,
                    connectionId: propertyConnectionId,
                    targetPath: `${folderName}/Bilder`,
                    thumbnailIndex: pendingPropertyThumbnailIndex,
                    table: 'properties',
                    rowId: currentPropId
                });
                notices.push(...cloudNotices);
            }

            setIsPropertyModalOpen(false);
            setNewPropertyImages([]);
            setPendingPropertyThumbnailIndex(null);

            // Redirect based on returnTo (e.g. back to Cockpit after edit from InvestorPortal)
            if (returnTo === 'cockpit') {
                setReturnTo(null);
                if (notices.length > 0) alert(notices.join('\n\n'));
                navigate('/investor-portal');
                return;
            }

            await refreshData([currentPropId]);
            if (notices.length > 0) alert(notices.join('\n\n'));
        } catch (error) {
            alert(getErrorMessage(error));
        } finally {
            setIsSaving(false);
        }
    };

    // Save Unit
    const handleOpenUnitModal = async (property) => {
        if (!canEditProperty(property)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }
        if (!checkGlobalAccess()) return;

        setCurrentPropertyForUnit(property);
        setEditingUnitId(null); // Reset editing state
        setEditingUnitOriginalName('');
        setNewUnitImages([]);
        setPendingUnitThumbnailIndex(null);

        await updateUnitProvider(property.portfolio_id);

        setUnitForm({
            unit_name: '', floor: '', sqm: '', rooms: '', target_rent: '',
            bathrooms: 1, bedrooms: 1, balcony: false, fitted_kitchen: false, is_vacation_rental: false,
            cold_rent_ist: '', service_charge_soll: '', heating_cost_soll: '', other_costs_soll: '', deposit_soll: '',
            thumbnail_image: ''
        });
        setIsUnitModalOpen(true);
    };

    const handleSaveUnit = async () => {
        if (!currentPropertyForUnit || isSaving) return;
        const property = currentPropertyForUnit;
        if (!canEditProperty(property)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }
        const isNew = !editingUnitId;

        const unitName = (unitForm.unit_name || '').trim();
        if (!unitName) {
            alert('Bitte geben Sie einen Namen bzw. eine Nummer für die Einheit an.');
            return;
        }
        // Schrägstriche würden in der Cloud-Ablage zusätzliche Unterordner erzeugen
        if (/[\\/]/.test(unitName) && (isNew || unitName !== (editingUnitOriginalName || '').trim())) {
            alert('Der Einheitenname darf keine Schrägstriche („/“ oder „\\“) enthalten, da daraus der Ordner in der Cloud-Ablage gebildet wird.');
            return;
        }
        const sqm = parseFloat(unitForm.sqm) || 0;
        const rooms = parseFloat(unitForm.rooms) || 0;
        if (sqm < 0 || rooms < 0) {
            alert('Fläche und Zimmeranzahl dürfen nicht negativ sein.');
            return;
        }
        // bathrooms/bedrooms sind Ganzzahl-Spalten
        const parseWholeNumber = (value) => {
            if (value === '' || value === null || value === undefined) return 0;
            const n = Number(value);
            return Number.isInteger(n) && n >= 0 ? n : null;
        };
        const bathrooms = parseWholeNumber(unitForm.bathrooms);
        const bedrooms = parseWholeNumber(unitForm.bedrooms);
        if (bathrooms === null || bedrooms === null) {
            alert('Bitte geben Sie für Bad und Schlafzimmer ganze Zahlen (0 oder größer) an.');
            return;
        }

        try {
            setIsSaving(true);

            // Neue Einheiten gehören dem Eigentümer des Portfolios
            const ownerId = getPortfolioOwnerId(property.portfolio_id) || property.user_id || user.id;

            // Limit Check for NEW units: nur im eigenen Portfolio gegen das eigene Abo. In freigegebenen
            // Portfolios gilt das Abo des Eigentümers, das hier nicht lesbar ist – dort keine Sperre.
            if (isNew && ownerId === user.id) {
                const { count, error } = await supabase
                    .from('units')
                    .select('*', { count: 'exact', head: true }) // Fast count
                    .eq('user_id', ownerId);

                if (error) throw error;
                if (count === null || count === undefined) {
                    throw createUserError('Die Anzahl der vorhandenen Einheiten konnte nicht ermittelt werden. Bitte versuchen Sie es erneut.');
                }

                // checkUsageLimit handles the Paywall trigger internally
                if (!checkUsageLimit(count)) {
                    return; // Stop here
                }
            }

            const unitData = {
                property_id: property.id,
                unit_name: unitName,
                floor: unitForm.floor,
                sqm,
                target_rent: parseFloat(unitForm.target_rent) || 0,
                rooms,
                bathrooms,
                bedrooms,
                balcony: !!unitForm.balcony,
                fitted_kitchen: !!unitForm.fitted_kitchen,
                is_vacation_rental: !!unitForm.is_vacation_rental,
                cold_rent_ist: parseFloat(unitForm.cold_rent_ist) || null,
                service_charge_soll: parseFloat(unitForm.service_charge_soll) || null,
                heating_cost_soll: parseFloat(unitForm.heating_cost_soll) || null,
                other_costs_soll: parseFloat(unitForm.other_costs_soll) || null,
                deposit_soll: parseFloat(unitForm.deposit_soll) || null,
                thumbnail_image: unitForm.thumbnail_image || null
            };

            let currentUnitId = editingUnitId;

            if (isNew) {
                // INSERT (user_id nur beim Anlegen)
                const { data: insertData, error: insertError } = await supabase
                    .from('units')
                    .insert([{ ...unitData, user_id: ownerId }])
                    .select('id')
                    .single();
                if (insertError) throw insertError;
                currentUnitId = insertData?.id;
            } else {
                // UPDATE ohne user_id: Eigentümer bleibt unverändert
                const { data: updatedRows, error: updateError } = await supabase
                    .from('units')
                    .update(unitData)
                    .eq('id', editingUnitId)
                    .select('id');
                if (updateError) throw updateError;
                if (!updatedRows || updatedRows.length === 0) {
                    throw createUserError('Die Einheit konnte nicht gespeichert werden (keine Berechtigung oder nicht mehr vorhanden).');
                }
            }

            const notices = [];
            // Umbenannte Einheit: Cloud-Ordner (mit Bildern und Mietverhältnissen) mitziehen
            const originalUnitName = editingUnitOriginalName || '';
            if (!isNew && originalUnitName && unitName !== originalUnitName.trim()) {
                const propFolderName = getPropertyFolderName(property, properties);
                const fromPath = `${propFolderName}/${getUnitFolderRelativePath(property, originalUnitName)}`;
                const toPath = `${propFolderName}/${getUnitFolderRelativePath(property, unitName)}`;
                const targets = await loadCloudFolderTargets(property.portfolio_id);
                if (targets === null) {
                    notices.push(`Die Cloud-Verbindungen konnten nicht geprüft werden. Falls der Cloud-Ordner „${fromPath}“ besteht, benennen Sie ihn bitte selbst um.`);
                } else {
                    notices.push(...(await moveCloudFolder(targets, fromPath, toPath)));
                }
            }
            // Trigger sync to ensure folders are created and upload files if needed
            if (isNew && currentUnitId) {
                const propFolderName = getPropertyFolderName(property, properties);
                const cloudNotices = await syncFoldersAndUploadImages({
                    propertyId: property.id,
                    files: newUnitImages,
                    provider: unitProvider,
                    connectionId: unitConnectionId,
                    targetPath: `${propFolderName}/${getUnitImagesRelativePath(property, unitName)}`,
                    thumbnailIndex: pendingUnitThumbnailIndex,
                    table: 'units',
                    rowId: currentUnitId
                });
                notices.push(...cloudNotices);
            }

            setIsUnitModalOpen(false);
            setNewUnitImages([]);
            setPendingUnitThumbnailIndex(null);
            await refreshData([property.id]);
            if (notices.length > 0) alert(notices.join('\n\n'));
        } catch (error) {
            alert(getErrorMessage(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditUnit = async (property, unit) => {
        if (!canEditProperty(property)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }
        setCurrentPropertyForUnit(property);
        setEditingUnitId(unit.id);
        setEditingUnitOriginalName(unit.unit_name || '');
        setNewUnitImages([]);
        setPendingUnitThumbnailIndex(null);

        await updateUnitProvider(property.portfolio_id);

        setUnitForm({
            unit_name: unit.unit_name || '',
            floor: unit.floor ?? '',
            sqm: unit.sqm ?? '',
            target_rent: unit.target_rent ?? '',
            rooms: unit.rooms ?? '',
            bathrooms: unit.bathrooms ?? '',
            bedrooms: unit.bedrooms ?? '',
            balcony: !!unit.balcony,
            fitted_kitchen: !!unit.fitted_kitchen,
            is_vacation_rental: !!unit.is_vacation_rental,
            cold_rent_ist: unit.cold_rent_ist || '',
            service_charge_soll: unit.service_charge_soll || '',
            heating_cost_soll: unit.heating_cost_soll || '',
            other_costs_soll: unit.other_costs_soll || '',
            deposit_soll: unit.deposit_soll || '',
            thumbnail_image: unit.thumbnail_image || ''
        });
        setIsUnitModalOpen(true);
    };

    const handleDeleteUnit = async (property, unit) => {
        if (!property || !unit || isSaving || busyMessage) return;
        if (!canEditProperty(property)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }
        const missing = getMissingReadCategories(property.portfolio_id, ['mietverhaeltnisse']);
        if (missing.length > 0) {
            alert(`Zum Löschen einer Einheit benötigen Sie zusätzlich Leserechte für: ${missing.map(c => CATEGORY_LABELS[c] || c).join(', ')}. Nur so kann geprüft werden, ob Mietverträge oder Zahlungen an der Einheit hängen.`);
            return;
        }
        const unitLabel = unit.unit_name ? `„${unit.unit_name}“` : '';

        // 1. Vorher konkret ermitteln, was an der Einheit hängt
        let deps;
        try {
            setBusyMessage('Prüfe verknüpfte Daten...');
            deps = await collectUnitDependencies(unit.id);
        } catch (error) {
            console.error('Error checking unit dependencies:', error);
            alert(`Die mit der Einheit verknüpften Daten konnten nicht vollständig geprüft werden. Die Einheit wurde nicht gelöscht.\n\n${getErrorMessage(error)}`);
            return;
        } finally {
            setBusyMessage(null);
        }

        // 2. Mietverträge/Zahlungen (Aufbewahrungspflicht) und Dokumente sperren das Löschen
        const blockers = [];
        if (deps.leases > 0) {
            blockers.push(`${countLabel(deps.leases, 'Mietvertrag', 'Mietverträge')}${deps.activeLeases > 0 ? ` (davon ${deps.activeLeases} aktiv)` : ''}`);
        }
        if (deps.payments > 0) blockers.push(countLabel(deps.payments, 'Mietzahlung', 'Mietzahlungen'));
        if (deps.documents > 0) blockers.push(countLabel(deps.documents, 'Dokument', 'Dokumente'));
        if (blockers.length > 0) {
            const reasons = [];
            if (deps.leases > 0 || deps.payments > 0) {
                reasons.push('Beim Löschen würden die Mietverträge samt Mietkonto, Sollstellungen und Zahlungshistorie unwiderruflich mitgelöscht. Diese Daten unterliegen Aufbewahrungspflichten – die Einheit bleibt daher bestehen.');
            }
            if (deps.documents > 0) {
                reasons.push('Dokumente müssen vorher gelöscht oder einer anderen Einheit zugeordnet werden.');
            }
            alert(`Die Einheit ${unitLabel} kann nicht gelöscht werden.\n\nDaran hängen:\n• ${blockers.join('\n• ')}\n\n${reasons.join('\n\n')}`);
            return;
        }

        // 3. Übrige Abhängigkeiten auflisten und bestätigen lassen
        const infos = describeDependencies([
            { count: deps.invoices, singular: 'Rechnung', plural: 'Rechnungen', effect: EFFECT_UNLINKED },
            { count: deps.meters, singular: 'Zähler', plural: 'Zähler', effect: ['bleibt am Objekt erhalten, die Zuordnung zur Einheit wird entfernt', 'bleiben am Objekt erhalten, die Zuordnung zur Einheit wird entfernt'] },
            { count: deps.settlements, singular: 'Nebenkostenabrechnung', plural: 'Nebenkostenabrechnungen', effect: ['enthält diese Einheit, die gespeicherte Abrechnung bleibt unverändert', 'enthalten diese Einheit, die gespeicherten Abrechnungen bleiben unverändert'] },
            { count: deps.expenses, singular: 'Ausgabe', plural: 'Ausgaben', effect: EFFECT_UNLINKED },
            { count: deps.floorPlans, singular: 'Grundriss', plural: 'Grundrisse', effect: EFFECT_UNLINKED },
            { count: deps.tickets, singular: 'Ticket', plural: 'Tickets', effect: EFFECT_DELETED },
            { count: deps.rentalProcesses, singular: 'Vermietungsprozess (inkl. Bewerbungen und Besichtigungen)', plural: 'Vermietungsprozesse (inkl. Bewerbungen und Besichtigungen)', effect: EFFECT_DELETED }
        ]);
        const confirmText = `Möchten Sie die Einheit ${unitLabel} wirklich löschen?\n\n`
            + (infos.length > 0 ? `Folgendes hängt an der Einheit:\n• ${infos.join('\n• ')}\n\n` : 'Es hängen keine weiteren Daten an der Einheit.\n\n')
            + 'Dieser Vorgang kann nicht rückgängig gemacht werden.';
        if (!confirm(confirmText)) return;

        try {
            setBusyMessage('Einheit wird gelöscht...');
            const { data: deletedRows, error } = await supabase.from('units').delete().eq('id', unit.id).select('id');
            if (error) throw error;
            if (!deletedRows || deletedRows.length === 0) {
                throw createUserError('Die Einheit konnte nicht gelöscht werden (keine Berechtigung oder bereits gelöscht).');
            }
            await refreshData([property.id]);
        } catch (error) {
            alert(error?.code === '23503'
                ? 'Die Einheit kann nicht gelöscht werden, weil noch verknüpfte Daten bestehen (z. B. Forderungen oder Dokumente).'
                : getErrorMessage(error));
        } finally {
            setBusyMessage(null);
        }
    };

    const handleDeleteProperty = async (property) => {
        if (!property || isSaving || busyMessage) return;
        if (!canEditProperty(property)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }
        const missing = getMissingReadCategories(property.portfolio_id, ['mietverhaeltnisse', 'nebenkosten', 'zaehler']);
        if (missing.length > 0) {
            alert(`Zum Löschen einer Immobilie benötigen Sie zusätzlich Leserechte für: ${missing.map(c => CATEGORY_LABELS[c] || c).join(', ')}. Nur so kann geprüft werden, welche Daten an der Immobilie hängen.`);
            return;
        }
        const label = `„${formatPropertyLabel(property)}“`;

        // 1. Abhängigkeiten vorab ermitteln
        let deps;
        try {
            setBusyMessage('Prüfe verknüpfte Daten...');
            deps = await collectPropertyDependencies(property.id);
        } catch (error) {
            console.error('Error checking property dependencies:', error);
            alert(`Die mit der Immobilie verknüpften Daten konnten nicht vollständig geprüft werden. Die Immobilie wurde nicht gelöscht.\n\n${getErrorMessage(error)}`);
            return;
        } finally {
            setBusyMessage(null);
        }

        // 2. Sperren: Miet-/Zahlungs-/Abrechnungsdaten (Aufbewahrung) sowie Darlehen/Dokumente (DB-Verknüpfung)
        const blockers = [];
        if (deps.leases > 0) {
            blockers.push(`${countLabel(deps.leases, 'Mietvertrag', 'Mietverträge')}${deps.activeLeases > 0 ? ` (davon ${deps.activeLeases} aktiv)` : ''}`);
        }
        if (deps.payments > 0) blockers.push(countLabel(deps.payments, 'Mietzahlung', 'Mietzahlungen'));
        if (deps.settlements > 0) blockers.push(countLabel(deps.settlements, 'Nebenkostenabrechnung', 'Nebenkostenabrechnungen'));
        if (deps.loans > 0) blockers.push(countLabel(deps.loans, 'Darlehen', 'Darlehen'));
        if (deps.documents > 0) blockers.push(countLabel(deps.documents, 'Dokument', 'Dokumente'));
        if (blockers.length > 0) {
            const reasons = [];
            if (deps.leases > 0 || deps.payments > 0 || deps.settlements > 0) {
                reasons.push('Mietverträge, Mietkonto, Zahlungen und Nebenkostenabrechnungen würden beim Löschen unwiderruflich mitgelöscht. Diese Daten unterliegen Aufbewahrungspflichten – die Immobilie bleibt daher bestehen.');
            }
            if (deps.loans > 0 || deps.documents > 0) {
                reasons.push('Darlehen und Dokumente müssen vorher gelöscht oder einer anderen Immobilie zugeordnet werden.');
            }
            alert(`Die Immobilie ${label} kann nicht gelöscht werden.\n\nDaran hängen:\n• ${blockers.join('\n• ')}\n\n${reasons.join('\n\n')}`);
            return;
        }

        // 3. Alles Übrige konkret auflisten
        const infos = describeDependencies([
            { count: deps.units, singular: 'Einheit', plural: 'Einheiten', effect: EFFECT_DELETED },
            { count: deps.meters, singular: 'Zähler', plural: 'Zähler', effect: EFFECT_DELETED },
            { count: deps.meterReadings, singular: 'Zählerstand', plural: 'Zählerstände', effect: EFFECT_DELETED },
            { count: deps.tickets, singular: 'Ticket', plural: 'Tickets', effect: EFFECT_DELETED },
            { count: deps.announcements, singular: 'Aushang', plural: 'Aushänge', effect: EFFECT_DELETED },
            { count: deps.renovationProjects, singular: 'Sanierungsprojekt', plural: 'Sanierungsprojekte', effect: EFFECT_DELETED },
            { count: deps.calendarEvents, singular: 'Objektkalender-Eintrag', plural: 'Objektkalender-Einträge', effect: EFFECT_DELETED },
            { count: deps.rentalProcesses, singular: 'Vermietungsprozess', plural: 'Vermietungsprozesse', effect: EFFECT_DELETED },
            { count: deps.invoices, singular: 'Rechnung', plural: 'Rechnungen', effect: EFFECT_UNLINKED },
            { count: deps.expenses, singular: 'Ausgabe', plural: 'Ausgaben', effect: EFFECT_UNLINKED },
            { count: deps.floorPlans, singular: 'Grundriss', plural: 'Grundrisse', effect: EFFECT_UNLINKED }
        ]);
        const notes = [];
        if (property.economic_unit_id) {
            notes.push('Die Immobilie gehört zu einer Wirtschaftseinheit. Deren Gesamtwerte (Investition/Eigenkapital) bleiben unverändert – bitte ggf. anpassen.');
        }
        notes.push('Der Cloud-Ordner der Immobilie (inkl. Bilder) bleibt erhalten und kann bei Bedarf manuell gelöscht werden.');
        const confirmText = `Möchten Sie die Immobilie ${label} wirklich löschen?\n\n`
            + (infos.length > 0 ? `Dabei gilt:\n• ${infos.join('\n• ')}\n\n` : 'Es hängen keine weiteren Daten an der Immobilie.\n\n')
            + `${notes.join('\n')}\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`;
        if (!confirm(confirmText)) return;

        try {
            setBusyMessage('Immobilie wird gelöscht...');
            const { data: deletedRows, error } = await supabase.from('properties').delete().eq('id', property.id).select('id');
            if (error) throw error;
            if (!deletedRows || deletedRows.length === 0) {
                throw createUserError('Die Immobilie konnte nicht gelöscht werden (keine Berechtigung oder bereits gelöscht).');
            }
            // Letztes Mitglied einer Wirtschaftseinheit gelöscht -> leere WE-Zeile entfernen
            if (property.economic_unit_id) {
                const remaining = properties.filter(p => p.economic_unit_id === property.economic_unit_id && p.id !== property.id);
                if (remaining.length === 0) await removeEconomicUnitIfUnused(property.economic_unit_id);
            }
            if (searchTerm === property.id) setSearchTerm('');
            await refreshData();
        } catch (error) {
            alert(error?.code === '23503'
                ? 'Die Immobilie kann nicht gelöscht werden, weil noch verknüpfte Daten bestehen (z. B. Darlehen, Dokumente oder Forderungen).'
                : getErrorMessage(error));
        } finally {
            setBusyMessage(null);
        }
    };

    const handleEditProperty = async (property, source = null) => {
        if (!canEditProperty(property)) {
            alert(NO_WRITE_PERMISSION_MESSAGE);
            return;
        }
        setEditingPropertyId(property.id);
        if (source) setReturnTo(source);
        setNewPropertyImages([]);
        setPendingPropertyThumbnailIndex(null);

        // Find economic unit if it exists
        const weRow = property.economic_unit_id
            ? economicUnits.find(eu => eu.id === property.economic_unit_id)
            : null;
        const wePrefill = weRow
            ? { investment: weRow.total_investment_cost || '', equity: weRow.equity_invested || '' }
            : null;

        await updatePropertyProvider(property.portfolio_id);

        setPropertyForm({
            portfolio_id: property.portfolio_id || '',
            street: property.street || '',
            house_number: property.house_number || '',
            zip: property.zip || '',
            city: property.city || '',
            construction_year: property.construction_year || '',
            property_type: property.property_type || 'residential',
            total_investment_cost: wePrefill ? wePrefill.investment : (property.total_investment_cost || ''),
            equity_invested: wePrefill ? wePrefill.equity : (property.equity_invested || ''),
            economic_unit_members: property.economic_unit_id
                ? properties.filter(p => p.economic_unit_id === property.economic_unit_id && p.id !== property.id).map(p => p.id)
                : [],
            _original_economic_unit_id: property.economic_unit_id || null,
            _we_prefill: wePrefill,
            _add_member_values: true,
            thumbnail_image: property.thumbnail_image || ''
        });

        setIsPropertyModalOpen(true);
    };

    const openNewPropertyModal = async () => {
        if (!checkGlobalAccess()) return;
        const defaultPortfolioId = (selectedPortfolioID && hasPortfolioPermission(selectedPortfolioID, 'immobilien', 'write'))
            ? selectedPortfolioID
            : (writablePortfolios.length === 1 ? writablePortfolios[0].id : '');

        setEditingPropertyId(null);
        setReturnTo(null);
        setNewPropertyImages([]);
        setPendingPropertyThumbnailIndex(null);

        await updatePropertyProvider(defaultPortfolioId || writablePortfolios[0]?.id);

        setPropertyForm({
            portfolio_id: defaultPortfolioId,
            street: '',
            house_number: '',
            zip: '',
            city: '',
            construction_year: '',
            property_type: 'residential',
            total_investment_cost: '',
            equity_invested: '',
            economic_unit_members: [],
            _original_economic_unit_id: null,
            _we_prefill: null,
            _add_member_values: true,
            thumbnail_image: ''
        });
        setIsPropertyModalOpen(true);
    };

    // Objekt in der Tabellenansicht mit Einheiten öffnen (Kachelansicht hat keine Einheitenliste)
    const openPropertyInTable = (property) => {
        setViewMode('table');
        if (property.economic_unit_id && properties.filter(p => p.economic_unit_id === property.economic_unit_id).length > 0) {
            setExpandedWEId('we_' + property.economic_unit_id);
        }
        setExpandedPropertyId(property.id);
        fetchUnitsForProperty(property.id);
    };

    // Handle deep-link from Cockpit: ?editPropertyId=...&returnTo=cockpit
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const editId = params.get('editPropertyId');
        const ret = params.get('returnTo');
        // Erst wenn Portfolios (Eigentümer-Prüfung) und Freigaben geladen sind, sonst greift die Rechteprüfung zu früh
        if (editId && properties.length > 0 && sharesLoaded && !portfoliosLoading) {
            const prop = properties.find(p => p.id === editId);
            if (prop) {
                handleEditProperty(prop, ret);
                // Clear URL params
                navigate(location.pathname, { replace: true });
            }
        }
    }, [location.search, properties, sharesLoaded, portfoliosLoading]);

    // Filter properties by selected property
    const filteredProperties = properties.filter(p => {
        if (!searchTerm) return true;
        return p.id === searchTerm;
    });

    // Group Properties by Economic Unit
    const groupedProperties = React.useMemo(() => {
        const groups = {};
        const result = [];

        filteredProperties.forEach(p => {
            if (p.economic_unit_id) {
                if (!groups[p.economic_unit_id]) {
                    groups[p.economic_unit_id] = {
                        id: 'we_' + p.economic_unit_id,
                        isGroup: true,
                        economic_unit_id: p.economic_unit_id,
                        street: 'Wirtschaftseinheit',
                        house_number: '',
                        property_type: 'mixed',
                        properties: [],
                        stats: { totalUnits: 0, totalArea: 0, totalTargetRent: 0, totalActualRent: 0, occupiedUnits: 0, vacantUnits: 0 },
                        total_investment_cost: 0,
                        equity_invested: 0,
                        market_value_total: 0,
                        remaining_debt: 0,
                        monthly_loan_payment: 0
                    };
                }
                const group = groups[p.economic_unit_id];
                group.properties.push(p);
                group.stats.totalUnits += (p.stats?.totalUnits || 0);
                group.stats.totalArea += (p.stats?.totalArea || 0);
                group.stats.totalTargetRent += (p.stats?.totalTargetRent || 0);
                group.stats.totalActualRent += (p.stats?.totalActualRent || 0);
                group.stats.occupiedUnits += (p.stats?.occupiedUnits || 0);
                group.stats.vacantUnits += (p.stats?.vacantUnits || 0);
                group.total_investment_cost += (p.total_investment_cost || 0);
                group.equity_invested += (p.equity_invested || 0);
                group.market_value_total += (p.market_value_total || 0);
                group.remaining_debt += (p.remaining_debt || 0);
                group.monthly_loan_payment += (p.monthly_loan_payment || 0);
            } else {
                result.push(p);
            }
        });

        // Resolve Groups: If a group only has 1 property, flatten it (unless it has custom WE data). Otherwise, generate name and add to result.
        Object.values(groups).forEach(g => {
            const weRow = economicUnits.find(eu => eu.id === g.economic_unit_id);
            const weLoans = (loans || []).filter(l => l.economic_unit_id === g.economic_unit_id && !l.property_id);
            const { debt: weRemainingDebt, payment: weMonthlyLoanPayment } = sumLoanFigures(weLoans);

            g.remaining_debt += weRemainingDebt;
            g.monthly_loan_payment += weMonthlyLoanPayment;

            // Typ der Gruppe aus den Mitgliedern ableiten (nur bei unterschiedlichen Typen "Gemischt")
            const memberTypes = new Set(g.properties.map(pr => getPropertyTypeKey(pr.property_type)));
            g.property_type = memberTypes.size === 1 ? Array.from(memberTypes)[0] : 'mixed';

            if (g.properties.length === 1 && !weRow) {
                const flatProp = { ...g.properties[0] };
                flatProp.remaining_debt += weRemainingDebt;
                flatProp.monthly_loan_payment += weMonthlyLoanPayment;
                result.push(flatProp);
            } else if (g.properties.length > 0) {
                const streets = Array.from(new Set(g.properties.map(pr => pr.street).filter(Boolean)));
                const streetName = streets.length > 0 ? streets.join(', ') : 'Diverse';
                const numbers = g.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                g.street = (weRow?.name && weRow.name !== 'Wirtschaftseinheit') ? weRow.name : `Wirtschaftseinheit: ${streetName}`;
                g.house_number = numbers;

                if (weRow) {
                    if (parseFloat(weRow.total_investment_cost) > 0) g.total_investment_cost = parseFloat(weRow.total_investment_cost);
                    if (parseFloat(weRow.equity_invested) > 0) g.equity_invested = parseFloat(weRow.equity_invested);
                    if (parseFloat(weRow.market_value_total) > 0) g.market_value_total = parseFloat(weRow.market_value_total);
                }

                result.push(g);
            }
        });

        // Sort by street name
        return result.sort((a, b) => (a.street || '').localeCompare(b.street || ''));
    }, [filteredProperties, loans, economicUnits]);

    const propertyColumns = [
        {
            header: '',
            accessor: 'expand',
            width: '40px',
            render: (row) => (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (row.isGroup) {
                            setExpandedWEId(expandedWEId === row.id ? null : row.id);
                        } else {
                            toggleExpand(row.id);
                        }
                    }}
                    style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}
                >
                    {(row.isGroup ? expandedWEId === row.id : expandedPropertyId === row.id) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>
            )
        },
        {
            header: 'Immobilie',
            accessor: 'street',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: row.isGroup ? 'rgba(139, 92, 246, 0.1)' : 'var(--surface-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 'var(--spacing-md)',
                        color: row.isGroup ? 'var(--accent-color)' : 'var(--primary-color)'
                    }}>
                        <Building2 size={20} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: row.isGroup ? 'var(--accent-color)' : 'inherit' }}>{row.street} {row.house_number}</div>
                        {!row.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.zip} {row.city}</div>}
                        {row.isGroup && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.properties.length} Gebäude verknüpft</div>}
                    </div>
                </div>
            )
        },
        {
            header: 'Typ',
            accessor: 'property_type',
            render: (row) => getPropertyTypeLabel(row.property_type)
        },
        {
            header: 'Einh.',
            accessor: 'stats.totalUnits',
            render: (row) => row.stats?.totalUnits || 0
        },
        {
            header: 'Fläche',
            accessor: 'stats.totalArea',
            render: (row) => <span>{row.stats?.totalArea ? (parseFloat(row.stats.totalArea) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '0'} m²</span>
        },
        {
            header: 'Soll',
            accessor: 'stats.totalTargetRent',
            render: (row) => <span>{row.stats?.totalTargetRent?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        },
        {
            header: 'Ist',
            accessor: 'stats.totalActualRent',
            render: (row) => <span style={{ fontWeight: 600 }}>{row.stats?.totalActualRent?.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => row.isGroup ? null : (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (openPropertyActionMenuId === row.id) {
                                setOpenPropertyActionMenuId(null);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setPropertyMenuPos({ top: rect.bottom, left: rect.right });
                                setOpenPropertyActionMenuId(row.id);
                            }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                    >
                        <MoreVertical size={16} color="var(--text-secondary)" />
                    </button>

                    {openPropertyActionMenuId === row.id && createPortal(
                        <>
                            <div
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); }}
                            />
                            <div style={{
                                position: 'fixed',
                                top: propertyMenuPos.top + 5,
                                left: propertyMenuPos.left,
                                transform: 'translateX(-100%)',
                                backgroundColor: 'var(--surface-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                zIndex: 9999,
                                minWidth: '160px',
                                display: 'flex',
                                flexDirection: 'column',
                                padding: '4px'
                            }}
                                onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); toggleExpand(row.id); }}
                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                >
                                    <Home size={14} /> Details / Einheiten
                                </button>
                                {canEditProperty(row) ? (
                                    <>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); handleEditProperty(row); }}
                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                        >
                                            <Edit size={14} /> Bearbeiten
                                        </button>
                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setOpenPropertyActionMenuId(null); handleDeleteProperty(row); }}
                                            style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                        >
                                            <Trash2 size={14} /> Löschen
                                        </button>
                                    </>
                                ) : (
                                    <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        <Lock size={14} /> Nur Lesezugriff
                                    </div>
                                )}
                            </div>
                        </>,
                        document.body
                    )}
                </div>
            )
        }
    ];

    // Eine Zeile der Einheiten-Tabelle (gemeinsam für normale Objekte und WE-Unterobjekte)
    const renderUnitRow = (prop, unit, canEdit, canRent) => {
        const canLet = canRent && unit.status === 'vacant';
        const hasActions = canEdit || canLet;
        return (
            <tr key={unit.id} className="table-row" style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ padding: '8px' }}>{unit.unit_name}</td>
                <td style={{ padding: '8px' }}>{unit.floor}</td>
                <td style={{ padding: '8px' }}>{unit.sqm ? (parseFloat(unit.sqm) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—'} m²</td>
                <td style={{ padding: '8px' }}>{unit.rooms}</td>
                <td style={{ padding: '8px' }}>
                    {unit.status === 'vacation_rental' ? (
                        <span style={{ color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                            <Home size={12} /> Ferienwohnung
                        </span>
                    ) : unit.status === 'rented' ? (
                        <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                            <Key size={12} /> Vermietet
                        </span>
                    ) : (
                        <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '12px', width: 'fit-content' }}>
                            <AlertCircle size={12} /> Leerstand
                        </span>
                    )}
                </td>
                <td style={{ padding: '8px', fontWeight: 600 }}>
                    {formatEuro(unit.actual_rent)}
                </td>
                <td style={{ padding: '8px', textAlign: 'right' }}>
                    {hasActions && (
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (openActionMenuId === unit.id) {
                                        setOpenActionMenuId(null);
                                    } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setMenuPos({ top: rect.bottom, left: rect.right });
                                        setOpenActionMenuId(unit.id);
                                    }
                                }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                            >
                                <MoreVertical size={16} color="var(--text-secondary)" />
                            </button>

                            {openActionMenuId === unit.id && createPortal(
                                <>
                                    <div
                                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998, cursor: 'default' }}
                                        onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); }}
                                    />
                                    <div style={{
                                        position: 'fixed',
                                        top: menuPos.top + 5,
                                        left: menuPos.left,
                                        transform: 'translateX(-100%)',
                                        backgroundColor: 'var(--surface-color)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                        zIndex: 9999,
                                        minWidth: '160px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        padding: '4px'
                                    }}>
                                        {canLet && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); navigate(`/tenants?action=create&propertyId=${prop.id}&unitId=${unit.id}`); }}
                                                style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--success-color)' }}
                                                title="Einheit vermieten"
                                            >
                                                <Plus size={14} /> Vermieten
                                            </button>
                                        )}
                                        {canEdit && (
                                            <>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleEditUnit(prop, unit); }}
                                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)' }}
                                                    title="Einheit bearbeiten"
                                                >
                                                    <Edit size={14} /> Bearbeiten
                                                </button>
                                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setOpenActionMenuId(null); handleDeleteUnit(prop, unit); }}
                                                    style={{ textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--danger-color)' }}
                                                    title="Einheit löschen"
                                                >
                                                    <Trash2 size={14} /> Löschen
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </>,
                                document.body
                            )}
                        </div>
                    )}
                </td>
            </tr>
        );
    };

    // Aufgeklappter Einheiten-Bereich eines Objekts (vorher zweifach fast identisch vorhanden)
    const renderUnitsPanel = (prop, nested = false) => {
        const canEdit = canEditProperty(prop);
        const canRent = hasPortfolioPermission(prop.portfolio_id, 'mietverhaeltnisse', 'write');
        const propUnits = units[prop.id];
        return (
            <tr style={{ backgroundColor: 'var(--background-color)', borderBottom: '1px solid var(--border-color)' }}>
                <td colSpan={propertyColumns.length} style={{ padding: nested ? 'var(--spacing-md) var(--spacing-xl) var(--spacing-md) 60px' : 'var(--spacing-md) var(--spacing-xl)' }}>
                    <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Home size={16} /> Einheiten
                        </h4>
                        {canEdit ? (
                            <Button size="sm" icon={Plus} onClick={() => handleOpenUnitModal(prop)}>Neue Einheit</Button>
                        ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                <Lock size={14} /> Nur Lesezugriff
                            </span>
                        )}
                    </div>

                    {loadingUnits[prop.id] ? (
                        <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Lade Einheiten...</div>
                    ) : unitLoadErrors[prop.id] ? (
                        <div style={{ padding: '10px', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <AlertCircle size={14} /> Einheiten konnten nicht geladen werden: {unitLoadErrors[prop.id]}
                            <Button size="sm" variant="secondary" onClick={() => fetchUnitsForProperty(prop.id)}>Erneut laden</Button>
                        </div>
                    ) : (
                        !propUnits || propUnits.length === 0 ? (
                            <div style={{ padding: '10px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Keine Einheiten angelegt.</div>
                        ) : (
                            <table style={{ width: '100%', backgroundColor: 'var(--surface-color)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                <thead style={{ backgroundColor: 'var(--background-color)' }}>
                                    <tr>
                                        <th style={{ padding: '8px' }}>Name</th>
                                        <th style={{ padding: '8px' }}>Etage</th>
                                        <th style={{ padding: '8px' }}>Fläche</th>
                                        <th style={{ padding: '8px' }}>Zimmer</th>
                                        <th style={{ padding: '8px' }}>Status</th>
                                        <th style={{ padding: '8px' }}>Istmiete</th>
                                        <th style={{ padding: '8px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {propUnits.map(unit => renderUnitRow(prop, unit, canEdit, canRent))}
                                </tbody>
                            </table>
                        )
                    )}
                </td>
            </tr>
        );
    };

    // Formular-Hilfswerte für das Objekt-Modal
    const weCandidates = propertyForm.portfolio_id
        ? properties.filter(p => p.id !== editingPropertyId && p.portfolio_id === propertyForm.portfolio_id)
        : [];
    const selectedMemberIds = propertyForm.economic_unit_members || [];
    const formJoiningMembers = selectedMemberIds
        .map(id => properties.find(p => p.id === id))
        .filter(p => p && p.id !== editingPropertyId && (!propertyForm._original_economic_unit_id || p.economic_unit_id !== propertyForm._original_economic_unit_id));
    const formJoiningInvestment = formJoiningMembers.reduce((sum, p) => sum + (parseFloat(p.total_investment_cost) || 0), 0);
    const formJoiningEquity = formJoiningMembers.reduce((sum, p) => sum + (parseFloat(p.equity_invested) || 0), 0);
    const isLeavingEconomicUnit = !!propertyForm._original_economic_unit_id && selectedMemberIds.length === 0;
    const isEconomicUnitForm = selectedMemberIds.length > 0;
    const editingUnitNameChanged = !!editingUnitId && !!editingUnitOriginalName && (unitForm.unit_name || '').trim() !== editingUnitOriginalName.trim();

    return (
        <div>
            {busyMessage && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 120 }}>
                    <LoadingOverlay message={busyMessage} />
                </div>
            )}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 'var(--spacing-xl)', gap: isMobile ? '10px' : '0' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Immobilien</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht Ihrer Wohn- und Gewerbeobjekte</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '2px', backgroundColor: 'var(--bg-secondary)' }}>
                        <button
                            onClick={() => setViewMode('table')}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '4px',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'table' ? 'var(--surface-color)' : 'transparent',
                                color: viewMode === 'table' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                fontWeight: viewMode === 'table' ? 600 : 'normal'
                            }}
                        >
                            <List size={14} /> Tabelle
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '4px',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'grid' ? 'var(--surface-color)' : 'transparent',
                                color: viewMode === 'grid' ? 'var(--primary-color)' : 'var(--text-secondary)',
                                boxShadow: viewMode === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                fontWeight: viewMode === 'grid' ? 600 : 'normal'
                            }}
                        >
                            <LayoutGrid size={14} /> Kacheln
                        </button>
                    </div>
                    <ExportDropdown
                        reportType="immobilien"
                        data={groupedProperties.map(p => {
                            const formattedAddress = p.isGroup ? (() => {
                                const streets = Array.from(new Set(p.properties.map(pr => pr.street).filter(Boolean)));
                                const streetName = streets.length > 0 ? streets.join(', ') : 'Diverse';
                                const numbers = p.properties.map(pr => pr.house_number).filter(Boolean).join(' & ');
                                return `${streetName} ${numbers}`.trim();
                            })() : `${p.street} ${p.house_number || ''}`.trim();

                            return {
                                property_id: p.id,
                                adresse: formattedAddress,
                                einheiten: p.stats?.totalUnits || 0,
                                kaufpreis: p.total_investment_cost || 0,
                                marktpreis: p.market_value_total || 0,
                                restschuld: p.remaining_debt || 0,
                                miete_monat: p.stats?.totalActualRent || 0,
                                bankrate: p.monthly_loan_payment || 0,
                                cashflow_monat: (p.stats?.totalActualRent || 0) - (p.monthly_loan_payment || 0),
                                wohnflaeche: p.stats?.totalArea || 0,
                                // Leerstand = Einheiten ohne heute laufenden Vertrag (Ferienwohnungen zählen nicht als Leerstand)
                                leerstand: p.stats?.totalUnits ? `${p.stats.vacantUnits ?? 0} / ${p.stats.totalUnits}` : '–',
                                ltv: p.market_value_total > 0 ? (p.remaining_debt || 0) / p.market_value_total : 0,
                                dscr: p.monthly_loan_payment > 0 ? (p.stats?.totalActualRent || 0) / p.monthly_loan_payment : 0,
                                _propertyLabel: formattedAddress,
                            };
                        })}
                        unitData={Object.fromEntries(groupedProperties.map(p => [
                            p.id,
                            (p.isGroup ? p.properties.flatMap(subP => subP.units || []) : (p.units || [])).map(u => ({
                                unit_name: u.unit_name || '–',
                                floor: u.floor || '–',
                                sqm: u.sqm || 0,
                                rooms: u.rooms || '–',
                                target_rent: u.actual_rent || 0,
                                status: u.status === 'vacation_rental' ? 'Ferienwohnung' : (u.status === 'rented' ? 'Vermietet' : 'Leerstand'),
                            })),
                        ]))}
                        properties={properties.map(p => ({ id: p.id, label: `${p.street} ${p.house_number || ''}`.trim() }))}
                        totalRows={groupedProperties.length}
                    />
                    {(portfolios.length === 0 || writablePortfolios.length > 0) && (
                        <Button icon={Plus} onClick={openNewPropertyModal}>Neue Immobilie</Button>
                    )}
                </div>
            </div>

            {loadWarnings.length > 0 && (
                <div style={{ marginBottom: 'var(--spacing-md)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.08)', color: 'var(--text-primary)', fontSize: '0.875rem', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <AlertCircle size={16} style={{ color: 'var(--warning-color)', flexShrink: 0, marginTop: '2px' }} />
                    <div>{loadWarnings.map((w, idx) => <div key={idx}>{w}</div>)}</div>
                </div>
            )}

            {/* Filter Bar */}
            {properties.length > 0 && (
                <div style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                    </div>
                    <div>
                        <select
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '200px' }}
                        >
                            <option value="">Alle Immobilien</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            <Card>
                {loadError ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                        <div style={{ color: 'var(--danger-color)', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <AlertCircle size={18} /> Die Immobilien konnten nicht geladen werden.
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--spacing-md)' }}>{loadError}</div>
                        <Button variant="secondary" onClick={() => fetchProperties()}>Erneut laden</Button>
                    </div>
                ) : loading && properties.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Lade Immobilien...
                    </div>
                ) : filteredProperties.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {properties.length === 0 ? 'Keine Immobilien gefunden.' : 'Keine Immobilien gefunden für diesen Filter.'}
                    </div>
                ) : (
                    <>
                        {viewMode === 'table' ? (
                            <div style={{ overflowX: 'auto' }}>
                            {/* Custom Table Rendering to support expansion */}
                            <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {propertyColumns.map((col, idx) => (
                                            <th key={idx} style={{ textAlign: col.align || 'left', width: col.width }}>{col.header}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedProperties.map(propertyOrGroup => (
                                        <React.Fragment key={propertyOrGroup.id}>
                                            <tr
                                                className="table-row"
                                                onClick={() => {
                                                    if (propertyOrGroup.isGroup) {
                                                        setExpandedWEId(expandedWEId === propertyOrGroup.id ? null : propertyOrGroup.id);
                                                    } else {
                                                        toggleExpand(propertyOrGroup.id);
                                                    }
                                                }}
                                                style={{
                                                    borderBottom: (propertyOrGroup.isGroup ? expandedWEId === propertyOrGroup.id : expandedPropertyId === propertyOrGroup.id) ? 'none' : '1px solid var(--border-color)',
                                                    cursor: 'pointer',
                                                    backgroundColor: propertyOrGroup.isGroup ? 'rgba(139, 92, 246, 0.02)' : 'transparent'
                                                }}
                                            >
                                                {propertyColumns.map((col, idx) => (
                                                    <td key={idx} style={{ textAlign: col.align || 'left', fontWeight: propertyOrGroup.isGroup ? 600 : 'normal' }}>
                                                        {col.render ? col.render(propertyOrGroup) : propertyOrGroup[col.accessor]}
                                                    </td>
                                                ))}
                                            </tr>

                                            {/* If it's a Group and expanded, render sub-properties */}
                                            {propertyOrGroup.isGroup && expandedWEId === propertyOrGroup.id && (
                                                <>
                                                    {propertyOrGroup.properties.map(subProp => (
                                                        <React.Fragment key={subProp.id}>
                                                            <tr
                                                                className="table-row"
                                                                onClick={(e) => { e.stopPropagation(); toggleExpand(subProp.id); }}
                                                                style={{
                                                                    borderBottom: expandedPropertyId === subProp.id ? 'none' : '1px solid var(--border-color)',
                                                                    cursor: 'pointer',
                                                                    backgroundColor: 'rgba(0,0,0,0.01)'
                                                                }}
                                                            >
                                                                {propertyColumns.map((col, idx) => (
                                                                    <td key={idx} style={{ textAlign: col.align || 'left', paddingLeft: idx === 1 ? '40px' : undefined }}>
                                                                        {col.render ? col.render(subProp) : subProp[col.accessor]}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                            {/* Render Units for Sub-Property */}
                                                            {expandedPropertyId === subProp.id && renderUnitsPanel(subProp, true)}
                                                        </React.Fragment>
                                                    ))}
                                                </>
                                            )}

                                            {/* Render Units for Normal Property (Not Group) */}
                                            {!propertyOrGroup.isGroup && expandedPropertyId === propertyOrGroup.id && renderUnitsPanel(propertyOrGroup)}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '100%' : '300px'}, 1fr))`, gap: 'var(--spacing-md)' }}>
                                {filteredProperties.map(property => {
                                    const totalSqm = property.units?.reduce((sum, u) => sum + (parseFloat(u.sqm) || 0), 0) || 0;
                                    const unitCount = property.units?.length || 0;
                                    const rentedUnits = property.units?.filter(u => u.status === 'rented').length || 0;
                                    const canEdit = canEditProperty(property);
                                    const typeKey = getPropertyTypeKey(property.property_type);
                                    const isEconomicUnitMember = !!property.economic_unit_id && (
                                        properties.filter(p => p.economic_unit_id === property.economic_unit_id).length > 1 ||
                                        economicUnits.some(eu => eu.id === property.economic_unit_id)
                                    );

                                    return (
                                        <div key={property.id}
                                            onClick={() => (canEdit ? handleEditProperty(property) : openPropertyInTable(property))}
                                            style={{
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-lg)',
                                                backgroundColor: 'var(--surface-color)',
                                                cursor: 'pointer',
                                                overflow: 'hidden',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                height: '100%',
                                                transition: 'all 0.2s ease-in-out',
                                                boxShadow: 'var(--shadow-sm)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.borderColor = 'var(--primary-color)';
                                                e.currentTarget.style.boxShadow = 'var(--glass-shadow)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'none';
                                                e.currentTarget.style.borderColor = 'var(--border-color)';
                                                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                                            }}
                                        >
                                            {/* Cover Image Section */}
                                            <div style={{ position: 'relative', height: '140px', width: '100%', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                                                <CloudImage
                                                    provider={property.cloud_provider}
                                                    connectionId={property.cloud_connection_id}
                                                    itemId={property.thumbnail_image}
                                                    fallbackIcon={Building2}
                                                    premiumView={true}
                                                />
                                                {/* Economic unit badge */}
                                                {isEconomicUnitMember && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: '12px',
                                                        left: '12px',
                                                        padding: '4px 10px',
                                                        borderRadius: '20px',
                                                        fontSize: '0.7rem',
                                                        fontWeight: 700,
                                                        letterSpacing: '0.05em',
                                                        textTransform: 'uppercase',
                                                        backdropFilter: 'blur(8px)',
                                                        backgroundColor: 'rgba(139, 92, 246, 0.85)',
                                                        color: 'white',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                    }}>
                                                        Wirtschaftseinheit
                                                    </div>
                                                )}
                                                {/* Property type badge */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '12px',
                                                    right: '12px',
                                                    padding: '4px 10px',
                                                    borderRadius: '20px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 700,
                                                    letterSpacing: '0.05em',
                                                    textTransform: 'uppercase',
                                                    backdropFilter: 'blur(8px)',
                                                    backgroundColor: PROPERTY_TYPE_BADGE_COLORS[typeKey],
                                                    color: 'white',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                }}>
                                                    {PROPERTY_TYPE_LABELS[typeKey]}
                                                </div>
                                            </div>

                                            {/* Card Content */}
                                            <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                                                <div>
                                                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {property.street} {property.house_number}
                                                    </div>
                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
                                                        {property.zip} {property.city}
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                            <Home size={14} style={{ color: 'var(--primary-color)' }} />
                                                            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                                                                {unitCount} {unitCount === 1 ? 'Einheit' : 'Einheiten'}
                                                                {unitCount > 0 && (
                                                                    <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {rentedUnits} vermietet</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                            <LayoutGrid size={14} style={{ color: 'var(--primary-color)' }} />
                                                            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{totalSqm > 0 ? `${totalSqm.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²` : '—'}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-sm)', display: 'flex', gap: '8px', marginTop: 'auto', flexWrap: 'wrap' }}>
                                                    {canEdit ? (
                                                        <>
                                                            <Button size="sm" variant="secondary" style={{ flex: 1, minHeight: '36px' }} onClick={(e) => { e.stopPropagation(); handleEditProperty(property); }}>
                                                                <Edit3 size={14} style={{ marginRight: '6px' }} /> Bearbeiten
                                                            </Button>
                                                            <Button size="sm" variant="secondary" style={{ flex: 1, minHeight: '36px' }} onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenUnitModal(property);
                                                            }}>
                                                                <Plus size={14} style={{ marginRight: '6px' }} /> Einheit
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                            <Lock size={14} /> Nur Lesezugriff
                                                        </span>
                                                    )}
                                                    <Button size="sm" variant="secondary" style={{ flex: 1, minHeight: '36px' }} title="In der Tabellenansicht mit Einheiten öffnen" onClick={(e) => {
                                                        e.stopPropagation();
                                                        openPropertyInTable(property);
                                                    }}>
                                                        <List size={14} style={{ marginRight: '6px' }} /> Einheiten
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </Card>

            {/* Property Modal */}
            <Modal
                isOpen={isPropertyModalOpen}
                onClose={() => setIsPropertyModalOpen(false)}
                title={editingPropertyId ? "Immobilie bearbeiten" : "Neue Immobilie anlegen"}
                footer={<><Button variant="secondary" onClick={() => setIsPropertyModalOpen(false)}>Abbrechen</Button><Button onClick={handleSaveProperty} disabled={isSaving}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay message="Speichere Immobilie..." />}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Portfolio *</label>
                    <select
                        style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                        value={propertyForm.portfolio_id}
                        disabled={!!editingPropertyId}
                        onChange={(e) => {
                            const val = e.target.value;
                            // Ausgewählte WE-Mitglieder auf Objekte des neuen Portfolios beschränken
                            setPropertyForm(prev => ({
                                ...prev,
                                portfolio_id: val,
                                economic_unit_members: (prev.economic_unit_members || []).filter(id => properties.find(p => p.id === id)?.portfolio_id === val)
                            }));
                            updatePropertyProvider(val);
                        }}
                    >
                        <option value="">Bitte wählen...</option>
                        {(editingPropertyId ? portfolios : writablePortfolios).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {editingPropertyId && (
                        <div style={{ marginTop: '5px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Das Portfolio kann nachträglich nicht geändert werden, da Darlehen, Zähler und Rechnungen dem Portfolio zugeordnet sind.
                        </div>
                    )}
                    {portfolios.length === 0 && (
                        <div style={{ marginTop: '5px', fontSize: '0.875rem', color: 'var(--warning-color)' }}>
                            Kein Portfolio vorhanden. <Link to="/settings" style={{ textDecoration: 'underline' }}>Jetzt anlegen</Link>
                        </div>
                    )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Straße *" value={propertyForm.street} onChange={(e) => setPropertyForm({ ...propertyForm, street: e.target.value })} />
                    <Input label="Nr. *" value={propertyForm.house_number} onChange={(e) => setPropertyForm({ ...propertyForm, house_number: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                    <Input label="PLZ" value={propertyForm.zip} onChange={(e) => setPropertyForm({ ...propertyForm, zip: e.target.value })} />
                    <Input label="Ort" value={propertyForm.city} onChange={(e) => setPropertyForm({ ...propertyForm, city: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Baujahr" type="number" value={propertyForm.construction_year} onChange={(e) => setPropertyForm({ ...propertyForm, construction_year: e.target.value })} />
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Typ</label>
                        <select
                            style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                            value={propertyForm.property_type}
                            onChange={(e) => setPropertyForm({ ...propertyForm, property_type: e.target.value })}
                        >
                            <option value="residential">Wohnen</option>
                            <option value="commercial">Gewerbe</option>
                            <option value="mixed">Gemischt</option>
                        </select>
                    </div>
                </div>

                {/* Economic Unit Selection (Checkboxes) */}
                <div style={{ marginTop: 'var(--spacing-md)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--accent-color)' }}>
                        Wirtschaftseinheit bilden mit (Mehrfachauswahl möglich)
                    </label>
                    <div style={{
                        border: '1px solid var(--accent-color)',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px',
                        backgroundColor: 'rgba(139, 92, 246, 0.05)',
                        maxHeight: '150px',
                        overflowY: 'auto'
                    }}>
                        {!propertyForm.portfolio_id ? (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Bitte zuerst ein Portfolio wählen.</span>
                        ) : weCandidates.length === 0 ? (
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Keine weiteren Immobilien im Portfolio.</span>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {weCandidates.map(p => {
                                    const checked = selectedMemberIds.includes(p.id);
                                    // Objekte anderer Wirtschaftseinheiten nicht stillschweigend umhängen
                                    const inOtherEconomicUnit = !!p.economic_unit_id && p.economic_unit_id !== propertyForm._original_economic_unit_id;
                                    const notEditable = !canEditProperty(p);
                                    const disabled = !checked && (inOtherEconomicUnit || notEditable);
                                    return (
                                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={disabled}
                                                onChange={(e) => {
                                                    const isChecked = e.target.checked;
                                                    setPropertyForm(prev => {
                                                        const members = prev.economic_unit_members || [];
                                                        const nextMembers = isChecked ? [...members, p.id] : members.filter(id => id !== p.id);
                                                        const next = { ...prev, economic_unit_members: nextMembers };
                                                        // WE verlassen: die WE-Gesamtwerte dürfen nicht zu Einzelwerten dieses Objekts werden
                                                        if (prev._original_economic_unit_id && prev._we_prefill) {
                                                            if (members.length > 0 && nextMembers.length === 0) {
                                                                if (sameAmount(prev.total_investment_cost, prev._we_prefill.investment)) next.total_investment_cost = '';
                                                                if (sameAmount(prev.equity_invested, prev._we_prefill.equity)) next.equity_invested = '';
                                                            } else if (members.length === 0 && nextMembers.length > 0) {
                                                                if (!(parseFloat(prev.total_investment_cost) || 0)) next.total_investment_cost = prev._we_prefill.investment;
                                                                if (!(parseFloat(prev.equity_invested) || 0)) next.equity_invested = prev._we_prefill.equity;
                                                            }
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                style={{ accentColor: 'var(--accent-color)', width: '16px', height: '16px' }}
                                            />
                                            {p.street} {p.house_number} {p.city}
                                            {inOtherEconomicUnit && !checked && (
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>(gehört zu einer anderen Wirtschaftseinheit)</span>
                                            )}
                                            {!inOtherEconomicUnit && notEditable && !checked && (
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>(keine Schreibberechtigung)</span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Wähle alle Gebäude aus, die zu dieser Wirtschaftseinheit gehören. Sie werden im Dashboard zusammengefasst.
                    </div>
                    {isEconomicUnitForm && (formJoiningInvestment > 0 || formJoiningEquity > 0) && (
                        <div style={{ marginTop: '8px', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.08)', fontSize: '0.8rem' }}>
                            <div style={{ marginBottom: '6px' }}>
                                Die neu hinzugefügten Objekte haben eigene Werte (Gesamtinvestition {formatEuro(formJoiningInvestment)}, Eigenkapital {formatEuro(formJoiningEquity)}). Beim Zusammenfassen werden die Einzelwerte dieser Objekte auf 0 gesetzt.
                            </div>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={propertyForm._add_member_values !== false}
                                    onChange={(e) => setPropertyForm(prev => ({ ...prev, _add_member_values: e.target.checked }))}
                                    style={{ marginTop: '2px' }}
                                />
                                <span>
                                    Werte zur Wirtschaftseinheit addieren (Ergebnis: Gesamtinvestition {formatEuro((parseFloat(propertyForm.total_investment_cost) || 0) + formJoiningInvestment)}, Eigenkapital {formatEuro((parseFloat(propertyForm.equity_invested) || 0) + formJoiningEquity)})
                                </span>
                            </label>
                        </div>
                    )}
                    {isLeavingEconomicUnit && (
                        <div style={{ marginTop: '8px', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.08)', fontSize: '0.8rem' }}>
                            Diese Immobilie verlässt die Wirtschaftseinheit. Tragen Sie bei Gesamtinvestition und Eigenkapital die Einzelwerte dieser Immobilie ein – die Gesamtwerte der Wirtschaftseinheit bleiben unverändert.
                        </div>
                    )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                    <CurrencyInput label={isEconomicUnitForm ? 'Gesamtinvestition WE (€)' : 'Gesamtinvestition (€)'} value={propertyForm.total_investment_cost} onChange={(e) => setPropertyForm({ ...propertyForm, total_investment_cost: e.target.value })} />
                    <CurrencyInput label={isEconomicUnitForm ? 'Eigenkapital WE (€)' : 'Eigenkapital (€)'} value={propertyForm.equity_invested} onChange={(e) => setPropertyForm({ ...propertyForm, equity_invested: e.target.value })} />
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '2px' }}>Bilder & Titelbild</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-sm)' }}>
                        Klicken Sie auf ein Bild, um es als Titelbild festzulegen.
                    </p>
                    <CloudImageManager
                        provider={propertyProvider}
                        connectionId={propertyConnectionId}
                        propertyFolderName={editingPropertyId ? getPropertyFolderName(properties.find(p => p.id === editingPropertyId), properties) : ''}
                        relativePath="Bilder"
                        currentThumbnailId={propertyForm.thumbnail_image}
                        onSelectThumbnail={(id) => setPropertyForm(prev => ({ ...prev, thumbnail_image: id }))}
                        isNewEntity={!editingPropertyId}
                        localFiles={newPropertyImages}
                        onLocalFilesChange={setNewPropertyImages}
                        pendingThumbnailIndex={pendingPropertyThumbnailIndex}
                        onSelectPendingThumbnail={setPendingPropertyThumbnailIndex}
                    />
                </div>
            </Modal>

            {/* Unit Modal */}
            <Modal
                isOpen={isUnitModalOpen}
                onClose={() => setIsUnitModalOpen(false)}
                title={editingUnitId ? "Einheit bearbeiten" : `Neue Einheit in ${currentPropertyForUnit?.street} ${currentPropertyForUnit?.house_number}`}
                footer={<><Button variant="secondary" onClick={() => setIsUnitModalOpen(false)}>Abbrechen</Button><Button onClick={handleSaveUnit} disabled={isSaving}>Speichern</Button></>}
            >
                {isSaving && <LoadingOverlay message="Speichere Einheit..." />}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Name / Nr. *" placeholder="Whg 1.01" value={unitForm.unit_name} onChange={(e) => setUnitForm({ ...unitForm, unit_name: e.target.value })} />
                    <Input label="Etage" placeholder="1. OG" value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Fläche (m²)" type="number" min="0" value={unitForm.sqm} onChange={(e) => setUnitForm({ ...unitForm, sqm: e.target.value })} />
                    <Input label="Zimmer" type="number" min="0" value={unitForm.rooms} onChange={(e) => setUnitForm({ ...unitForm, rooms: e.target.value })} />
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>Finanzielle Daten (Soll/Ist)</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Kaltmiete Soll (€)" allowDecimals value={unitForm.target_rent} onChange={(e) => setUnitForm({ ...unitForm, target_rent: e.target.value })} />
                        <CurrencyInput label="Kaltmiete Ist (€)" allowDecimals value={unitForm.cold_rent_ist} onChange={(e) => setUnitForm({ ...unitForm, cold_rent_ist: e.target.value })} placeholder="Optional" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Nebenkosten Soll (€)" allowDecimals value={unitForm.service_charge_soll} onChange={(e) => setUnitForm({ ...unitForm, service_charge_soll: e.target.value })} />
                        <CurrencyInput label="Heizkosten Soll (€)" allowDecimals value={unitForm.heating_cost_soll} onChange={(e) => setUnitForm({ ...unitForm, heating_cost_soll: e.target.value })} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
                        <CurrencyInput label="Sonstige Kosten Soll (€)" allowDecimals value={unitForm.other_costs_soll} onChange={(e) => setUnitForm({ ...unitForm, other_costs_soll: e.target.value })} />
                        <CurrencyInput label="Kaution Soll (€)" allowDecimals value={unitForm.deposit_soll} onChange={(e) => setUnitForm({ ...unitForm, deposit_soll: e.target.value })} />
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <Input label="Bad" type="number" min="0" step="1" value={unitForm.bathrooms} onChange={(e) => setUnitForm({ ...unitForm, bathrooms: e.target.value })} />
                    <Input label="Schlafzimmer" type="number" min="0" step="1" value={unitForm.bedrooms} onChange={(e) => setUnitForm({ ...unitForm, bedrooms: e.target.value })} />
                </div>
                <div style={{ marginTop: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-lg)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.balcony} onChange={(e) => setUnitForm({ ...unitForm, balcony: e.target.checked })} /> Balkon
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.fitted_kitchen} onChange={(e) => setUnitForm({ ...unitForm, fitted_kitchen: e.target.checked })} /> Einbauküche
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked={unitForm.is_vacation_rental} onChange={(e) => setUnitForm({ ...unitForm, is_vacation_rental: e.target.checked })} /> Ferienwohnung
                    </label>
                </div>

                <div style={{ marginTop: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-md)' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '2px' }}>Bilder & Titelbild</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-sm)' }}>
                        Klicken Sie auf ein Bild, um es als Titelbild festzulegen.
                    </p>
                    {editingUnitNameChanged && (
                        <div style={{ marginBottom: 'var(--spacing-sm)', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.08)', fontSize: '0.8rem' }}>
                            Hinweis: Der Cloud-Ordner „Einheiten/{editingUnitOriginalName}“ (mit bereits hochgeladenen Bildern und Dokumenten) wird beim Speichern auf den neuen Namen umbenannt.
                        </div>
                    )}
                    {/* Bilder-Ordner der gespeicherten Einheit – nicht des live getippten Namens */}
                    <CloudImageManager
                        provider={unitProvider}
                        connectionId={unitConnectionId}
                        propertyFolderName={currentPropertyForUnit ? getPropertyFolderName(currentPropertyForUnit, properties) : ''}
                        relativePath={editingUnitId ? getUnitImagesRelativePath(currentPropertyForUnit, editingUnitOriginalName) : ''}
                        currentThumbnailId={unitForm.thumbnail_image}
                        onSelectThumbnail={(id) => setUnitForm(prev => ({ ...prev, thumbnail_image: id }))}
                        isNewEntity={!editingUnitId}
                        localFiles={newUnitImages}
                        onLocalFilesChange={setNewUnitImages}
                        pendingThumbnailIndex={pendingUnitThumbnailIndex}
                        onSelectPendingThumbnail={setPendingUnitThumbnailIndex}
                    />
                </div>
            </Modal>
        </div>
    );
};

export default Properties;
