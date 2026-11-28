import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
    Home, FileText, Euro, Calendar, MapPin,
    Building2, DoorOpen, Phone, Mail, Clock,
    AlertCircle, CheckCircle2, TicketCheck,
    Trash2, Sparkles, Brush
} from 'lucide-react';

const isActiveStatus = (status) => ['active', 'aktiv'].includes(String(status || '').toLowerCase());

// Lokales Datum (nicht UTC) als YYYY-MM-DD
const localDateString = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD' als lokales Datum parsen (new Date('YYYY-MM-DD') wäre UTC-Mitternacht)
const parseLocalDate = (value) => {
    if (!value) return null;
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const [y, m, d] = str.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
};

const TenantDashboard = () => {
    const { user, roleData } = useAuth();
    const [leases, setLeases] = useState([]);
    const [leaseNotice, setLeaseNotice] = useState(null);
    const [unit, setUnit] = useState(null);
    const [property, setProperty] = useState(null);
    const [tenant, setTenant] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [nextWaste, setNextWaste] = useState(null);
    const [nextTask, setNextTask] = useState(null);
    const [nextCleaning, setNextCleaning] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    // Teilfehler (Tickets/Kalender) – die übrige Seite bleibt sichtbar
    const [ticketsError, setTicketsError] = useState(false);
    const [calendarError, setCalendarError] = useState(false);
    const [noTenancy, setNoTenancy] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const fetchData = async () => {

            if (!user) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setLoadError(null);
                setTicketsError(false);
                setCalendarError(false);
                setNoTenancy(false);

                let unitId = roleData?.unit_id;
                let propertyId = roleData?.property_id;

                // 1. Eingeschränkte Mieter-Sicht über die Datenbank-Funktion – nur Adresse/Bezeichnung/Fläche
                //    von Objekt und Einheit, keine Vermieter-internen Objektdaten. Keine direkten Abfragen
                //    auf properties/units mehr (die zeilenweisen Mieter-Freigaben dort entfallen).
                const { data: tenancy, error: tenancyError } = await supabase.rpc('get_my_tenancy');
                if (tenancyError) throw tenancyError;
                if (!tenancy) {
                    setNoTenancy(true);
                    return;
                }
                unitId = tenancy.unit_id || unitId;
                propertyId = tenancy.property_id || propertyId;
                const leaseList = tenancy.leases || [];
                const tenantRow = tenancy.tenant || null;
                const roleUnit = tenancy.role_unit || null;

                // 2. Laufende Verträge (alle, z. B. Wohnung + Stellplatz); sonst letzter Vertrag mit Hinweis
                const byStartDesc = (a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''));
                let shownLeases = leaseList.filter(l => isActiveStatus(l.status)).sort(byStartDesc);
                let notice = null;
                if (shownLeases.length === 0 && leaseList.length > 0) {
                    const latest = [...leaseList].sort(byStartDesc)[0];
                    shownLeases = [latest];
                    const endDate = parseLocalDate(latest.end_date);
                    const endInfo = latest.end_date ? `, Mietende ${endDate ? endDate.toLocaleDateString('de-DE') : latest.end_date}` : '';
                    notice = `Kein laufender Mietvertrag gefunden. Angezeigt wird Ihr letzter Vertrag (Status: ${latest.status || 'unbekannt'}${endInfo}).`;
                } else if (shownLeases.length > 1) {
                    notice = `Sie haben ${shownLeases.length} laufende Mietverträge – die Beträge sind zusammengerechnet.`;
                }

                const primaryUnit = shownLeases[0]?.unit || roleUnit || null;
                setLeases(shownLeases);
                setLeaseNotice(notice);
                setUnit(primaryUnit);
                setProperty(primaryUnit?.property || null);
                setTenant(tenantRow);

                // Objekt/Einheit für den Kalender aus der Mieterrolle (wie Objektkalender-Seite und die
                // Kalender-Freigabe in der Datenbank, die das Objekt der Rolle prüft – nicht das des
                // Vertrags, z. B. nach einem Umzug). Vertragsobjekt/-einheit nur, wenn die Rolle keins hat.
                const leasePropertyId = primaryUnit?.property?.id || primaryUnit?.property_id || null;
                if (!propertyId) propertyId = leasePropertyId;
                if (!unitId && primaryUnit?.id && leasePropertyId === propertyId) unitId = primaryUnit.id;

                // Fetch recent tickets
                const { data: ticketData, error: ticketError } = await supabase
                    .from('tickets')
                    .select('id, title, status, created_at')
                    .eq('tenant_user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(5);
                if (ticketError) {
                    console.error('Tickets konnten nicht geladen werden:', ticketError);
                    setTicketsError(true);
                }
                setTickets(ticketData || []);

                // Fetch next calendar events
                const todayStr = localDateString();
                setNextWaste(null);
                setNextCleaning(null);
                setNextTask(null);
                if (propertyId) {
                    const reportCalendarError = (err) => {
                        console.error('Objektkalender konnte nicht geladen werden:', err);
                        setCalendarError(true);
                    };

                    // Next waste pickup
                    const { data: wasteData, error: wasteError } = await supabase
                        .from('objektkalender_events')
                        .select('title, event_date, waste_type, color, assigned_unit_name')
                        .eq('property_id', propertyId)
                        .eq('event_type', 'waste')
                        .eq('status', 'pending')
                        .gte('event_date', todayStr)
                        .order('event_date')
                        .limit(1);
                    if (wasteError) reportCalendarError(wasteError);
                    setNextWaste(wasteData?.[0] || null);

                    // Next cleaning
                    const { data: cleanData, error: cleanError } = await supabase
                        .from('objektkalender_events')
                        .select('title, event_date, color, assigned_unit_name')
                        .eq('property_id', propertyId)
                        .eq('event_type', 'cleaning')
                        .eq('status', 'pending')
                        .gte('event_date', todayStr)
                        .order('event_date')
                        .limit(1);
                    if (cleanError) reportCalendarError(cleanError);
                    setNextCleaning(cleanData?.[0] || null);

                    // Next assigned task for this unit
                    if (unitId) {
                        const { data: taskData, error: taskError } = await supabase
                            .from('objektkalender_events')
                            .select('title, event_date, event_type, color, assigned_unit_name')
                            .eq('property_id', propertyId)
                            .eq('assigned_unit_id', unitId)
                            .eq('status', 'pending')
                            .gte('event_date', todayStr)
                            .order('event_date')
                            .limit(1);
                        if (taskError) reportCalendarError(taskError);
                        setNextTask(taskData?.[0] || null);
                    }
                }

            } catch (err) {
                console.error('🏠 Dashboard ERROR:', err);
                setLoadError(err?.message || 'Unbekannter Fehler');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user, roleData, reloadKey]);

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val || 0);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        const d = parseLocalDate(dateStr);
        return d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    };

    const statusLabels = {
        received: { label: 'Eingegangen', color: '#F59E0B', bg: '#FEF3C7', icon: Clock },
        in_progress: { label: 'In Bearbeitung', color: '#3B82F6', bg: '#DBEAFE', icon: AlertCircle },
        completed: { label: 'Abgeschlossen', color: '#10B981', bg: '#D1FAE5', icon: CheckCircle2 }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Laden...</div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: '12px', textAlign: 'center', padding: '0 16px' }}>
                <AlertCircle size={36} color="var(--danger-color)" />
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Ihre Daten konnten nicht geladen werden.</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{loadError}</div>
                <button
                    type="button"
                    onClick={() => setReloadKey(k => k + 1)}
                    className="btn btn-primary btn-md"
                >
                    Erneut versuchen
                </button>
            </div>
        );
    }

    const sumOf = (field) => leases.reduce((acc, l) => acc + (Number(l?.[field]) || 0), 0);
    const hasLease = leases.length > 0;
    const primaryLease = leases[0] || null;
    const coldRentTotal = sumOf('cold_rent');
    const sideCostsTotal = sumOf('service_charge') + sumOf('heating_cost') + sumOf('other_costs');
    const totalRent = coldRentTotal + sideCostsTotal;
    const showAmount = (val) => (hasLease ? formatCurrency(val) : '—');

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Willkommen{tenant ? `, ${tenant.first_name}` : ''}!
                </h1>
                <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Ihr Mieter-Dashboard — alle wichtigen Informationen auf einen Blick.
                </p>
            </div>

            {/* Password setup warning banner */}
            {user && user.user_metadata?.password_set !== true && (
                <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '16px 20px',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: '#FFFBEB',
                    border: '1px solid #FDE68A',
                    color: '#92400E',
                    fontSize: '0.88rem',
                    lineHeight: 1.5,
                    marginBottom: '24px',
                    boxShadow: '0 2px 6px rgba(245,158,11,0.05)'
                }}>
                    <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px', color: '#D97706' }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, marginBottom: '2px' }}>Passwort einrichten erforderlich</div>
                        <div>
                            Richten Sie bitte ein Passwort ein, damit Sie sich in Zukunft bequem ohne E-Mail-Link anmelden können.
                            Wechseln Sie hierzu zum Menüpunkt <Link to="/tenant/stammdaten" style={{ color: '#B45309', fontWeight: 600, textDecoration: 'underline' }}>Stammdaten</Link>.
                        </div>
                    </div>
                </div>
            )}

            {/* Hinweise zum Mietverhältnis */}
            {(noTenancy || leaseNotice || !hasLease) && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                    padding: '14px 18px', borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                    color: 'var(--text-primary)', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '20px'
                }}>
                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#3B82F6' }} />
                    <div>
                        {noTenancy
                            ? 'Ihrem Konto ist noch kein Mietverhältnis zugeordnet. Bitte wenden Sie sich an Ihren Vermieter.'
                            : (leaseNotice || 'Zu Ihrem Mietverhältnis ist noch kein Mietvertrag hinterlegt.')}
                    </div>
                </div>
            )}

            {/* Hinweis bei Fehler im Objektkalender (sonst fehlen die Kacheln kommentarlos) */}
            {calendarError && (
                <div role="alert" style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 14px', borderRadius: 'var(--radius-md)', marginBottom: '20px',
                    border: '1px solid #FECACA', backgroundColor: 'var(--surface-color)',
                    color: '#B91C1C', fontSize: '0.85rem', lineHeight: 1.5
                }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        Die nächsten Termine aus dem Objektkalender konnten nicht geladen werden.
                        Sie finden sie auch unter <Link to="/object-calendar" style={{ color: '#B91C1C', fontWeight: 600, textDecoration: 'underline' }}>Objektkalender</Link>.
                    </div>
                </div>
            )}

            {/* Objektkalender Quick-Info */}
            {(nextWaste || nextTask || nextCleaning) && (() => {
                // Umbrechendes Raster: am Handy eine Kachel je Zeile statt drei gequetschter Spalten
                const cols = 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))';
                return (
                    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '12px', marginBottom: '20px' }}>
                        {nextCleaning && (
                            <div style={{
                                background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                                border: '1px solid rgba(59,130,246,0.2)', borderRadius: 'var(--radius-lg)',
                                padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px',
                                boxShadow: 'var(--glass-shadow)'
                            }}>
                                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Brush size={22} color="#3B82F6" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Nächste Reinigung</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                        {(parseLocalDate(nextCleaning.event_date) || new Date(nextCleaning.event_date)).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'long' })}
                                    </div>
                                    {nextCleaning.assigned_unit_name && <div style={{ fontSize: '0.82rem', color: '#3B82F6', fontWeight: 500, marginTop: '2px' }}>{nextCleaning.assigned_unit_name}</div>}
                                </div>
                            </div>
                        )}
                        {nextWaste && (
                            <div style={{
                                background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                                border: '1px solid rgba(249,115,22,0.2)', borderRadius: 'var(--radius-lg)',
                                padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px',
                                boxShadow: 'var(--glass-shadow)'
                            }}>
                                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(249,115,22,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Trash2 size={22} color="#F97316" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Nächste Müllabholung</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                        {(parseLocalDate(nextWaste.event_date) || new Date(nextWaste.event_date)).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'long' })}
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: '#F97316', fontWeight: 500, marginTop: '2px' }}>{nextWaste.title}</div>
                                    {nextWaste.assigned_unit_name && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Einheit: {nextWaste.assigned_unit_name}</div>}
                                </div>
                            </div>
                        )}
                        {nextTask && (
                            <div style={{
                                background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                                border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)',
                                padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px',
                                boxShadow: 'var(--glass-shadow)'
                            }}>
                                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: `linear-gradient(135deg, ${nextTask.event_type === 'cleaning' ? 'rgba(59,130,246,0.15), rgba(59,130,246,0.05)' : 'rgba(139,92,246,0.15), rgba(139,92,246,0.05)'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Sparkles size={22} color={nextTask.event_type === 'cleaning' ? '#3B82F6' : '#8B5CF6'} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Ihre nächste Aufgabe</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                        {nextTask.title}
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: nextTask.event_type === 'cleaning' ? '#3B82F6' : '#8B5CF6', fontWeight: 500, marginTop: '2px' }}>
                                        {(parseLocalDate(nextTask.event_date) || new Date(nextTask.event_date)).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'long' })}
                                    </div>
                                    {nextTask.assigned_unit_name && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Einheit: {nextTask.assigned_unit_name}</div>}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Address Card */}
            {property && unit && (
                <div style={{
                    background: 'linear-gradient(135deg, #0066CC 0%, #0EA5E9 100%)',
                    borderRadius: 'var(--radius-lg)', padding: '24px 28px',
                    color: 'white', marginBottom: '24px',
                    boxShadow: '0 4px 15px rgba(0, 102, 204, 0.3)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                        <MapPin size={20} />
                        <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.85 }}>
                            Ihre Adresse
                        </span>
                    </div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '4px' }}>
                        {property.street} {property.house_number}
                    </div>
                    <div style={{ fontSize: '1rem', opacity: 0.9 }}>
                        {property.zip} {property.city}
                    </div>
                    <div style={{
                        marginTop: '14px', padding: '8px 16px',
                        backgroundColor: 'rgba(255,255,255,0.15)',
                        borderRadius: 'var(--radius-md)', display: 'inline-flex',
                        alignItems: 'center', gap: '8px', fontSize: '0.9rem'
                    }}>
                        <DoorOpen size={16} />
                        Einheit: {unit.unit_name}
                    </div>
                </div>
            )}

            {/* Key Facts Grid */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '12px', marginBottom: '24px'
            }}>
                <KPICard
                    icon={<Euro size={20} />}
                    label="Gesamtmiete"
                    value={showAmount(totalRent)}
                    sublabel="monatlich"
                    accent="#0066CC"
                />
                <KPICard
                    icon={<Euro size={20} />}
                    label="Kaltmiete"
                    value={showAmount(coldRentTotal)}
                    sublabel="Nettomiete"
                    accent="#10B981"
                />
                <KPICard
                    icon={<Euro size={20} />}
                    label="Nebenkosten"
                    value={showAmount(sideCostsTotal)}
                    sublabel="NK + Heizung + Sonstige"
                    accent="#F59E0B"
                />
                <KPICard
                    icon={<Calendar size={20} />}
                    label="Mietbeginn"
                    value={formatDate(primaryLease?.start_date)}
                    sublabel={!primaryLease ? '' : (primaryLease.end_date ? `bis ${formatDate(primaryLease.end_date)}` : 'Unbefristet')}
                    accent="#8B5CF6"
                />
            </div>

            {/* Contract Details + Recent Tickets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Contract Details */}
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-md)',
                    padding: '24px'
                }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileText size={18} color="var(--primary-color)" />
                        Vertragsdetails
                    </h3>
                    {!hasLease ? (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                            Kein Mietvertrag hinterlegt.
                        </div>
                    ) : leases.map((lease, idx) => {
                        const leaseTotal = (Number(lease.cold_rent) || 0) + (Number(lease.service_charge) || 0) + (Number(lease.heating_cost) || 0) + (Number(lease.other_costs) || 0);
                        return (
                            <div key={lease.id || idx} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: idx > 0 ? '20px' : 0, paddingTop: idx > 0 ? '16px' : 0, borderTop: idx > 0 ? '1px solid var(--border-color)' : 'none' }}>
                                {leases.length > 1 && (
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {lease.unit?.unit_name ? `Einheit: ${lease.unit.unit_name}` : `Vertrag ${idx + 1}`}
                                    </div>
                                )}
                                <DetailRow label="Kaltmiete" value={formatCurrency(lease.cold_rent)} />
                                <DetailRow label="Betriebskosten" value={formatCurrency(lease.service_charge)} />
                                <DetailRow label="Heizkosten" value={formatCurrency(lease.heating_cost)} />
                                <DetailRow label="Sonstige Kosten" value={formatCurrency(lease.other_costs)} />
                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                <DetailRow label="Gesamtmiete" value={formatCurrency(leaseTotal)} bold />
                                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                                <DetailRow label="Mietbeginn" value={formatDate(lease.start_date)} />
                                <DetailRow label="Mietende" value={lease.end_date ? formatDate(lease.end_date) : 'Unbefristet'} />
                                {/* Kaution: keine Angabe ('—') und 0 (0,00 €) unterscheiden */}
                                <DetailRow label="Kaution" value={lease.deposit === null || lease.deposit === undefined || lease.deposit === '' ? '—' : formatCurrency(lease.deposit)} />
                            </div>
                        );
                    })}
                </div>

                {/* Recent Tickets */}
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '24px'
                }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <TicketCheck size={18} color="var(--primary-color)" />
                        Letzte Tickets
                    </h3>
                    {ticketsError && tickets.length === 0 ? (
                        <div role="alert" style={{ color: '#B91C1C', fontSize: '0.88rem', padding: '20px 0', textAlign: 'center' }}>
                            Tickets konnten nicht geladen werden. Bitte versuchen Sie es später erneut oder öffnen Sie <Link to="/tenant/tickets" style={{ color: '#B91C1C', fontWeight: 600, textDecoration: 'underline' }}>Tickets</Link>.
                        </div>
                    ) : tickets.length === 0 ? (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', padding: '20px 0', textAlign: 'center' }}>
                            Keine Tickets vorhanden
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {tickets.map(ticket => {
                                const st = statusLabels[ticket.status] || statusLabels.received;
                                const StIcon = st.icon;
                                return (
                                    <div key={ticket.id} style={{
                                        padding: '12px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)',
                                        display: 'flex', alignItems: 'center',
                                        justifyContent: 'space-between'
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{ticket.title}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                {formatDate(ticket.created_at)}
                                            </div>
                                        </div>
                                        <span style={{
                                            padding: '3px 10px', borderRadius: '12px',
                                            fontSize: '0.72rem', fontWeight: 500,
                                            backgroundColor: st.bg, color: st.color,
                                            display: 'flex', alignItems: 'center', gap: '4px'
                                        }}>
                                            <StIcon size={12} />
                                            {st.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── HELPER COMPONENTS ───────────────────────────────────────────────
const KPICard = ({ icon, label, value, sublabel, accent }) => (
    <div style={{
        backgroundColor: 'var(--surface-color)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        padding: '20px',
        borderLeft: `4px solid ${accent}`
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ color: accent }}>{icon}</div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
        {sublabel && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{sublabel}</div>}
    </div>
);

const DetailRow = ({ label, value, bold }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: '0.88rem', fontWeight: bold ? 700 : 500, color: 'var(--text-primary)' }}>{value}</span>
    </div>
);

export default TenantDashboard;
