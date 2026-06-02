import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import {
    ArrowLeft, User, Phone, Mail, Users, Home, Calendar,
    FileText, Trash2, Edit, Plus, Upload, Download, Loader2,
    Lock, RefreshCw, Key, Building2, Bell, MessageSquare,
    AlertCircle, CheckCircle2, ChevronRight, Settings, FileSpreadsheet,
    Eye, Cloud, DollarSign
} from 'lucide-react';

const TenantDetail = () => {
    const { id: leaseId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();

    // Data States
    const [lease, setLease] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [claims, setClaims] = useState([]);
    const [cloudFiles, setCloudFiles] = useState([]);
    const [loadingCloud, setLoadingCloud] = useState(false);
    const [cloudError, setCloudError] = useState(null);
    const [tenantCloudPath, setTenantCloudPath] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Edit Forms States
    const [isEditTenantOpen, setIsEditTenantOpen] = useState(false);
    const [isEditLeaseOpen, setIsEditLeaseOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [tenantForm, setTenantForm] = useState({
        first_name: '',
        last_name: '',
        phone: '',
        email: '',
        occupants: 1,
        street: '',
        house_number: '',
        postal_code: '',
        city: ''
    });

    const [leaseForm, setLeaseForm] = useState({
        start_date: '',
        end_date: '',
        cold_rent: '',
        service_charge: '',
        heating_cost: '',
        other_costs: '',
        deposit: '',
        payment_due_day: 3,
        lease_type: 'normal',
        last_rent_increase: ''
    });

    // Sub-modules state
    const [notes, setNotes] = useState('');
    const [warningSettings, setWarningSettings] = useState({
        globalActive: true,
        tenantActive: true,
        emailNotify: true
    });

    // Upload & Ticket States
    const [uploading, setUploading] = useState(false);
    const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
    const [ticketForm, setTicketForm] = useState({
        title: '',
        description: '',
        priority: 'medium',
        category: 'repair'
    });
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (leaseId) {
            loadTenantData();
            // Load persistent LocalStorage notes and warning settings
            const savedNotes = localStorage.getItem(`tenant_notes_${leaseId}`);
            if (savedNotes) setNotes(savedNotes);

            const savedWarnings = localStorage.getItem(`warning_settings_${leaseId}`);
            if (savedWarnings) {
                try {
                    setWarningSettings(JSON.parse(savedWarnings));
                } catch (e) {
                    console.error("Error parsing warning settings", e);
                }
            }
        }
    }, [leaseId]);

    const loadCloudFiles = async (provider, path, propertyId) => {
        setLoadingCloud(true);
        setCloudError(null);
        try {
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'list', provider, path }
            });

            let fetchErr = error;
            let detailedErrMsg = error ? error.message || String(error) : "";
            
            if (data && data.error) {
                fetchErr = new Error(data.error);
                detailedErrMsg = data.error;
            }

            const isFolderNotFound = fetchErr && (
                detailedErrMsg.includes("nicht gefunden") ||
                detailedErrMsg.includes("not found") ||
                detailedErrMsg.includes("404")
            );

            if (isFolderNotFound) {
                // Trigger cloud sync to create the missing folder structure
                await supabase.functions.invoke('cloud-sync', {
                    body: { provider, action: 'create', propertyId }
                });
                
                // Retry listing files once
                const retryRes = await supabase.functions.invoke('cloud-drive', {
                    body: { action: 'list', provider, path }
                });
                if (retryRes.data?.files) {
                    setCloudFiles(retryRes.data.files);
                } else {
                    setCloudFiles([]);
                }
            } else if (fetchErr) {
                throw fetchErr;
            } else {
                setCloudFiles(data?.files || []);
            }
        } catch (err) {
            console.error("Error loading cloud files:", err);
            setCloudError(err.message || String(err));
        } finally {
            setLoadingCloud(false);
        }
    };

    const loadTenantData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch Lease with related unit, property, tenant
            const { data: leaseData, error: leaseError } = await supabase
                .from('leases')
                .select(`
                    *,
                    tenant:tenants(*),
                    unit:units(
                        *,
                        property:properties(*)
                    )
                `)
                .eq('id', leaseId)
                .single();

            if (leaseError) throw leaseError;
            if (!leaseData) throw new Error('Mietverhältnis nicht gefunden');

            // Fetch cloud connection via portfolio_cloud_links if available
            if (leaseData.unit?.property?.portfolio_id) {
                const { data: linkData } = await supabase
                    .from('portfolio_cloud_links')
                    .select('cloud_connection_id')
                    .eq('portfolio_id', leaseData.unit.property.portfolio_id)
                    .maybeSingle();

                if (linkData?.cloud_connection_id) {
                    const { data: connData } = await supabase
                        .from('cloud_connections')
                        .select('*')
                        .eq('id', linkData.cloud_connection_id)
                        .maybeSingle();
                    
                    if (connData && leaseData.unit.property) {
                        leaseData.unit.property.cloud_connection = connData;
                    }
                }
            }

            setLease(leaseData);

            // Populate forms
            const tenant = leaseData.tenant || {};
            setTenantForm({
                first_name: tenant.first_name || '',
                last_name: tenant.last_name || '',
                phone: tenant.phone || '',
                email: tenant.email || '',
                occupants: tenant.occupants || 1,
                street: tenant.street || '',
                house_number: tenant.house_number || '',
                postal_code: tenant.postal_code || '',
                city: tenant.city || ''
            });

            setLeaseForm({
                start_date: leaseData.start_date || '',
                end_date: leaseData.end_date || '',
                cold_rent: leaseData.cold_rent || '',
                service_charge: leaseData.service_charge || '',
                heating_cost: leaseData.heating_cost || '',
                other_costs: leaseData.other_costs || '',
                deposit: leaseData.deposit || '',
                payment_due_day: leaseData.payment_due_day || 3,
                lease_type: leaseData.lease_type || 'normal',
                last_rent_increase: leaseData.last_rent_increase || ''
            });

            // Fetch linked tickets
            if (leaseData.unit_id) {
                const { data: ticketData } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('unit_id', leaseData.unit_id)
                    .order('created_at', { ascending: false });
                setTickets(ticketData || []);
            }

            // Fetch linked documents (fallback local list)
            if (leaseData.tenant_id) {
                const { data: docData } = await supabase
                    .from('documents')
                    .select('*')
                    .eq('tenant_id', leaseData.tenant_id)
                    .order('created_at', { ascending: false });
                setDocuments(docData || []);
            }

            // Fetch claims for this lease
            const { data: claimsData } = await supabase
                .from('claims')
                .select(`
                    id, status, escalation_level, deadline, created_at,
                    interest_rate, accumulated_unpaid_interest, accumulated_unpaid_fees
                `)
                .eq('lease_id', leaseId)
                .order('created_at', { ascending: false });

            let claimsWithTotals = [];
            if (claimsData && claimsData.length > 0) {
                const claimIds = claimsData.map(c => c.id);
                const { data: totalsData } = await supabase
                    .from('claim_totals_view')
                    .select('*')
                    .in('claim_id', claimIds);

                claimsWithTotals = claimsData.map(c => {
                    const total = totalsData?.find(t => t.claim_id === c.id);
                    return {
                        ...c,
                        total_open: total?.total_open || 0,
                        total_fees: total?.total_fees || 0,
                        total_interest: total?.total_interest || 0,
                        total_principal: total?.total_principal || 0,
                    };
                });
            }
            setClaims(claimsWithTotals);

            // Compute cloud folder path and fetch files if cloud connection exists
            let displayFolderName = '';
            const prop = leaseData.unit?.property;
            if (prop) {
                if (prop.economic_unit_id) {
                    const { data: siblingProps } = await supabase
                        .from('properties')
                        .select('street, house_number')
                        .eq('economic_unit_id', prop.economic_unit_id);
                    
                    const groupedByStreet = {};
                    (siblingProps || []).forEach(m => {
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
                    displayFolderName = `WG: ${groupName || 'Wirtschaftsgemeinschaft'}`;
                } else {
                    displayFolderName = `${prop.street} ${prop.house_number || ''}`.trim();
                }
            }

            const tenantFolderName = `${leaseData.tenant?.first_name || ''} ${leaseData.tenant?.last_name || ''}`.trim();
            const unitName = leaseData.unit?.unit_name || '';
            const fullCloudPath = displayFolderName && unitName && tenantFolderName
                ? `${displayFolderName}/Neuvermietung/${unitName}/Mietverhältnisse/${tenantFolderName}`
                : '';
            
            setTenantCloudPath(fullCloudPath);

            if (prop?.cloud_connection && fullCloudPath) {
                loadCloudFiles(prop.cloud_connection.provider, fullCloudPath, prop.id);
            }

        } catch (err) {
            console.error('Error loading tenant data:', err);
            setError(err.message || 'Mietverhältnis konnte nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    };

    // Save Notes to LocalStorage
    const handleSaveNotes = (val) => {
        setNotes(val);
        localStorage.setItem(`tenant_notes_${leaseId}`, val);
    };

    // Save Warnings to LocalStorage
    const handleWarningToggle = (key) => {
        const updated = { ...warningSettings, [key]: !warningSettings[key] };
        setWarningSettings(updated);
        localStorage.setItem(`warning_settings_${leaseId}`, JSON.stringify(updated));
    };

    // Save Tenant Form
    const handleSaveTenant = async () => {
        if (!tenantForm.first_name || !tenantForm.last_name) {
            alert('Bitte Vor- und Nachnamen ausfüllen.');
            return;
        }
        setIsSaving(true);
        try {
            const { error: tError } = await supabase
                .from('tenants')
                .update({
                    first_name: tenantForm.first_name,
                    last_name: tenantForm.last_name,
                    phone: tenantForm.phone,
                    email: tenantForm.email,
                    occupants: parseInt(tenantForm.occupants) || 1,
                    street: tenantForm.street,
                    house_number: tenantForm.house_number,
                    postal_code: tenantForm.postal_code,
                    city: tenantForm.city
                })
                .eq('id', lease.tenant_id);

            if (tError) throw tError;

            setIsEditTenantOpen(false);
            loadTenantData();
        } catch (err) {
            alert('Fehler beim Speichern der Mieterdaten: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Save Lease Form
    const handleSaveLease = async () => {
        if (!leaseForm.start_date || !leaseForm.cold_rent) {
            alert('Bitte Mietbeginn und Kaltmiete angeben.');
            return;
        }
        setIsSaving(true);
        try {
            const coldRent = parseFloat(leaseForm.cold_rent) || 0;
            const serviceCharge = parseFloat(leaseForm.service_charge) || 0;
            const heatingCost = parseFloat(leaseForm.heating_cost) || 0;
            const otherCosts = parseFloat(leaseForm.other_costs) || 0;
            const deposit = parseFloat(leaseForm.deposit) || 0;

            const { error: lError } = await supabase
                .from('leases')
                .update({
                    start_date: leaseForm.start_date,
                    end_date: leaseForm.end_date || null,
                    cold_rent: coldRent,
                    service_charge: serviceCharge,
                    heating_cost: heatingCost,
                    other_costs: otherCosts,
                    deposit: deposit,
                    payment_due_day: parseInt(leaseForm.payment_due_day) || 3,
                    lease_type: leaseForm.lease_type || 'normal',
                    last_rent_increase: leaseForm.last_rent_increase || null
                })
                .eq('id', leaseId);

            if (lError) throw lError;

            // Also update unit Soll-fields to keep them in sync
            if (lease.unit_id) {
                await supabase.from('units').update({
                    cold_rent_ist: coldRent,
                    service_charge_soll: serviceCharge,
                    heating_cost_soll: heatingCost,
                    other_costs_soll: otherCosts,
                    deposit_soll: deposit
                }).eq('id', lease.unit_id);
            }

            setIsEditLeaseOpen(false);
            loadTenantData();
        } catch (err) {
            alert('Fehler beim Speichern des Mietvertrags: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Terminate Lease
    const handleTerminateLease = async () => {
        const endDate = prompt('Bitte geben Sie das Auszugsdatum ein (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
        if (endDate === null) return; // cancelled

        setIsSaving(true);
        try {
            const { error: termError } = await supabase
                .from('leases')
                .update({
                    end_date: endDate,
                    status: 'ended'
                })
                .eq('id', leaseId);

            if (termError) throw termError;
            loadTenantData();
        } catch (err) {
            alert('Fehler beim Beenden des Mietverhältnisses: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Reactivate Lease
    const handleReactivateLease = async () => {
        if (!window.confirm('Möchten Sie dieses Mietverhältnis wirklich reaktivieren?')) return;
        setIsSaving(true);
        try {
            const { error: reactError } = await supabase
                .from('leases')
                .update({
                    end_date: null,
                    status: 'active'
                })
                .eq('id', leaseId);

            if (reactError) throw reactError;
            loadTenantData();
        } catch (err) {
            alert('Fehler beim Reaktivieren: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Delete Lease Completely
    const handleDeleteLease = async () => {
        if (!window.confirm('WARNUNG: Möchten Sie dieses Mietverhältnis wirklich unwiderruflich löschen? Alle verknüpften Zahlungsrückstände und Belege könnten verwaisen.')) return;
        setIsSaving(true);
        try {
            const { error: delError } = await supabase
                .from('leases')
                .delete()
                .eq('id', leaseId);

            if (delError) throw delError;
            alert('Mietverhältnis erfolgreich gelöscht.');
            navigate('/tenants');
        } catch (err) {
            alert('Fehler beim Löschen: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Update Claim Status
    const handleUpdateClaimStatus = async (claimId, newStatus) => {
        try {
            setIsSaving(true);
            const { error } = await supabase
                .from('claims')
                .update({ status: newStatus })
                .eq('id', claimId);

            if (error) throw error;
            await loadTenantData();
            alert('Status der Forderung erfolgreich aktualisiert.');
        } catch (err) {
            console.error('Error updating claim status:', err);
            alert('Fehler beim Aktualisieren des Status: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // Cloud Upload
    const handleCloudUpload = async (files) => {
        if (!files || files.length === 0 || uploading) return;
        const file = files[0];
        
        setUploading(true);
        try {
            const provider = lease.unit.property.cloud_connection.provider;
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('provider', provider);
            formData.append('path', tenantCloudPath);
            formData.append('file', file);
            
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: formData
            });
            
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            
            loadCloudFiles(provider, tenantCloudPath, lease.unit.property.id);
            alert('Dokument erfolgreich in die Cloud hochgeladen.');
        } catch (err) {
            console.error("Cloud upload error:", err);
            alert("Fehler beim Cloud-Upload: " + err.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Cloud Delete
    const handleCloudDelete = async (item) => {
        if (!window.confirm(`Möchten Sie '${item.name}' wirklich aus der Cloud löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
        setLoadingCloud(true);
        try {
            const provider = lease.unit.property.cloud_connection.provider;
            const { data, error } = await supabase.functions.invoke('cloud-drive', {
                body: { action: 'delete', provider, itemId: item.id }
            });
            
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            
            loadCloudFiles(provider, tenantCloudPath, lease.unit.property.id);
            alert('Datei erfolgreich gelöscht.');
        } catch (err) {
            console.error("Cloud delete error:", err);
            alert("Fehler beim Löschen: " + err.message);
        } finally {
            setLoadingCloud(false);
        }
    };

    // Upload Document
    const handleUploadDocument = async (files) => {
        if (!files || files.length === 0 || uploading) return;
        setUploading(true);
        try {
            const file = files[0];
            if (file.size > 10 * 1024 * 1024) {
                alert('Datei ist zu groß (max 10MB).');
                return;
            }

            const propertyId = lease.unit?.property?.id;
            const tenantId = lease.tenant_id;
            if (!propertyId || !tenantId) throw new Error('Zuweisungsdaten unvollständig');

            const timestamp = Date.now();
            const filePath = `${propertyId}/tenant/${tenantId}/${timestamp}_${file.name}`;

            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // Save metadata
            const { error: dbError } = await supabase
                .from('documents')
                .insert({
                    user_id: user.id,
                    property_id: propertyId,
                    unit_id: lease.unit_id,
                    tenant_id: tenantId,
                    file_name: file.name,
                    file_path: filePath,
                    mime_type: file.type,
                    category: 'personal'
                });

            if (dbError) throw dbError;

            loadTenantData();
            alert('Dokument erfolgreich hochgeladen.');
        } catch (err) {
            console.error(err);
            alert('Fehler beim Hochladen: ' + err.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Delete Document
    const handleDeleteDocument = async (doc) => {
        if (!window.confirm(`Möchten Sie das Dokument "${doc.file_name}" wirklich löschen?`)) return;
        try {
            await supabase.storage.from('documents').remove([doc.file_path]);
            const { error } = await supabase.from('documents').delete().eq('id', doc.id);
            if (error) throw error;
            loadTenantData();
        } catch (err) {
            alert('Fehler beim Löschen des Dokuments: ' + err.message);
        }
    };

    // Download Document
    const handleDownloadDocument = async (doc) => {
        try {
            const { data, error } = await supabase.storage
                .from('documents')
                .createSignedUrl(doc.file_path, 3600);
            if (error) throw error;
            if (data?.signedUrl) {
                window.open(data.signedUrl, '_blank');
            }
        } catch (err) {
            alert('Fehler beim Download: ' + err.message);
        }
    };

    // Create Support Ticket
    const handleCreateTicket = async () => {
        if (!ticketForm.title) {
            alert('Bitte geben Sie einen Titel für das Ticket an.');
            return;
        }
        setIsSaving(true);
        try {
            const { error: ticketError } = await supabase
                .from('tickets')
                .insert({
                    user_id: user.id,
                    unit_id: lease.unit_id,
                    title: ticketForm.title,
                    description: ticketForm.description,
                    priority: ticketForm.priority,
                    category: ticketForm.category,
                    status: 'new'
                });

            if (ticketError) throw ticketError;

            setIsTicketModalOpen(false);
            setTicketForm({ title: '', description: '', priority: 'medium', category: 'repair' });
            loadTenantData();
            alert('Support-Ticket wurde erfolgreich erstellt.');
        } catch (err) {
            alert('Fehler beim Erstellen des Tickets: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '—';
        return new Date(dateString).toLocaleDateString('de-DE');
    };

    const getStatusColor = (s) => {
        switch (s) {
            case 'resolved': return 'success';
            case 'in_progress': return 'warning';
            default: return 'blue';
        }
    };

    const calcNextRentIncrease = (l) => {
        if (!l) return null;
        const baseDate = l.last_rent_increase || l.start_date;
        if (!baseDate) return null;
        const d = new Date(baseDate);
        d.setFullYear(d.getFullYear() + 1); // 12-month lock-in period
        return d.toISOString().split('T')[0];
    };

    const nextRentIncreaseDate = calcNextRentIncrease(lease);
    const totalWarmRent = (parseFloat(lease?.cold_rent) || 0) +
        (parseFloat(lease?.service_charge) || 0) +
        (parseFloat(lease?.heating_cost) || 0) +
        (parseFloat(lease?.other_costs) || 0);

    return (
        <div style={{ paddingBottom: '60px' }}>
            {/* Navigation Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <div>
                    <button
                        onClick={() => navigate('/tenants')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: 'none', border: 'none', color: 'var(--text-secondary)',
                            fontSize: '0.85rem', cursor: 'pointer', padding: '0', marginBottom: '8px',
                            fontFamily: 'inherit'
                        }}
                    >
                        <ArrowLeft size={14} /> Zurück zur Übersicht
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                            {lease?.tenant?.first_name} {lease?.tenant?.last_name}
                        </h1>
                        {lease?.status === 'active' ? (
                            <Badge variant="success">Aktiv</Badge>
                        ) : (
                            <Badge variant="default">Beendet</Badge>
                        )}
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Building2 size={15} />
                        {lease?.unit?.property?.street} {lease?.unit?.property?.house_number}, {lease?.unit?.property?.city}
                        <ChevronRight size={14} />
                        Einheit: {lease?.unit?.unit_name}
                    </p>
                </div>
            </div>

            {/* Main Grid Layout */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '24px',
                alignItems: 'start'
            }}>
                {/* LEFT SIDE TILES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    {/* Tile 1: Stammdaten (Persönliche Daten) */}
                    <Card
                        title="Stammdaten"
                        headerActions={
                            <Button variant="ghost" size="sm" onClick={() => setIsEditTenantOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Edit size={14} /> Bearbeiten
                            </Button>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                    <User size={18} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Name</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{lease?.tenant?.first_name} {lease?.tenant?.last_name}</div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Phone size={16} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Telefon</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>{lease?.tenant?.phone || '—'}</div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Mail size={16} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>E-Mail</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lease?.tenant?.email || '—'}</div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Users size={16} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Personenanzahl</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>{lease?.tenant?.occupants || 1} {lease?.tenant?.occupants === 1 ? 'Person' : 'Personen'}</div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                                        <Home size={16} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Kontaktadresse</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                                            {lease?.tenant?.street ? `${lease.tenant.street} ${lease.tenant.house_number || ''}` : 'Wie Mietobjekt'}
                                            {lease?.tenant?.city && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lease.tenant.postal_code} {lease.tenant.city}</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Tile 2: Zahlungen & Forderungen */}
                    <Card 
                        title="Zahlungen & Forderungen"
                        headerActions={
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                icon={Plus}
                                onClick={() => navigate('/forderungen', { state: { openCreate: true, defaultLeaseId: leaseId } })}
                            >
                                Neue Forderung
                            </Button>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                Übersicht der Zahlungsrückstände und laufenden Forderungen für dieses Mietverhältnis.
                            </div>

                            {/* Claims list */}
                            {claims.length === 0 ? (
                                <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', backgroundColor: 'rgba(255,255,255,0.01)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
                                    <CheckCircle2 size={24} style={{ margin: '0 auto 6px', color: 'var(--success-color)' }} />
                                    Keine offenen Forderungen oder Zahlungsrückstände.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {claims.map(claim => {
                                        let badgeVar = 'default';
                                        let statusText = claim.status;
                                        if (claim.status === 'active') { badgeVar = 'danger'; statusText = 'Aktiv'; }
                                        else if (claim.status === 'settled') { badgeVar = 'success'; statusText = 'Bezahlt'; }
                                        else if (claim.status === 'default') { badgeVar = 'default'; statusText = 'Ausfall'; }
                                        else if (claim.status === 'payment_plan') { badgeVar = 'warning'; statusText = 'Zahlungsplan'; }

                                        return (
                                            <div 
                                                key={claim.id}
                                                style={{
                                                    padding: '12px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--border-color)',
                                                    backgroundColor: 'rgba(255,255,255,0.01)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px'
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <Badge variant={badgeVar}>{statusText}</Badge>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Stufe {claim.escalation_level}</span>
                                                    </div>
                                                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: claim.total_open > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
                                                        {claim.total_open.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                    <div><strong>Hauptforderung:</strong> {claim.total_principal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                                    <div><strong>Gebühren/Zinsen:</strong> {(claim.total_fees + claim.total_interest).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                                                    {claim.deadline && <div><strong>Frist:</strong> {formatDate(claim.deadline)}</div>}
                                                    <div><strong>Erstellt am:</strong> {formatDate(claim.created_at)}</div>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '4px' }}>
                                                    <Button 
                                                        size="xs" 
                                                        variant="ghost" 
                                                        icon={Eye} 
                                                        onClick={() => navigate(`/forderungen/${claim.id}`)}
                                                    >
                                                        Details
                                                    </Button>
                                                    {claim.status !== 'settled' && (
                                                        <Button 
                                                            size="xs" 
                                                            variant="secondary" 
                                                            onClick={() => handleUpdateClaimStatus(claim.id, 'settled')}
                                                        >
                                                            Bezahlt
                                                        </Button>
                                                    )}
                                                    {claim.status !== 'default' && claim.status !== 'settled' && (
                                                        <Button 
                                                            size="xs" 
                                                            variant="outline" 
                                                            onClick={() => handleUpdateClaimStatus(claim.id, 'default')}
                                                        >
                                                            Ausfall
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Warning Settings section */}
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mietwarnung-Einstellungen</div>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Mietwarnungen aktiv</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Automatische Generierung bei Verzug</div>
                                    </div>
                                    <label style={{ position: 'relative', display: 'inline-block', width: '38px', height: '22px', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={warningSettings.tenantActive}
                                            onChange={() => handleWarningToggle('tenantActive')}
                                            style={{ opacity: 0, width: 0, height: 0 }}
                                        />
                                        <span style={{
                                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                            backgroundColor: warningSettings.tenantActive ? 'var(--primary-color)' : '#cbd5e1',
                                            transition: '0.2s', borderRadius: '34px'
                                        }} />
                                        <span style={{
                                            position: 'absolute', height: '16px', width: '16px', left: warningSettings.tenantActive ? '18px' : '4px', bottom: '3px',
                                            backgroundColor: 'white', transition: '0.2s', borderRadius: '50%'
                                        }} />
                                    </label>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Direkter E-Mail-Versand</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Erinnerung direkt an Mieter mailen</div>
                                    </div>
                                    <label style={{ position: 'relative', display: 'inline-block', width: '38px', height: '22px', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={warningSettings.emailNotify}
                                            onChange={() => handleWarningToggle('emailNotify')}
                                            style={{ opacity: 0, width: 0, height: 0 }}
                                        />
                                        <span style={{
                                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                            backgroundColor: warningSettings.emailNotify ? 'var(--primary-color)' : '#cbd5e1',
                                            transition: '0.2s', borderRadius: '34px'
                                        }} />
                                        <span style={{
                                            position: 'absolute', height: '16px', width: '16px', left: warningSettings.emailNotify ? '18px' : '4px', bottom: '3px',
                                            backgroundColor: 'white', transition: '0.2s', borderRadius: '50%'
                                        }} />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Tile 3: Verknüpfte Tickets */}
                    <Card
                        title="Verknüpfte Tickets"
                        headerActions={
                            <Button variant="ghost" size="sm" onClick={() => setIsTicketModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Plus size={14} /> Neues Ticket
                            </Button>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {tickets.length === 0 ? (
                                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    <MessageSquare size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                    Keine Tickets für diese Einheit vorhanden.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {tickets.map(ticket => (
                                        <div
                                            key={ticket.id}
                                            onClick={() => navigate('/ticket-board')}
                                            style={{
                                                padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                                                transition: 'all 0.2s', backgroundColor: 'rgba(255,255,255,0.01)'
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = 'var(--primary-color)'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                                        >
                                            <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
                                                <div style={{ fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '8px' }}>
                                                    <span>{formatDate(ticket.created_at)}</span>
                                                    <span>•</span>
                                                    <span>Prio: {ticket.priority}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <Badge variant={getStatusColor(ticket.status)}>{ticket.status}</Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Tile 4: Interne Notizen */}
                    <Card title="Interne Notizen">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                Diese Notizen sind privat und nur für Sie sichtbar. Mieter haben keinen Zugriff darauf.
                            </div>
                            <textarea
                                value={notes}
                                onChange={(e) => handleSaveNotes(e.target.value)}
                                placeholder="Geben Sie hier wichtige Details, Absprachen oder Besonderheiten zum Mieter ein..."
                                style={{
                                    width: '100%', height: '110px', padding: '12px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'rgba(0,0,0,0.01)',
                                    fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.4
                                }}
                            />
                        </div>
                    </Card>
                </div>

                {/* RIGHT SIDE TILES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Tile 5: Mietvertrag */}
                    <Card
                        title="Mietvertrag"
                        headerActions={
                            <Button variant="ghost" size="sm" onClick={() => setIsEditLeaseOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Edit size={14} /> Bearbeiten
                            </Button>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mietbeginn</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                        <Calendar size={14} color="var(--primary-color)" /> {formatDate(lease?.start_date)}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mietende</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                        <Calendar size={14} color="var(--primary-color)" /> {lease?.end_date ? formatDate(lease.end_date) : 'Unbefristet'}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Vertragsart</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, marginTop: '2px' }}>
                                        {lease?.lease_type === 'staffel' ? 'Staffelvertrag' : lease?.lease_type === 'index' ? 'Indexvertrag' : 'Normalmietvertrag'}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Kaution</div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 600, marginTop: '2px' }}>{formatCurrency(lease?.deposit)}</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Letzte Mieterhöhung</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 500, marginTop: '2px' }}>{formatDate(lease?.last_rent_increase) || 'Bisher keine'}</div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={FileText}
                                        onClick={() => navigate('/settings', {
                                            state: {
                                                activeTab: 'document-templates',
                                                templateId: 'rent_increase',
                                                tenant: {
                                                    first_name: lease?.tenant?.first_name,
                                                    last_name: lease?.tenant?.last_name,
                                                    gender: lease?.tenant?.gender,
                                                    street: lease?.tenant?.street || lease?.unit?.property?.street,
                                                    house_number: lease?.tenant?.house_number || lease?.unit?.property?.house_number,
                                                    zip: lease?.tenant?.postal_code || lease?.unit?.property?.zip,
                                                    city: lease?.tenant?.city || lease?.unit?.property?.city,
                                                    objekt_name: lease?.unit?.property?.street,
                                                    einheit_name: lease?.unit?.unit_name,
                                                    cold_rent: lease?.cold_rent,
                                                }
                                            }
                                        })}
                                    >
                                        Mieterhöhungsschreiben erstellen
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Tile 6: Finanzen / Mietkosten */}
                    <Card title="Mietkosten & Fälligkeit">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Kaltmiete:</span>
                                <span style={{ fontWeight: 500 }}>{formatCurrency(lease?.cold_rent)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Nebenkostenvorauszahlung:</span>
                                <span style={{ fontWeight: 500 }}>{formatCurrency(lease?.service_charge)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Heizkostenvorauszahlung:</span>
                                <span style={{ fontWeight: 500 }}>{formatCurrency(lease?.heating_cost)}</span>
                            </div>
                            {lease?.other_costs > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.88rem' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Sonstige Kosten:</span>
                                    <span style={{ fontWeight: 500 }}>{formatCurrency(lease?.other_costs)}</span>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', fontSize: '1.05rem', fontWeight: 700 }}>
                                <span>Warmmiete Gesamt:</span>
                                <span style={{ color: 'var(--primary-color)' }}>{formatCurrency(totalWarmRent)}</span>
                            </div>

                            <div style={{ borderTop: '1px dotted var(--border-color)', marginTop: '8px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                <span>Mietzahlung fällig am:</span>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lease?.payment_due_day || 3}. Werktag des Monats</span>
                            </div>
                        </div>
                    </Card>

                    {/* Tile 7: Dokumente & Cloud-Explorer */}
                    <Card
                        title="Dokumente & Verträge"
                        headerActions={
                            <div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                    onChange={(e) => {
                                        if (lease?.unit?.property?.cloud_connection) {
                                            handleCloudUpload(e.target.files);
                                        } else {
                                            handleUploadDocument(e.target.files);
                                        }
                                    }}
                                />
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => fileInputRef.current?.click()} 
                                    disabled={uploading || loadingCloud} 
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Hochladen
                                </Button>
                            </div>
                        }
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {lease?.unit?.property?.cloud_connection ? (
                                <>
                                    {/* Cloud folder path badge */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <Cloud size={14} style={{ color: 'var(--primary-color)' }} />
                                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tenantCloudPath}>
                                            Cloud: {tenantCloudPath}
                                        </span>
                                    </div>

                                    {loadingCloud ? (
                                        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                                            Lade Cloud-Dateien...
                                        </div>
                                    ) : cloudError ? (
                                        <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', fontSize: '0.8rem', color: 'var(--danger-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                                <AlertCircle size={16} /> Fehler beim Laden der Cloud-Dateien
                                            </div>
                                            <div>{cloudError}</div>
                                            <Button size="xs" variant="secondary" onClick={() => loadCloudFiles(lease.unit.property.cloud_connection.provider, tenantCloudPath, lease.unit.property.id)} style={{ alignSelf: 'flex-start' }}>Erneut versuchen</Button>
                                        </div>
                                    ) : cloudFiles.length === 0 ? (
                                        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            <FileText size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                            Keine Dokumente im Cloud-Ordner gefunden.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {cloudFiles.map(file => (
                                                <div
                                                    key={file.id}
                                                    style={{
                                                        padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        backgroundColor: 'rgba(255,255,255,0.01)'
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                                                            {file.name}
                                                        </div>
                                                        {file.size && (
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                                {(file.size / 1024 / 1024).toFixed(2)} MB
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        {file.url && (
                                                            <button
                                                                onClick={() => window.open(file.url, '_blank')}
                                                                style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--primary-color)', cursor: 'pointer' }}
                                                                title="Anzeigen / Herunterladen"
                                                            >
                                                                <Download size={15} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleCloudDelete(file)}
                                                            style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--danger-color)', cursor: 'pointer' }}
                                                            title="Löschen"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--warning-color)', backgroundColor: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.15)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                        <AlertCircle size={14} /> Keine Cloud-Verbindung eingerichtet. Dateien werden lokal gespeichert.
                                    </div>
                                    {documents.length === 0 ? (
                                        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            <FileText size={28} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                            Keine Dokumente für diesen Mieter hinterlegt.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {documents.map(doc => (
                                                <div
                                                    key={doc.id}
                                                    style={{
                                                        padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        backgroundColor: 'rgba(255,255,255,0.01)'
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0, flex: 1, paddingRight: '12px' }}>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>
                                                            {doc.file_name}
                                                        </div>
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                            {formatDate(doc.created_at)}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button
                                                            onClick={() => handleDownloadDocument(doc)}
                                                            style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--primary-color)', cursor: 'pointer' }}
                                                            title="Herunterladen"
                                                        >
                                                            <Download size={15} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteDocument(doc)}
                                                            style={{ background: 'none', border: 'none', padding: '6px', color: 'var(--danger-color)', cursor: 'pointer' }}
                                                            title="Löschen"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </Card>

                    {/* Tile 8: Schnellaktionen & Gefahrenzone */}
                    <Card title="Gefahrenzone & Aktionen">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <Button
                                variant="outline"
                                fullWidth
                                onClick={() => navigate(`/properties?unitId=${lease?.unit_id}`)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            >
                                <Home size={16} /> Einheit in Immobilien anzeigen
                            </Button>

                            {lease?.status === 'active' ? (
                                <Button
                                    variant="warning"
                                    fullWidth
                                    onClick={handleTerminateLease}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <Lock size={16} /> Mietverhältnis beenden
                                </Button>
                            ) : (
                                <Button
                                    variant="success"
                                    fullWidth
                                    onClick={handleReactivateLease}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <RefreshCw size={16} /> Mietverhältnis reaktivieren
                                </Button>
                            )}

                            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '14px' }}>
                                <Button
                                    variant="danger"
                                    fullWidth
                                    onClick={handleDeleteLease}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <Trash2 size={16} /> Mietverhältnis unwiderruflich löschen
                                </Button>
                            </div>
                        </div>
                    </Card>

                </div>
            </div>

            {/* EDIT TENANT MODAL */}
            {isEditTenantOpen && (
                <Modal title="Mieter-Stammdaten bearbeiten" onClose={() => setIsEditTenantOpen(false)}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <Input
                                label="Vorname"
                                value={tenantForm.first_name}
                                onChange={(e) => setTenantForm({ ...tenantForm, first_name: e.target.value })}
                            />
                            <Input
                                label="Nachname"
                                value={tenantForm.last_name}
                                onChange={(e) => setTenantForm({ ...tenantForm, last_name: e.target.value })}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <Input
                                label="Telefon"
                                value={tenantForm.phone}
                                onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })}
                            />
                            <Input
                                label="E-Mail"
                                type="email"
                                value={tenantForm.email}
                                onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
                            />
                        </div>
                        <Input
                            label="Anzahl der Personen"
                            type="number"
                            min="1"
                            value={tenantForm.occupants}
                            onChange={(e) => setTenantForm({ ...tenantForm, occupants: e.target.value })}
                        />

                        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '16px' }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>Kontakt- & Rechnungsadresse (falls abweichend)</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', marginBottom: '12px' }}>
                                <Input
                                    label="Straße"
                                    value={tenantForm.street}
                                    onChange={(e) => setTenantForm({ ...tenantForm, street: e.target.value })}
                                />
                                <Input
                                    label="Hausnummer"
                                    value={tenantForm.house_number}
                                    onChange={(e) => setTenantForm({ ...tenantForm, house_number: e.target.value })}
                                />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                                <Input
                                    label="PLZ"
                                    value={tenantForm.postal_code}
                                    onChange={(e) => setTenantForm({ ...tenantForm, postal_code: e.target.value })}
                                />
                                <Input
                                    label="Stadt"
                                    value={tenantForm.city}
                                    onChange={(e) => setTenantForm({ ...tenantForm, city: e.target.value })}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                            <Button variant="ghost" onClick={() => setIsEditTenantOpen(false)} disabled={isSaving}>Abbrechen</Button>
                            <Button onClick={handleSaveTenant} disabled={isSaving}>
                                {isSaving ? 'Speichert...' : 'Speichern'}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* EDIT LEASE MODAL */}
            {isEditLeaseOpen && (
                <Modal title="Mietvertrag bearbeiten" onClose={() => setIsEditLeaseOpen(false)}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <Input
                                label="Mietbeginn"
                                type="date"
                                value={leaseForm.start_date}
                                onChange={(e) => setLeaseForm({ ...leaseForm, start_date: e.target.value })}
                            />
                            <Input
                                label="Mietende (optional)"
                                type="date"
                                value={leaseForm.end_date}
                                onChange={(e) => setLeaseForm({ ...leaseForm, end_date: e.target.value })}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Vertragsart</label>
                                <select
                                    value={leaseForm.lease_type}
                                    onChange={(e) => setLeaseForm({ ...leaseForm, lease_type: e.target.value })}
                                    style={{
                                        width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                        backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)'
                                    }}
                                >
                                    <option value="normal">Normalmietvertrag</option>
                                    <option value="staffel">Staffelmietvertrag</option>
                                    <option value="index">Indexmietvertrag</option>
                                </select>
                            </div>
                            <Input
                                label="Kaution (€)"
                                type="number"
                                step="0.01"
                                value={leaseForm.deposit}
                                onChange={(e) => setLeaseForm({ ...leaseForm, deposit: e.target.value })}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                            <Input
                                label="Kaltmiete (€)"
                                type="number"
                                step="0.01"
                                value={leaseForm.cold_rent}
                                onChange={(e) => setLeaseForm({ ...leaseForm, cold_rent: e.target.value })}
                            />
                            <Input
                                label="Nebenkostenvorauszahlung (€)"
                                type="number"
                                step="0.01"
                                value={leaseForm.service_charge}
                                onChange={(e) => setLeaseForm({ ...leaseForm, service_charge: e.target.value })}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <Input
                                label="Heizkostenvorauszahlung (€)"
                                type="number"
                                step="0.01"
                                value={leaseForm.heating_cost}
                                onChange={(e) => setLeaseForm({ ...leaseForm, heating_cost: e.target.value })}
                            />
                            <Input
                                label="Sonstige Nebenkosten (€)"
                                type="number"
                                step="0.01"
                                value={leaseForm.other_costs}
                                onChange={(e) => setLeaseForm({ ...leaseForm, other_costs: e.target.value })}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                            <Input
                                label="Zahltag (Tag im Monat, z.B. 3)"
                                type="number"
                                min="1"
                                max="28"
                                value={leaseForm.payment_due_day}
                                onChange={(e) => setLeaseForm({ ...leaseForm, payment_due_day: e.target.value })}
                            />
                            <Input
                                label="Letzte Mieterhöhung"
                                type="date"
                                value={leaseForm.last_rent_increase}
                                onChange={(e) => setLeaseForm({ ...leaseForm, last_rent_increase: e.target.value })}
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                            <Button variant="ghost" onClick={() => setIsEditLeaseOpen(false)} disabled={isSaving}>Abbrechen</Button>
                            <Button onClick={handleSaveLease} disabled={isSaving}>
                                {isSaving ? 'Speichert...' : 'Speichern'}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* CREATE TICKET MODAL */}
            {isTicketModalOpen && (
                <Modal title="Support-Ticket erstellen" onClose={() => setIsTicketModalOpen(false)}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
                        <Input
                            label="Titel / Betreff"
                            placeholder="z.B. Heizung im Wohnzimmer defekt"
                            value={ticketForm.title}
                            onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Beschreibung</label>
                            <textarea
                                placeholder="Genaue Beschreibung des Problems..."
                                value={ticketForm.description}
                                onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
                                style={{
                                    width: '100%', height: '100px', padding: '10px 12px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                    backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontFamily: 'inherit',
                                    resize: 'vertical'
                                }}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Priorität</label>
                                <select
                                    value={ticketForm.priority}
                                    onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                                    style={{
                                        width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                        backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)'
                                    }}
                                >
                                    <option value="low">Niedrig</option>
                                    <option value="medium">Mittel</option>
                                    <option value="high">Hoch</option>
                                </select>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Kategorie</label>
                                <select
                                    value={ticketForm.category}
                                    onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })}
                                    style={{
                                        width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)', outline: 'none', fontSize: '0.9rem',
                                        backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)'
                                    }}
                                >
                                    <option value="repair">Reparatur</option>
                                    <option value="billing">Nebenkosten/Abrechnung</option>
                                    <option value="administrative">Verwaltung</option>
                                    <option value="other">Sonstiges</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                            <Button variant="ghost" onClick={() => setIsTicketModalOpen(false)} disabled={isSaving}>Abbrechen</Button>
                            <Button onClick={handleCreateTicket} disabled={isSaving}>
                                {isSaving ? 'Erstellt...' : 'Ticket erstellen'}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

        </div>
    );
};

export default TenantDetail;
