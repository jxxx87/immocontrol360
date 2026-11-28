import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Scale, Lock, Clock, Calendar, CheckCircle2, FileText, Send, Loader2, CreditCard, LogOut } from 'lucide-react';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import QRCode from 'qrcode';

// Standard-Ratenoptionen, falls der Vermieter keine eigenen hinterlegt hat.
// Muss mit claim_portal_installment_options() in der Datenbank übereinstimmen
// (die neue Datenbank-Fassung liefert die Optionen bereits bereinigt mit).
const DEFAULT_INSTALLMENT_OPTIONS = [
    { months: 3, surcharge_percent: 7 },
    { months: 6, surcharge_percent: 9 },
    { months: 12, surcharge_percent: 12 }
];

// Status, aus denen eine Ratenzahlungsanfrage möglich ist (Fallback für den alten
// Datenbank-Stand ohne payment_plan_request_allowed).
const REQUESTABLE_STATUSES = ['draft', 'open', 'sent', 'action_required'];

// Fehlercodes (HINT bzw. code) der Portal-RPCs, bei denen eine erneute PIN-Eingabe nichts bringt
const FATAL_ERROR_CODES = ['link_invalid', 'link_revoked', 'link_expired', 'link_locked', 'claim_closed'];

const MAX_MESSAGE_LENGTH = 2000;

const roundCents = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

const isPresentNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

// Gleiche Regeln wie claim_portal_installment_options(): ungültige Einträge entfallen,
// je Laufzeit zählt der erste Eintrag, leeres Array = keine Ratenzahlung über das Portal.
const normalizeInstallmentOptions = (raw) => {
    let options = raw;
    if (options === null || options === undefined) return DEFAULT_INSTALLMENT_OPTIONS;
    if (typeof options === 'string') {
        try {
            options = JSON.parse(options);
        } catch {
            return DEFAULT_INSTALLMENT_OPTIONS;
        }
    }
    if (!Array.isArray(options)) return DEFAULT_INSTALLMENT_OPTIONS;

    const seen = new Set();
    const result = [];
    options.forEach(opt => {
        if (!opt || typeof opt !== 'object') return;
        if (!isPresentNumber(opt.months) || !isPresentNumber(opt.surcharge_percent)) return;
        const months = Number(opt.months);
        const surcharge = Number(opt.surcharge_percent);
        if (!Number.isInteger(months) || months < 1 || months > 120) return;
        if (surcharge < 0 || surcharge > 100) return;
        if (seen.has(months)) return;
        seen.add(months);
        result.push({ months, surcharge_percent: surcharge });
    });
    return result.sort((a, b) => a.months - b.months);
};

// Fachliche Meldungen der Portal-RPCs (RAISE EXCEPTION, SQLSTATE P0001) dürfen angezeigt
// werden, technische Datenbank- oder Netzwerkfehler nicht.
const getPortalErrorMessage = (err, fallback) => {
    if (err && err.code === 'P0001' && err.message) return err.message;
    return fallback;
};

const storageKey = (token) => `claim_pin_${token}`;

// Automatische Anmeldung nach dem Neuladen nur innerhalb dieser Zeit seit der letzten Aktivität;
// ebenso Abmeldung bei Inaktivität in einem offenen Tab.
const SESSION_IDLE_MS = 15 * 60 * 1000;

// Gespeichert wird { pin, ts } (ts = letzte Aktivität). Abgelaufene oder alte Einträge
// (nur PIN, ohne Zeitstempel) werden verworfen.
const readStoredPin = (token) => {
    try {
        const raw = sessionStorage.getItem(storageKey(token));
        if (!raw) return null;
        let entry = null;
        try {
            entry = JSON.parse(raw);
        } catch {
            entry = null;
        }
        const ts = Number(entry?.ts);
        if (!entry || typeof entry.pin !== 'string' || !Number.isFinite(ts) || Date.now() - ts > SESSION_IDLE_MS || ts > Date.now() + 60000) {
            sessionStorage.removeItem(storageKey(token));
            return null;
        }
        return entry.pin;
    } catch {
        return null;
    }
};

const storePin = (token, value) => {
    try {
        sessionStorage.setItem(storageKey(token), JSON.stringify({ pin: value, ts: Date.now() }));
    } catch {
        // Speicher nicht verfügbar (z. B. privater Modus): dann eben ohne automatische Anmeldung
    }
};

const clearStoredPin = (token) => {
    try {
        sessionStorage.removeItem(storageKey(token));
    } catch {
        // ignorieren
    }
};

export default function ClaimPortal() {
    const { token } = useParams();

    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fatalError, setFatalError] = useState(null);
    const [claimData, setClaimData] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Request Payment Plan State
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [requestOption, setRequestOption] = useState(null);
    const [tenantMessage, setTenantMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestSuccess, setRequestSuccess] = useState(false);
    const [requestError, setRequestError] = useState(null);

    // EPC-QR-Code State
    const [qrCodeUrl, setQrCodeUrl] = useState('');

    // Zeitpunkt der letzten Aktivität (automatische Abmeldung nach SESSION_IDLE_MS)
    const lastActivityRef = useRef(0);

    const failLogin = (message, code) => {
        clearStoredPin(token);
        setIsAuthenticated(false);
        setClaimData(null);
        setPin('');
        setError(message);
        if (FATAL_ERROR_CODES.includes(code)) {
            setFatalError(message);
        }
    };

    const loadClaimData = async (enteredPin) => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_public_claim_by_token', {
                p_token: token,
                p_pin: enteredPin
            });

            if (rpcError) {
                console.error(rpcError);
                failLogin(
                    getPortalErrorMessage(rpcError, 'Die Forderung konnte nicht geladen werden. Bitte versuchen Sie es später erneut.'),
                    rpcError.hint
                );
                return;
            }

            // Neue Datenbank-Fassung: falsche PIN wird als Ergebnis gemeldet (Fehlversuch wird gezählt)
            if (data && data.error) {
                let message = data.error;
                if (data.code === 'invalid_pin' && Number(data.attempts_left) > 0) {
                    message += ` Verbleibende Versuche: ${data.attempts_left}.`;
                }
                failLogin(message, data.code);
                return;
            }

            if (!data || !data.claim_id) {
                failLogin('Keine Daten gefunden.', null);
                return;
            }

            setClaimData(data);
            setIsAuthenticated(true);
            setPin(enteredPin);
            storePin(token, enteredPin);
        } catch (err) {
            console.error(err);
            failLogin('Die Forderung konnte nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.', null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!token) return;
        const savedPin = readStoredPin(token);
        if (savedPin) {
            loadClaimData(savedPin);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    useEffect(() => {
        if (claimData?.bank_details?.iban && claimData?.totals?.total_due > 0) {
            const epcString = [
                'BCD',
                '002',
                '1',
                'SCT',
                (claimData.bank_details.bic || '').trim().toUpperCase(),
                (claimData.bank_details.account_holder || '').trim().substring(0, 70),
                (claimData.bank_details.iban || '').trim().replace(/\s+/g, '').toUpperCase(),
                `EUR${parseFloat(claimData.totals.total_due || 0).toFixed(2)}`,
                '',
                '',
                `Mahnung-${claimData.claim_id.substring(0, 8).toUpperCase()}`,
                ''
            ].join('\n');

            QRCode.toDataURL(epcString, { width: 256, margin: 2 }, (err, url) => {
                if (err) {
                    console.error('Error generating EPC QR Code:', err);
                } else {
                    setQrCodeUrl(url);
                }
            });
        }
    }, [claimData]);

    const handleLogin = async (e) => {
        e.preventDefault();
        await loadClaimData(pin.trim());
    };

    const handleLogout = () => {
        clearStoredPin(token);
        setClaimData(null);
        setIsAuthenticated(false);
        setPin('');
        setError(null);
        setRequestSuccess(false);
        setShowRequestModal(false);
        setRequestError(null);
        setTenantMessage('');
        setRequestOption(null);
        setQrCodeUrl('');
    };

    // Angemeldet: Aktivität merken (Zeitstempel im Speicher höchstens alle 30 s erneuern) und
    // nach 15 Minuten ohne Aktivität abmelden – auch wenn der Tab offen bleibt.
    useEffect(() => {
        if (!isAuthenticated || !token) return undefined;
        lastActivityRef.current = Date.now();

        const markActivity = () => {
            const now = Date.now();
            if (now - lastActivityRef.current < 30000) return;
            lastActivityRef.current = now;
            if (pin) storePin(token, pin);
        };
        const checkIdle = () => {
            if (Date.now() - lastActivityRef.current > SESSION_IDLE_MS) {
                handleLogout();
                setError('Sie wurden nach 15 Minuten ohne Aktivität abgemeldet. Bitte geben Sie den Zugangscode erneut ein.');
            }
        };
        const activityEvents = ['pointerdown', 'keydown', 'touchstart'];
        activityEvents.forEach(ev => window.addEventListener(ev, markActivity, { passive: true }));
        document.addEventListener('visibilitychange', checkIdle);
        const timer = window.setInterval(checkIdle, 30000);
        return () => {
            activityEvents.forEach(ev => window.removeEventListener(ev, markActivity));
            document.removeEventListener('visibilitychange', checkIdle);
            window.clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, token, pin]);

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        // Reine Datumswerte (JJJJ-MM-TT, z. B. Fälligkeit) als lokales Datum lesen, sonst kann die Zeitzone den Tag verschieben
        const date = typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)
            ? new Date(`${dateString}T00:00:00`)
            : new Date(dateString);
        if (Number.isNaN(date.getTime())) return '-';
        return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    };

    const paymentOptions = useMemo(
        () => normalizeInstallmentOptions(claimData?.settings?.installment_options),
        [claimData]
    );

    // Vorschau in Cent gerundet; maßgeblich sind die serverseitig berechneten Beträge
    const calculatePaymentPlan = (months) => {
        const option = paymentOptions.find(o => o.months === months);
        const base = roundCents(claimData?.totals?.total_due);
        if (!option || base <= 0) return null;

        const adjustment = roundCents(base * option.surcharge_percent / 100);
        const total = roundCents(base + adjustment);
        const rate = roundCents(total / months);
        return { total, rate, adjustment };
    };

    const openRequestModal = () => {
        if (!paymentOptions.some(o => o.months === requestOption)) {
            setRequestOption(paymentOptions.length > 0 ? paymentOptions[0].months : null);
        }
        setRequestError(null);
        setShowRequestModal(true);
    };

    const handleRequestSubmit = async () => {
        const plan = calculatePaymentPlan(requestOption);
        if (!plan) {
            setRequestError('Bitte wählen Sie eine der angebotenen Laufzeiten.');
            return;
        }
        const message = tenantMessage.trim();
        if (message.length > MAX_MESSAGE_LENGTH) {
            setRequestError(`Die Nachricht darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen lang sein.`);
            return;
        }

        setIsSubmitting(true);
        setRequestError(null);
        try {
            // Rate, Gesamtbetrag und Aufschlag werden von der neuen Datenbank-Fassung ignoriert
            // und serverseitig berechnet; sie werden nur noch für ältere Fassungen mitgeschickt.
            const { data, error: rpcError } = await supabase.rpc('submit_public_payment_plan_request', {
                p_token: token,
                p_pin: pin,
                p_requested_months: requestOption,
                p_requested_rate: plan.rate,
                p_requested_total: plan.total,
                p_adjustment_amount: plan.adjustment,
                p_tenant_message: message
            });

            if (rpcError) {
                console.error(rpcError);
                setRequestError(getPortalErrorMessage(rpcError, 'Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es später erneut.'));
                return;
            }

            if (data && data.success === false) {
                setRequestError(data.error || 'Die Anfrage konnte nicht gesendet werden.');
                return;
            }

            setRequestSuccess(true);
            setShowRequestModal(false);

            // Update local status to prevent further requests
            setClaimData(prev => ({
                ...prev,
                status: 'payment_plan_requested',
                payment_plan_request_open: true,
                payment_plan_request_allowed: false
            }));

        } catch (err) {
            console.error(err);
            setRequestError('Die Anfrage konnte nicht gesendet werden. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const deadEndMessage = !token ? 'Kein gültiger Token gefunden.' : (!isAuthenticated ? fatalError : null);

    if (deadEndMessage) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB', padding: '16px' }}>
                <Card style={{ padding: '32px', maxWidth: '400px', width: '100%', textAlign: 'center', borderTop: '4px solid #EF4444' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={48} color="#EF4444" /></div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px' }}>Zugriff verweigert</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>{deadEndMessage}</p>
                </Card>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB', padding: '16px' }}>
                <Card style={{ padding: '32px', maxWidth: '400px', width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                            <div style={{ width: '64px', height: '64px', backgroundColor: '#EFF6FF', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Lock size={32} color="#3B82F6" />
                            </div>
                        </div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>Forderungsübersicht</h1>
                        <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '0.9rem' }}>
                            Bitte geben Sie den Zugangscode aus Ihrem Anschreiben ein, um Ihre aktuelle Forderung einzusehen.
                        </p>
                    </div>
                    

                    <form onSubmit={handleLogin}>
                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Zugangscode (PIN)</label>
                            <Input
                                type="password"
                                value={pin}
                                onChange={e => setPin(e.target.value)}
                                placeholder="Z.B. 12345"
                                required
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={16}
                                style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '2px' }}
                            />
                            {error && (
                                <p role="alert" style={{ marginTop: '8px', color: '#B91C1C', fontSize: '0.875rem', textAlign: 'center' }}>
                                    {error}
                                </p>
                            )}
                        </div>
                        <Button type="submit" style={{ width: '100%', padding: '12px', fontSize: '1rem' }} disabled={loading || !pin.trim()}>
                            {loading ? <Loader2 className="animate-spin" /> : 'Anmelden'}
                        </Button>
                    </form>
                </Card>
            </div>
        );
    }

    const planPreview = calculatePaymentPlan(requestOption);
    const showBankTransfer = claimData.bank_details?.iban && claimData.bank_details?.account_holder;
    const totalDue = Number(claimData.totals?.total_due) || 0;

    // Neue Datenbank-Fassung meldet offene Anfrage und Zulässigkeit; sonst Ableitung aus dem Status
    const requestPending = requestSuccess || (typeof claimData.payment_plan_request_open === 'boolean'
        ? claimData.payment_plan_request_open
        : claimData.status === 'payment_plan_requested');
    const canRequestPlan = !requestPending
        && totalDue > 0
        && claimData.settings?.allow_installments !== false
        && paymentOptions.length > 0
        && (typeof claimData.payment_plan_request_allowed === 'boolean'
            ? claimData.payment_plan_request_allowed
            : REQUESTABLE_STATUSES.includes(claimData.status));

    // Fälligkeit der Position; ältere Datenbank-Fassungen liefern nur das Anlagedatum
    const itemDate = (item) => item.due_date || item.created_at;
    const openItems = (claimData.items || [])
        .filter(i => i.open_amount > 0)
        .sort((a, b) => String(itemDate(a) || '').localeCompare(String(itemDate(b) || '')));

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#F3F4F6', padding: 'var(--spacing-xl) 16px' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px', flexWrap: 'wrap' }}>
                    <div style={{ width: '56px', height: '56px', backgroundColor: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <Scale size={28} color="#1E40AF" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Forderungsübersicht</h1>
                        <p style={{ color: 'var(--text-secondary)' }}>Stand: {formatDate(new Date())}</p>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={handleLogout}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        title="Abmelden und Zugangscode auf diesem Gerät vergessen"
                    >
                        <LogOut size={16} />
                        Abmelden
                    </Button>
                </div>

                {/* Main Content */}
                <div style={{ display: 'grid', gap: '24px' }}>
                    
                    {/* Status & Mietobjekt */}
                    <Card style={{ padding: '24px', borderLeft: '4px solid #3B82F6' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Mietobjekt</h3>
                                <p style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                    {claimData.lease?.unit?.property?.street} {claimData.lease?.unit?.property?.house_number}<br/>
                                    {claimData.lease?.unit?.property?.zip} {claimData.lease?.unit?.property?.city}
                                </p>
                                <p style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>Einheit: {claimData.lease?.unit?.unit_name}</p>
                                <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>Mieter: {claimData.tenant?.first_name} {claimData.tenant?.last_name}</p>
                            </div>
                        </div>
                    </Card>

                    {/* Forderungsstand */}
                    <Card style={{ padding: '0', overflow: 'hidden' }}>
                        <div style={{ padding: '24px', backgroundColor: '#F8FAFC', borderBottom: '1px solid var(--border-color)' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Gesamtforderung heute</h2>
                            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#991B1B', marginTop: '8px' }}>
                                {formatCurrency(claimData.totals?.total_due)}
                            </div>
                        </div>
                        
                        <div style={{ padding: '24px' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px' }}>Zusammensetzung</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px dashed #E5E7EB' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Hauptforderung (offen)</span>
                                    <span style={{ fontWeight: 500 }}>{formatCurrency(claimData.totals?.current_principal_open)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px dashed #E5E7EB' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Mahnkosten</span>
                                    <span style={{ fontWeight: 500 }}>{formatCurrency(claimData.totals?.total_fees_open)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Verzugszinsen ({claimData.interest_rate}% p.a.)</span>
                                    <span style={{ fontWeight: 500 }}>{formatCurrency(claimData.totals?.total_interest_open)}</span>
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '16px 24px', backgroundColor: '#FEF2F2', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Clock size={20} color="#991B1B" />
                            <span style={{ color: '#991B1B', fontWeight: 500 }}>Zahlungsfrist: {formatDate(claimData.deadline)}</span>
                        </div>
                    </Card>

                    {/* Paid State */}
                    {claimData.totals?.total_due <= 0 && (
                        <Card style={{ padding: '24px', backgroundColor: '#ECFDF5', border: '1px solid #10B981' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <CheckCircle2 size={32} color="#059669" style={{ flexShrink: 0 }} />
                                <div>
                                    <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#065F46', margin: 0 }}>Vollständig beglichen</h3>
                                    <p style={{ color: '#047857', fontSize: '0.95rem', margin: '4px 0 0 0' }}>
                                        Es stehen keine offenen Posten für diese Forderung aus. Vielen Dank für Ihre Zahlung.
                                    </p>
                                </div>
                            </div>
                        </Card>
                    )}

                    {requestPending && totalDue > 0 && (
                        <Card style={{ padding: '24px', backgroundColor: '#ECFDF5', border: '1px solid #10B981' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                                <CheckCircle2 size={24} color="#059669" style={{ marginTop: '2px' }} />
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#065F46', marginBottom: '4px' }}>Ratenzahlung angefragt</h3>
                                    <p style={{ color: '#064E3B', fontSize: '0.95rem' }}>
                                        Ihre Anfrage zur Ratenzahlung wurde erfolgreich übermittelt. Wir prüfen Ihren Vorschlag und werden uns in Kürze mit Ihnen in Verbindung setzen.
                                        {showBankTransfer && ' Bis zu unserer Entscheidung können Sie weiterhin per Überweisung zahlen (Bankverbindung unten).'}
                                    </p>
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* Action Area (Banküberweisung & GiroCode) – auch bei offener Ratenanfrage, nur der Anfrage-Knopf entfällt */}
                    {totalDue > 0 && (
                        showBankTransfer ? (
                            <Card style={{ padding: '24px', backgroundColor: 'white' }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CreditCard size={20} color="var(--primary-color)" />
                                    Per Banküberweisung bezahlen
                                </h3>
                                
                                <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    {/* QR Code Container */}
                                    {qrCodeUrl && (
                                        <div style={{ 
                                            display: 'flex', 
                                            flexDirection: 'column', 
                                            alignItems: 'center', 
                                            gap: '8px', 
                                            padding: '16px', 
                                            backgroundColor: '#F8FAFC', 
                                            border: '1px solid var(--border-color)', 
                                            borderRadius: '12px',
                                            width: 'fit-content',
                                            margin: '0 auto'
                                        }}>
                                            <img src={qrCodeUrl} alt="EPC-QR-Code (GiroCode)" style={{ width: '160px', height: '160px', display: 'block' }} />
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                GiroCode (Scannen & Bezahlen)
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Instructions & Bank details */}
                                    <div style={{ flex: 1, minWidth: '280px' }}>
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '16px' }}>
                                            Öffnen Sie Ihre Banking-App und scannen Sie diesen Code, um den Überweisungsträger automatisch und fehlerfrei auszufüllen.
                                        </p>
                                        
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>Empfänger:</span>
                                                <span style={{ fontWeight: 600 }}>{claimData.bank_details.account_holder}</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>IBAN:</span>
                                                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{claimData.bank_details.iban}</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>BIC:</span>
                                                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{claimData.bank_details.bic || '-'}</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>Verwendungszweck:</span>
                                                <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>Mahnung-{claimData.claim_id.substring(0, 8).toUpperCase()}</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--text-secondary)' }}>Betrag:</span>
                                                <span style={{ fontWeight: 700, color: '#991B1B' }}>{formatCurrency(claimData.totals?.total_due)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {canRequestPlan && (
                                    <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <Button
                                            variant="secondary"
                                            onClick={openRequestModal}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                        >
                                            <Calendar size={16} />
                                            Ratenzahlung anfragen
                                        </Button>
                                    </div>
                                )}
                            </Card>
                        ) : (
                            canRequestPlan && (
                                <Card style={{ padding: '24px', backgroundColor: 'white' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>Ratenzahlung anfragen</h3>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.95rem' }}>
                                        Falls Sie den Gesamtbetrag nicht fristgerecht begleichen können, bieten wir Ihnen die Möglichkeit einer Ratenzahlung an.
                                    </p>
                                    <Button
                                        onClick={openRequestModal}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                    >
                                        <Calendar size={16} />
                                        Ratenzahlung anfragen
                                    </Button>
                                </Card>
                            )
                        )
                    )}

                    {/* Positionen Detail */}
                    <Card style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                            <FileText size={20} color="var(--text-secondary)" />
                            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Offene Positionen im Detail</h3>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                        <th style={{ padding: '12px 0', textAlign: 'left', fontWeight: 600 }}>Beschreibung</th>
                                        <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600 }}>Fällig</th>
                                        <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600 }}>Offen</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {openItems.map((item, idx) => (
                                        <tr key={item.id || idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                                            <td style={{ padding: '12px 0', color: 'var(--text-primary)' }}>{item.description || item.item_type}</td>
                                            <td style={{ padding: '12px 0', textAlign: 'right', color: 'var(--text-secondary)' }}>{formatDate(itemDate(item))}</td>
                                            <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 500 }}>{formatCurrency(item.open_amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p style={{ marginTop: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            Hinweis: Bei nicht fristgerechter Zahlung können weitere Verzugszinsen und Mahnkosten entstehen.
                        </p>
                    </Card>

                </div>
            </div>

            {/* Request Modal */}
            {showRequestModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '16px' }}>
                    <Card style={{ padding: '32px', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>Teilzahlungsvereinbarung anfragen</h2>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>Wählen Sie eine gewünschte Laufzeit. Die Aufschläge decken die administrativen Bearbeitungskosten ab.</p>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                            {paymentOptions.map(opt => (
                                <div 
                                    key={opt.months}
                                    onClick={() => setRequestOption(opt.months)}
                                    style={{ 
                                        padding: '16px', 
                                        border: `2px solid ${requestOption === opt.months ? '#3B82F6' : '#E5E7EB'}`, 
                                        borderRadius: 'var(--radius-md)', 
                                        cursor: 'pointer',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        backgroundColor: requestOption === opt.months ? '#EFF6FF' : 'white'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 600, color: requestOption === opt.months ? '#1E40AF' : 'var(--text-primary)' }}>{opt.months} Monate</div>
                                    </div>
                                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${requestOption === opt.months ? '#3B82F6' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' }}>
                                        {requestOption === opt.months && <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#3B82F6' }} />}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ backgroundColor: '#F8FAFC', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
                            {planPreview ? (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Monatliche Rate:</span>
                                        <span style={{ fontWeight: 600 }}>{formatCurrency(planPreview.rate)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Bearbeitungsaufschlag:</span>
                                        <span style={{ fontWeight: 500 }}>{formatCurrency(planPreview.adjustment)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', paddingTop: '8px', marginTop: '8px' }}>
                                        <span style={{ fontWeight: 600 }}>Gesamtbetrag neu:</span>
                                        <span style={{ fontWeight: 700, color: '#166534' }}>{formatCurrency(planPreview.total)}</span>
                                    </div>
                                    {roundCents(planPreview.rate * requestOption) !== planPreview.total && (
                                        <p style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            Hinweis: Durch Rundung kann die letzte Rate um einige Cent abweichen.
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>Bitte wählen Sie eine Laufzeit.</p>
                            )}
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Nachricht an uns (optional)</label>
                            <textarea
                                value={tenantMessage}
                                onChange={e => setTenantMessage(e.target.value)}
                                rows={3}
                                maxLength={MAX_MESSAGE_LENGTH}
                                style={{ width: '100%', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.95rem' }}
                                placeholder="Z.B. Ich erwarte meinen Lohn am 15. des Monats..."
                            />
                        </div>

                        {requestError && (
                            <p role="alert" style={{ marginBottom: '16px', color: '#B91C1C', fontSize: '0.9rem' }}>
                                {requestError}
                            </p>
                        )}

                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <Button variant="secondary" onClick={() => setShowRequestModal(false)} disabled={isSubmitting}>Abbrechen</Button>
                            <Button
                                onClick={handleRequestSubmit}
                                disabled={isSubmitting || !planPreview}
                                style={{ backgroundColor: '#10B981', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" /> : <Send size={16} />}
                                Verbindlich anfragen
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
