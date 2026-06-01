import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { 
  Calendar, Clock, Check, AlertCircle, ArrowRight, Loader2, CalendarPlus, 
  Building2, MapPin, Info, ArrowLeft, Mail 
} from 'lucide-react';

const PublicViewingBooking = () => {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const applicantIdFromUrl = searchParams.get('applicantId');

  // Loading States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Data States
  const [processInfo, setProcessInfo] = useState(null);
  const [viewings, setViewings] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [applicantInfo, setApplicantInfo] = useState(null);

  // Verification State
  const [applicantIdState, setApplicantIdState] = useState(applicantIdFromUrl);
  const [emailInput, setEmailInput] = useState('');
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');

  // Selection States
  const [selectedViewing, setSelectedViewing] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [myBooking, setMyBooking] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch initial details
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // 1. Get process details
        const { data: proc, error: procErr } = await supabase.rpc('get_rental_process_by_token', { p_token: token });
        if (procErr) throw procErr;
        if (proc.error) {
          setError(proc.error);
          return;
        }
        setProcessInfo(proc);

        // 2. Fetch viewing days
        const { data: vws, error: vwsErr } = await supabase
          .from('rental_viewings')
          .select('*')
          .eq('process_id', proc.id)
          .order('date');
        
        if (vwsErr) throw vwsErr;
        setViewings(vws || []);

        if (vws && vws.length > 0) {
          // Select first viewing day by default
          setSelectedViewing(vws[0]);

          // 3. Fetch active bookings
          const { data: bks, error: bksErr } = await supabase
            .from('rental_viewing_bookings')
            .select('*')
            .in('viewing_id', vws.map(v => v.id))
            .eq('status', 'booked');
          if (bksErr) throw bksErr;
          setBookings(bks || []);
        }

        // 4. Fetch applicant info if applicantIdState is set
        if (applicantIdState) {
          const { data: app, error: appErr } = await supabase
            .from('rental_applicants')
            .select('*')
            .eq('id', applicantIdState)
            .single();
          if (!appErr) {
            setApplicantInfo(app);
          }
        }
      } catch (err) {
        setError('Die Termindaten konnten nicht geladen werden. Bitte wenden Sie sich an Ihren Vermieter.');
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchData();
  }, [token, applicantIdState]);

  // Compute time slots for selected viewing day
  const computedSlots = React.useMemo(() => {
    if (!selectedViewing) return [];
    
    const slots = [];
    const [startH, startM] = selectedViewing.start_time.split(':').map(Number);
    const [endH, endM] = selectedViewing.end_time.split(':').map(Number);
    const duration = selectedViewing.slot_duration_minutes;

    let current = new Date();
    current.setHours(startH, startM, 0, 0);

    const end = new Date();
    end.setHours(endH, endM, 0, 0);

    while (current < end) {
      const slotStart = current.toTimeString().substring(0, 5);
      
      // Add duration
      current.setMinutes(current.getMinutes() + duration);
      const slotEnd = current.toTimeString().substring(0, 5);

      if (current <= end) {
        // Check if this slot is already booked
        const isBooked = bookings.some(b => 
          b.viewing_id === selectedViewing.id && 
          b.start_time.substring(0, 5) === slotStart
        );

        slots.push({
          start: slotStart,
          end: slotEnd,
          isBooked
        });
      }
    }
    return slots;
  }, [selectedViewing, bookings]);

  // Verify email input
  const handleVerifyEmail = async () => {
    if (!emailInput.trim()) {
      setEmailError('Bitte geben Sie Ihre E-Mail-Adresse ein.');
      return;
    }
    try {
      setVerifyingEmail(true);
      setEmailError('');
      
      const { data, error: appErr } = await supabase
        .from('rental_applicants')
        .select('*')
        .eq('process_id', processInfo.id)
        .eq('email', emailInput.trim().toLowerCase())
        .maybeSingle();

      if (appErr) throw appErr;
      
      if (!data) {
        setEmailError('Unter dieser E-Mail-Adresse wurde keine aktive Bewerbung für diese Wohnung gefunden.');
        return;
      }

      setApplicantInfo(data);
      setApplicantIdState(data.id);
    } catch (err) {
      setEmailError('Fehler beim Prüfen der E-Mail: ' + err.message);
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleBookSlot = async () => {
    if (!selectedViewing || !selectedSlot) return alert('Bitte wählen Sie einen Termin aus.');
    if (!applicantIdState) {
      return alert('Um einen Termin zu buchen, müssen Sie sich zuerst verifizieren.');
    }

    try {
      setIsSubmitting(true);
      const { data: newBooking, error: bookingErr } = await supabase
        .from('rental_viewing_bookings')
        .insert([{
          viewing_id: selectedViewing.id,
          applicant_id: applicantIdState,
          start_time: selectedSlot.start,
          end_time: selectedSlot.end,
          status: 'booked'
        }])
        .select()
        .single();

      if (bookingErr) {
        if (bookingErr.code === '23505') {
          throw new Error('Dieser Termin wurde gerade von einem anderen Bewerber gebucht. Bitte wählen Sie einen anderen Slot.');
        }
        throw bookingErr;
      }

      setMyBooking(newBooking);
      setBookingSuccess(true);

      // Trigger email notification
      try {
        await supabase.functions.invoke('send-letting-email', {
          body: {
            action: 'booking_confirmed',
            bookingId: newBooking.id
          }
        });
      } catch (emailErr) {
        console.error('Failed to trigger booking confirmation email:', emailErr);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!myBooking) return;
    if (!window.confirm('Möchten Sie diesen Termin wirklich absagen?')) return;

    try {
      setIsSubmitting(true);
      const { error } = await supabase
        .from('rental_viewing_bookings')
        .update({ status: 'canceled', canceled_at: new Date().toISOString() })
        .eq('id', myBooking.id);

      if (error) throw error;

      // Trigger email cancellation
      try {
        await supabase.functions.invoke('send-letting-email', {
          body: {
            action: 'booking_canceled',
            bookingId: myBooking.id
          }
        });
      } catch (emailErr) {
        console.error('Failed to trigger booking cancellation email:', emailErr);
      }

      setBookingSuccess(false);
      setMyBooking(null);
      setSelectedSlot(null);

      // Refresh bookings
      const { data: bks } = await supabase
        .from('rental_viewing_bookings')
        .select('*')
        .in('viewing_id', viewings.map(v => v.id))
        .eq('status', 'booked');
      setBookings(bks || []);
    } catch (err) {
      alert('Absage fehlgeschlagen: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getGoogleCalendarLink = () => {
    if (!selectedViewing || !selectedSlot || !processInfo) return '#';
    const dateStr = selectedViewing.date.replace(/-/g, '');
    const startStr = selectedSlot.start.replace(/:/g, '') + '00';
    const endStr = selectedSlot.end.replace(/:/g, '') + '00';

    const text = encodeURIComponent(`Besichtigung: ${processInfo.listing_title}`);
    const details = encodeURIComponent(`Ihre gebuchte Wohnungsbesichtigung für die Einheit ${processInfo.unit_name}.`);
    const location = encodeURIComponent(`${processInfo.street} ${processInfo.house_number}, ${processInfo.city}`);
    
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dateStr}T${startStr}/${dateStr}T${endStr}&details=${details}&location=${location}`;
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '24px' }}>
        <Loader2 className="animate-spin" size={40} color="var(--primary-color)" />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Besichtigungstermine werden geladen...</p>
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

  if (bookingSuccess && myBooking && selectedViewing && selectedSlot) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '24px', fontFamily: 'var(--font-family)' }}>
        <Card style={{ maxWidth: '550px', width: '100%', padding: '32px', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Check size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '12px' }}>Termin erfolgreich reserviert!</h2>
          
          <div style={{ backgroundColor: 'var(--input-bg)', padding: '20px', borderRadius: 'var(--radius-md)', textAlign: 'left', marginBottom: '24px', border: '1px solid var(--border-color-soft)' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Ihr Besichtigungstermin</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px' }}>
              {new Date(selectedViewing.date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '1rem', fontWeight: 700, color: 'var(--primary-color)', marginTop: '8px' }}>
              <Clock size={16} /> {selectedSlot.start} - {selectedSlot.end} Uhr
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '12px', borderTop: '1px solid var(--border-color-soft)', paddingTop: '12px' }}>
              <strong>Adresse:</strong> {processInfo.street} {processInfo.house_number}, {processInfo.city}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <a 
              href={getGoogleCalendarLink()} 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ textDecoration: 'none' }}
            >
              <Button variant="primary" style={{ width: '100%', justifyContent: 'center', gap: '8px' }}>
                <CalendarPlus size={18} /> In Google Kalender eintragen
              </Button>
            </a>
            <Button variant="secondary" onClick={handleCancelBooking} loading={isSubmitting} style={{ width: '100%', justifyContent: 'center', color: 'var(--danger-color)', border: '1px solid var(--danger-color)', background: 'none' }}>
              Termin absagen / verschieben
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--background-color)', color: 'var(--text-primary)', padding: '40px 24px', fontFamily: 'var(--font-family)' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto' }}>
        
        {/* Exposé / Header (Matching letting portal) */}
        <Card style={{ padding: '24px', marginBottom: '24px', background: 'linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%)', color: '#ffffff' }}>
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', tracking: '0.1em', fontWeight: 700, color: 'rgba(255, 255, 255, 0.9)' }}>Besichtigungsportal</span>
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

        {/* Applicant Verification Status */}
        {applicantInfo ? (
          <div style={{ 
            backgroundColor: 'rgba(16, 185, 129, 0.1)', 
            color: 'var(--success-color)', 
            fontSize: '0.9rem', 
            padding: '12px 16px', 
            borderRadius: 'var(--radius-md)', 
            fontWeight: 600, 
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Check size={16} /> Angemeldet als Bewerber: {applicantInfo.first_name} {applicantInfo.last_name} ({applicantInfo.email})
          </div>
        ) : (
          /* Verification Form */
          <Card style={{ padding: '24px', marginBottom: '20px', border: '1px solid var(--border-color-soft)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={18} color="var(--primary-color)" /> Bewerber-Verifizierung
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              Bitte verifizieren Sie sich mit der E-Mail-Adresse, die Sie bei Ihrer Bewerbung eingegeben haben, um Ihren Termin zu buchen.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input 
                  type="email" 
                  placeholder="ihre.email@beispiel.de" 
                  value={emailInput} 
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setEmailError('');
                  }} 
                  style={{ 
                    flex: '1 1 200px',
                    padding: '10px 14px', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid var(--border-color-soft)', 
                    backgroundColor: 'var(--input-bg)', 
                    color: 'var(--text-primary)',
                    outline: 'none',
                    fontSize: '0.9rem'
                  }}
                />
                <Button 
                  type="button" 
                  variant="primary" 
                  loading={verifyingEmail}
                  onClick={handleVerifyEmail}
                >
                  Verifizieren
                </Button>
              </div>
              {emailError && (
                <span style={{ fontSize: '0.8rem', color: 'var(--danger-color)', display: 'block', fontWeight: 500 }}>
                  ⚠️ {emailError}
                </span>
              )}
            </div>
          </Card>
        )}

        {viewings.length === 0 ? (
          <Card style={{ padding: '32px', textAlign: 'center' }}>
            <AlertCircle size={40} color="var(--text-secondary)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>Keine Termine verfügbar</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Der Vermieter hat aktuell keine Besichtigungsblöcke freigegeben. Bitte wenden Sie sich direkt an ihn.</p>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Choose Viewing Day */}
            <Card style={{ padding: '20px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: '12px', color: 'var(--text-primary)' }}>
                1. Wählen Sie einen Besichtigungstag:
              </label>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                {viewings.map(v => {
                  const isSelected = selectedViewing?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelectedViewing(v);
                        setSelectedSlot(null);
                      }}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 'var(--radius-md)',
                        border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color-soft)',
                        backgroundColor: isSelected ? 'var(--hover-bg)' : 'var(--input-bg)',
                        color: isSelected ? 'var(--primary-color)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {new Date(v.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Choose Slot */}
            {selectedViewing && (
              <Card style={{ padding: '20px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: '12px', color: 'var(--text-primary)' }}>
                  2. Wählen Sie ein freies Zeitfenster:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                  {computedSlots.map((slot, idx) => {
                    const isSelected = selectedSlot?.start === slot.start;
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={slot.isBooked}
                        onClick={() => setSelectedSlot(slot)}
                        style={{
                          padding: '10px 8px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '2px solid var(--primary-color)' : '1px solid var(--border-color-soft)',
                          backgroundColor: slot.isBooked 
                            ? 'var(--border-color-soft)' 
                            : (isSelected ? 'var(--hover-bg)' : 'var(--input-bg)'),
                          color: slot.isBooked 
                            ? 'var(--text-secondary)' 
                            : (isSelected ? 'var(--primary-color)' : 'var(--text-primary)'),
                          cursor: slot.isBooked ? 'not-allowed' : 'pointer',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minHeight: '52px'
                        }}
                      >
                        <span>{slot.start}</span>
                        {slot.isBooked ? (
                          <span style={{ fontSize: '0.65rem', color: 'var(--danger-color)', fontWeight: 600, marginTop: '2px' }}>belegt</span>
                        ) : (
                          <span style={{ fontSize: '0.65rem', color: 'var(--success-color)', fontWeight: 600, marginTop: '2px' }}>frei</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Confirm Actions */}
            {selectedSlot && (
              <Card style={{ padding: '20px', textAlign: 'center', border: '1px solid var(--primary-color)' }}>
                <p style={{ fontSize: '0.9rem', marginBottom: '14px', color: 'var(--text-primary)' }}>
                  Sie haben <strong>{selectedSlot.start} - {selectedSlot.end} Uhr</strong> am{' '}
                  <strong>{new Date(selectedViewing.date).toLocaleDateString('de-DE')}</strong> ausgewählt.
                </p>
                {applicantInfo ? (
                  <Button 
                    variant="primary" 
                    style={{ width: '100%', justifyContent: 'center' }} 
                    onClick={handleBookSlot}
                    loading={isSubmitting}
                  >
                    Termin verbindlich buchen
                  </Button>
                ) : (
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--danger-color)', marginBottom: '12px', fontWeight: 600 }}>
                      Bitte verifizieren Sie sich zuerst oben mit Ihrer Bewerber-E-Mail, um diesen Termin zu buchen.
                    </p>
                    <Button 
                      variant="primary" 
                      style={{ width: '100%', justifyContent: 'center' }} 
                      disabled
                    >
                      Termin verbindlich buchen
                    </Button>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicViewingBooking;
