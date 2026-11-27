import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { Plus, Loader2, Trash2, Eye, Filter, Home, Key, AlertCircle, Edit, MoreVertical, ChevronDown, ChevronRight, FileText, Clock, TrendingUp, UserPlus, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../context/PermissionContext';
import { translateError } from '../lib/errorTranslator';
import { useSubscription } from '../context/SubscriptionContext';
import ExportDropdown from '../components/ExportDropdown';
import {
    localISODate, formatDateDE, isValidISODate, getLeaseTimeState, sumRent,
    checkLeaseDeletion, describeDeletionBlock, deletionConfirmText, translateLeaseDeleteError,
    findOverlappingLeases, describeLease, buildTemplateTenantData
} from '../lib/leaseRentPeriods';

import LoadingOverlay from '../components/ui/LoadingOverlay';

const EMPTY_TENANT_FORM = { first_name: '', last_name: '', email: '', phone: '', occupants: 1 };
const EMPTY_LEASE_FORM = {
    property_id: '',
    unit_id: '',
    start_date: '',
    end_date: '',
    cold_rent: '',
    service_charge: '',
    heating_cost: '',
    other_costs: '',
    deposit: '',
    payment_due_day: 3,
    lease_type: 'normal'
};

// Abfragen mit vielen IDs in Blöcken (URL-Länge, Zeilengrenze von PostgREST)
const CHUNK_SIZE = 100;
const fetchInChunks = async (ids, fetchChunk) => {
    const rows = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const { data, error } = await fetchChunk(ids.slice(i, i + CHUNK_SIZE));
        if (error) throw error;
        rows.push(...(data || []));
    }
    return rows;
};

const byStart = (a, b) => (a.start_date || '').localeCompare(b.start_date || '');

const badgeBaseStyle = (compact) => ({
    padding: compact ? '2px 8px' : '4px 8px',
    borderRadius: '12px',
    fontSize: compact ? '0.7rem' : '0.75rem',
    fontWeight: 600,
    display: compact ? 'flex' : 'inline-flex',
    alignItems: 'center',
    gap: '4px'
});

const StatusBadge = ({ row, compact = false }) => {
    const iconSize = compact ? 10 : 12;
    const base = badgeBaseStyle(compact);
    const lease = row.activeLease;

    if (row.status === 'vacation_rental') {
        return <span style={{ ...base, backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary-color)' }}><Home size={iconSize} /> Ferienwohnung</span>;
    }
    if (row.status === 'rented') {
        return (
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ ...base, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)' }}><Key size={iconSize} /> Vermietet</span>
                {lease?.end_date && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--warning-color)', fontWeight: 600 }}>gekündigt zum {formatDateDE(lease.end_date)}</span>
                )}
            </span>
        );
    }
    if (row.status === 'reserved' || row.status === 'future') {
        return (
            <span style={{ ...base, backgroundColor: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent-color, #7c3aed)' }}>
                <Clock size={iconSize} /> {row.status === 'reserved' ? 'Künftig vermietet' : 'Nachmieter'} ab {formatDateDE(lease?.start_date)}
            </span>
        );
    }
    if (row.status === 'ended') {
        return <span style={{ ...base, backgroundColor: 'rgba(107, 114, 128, 0.1)', color: '#6b7280' }}><AlertCircle size={iconSize} /> Beendet</span>;
    }
    return <span style={{ ...base, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)' }}><AlertCircle size={iconSize} /> Leerstand</span>;
};

const EXPORT_STATUS_LABELS = {
    rented: 'Vermietet',
    reserved: 'Künftig vermietet',
    future: 'Künftiger Vertrag',
    ended: 'Beendet',
    vacation_rental: 'Ferienwohnung',
    vacant: 'Leerstand'
};

const Tenants = () => {
    const { user, userRole } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const location = useLocation();
    const navigate = useNavigate();
    const { checkGlobalAccess } = useSubscription();
    const perm = usePermission();

    // Schreibrechte für Freigabe-Nutzer (bezogen auf das Portfolio des Datensatzes;
    // die Datenbank prüft zusätzlich per RLS)
    const canWriteLeases = (portfolioId) => {
        if (!perm || perm.loadingPermissions) return true;
        return portfolioId ? perm.canWrite('mietverhaeltnisse', portfolioId) : perm.canWrite('mietverhaeltnisse');
    };

    // Process URL Params & State
    useEffect(() => {
        if (location.state?.filter) {
            setFilterStatus(location.state.filter);
            // Clear state so it doesn't persist on reload
            navigate(location.pathname, { replace: true, state: {} });
        }

        const params = new URLSearchParams(location.search);
        const action = params.get('action');
        const propertyId = params.get('propertyId');
        const unitId = params.get('unitId');

        if (action === 'create' && propertyId && unitId) {
            setLeaseForm(prev => ({
                ...prev,
                property_id: propertyId,
                unit_id: unitId
            }));
            setCurrentStep(1); // Start with Tenant creation
            setIsCreateModalOpen(true);
            // Clear URL
            navigate(location.pathname, { replace: true });
        }
    }, [location.search, navigate, location.pathname, location.state]);

    // Data State
    const [allUnits, setAllUnits] = useState([]);
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const requestSeq = useRef(0);

    // Filter State
    const [filterPropertyId, setFilterPropertyId] = useState('');
    const [filterStatus, setFilterStatus] = useState(''); // '' | 'vacant' | 'rented' | 'vacation_rental'
    const [showEndedLeases, setShowEndedLeases] = useState(false);
    const [expandedWEId, setExpandedWEId] = useState(null);

    // Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [currentStep, setCurrentStep] = useState(1); // 1: Tenant, 2: Lease
    const [createdTenantId, setCreatedTenantId] = useState(null);
    const [isVacationRentalToggle, setIsVacationRentalToggle] = useState(false);

    // Action menu
    const [openActionMenuId, setOpenActionMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const [selectedActionRow, setSelectedActionRow] = useState(null);

    // Form Data
    const [tenantForm, setTenantForm] = useState(EMPTY_TENANT_FORM);
    const [leaseForm, setLeaseForm] = useState(EMPTY_LEASE_FORM);

    // Helper Data for Dropdowns
    const [propertiesDropdown, setPropertiesDropdown] = useState([]);
    const [unitsDropdown, setUnitsDropdown] = useState([]);
    const [unitsDropdownError, setUnitsDropdownError] = useState(null);

    const urlUnitId = new URLSearchParams(location.search).get('unitId');

    // Daten einmal je Portfolio laden; Filter werden lokal angewendet
    const fetchData = async () => {
        const seq = ++requestSeq.current;
        try {
            setLoading(true);
            setLoadError(null);

            // 1. Properties (Filter & Dropdown)
            const { data: propsData, error: propsError } = await supabase
                .from('properties')
                .select('id, street, house_number, zip, city, portfolio_id, economic_unit_id, object_key')
                .order('street');
            if (propsError) throw propsError;

            const allProps = propsData || [];
            const viewProps = selectedPortfolioID
                ? allProps.filter(p => p.portfolio_id === selectedPortfolioID)
                : allProps;

            const viewPropIds = viewProps.map(p => p.id);
            let unitsData = [];
            let leasesData = [];

            if (viewPropIds.length > 0) {
                // 2. Units with Property info
                unitsData = await fetchInChunks(viewPropIds, (ids) => supabase
                    .from('units')
                    .select('*, property:properties(*)')
                    .in('property_id', ids));

                // 3. Leases (inkl. Historie) for these units
                const unitIds = unitsData.map(u => u.id);
                if (unitIds.length > 0) {
                    leasesData = await fetchInChunks(unitIds, (ids) => supabase
                        .from('leases')
                        .select('*, tenant:tenants(*)')
                        .in('unit_id', ids));
                }
            }

            if (seq !== requestSeq.current) return; // veraltete Antwort verwerfen

            const today = localISODate();

            // Status nachziehen: Vertragsende abgelaufen -> beendet (bis dahin bleibt der Vertrag aktiv)
            const expired = leasesData.filter(l =>
                l.status === 'active' && l.end_date && l.end_date < today &&
                canWriteLeases(unitsData.find(u => u.id === l.unit_id)?.property?.portfolio_id)
            );
            if (expired.length > 0) {
                const { data: updated, error: statusError } = await supabase
                    .from('leases')
                    .update({ status: 'ended' })
                    .in('id', expired.map(l => l.id))
                    .select('id');
                if (!statusError) {
                    const updatedIds = new Set((updated || []).map(r => r.id));
                    leasesData = leasesData.map(l => (updatedIds.has(l.id) ? { ...l, status: 'ended' } : l));
                }
            }

            // 4. Merge: Laufzeit-Status ausschließlich aus den Daten (Beginn/Ende) ableiten
            const mergedUnits = unitsData.map(unit => {
                const unitLeases = leasesData.filter(l => l.unit_id === unit.id);
                const runningLeases = unitLeases.filter(l => getLeaseTimeState(l, today) === 'running').sort(byStart);
                const futureLeases = unitLeases.filter(l => getLeaseTimeState(l, today) === 'future').sort(byStart);
                const endedLeases = unitLeases
                    .filter(l => getLeaseTimeState(l, today) === 'ended')
                    .sort((a, b) => (b.end_date || b.start_date || '').localeCompare(a.end_date || a.start_date || ''));

                const currentLease = runningLeases[0] || null;
                const nextLease = futureLeases[0] || null;

                return {
                    ...unit,
                    activeLease: currentLease || nextLease,
                    runningLeases,
                    futureLeases,
                    endedLeases,
                    status: unit.is_vacation_rental
                        ? 'vacation_rental'
                        : (currentLease ? 'rented' : (nextLease ? 'reserved' : 'vacant')),
                    propertyLabel: unit.property ? `${unit.property.street} ${unit.property.house_number}` : '–'
                };
            });

            setProperties(viewProps);
            // Einheiten-Auswahl im Assistenten: nur Objekte des gewählten Portfolios
            setPropertiesDropdown(viewProps);
            setAllUnits(mergedUnits);
        } catch (error) {
            if (seq !== requestSeq.current) return;
            console.error('Error fetching tenant data:', error);
            setLoadError(translateError(error));
            setAllUnits([]);
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    };

    // Fetch Units for Dropdown (Create Modal)
    useEffect(() => {
        let cancelled = false;
        const fetchUnitsDropdown = async () => {
            setUnitsDropdownError(null);
            if (!leaseForm.property_id) {
                setUnitsDropdown([]);
                return;
            }
            const { data, error } = await supabase.from('units').select('id, unit_name, target_rent').eq('property_id', leaseForm.property_id).order('unit_name');
            if (cancelled) return;
            if (error) {
                setUnitsDropdownError(translateError(error));
                setUnitsDropdown([]);
                return;
            }
            setUnitsDropdown(data || []);
        };
        fetchUnitsDropdown();
        return () => { cancelled = true; };
    }, [leaseForm.property_id]);

    useEffect(() => {
        if (user && userRole !== 'tenant') fetchData();
    }, [user, userRole, selectedPortfolioID]);

    // Filter (lokal, ohne Neuladen)
    const propertyFilteredUnits = useMemo(() => allUnits.filter(u =>
        (!filterPropertyId || u.property_id === filterPropertyId) &&
        (!urlUnitId || u.id === urlUnitId)
    ), [allUnits, filterPropertyId, urlUnitId]);

    // KPIs vor dem Statusfilter
    const stats = useMemo(() => ({
        total: propertyFilteredUnits.length,
        rented: propertyFilteredUnits.filter(u => u.status === 'rented').length,
        vacant: propertyFilteredUnits.filter(u => u.status === 'vacant' || u.status === 'reserved').length,
        reserved: propertyFilteredUnits.filter(u => u.status === 'reserved').length,
        vacation: propertyFilteredUnits.filter(u => u.status === 'vacation_rental').length
    }), [propertyFilteredUnits]);

    const units = useMemo(() => {
        if (filterStatus === 'vacant') return propertyFilteredUnits.filter(u => u.status === 'vacant' || u.status === 'reserved');
        if (filterStatus === 'rented') return propertyFilteredUnits.filter(u => u.status === 'rented');
        if (filterStatus === 'vacation_rental') return propertyFilteredUnits.filter(u => u.status === 'vacation_rental');
        return propertyFilteredUnits;
    }, [propertyFilteredUnits, filterStatus]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const targetUnitId = params.get('unitId');
        const action = params.get('action');
        if (targetUnitId && action !== 'create' && allUnits.length > 0) {
            const targetUnit = allUnits.find(u => u.id === targetUnitId);
            if (targetUnit && targetUnit.activeLease) {
                navigate(`/tenants/${targetUnit.activeLease.id}`, { replace: true });
            }
        }
    }, [location.search, allUnits, navigate]);

    // Handlers
    const resetForms = () => {
        setTenantForm(EMPTY_TENANT_FORM);
        setLeaseForm(EMPTY_LEASE_FORM);
        setCurrentStep(1);
        setCreatedTenantId(null);
        setIsVacationRentalToggle(false);
    };

    const openCreateWizard = (prefill = {}) => {
        if (!checkGlobalAccess()) return;
        resetForms();
        setLeaseForm({ ...EMPTY_LEASE_FORM, ...prefill });
        setIsCreateModalOpen(true);
    };

    // Abbrechen des Assistenten: in Schritt 1 angelegten Mieter ohne Vertrag nicht verwaist zurücklassen
    const handleCloseCreateModal = async () => {
        if (isSaving) return;
        if (currentStep === 2 && createdTenantId) {
            const name = `${tenantForm.first_name} ${tenantForm.last_name}`.trim() || 'Der Mieter';
            if (window.confirm(`${name} wurde in Schritt 1 bereits gespeichert, hat aber noch keinen Mietvertrag.\n\nSoll der Mieter wieder gelöscht werden?\n(OK = löschen, Abbrechen = Mieter behalten)`)) {
                try {
                    setIsSaving(true);
                    const { count: leaseCount, error: countError } = await supabase
                        .from('leases')
                        .select('id', { count: 'exact', head: true })
                        .eq('tenant_id', createdTenantId);
                    if (countError) throw countError;
                    if ((leaseCount || 0) === 0) {
                        // automatisch angelegten Kontakt zum Mieter mit entfernen
                        await supabase.from('contacts').delete().eq('tenant_id', createdTenantId);
                        const { data: deleted, error: delError } = await supabase
                            .from('tenants')
                            .delete()
                            .eq('id', createdTenantId)
                            .select('id');
                        if (delError) throw delError;
                        if (!deleted || deleted.length === 0) throw new Error('Keine Berechtigung, den Mieter zu löschen.');
                    }
                } catch (err) {
                    alert('Der Mieter konnte nicht gelöscht werden: ' + translateError(err) + '\nSie finden ihn unter Kontakte.');
                } finally {
                    setIsSaving(false);
                }
            }
        }
        setIsCreateModalOpen(false);
        resetForms();
    };

    const handleSetVacationRental = async () => {
        if (!leaseForm.unit_id) return alert('Keine Einheit ausgewählt.');
        try {
            setIsSaving(true);
            const { error } = await supabase.from('units').update({
                is_vacation_rental: true,
                cold_rent_ist: leaseForm.cold_rent || null
            }).eq('id', leaseForm.unit_id);
            if (error) throw error;
            setIsCreateModalOpen(false);
            resetForms();
            fetchData();
        } catch (err) {
            alert(translateError(err));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateTenant = async () => {
        // Frontend-Validierung
        if (!tenantForm.first_name.trim()) return alert('Bitte geben Sie den Vornamen ein.');
        if (!tenantForm.last_name.trim()) return alert('Bitte geben Sie den Nachnamen ein.');
        try {
            setIsSaving(true);
            const { data, error } = await supabase.from('tenants').insert([
                {
                    user_id: user.id,
                    first_name: tenantForm.first_name.trim(),
                    last_name: tenantForm.last_name.trim(),
                    email: tenantForm.email,
                    phone: tenantForm.phone,
                    occupants: parseInt(tenantForm.occupants) || 1
                }
            ]).select();

            if (error) throw error;

            if (data && data.length > 0) {
                setCreatedTenantId(data[0].id);
                setCurrentStep(2);
            } else {
                throw new Error('Der Mieter wurde nicht gespeichert (keine Berechtigung).');
            }
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateLease = async () => {
        // Frontend-Validierung
        if (!leaseForm.property_id) return alert('Bitte wählen Sie eine Immobilie aus.');
        if (!leaseForm.unit_id) return alert('Bitte wählen Sie eine Einheit aus.');
        if (!isValidISODate(leaseForm.start_date)) return alert('Bitte geben Sie ein gültiges Mietbeginn-Datum ein.');
        if (leaseForm.end_date && !isValidISODate(leaseForm.end_date)) return alert('Bitte geben Sie ein gültiges Mietende-Datum ein.');
        if (leaseForm.end_date && leaseForm.end_date < leaseForm.start_date) return alert('Das Mietende darf nicht vor dem Mietbeginn liegen.');
        if (!leaseForm.cold_rent) return alert('Bitte geben Sie die Kaltmiete ein.');
        if (!createdTenantId) return alert('Kein Mieter erstellt.');

        const coldRent = parseFloat(leaseForm.cold_rent) || 0;
        const serviceCharge = parseFloat(leaseForm.service_charge) || 0;
        const heatingCost = parseFloat(leaseForm.heating_cost) || 0;
        const otherCosts = parseFloat(leaseForm.other_costs) || 0;
        const deposit = parseFloat(leaseForm.deposit) || 0;
        const paymentDueDay = parseInt(leaseForm.payment_due_day, 10);

        if ([coldRent, serviceCharge, heatingCost, otherCosts, deposit].some(v => v < 0)) return alert('Beträge dürfen nicht negativ sein.');
        if (!paymentDueDay || paymentDueDay < 1 || paymentDueDay > 28) return alert('Bitte einen Zahltag zwischen 1 und 28 angeben (Kalendertag im Monat).');
        if (deposit > 0 && coldRent > 0 && deposit > coldRent * 3 + 0.005) {
            if (!window.confirm(
                'Hinweis: Die Kaution übersteigt drei Monatskaltmieten. Nach § 551 BGB darf die Mietsicherheit höchstens ' +
                'das Dreifache der Nettokaltmiete betragen.\n\nTrotzdem speichern?'
            )) return;
        }

        try {
            setIsSaving(true);

            // Kein zweiter Vertrag für denselben Zeitraum (laufend oder künftig)
            const { error: overlapError, overlaps } = await findOverlappingLeases({
                unitId: leaseForm.unit_id,
                startDate: leaseForm.start_date,
                endDate: leaseForm.end_date || null
            });
            if (overlapError) throw overlapError;
            if (overlaps.length > 0) {
                alert(
                    'Für diese Einheit besteht im gewählten Zeitraum bereits ein Mietvertrag:\n\n' +
                    overlaps.map(describeLease).join('\n') +
                    '\n\nBitte beenden Sie zuerst den bestehenden Vertrag oder wählen Sie einen Mietbeginn nach dessen Ende.'
                );
                return;
            }

            // 1. Create Lease
            const newLease = {
                user_id: user.id,
                tenant_id: createdTenantId,
                unit_id: leaseForm.unit_id,
                start_date: leaseForm.start_date,
                end_date: leaseForm.end_date || null,
                cold_rent: coldRent,
                service_charge: serviceCharge,
                heating_cost: heatingCost,
                other_costs: otherCosts,
                deposit: deposit,
                payment_due_day: paymentDueDay,
                lease_type: leaseForm.lease_type || 'normal',
                status: leaseForm.end_date && leaseForm.end_date < localISODate() ? 'ended' : 'active'
            };
            const { error: leaseError } = await supabase.from('leases').insert([newLease]);

            if (leaseError) throw leaseError;

            // 2. Einheit nur angleichen, wenn der Vertrag heute läuft
            let unitWarning = null;
            if (getLeaseTimeState(newLease) === 'running') {
                const { error: unitUpdateError } = await supabase.from('units').update({
                    cold_rent_ist: coldRent,
                    service_charge_soll: serviceCharge,
                    heating_cost_soll: heatingCost,
                    other_costs_soll: otherCosts,
                    deposit_soll: deposit
                }).eq('id', leaseForm.unit_id);

                if (unitUpdateError) {
                    console.error('Fehler beim Aktualisieren der Einheit:', unitUpdateError);
                    unitWarning = 'Der Mietvertrag wurde gespeichert, die Werte der Einheit konnten aber nicht angeglichen werden: ' + translateError(unitUpdateError);
                }
            }

            setIsCreateModalOpen(false);
            resetForms();
            fetchData();
            if (unitWarning) alert(unitWarning);
        } catch (error) {
            alert(translateError(error));
        } finally {
            setIsSaving(false);
        }
    };

    // Löschen nur ohne Zahlungen/Forderungen – sonst beenden (Historie bleibt erhalten)
    const handleDeleteLease = async (leaseToDelete) => {
        if (!leaseToDelete) return;
        try {
            setIsSaving(true);
            const info = await checkLeaseDeletion(leaseToDelete.id);
            if (!info.ok) {
                alert('Die Prüfung vor dem Löschen ist fehlgeschlagen: ' + translateError(info.error) + '\n\nDas Mietverhältnis wurde nicht gelöscht.');
                return;
            }
            if (info.blocked) {
                alert(describeDeletionBlock(info));
                return;
            }
            if (!window.confirm(deletionConfirmText(info))) return;

            const { data, error } = await supabase.from('leases').delete().eq('id', leaseToDelete.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Keine Berechtigung, dieses Mietverhältnis zu löschen.');
            fetchData();
        } catch (error) {
            alert('Fehler beim Löschen: ' + translateLeaseDeleteError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const openNachmieterWizard = (row) => {
        const end = row.activeLease?.end_date;
        let start = '';
        if (end && isValidISODate(end)) {
            const [y, m, d] = end.split('-').map(Number);
            start = localISODate(new Date(y, m - 1, d + 1));
        }
        openCreateWizard({ property_id: row.property_id, unit_id: row.id, start_date: start });
    };

    // Columns
    const columns = [
        {
            header: 'Objekt',
            accessor: 'property',
            render: (row) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{row.property?.street} {row.property?.house_number}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.property?.city}</div>
                </div>
            )
        },
        {
            header: 'Einheit',
            accessor: 'unit_name',
            render: (row) => <span style={{ fontWeight: 600 }}>{row.unit_name}</span>
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => <StatusBadge row={row} />
        },
        {
            header: 'Mieter',
            accessor: 'tenant',
            render: (row) => row.activeLease ? (
                <div>
                    <div>{row.activeLease.tenant?.last_name}, {row.activeLease.tenant?.first_name}</div>
                </div>
            ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>
        },
        {
            header: 'Laufzeit',
            accessor: 'duration',
            render: (row) => row.activeLease ? (
                <div style={{ fontSize: '0.85rem' }}>
                    {formatDateDE(row.activeLease.start_date)} — {row.activeLease.end_date ? formatDateDE(row.activeLease.end_date) : 'Unbefristet'}
                </div>
            ) : <span style={{ color: 'var(--text-secondary)' }}>—</span>
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => row.activeLease ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        if (openActionMenuId === row.id) {
                            setOpenActionMenuId(null);
                            setSelectedActionRow(null);
                        } else {
                            const spaceBelow = window.innerHeight - rect.bottom;
                            const openUp = spaceBelow < 260;
                            setMenuPos({
                                top: openUp ? rect.top : rect.bottom + 4,
                                left: rect.left,
                                openUp
                            });
                            setSelectedActionRow(row);
                            setOpenActionMenuId(row.id);
                        }
                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <MoreVertical size={18} />
                    </button>
                </div>
            ) : row.status === 'vacation_rental' ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontStyle: 'italic' }}>Ferienwohnung</span>
                </div>
            ) : canWriteLeases(row.property?.portfolio_id) ? (
                <Button variant="secondary" size="sm" icon={Plus} onClick={() => openCreateWizard({ property_id: row.property_id, unit_id: row.id })}>Vermieten</Button>
            ) : null
        }
    ];

    // Angezeigte Zeilen: je Einheit der laufende (bzw. nächste) Vertrag, dazu immer weitere
    // laufende und künftige Verträge (Nachmieter, Doppelbelegung) und optional beendete
    const displayedUnits = useMemo(() => {
        const disp = [];
        units.forEach(u => {
            disp.push(u);
            const extraRunning = (u.runningLeases || []).slice(1);
            const extraFuture = u.status === 'reserved' ? (u.futureLeases || []).slice(1) : (u.futureLeases || []);
            extraRunning.forEach(l => disp.push({ ...u, id: `${u.id}-${l.id}`, activeLease: l, status: 'rented', isExtraRow: true }));
            extraFuture.forEach(l => disp.push({ ...u, id: `${u.id}-${l.id}`, activeLease: l, status: 'future', isExtraRow: true }));
            if (showEndedLeases) {
                (u.endedLeases || []).forEach(el => disp.push({ ...u, id: `${u.id}-${el.id}`, activeLease: el, status: 'ended', isExtraRow: true }));
            }
        });
        return disp;
    }, [units, showEndedLeases]);

    // Group displayedUnits by Property (Objekt)
    const groupedUnits = useMemo(() => {
        const groups = {};

        displayedUnits.forEach(unit => {
            const p = unit.property;
            const key = p ? p.id : 'no-property';
            if (!groups[key]) {
                groups[key] = {
                    id: key,
                    isGroup: true,
                    street: p ? p.street : 'Keine Immobilie zugeordnet',
                    house_number: p ? (p.house_number || '') : '',
                    city: p ? (p.city || '') : '',
                    units: []
                };
            }
            groups[key].units.push(unit);
        });

        return Object.values(groups).sort((a, b) => a.street.localeCompare(b.street));
    }, [displayedUnits]);

    if (userRole === 'tenant') return <Navigate to="/tenant" replace />;

    if (loading && allUnits.length === 0 && !loadError) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    const canCreate = canWriteLeases(selectedPortfolioID || null);

    const renderMobileCard = (row) => (
        <div key={row.id} style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--spacing-md)',
            backgroundColor: 'var(--surface-color)',
            position: 'relative'
        }}>
            {/* Header: Status and Property */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{row.property?.street} {row.property?.house_number}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {row.property?.city} • {row.unit_name}
                    </div>
                </div>
                <div>
                    <StatusBadge row={row} compact />
                </div>
            </div>

            {/* Tenant Info */}
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mieter</div>
                {row.activeLease ? (
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                        {row.activeLease.tenant?.first_name} {row.activeLease.tenant?.last_name}
                    </div>
                ) : (
                    <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>—</div>
                )}
            </div>

            {/* Lease Info */}
            {row.activeLease && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem', marginBottom: '12px' }}>
                    <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Mietbeginn</div>
                        <div>{formatDateDE(row.activeLease.start_date)}</div>
                    </div>
                    <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Mietende</div>
                        <div>{row.activeLease.end_date ? formatDateDE(row.activeLease.end_date) : 'Unbefristet'}</div>
                    </div>
                    <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Warmmiete</div>
                        <div style={{ fontWeight: 600 }}>
                            {sumRent(row.activeLease).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                        </div>
                    </div>
                    <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Kaution</div>
                        <div>{(parseFloat(row.activeLease.deposit) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
                    </div>
                </div>
            )}

            {/* Actions */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {row.activeLease ? (
                    <>
                        <Button variant="ghost" size="sm" onClick={() => {
                            navigate(`/tenants/${row.activeLease.id}`);
                        }} title="Details anzeigen" style={{ flex: 1 }}>
                            <Eye size={16} style={{ marginRight: '4px' }} /> Details
                        </Button>
                    </>
                ) : row.status !== 'vacation_rental' && canWriteLeases(row.property?.portfolio_id) ? (
                    <Button variant="secondary" size="sm" icon={Plus} onClick={() => openCreateWizard({ property_id: row.property_id, unit_id: row.id })}>Vermieten</Button>
                ) : null}
            </div>
        </div>
    );

    const menuButtonStyle = { textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', color: 'var(--text-primary)', borderRadius: '6px' };
    const closeMenu = () => { setOpenActionMenuId(null); setSelectedActionRow(null); };
    const menuRow = selectedActionRow;
    const menuLease = menuRow?.activeLease;
    const menuCanWrite = menuRow ? canWriteLeases(menuRow.property?.portfolio_id) : false;
    const menuLeaseEnded = menuLease ? getLeaseTimeState(menuLease) === 'ended' : false;
    const menuOffersNachmieter = !!menuRow && menuCanWrite && menuRow.status === 'rented' && !menuRow.isExtraRow &&
        !!menuLease?.end_date && (menuRow.futureLeases || []).length === 0;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Mietverhältnisse</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Übersicht der Einheiten und Auslastung</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ExportDropdown
                        reportType="mietverhaeltnisse"
                        data={displayedUnits.map(u => {
                            const isVacation = u.status === 'vacation_rental';
                            const vacationIncome = u.cold_rent_ist !== null && u.cold_rent_ist !== undefined && u.cold_rent_ist !== ''
                                ? (parseFloat(u.cold_rent_ist) || 0)
                                : '';
                            return {
                                property_id: u.property_id,
                                mietername: isVacation ? 'Ferienwohnung' : (u.activeLease?.tenant ? `${u.activeLease.tenant.last_name}, ${u.activeLease.tenant.first_name}` : '–'),
                                immobilie_einheit: `${u.propertyLabel || ''} / ${u.unit_name || ''}`.trim(),
                                kaltmiete: isVacation ? vacationIncome : (u.activeLease?.cold_rent || 0),
                                nebenkosten: isVacation ? 0 : ((parseFloat(u.activeLease?.service_charge) || 0) + (parseFloat(u.activeLease?.heating_cost) || 0) + (parseFloat(u.activeLease?.other_costs) || 0)),
                                warmmiete: isVacation ? vacationIncome : sumRent(u.activeLease),
                                mietbeginn: isVacation ? '–' : (u.activeLease?.start_date || ''),
                                wohnflaeche: u.sqm || 0,
                                kaution: isVacation ? 0 : (u.activeLease?.deposit || 0),
                                status: EXPORT_STATUS_LABELS[u.status] || 'Leerstand',
                                _propertyLabel: u.propertyLabel || '–',
                            };
                        })}
                        properties={properties.map(p => ({ id: p.id, label: `${p.street} ${p.house_number}` }))}
                        currentFilters={{ property_id: filterPropertyId }}
                        totalRows={displayedUnits.length}
                    />
                    {canCreate && (
                        <Button icon={Plus} onClick={() => openCreateWizard()}>Neuer Mieter</Button>
                    )}
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ marginBottom: 'var(--spacing-lg)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Filter:</span>
                </div>
                <div>
                    <select
                        value={filterPropertyId}
                        onChange={e => setFilterPropertyId(e.target.value)}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '200px' }}
                    >
                        <option value="">Alle Immobilien</option>
                        {properties.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                    </select>
                </div>
                <div>
                    <select
                        value={filterStatus}
                        onChange={e => setFilterStatus(e.target.value)}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', minWidth: '150px' }}
                    >
                        <option value="">Alle Einheiten</option>
                        <option value="rented">Nur Vermietet</option>
                        <option value="vacant">Nur Leerstand</option>
                        <option value="vacation_rental">Nur Ferienwohnungen</option>
                    </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    <input
                        type="checkbox"
                        checked={showEndedLeases}
                        onChange={e => setShowEndedLeases(e.target.checked)}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--primary-color)', cursor: 'pointer' }}
                    />
                    Beendete Mietverhältnisse anzeigen
                </label>
            </div>

            {/* KPIs (unabhängig vom Statusfilter) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-xl)' }}>
                <Card className="kpi-card" onClick={() => setFilterStatus('')} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Gesamt (Einheiten)</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {stats.total}
                            </div>
                        </div>
                        <Home size={28} style={{ color: 'var(--primary-color)', opacity: 0.2 }} />
                    </div>
                </Card>
                <Card className="kpi-card" onClick={() => setFilterStatus('rented')} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Vermietet</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--success-color)' }}>
                                {stats.rented}
                            </div>
                        </div>
                        <Key size={28} style={{ color: 'var(--success-color)', opacity: 0.2 }} />
                    </div>
                </Card>
                <Card className="kpi-card" onClick={() => setFilterStatus('vacant')} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Leerstand</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--danger-color)' }}>
                                {stats.vacant}
                            </div>
                            {stats.reserved > 0 && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>davon {stats.reserved} mit künftigem Vertrag</div>
                            )}
                        </div>
                        <AlertCircle size={28} style={{ color: 'var(--danger-color)', opacity: 0.2 }} />
                    </div>
                </Card>
                {stats.vacation > 0 && (
                    <Card className="kpi-card" onClick={() => setFilterStatus('vacation_rental')} style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>Ferienwohnungen</div>
                                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary-color)' }}>
                                    {stats.vacation}
                                </div>
                            </div>
                            <Home size={28} style={{ color: 'var(--primary-color)', opacity: 0.2 }} />
                        </div>
                    </Card>
                )}
            </div>

            {urlUnitId && (
                <div style={{
                    padding: '10px 16px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 'var(--spacing-md)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.9rem',
                    color: 'var(--text-primary)'
                }}>
                    <span>Gefiltert nach einer bestimmten Einheit aus dem Cockpit.</span>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/tenants', { replace: true })}>
                        Filter aufheben
                    </Button>
                </div>
            )}

            <Card>
                {loadError ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                            <AlertCircle size={18} /> Die Mietverhältnisse konnten nicht geladen werden.
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{loadError}</div>
                        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => fetchData()}>Erneut versuchen</Button>
                    </div>
                ) : units.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Keine Einheiten gefunden.
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile">
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {columns.map((col, index) => (
                                            <th key={index} style={{ textAlign: col.align || 'left', padding: '12px 16px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem', fontWeight: 600 }}>
                                                {col.header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedUnits.map(row => (
                                        <React.Fragment key={row.id}>
                                            <tr style={{ borderBottom: expandedWEId === row.id ? 'none' : '1px solid var(--border-color)', backgroundColor: 'rgba(139, 92, 246, 0.03)', cursor: 'pointer' }} onClick={() => setExpandedWEId(expandedWEId === row.id ? null : row.id)}>
                                                <td colSpan={columns.length} style={{ padding: '12px 16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--accent-color)' }}>
                                                        {expandedWEId === row.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                        {row.street} {row.house_number} ({row.units.filter(u => !u.isExtraRow).length} Einheiten)
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '26px' }}>{row.city}</div>
                                                </td>
                                            </tr>
                                            {expandedWEId === row.id && row.units.map(unit => (
                                                <tr key={unit.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: unit.isExtraRow ? 'rgba(0,0,0,0.025)' : 'rgba(0,0,0,0.01)' }}>
                                                    {columns.map((col, cIndex) => (
                                                        <td key={cIndex} style={{ textAlign: col.align || 'left', padding: '12px 16px', paddingLeft: cIndex === 0 ? (unit.isExtraRow ? '58px' : '42px') : '16px' }}>
                                                            {col.render ? col.render(unit) : unit[col.accessor]}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {groupedUnits.map(row => (
                                <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div
                                        onClick={() => setExpandedWEId(expandedWEId === row.id ? null : row.id)}
                                        style={{ padding: '12px', backgroundColor: 'rgba(139, 92, 246, 0.05)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--accent-color)' }}
                                    >
                                        {expandedWEId === row.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                        <div>
                                            <div>{row.street} {row.house_number}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{row.units.filter(u => !u.isExtraRow).length} Einheiten</div>
                                        </div>
                                    </div>
                                    {expandedWEId === row.id && row.units.map(unit => renderMobileCard(unit))}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Card>

            {/* Create Wizard Modal */}
            <Modal
                isOpen={isCreateModalOpen}
                onClose={handleCloseCreateModal}
                title={currentStep === 1 ? "Schritt 1: Mieter erfassen" : "Schritt 2: Mietvertrag anlegen"}
                footer={
                    <>
                        <Button variant="secondary" onClick={handleCloseCreateModal} disabled={isSaving}>Abbrechen</Button>
                        {currentStep === 1 ? (
                            isVacationRentalToggle ? (
                                <Button onClick={handleSetVacationRental} disabled={isSaving}>Als Ferienwohnung speichern</Button>
                            ) : (
                                <Button onClick={handleCreateTenant} disabled={isSaving}>Weiter zu Mietvertrag</Button>
                            )
                        ) : (
                            <Button onClick={handleCreateLease} disabled={isSaving}>Speichern</Button>
                        )}
                    </>
                }
            >
                {isSaving && <LoadingOverlay message="Speichere Daten..." />}
                {currentStep === 1 && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        {leaseForm.unit_id && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary-color)' }}>
                                <input type="checkbox" checked={isVacationRentalToggle} onChange={e => setIsVacationRentalToggle(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--primary-color)' }} />
                                <span style={{ fontWeight: 600, color: 'var(--primary-color)' }}>Diese Einheit als Ferienwohnung nutzen</span>
                            </label>
                        )}
                        {isVacationRentalToggle && leaseForm.unit_id ? (
                            <CurrencyInput label="Monatliche Einnahmen (Kaltmiete Ist) €" allowDecimals value={leaseForm.cold_rent} onChange={e => setLeaseForm({ ...leaseForm, cold_rent: e.target.value })} />
                        ) : (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                                    <Input label="Vorname" value={tenantForm.first_name} onChange={e => setTenantForm({ ...tenantForm, first_name: e.target.value })} />
                                    <Input label="Nachname" value={tenantForm.last_name} onChange={e => setTenantForm({ ...tenantForm, last_name: e.target.value })} />
                                </div>
                                <Input label="E-Mail" type="email" value={tenantForm.email} onChange={e => setTenantForm({ ...tenantForm, email: e.target.value })} />
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--spacing-md)' }}>
                                    <Input label="Telefon" value={tenantForm.phone} onChange={e => setTenantForm({ ...tenantForm, phone: e.target.value })} />
                                    <Input label="Personen" type="number" value={tenantForm.occupants} onChange={e => setTenantForm({ ...tenantForm, occupants: e.target.value })} />
                                </div>
                            </>
                        )}
                    </div>
                )}

                {currentStep === 2 && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Immobilie</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={leaseForm.property_id}
                                    onChange={e => setLeaseForm({ ...leaseForm, property_id: e.target.value, unit_id: '' })}
                                >
                                    <option value="">Wählen...</option>
                                    {propertiesDropdown.map(p => <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Einheit</label>
                                <select
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                    value={leaseForm.unit_id}
                                    onChange={e => setLeaseForm({ ...leaseForm, unit_id: e.target.value })}
                                    disabled={!leaseForm.property_id}
                                >
                                    <option value="">Wählen...</option>
                                    {unitsDropdown.map(u => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                                </select>
                                {unitsDropdownError && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--danger-color)', marginTop: '4px' }}>Einheiten konnten nicht geladen werden: {unitsDropdownError}</div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Mietbeginn" type="date" value={leaseForm.start_date} onChange={e => setLeaseForm({ ...leaseForm, start_date: e.target.value })} />
                            <Input label="Mietende (optional)" type="date" min={leaseForm.start_date || undefined} value={leaseForm.end_date} onChange={e => setLeaseForm({ ...leaseForm, end_date: e.target.value })} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Vertragsart</label>
                            <select
                                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}
                                value={leaseForm.lease_type}
                                onChange={e => setLeaseForm({ ...leaseForm, lease_type: e.target.value })}
                            >
                                <option value="normal">Unbefristeter Normalmietvertrag</option>
                                <option value="staffel">Staffelmietvertrag</option>
                                <option value="index">Indexmietvertrag</option>
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input label="Kaltmiete Soll (Einheit)" value={unitsDropdown.find(u => u.id === leaseForm.unit_id)?.target_rent || ''} readOnly />
                            <CurrencyInput label="Kaltmiete (Vertrag) (€)" allowDecimals value={leaseForm.cold_rent} onChange={e => setLeaseForm({ ...leaseForm, cold_rent: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Nebenkosten (€)" allowDecimals value={leaseForm.service_charge} onChange={e => setLeaseForm({ ...leaseForm, service_charge: e.target.value })} />
                            <CurrencyInput label="Heizkosten (€)" allowDecimals value={leaseForm.heating_cost} onChange={e => setLeaseForm({ ...leaseForm, heating_cost: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <CurrencyInput label="Sonstige Kosten (€)" allowDecimals value={leaseForm.other_costs} onChange={e => setLeaseForm({ ...leaseForm, other_costs: e.target.value })} />
                            <CurrencyInput label="Kaution (€)" allowDecimals value={leaseForm.deposit} onChange={e => setLeaseForm({ ...leaseForm, deposit: e.target.value })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                            <Input
                                label="Zahltag (Kalendertag 1–28)"
                                type="number"
                                min="1"
                                max="28"
                                value={leaseForm.payment_due_day}
                                onChange={e => {
                                    let val = parseInt(e.target.value);
                                    if (isNaN(val)) val = '';
                                    else if (val > 28) val = 28;
                                    else if (val < 1) val = 1;
                                    setLeaseForm({ ...leaseForm, payment_due_day: val });
                                }}
                            />
                            <div></div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Action Dropdown Menu — rendered via Portal to avoid overflow clipping from Table */}
            {openActionMenuId && menuRow && menuLease && createPortal(
                <>
                    <div onClick={closeMenu} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
                    <div style={{
                        position: 'fixed',
                        top: menuPos.openUp ? 'auto' : menuPos.top,
                        bottom: menuPos.openUp ? `${window.innerHeight - menuPos.top}px` : 'auto',
                        left: menuPos.left,
                        transform: 'translateX(-100%)',
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                        zIndex: 9999,
                        minWidth: '200px',
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '4px'
                    }}>
                        <button
                            style={menuButtonStyle}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                            onClick={() => {
                                const id = menuLease.id;
                                closeMenu();
                                navigate(`/tenants/${id}`);
                            }}
                        >
                            <Eye size={14} /> Details
                        </button>
                        {menuCanWrite && !menuLeaseEnded && (
                            <>
                                <button
                                    style={menuButtonStyle}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                    onClick={() => {
                                        const id = menuLease.id;
                                        closeMenu();
                                        navigate(`/tenants/${id}`, { state: { openEditLease: true } });
                                    }}
                                >
                                    <Edit size={14} /> Vertragsdaten bearbeiten
                                </button>
                                <button
                                    style={menuButtonStyle}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                    onClick={() => {
                                        const id = menuLease.id;
                                        closeMenu();
                                        navigate(`/tenants/${id}`, { state: { openRentChange: true } });
                                    }}
                                >
                                    <TrendingUp size={14} /> Mietänderung ab Datum
                                </button>
                            </>
                        )}
                        <button
                            style={menuButtonStyle}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                            onClick={() => {
                                const tenantData = buildTemplateTenantData({
                                    lease: menuLease,
                                    tenant: menuLease.tenant,
                                    unit: menuRow,
                                    property: menuRow.property
                                });
                                closeMenu();
                                // Öffnet den Schreibvorlagen-Manager mit den ECHTEN Daten dieses Mietverhältnisses.
                                // Dort wählt der Nutzer die Vorlage (Vertrag/Mieterhöhung/Bescheinigung/...) und druckt.
                                navigate('/settings', { state: { activeTab: 'document-templates', tenant: tenantData } });
                            }}
                        >
                            <FileText size={14} /> Dokument erstellen
                        </button>
                        {menuOffersNachmieter && (
                            <button
                                style={menuButtonStyle}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--background-color)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                onClick={() => {
                                    const row = menuRow;
                                    closeMenu();
                                    openNachmieterWizard(row);
                                }}
                            >
                                <UserPlus size={14} /> Nachmieter anlegen
                            </button>
                        )}
                        {menuCanWrite && (
                            <>
                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                <button
                                    style={{ ...menuButtonStyle, color: 'var(--danger-color)' }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.06)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                    onClick={() => {
                                        const leaseToDelete = menuLease;
                                        closeMenu();
                                        handleDeleteLease(leaseToDelete);
                                    }}
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
    );
};

export default Tenants;
