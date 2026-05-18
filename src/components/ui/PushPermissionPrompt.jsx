import React, { useState, useEffect } from 'react';
import { Bell, X, Shield } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';

/**
 * PushPermissionPrompt
 * 
 * Beautiful onboarding dialog that asks users to enable push notifications.
 * Appears once after login/app start if permission hasn't been granted yet.
 * Works in both browser and Capacitor (native app) environments.
 */
const PushPermissionPrompt = () => {
    const { permissionGranted, requestPermission } = useNotifications();
    const [visible, setVisible] = useState(false);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        // Don't show if already granted or already dismissed
        if (permissionGranted) return;

        const alreadyDismissed = localStorage.getItem('immo_push_prompt_dismissed');
        if (alreadyDismissed) return;

        // In native app: permission is handled by Android native dialog (MainActivity.java)
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (isNative) return;

        // Check if Notification API exists and already denied
        if ('Notification' in window && Notification.permission === 'denied') {
            return;
        }

        // Show with a slight delay for better UX (let the app load first)
        const timer = setTimeout(() => {
            setVisible(true);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setAnimating(true));
            });
        }, 2000);

        return () => clearTimeout(timer);
    }, [permissionGranted]);

    const handleAllow = async () => {
        const granted = await requestPermission();
        if (granted && 'Notification' in window && Notification.permission === 'granted') {
            try {
                new Notification('ImmoControl Pro 360', {
                    body: 'Push-Benachrichtigungen wurden aktiviert! 🎉',
                    icon: '/logo.svg',
                });
            } catch (e) {
                // Native app doesn't support this constructor
            }
        }
        localStorage.setItem('immo_push_prompt_dismissed', 'true');
        dismiss();
    };

    const handleDismiss = () => {
        localStorage.setItem('immo_push_prompt_dismissed', 'true');
        dismiss();
    };

    const dismiss = () => {
        setAnimating(false);
        setTimeout(() => setVisible(false), 300);
    };

    if (!visible) return null;

    const isMobile = window.innerWidth < 768;

    return (
        <>
            {/* Backdrop */}
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.45)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                    zIndex: 99999,
                    opacity: animating ? 1 : 0,
                    transition: 'opacity 0.3s ease',
                }}
                onClick={handleDismiss}
            />

            {/* Dialog */}
            <div
                id="push-permission-dialog"
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: animating
                        ? 'translate(-50%, -50%) scale(1)'
                        : 'translate(-50%, -50%) scale(0.92)',
                    width: isMobile ? 'calc(100% - 32px)' : '420px',
                    maxWidth: '420px',
                    backgroundColor: 'var(--surface-color, #fff)',
                    borderRadius: '20px',
                    boxShadow: '0 25px 65px rgba(0, 0, 0, 0.25), 0 8px 24px rgba(0, 0, 0, 0.15)',
                    border: '1px solid var(--glass-border, rgba(255,255,255,0.2))',
                    zIndex: 100000,
                    overflow: 'hidden',
                    opacity: animating ? 1 : 0,
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
            >
                {/* Close Button */}
                <button
                    onClick={handleDismiss}
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        padding: '6px',
                        borderRadius: '50%',
                        color: 'rgba(255,255,255,0.7)',
                        zIndex: 1,
                        background: 'rgba(0,0,0,0.15)',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.3)';
                        e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.15)';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                    }}
                >
                    <X size={16} />
                </button>

                {/* Decorative Top Gradient */}
                <div style={{
                    height: '130px',
                    background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 50%, #7c3aed 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    {/* Background decoration circles */}
                    <div style={{
                        position: 'absolute',
                        width: '200px',
                        height: '200px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        top: '-80px',
                        right: '-40px',
                    }} />
                    <div style={{
                        position: 'absolute',
                        width: '120px',
                        height: '120px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255, 255, 255, 0.06)',
                        bottom: '-40px',
                        left: '-20px',
                    }} />

                    {/* Bell Icon */}
                    <div style={{
                        width: '68px',
                        height: '68px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'bell-swing 2s ease-in-out infinite',
                    }}>
                        <Bell size={34} color="#fff" />
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: '24px 28px 28px' }}>
                    <h2 style={{
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        margin: '0 0 8px',
                        textAlign: 'center',
                    }}>
                        Benachrichtigungen aktivieren
                    </h2>
                    <p style={{
                        fontSize: '0.88rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.6,
                        margin: '0 0 20px',
                        textAlign: 'center',
                    }}>
                        Erhalten Sie sofortige Updates über neue Nachrichten, Ticket-Updates und wichtige Ankündigungen.
                    </p>

                    {/* Feature List */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        marginBottom: '24px',
                    }}>
                        {[
                            { icon: '💬', text: 'Neue Nachrichten sofort erhalten' },
                            { icon: '🎫', text: 'Ticket-Updates in Echtzeit' },
                            { icon: '📢', text: 'Wichtige Ankündigungen' },
                        ].map((item, i) => (
                            <div key={i} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '10px 14px',
                                borderRadius: '12px',
                                backgroundColor: 'rgba(14, 165, 233, 0.05)',
                                border: '1px solid rgba(14, 165, 233, 0.1)',
                            }}>
                                <span style={{ fontSize: '1.15rem' }}>{item.icon}</span>
                                <span style={{
                                    fontSize: '0.84rem',
                                    color: 'var(--text-primary)',
                                    fontWeight: 500,
                                }}>
                                    {item.text}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button
                            id="push-allow-btn"
                            onClick={handleAllow}
                            style={{
                                width: '100%',
                                padding: '13px',
                                borderRadius: '12px',
                                background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)',
                                color: '#fff',
                                fontSize: '0.92rem',
                                fontWeight: 600,
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 4px 14px rgba(14, 165, 233, 0.35)',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(14, 165, 233, 0.45)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 14px rgba(14, 165, 233, 0.35)';
                            }}
                        >
                            <Bell size={18} />
                            Benachrichtigungen aktivieren
                        </button>
                        <button
                            id="push-dismiss-btn"
                            onClick={handleDismiss}
                            style={{
                                width: '100%',
                                padding: '11px',
                                borderRadius: '12px',
                                backgroundColor: 'transparent',
                                color: 'var(--text-secondary)',
                                fontSize: '0.85rem',
                                fontWeight: 500,
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.04)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            Später erinnern
                        </button>
                    </div>

                    {/* Privacy note */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        marginTop: '16px',
                    }}>
                        <Shield size={12} color="var(--text-secondary)" style={{ opacity: 0.5 }} />
                        <span style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            opacity: 0.6,
                        }}>
                            Sie können Benachrichtigungen jederzeit deaktivieren
                        </span>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes bell-swing {
                    0%, 100% { transform: rotate(0deg); }
                    15% { transform: rotate(12deg); }
                    30% { transform: rotate(-10deg); }
                    45% { transform: rotate(6deg); }
                    60% { transform: rotate(-4deg); }
                    75% { transform: rotate(2deg); }
                }
            `}</style>
        </>
    );
};

export default PushPermissionPrompt;
