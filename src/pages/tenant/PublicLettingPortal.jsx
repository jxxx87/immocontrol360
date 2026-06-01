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

  // Form State
  const [formData, setFormData] = useState({
    // Step 1: General Info & Contact
    earliest_move_in: '',
    salutation: 'Herr',
    first_name: '',
    last_name: '',
    birth_date: '',
    marital_status: 'ledig',
    phone: '',
    email: '',
    introduction: '',

    // Step 2: Co-Applicant
    has_co_applicant: false,
    co_salutation: 'Herr',
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
      } catch (err) {
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

  const handleFileChange = (docType, file) => {
    setFiles(prev => ({ ...prev, [docType]: file }));
  };

  const validateStep = () => {
    if (step === 1) {
      if (!formData.first_name.trim()) return 'Bitte geben Sie Ihren Vornamen ein.';
      if (!formData.last_name.trim()) return 'Bitte geben Sie Ihren Nachnamen ein.';
      if (!formData.email.trim()) return 'Bitte geben Sie Ihre E-Mail-Adresse ein.';
      if (!formData.phone.trim()) return 'Bitte geben Sie Ihre Telefonnummer ein.';
    }
    if (step === 2 && formData.has_co_applicant) {
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

  const handleSubmit = async () => {
    // Validate final step documents
    const missingDocs = [];
    if (processInfo.required_documents.includes('schufa') && !files.schufa) missingDocs.push('Schufa-Auskunft');
    if (processInfo.required_documents.includes('income_proof') && !files.income_proof) missingDocs.push('Gehaltsnachweis');
    if (processInfo.required_documents.includes('id_copy') && !files.id_copy) missingDocs.push('Ausweiskopie');
    if (processInfo.required_documents.includes('previous_landlord') && !files.previous_landlord) missingDocs.push('Vorvermieterbescheinigung');

    if (missingDocs.length > 0) {
      alert(`Bitte laden Sie die folgenden erforderlichen Dokumente hoch: ${missingDocs.join(', ')}`);
      return;
    }

    try {
      setIsSubmitting(true);

      // 1. Insert applicant row
      const applicantPayload = {
        process_id: processInfo.id,
        user_id: processInfo.user_id, // Landlord's user_id
        status: 'applied',
        
        earliest_move_in: formData.earliest_move_in || null,
        salutation: formData.salutation,
        first_name: formData.first_name,
        last_name: formData.last_name,
        birth_date: formData.birth_date || null,
        marital_status: formData.marital_status,
        phone: formData.phone,
        email: formData.email,
        introduction: formData.introduction,

        has_co_applicant: formData.has_co_applicant,
        co_salutation: formData.has_co_applicant ? formData.co_salutation : null,
        co_first_name: formData.has_co_applicant ? formData.co_first_name : null,
        co_last_name: formData.has_co_applicant ? formData.co_last_name : null,
        co_birth_date: (formData.has_co_applicant && formData.co_birth_date) ? formData.co_birth_date : null,
        co_relationship: formData.has_co_applicant ? formData.co_relationship : null,
        co_email: formData.has_co_applicant ? formData.co_email : null,
        co_phone: formData.has_co_applicant ? formData.co_phone : null,

        additional_persons_count: parseInt(formData.additional_persons_count) || 0,
        is_employed: formData.is_employed,
        monthly_income: parseFloat(formData.monthly_income) || null,
        co_is_employed: formData.has_co_applicant ? formData.co_is_employed : false,
        co_monthly_income: (formData.has_co_applicant && formData.co_monthly_income) ? parseFloat(formData.co_monthly_income) : null,

        street: formData.street,
        house_number: formData.house_number,
        postal_code: formData.postal_code,
        city: formData.city,

        has_rent_arrears: formData.has_rent_arrears,
        has_eviction_lawsuits: formData.has_eviction_lawsuits,
        has_insolvency_proceedings: formData.has_insolvency_proceedings,
        receives_social_benefits: formData.receives_social_benefits,
        has_pets: formData.has_pets,
      };

      const { data: appData, error: appErr } = await supabase
        .from('rental_applicants')
        .insert([applicantPayload])
        .select()
        .single();

      if (appErr) throw appErr;

      const applicantId = appData.id;
      setNewApplicantId(applicantId);

      // 2. Upload documents to Supabase storage
      for (const [docType, fileObj] of Object.entries(files)) {
        if (!fileObj) continue;
        const fileExt = fileObj.name.split('.').pop();
        const storagePath = `${applicantId}/${docType}.${fileExt}`;
        
        const { error: uploadErr } = await supabase.storage
          .from('applicant-documents')
          .upload(storagePath, fileObj);

        if (uploadErr) console.error(`Failed to upload document ${docType}:`, uploadErr);
      }

      // 3. Trigger edge function to sync files to landlord cloud
      await supabase.functions.invoke('sync-applicant-files', {
        body: { applicantId }
      });

      // 4. Trigger email dispatch Edge Function
      try {
        await supabase.functions.invoke('send-letting-email', {
          body: {
            action: 'application_received',
            applicantId
          }
        });
      } catch (emailErr) {
        console.error('Failed to trigger confirmation email:', emailErr);
      }

      setSubmitSuccess(true);
    } catch (err) {
      alert('Fehler beim Übermitteln der Bewerbung: ' + err.message);
    } finally {
      setIsSubmitting(false);
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
            Vielen Dank für Ihr Interesse an der Wohnung. Ihre Angaben und Unterlagen wurden sicher verschlüsselt an den Vermieter übertragen.
          </p>
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
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', tracking: '0.1em', fontWeight: 700, color: 'rgba(255, 255, 255, 0.9)' }}>Bewerbungsportal</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ffffff', marginTop: '6px' }}>{processInfo.listing_title}</h1>
          <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MapPin size={14} /> {processInfo.street} {processInfo.house_number}, {processInfo.zip} {processInfo.city}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '16px' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>Kaltmiete</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{processInfo.target_rent.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>Nebenkosten</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{(processInfo.service_charge_soll + processInfo.heating_cost_soll).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>Größe</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{processInfo.sqm} m²</div>
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
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)' }}
                  >
                    <option value="Herr">Herr</option>
                    <option value="Frau">Frau</option>
                    <option value="Divers">Divers</option>
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
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)', color: 'var(--text-primary)' }}
                    >
                      <option value="Herr">Herr</option>
                      <option value="Frau">Frau</option>
                      <option value="Divers">Divers</option>
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
                Der Vermieter fordert für dieses Objekt folgende Unterlagen an. Die Dateien werden direkt in die Cloud des Vermieters hochgeladen.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {processInfo.required_documents.includes('schufa') && (
                  <div style={{ border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Schufa-Auskunft (PDF)*</label>
                    <input type="file" accept="application/pdf" onChange={(e) => handleFileChange('schufa', e.target.files[0])} />
                    {files.schufa && <span style={{ color: 'var(--success-color)', fontSize: '0.75rem', display: 'block', marginTop: '6px' }}>✓ {files.schufa.name} geladen</span>}
                  </div>
                )}

                {processInfo.required_documents.includes('income_proof') && (
                  <div style={{ border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Gehaltsnachweise der letzten 3 Monate (PDF)*</label>
                    <input type="file" accept="application/pdf" onChange={(e) => handleFileChange('income_proof', e.target.files[0])} />
                    {files.income_proof && <span style={{ color: 'var(--success-color)', fontSize: '0.75rem', display: 'block', marginTop: '6px' }}>✓ {files.income_proof.name} geladen</span>}
                  </div>
                )}

                {processInfo.required_documents.includes('id_copy') && (
                  <div style={{ border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Ausweiskopie (Vorder- und Rückseite, PDF/Bild)*</label>
                    <input type="file" accept="application/pdf,image/*" onChange={(e) => handleFileChange('id_copy', e.target.files[0])} />
                    {files.id_copy && <span style={{ color: 'var(--success-color)', fontSize: '0.75rem', display: 'block', marginTop: '6px' }}>✓ {files.id_copy.name} geladen</span>}
                  </div>
                )}

                {processInfo.required_documents.includes('previous_landlord') && (
                  <div style={{ border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Vorvermieterbescheinigung (PDF)*</label>
                    <input type="file" accept="application/pdf" onChange={(e) => handleFileChange('previous_landlord', e.target.files[0])} />
                    {files.previous_landlord && <span style={{ color: 'var(--success-color)', fontSize: '0.75rem', display: 'block', marginTop: '6px' }}>✓ {files.previous_landlord.name} geladen</span>}
                  </div>
                )}
              </div>
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
              <Button type="button" variant="primary" onClick={handleSubmit} loading={isSubmitting}>
                Bewerbung absenden
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
