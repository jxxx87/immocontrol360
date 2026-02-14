import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
    Home, FileText, Euro, Calendar, MapPin,
    Building2, DoorOpen, Phone, Mail, Clock,
    AlertCircle, CheckCircle2, TicketCheck
} from 'lucide-react';

const TenantDashboard = () => {
    const { user, roleData } = useAuth();
    const [lease, setLease] = useState(null);
    const [unit, setUnit] = useState(null);
    const [property, setProperty] = useState(null);
    const [tenant, setTenant] = useState(null);
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {

            if (!user) {
                setLoading(false);
                return;
            }

            try {
                // If roleData is missing, fetch it directly
                let tenantId = roleData?.tenant_id;
                let unitId = roleData?.unit_id;
                let propertyId = roleData?.property_id;

                if (!tenantId) {

                    const { data: roles, error: rolesError } = await supabase
                        .from('user_roles')
                        .select('tenant_id, unit_id, property_id')
                        .eq('user_id', user.id)
                        .eq('role', 'tenant')
                        .limit(1);


                    if (roles && roles.length > 0) {
                        tenantId = roles[0].tenant_id;
                        unitId = roles[0].unit_id;
                        propertyId = roles[0].property_id;
                    }
                }

                if (!tenantId) {
                    setLoading(false);
                    return;
                }

                // Fetch lease
                const { data: leases, error: leaseError } = await supabase
                    .from('leases')
                    .select('*, unit:units(*, property:properties(*))')
                    .eq('tenant_id', tenantId)
                    .in('status', ['active', 'Active', 'aktiv'])
                    .limit(1);


                let activeLease = leases?.[0];

                if (!activeLease) {
                    // Fallback: any lease
                    const { data: anyLeases, error: anyError } = await supabase
                        .from('leases')
                        .select('*, unit:units(*, property:properties(*))')
                        .eq('tenant_id', tenantId)
                        .order('start_date', { ascending: false })
                        .limit(1);

                    activeLease = anyLeases?.[0];
                }

                if (activeLease) {
                    setLease(activeLease);
                    setUnit(activeLease.unit);
                    setProperty(activeLease.unit?.property);
                } else if (unitId) {
                    const { data: unitData } = await supabase
                        .from('units')
                        .select('*, property:properties(*)')
                        .eq('id', unitId)
                        .single();

                    if (unitData) {
                        setUnit(unitData);
                        setProperty(unitData.property);
                    }
                }

                // Fetch tenant info
                const { data: tenantData, error: tenantError } = await supabase
                    .from('tenants')
                    .select('*')
                    .eq('id', tenantId)
                    .single();

                setTenant(tenantData);

                // Fetch recent tickets
                const { data: ticketData } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('tenant_user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(5);
                setTickets(ticketData || []);

            } catch (err) {
                console.error('🏠 Dashboard ERROR:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user, roleData]);

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val || 0);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

    const totalRent = (lease?.cold_rent || 0) + (lease?.service_charge || 0) + (lease?.heating_cost || 0) + (lease?.other_costs || 0);

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
                        {property.zip_code} {property.city}
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
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px', marginBottom: '24px'
            }}>
                <KPICard
                    icon={<Euro size={20} />}
                    label="Gesamtmiete"
                    value={formatCurrency(totalRent)}
                    sublabel="monatlich"
                    accent="#0066CC"
                />
                <KPICard
                    icon={<Euro size={20} />}
                    label="Kaltmiete"
                    value={formatCurrency(lease?.cold_rent)}
                    sublabel="Nettomiete"
                    accent="#10B981"
                />
                <KPICard
                    icon={<Euro size={20} />}
                    label="Nebenkosten"
                    value={formatCurrency((lease?.service_charge || 0) + (lease?.heating_cost || 0) + (lease?.other_costs || 0))}
                    sublabel="NK + Heizung + Sonstige"
                    accent="#F59E0B"
                />
                <KPICard
                    icon={<Calendar size={20} />}
                    label="Mietbeginn"
                    value={formatDate(lease?.start_date)}
                    sublabel={lease?.end_date ? `bis ${formatDate(lease.end_date)}` : 'Unbefristet'}
                    accent="#8B5CF6"
                />
            </div>

            {/* Contract Details + Recent Tickets */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                {/* Contract Details */}
                <div style={{
                    backgroundColor: 'var(--surface-color)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-color)',
                    padding: '24px'
                }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileText size={18} color="var(--primary-color)" />
                        Vertragsdetails
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <DetailRow label="Kaltmiete" value={formatCurrency(lease?.cold_rent)} />
                        <DetailRow label="Betriebskosten" value={formatCurrency(lease?.service_charge)} />
                        <DetailRow label="Heizkosten" value={formatCurrency(lease?.heating_cost)} />
                        <DetailRow label="Sonstige Kosten" value={formatCurrency(lease?.other_costs)} />
                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                        <DetailRow label="Gesamtmiete" value={formatCurrency(totalRent)} bold />
                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                        <DetailRow label="Mietbeginn" value={formatDate(lease?.start_date)} />
                        <DetailRow label="Mietende" value={lease?.end_date ? formatDate(lease.end_date) : 'Unbefristet'} />
                        <DetailRow label="Kaution" value={lease?.deposit ? formatCurrency(lease.deposit) : '—'} />
                    </div>
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
                    {tickets.length === 0 ? (
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
