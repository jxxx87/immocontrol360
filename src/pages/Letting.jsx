import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { hasSmtpSettings } from '../lib/smtpSettings';
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

const APPLICANT_BUCKET = 'applicant-documents';

// Neue Datenbank-Funktion noch nicht eingespielt? (PostgREST: PGRST202 / HTTP 404)
const isMissingRpc = (error, status) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883' || status === 404);

// Anrede aus dem Bewerbungsportal ("Herr"/"Frau") als tenants.salutation für Einzelschritte und Nachtragen;
// "Divers"/leer -> null (nichts senden, neutrale Briefanrede). Die Datenbank-Funktion convert_rental_applicant_to_tenant
// bildet seit Welle-5-Migration applicant_salutation selbst ab (Frau -> female, Herr -> male, Divers -> diverse,
// sonst NULL); 'diverse' ergibt in den Schreibvorlagen ebenfalls die neutrale Briefanrede.
const applicantSalutation = (app) => {
  const s = String(app?.salutation || '').trim().toLowerCase();
  if (s === 'frau') return 'female';
  if (s === 'herr') return 'male';
  return null;
};

// Spalte tenants.salutation fehlt (Migration noch nicht eingespielt): PostgREST-Schema-Cache bzw. Postgres
const isMissingSalutationColumn = (error) => !!error && (error.code === 'PGRST204' || error.code === '42703') && /salutation/i.test(error.message || '');

// Lokales Datum (nicht UTC) als YYYY-MM-DD
const localDateString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD' als lokales Datum parsen (new Date('YYYY-MM-DD') wäre UTC-Mitternacht)
const parseLocalDate = (value) => {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const formatDateDe = (value) => {
  const d = parseLocalDate(value);
  return d ? d.toLocaleDateString('de-DE') : '—';
};

const toAmount = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
};

// Optionaler Betrag (Kaution): leeres Feld = keine Angabe (NULL), eine bewusst eingegebene 0 bleibt 0 (G03-16)
const toOptionalAmount = (v) => (v === '' || v === null || v === undefined ? null : toAmount(v));

const Letting = () => {
  const { user } = useAuth();
  const { selectedPortfolioID } = usePortfolio();
  const navigate = useNavigate();

  // Data State
  const [vacantUnits, setVacantUnits] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState(null);
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
  // Bewerberunterlagen im Zwischenspeicher: { [applicantId]: { loading, files, error } }
  const [applicantDocs, setApplicantDocs] = useState({});
  // Bestätigungsdialog "Mieter annehmen"
  const [convertDialog, setConvertDialog] = useState(null);

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

  // Fetch Data
  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      setLoadError(null);

      // 1. Fetch properties
      const { data: propsData, error: propsErr } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', user.id)
        .order('street');
      if (propsErr) throw propsErr;
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
      const { data: leasesData, error: leasesErr } = await supabase
        .from('leases')
        .select('id, unit_id, start_date, end_date, status')
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (leasesErr) throw leasesErr;

      const today = localDateString();
      const currentLeaseUnitIds = new Set((leasesData || [])
        .filter(l => l.start_date <= today && (!l.end_date || l.end_date >= today))
        .map(l => l.unit_id));
      // Künftige Verträge: Einheit ist bereits vermietet (ab Mietbeginn)
      const futureLeaseStartByUnit = {};
      (leasesData || [])
        .filter(l => l.start_date > today)
        .forEach(l => {
          const known = futureLeaseStartByUnit[l.unit_id];
          if (!known || l.start_date < known) futureLeaseStartByUnit[l.unit_id] = l.start_date;
        });

      // 4. Fetch letting processes (neueste zuerst)
      const { data: processesData, error: processesErr } = await supabase
        .from('rental_processes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (processesErr) throw processesErr;

      // 5. Merge vacancy & letting processes
      const vacant = (unitsData || []).filter(u => !u.is_vacation_rental && !currentLeaseUnitIds.has(u.id));

      const merged = vacant.map(u => {
        const unitProcesses = (processesData || []).filter(p => p.unit_id === u.id);
        // Laufender Prozess hat Vorrang, sonst der neueste
        let process = unitProcesses.find(p => p.status === 'in_vermietung') || unitProcesses[0] || null;
        const rentedFrom = futureLeaseStartByUnit[u.id] || null;

        // Abgeschlossener Prozess, dessen Mietbeginn länger als 2 Wochen zurückliegt, während die
        // Einheit wieder leer steht: alter Prozess ist erledigt, Einheit kann neu vermietet werden.
        if (process && process.status === 'vermietet' && !rentedFrom && process.lease_start_date) {
          const start = parseLocalDate(process.lease_start_date);
          const diffDays = start ? Math.ceil((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24)) : 0;
          if (diffDays > 14) process = null;
        }

        let status = process ? process.status : 'kein_prozess';
        if (rentedFrom && status !== 'in_vermietung') status = 'vermietet';

        return {
          ...u,
          process,
          letting_status: status,
          rented_from: rentedFrom
        };
      });

      setVacantUnits(merged);
    } catch (err) {
      console.error('Error fetching letting processes:', err);
      setVacantUnits([]);
      setLoadError('Die Vermietungsdaten konnten nicht geladen werden: ' + (err.message || 'Unbekannter Fehler'));
    } finally {
      setLoading(false);
    }
  };

  const checkSmtpSettings = async () => {
    if (!user) return;
    try {
      setSmtpConfigured(await hasSmtpSettings(user.id));
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
    
    // Auto-generate values (nur aus vorhandenen Angaben – keine Platzhalterwerte)
    const city = unit.property?.city || '';
    const rooms = unit.rooms || '';
    const sqm = unit.sqm ? (parseFloat(unit.sqm) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '';
    // units.floor ist Freitext: reine Zahl -> "n. OG" bzw. Erdgeschoss, sonst unverändert übernehmen
    const rawFloor = unit.floor ? String(unit.floor).trim() : '';
    let floor = '';
    if (/^\d+$/.test(rawFloor)) floor = rawFloor === '0' ? 'Erdgeschoss' : `${rawFloor}. OG`;
    else if (rawFloor) floor = rawFloor;
    const fittedKitchen = unit.fitted_kitchen ? 'Einbauküche' : '';
    const balcony = unit.balcony ? 'Balkon' : '';

    const title = `${rooms ? rooms + '-Zimmer-' : ''}Wohnung${city ? ' in ' + city : ''}${balcony || fittedKitchen ? ' mit ' + [balcony, fittedKitchen].filter(Boolean).join(' und ') : ''}`;

    const desc = `Schöne ${rooms ? rooms + '-Zimmer-' : ''}Wohnung${sqm ? ` mit ca. ${sqm} m² Wohnfläche` : ''}${floor ? ` im ${floor}` : ''}${city ? ` in ${city}` : ''}.`;

    const deposit = unit.deposit_soll ?? '';

    setStartForm({
      property_id: unit.property_id,
      unit_id: unit.id,
      listing_title: title,
      listing_description: desc,
      required_documents: ['schufa', 'income_proof', 'id_copy', 'previous_landlord'],
      custom_requirements: [],
      target_rent: unit.target_rent ?? '',
      service_charge_soll: unit.service_charge_soll ?? '',
      heating_cost_soll: unit.heating_cost_soll ?? '',
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
    if (isSaving) return;
    if (!startForm.listing_title.trim()) return alert('Bitte geben Sie einen Titel an.');

    // Besichtigungstage vorab prüfen (Dauer > 0, Beginn vor Ende)
    const validSlots = startForm.viewing_slots.filter(s => s.date);
    for (const s of validSlots) {
      const duration = parseInt(s.duration, 10);
      if (!(duration > 0)) return alert('Bitte eine gültige Slot-Dauer wählen.');
      if (!s.start || !s.end || s.start >= s.end) {
        return alert(`Besichtigung am ${formatDateDe(s.date)}: Die Uhrzeit "Beginn" muss vor "Ende" liegen.`);
      }
    }

    try {
      setIsSaving(true);

      // 0. Kein zweiter laufender Prozess für dieselbe Einheit
      const { data: running, error: runningErr } = await supabase
        .from('rental_processes')
        .select('id')
        .eq('unit_id', startForm.unit_id)
        .eq('status', 'in_vermietung')
        .limit(1);
      if (runningErr) throw runningErr;
      if (running && running.length > 0) {
        alert('Für diese Einheit läuft bereits ein Vermietungsprozess.');
        setIsStartModalOpen(false);
        fetchData();
        return;
      }

      // 1. Update rents on unit
      const { data: updatedUnits, error: unitErr } = await supabase.from('units').update({
        target_rent: toAmount(startForm.target_rent),
        service_charge_soll: toAmount(startForm.service_charge_soll),
        heating_cost_soll: toAmount(startForm.heating_cost_soll),
        deposit_soll: toOptionalAmount(startForm.deposit_soll)
      }).eq('id', startForm.unit_id).select('id');
      if (unitErr) throw unitErr;
      if (!updatedUnits || updatedUnits.length === 0) {
        throw new Error('Die Mietkonditionen der Einheit konnten nicht gespeichert werden (keine Berechtigung).');
      }

      // 2. Generate random unique token (volle 128-Bit-UUID)
      const token = crypto.randomUUID().replace(/-/g, '');

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
      let viewingWarning = '';
      if (validSlots.length > 0) {
        const slotsToInsert = validSlots.map(s => ({
          user_id: user.id,
          process_id: processData.id,
          date: s.date,
          start_time: s.start,
          end_time: s.end,
          slot_duration_minutes: parseInt(s.duration, 10)
        }));

        const { error: viewingErr } = await supabase.from('rental_viewings').insert(slotsToInsert);
        if (viewingErr) {
          console.error('Error creating viewings:', viewingErr);
          viewingWarning = viewingErr.message || 'Unbekannter Fehler';
        }
      }

      // Hinweis: Der Cloud-Ordner für Bewerberunterlagen wird beim ersten Unterlagen-Eingang
      // automatisch angelegt (sync-applicant-files). Der frühere pauschale Aufruf von
      // cloud-sync 'create' (fest auf OneDrive, ohne Bezug zur Einheit) entfällt.

      setIsStartModalOpen(false);
      fetchData();
      if (viewingWarning) {
        alert('Der Vermietungsprozess wurde gestartet, aber die Besichtigungstermine konnten nicht gespeichert werden: ' + viewingWarning);
      } else {
        alert('Der Vermietungsprozess wurde erfolgreich gestartet!');
      }
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
      setDetailLoadingId(unit.id);
      // Fetch details from processes
      const { data: process, error: processErr } = await supabase
        .from('rental_processes')
        .select('*')
        .eq('id', unit.process.id)
        .maybeSingle();
      if (processErr) throw processErr;
      if (!process) throw new Error('Der Vermietungsprozess wurde nicht gefunden.');

      // Fetch applicants
      const { data: apps, error: appsErr } = await supabase
        .from('rental_applicants')
        .select('*')
        .eq('process_id', unit.process.id)
        .order('created_at', { ascending: false });
      if (appsErr) throw appsErr;

      // Fetch viewings
      const { data: vws, error: vwsErr } = await supabase
        .from('rental_viewings')
        .select('*')
        .eq('process_id', unit.process.id)
        .order('date');
      if (vwsErr) throw vwsErr;

      // Fetch bookings for these viewings
      let bks = [];
      if (vws && vws.length > 0) {
        const { data: bookingData, error: bksErr } = await supabase
          .from('rental_viewing_bookings')
          .select('*, applicant:rental_applicants(*)')
          .in('viewing_id', vws.map(v => v.id));
        if (bksErr) throw bksErr;
        bks = bookingData || [];
      }

      setSelectedProcess(process);
      setApplicants(apps || []);
      setViewings(vws || []);
      setBookings(bks);
      setApplicantDocs({});
      setIsDetailModalOpen(true);
    } catch (err) {
      console.error(err);
      alert('Die Details konnten nicht geladen werden: ' + (err.message || 'Unbekannter Fehler'));
    } finally {
      setDetailLoadingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Bewerberunterlagen (Bucket applicant-documents, nur für den Vermieter lesbar)
  // Pfade: neu <process_id>/<applicant_id>/<datei>, alt <applicant_id>/<datei>
  // ---------------------------------------------------------------------------
  const listApplicantDocuments = async (app) => {
    const prefixes = [`${app.process_id}/${app.id}`, `${app.id}`];
    const files = [];
    for (const prefix of prefixes) {
      const { data, error } = await supabase.storage.from(APPLICANT_BUCKET).list(prefix, { limit: 100 });
      if (error) throw error;
      (data || [])
        .filter(f => f && f.id) // Ordner-Einträge haben keine id
        .forEach(f => files.push({ path: `${prefix}/${f.name}`, name: f.name }));
    }
    return files;
  };

  const handleShowDocuments = async (app) => {
    setApplicantDocs(prev => ({ ...prev, [app.id]: { loading: true, files: [], error: null } }));
    try {
      const files = await listApplicantDocuments(app);
      setApplicantDocs(prev => ({ ...prev, [app.id]: { loading: false, files, error: null } }));
    } catch (err) {
      setApplicantDocs(prev => ({ ...prev, [app.id]: { loading: false, files: [], error: err.message || 'Fehler beim Laden' } }));
    }
  };

  const handleOpenDocument = async (path) => {
    // Fenster sofort öffnen (sonst blockiert der Browser das Popup nach dem await)
    const win = window.open('about:blank', '_blank');
    try {
      const { data, error } = await supabase.storage.from(APPLICANT_BUCKET).createSignedUrl(path, 120);
      if (error) throw error;
      if (win) win.location.href = data.signedUrl;
      else window.location.assign(data.signedUrl);
    } catch (err) {
      if (win) win.close();
      alert('Dokument konnte nicht geöffnet werden: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  // Löscht alle Unterlagen eines Bewerbers aus dem Zwischenspeicher (wirft bei Fehler)
  const removeApplicantDocuments = async (app) => {
    const files = await listApplicantDocuments(app);
    if (files.length === 0) return;
    const { error } = await supabase.storage.from(APPLICANT_BUCKET).remove(files.map(f => f.path));
    if (error) throw error;
  };

  const getDocLabelFromFile = (fileName) => {
    const key = String(fileName).replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
    return getDocLabel(key);
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
    // 'accepted' wird ausschließlich über "Mieter annehmen" gesetzt
    if (newStatus === 'accepted') return;
    try {
      const { data, error } = await supabase
        .from('rental_applicants')
        .update({ status: newStatus })
        .eq('id', appId)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Keine Berechtigung oder Bewerbung nicht gefunden.');

      // Update local state
      setApplicants(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
    } catch (err) {
      alert('Status-Update fehlgeschlagen: ' + err.message);
    }
  };

  // Schritt 1: Bestätigungsdialog mit Mietbeginn und Beträgen öffnen
  const handleConvertApplicantToTenant = (app) => {
    if (isSaving) return;
    if (!selectedProcess || selectedProcess.status !== 'in_vermietung') {
      alert('Für diesen Vermietungsprozess wurde bereits ein Mieter angenommen.');
      return;
    }
    setConvertDialog({
      app,
      start_date: app.earliest_move_in || localDateString(),
      cold_rent: selectedUnit?.target_rent ?? '',
      service_charge: selectedUnit?.service_charge_soll ?? '',
      heating_cost: selectedUnit?.heating_cost_soll ?? '',
      deposit: selectedUnit?.deposit_soll ?? '',
      payment_due_day: 3
    });
  };

  // Bisheriger Weg (falls die Datenbank-Funktion noch nicht eingespielt ist): Einzelschritte
  const convertApplicantLegacy = async (dialog) => {
    const { app } = dialog;

    // Prozess frisch prüfen (Doppelklick / zweiter Tab)
    const { data: freshProcess, error: freshErr } = await supabase
      .from('rental_processes')
      .select('id, status, unit_id')
      .eq('id', selectedProcess.id)
      .maybeSingle();
    if (freshErr) throw freshErr;
    if (!freshProcess || freshProcess.status !== 'in_vermietung') {
      throw new Error('Für diesen Vermietungsprozess wurde bereits ein Mieter angenommen.');
    }

    // Überschneidung mit bestehendem aktiven Vertrag verhindern
    const { data: overlapping, error: overlapErr } = await supabase
      .from('leases')
      .select('id, end_date')
      .eq('unit_id', freshProcess.unit_id)
      .eq('status', 'active');
    if (overlapErr) throw overlapErr;
    if ((overlapping || []).some(l => !l.end_date || l.end_date >= dialog.start_date)) {
      throw new Error('Für diese Einheit besteht bereits ein aktiver Mietvertrag, der den gewählten Mietbeginn überschneidet.');
    }

    // 1. Create tenant row
    const tenantRow = {
      user_id: user.id,
      first_name: app.first_name,
      last_name: app.last_name,
      email: app.email,
      phone: app.phone,
      occupants: app.additional_persons_count ? app.additional_persons_count + 1 : 1
    };
    // Anrede (für die Briefanrede in Schreibvorlagen) nur mitsenden, wenn im Portal "Herr"/"Frau" gewählt
    const salutation = applicantSalutation(app);
    if (salutation) tenantRow.salutation = salutation;
    let { data: tenantData, error: tenantErr } = await supabase
      .from('tenants')
      .insert([tenantRow])
      .select()
      .single();
    if (tenantErr && tenantRow.salutation && isMissingSalutationColumn(tenantErr)) {
      // Datenbank kennt die Spalte noch nicht: ohne Anrede speichern (neutrale Briefanrede)
      const { salutation: _salutation, ...withoutSalutation } = tenantRow;
      ({ data: tenantData, error: tenantErr } = await supabase
        .from('tenants')
        .insert([withoutSalutation])
        .select()
        .single());
    }

    if (tenantErr) throw tenantErr;

    // 2. Create lease
    const { error: leaseErr } = await supabase
      .from('leases')
      .insert([{
        user_id: user.id,
        tenant_id: tenantData.id,
        unit_id: freshProcess.unit_id,
        start_date: dialog.start_date,
        cold_rent: toAmount(dialog.cold_rent),
        service_charge: toAmount(dialog.service_charge),
        heating_cost: toAmount(dialog.heating_cost),
        deposit: toOptionalAmount(dialog.deposit),
        payment_due_day: dialog.payment_due_day,
        lease_type: 'normal',
        status: 'active'
      }]);

    if (leaseErr) {
      // Angelegten Mieter wieder entfernen, damit kein verwaister Datensatz bleibt
      await supabase.from('tenants').delete().eq('id', tenantData.id);
      throw leaseErr;
    }

    // 3. Mark process as vermietet
    const { error: processErr } = await supabase
      .from('rental_processes')
      .update({
        status: 'vermietet',
        lease_start_date: dialog.start_date,
        rented_at: new Date().toISOString()
      })
      .eq('id', freshProcess.id);

    if (processErr) {
      throw new Error('Mieter und Mietvertrag wurden angelegt, aber der Vermietungsprozess konnte nicht abgeschlossen werden: ' + processErr.message);
    }

    // 4. Update applicant status to accepted
    const { error: appErr } = await supabase
      .from('rental_applicants')
      .update({ status: 'accepted' })
      .eq('id', app.id);
    if (appErr) {
      throw new Error('Mieter und Mietvertrag wurden angelegt, aber der Bewerberstatus konnte nicht aktualisiert werden: ' + appErr.message);
    }
  };

  // Schritt 2: Umwandlung durchführen (eine Transaktion über die Datenbank-Funktion, sonst Einzelschritte)
  const handleConfirmConvert = async () => {
    if (isSaving || !convertDialog) return;
    const dialog = convertDialog;
    const dueDay = parseInt(dialog.payment_due_day, 10);
    if (!dialog.start_date) return alert('Bitte einen Mietbeginn angeben.');
    if (!(toAmount(dialog.cold_rent) > 0)) return alert('Bitte eine Kaltmiete größer 0 € angeben.');
    if (!(dueDay >= 1 && dueDay <= 31)) return alert('Bitte einen Fälligkeitstag zwischen 1 und 31 angeben.');

    try {
      setIsSaving(true);
      const { data: rpcResult, error, status } = await supabase.rpc('convert_rental_applicant_to_tenant', {
        p_applicant_id: dialog.app.id,
        p_start_date: dialog.start_date,
        p_cold_rent: toAmount(dialog.cold_rent),
        p_service_charge: toAmount(dialog.service_charge),
        p_heating_cost: toAmount(dialog.heating_cost),
        p_deposit: toOptionalAmount(dialog.deposit),
        p_payment_due_day: dueDay
      });

      if (error && !isMissingRpc(error, status)) throw error;
      if (error) await convertApplicantLegacy({ ...dialog, payment_due_day: dueDay });

      // Anrede nachtragen (Mieter und Vertrag sind bereits angelegt): Die Datenbank-Funktion übernimmt sie seit
      // Welle-5-Migration applicant_salutation selbst, ältere Fassungen nicht. Für "Herr"/"Frau" wird hier derselbe
      // Wert erneut geschrieben (unschädlich); "Divers" wird nicht gesendet, die Funktion speichert dafür 'diverse'.
      let salutationHint = '';
      const salutation = applicantSalutation(dialog.app);
      const newTenantId = !error ? rpcResult?.tenant_id : null;
      if (salutation && newTenantId) {
        const { data: salRows, error: salErr } = await supabase.from('tenants').update({ salutation }).eq('id', newTenantId).select('id');
        if (salErr ? !isMissingSalutationColumn(salErr) : !(salRows && salRows.length)) {
          console.warn('Anrede konnte nicht übernommen werden:', salErr || 'keine Zeile aktualisiert');
          salutationHint = '\n\nHinweis: Die Anrede aus der Bewerbung konnte nicht übernommen werden – bitte beim Mieter ergänzen.';
        }
      }

      setConvertDialog(null);
      setIsDetailModalOpen(false);
      fetchData();
      alert('Der Mieter wurde erfolgreich angelegt und das Mietverhältnis gestartet!' + salutationHint);
    } catch (err) {
      alert('Fehler beim Erstellen des Mietverhältnisses: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Einzelne Bewerbung samt Unterlagen löschen (DSGVO)
  const handleDeleteApplicant = async (app) => {
    if (isSaving) return;
    if (!window.confirm(`Möchten Sie die Bewerbung von ${app.first_name || ''} ${app.last_name || ''} samt hochgeladener Unterlagen und Besichtigungstermine endgültig löschen?`)) return;
    try {
      setIsSaving(true);
      try {
        await removeApplicantDocuments(app);
      } catch (docErr) {
        throw new Error('Die Unterlagen konnten nicht gelöscht werden, die Bewerbung wurde daher nicht gelöscht: ' + docErr.message);
      }
      const { data, error } = await supabase
        .from('rental_applicants')
        .delete()
        .eq('id', app.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Keine Berechtigung oder Bewerbung nicht gefunden.');

      setApplicants(prev => prev.filter(a => a.id !== app.id));
      setBookings(prev => prev.filter(b => b.applicant_id !== app.id));
    } catch (err) {
      alert('Fehler beim Löschen der Bewerbung: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProcess = async (process) => {
    if (!process) return;
    if (!window.confirm('Möchten Sie diesen Vermietungsprozess wirklich löschen? Alle Bewerbungen, hochgeladenen Unterlagen und Termine dazu werden gelöscht.')) return;
    try {
      // Erst die Unterlagen aller Bewerber entfernen (die Datenbank-Kaskade erfasst den Speicher nicht)
      const { data: apps, error: appsErr } = await supabase
        .from('rental_applicants')
        .select('id, process_id')
        .eq('process_id', process.id);
      if (appsErr) throw appsErr;
      for (const app of apps || []) {
        try {
          await removeApplicantDocuments(app);
        } catch (docErr) {
          throw new Error('Die Bewerberunterlagen konnten nicht gelöscht werden, der Prozess wurde daher nicht gelöscht: ' + docErr.message);
        }
      }

      const { data, error } = await supabase
        .from('rental_processes')
        .delete()
        .eq('id', process.id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Keine Berechtigung oder Prozess nicht gefunden.');
      setOpenActionMenuId(null);
      fetchData();
    } catch (err) {
      alert('Fehler beim Löschen des Prozesses: ' + err.message);
    }
  };

  const copyLink = async (link, label) => {
    try {
      await navigator.clipboard.writeText(link);
      alert(`${label} kopiert!`);
    } catch {
      window.prompt(`${label} konnte nicht automatisch kopiert werden. Bitte manuell kopieren:`, link);
    }
  };

  // Filter vacant units
  const filteredUnits = vacantUnits.filter(u => {
    if (filterPropertyId && u.property_id !== filterPropertyId) return false;
    if (filterStatus && u.letting_status !== filterStatus) return false;
    return true;
  });

  const getStatusBadge = (status, rentedFrom) => {
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
            <Key size={12} /> {rentedFrom ? `Vermietet ab ${formatDateDe(rentedFrom)}` : 'Vermietet'}
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
          onClick={() => navigate('/settings', { state: { activeTab: 'email-settings' } })}
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
              Der E-Mail-Versand an Mietinteressenten (z.B. Eingangs- und Terminbestätigungen) ist deaktiviert.
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
        {loadError ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--danger-color)' }}>
            <AlertCircle size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.7 }} />
            <p style={{ marginBottom: '12px' }}>{loadError}</p>
            <Button variant="secondary" onClick={fetchData}>Erneut laden</Button>
          </div>
        ) : loading && vacantUnits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            <p>Daten werden geladen…</p>
          </div>
        ) : filteredUnits.length === 0 ? (
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
                render: (row) => getStatusBadge(row.letting_status, row.rented_from)
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
                            disabled={detailLoadingId === row.id}
                            style={{ padding: '8px 16px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
                          >
                            <Eye size={14} /> {detailLoadingId === row.id ? 'Wird geladen…' : 'Details & Bewerber'}
                          </button>
                        )}
                        {row.process && (
                          <button
                            onClick={() => handleDeleteProcess(row.process)}
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
                <CurrencyInput allowDecimals value={startForm.target_rent} onValueChange={(v) => setStartForm(prev => ({ ...prev, target_rent: v ?? '' }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Betriebskostenvorauszahlung (€)</label>
                <CurrencyInput allowDecimals value={startForm.service_charge_soll} onValueChange={(v) => setStartForm(prev => ({ ...prev, service_charge_soll: v ?? '' }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Heizkostenvorauszahlung (€)</label>
                <CurrencyInput allowDecimals value={startForm.heating_cost_soll} onValueChange={(v) => setStartForm(prev => ({ ...prev, heating_cost_soll: v ?? '' }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Kaution (€)</label>
                <CurrencyInput allowDecimals value={startForm.deposit_soll} onValueChange={(v) => setStartForm(prev => ({ ...prev, deposit_soll: v ?? '' }))} />
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
                <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.4 }}>
                  Hinweis zum Datenschutz: Nach der Orientierungshilfe der Datenschutzkonferenz zur Mieterselbstauskunft sollen Bonitätsunterlagen erst kurz vor Vertragsschluss und Ausweiskopien grundsätzlich nicht verlangt werden. Bitte im Zweifel rechtlich prüfen lassen.
                </p>
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
            <Button variant="primary" onClick={handleStartProcess} disabled={isSaving}>{isSaving ? 'Wird gestartet…' : 'Prozess Starten'}</Button>
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
                  <div><strong>Fläche:</strong> {selectedUnit.sqm ? (parseFloat(selectedUnit.sqm) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—'} m²</div>
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
                    onClick={() => copyLink(`${window.location.origin}/vermietung/${selectedProcess.token}`, 'Bewerbungs-Link')}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '6px 10px', fontSize: '0.75rem', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <ClipboardList size={12} /> Bewerbungs-Portal kopieren
                  </button>
                  <button
                    onClick={() => copyLink(`${window.location.origin}/besichtigung/${selectedProcess.token}`, 'Besichtigungs-Link')}
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
                          <strong>{formatDateDe(vw.date)}</strong> ({vw.start_time.substring(0, 5)} - {vw.end_time.substring(0, 5)} Uhr, {vw.slot_duration_minutes} min Slots)
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
                            disabled={app.status === 'accepted'}
                            style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', fontSize: '0.75rem' }}
                          >
                            <option value="applied">Eingegangen</option>
                            <option value="invited">Eingeladen</option>
                            <option value="declined">Abgelehnt</option>
                            {/* 'Zusage' entsteht nur über "Mieter annehmen" (legt Mieter und Vertrag an) */}
                            {app.status === 'accepted' && <option value="accepted" disabled>Zusage</option>}
                            {app.status === 'contract_requested' && <option value="contract_requested" disabled>Vertrag angefragt</option>}
                            {app.status === 'contract_declined' && <option value="contract_declined" disabled>Vertrag abgelehnt</option>}
                          </select>
                          {app.status !== 'accepted' && (
                            <Button
                              size="xs"
                              variant="primary"
                              icon={Check}
                              onClick={() => handleConvertApplicantToTenant(app)}
                              disabled={isSaving || selectedProcess.status !== 'in_vermietung'}
                              title={selectedProcess.status !== 'in_vermietung' ? 'Für diesen Prozess wurde bereits ein Mieter angenommen.' : undefined}
                            >
                              Mieter annehmen
                            </Button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteApplicant(app)}
                            disabled={isSaving}
                            title="Bewerbung samt Unterlagen löschen"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', padding: '4px', display: 'flex', alignItems: 'center' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                        <div><strong>Einkommen:</strong> {app.monthly_income ? Number(app.monthly_income).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '—'}</div>
                        <div><strong>Berufstätig:</strong> {app.is_employed ? 'Ja' : 'Nein'}</div>
                        <div><strong>Mitbewerber:</strong> {app.has_co_applicant ? 'Ja' : 'Nein'}</div>
                        <div><strong>Einzug ab:</strong> {app.earliest_move_in ? formatDateDe(app.earliest_move_in) : 'Sofort'}</div>
                      </div>

                      {app.introduction && (
                        <div style={{ fontSize: '0.8rem', fontStyle: 'italic', backgroundColor: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '8px' }}>
                          "{app.introduction}"
                        </div>
                      )}

                      <div style={{ fontSize: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '8px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span>Kontakt: {app.email} | {app.phone || 'Keine Tel.'}</span>
                        <button
                          type="button"
                          onClick={() => handleShowDocuments(app)}
                          disabled={applicantDocs[app.id]?.loading}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: 0 }}
                        >
                          <UploadCloud size={12} /> {applicantDocs[app.id]?.loading ? 'Unterlagen werden geladen…' : 'Unterlagen anzeigen'}
                        </button>
                      </div>

                      {applicantDocs[app.id] && !applicantDocs[app.id].loading && (
                        <div style={{ fontSize: '0.75rem', marginTop: '8px', color: 'var(--text-secondary)' }}>
                          {applicantDocs[app.id].error ? (
                            <span style={{ color: 'var(--danger-color)' }}>Unterlagen konnten nicht geladen werden: {applicantDocs[app.id].error}</span>
                          ) : applicantDocs[app.id].files.length === 0 ? (
                            <span>Keine Unterlagen im Zwischenspeicher. Bei verbundener Cloud werden eingegangene Unterlagen in den Ordner „Neuvermietung“ des Objekts übertragen.</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {applicantDocs[app.id].files.map(f => (
                                <button
                                  key={f.path}
                                  type="button"
                                  onClick={() => handleOpenDocument(f.path)}
                                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '0.72rem', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                                >
                                  <FileText size={12} /> {getDocLabelFromFile(f.name)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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

      {/* Bestätigung "Mieter annehmen": Mietbeginn und Beträge prüfen, bevor der Vertrag angelegt wird */}
      {convertDialog && (
        <Modal
          isOpen={!!convertDialog}
          onClose={() => { if (!isSaving) setConvertDialog(null); }}
          title={`Mieter annehmen: ${convertDialog.app.first_name || ''} ${convertDialog.app.last_name || ''}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConvertDialog(null)} disabled={isSaving}>Abbrechen</Button>
              <Button variant="primary" onClick={handleConfirmConvert} disabled={isSaving}>
                {isSaving ? 'Wird angelegt…' : 'Mieter & Mietvertrag anlegen'}
              </Button>
            </>
          }
        >
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
            Es werden ein Mieter und ein aktiver Mietvertrag angelegt; der Vermietungsprozess wird damit beendet. Bitte prüfen Sie Mietbeginn und Beträge.
          </p>
          <Input
            label="Mietbeginn"
            type="date"
            value={convertDialog.start_date}
            onChange={(e) => setConvertDialog(prev => ({ ...prev, start_date: e.target.value }))}
          />
          {convertDialog.app.earliest_move_in && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '-8px', marginBottom: '12px' }}>
              Wunsch-Einzug laut Bewerbung: {formatDateDe(convertDialog.app.earliest_move_in)}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <CurrencyInput label="Kaltmiete (€)" allowDecimals value={convertDialog.cold_rent} onValueChange={(v) => setConvertDialog(prev => ({ ...prev, cold_rent: v ?? '' }))} />
            <CurrencyInput label="Betriebskosten (€)" allowDecimals value={convertDialog.service_charge} onValueChange={(v) => setConvertDialog(prev => ({ ...prev, service_charge: v ?? '' }))} />
            <CurrencyInput label="Heizkosten (€)" allowDecimals value={convertDialog.heating_cost} onValueChange={(v) => setConvertDialog(prev => ({ ...prev, heating_cost: v ?? '' }))} />
            <CurrencyInput label="Kaution (€)" allowDecimals value={convertDialog.deposit} onValueChange={(v) => setConvertDialog(prev => ({ ...prev, deposit: v ?? '' }))} />
          </div>
          <Input
            label="Fälligkeitstag der Miete (Tag im Monat)"
            type="number"
            min="1"
            max="31"
            value={convertDialog.payment_due_day}
            onChange={(e) => setConvertDialog(prev => ({ ...prev, payment_due_day: e.target.value }))}
          />
        </Modal>
      )}
    </div>
  );
};

export default Letting;
