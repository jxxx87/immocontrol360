import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, ArrowRight } from 'lucide-react';
import { useSubscription } from '../context/SubscriptionContext';

const BillingSuccess = () => {
    const navigate = useNavigate();
    const { refreshSubscription } = useSubscription();
    const [status, setStatus] = useState('processing'); // processing | verified
    const hasRan = useRef(false);

    const pollForUpdate = useCallback(async () => {
        const MAX_POLLS = 10;
        const POLL_INTERVAL = 2500;

        for (let i = 0; i < MAX_POLLS; i++) {
            console.log(`[BillingSuccess] Poll ${i + 1}/${MAX_POLLS}...`);
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

            if (refreshSubscription) {
                try {
                    await refreshSubscription();
                } catch (e) {
                    console.warn('[BillingSuccess] Refresh error:', e);
                }
            }
        }

        // After polling, show success and redirect
        console.log('[BillingSuccess] Polling complete, redirecting...');
        setStatus('verified');
        setTimeout(() => navigate('/'), 1500);
    }, [refreshSubscription, navigate]);

    useEffect(() => {
        if (hasRan.current) return;
        hasRan.current = true;
        pollForUpdate();
    }, [pollForUpdate]);

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
                    <Check size={40} strokeWidth={3} />
                </div>

                <h1 style={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: '12px'
                }}>
                    Zahlung erfolgreich
                </h1>

                <p style={{
                    color: 'var(--text-secondary)',
                    marginBottom: '30px',
                    lineHeight: '1.6'
                }}>
                    Vielen Dank für Dein Vertrauen. <br />
                    Dein Account wird jetzt aktualisiert.
                </p>

                {/* Status Indicator */}
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
                    {status === 'processing' ? (
                        <>
                            <Loader2 className="animate-spin" size={18} style={{ color: 'var(--primary-color)' }} />
                            <span>Daten werden synchronisiert...</span>
                        </>
                    ) : (
                        <>
                            <Check size={18} style={{ color: 'var(--success-color)' }} />
                            <span>Bereit! Weiterleitung...</span>
                        </>
                    )}
                </div>

                {/* Manual Button (Fallback) */}
                <button
                    onClick={() => navigate('/')}
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
                    Zum Dashboard <ArrowRight size={18} />
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
