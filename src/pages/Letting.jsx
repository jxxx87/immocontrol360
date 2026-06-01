import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import { 
  Building2, Users, Search, Trash2, Eye, Filter, Home, Key, AlertCircle, Plus, 
  MoreVertical, Link as LinkIcon, FileText, ClipboardList, Calendar, Check, X, Clock, UploadCloud, ChevronRight 
} from 'lucide-react';

const Letting = () => {
  const { user } = useAuth();
  const { selectedPortfolioID } = usePortfolio();
  const navigate = useNavigate();

  // Data State
  const [vacantUnits, setVacantUnits] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(true);

  // Filter State
  const [filterPropertyId, setFilterPropertyId] = useState('');
  const [filterStatus, setFilterStatus] = useState(''); // '' | 'kein_prozess' | 'in_vermietung' | 'vermietet'

  // Modals
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  // Selected Process & Unit details
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [viewings, setViewings] = useState([]);
  const [bookings, setBookings] = useState([]);

  // Form State - Start Letting Process
  const [startForm, setStartForm] = useState({
    property_id: '',
    unit_id: '',
    listing_title: '',
    listing_description: '',
    required_documents: ['schufa', 'income_proof', 'id_copy', 'previous_landlord'],
    custom_requirements: [],
    // Rents (to be updated on unit if changed)
    target_rent: '',
    service_charge_soll: '',
    heating_cost_soll: '',
    deposit_soll: '',
    // Viewing slot creation
    viewing_slots: [
      { date: '', start: '14:00', end: '17:00', duration: '15' }
    ]
  });

  const [customReqInput, setCustomReqInput] = useState('');

  // 3-Dots Action Menu
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  // Fetch Data
  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);

      // 1. Fetch properties
      const { data: propsData } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', user.id)
        .order('street');
      setProperties(propsData || []);

      // 2. Fetch units
      let unitsQuery = supabase
        .from('units')
        .select('*, property:properties(*)')
        .eq('user_id', user.id);

      if (selectedPortfolioID) {
        const portfolioProps = (propsData || []).filter(p => p.portfolio_id === selectedPortfolioID).map(p => p.id);
        if (portfolioProps.length > 0) {
          unitsQuery = unitsQuery.in('property_id', portfolioProps);
        } else {
          setVacantUnits([]);
          setLoading(false);
          return;
        }
      }

      const { data: unitsData, error: unitsErr } = await unitsQuery;
      if (unitsErr) throw unitsErr;

      // 3. Fetch active leases for vacancy check
      const { data: leasesData } = await supabase
        .from('leases')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active');

      const today = new Date().toISOString().split('T')[0];
      const activeLeaseUnitIds = (leasesData || [])
        .filter(l => l.start_date <= today && (!l.end_date || l.end_date >= today))
        .map(l => l.unit_id);

      // 4. Fetch letting processes
      const { data: processesData } = await supabase
        .from('rental_processes')
        .select('*')
        .eq('user_id', user.id);

      // 5. Merge vacancy & letting processes
      const vacant = (unitsData || []).filter(u => !u.is_vacation_rental && !activeLeaseUnitIds.includes(u.id));

      const merged = vacant.map(u => {
        // Find if there is a letting process
        const process = (processesData || []).find(p => p.unit_id === u.id);
        
        let status = 'kein_prozess';
        if (process) {
          status = process.status;
        }

        return {
          ...u,
          process: process || null,
          letting_status: status
        };
      });

      // Filter out Vermietet items older than 2 weeks
      const filteredMerged = merged.filter(item => {
        if (item.letting_status === 'vermietet' && item.process?.lease_start_date) {
          const start = new Date(item.process.lease_start_date);
          const diffDays = Math.ceil((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 14) return false;
        }
        return true;
      });

      setVacantUnits(filteredMerged);
    } catch (err) {
      console.error('Error fetching letting processes:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkSmtpSettings = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('user_smtp_settings')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      setSmtpConfigured(!!data);
    } catch (err) {
      console.error('Error checking SMTP settings:', err);
    }
  };

  useEffect(() => {
    fetchData();
    checkSmtpSettings();
  }, [user, selectedPortfolioID]);

  // Handle Action selection
  const handleOpenStartModal = (unit) => {
    setSelectedUnit(unit);
    
    // Auto-generate values
    const street = unit.property?.street || '';
    const city = unit.property?.city || '';
    const rooms = unit.rooms || '';
    const sqm = unit.sqm || '';
    const floor = unit.floor ? `${unit.floor}. OG` : 'Erdgeschoss';
    const fittedKitchen = unit.fitted_kitchen ? 'Einbauküche' : '';
    const balcony = unit.balcony ? 'Balkon' : '';
    
    const title = `${rooms ? rooms + '-Zimmer-' : ''}Wohnung in ${city || 'Zweibrücken'}${balcony || fittedKitchen ? ' mit ' + [balcony, fittedKitchen].filter(Boolean).join(' und ') : ''}`;
    
    const desc = `Schöne ${rooms || '2'}-Zimmer-Wohnung mit ca. ${sqm || '60'} m² Wohnfläche im ${floor} in ${city || 'Zweibrücken'}. Die Wohnung ist ab sofort bezugsfrei und bietet eine tolle Raumaufteilung.`;

    const deposit = unit.deposit_soll || (unit.target_rent ? parseFloat(unit.target_rent) * 3 : '');

    setStartForm({
      property_id: unit.property_id,
      unit_id: unit.id,
      listing_title: title,
      listing_description: desc,
      required_documents: ['schufa', 'income_proof', 'id_copy', 'previous_landlord'],
      custom_requirements: [],
      target_rent: unit.target_rent || '',
      service_charge_soll: unit.service_charge_soll || '',
      heating_cost_soll: unit.heating_cost_soll || '',
      deposit_soll: deposit,
      viewing_slots: [
        { date: '', start: '14:00', end: '17:00', duration: '15' }
      ]
    });
    setCustomReqInput('');
    setIsStartModalOpen(true);
    setOpenActionMenuId(null);
  };

  const handleStartProcess = async () => {
    if (!startForm.listing_title.trim()) return alert('Bitte geben Sie einen Titel an.');
    try {
      setIsSaving(true);

      // 1. Update rents on unit
      await supabase.from('units').update({
        target_rent: parseFloat(startForm.target_rent) || 0,
        service_charge_soll: parseFloat(startForm.service_charge_soll) || 0,
        heating_cost_soll: parseFloat(startForm.heating_cost_soll) || 0,
        deposit_soll: parseFloat(startForm.deposit_soll) || 0
      }).eq('id', startForm.unit_id);

      // 2. Generate random unique token
      const token = crypto.randomUUID().replace(/-/g, '').substring(0, 16);

      // 3. Create process
      const { data: processData, error: processErr } = await supabase.from('rental_processes').insert([
        {
          user_id: user.id,
          unit_id: startForm.unit_id,
          status: 'in_vermietung',
          token: token,
          listing_title: startForm.listing_title,
          listing_description: startForm.listing_description,
          required_documents: startForm.required_documents,
          custom_requirements: startForm.custom_requirements
        }
      ]).select().single();

      if (processErr) throw processErr;

      // 4. Create Viewing slots if viewing_slots are provided and valid
      const validSlots = startForm.viewing_slots.filter(s => s.date);
      if (validSlots.length > 0) {
        const slotsToInsert = validSlots.map(s => ({
          user_id: user.id,
          process_id: processData.id,
          date: s.date,
          start_time: s.start,
          end_time: s.end,
          slot_duration_minutes: parseInt(s.duration) || 15
        }));

        const { error: viewingErr } = await supabase.from('rental_viewings').insert(slotsToInsert);
        if (viewingErr) console.error('Error creating viewings:', viewingErr);
      }

      // 5. Trigger Cloud folder creation async (via cloud-sync function invoke)
      supabase.functions.invoke('cloud-sync', {
        body: { provider: 'onedrive', action: 'create' } // cloud-sync handles both
      }).catch(err => console.error("Cloud folder creation failed in background:", err));

      setIsStartModalOpen(false);
      fetchData();
      alert('Der Vermietungsprozess wurde erfolgreich gestartet! Die Cloud-Ordner werden im Hintergrund angelegt.');
    } catch (err) {
      alert('Fehler beim Starten des Prozesses: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDetails = async (unit) => {
    setSelectedUnit(unit);
    setOpenActionMenuId(null);
    if (!unit.process) return;

    try {
      setLoading(true);
      // Fetch details from processes
      const { data: process } = await supabase
        .from('rental_processes')
        .select('*')
        .eq('id', unit.process.id)
        .single();
      
      setSelectedProcess(process);

      // Fetch applicants
      const { data: apps } = await supabase
        .from('rental_applicants')
        .select('*')
        .eq('process_id', unit.process.id)
        .order('created_at', { ascending: false });
      
      setApplicants(apps || []);

      // Fetch viewings
      const { data: vws } = await supabase
        .from('rental_viewings')
        .select('*')
        .eq('process_id', unit.process.id);
      
      setViewings(vws || []);

      // Fetch bookings for these viewings
      if (vws && vws.length > 0) {
        const { data: bks } = await supabase
          .from('rental_viewing_bookings')
          .select('*, applicant:rental_applicants(*)')
          .in('viewing_id', vws.map(v => v.id));
        setBookings(bks || []);
      } else {
        setBookings([]);
      }

      setIsDetailModalOpen(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomRequirement = () => {
    if (!customReqInput.trim()) return;
    setStartForm(prev => ({
      ...prev,
      custom_requirements: [...prev.custom_requirements, customReqInput.trim()]
    }));
    setCustomReqInput('');
  };

  const handleRemoveCustomRequirement = (index) => {
    setStartForm(prev => ({
      ...prev,
      custom_requirements: prev.custom_requirements.filter((_, idx) => idx !== index)
    }));
  };

  const handleUpdateApplicantStatus = async (appId, newStatus) => {
    try {
      const { error } = await supabase
        .from('rental_applicants')
        .update({ status: newStatus })
        .eq('id', appId);

      if (error) throw error;
      
      // Update local state
      setApplicants(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
    } catch (err) {
      alert('Status-Update fehlgeschlagen: ' + err.message);
    }
  };

  const handleConvertApplicantToTenant = async (app) => {
    const confirmConvert = window.confirm(`Möchten Sie ${app.first_name} ${app.last_name} als Mieter annehmen und den Mietvertrag erstellen? Der Vermietungsprozess wird damit beendet.`);
    if (!confirmConvert) return;

    try {
      setIsSaving(true);

      // 1. Create tenant row
      const { data: tenantData, error: tenantErr } = await supabase
        .from('tenants')
        .insert([{
          user_id: user.id,
          first_name: app.first_name,
          last_name: app.last_name,
          email: app.email,
          phone: app.phone,
          occupants: app.additional_persons_count ? app.additional_persons_count + 1 : 1
        }])
        .select()
        .single();

      if (tenantErr) throw tenantErr;

      // 2. Create lease
      const leaseStart = app.earliest_move_in || new Date().toISOString().split('T')[0];
      const coldRent = parseFloat(selectedUnit.target_rent) || 0;
      const serviceCharge = parseFloat(selectedUnit.service_charge_soll) || 0;
      const heatingCost = parseFloat(selectedUnit.heating_cost_soll) || 0;
      const deposit = parseFloat(selectedUnit.deposit_soll) || 0;

      const { error: leaseErr } = await supabase
        .from('leases')
        .insert([{
          user_id: user.id,
          tenant_id: tenantData.id,
          unit_id: selectedUnit.id,
          start_date: leaseStart,
          cold_rent: coldRent,
          service_charge: serviceCharge,
          heating_cost: heatingCost,
          deposit: deposit,
          payment_due_day: 3,
          lease_type: 'normal',
          status: 'active'
        }]);

      if (leaseErr) throw leaseErr;

      // 3. Mark process as vermietet
      const { error: processErr } = await supabase
        .from('rental_processes')
        .update({
          status: 'vermietet',
          lease_start_date: leaseStart,
          rented_at: new Date().toISOString()
        })
        .eq('id', selectedProcess.id);

      if (processErr) throw processErr;

      // 4. Update applicant status to accepted
      await supabase
        .from('rental_applicants')
        .update({ status: 'accepted' })
        .eq('id', app.id);

      setIsDetailModalOpen(false);
      fetchData();
      alert('Der Mieter wurde erfolgreich angelegt und das Mietverhältnis gestartet!');
    } catch (err) {
      alert('Fehler beim Erstellen des Mietverhältnisses: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProcess = async (processId) => {
    if (!window.confirm('Möchten Sie diesen Vermietungsprozess wirklich löschen? Alle Bewerbungen und Termine dazu werden gelöscht.')) return;
    try {
      const { error } = await supabase
        .from('rental_processes')
        .delete()
        .eq('id', processId);

      if (error) throw error;
      setOpenActionMenuId(null);
      fetchData();
    } catch (err) {
      alert('Fehler beim Löschen des Prozesses: ' + err.message);
    }
  };

  // Filter vacant units
  const filteredUnits = vacantUnits.filter(u => {
    if (filterPropertyId && u.property_id !== filterPropertyId) return false;
    if (filterStatus && u.letting_status !== filterStatus) return false;
    return true;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'in_vermietung':
        return (
          <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary-color)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={12} /> In Vermietung
          </span>
        );
      case 'vermietet':
        return (
          <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Key size={12} /> Vermietet
          </span>
        );
      default:
        return (
          <span style={{ backgroundColor: 'rgba(107, 114, 128, 0.1)', color: '#6b7280', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={12} /> Kein laufender Prozess
          </span>
        );
    }
  };

  const getDocLabel = (doc) => {
    switch (doc) {
      case 'schufa': return 'Schufa-Auskunft';
      case 'income_proof': return 'Gehaltsnachweise';
      case 'id_copy': return 'Ausweiskopie';
      case 'previous_landlord': return 'Vorvermieterbescheinigung';
      default: return doc;
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--font-family)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Building2 size={28} color="var(--primary-color)" />
            Neuvermietung
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Digitaler Vermietungsprozess, Bewerberauswahl & Besichtigungstermine online verwalten.
          </p>
        </div>
      </div>

      {!smtpConfigured && (
        <div 
          onClick={() => navigate('/portfolio/settings', { state: { activeTab: 'email-settings' } })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: '12px',
            color: '#991B1B',
            cursor: 'pointer',
            marginBottom: '24px',
            transition: 'all 0.2s ease',
            boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#FEE2E2';
            e.currentTarget.style.borderColor = '#EF4444';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = '#FEF2F2';
            e.currentTarget.style.borderColor = '#FCA5A5';
          }}
        >
          <AlertCircle size={24} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '2px' }}>
              Keine E-Mail-Verbindung eingerichtet!
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              Der E-Mail-Versand an Mietinteressenten (z.B. Einladungen, Terminbestätigungen) ist deaktiviert. 
              Klicken Sie hier, um Ihre SMTP-Verbindungsdaten in den Einstellungen einzurichten.
            </div>
          </div>
          <ChevronRight size={20} style={{ flexShrink: 0, opacity: 0.7 }} />
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <Card style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)' }}>
            <Home size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Freie Einheiten</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {vacantUnits.filter(u => u.letting_status === 'kein_prozess').length}
            </div>
          </div>
        </Card>
        <Card style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary-color)' }}>
            <Clock size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>In Vermietung</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {vacantUnits.filter(u => u.letting_status === 'in_vermietung').length}
            </div>
          </div>
        </Card>
        <Card style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)' }}>
            <Key size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Kürzlich Vermietet</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {vacantUnits.filter(u => u.letting_status === 'vermietet').length}
            </div>
          </div>
        </Card>
      </div>

      {/* Filters and List */}
      <Card style={{ padding: '20px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={18} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Filter:</span>
          </div>

          <select 
            value={filterPropertyId} 
            onChange={(e) => setFilterPropertyId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
          >
            <option value="">Alle Immobilien</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.street} {p.house_number}</option>
            ))}
          </select>

          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
          >
            <option value="">Alle Stati</option>
            <option value="kein_prozess">Kein laufender Prozess</option>
            <option value="in_vermietung">In Vermietung</option>
            <option value="vermietet">Vermietet</option>
          </select>
        </div>

        {/* Vacant units list */}
        {filteredUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            <Home size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
            <p>Keine vakanten Wohnungen mit den gewählten Filtern gefunden.</p>
          </div>
        ) : (
          <Table
            columns={[
              {
                header: 'Immobilie',
                accessor: 'property',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.property?.street} {row.property?.house_number}</div>
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
                header: 'Soll-Kaltmiete',
                accessor: 'target_rent',
                render: (row) => (row.target_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
              },
              {
                header: 'Status',
                accessor: 'letting_status',
                render: (row) => getStatusBadge(row.letting_status)
              },
              {
                header: 'Aktionen',
                accessor: 'id',
                align: 'right',
                render: (row) => (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setMenuPos({ top: rect.bottom + window.scrollY + 4, left: rect.left - 120 });
                        setOpenActionMenuId(openActionMenuId === row.id ? null : row.id);
                        setSelectedUnit(row);
                      }} 
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '50%' }}
                    >
                      <MoreVertical size={18} color="var(--text-secondary)" />
                    </button>
                    {openActionMenuId === row.id && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                        zIndex: 100,
                        minWidth: '180px',
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '4px 0'
                      }}>
                        {row.letting_status !== 'in_vermietung' && row.letting_status !== 'vermietet' && (
                          <button 
                            onClick={() => handleOpenStartModal(row)}
                            style={{ padding: '8px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
                          >
                            <Plus size={14} /> Neue Vermietung starten
                          </button>
                        )}
                        {row.process && (
                          <button 
                            onClick={() => handleOpenDetails(row)}
                            style={{ padding: '8px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
                          >
                            <Eye size={14} /> Details & Bewerber
                          </button>
                        )}
                        {row.process && (
                          <button 
                            onClick={() => handleDeleteProcess(row.process.id)}
                            style={{ padding: '8px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--danger-color)' }}
                          >
                            <Trash2 size={14} /> Prozess löschen
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              }
            ]}
            data={filteredUnits}
          />
        )}
      </Card>

      {/* Start Letting Process Modal */}
      {isStartModalOpen && selectedUnit && (
        <Modal 
          isOpen={isStartModalOpen} 
          onClose={() => setIsStartModalOpen(false)}
          title={`Neue Vermietung starten: ${selectedUnit.unit_name}`}
        >
          <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '6px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>Miet-Konditionen</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Soll-Kaltmiete (€)</label>
                <CurrencyInput value={startForm.target_rent} onChange={(v) => setStartForm({ ...startForm, target_rent: v })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Betriebskostenvorauszahlung (€)</label>
                <CurrencyInput value={startForm.service_charge_soll} onChange={(v) => setStartForm({ ...startForm, service_charge_soll: v })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Heizkostenvorauszahlung (€)</label>
                <CurrencyInput value={startForm.heating_cost_soll} onChange={(v) => setStartForm({ ...startForm, heating_cost_soll: v })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Kaution (€)</label>
                <CurrencyInput value={startForm.deposit_soll} onChange={(v) => setStartForm({ ...startForm, deposit_soll: v })} />
              </div>
            </div>

            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>Exposé & Inserat</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Titel des Inserats</label>
                <Input value={startForm.listing_title} onChange={(e) => setStartForm({ ...startForm, listing_title: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Beschreibungstext</label>
                <textarea 
                  value={startForm.listing_description} 
                  onChange={(e) => setStartForm({ ...startForm, listing_description: e.target.value })}
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', minHeight: '100px', fontSize: '0.9rem' }}
                />
              </div>
            </div>

            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>Anforderungen & Dokumente</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Erforderliche Unterlagen</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {['schufa', 'income_proof', 'id_copy', 'previous_landlord'].map(doc => (
                    <label key={doc} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={startForm.required_documents.includes(doc)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setStartForm({ ...startForm, required_documents: [...startForm.required_documents, doc] });
                          } else {
                            setStartForm({ ...startForm, required_documents: startForm.required_documents.filter(d => d !== doc) });
                          }
                        }}
                      />
                      {getDocLabel(doc)}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Spezifische Kriterien hinzufügen</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Input value={customReqInput} onChange={(e) => setCustomReqInput(e.target.value)} placeholder="z.B. Mindesteinkommen 2.000€ netto" />
                  <Button type="button" onClick={handleAddCustomRequirement}>Hinzufügen</Button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {startForm.custom_requirements.map((req, idx) => (
                    <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--bg-secondary)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500 }}>
                      {req}
                      <X size={12} style={{ cursor: 'pointer' }} onClick={() => handleRemoveCustomRequirement(idx)} />
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Erste Besichtigungstermine (Optional)</span>
              <Button 
                type="button" 
                variant="secondary" 
                size="sm"
                onClick={() => setStartForm(prev => ({
                  ...prev,
                  viewing_slots: [...prev.viewing_slots, { date: '', start: '14:00', end: '17:00', duration: '15' }]
                }))}
                style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
              >
                <Plus size={14} /> Tag hinzufügen
              </Button>
            </h3>

            {startForm.viewing_slots.map((slot, index) => (
              <div key={index} style={{ 
                border: '1px solid var(--border-color)', 
                borderRadius: 'var(--radius-md)', 
                padding: '12px', 
                marginBottom: '12px',
                position: 'relative',
                backgroundColor: 'var(--bg-secondary)'
              }}>
                {startForm.viewing_slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setStartForm(prev => ({
                      ...prev,
                      viewing_slots: prev.viewing_slots.filter((_, idx) => idx !== index)
                    }))}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--danger-color)',
                      cursor: 'pointer',
                      padding: '4px'
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Datum</label>
                    <Input 
                      type="date" 
                      value={slot.date} 
                      onChange={(e) => {
                        const newSlots = [...startForm.viewing_slots];
                        newSlots[index].date = e.target.value;
                        setStartForm({ ...startForm, viewing_slots: newSlots });
                      }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Slot-Dauer (Minuten)</label>
                    <select 
                      value={slot.duration} 
                      onChange={(e) => {
                        const newSlots = [...startForm.viewing_slots];
                        newSlots[index].duration = e.target.value;
                        setStartForm({ ...startForm, viewing_slots: newSlots });
                      }}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                    >
                      <option value="15">15 Minuten</option>
                      <option value="20">20 Minuten</option>
                      <option value="30">30 Minuten</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Uhrzeit Beginn</label>
                    <Input 
                      type="time" 
                      value={slot.start} 
                      onChange={(e) => {
                        const newSlots = [...startForm.viewing_slots];
                        newSlots[index].start = e.target.value;
                        setStartForm({ ...startForm, viewing_slots: newSlots });
                      }} 
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Uhrzeit Ende</label>
                    <Input 
                      type="time" 
                      value={slot.end} 
                      onChange={(e) => {
                        const newSlots = [...startForm.viewing_slots];
                        newSlots[index].end = e.target.value;
                        setStartForm({ ...startForm, viewing_slots: newSlots });
                      }} 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <Button variant="secondary" onClick={() => setIsStartModalOpen(false)}>Abbrechen</Button>
            <Button variant="primary" onClick={handleStartProcess} loading={isSaving}>Prozess Starten</Button>
          </div>
        </Modal>
      )}

      {/* Details & Applicants Modal */}
      {isDetailModalOpen && selectedUnit && selectedProcess && (
        <Modal 
          isOpen={isDetailModalOpen} 
          onClose={() => setIsDetailModalOpen(false)}
          title={`Vermietungscockpit: ${selectedUnit.unit_name}`}
        >
          <div style={{ maxHeight: '75vh', overflowY: 'auto', paddingRight: '6px' }}>
            {/* Quick Details & Links */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <Card style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)' }}>
                <h4 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={16} /> Einheitendetails
                </h4>
                <div style={{ fontSize: '0.8rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div><strong>Fläche:</strong> {selectedUnit.sqm} m²</div>
                  <div><strong>Zimmer:</strong> {selectedUnit.rooms}</div>
                  <div><strong>Balkon:</strong> {selectedUnit.balcony ? 'Ja' : 'Nein'}</div>
                  <div><strong>Einbauküche:</strong> {selectedUnit.fitted_kitchen ? 'Ja' : 'Nein'}</div>
                </div>
              </Card>

              <Card style={{ padding: '16px', backgroundColor: 'var(--bg-secondary)' }}>
                <h4 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <LinkIcon size={16} /> Portallinks
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button 
                    onClick={() => {
                      const link = `${window.location.origin}/vermietung/${selectedProcess.token}`;
                      navigator.clipboard.writeText(link);
                      alert('Bewerbungs-Link kopiert!');
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '6px 10px', fontSize: '0.75rem', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <ClipboardList size={12} /> Bewerbungs-Portal kopieren
                  </button>
                  <button 
                    onClick={() => {
                      const link = `${window.location.origin}/besichtigung/${selectedProcess.token}`;
                      navigator.clipboard.writeText(link);
                      alert('Besichtigungs-Link kopiert!');
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '6px 10px', fontSize: '0.75rem', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <Calendar size={12} /> Besichtigungs-Planer kopieren
                  </button>
                </div>
              </Card>
            </div>

            {/* Viewings slots overview */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} color="var(--primary-color)" /> Besichtigungstermine
              </h4>
              {viewings.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Keine Termine angelegt.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {viewings.map(vw => {
                    const relatedBookings = bookings.filter(b => b.viewing_id === vw.id && b.status === 'booked');
                    return (
                      <div key={vw.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
                        <div>
                          <strong>{new Date(vw.date).toLocaleDateString('de-DE')}</strong> ({vw.start_time.substring(0, 5)} - {vw.end_time.substring(0, 5)} Uhr, {vw.slot_duration_minutes} min Slots)
                        </div>
                        <span style={{ fontWeight: 600, color: 'var(--primary-color)' }}>
                          {relatedBookings.length} Slots belegt
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Applicants list */}
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={18} color="var(--primary-color)" /> Bewerber ({applicants.length})
              </h4>
              {applicants.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Noch keine Bewerbungen eingegangen.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {applicants.map(app => (
                    <Card key={app.id} style={{ padding: '16px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                          <h5 style={{ fontWeight: 700, fontSize: '0.95rem' }}>{app.last_name}, {app.first_name}</h5>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Eingegangen am: {new Date(app.created_at).toLocaleDateString()}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <select 
                            value={app.status} 
                            onChange={(e) => handleUpdateApplicantStatus(app.id, e.target.value)}
                            style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.75rem' }}
                          >
                            <option value="applied">Eingegangen</option>
                            <option value="invited">Eingeladen</option>
                            <option value="declined">Abgelehnt</option>
                            <option value="accepted">Zusage</option>
                          </select>
                          {app.status !== 'accepted' && (
                            <Button size="xs" variant="primary" icon={Check} onClick={() => handleConvertApplicantToTenant(app)}>
                              Mieter annehmen
                            </Button>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                        <div><strong>Einkommen:</strong> {app.monthly_income ? app.monthly_income.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '—'}</div>
                        <div><strong>Berufstätig:</strong> {app.is_employed ? 'Ja' : 'Nein'}</div>
                        <div><strong>Mitbewerber:</strong> {app.has_co_applicant ? 'Ja' : 'Nein'}</div>
                        <div><strong>Einzug ab:</strong> {app.earliest_move_in ? new Date(app.earliest_move_in).toLocaleDateString() : 'Sofort'}</div>
                      </div>

                      {app.introduction && (
                        <div style={{ fontSize: '0.8rem', fontStyle: 'italic', backgroundColor: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '8px' }}>
                          "{app.introduction}"
                        </div>
                      )}

                      <div style={{ fontSize: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '8px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Kontakt: {app.email} | {app.phone || 'Keine Tel.'}</span>
                        <span style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <UploadCloud size={12} /> Unterlagen direkt in der Cloud
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <Button variant="secondary" onClick={() => setIsDetailModalOpen(false)}>Schließen</Button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Letting;
