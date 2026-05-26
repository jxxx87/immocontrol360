import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Scale, Lock, Clock, Calendar, CheckCircle2, FileText, Send, Loader2 } from 'lucide-react';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';

export default function ClaimPortal() {
    const { token } = useParams();
    const navigate = useNavigate();

    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [claimData, setClaimData] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Request Payment Plan State
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [requestOption, setRequestOption] = useState(2); // 2, 4, 6 months
    const [tenantMessage, setTenantMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestSuccess, setRequestSuccess] = useState(false);

    // Online Payment State
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'cancel'

    const loadClaimData = async (enteredPin) => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_public_claim_by_token', {
                p_token: token,
                p_pin: enteredPin
            });

            if (rpcError) throw rpcError;
            if (!data) throw new Error('Keine Daten gefunden.');

            setClaimData(data);
            setIsAuthenticated(true);
            setPin(enteredPin);
            sessionStorage.setItem(`claim_pin_${token}`, enteredPin);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Zugriff verweigert. Bitte überprüfen Sie die PIN.');
            sessionStorage.removeItem(`claim_pin_${token}`);
            setIsAuthenticated(false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!token) {
            setError('Kein gültiger Token gefunden.');
            return;
        }

        const savedPin = sessionStorage.getItem(`claim_pin_${token}`);
        if (savedPin) {
            loadClaimData(savedPin);
        }

        const params = new URLSearchParams(window.location.search);
        const paymentParam = params.get('payment');
        if (paymentParam) {
            setPaymentStatus(paymentParam);
            // URL aufräumen ohne Neuladen der Seite
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [token]);

    const handleLogin = async (e) => {
        e.preventDefault();
        await loadClaimData(pin);
    };

    const handleOnlinePayment = async () => {
        setPaymentLoading(true);
        setError(null);
        try {
            const activePin = pin || sessionStorage.getItem(`claim_pin_${token}`);
            if (!activePin) {
                throw new Error('Sicherheits-PIN fehlt. Bitte melden Sie sich erneut an.');
            }

            const { data, error: functionError } = await supabase.functions.invoke('create-portal-checkout-session', {
                body: { 
                    token, 
                    pin: activePin, 
                    origin: window.location.origin 
                }
            });

            if (functionError) throw functionError;
            if (data?.url) {
                window.location.href = data.url;
            } else {
                throw new Error('Keine Checkout-URL erhalten.');
            }
        } catch (err) {
            console.error(err);
            alert('Fehler beim Starten der Online-Zahlung: ' + (err.message || 'Bitte versuchen Sie es später noch einmal.'));
        } finally {
            setPaymentLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(dateString));
    };

    const getPaymentOptions = () => {
        let options = claimData?.settings?.installment_options;
        if (typeof options === 'string') {
            try { options = JSON.parse(options); } catch (e) { options = null; }
        }
        if (!Array.isArray(options) || options.length === 0) {
            return [
                { months: 3, surcharge_percent: 7.00 },
                { months: 6, surcharge_percent: 9.00 },
                { months: 12, surcharge_percent: 12.00 }
            ];
        }
        return options.sort((a, b) => a.months - b.months);
    };

    const calculatePaymentPlan = (months) => {
        if (!claimData?.totals?.total_due) return { total: 0, rate: 0, adjustment: 0 };
        const base = Number(claimData.totals.total_due);
        
        const options = getPaymentOptions();
        const selectedOpt = options.find(o => o.months === months) || options[0];
        
        const surchargePercentVal = Number(selectedOpt?.surcharge_percent || 7.00);
        const surchargePercent = surchargePercentVal / 100.0;

        const adjustment = base * surchargePercent;
        const total = base + adjustment;
        const rate = total / months;
        return { total, rate, adjustment };
    };

    const handleRequestSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const plan = calculatePaymentPlan(requestOption);
            
            const { error: rpcError } = await supabase.rpc('submit_public_payment_plan_request', {
                p_token: token,
                p_pin: pin,
                p_requested_months: requestOption,
                p_requested_rate: plan.rate,
                p_requested_total: plan.total,
                p_adjustment_amount: plan.adjustment,
                p_tenant_message: tenantMessage
            });

            if (rpcError) throw rpcError;

            setRequestSuccess(true);
            setShowRequestModal(false);
            
            // Update local status to prevent further requests
            setClaimData(prev => ({ ...prev, status: 'payment_plan_requested' }));
            
        } catch (err) {
            console.error(err);
            alert('Fehler: ' + (err.message || 'Anfrage konnte nicht gesendet werden.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (error && !isAuthenticated) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB', padding: '16px' }}>
                <Card style={{ padding: '32px', maxWidth: '400px', width: '100%', textAlign: 'center', borderTop: '4px solid #EF4444' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={48} color="#EF4444" /></div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px' }}>Zugriff verweigert</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
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
                    
                    {paymentStatus === 'success' && (
                        <div style={{ 
                            marginBottom: '20px', 
                            padding: '12px 16px', 
                            backgroundColor: '#ECFDF5', 
                            border: '1px solid #10B981', 
                            borderRadius: '8px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            textAlign: 'left'
                        }}>
                            <CheckCircle2 size={20} color="#059669" style={{ flexShrink: 0 }} />
                            <div style={{ fontSize: '0.85rem', color: '#047857' }}>
                                <strong>Zahlung erfolgreich!</strong> Ihre Zahlung wurde gestartet. Bitte loggen Sie sich ein, um den aktuellen Status zu sehen.
                            </div>
                        </div>
                    )}
                    
                    {paymentStatus === 'cancel' && (
                        <div style={{ 
                            marginBottom: '20px', 
                            padding: '12px 16px', 
                            backgroundColor: '#FEF2F2', 
                            border: '1px solid #EF4444', 
                            borderRadius: '8px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px',
                            textAlign: 'left'
                        }}>
                            <Clock size={20} color="#DC2626" style={{ flexShrink: 0 }} />
                            <div style={{ fontSize: '0.85rem', color: '#B91C1C' }}>
                                <strong>Abgebrochen.</strong> Der Bezahlvorgang wurde abgebrochen.
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleLogin}>
                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Zugangscode (PIN)</label>
                            <Input 
                                type="password" 
                                value={pin} 
                                onChange={e => setPin(e.target.value)}
                                placeholder="Z.B. 12345"
                                required
                                style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '2px' }}
                            />
                        </div>
                        <Button type="submit" style={{ width: '100%', padding: '12px', fontSize: '1rem' }} disabled={loading || !pin}>
                            {loading ? <Loader2 className="animate-spin" /> : 'Anmelden'}
                        </Button>
                    </form>
                </Card>
            </div>
        );
    }

    const planPreview = calculatePaymentPlan(requestOption);
    const showStripePayment = claimData.settings?.stripe_connect_enabled && claimData.settings?.allow_stripe;

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#F3F4F6', padding: 'var(--spacing-xl) 16px' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                
                {paymentStatus === 'success' && (
                    <div style={{ 
                        marginBottom: '24px', 
                        padding: '16px 20px', 
                        backgroundColor: '#ECFDF5', 
                        border: '1px solid #10B981', 
                        borderRadius: '12px', 
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <CheckCircle2 size={24} color="#059669" style={{ flexShrink: 0 }} />
                        <div>
                            <h4 style={{ fontWeight: 600, color: '#065F46', margin: 0 }}>Zahlung erfolgreich!</h4>
                            <p style={{ color: '#047857', fontSize: '0.9rem', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                                Ihre Zahlung wurde erfolgreich über Stripe initiiert. Der Zahlungseingang wird in Kürze verbucht.
                            </p>
                        </div>
                    </div>
                )}

                {paymentStatus === 'cancel' && (
                    <div style={{ 
                        marginBottom: '24px', 
                        padding: '16px 20px', 
                        backgroundColor: '#FEF2F2', 
                        border: '1px solid #EF4444', 
                        borderRadius: '12px', 
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <Clock size={24} color="#DC2626" style={{ flexShrink: 0 }} />
                        <div>
                            <h4 style={{ fontWeight: 600, color: '#991B1B', margin: 0 }}>Zahlung abgebrochen</h4>
                            <p style={{ color: '#B91C1C', fontSize: '0.9rem', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                                Der Bezahlvorgang wurde abgebrochen und es wurde keine Zahlung durchgeführt.
                            </p>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
                    <div style={{ width: '56px', height: '56px', backgroundColor: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <Scale size={28} color="#1E40AF" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Forderungsübersicht</h1>
                        <p style={{ color: 'var(--text-secondary)' }}>Stand: {formatDate(new Date())}</p>
                    </div>
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

                    {/* Action Area */}
                    {!requestSuccess && claimData.status !== 'payment_plan_requested' && claimData.totals?.total_due > 0 && (
                        (showStripePayment || claimData.settings?.allow_installments !== false) && (
                            <Card style={{ padding: '24px', backgroundColor: 'white' }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>Optionen zur Zahlungsabwicklung</h3>
                                <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.95rem', lineHeight: '1.5' }}>
                                    {showStripePayment 
                                        ? 'Sie können die ausstehende Forderung direkt sicher online bezahlen. Alternativ können Sie eine Ratenzahlung beantragen.' 
                                        : 'Falls Sie den Gesamtbetrag nicht fristgerecht begleichen können, bieten wir Ihnen die Möglichkeit einer Ratenzahlung an. Bitte beachten Sie, dass bei einer Ratenzahlung zusätzliche Bearbeitungskosten anfallen.'}
                                </p>
                                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                    {showStripePayment && (
                                        <Button 
                                            onClick={handleOnlinePayment} 
                                            disabled={paymentLoading}
                                            style={{ 
                                                flex: 1, 
                                                minWidth: '200px', 
                                                padding: '14px 20px', 
                                                fontSize: '1rem', 
                                                fontWeight: '600',
                                                backgroundColor: '#0F172A',
                                                backgroundImage: 'linear-gradient(to bottom right, #1E293B, #0F172A)',
                                                color: '#F8FAFC', 
                                                border: '1px solid #334155',
                                                borderRadius: '8px',
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'center', 
                                                gap: '10px',
                                                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                transform: paymentLoading ? 'none' : 'translateY(0)',
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!paymentLoading) {
                                                    e.currentTarget.style.backgroundImage = 'linear-gradient(to bottom right, #334155, #1E293B)';
                                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                                    e.currentTarget.style.boxShadow = '0 6px 12px -2px rgba(0,0,0,0.15), 0 3px 6px -2px rgba(0,0,0,0.1)';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!paymentLoading) {
                                                    e.currentTarget.style.backgroundImage = 'linear-gradient(to bottom right, #1E293B, #0F172A)';
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                    e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)';
                                                }
                                            }}
                                        >
                                            {paymentLoading ? (
                                                <>
                                                    <Loader2 className="animate-spin" size={18} />
                                                    <span>Verbindung zu Stripe...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Lock size={18} />
                                                    <span>Jetzt online bezahlen</span>
                                                </>
                                            )}
                                        </Button>
                                    )}
                                    {claimData.settings?.allow_installments !== false && (
                                        <Button 
                                            onClick={() => setShowRequestModal(true)} 
                                            style={{ 
                                                flex: 1, 
                                                minWidth: '200px', 
                                                padding: '14px 20px', 
                                                fontSize: '1rem', 
                                                fontWeight: '600',
                                                backgroundColor: '#10B981', 
                                                backgroundImage: 'linear-gradient(to bottom right, #10B981, #059669)',
                                                color: 'white', 
                                                border: 'none',
                                                borderRadius: '8px',
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'center', 
                                                gap: '10px',
                                                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundImage = 'linear-gradient(to bottom right, #34D399, #10B981)';
                                                e.currentTarget.style.transform = 'translateY(-1px)';
                                                e.currentTarget.style.boxShadow = '0 6px 12px -2px rgba(0,0,0,0.15), 0 3px 6px -2px rgba(0,0,0,0.1)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundImage = 'linear-gradient(to bottom right, #10B981, #059669)';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)';
                                            }}
                                        >
                                            <Calendar size={18} />
                                            <span>Ratenzahlung anfragen</span>
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        )
                    )}

                    {(requestSuccess || claimData.status === 'payment_plan_requested') && claimData.totals?.total_due > 0 && (
                        <Card style={{ padding: '24px', backgroundColor: '#ECFDF5', border: '1px solid #10B981' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                                <CheckCircle2 size={24} color="#059669" style={{ marginTop: '2px' }} />
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#065F46', marginBottom: '4px' }}>Ratenzahlung angefragt</h3>
                                    <p style={{ color: '#064E3B', fontSize: '0.95rem' }}>
                                        Ihre Anfrage zur Ratenzahlung wurde erfolgreich übermittelt. Wir prüfen Ihren Vorschlag und werden uns in Kürze mit Ihnen in Verbindung setzen.
                                    </p>
                                </div>
                            </div>
                        </Card>
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
                                        <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600 }}>Datum</th>
                                        <th style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600 }}>Offen</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {claimData.items?.filter(i => i.open_amount > 0).map((item, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                                            <td style={{ padding: '12px 0', color: 'var(--text-primary)' }}>{item.description || item.item_type}</td>
                                            <td style={{ padding: '12px 0', textAlign: 'right', color: 'var(--text-secondary)' }}>{formatDate(item.created_at)}</td>
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
                            {getPaymentOptions().map(opt => (
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
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>Nachricht an uns (optional)</label>
                            <textarea 
                                value={tenantMessage}
                                onChange={e => setTenantMessage(e.target.value)}
                                rows={3}
                                style={{ width: '100%', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.95rem' }}
                                placeholder="Z.B. Ich erwarte meinen Lohn am 15. des Monats..."
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <Button variant="secondary" onClick={() => setShowRequestModal(false)} disabled={isSubmitting}>Abbrechen</Button>
                            <Button 
                                onClick={handleRequestSubmit} 
                                disabled={isSubmitting}
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
