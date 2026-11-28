import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import {
  Calendar, Clock, Check, AlertCircle, ArrowRight, Loader2, CalendarPlus,
  Building2, MapPin, Info, ArrowLeft, Mail
} from 'lucide-react';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lokales Datum (nicht UTC) als YYYY-MM-DD
const localDateString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD' als lokales Datum (new Date('YYYY-MM-DD') wäre UTC-Mitternacht -> ggf. Vortag)
const parseLocalDate = (value) => {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const formatDate = (value, options) => {
  const d = parseLocalDate(value);
  return d ? d.toLocaleDateString('de-DE', options) : '—';
};

const toMinutes = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return (isNaN(h) || isNaN(m)) ? NaN : h * 60 + m;
};

const fromMinutes = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const shortTime = (time) => String(time || '').substring(0, 5);

// Besichtigungstage (ab heute) und belegte Slots laden – über die Token-RPC
// (nicht angemeldete Besucher haben keine Tabellenrechte, nur die geprüften Funktionen)
const fetchSchedule = async (token) => {
  const { data, error } = await supabase.rpc('get_rental_viewing_schedule', { p_token: token });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { viewings: data?.viewings || [], booked: data?.booked || [] };
};

// Bewerber aus dem persönlichen Link (Token + Bewerber-ID) samt eigener künftiger Buchung
const fetchApplicant = async (token, applicantId) => {
  const { data, error } = await supabase.rpc('get_rental_applicant_for_booking', {
    p_token: token,
    p_applicant_id: applicantId
  });
  if (error) throw error;
  return data || null;
};

const PublicViewingBooking = () => {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const rawApplicantId = searchParams.get('applicantId');
  // Bewerber-ID nur aus dem persönlichen Link; ungültige Werte werden ignoriert
  const applicantId = rawApplicantId && UUID_RE.test(rawApplicantId) ? rawApplicantId.toLowerCase() : null;

  // Loading States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data States
  const [processInfo, setProcessInfo] = useState(null);
  const [viewings, setViewings] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]);
  const [applicantInfo, setApplicantInfo] = useState(null);
  const [applicantLoading, setApplicantLoading] = useState(!!applicantId);

  // Selection States
  const [selectedViewingId, setSelectedViewingId] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [myBooking, setMyBooking] = useState(null); // { id, viewing_id, date, start_time, end_time }
  const [justBooked, setJustBooked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Hinweis, wenn die Bestätigungs-/Absage-Mail nicht versendet werden konnte
  const [mailWarning, setMailWarning] = useState(null);

  const processId = processInfo?.id;

  // Stammdaten (Vorgang + Terminplan) – nur abhängig vom Token
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        const { data: proc, error: procErr } = await supabase.rpc('get_rental_process_by_token', { p_token: token });
        if (procErr) throw procErr;
        if (!proc || proc.error) {
          if (!cancelled) setError(proc?.error || 'Mietobjekt ist nicht mehr aktiv oder Link ist ungültig.');
          return;
        }
        const schedule = await fetchSchedule(token);
        if (cancelled) return;
        setProcessInfo(proc);
        setViewings(schedule.viewings);
        setBookedSlots(schedule.booked);
        // Ersten Besichtigungstag nur vorwählen, wenn noch keiner gewählt ist
        setSelectedViewingId(prev => prev || schedule.viewings[0]?.id || null);
      } catch {
        if (!cancelled) setError('Die Termindaten konnten nicht geladen werden. Bitte wenden Sie sich an Ihren Vermieter.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (token) fetchData();
    return () => { cancelled = true; };
  }, [token]);

  // Bewerber aus dem persönlichen Link laden (eigener Effekt, setzt Tag/Slot nicht zurück)
  useEffect(() => {
    if (!processId || !applicantId) return undefined;
    let cancelled = false;
    const loadApplicant = async () => {
      try {
        const info = await fetchApplicant(token, applicantId);
        if (cancelled) return;
        setApplicantInfo(info);
        setMyBooking(info?.booking || null);
      } catch (err) {
        console.error('Applicant lookup failed:', err);
      } finally {
        if (!cancelled) setApplicantLoading(false);
      }
    };
    loadApplicant();
    return () => { cancelled = true; };
  }, [token, processId, applicantId]);

  const selectedViewing = viewings.find(v => v.id === selectedViewingId) || null;

  const refreshSchedule = async () => {
    if (!processId) return;
    try {
      const schedule = await fetchSchedule(token);
      setViewings(schedule.viewings);
      setBookedSlots(schedule.booked);
    } catch (err) {
      console.error('Schedule refresh failed:', err);
    }
  };

  // Compute time slots for selected viewing day (ohne bereits verstrichene Slots von heute)
  const computeSlots = () => {
    if (!selectedViewing) return [];
    const duration = Number(selectedViewing.slot_duration_minutes);
    const start = toMinutes(selectedViewing.start_time);
    const end = toMinutes(selectedViewing.end_time);
    if (!(duration > 0) || isNaN(start) || isNaN(end)) return [];

    const now = new Date();
    const isToday = String(selectedViewing.date).slice(0, 10) === localDateString(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = [];
    for (let current = start; current + duration <= end; current += duration) {
      if (isToday && current <= nowMinutes) continue;
      const slotStart = fromMinutes(current);
      const isBooked = bookedSlots.some(b =>
        b.viewing_id === selectedViewing.id &&
        shortTime(b.start_time) === slotStart
      );
      slots.push({ start: slotStart, end: fromMinutes(current + duration), isBooked });
    }
    return slots;
  };
  const computedSlots = computeSlots();

  // Liefert true, wenn die Mail versendet wurde. Fachliche Fehler (z. B. kein Postfach
  // eingerichtet, SMTP-Fehler) meldet die Function mit HTTP 200 und success: false.
  const sendLettingEmail = async (action, booking) => {
    try {
      const { data, error: emailErr } = await supabase.functions.invoke('send-letting-email', {
        body: {
          action,
          bookingId: booking.id,
          booking_id: booking.id,
          applicant_id: applicantInfo?.id,
          process_token: token
        }
      });
      if (emailErr) {
        console.error(`Failed to trigger ${action} email:`, emailErr);
        return false;
      }
      if (data?.success === false) {
        console.warn(`${action} email not sent:`, data.error || data.warning);
        return false;
      }
      return true;
    } catch (emailErr) {
      console.error(`Failed to trigger ${action} email:`, emailErr);
      return false;
    }
  };

  const handleBookSlot = async () => {
    if (isSubmitting) return;
    if (!selectedViewing || !selectedSlot) return alert('Bitte wählen Sie einen Termin aus.');
    if (!applicantInfo) {
      return alert('Bitte öffnen Sie diese Seite über den persönlichen Link aus Ihrer Bestätigungs-E-Mail, um einen Termin zu buchen.');
    }
    if (!applicantInfo.can_book) return alert('Für Ihre Bewerbung ist keine Terminbuchung möglich.');
    if (myBooking) return alert('Sie haben bereits einen Termin gebucht. Bitte sagen Sie diesen zuerst ab, wenn Sie einen anderen Termin wählen möchten.');

    try {
      setIsSubmitting(true);
      setMailWarning(null);

      const { data: booking, error: rpcErr } = await supabase.rpc('book_viewing', {
        p_token: token,
        p_applicant_id: applicantInfo.id,
        p_viewing_id: selectedViewing.id,
        p_start_time: selectedSlot.start
      });

      if (rpcErr) {
        if (rpcErr.code === '23505') {
          throw new Error('Dieser Termin wurde gerade von einem anderen Bewerber gebucht. Bitte wählen Sie einen anderen Slot.');
        }
        throw rpcErr;
      }

      setMyBooking(booking);
      setJustBooked(true);
      setSelectedSlot(null);

      // Trigger email notification (Empfänger ermittelt die Function aus der Datenbank)
      const mailSent = await sendLettingEmail('booking_confirmed', booking);
      if (!mailSent) {
        setMailWarning('Termin gebucht – die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte notieren Sie sich den Termin.');
      }
      refreshSchedule();
    } catch (err) {
      alert(err.message || 'Die Buchung ist fehlgeschlagen.');
      refreshSchedule();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!myBooking || isSubmitting) return;
    if (!window.confirm('Möchten Sie diesen Termin wirklich absagen?')) return;

    try {
      setIsSubmitting(true);
      setMailWarning(null);
      const booking = myBooking;

      const { error: rpcErr } = await supabase.rpc('cancel_viewing_booking', {
        p_token: token,
        p_booking_id: booking.id,
        p_applicant_id: applicantInfo?.id
      });

      if (rpcErr) throw rpcErr;

      // Trigger email cancellation
      const mailSent = await sendLettingEmail('booking_canceled', booking);
      if (!mailSent) {
        setMailWarning('Termin abgesagt – die Absage-Bestätigung per E-Mail konnte nicht versendet werden.');
      }

      setJustBooked(false);
      setMyBooking(null);
      setSelectedSlot(null);
      setSelectedViewingId(booking.viewing_id || selectedViewingId);
      refreshSchedule();
    } catch (err) {
      alert('Absage fehlgeschlagen: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderMailWarning = () => (
    <div style={{ textAlign: 'left', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: '20px', fontSize: '0.85rem', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
      <span>{mailWarning}</span>
    </div>
  );

  const getGoogleCalendarLink = () => {
    if (!myBooking || !processInfo) return '#';
    const dateStr = String(myBooking.date).slice(0, 10).replace(/-/g, '');
    const startStr = shortTime(myBooking.start_time).replace(/:/g, '') + '00';
    const endStr = shortTime(myBooking.end_time).replace(/:/g, '') + '00';

    const text = encodeURIComponent(`Besichtigung: ${processInfo.listing_title}`);
    const details = encodeURIComponent(`Ihre gebuchte Wohnungsbesichtigung für die Einheit ${processInfo.unit_name}.`);
    const location = encodeURIComponent(`${processInfo.street} ${processInfo.house_number}, ${processInfo.zip} ${processInfo.city}`);

    // ctz: Uhrzeiten sind deutsche Ortszeit
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dateStr}T${startStr}/${dateStr}T${endStr}&ctz=Europe/Berlin&details=${details}&location=${location}`;
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

  // Gebuchter Termin (direkt nach der Buchung oder beim erneuten Aufruf des persönlichen Links)
  if (myBooking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--background-color)', padding: '24px', fontFamily: 'var(--font-family)' }}>
        <Card style={{ maxWidth: '550px', width: '100%', padding: '32px', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Check size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '12px' }}>
            {justBooked ? 'Termin erfolgreich reserviert!' : 'Ihr gebuchter Besichtigungstermin'}
          </h2>

          <div style={{ backgroundColor: 'var(--input-bg)', padding: '20px', borderRadius: 'var(--radius-md)', textAlign: 'left', marginBottom: '24px', border: '1px solid var(--border-color-soft)' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Ihr Besichtigungstermin</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px' }}>
              {formatDate(myBooking.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '1rem', fontWeight: 700, color: 'var(--primary-color)', marginTop: '8px' }}>
              <Clock size={16} /> {shortTime(myBooking.start_time)} - {shortTime(myBooking.end_time)} Uhr
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '12px', borderTop: '1px solid var(--border-color-soft)', paddingTop: '12px' }}>
              <strong>Adresse:</strong> {processInfo.street} {processInfo.house_number}, {processInfo.zip} {processInfo.city}
            </div>
          </div>

          {mailWarning && renderMailWarning()}

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
            <Button variant="secondary" onClick={handleCancelBooking} disabled={isSubmitting} style={{ width: '100%', justifyContent: 'center', color: 'var(--danger-color)', border: '1px solid var(--danger-color)', background: 'none' }}>
              {isSubmitting ? 'Wird abgesagt…' : 'Termin absagen / verschieben'}
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
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, color: 'rgba(255, 255, 255, 0.9)' }}>Besichtigungsportal</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ffffff', marginTop: '6px' }}>{processInfo.listing_title}</h1>
          <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MapPin size={14} /> {processInfo.street} {processInfo.house_number}, {processInfo.zip} {processInfo.city}
          </p>

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

        {/* z. B. nach einer Absage, deren Bestätigungs-Mail nicht versendet werden konnte */}
        {mailWarning && renderMailWarning()}

        {/* Applicant Verification Status */}
        {applicantLoading ? (
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', padding: '12px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Loader2 className="animate-spin" size={16} /> Bewerbung wird geprüft...
          </div>
        ) : applicantInfo ? (
          <div style={{
            backgroundColor: applicantInfo.can_book ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.08)',
            color: applicantInfo.can_book ? 'var(--success-color)' : 'var(--danger-color)',
            fontSize: '0.9rem',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {applicantInfo.can_book ? <Check size={16} /> : <AlertCircle size={16} />}
            {applicantInfo.can_book
              ? <>Angemeldet als Bewerber{(applicantInfo.first_name || applicantInfo.last_name) ? `: ${applicantInfo.first_name || ''} ${applicantInfo.last_name || ''}` : ''}</>
              : <>Für die Bewerbung von {applicantInfo.first_name} {applicantInfo.last_name} ist keine Terminbuchung (mehr) möglich.</>}
          </div>
        ) : (
          /* Persönlicher Link erforderlich */
          <Card style={{ padding: '24px', marginBottom: '20px', border: '1px solid var(--border-color-soft)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={18} color="var(--primary-color)" /> Persönlicher Buchungslink erforderlich
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>
              {applicantId
                ? 'Zu diesem Link wurde keine aktive Bewerbung gefunden. Bitte nutzen Sie den Link aus Ihrer aktuellen Bestätigungs-E-Mail.'
                : 'Um einen Termin zu buchen, öffnen Sie diese Seite bitte über den persönlichen Link aus Ihrer Bestätigungs-E-Mail oder direkt nach dem Absenden Ihrer Bewerbung.'}
            </p>
            <Link to={`/vermietung/${token}`} style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-color)' }}>
              Noch nicht beworben? Zur Bewerbung
            </Link>
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
                        setSelectedViewingId(v.id);
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
                      {formatDate(v.date, { weekday: 'short', day: 'numeric', month: 'short' })}
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
                {computedSlots.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>An diesem Tag sind keine Zeitfenster mehr verfügbar.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                    {computedSlots.map((slot) => {
                      const isSelected = selectedSlot?.start === slot.start;
                      return (
                        <button
                          key={slot.start}
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
                )}
              </Card>
            )}

            {/* Confirm Actions */}
            {selectedSlot && selectedViewing && (
              <Card style={{ padding: '20px', textAlign: 'center', border: '1px solid var(--primary-color)' }}>
                <p style={{ fontSize: '0.9rem', marginBottom: '14px', color: 'var(--text-primary)' }}>
                  Sie haben <strong>{selectedSlot.start} - {selectedSlot.end} Uhr</strong> am{' '}
                  <strong>{formatDate(selectedViewing.date)}</strong> ausgewählt.
                </p>
                {applicantInfo && applicantInfo.can_book ? (
                  <Button
                    variant="primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={handleBookSlot}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Wird gebucht…' : 'Termin verbindlich buchen'}
                  </Button>
                ) : (
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--danger-color)', marginBottom: '12px', fontWeight: 600 }}>
                      {applicantInfo
                        ? 'Für Ihre Bewerbung ist keine Terminbuchung möglich.'
                        : 'Bitte öffnen Sie diese Seite über Ihren persönlichen Buchungslink, um diesen Termin zu buchen.'}
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
