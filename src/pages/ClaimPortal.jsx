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

    useEffect(() => {
        if (!token) {
            setError('Kein gültiger Token gefunden.');
        }
    }, [token]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_public_claim_by_token', {
                p_token: token,
                p_pin: pin
            });

            if (rpcError) throw rpcError;
            if (!data) throw new Error('Keine Daten gefunden.');

            setClaimData(data);
            setIsAuthenticated(true);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Zugriff verweigert. Bitte überprüfen Sie die PIN.');
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(dateString));
    };

    const calculatePaymentPlan = (months) => {
        if (!claimData?.totals?.total_due) return { total: 0, rate: 0, adjustment: 0 };
        const base = Number(claimData.totals.total_due);
        let surchargePercent = 0;
        if (months === 2) surchargePercent = 0.07;
        else if (months === 4) surchargePercent = 0.09;
        else if (months === 6) surchargePercent = 0.11;

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

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#F3F4F6', padding: 'var(--spacing-xl) 16px' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                
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

                    {/* Action Area */}
                    {!requestSuccess && claimData.status !== 'payment_plan_requested' && (
                        <Card style={{ padding: '24px', backgroundColor: 'white' }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>Zahlungserleichterung</h3>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.95rem', lineHeight: '1.5' }}>
                                Falls Sie den Gesamtbetrag nicht fristgerecht begleichen können, bieten wir Ihnen die Möglichkeit einer Ratenzahlung an. 
                                Bitte beachten Sie, dass bei einer Ratenzahlung zusätzliche Bearbeitungskosten anfallen.
                            </p>
                            <Button 
                                onClick={() => setShowRequestModal(true)} 
                                style={{ width: '100%', padding: '12px', fontSize: '1rem', backgroundColor: '#10B981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                            >
                                <Calendar size={20} />
                                Ratenzahlung anfragen
                            </Button>
                        </Card>
                    )}

                    {(requestSuccess || claimData.status === 'payment_plan_requested') && (
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
                            {[
                                { months: 2, label: '2 Monate', info: 'Geringer Aufschlag (7%)' },
                                { months: 4, label: '4 Monate', info: 'Mittlerer Aufschlag (9%)' },
                                { months: 6, label: '6 Monate', info: 'Höherer Aufschlag (11%)' }
                            ].map(opt => (
                                <div 
                                    key={opt.months}
                                    onClick={() => setRequestOption(opt.months)}
                                    style={{ 
                                        padding: '16px', 
                                        border: `2px solid ${requestOption === opt.months ? '#3B82F6' : '#E5E7EB'}`, 
                                        borderRadius: '8px', 
                                        cursor: 'pointer',
                                        backgroundColor: requestOption === opt.months ? '#EFF6FF' : 'white',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 600, color: requestOption === opt.months ? '#1E40AF' : 'var(--text-primary)' }}>{opt.label}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{opt.info}</div>
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
