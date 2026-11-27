import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, ArrowRight, Clock } from 'lucide-react';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';

const MAX_POLLS = 10;
const POLL_INTERVAL = 2500;

// Abo gilt als freigeschaltet, wenn der Webhook ein laufendes Stripe-Abo eingetragen hat
const isActivated = (sub) =>
    !!sub && !!sub.stripe_subscription_id && (sub.status === 'active' || sub.status === 'trialing');

const BillingSuccess = () => {
    const navigate = useNavigate();
    const { session } = useAuth();
    const { refreshSubscription } = useSubscription();
    const [status, setStatus] = useState('processing'); // processing | verified | pending

    const userId = session?.user?.id || null;

    // Auf das Ergebnis des Stripe-Webhooks warten; bricht beim Verlassen der Seite ab.
    useEffect(() => {
        if (!userId) return undefined;
        let cancelled = false;
        let timer = null;
        let polls = 0;

        const poll = async () => {
            if (cancelled) return;
            polls += 1;
            let sub;
            try {
                sub = refreshSubscription ? await refreshSubscription() : undefined;
            } catch (e) {
                console.warn('[BillingSuccess] Refresh error:', e);
            }
            if (cancelled) return;

            if (isActivated(sub)) {
                setStatus('verified');
                timer = setTimeout(() => { if (!cancelled) navigate('/'); }, 1500);
                return;
            }
            if (polls >= MAX_POLLS) {
                // Kein Erfolg vorgetäuscht: Hinweis anzeigen, nicht automatisch weiterleiten
                setStatus('pending');
                return;
            }
            timer = setTimeout(poll, POLL_INTERVAL);
        };

        timer = setTimeout(poll, POLL_INTERVAL);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [userId, navigate, refreshSubscription]); // refreshSubscription ist je Nutzer stabil (useCallback)

    const headline = !userId
        ? 'Zahlung abgeschlossen'
        : status === 'verified'
            ? 'Zahlung erfolgreich'
            : status === 'pending'
                ? 'Zahlung wird noch verarbeitet'
                : 'Zahlung wird bestätigt';

    const description = !userId
        ? 'Bitte melde dich an. Dein Abo wird nach Eingang der Zahlungsbestätigung freigeschaltet.'
        : status === 'pending'
            ? 'Die Bestätigung von Stripe ist noch nicht eingegangen. Das kann einige Minuten dauern – bei Lastschrift auch länger. Dein Abo wird automatisch freigeschaltet, sobald die Zahlung bestätigt ist.'
            : status === 'verified'
                ? 'Vielen Dank für Dein Vertrauen. Dein Abo ist jetzt aktiv.'
                : 'Vielen Dank für Dein Vertrauen. Dein Account wird jetzt aktualisiert.';

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            background: 'var(--background-color)',
            fontFamily: 'var(--font-family)',
            padding: '20px'
        }}>
            <div style={{
                backgroundColor: 'var(--surface-color)',
                padding: '40px',
                borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-lg)',
                textAlign: 'center',
                maxWidth: '450px',
                width: '100%',
                border: '1px solid var(--border-color)',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Decorative Top Line */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '4px',
                    background: 'linear-gradient(90deg, var(--primary-color), var(--primary-hover))'
                }} />

                {/* Logo */}
                <div style={{ marginBottom: '30px', display: 'flex', justifyContent: 'center' }}>
                    <img src="/logo.svg" alt="ImmoControl" style={{ height: '48px' }} />
                </div>

                {/* Success Animation */}
                <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    color: 'var(--success-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 24px auto',
                    animation: 'bounceIn 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)'
                }}>
                    {status === 'pending' || !userId ? <Clock size={40} strokeWidth={2.5} /> : <Check size={40} strokeWidth={3} />}
                </div>

                <h1 style={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '12px'
                }}>
                    {headline}
                </h1>

                <p style={{
                    color: 'var(--text-secondary)',
                    marginBottom: '30px',
                    lineHeight: '1.6'
                }}>
                    {description}
                </p>

                {/* Status Indicator */}
                {userId && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        backgroundColor: 'var(--input-bg)',
                        padding: '12px 20px',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem',
                        marginBottom: '20px'
                    }}>
                        {status === 'processing' && (
                            <>
                                <Loader2 className="animate-spin" size={18} style={{ color: 'var(--primary-color)' }} />
                                <span>Daten werden synchronisiert...</span>
                            </>
                        )}
                        {status === 'verified' && (
                            <>
                                <Check size={18} style={{ color: 'var(--success-color)' }} />
                                <span>Bereit! Weiterleitung...</span>
                            </>
                        )}
                        {status === 'pending' && (
                            <>
                                <Clock size={18} style={{ color: 'var(--primary-color)' }} />
                                <span>Du kannst die App schon öffnen. Wird dein Abo noch nicht angezeigt, lade die Seite später neu.</span>
                            </>
                        )}
                    </div>
                )}

                {/* Manual Button (Fallback) */}
                <button
                    onClick={() => navigate(userId ? '/' : '/login')}
                    className="btn-primary"
                    style={{
                        width: '100%',
                        padding: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '1rem',
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer'
                    }}
                >
                    {userId ? 'Zum Dashboard' : 'Zur Anmeldung'} <ArrowRight size={18} />
                </button>
            </div>

            <style>{`
                @keyframes bounceIn {
                    0% { transform: scale(0); opacity: 0; }
                    60% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1); }
                }
            `}</style>
        </div>
    );
};

export default BillingSuccess;
