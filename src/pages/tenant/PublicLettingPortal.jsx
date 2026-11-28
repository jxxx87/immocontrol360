import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { 
  Building2, Users, FileText, Calendar, Check, AlertCircle, Info, Upload, 
  MapPin, Coins, ArrowRight, ArrowLeft, Loader2, Heart
} from 'lucide-react';

const APPLICANT_BUCKET = 'applicant-documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (entspricht dem Limit des Buckets)
const MIME_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const EXT_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DOC_CONFIG = {
  schufa: { label: 'Schufa-Auskunft', title: 'Schufa-Auskunft (PDF)*', accept: 'application/pdf', types: ['application/pdf'] },
  income_proof: { label: 'Gehaltsnachweis', title: 'Gehaltsnachweise der letzten 3 Monate (PDF)*', accept: 'application/pdf', types: ['application/pdf'] },
  id_copy: { label: 'Ausweiskopie', title: 'Ausweiskopie (Vorder- und Rückseite, PDF/Bild)*', accept: 'application/pdf,image/jpeg,image/png', types: ['application/pdf', 'image/jpeg', 'image/png'] },
  previous_landlord: { label: 'Vorvermieterbescheinigung', title: 'Vorvermieterbescheinigung (PDF)*', accept: 'application/pdf', types: ['application/pdf'] }
};
const DOC_ORDER = ['schufa', 'income_proof', 'id_copy', 'previous_landlord'];

const isDuplicateUpload = (error) =>
  !!error && (String(error.statusCode) === '409' || /exist|duplicate/i.test(error.message || ''));

// MIME-Typ aus der Datei ableiten (Browser liefern ihn nicht immer)
const detectMime = (file) => {
  if (file?.type && MIME_EXT[file.type]) return file.type;
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || null;
};

const getRequiredDocs = (info) => (Array.isArray(info?.required_documents) ? info.required_documents : []);

// Anrede: keine Vorauswahl (eine Vorgabe erzeugt falsche Briefanreden). Gespeichert werden
// 'Frau'/'Herr'/'Divers' (die Datenbank übernimmt sie als female/male/diverse in den Mieter);
// "Keine Angabe" wird leer gespeichert (neutrale Briefanrede).
const NO_SALUTATION = 'keine_angabe';
const SALUTATION_OPTIONS = [
  { value: 'Frau', label: 'Frau' },
  { value: 'Herr', label: 'Herr' },
  { value: 'Divers', label: 'Divers' },
  { value: NO_SALUTATION, label: 'Keine Angabe' }
];
const salutationForDb = (value) =>
  (value && value !== NO_SALUTATION && SALUTATION_OPTIONS.some(opt => opt.value === value) ? value : null);

const PublicLettingPortal = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  // Load state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processInfo, setProcessInfo] = useState(null);

  // Flow step state: 1 to 6
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [newApplicantId, setNewApplicantId] = useState(null);
  const [failedDocs, setFailedDocs] = useState([]);
  // Eingangsbestätigung (mit persönlichem Buchungslink) konnte nicht versendet werden
  const [confirmationMailFailed, setConfirmationMailFailed] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    // Step 1: General Info & Contact
    earliest_move_in: '',
    salutation: '',
    first_name: '',
    last_name: '',
    birth_date: '',
    marital_status: 'ledig',
    phone: '',
    email: '',
    introduction: '',

    // Step 2: Co-Applicant
    has_co_applicant: false,
    co_salutation: '',
    co_first_name: '',
    co_last_name: '',
    co_birth_date: '',
    co_relationship: '',
    co_email: '',
    co_phone: '',

    // Step 3: Additional Persons & Occupation
    additional_persons_count: 0,
    is_employed: false,
    monthly_income: '',
    co_is_employed: false,
    co_monthly_income: '',

    // Step 4: Current Address
    street: '',
    house_number: '',
    postal_code: '',
    city: '',

    // Step 5: Declarations
    has_rent_arrears: false,
    has_eviction_lawsuits: false,
    has_insolvency_proceedings: false,
    receives_social_benefits: false,
    has_pets: false,
  });

  // Files State
  const [files, setFiles] = useState({
    schufa: null,
    income_proof: null,
    id_copy: null,
    previous_landlord: null
  });

  // Fetch process info
  useEffect(() => {
    const fetchProcess = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_rental_process_by_token', { p_token: token });
        if (error) throw error;
        
        if (data.error) {
          setError(data.error);
        } else {
          setProcessInfo(data);
        }
      } catch {
        setError('Die Details konnten nicht geladen werden. Bitte wenden Sie sich an Ihren Vermieter.');
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchProcess();
  }, [token]);

  const handleInputChange = (field, val) => {
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  // Datei prüfen (Typ und Größe), bei Fehler Auswahl zurücksetzen
  const handleFileChange = (docType, e) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setFiles(prev => ({ ...prev, [docType]: null }));
      return;
    }
    const config = DOC_CONFIG[docType];
    const mime = detectMime(file);
    if (!mime || (config && !config.types.includes(mime))) {
      alert(`${config?.label || 'Datei'}: Dieser Dateityp wird nicht unterstützt. Erlaubt: ${config?.types.includes('image/jpeg') ? 'PDF, JPG oder PNG' : 'PDF'}.`);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert(`${config?.label || 'Datei'}: Die Datei ist größer als 10 MB.`);
      e.target.value = '';
      return;
    }
    setFiles(prev => ({ ...prev, [docType]: file }));
  };

  const validateStep = () => {
    if (step === 1) {
      if (!formData.salutation) return 'Bitte wählen Sie eine Anrede aus (oder „Keine Angabe“).';
      if (!formData.first_name.trim()) return 'Bitte geben Sie Ihren Vornamen ein.';
      if (!formData.last_name.trim()) return 'Bitte geben Sie Ihren Nachnamen ein.';
      if (!formData.email.trim()) return 'Bitte geben Sie Ihre E-Mail-Adresse ein.';
      if (!EMAIL_RE.test(formData.email.trim())) return 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
      if (!formData.phone.trim()) return 'Bitte geben Sie Ihre Telefonnummer ein.';
    }
    if (step === 2 && formData.has_co_applicant) {
      if (!formData.co_salutation) return 'Bitte Anrede des Mitbewerbers auswählen (oder „Keine Angabe“).';
      if (!formData.co_first_name.trim()) return 'Bitte Vornamen des Mitbewerbers eingeben.';
      if (!formData.co_last_name.trim()) return 'Bitte Nachnamen des Mitbewerbers eingeben.';
    }
    if (step === 4) {
      if (!formData.street.trim()) return 'Bitte geben Sie Ihre aktuelle Straße ein.';
      if (!formData.house_number.trim()) return 'Bitte geben Sie Ihre Hausnummer ein.';
      if (!formData.postal_code.trim()) return 'Bitte geben Sie Ihre Postleitzahl ein.';
      if (!formData.city.trim()) return 'Bitte geben Sie Ihre Stadt ein.';
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) {
      alert(err);
      return;
    }
    setStep(prev => prev + 1);
  };

  const handleBack = () => {
    setStep(prev => prev - 1);
  };

  // Unterlagen hochladen; liefert die Dokumenttypen, deren Upload fehlgeschlagen ist.
  // Pfad <process_id>/<applicant_id>/<typ>.<ext> (Storage-Regel applicant_document_upload_allowed)
  const uploadDocuments = async (applicantId, docs) => {
    const failed = [];
    const folder = `${processInfo.id}/${applicantId}`;
    for (const [docType, fileObj] of Object.entries(docs)) {
      if (!fileObj) continue;
      const mime = detectMime(fileObj);
      const ext = MIME_EXT[mime];
      if (!ext) {
        failed.push(docType);
        continue;
      }
      let { error: uploadErr } = await supabase.storage
        .from(APPLICANT_BUCKET)
        .upload(`${folder}/${docType}.${ext}`, fileObj, { contentType: mime });

      // Datei existiert schon (z. B. erneuter Versuch): unter eindeutigem Namen ablegen
      if (uploadErr && isDuplicateUpload(uploadErr)) {
        ({ error: uploadErr } = await supabase.storage
          .from(APPLICANT_BUCKET)
          .upload(`${folder}/${docType}_${Date.now()}.${ext}`, fileObj, { contentType: mime }));
      }

      if (uploadErr) {
        console.error(`Failed to upload document ${docType}:`, uploadErr);
        failed.push(docType);
      }
    }
    return failed;
  };

  // Übertragung in die Cloud des Vermieters anstoßen. Ein Fehler betrifft nur den Vermieter
  // (die Unterlagen bleiben im geschützten Speicher und sind im Vermietungscockpit abrufbar).
  const syncDocuments = async (applicantId) => {
    try {
      const { data: syncData, error: syncErr } = await supabase.functions.invoke('sync-applicant-files', {
        body: { applicantId, applicant_id: applicantId, process_token: token }
      });
      if (syncErr) console.warn('Cloud sync of applicant documents failed:', syncErr);
      // Fachliche Fehler/Teilergebnisse kommen mit success: false
      else if (syncData?.success === false) console.warn('Cloud sync of applicant documents incomplete:', syncData.error || syncData.message || syncData);
    } catch (syncErr) {
      console.warn('Cloud sync of applicant documents failed:', syncErr);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    // Validate final step documents
    const requiredDocs = getRequiredDocs(processInfo);
    const missingDocs = DOC_ORDER
      .filter(docType => requiredDocs.includes(docType) && !files[docType])
      .map(docType => DOC_CONFIG[docType].label);

    if (missingDocs.length > 0) {
      alert(`Bitte laden Sie die folgenden erforderlichen Dokumente hoch: ${missingDocs.join(', ')}`);
      return;
    }

    try {
      setIsSubmitting(true);

      const trimOrNull = (v) => {
        const s = typeof v === 'string' ? v.trim() : v;
        return s === '' || s === undefined ? null : s;
      };
      const hasCo = !!formData.has_co_applicant;

      // Felder der Selbstauskunft (user_id und status setzt die Datenbank selbst)
      const application = {
        earliest_move_in: formData.earliest_move_in || null,
        salutation: salutationForDb(formData.salutation),
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        birth_date: formData.birth_date || null,
        marital_status: formData.marital_status,
        phone: trimOrNull(formData.phone),
        email: formData.email.trim().toLowerCase(),
        introduction: trimOrNull(formData.introduction),

        has_co_applicant: hasCo,
        co_salutation: hasCo ? salutationForDb(formData.co_salutation) : null,
        co_first_name: hasCo ? trimOrNull(formData.co_first_name) : null,
        co_last_name: hasCo ? trimOrNull(formData.co_last_name) : null,
        co_birth_date: (hasCo && formData.co_birth_date) ? formData.co_birth_date : null,
        co_relationship: hasCo ? trimOrNull(formData.co_relationship) : null,
        co_email: hasCo && formData.co_email ? formData.co_email.trim().toLowerCase() : null,
        co_phone: hasCo ? trimOrNull(formData.co_phone) : null,

        additional_persons_count: parseInt(formData.additional_persons_count) || 0,
        is_employed: formData.is_employed,
        monthly_income: parseFloat(formData.monthly_income) || null,
        co_is_employed: hasCo ? formData.co_is_employed : false,
        co_monthly_income: (hasCo && formData.co_monthly_income) ? (parseFloat(formData.co_monthly_income) || null) : null,

        street: trimOrNull(formData.street),
        house_number: trimOrNull(formData.house_number),
        postal_code: trimOrNull(formData.postal_code),
        city: trimOrNull(formData.city),

        has_rent_arrears: formData.has_rent_arrears,
        has_eviction_lawsuits: formData.has_eviction_lawsuits,
        has_insolvency_proceedings: formData.has_insolvency_proceedings,
        receives_social_benefits: formData.receives_social_benefits,
        has_pets: formData.has_pets,
      };

      // 1. Bewerbung über die geprüfte Datenbank-Funktion anlegen (nicht angemeldete
      //    Besucher haben keine Tabellenrechte)
      const { data: applicantId, error: rpcErr } = await supabase.rpc('submit_rental_application', {
        p_token: token,
        p_application: application
      });
      if (rpcErr) throw rpcErr;

      if (!applicantId) throw new Error('Die Bewerbung konnte nicht gespeichert werden.');
      setNewApplicantId(applicantId);

      // 2. Unterlagen hochladen (Fehler werden gesammelt und dem Bewerber angezeigt)
      const failed = await uploadDocuments(applicantId, files);
      setFailedDocs(failed);

      // 3. Übertragung in die Cloud des Vermieters
      await syncDocuments(applicantId);

      // 4. Eingangsbestätigung (Empfänger ermittelt die Function aus der Datenbank). Fachliche
      //    Fehler (z. B. kein Postfach eingerichtet) meldet sie mit HTTP 200 und success: false.
      let mailSent = false;
      try {
        const { data: emailData, error: emailErr } = await supabase.functions.invoke('send-letting-email', {
          body: {
            action: 'application_received',
            applicantId,
            applicant_id: applicantId,
            process_token: token,
            // Nur für den Mailtext: keine Erfolgsmeldung für nicht übertragene Unterlagen
            failed_documents: failed
          }
        });
        if (emailErr) console.error('Failed to trigger confirmation email:', emailErr);
        else if (emailData?.success === false) console.warn('Confirmation email not sent:', emailData.error || emailData.warning);
        else mailSent = true;
      } catch (emailErr) {
        console.error('Failed to trigger confirmation email:', emailErr);
      }
      setConfirmationMailFailed(!mailSent);

      setSubmitSuccess(true);
    } catch (err) {
      alert('Fehler beim Übermitteln der Bewerbung: ' + (err?.message || 'Unbekannter Fehler'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fehlgeschlagene Unterlagen für dieselbe Bewerbung erneut hochladen
  const handleRetryUpload = async () => {
    if (isRetrying || !newApplicantId || failedDocs.length === 0) return;
    try {
      setIsRetrying(true);
      const docs = {};
      failedDocs.forEach(docType => { docs[docType] = files[docType]; });
      const stillFailed = await uploadDocuments(newApplicantId, docs);
      setFailedDocs(stillFailed);
      if (stillFailed.length < failedDocs.length) await syncDocuments(newApplicantId);
      if (stillFailed.length === 0) alert('Alle Unterlagen wurden übertragen.');
    } finally {
      setIsRetrying(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '24px' }}>
        <Loader2 className="animate-spin" size={40} color="var(--primary-color)" />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Details werden geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '24px' }}>
        <Card style={{ maxWidth: '500px', width: '100%', padding: '32px', textAlign: 'center' }}>
          <AlertCircle size={48} color="var(--danger-color)" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Link ungültig oder abgelaufen</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{error}</p>
        </Card>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '24px' }}>
        <Card style={{ maxWidth: '550px', width: '100%', padding: '32px', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Check size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '12px' }}>Bewerbung eingegangen!</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '24px' }}>
            Vielen Dank für Ihr Interesse an der Wohnung. Ihre Angaben{failedDocs.length === 0 ? ' und Unterlagen' : ''} wurden an den Vermieter übermittelt.
          </p>

          {failedDocs.length > 0 && (
            <div style={{ textAlign: 'left', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: '24px', fontSize: '0.85rem', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={16} /> Folgende Unterlagen konnten nicht übertragen werden:
              </div>
              {failedDocs.map(docType => (
                <div key={docType} style={{ marginBottom: '8px' }}>
                  <div style={{ fontWeight: 600 }}>{DOC_CONFIG[docType]?.label || docType}</div>
                  <input
                    type="file"
                    accept={DOC_CONFIG[docType]?.accept || 'application/pdf'}
                    onChange={(e) => handleFileChange(docType, e)}
                    style={{ fontSize: '0.8rem', marginTop: '4px' }}
                  />
                  {files[docType] && <span style={{ display: 'block', fontSize: '0.75rem', marginTop: '2px' }}>Ausgewählt: {files[docType].name}</span>}
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={handleRetryUpload} disabled={isRetrying} style={{ marginTop: '4px' }}>
                {isRetrying ? 'Wird übertragen…' : 'Unterlagen erneut hochladen'}
              </Button>
            </div>
          )}

          {confirmationMailFailed && (
            <div style={{ textAlign: 'left', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: '24px', fontSize: '0.85rem', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={16} /> Keine Eingangsbestätigung per E-Mail
              </div>
              Die Bestätigungs-E-Mail mit Ihrem persönlichen Buchungslink konnte nicht versendet werden. Bitte buchen Sie Ihren Besichtigungstermin direkt über den Button unten oder speichern Sie die nächste Seite als Lesezeichen.
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Sie können jetzt direkt online Ihren Wunsch-Besichtigungstermin auswählen:
            </p>
            <Button 
              variant="primary" 
              size="lg" 
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => navigate(`/besichtigung/${token}?applicantId=${newApplicantId}`)}
            >
              Besichtigungstermin buchen <ArrowRight size={18} style={{ marginLeft: '8px' }} />
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--background-color)', color: 'var(--text-primary)', padding: '40px 24px', fontFamily: 'var(--font-family)' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto' }}>
        {/* Exposé / Header */}
        <Card style={{ padding: '24px', marginBottom: '24px', background: 'linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%)', color: '#ffffff' }}>
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, color: 'rgba(255, 255, 255, 0.9)' }}>Bewerbungsportal</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ffffff', marginTop: '6px' }}>{processInfo.listing_title}</h1>
          <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MapPin size={14} /> {processInfo.street} {processInfo.house_number}, {processInfo.zip} {processInfo.city}
          </p>
          {processInfo.listing_description && (
            <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.9)', marginTop: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {processInfo.listing_description}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '16px' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>Kaltmiete</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Number(processInfo.target_rent || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>Nebenkosten</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{(Number(processInfo.service_charge_soll || 0) + Number(processInfo.heating_cost_soll || 0)).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>Größe</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{processInfo.sqm ? (parseFloat(processInfo.sqm) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—'} m²</div>
            </div>
          </div>
        </Card>

        {/* Step Indicator */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', padding: '0 8px' }}>
          {[1, 2, 3, 4, 5, 6].map(s => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{ 
                width: '32px', 
                height: '32px', 
                borderRadius: '50%', 
                backgroundColor: step === s ? 'var(--primary-color)' : (step > s ? 'var(--success-color)' : '#d1d5db'),
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.85rem',
                border: step === s ? '4px solid #ffffff' : 'none',
                boxShadow: step === s ? '0 0 0 2px var(--primary-color)' : 'none',
                transition: 'all 0.3s ease'
              }}>
                {step > s ? <Check size={16} /> : s}
              </div>
              <span style={{ fontSize: '0.65rem', color: step === s ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: step === s ? 700 : 500, marginTop: '6px', textAlign: 'center' }}>
                {s === 1 && 'Kontakt'}
                {s === 2 && 'Mitbewerber'}
                {s === 3 && 'Einkommen'}
                {s === 4 && 'Anschrift'}
                {s === 5 && 'Erklärungen'}
                {s === 6 && 'Dokumente'}
              </span>
            </div>
          ))}
        </div>

        {/* Form Card */}
        <Card style={{ padding: '28px' }}>
          {/* Step 1: General Info */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={20} color="var(--primary-color)" /> Kontakt & Allgemeines
              </h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Anrede</label>
                  <select 
                    value={formData.salutation}
                    onChange={(e) => handleInputChange('salutation', e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: formData.salutation ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  >
                    <option value="" disabled>Bitte wählen</option>
                    {SALUTATION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Wunsch-Einzugstermin</label>
                  <Input type="date" value={formData.earliest_move_in} onChange={(e) => handleInputChange('earliest_move_in', e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Vorname</label>
                  <Input value={formData.first_name} onChange={(e) => handleInputChange('first_name', e.target.value)} placeholder="Max" />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Nachname</label>
                  <Input value={formData.last_name} onChange={(e) => handleInputChange('last_name', e.target.value)} placeholder="Mustermann" />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Geburtsdatum</label>
                  <Input type="date" value={formData.birth_date} onChange={(e) => handleInputChange('birth_date', e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Familienstand</label>
                  <select 
                    value={formData.marital_status} 
                    onChange={(e) => handleInputChange('marital_status', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)' }}
                  >
                    <option value="ledig">ledig</option>
                    <option value="verheiratet">verheiratet</option>
                    <option value="sonstiges">sonstiges</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Telefonnummer</label>
                  <Input value={formData.phone} onChange={(e) => handleInputChange('phone', e.target.value)} placeholder="+49 170 1234567" />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>E-Mail-Adresse</label>
                  <Input type="email" value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)} placeholder="max@example.de" />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Persönliche Nachricht an den Vermieter (Optional)</label>
                <textarea 
                  value={formData.introduction} 
                  onChange={(e) => handleInputChange('introduction', e.target.value)}
                  placeholder="Erzählen Sie kurz etwas über sich..."
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)', minHeight: '80px', fontSize: '0.9rem' }}
                />
              </div>
            </div>
          )}

          {/* Step 2: Co-Applicant */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={20} color="var(--primary-color)" /> Zweiter Bewerber / Mitmieter
              </h2>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.95rem', cursor: 'pointer', fontWeight: 600 }}>
                  <input 
                    type="checkbox" 
                    checked={formData.has_co_applicant} 
                    onChange={(e) => handleInputChange('has_co_applicant', e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                  Gibt es einen Mitbewerber (z.B. Partner, WG-Mitglied)?
                </label>
              </div>

              {formData.has_co_applicant && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', animation: 'fadeIn 0.3s ease' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Anrede</label>
                    <select 
                      value={formData.co_salutation}
                      onChange={(e) => handleInputChange('co_salutation', e.target.value)}
                      required
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: formData.co_salutation ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                    >
                      <option value="" disabled>Bitte wählen</option>
                      {SALUTATION_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Verhältnis zum Hauptbewerber</label>
                    <Input value={formData.co_relationship} onChange={(e) => handleInputChange('co_relationship', e.target.value)} placeholder="z.B. Ehepartner, Lebensgefährte" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Vorname</label>
                    <Input value={formData.co_first_name} onChange={(e) => handleInputChange('co_first_name', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Nachname</label>
                    <Input value={formData.co_last_name} onChange={(e) => handleInputChange('co_last_name', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Geburtsdatum</label>
                    <Input type="date" value={formData.co_birth_date} onChange={(e) => handleInputChange('co_birth_date', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>E-Mail-Adresse</label>
                    <Input type="email" value={formData.co_email} onChange={(e) => handleInputChange('co_email', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Telefonnummer</label>
                    <Input value={formData.co_phone} onChange={(e) => handleInputChange('co_phone', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Occupation & Income */}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Coins size={20} color="var(--primary-color)" /> Haushalt & Einkommen
              </h2>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Wie viele weitere Personen ziehen mit ein (Kinder/Angehörige)?</label>
                <Input type="number" min="0" value={formData.additional_persons_count} onChange={(e) => handleInputChange('additional_persons_count', parseInt(e.target.value) || 0)} />
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px' }}>Hauptbewerber: {formData.first_name} {formData.last_name}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer', height: '100%' }}>
                      <input 
                        type="checkbox" 
                        checked={formData.is_employed} 
                        onChange={(e) => handleInputChange('is_employed', e.target.checked)}
                      />
                      Ich bin unbefristet berufstätig
                    </label>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Monatliches Nettoeinkommen (€)</label>
                    <Input type="number" value={formData.monthly_income} onChange={(e) => handleInputChange('monthly_income', e.target.value)} placeholder="z.B. 2500" />
                  </div>
                </div>
              </div>

              {formData.has_co_applicant && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px' }}>Mitbewerber: {formData.co_first_name} {formData.co_last_name}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer', height: '100%' }}>
                        <input 
                          type="checkbox" 
                          checked={formData.co_is_employed} 
                          onChange={(e) => handleInputChange('co_is_employed', e.target.checked)}
                        />
                        Mitbewerber ist unbefristet berufstätig
                      </label>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Monatliches Nettoeinkommen (€)</label>
                      <Input type="number" value={formData.co_monthly_income} onChange={(e) => handleInputChange('co_monthly_income', e.target.value)} placeholder="z.B. 1800" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Current Address */}
          {step === 4 && (
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MapPin size={20} color="var(--primary-color)" /> Aktuelle Anschrift
              </h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Straße</label>
                  <Input value={formData.street} onChange={(e) => handleInputChange('street', e.target.value)} placeholder="Hauptstraße" />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Hausnummer</label>
                  <Input value={formData.house_number} onChange={(e) => handleInputChange('house_number', e.target.value)} placeholder="12a" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Postleitzahl</label>
                  <Input value={formData.postal_code} onChange={(e) => handleInputChange('postal_code', e.target.value)} placeholder="12345" />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Stadt</label>
                  <Input value={formData.city} onChange={(e) => handleInputChange('city', e.target.value)} placeholder="Musterstadt" />
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Declarations */}
          {step === 5 && (
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={20} color="var(--primary-color)" /> Eigenerklärungen
              </h2>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Bitte beantworten Sie die folgenden Fragen wahrheitsgemäß. Die Angaben sind Teil der Selbstauskunft.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* Frage 1 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    Bestehen Mietrückstände aus früheren Mietverhältnissen?
                  </span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_rent_arrears === true ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_rent_arrears" 
                        checked={formData.has_rent_arrears === true} 
                        onChange={() => handleInputChange('has_rent_arrears', true)} 
                      />
                      Ja
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_rent_arrears === false ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_rent_arrears" 
                        checked={formData.has_rent_arrears === false} 
                        onChange={() => handleInputChange('has_rent_arrears', false)} 
                      />
                      Nein
                    </label>
                  </div>
                </div>

                {/* Frage 2 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    Laufen gegen Sie Räumungs- oder Zahlungsklagen aus Mietverhältnissen?
                  </span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_eviction_lawsuits === true ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_eviction_lawsuits" 
                        checked={formData.has_eviction_lawsuits === true} 
                        onChange={() => handleInputChange('has_eviction_lawsuits', true)} 
                      />
                      Ja
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_eviction_lawsuits === false ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_eviction_lawsuits" 
                        checked={formData.has_eviction_lawsuits === false} 
                        onChange={() => handleInputChange('has_eviction_lawsuits', false)} 
                      />
                      Nein
                    </label>
                  </div>
                </div>

                {/* Frage 3 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    Läuft ein Verbraucherinsolvenzverfahren gegen Sie?
                  </span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_insolvency_proceedings === true ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_insolvency_proceedings" 
                        checked={formData.has_insolvency_proceedings === true} 
                        onChange={() => handleInputChange('has_insolvency_proceedings', true)} 
                      />
                      Ja
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_insolvency_proceedings === false ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_insolvency_proceedings" 
                        checked={formData.has_insolvency_proceedings === false} 
                        onChange={() => handleInputChange('has_insolvency_proceedings', false)} 
                      />
                      Nein
                    </label>
                  </div>
                </div>

                {/* Frage 4 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    Werden die Mietzahlungen durch Sozialleistungen (z. B. Bürgergeld, Sozialhilfe) finanziert?
                  </span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.receives_social_benefits === true ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="receives_social_benefits" 
                        checked={formData.receives_social_benefits === true} 
                        onChange={() => handleInputChange('receives_social_benefits', true)} 
                      />
                      Ja
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.receives_social_benefits === false ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="receives_social_benefits" 
                        checked={formData.receives_social_benefits === false} 
                        onChange={() => handleInputChange('receives_social_benefits', false)} 
                      />
                      Nein
                    </label>
                  </div>
                </div>

                {/* Frage 5 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                    Beabsichtigen Sie, Haustiere (Hunde/Katzen) in der Wohnung zu halten?
                  </span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_pets === true ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_pets" 
                        checked={formData.has_pets === true} 
                        onChange={() => handleInputChange('has_pets', true)} 
                      />
                      Ja
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: formData.has_pets === false ? 'bold' : 'normal' }}>
                      <input 
                        type="radio" 
                        name="has_pets" 
                        checked={formData.has_pets === false} 
                        onChange={() => handleInputChange('has_pets', false)} 
                      />
                      Nein
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 6: Document Uploads */}
          {step === 6 && (
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={20} color="var(--primary-color)" /> Dokumente hochladen
              </h2>
              
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                {getRequiredDocs(processInfo).length > 0
                  ? 'Der Vermieter fordert für dieses Objekt folgende Unterlagen an (je Datei höchstens 10 MB). Die Dateien werden an den Vermieter übermittelt und sind nur für ihn abrufbar.'
                  : 'Für dieses Objekt fordert der Vermieter aktuell keine Unterlagen an.'}
              </p>

              {Array.isArray(processInfo.custom_requirements) && processInfo.custom_requirements.length > 0 && (
                <div style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px' }}>Weitere Anforderungen des Vermieters:</div>
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {processInfo.custom_requirements.map((req, idx) => <li key={idx}>{req}</li>)}
                  </ul>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {DOC_ORDER.filter(docType => getRequiredDocs(processInfo).includes(docType)).map(docType => (
                  <div key={docType} style={{ border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>{DOC_CONFIG[docType].title}</label>
                    <input type="file" accept={DOC_CONFIG[docType].accept} onChange={(e) => handleFileChange(docType, e)} />
                    {files[docType] && <span style={{ color: 'var(--success-color)', fontSize: '0.75rem', display: 'block', marginTop: '6px' }}>✓ {files[docType].name} geladen</span>}
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '16px', lineHeight: 1.5 }}>
                Mit dem Absenden werden Ihre Angaben und Unterlagen an den Vermieter dieses Objekts übermittelt. Informationen zur Verarbeitung Ihrer Daten erhalten Sie beim Vermieter.
              </p>
            </div>
          )}

          {/* Navigation buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '28px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            {step > 1 ? (
              <Button type="button" variant="secondary" icon={ArrowLeft} onClick={handleBack} disabled={isSubmitting}>
                Zurück
              </Button>
            ) : <div />}

            {step < 6 ? (
              <Button type="button" variant="primary" onClick={handleNext}>
                Weiter <ArrowRight size={16} style={{ marginLeft: '6px' }} />
              </Button>
            ) : (
              <Button type="button" variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? 'Wird übermittelt…' : 'Bewerbung absenden'}
              </Button>
            )}
          </div>
        </Card>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Sicheres Bewerbungsverfahren • Powered by ImmoControlpro360 <Heart size={10} style={{ display: 'inline', fill: 'var(--danger-color)', stroke: 'none' }} />
        </div>
      </div>
    </div>
  );
};

export default PublicLettingPortal;
