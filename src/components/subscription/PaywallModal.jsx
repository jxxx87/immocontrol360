import React, { useEffect, useRef, useState } from 'react';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Check, X, Loader2, Crown, Shield, Zap, Star } from 'lucide-react';

/* ─── Plan Data ──────────────────────────────────────────── */
const PLANS = [
    {
        id: 'starter',
        title: 'Starter',
        monthly: '9,99',
        yearly: '8,99',
        features: ['Bis zu 5 Einheiten', 'Grundlegende Buchhaltung', 'E-Mail Support'],
        accent: '#64748b',      // slate
        accentLight: '#f1f5f9',
    },
    {
        id: 'professional',
        title: 'Professional',
        monthly: '32,99',
        yearly: '29,69',
        features: ['Bis zu 50 Einheiten', 'Mieterportal Zugänge', 'Investorportal', 'Automatisierungen'],
        accent: '#0ea5e9',      // sky / primary
        accentLight: '#e0f2fe',
        popular: true,
    },
    {
        id: 'business',
        title: 'Business',
        monthly: '59,99',
        yearly: '53,99',
        features: ['Bis zu 250 Einheiten', 'Multi-User (Teams)', 'API-Zugriff', 'Priorisierter Support'],
        accent: '#f59e0b',      // amber
        accentLight: '#fef3c7',
    },
];

/* ─── Component ──────────────────────────────────────────── */
const PaywallModal = () => {
    const { showPaywall, setShowPaywall, paywallReason } = useSubscription();
    const { session } = useAuth();
    const [loadingPlan, setLoadingPlan] = useState(null);
    const [billingPeriod, setBillingPeriod] = useState('yearly');
    const dialogRef = useRef(null);

    const isMonthly = billingPeriod === 'monthly';

    // ── Native <dialog> Control ──
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (showPaywall && session) {
            if (!dialog.open) dialog.showModal();
        } else {
            if (dialog.open) dialog.close();
        }
    }, [showPaywall, session]);

    // Handle ESC
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const onCancel = (e) => { e.preventDefault(); setShowPaywall(false); };
        dialog.addEventListener('cancel', onCancel);
        return () => dialog.removeEventListener('cancel', onCancel);
    }, [setShowPaywall]);

    // ── Handlers ──
    const handleSubscribe = async (planId) => {
        setLoadingPlan(planId);
        try {
            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                body: { plan_id: planId, billing_period: billingPeriod, user_id: session.user.id },
            });
            if (error) throw error;
            if (data?.url) window.location.href = data.url;
        } catch (err) {
            console.error('Checkout error:', err);
            alert('Fehler beim Starten des Checkouts.');
        } finally {
            setLoadingPlan(null);
        }
    };

    const getHeadline = () => {
        switch (paywallReason) {
            case 'trial_expired': return 'Testzeitraum abgelaufen';
            case 'limit_reached': return 'Einheiten-Limit erreicht';
            case 'feature_locked': return 'Premium Feature';
            default: return 'Wähle deinen Plan';
        }
    };

    if (!session) return null;

    /* ─── Styles ──────────────────────────────────────────── */
    const s = {
        dialog: {
            border: 'none',
            borderRadius: 'var(--radius-xl)',
            padding: 0,
            maxWidth: '960px',
            width: '95%',
            background: 'transparent',
            overflow: 'auto',
            outline: 'none',
            boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
            margin: 'auto',
        },
        wrapper: {
            display: 'flex',
            flexDirection: 'row',
            borderRadius: 'var(--radius-xl)',
            overflow: 'auto',
            background: '#ffffff',
            fontFamily: 'var(--font-family)',
        },
        // Left panel
        left: {
            width: '340px',
            minWidth: '340px',
            background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 40%, #0c4a6e 80%, #0f172a 100%)',
            color: '#ffffff',
            padding: '40px 32px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            position: 'relative',
        },
        leftBadge: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: '#818cf8',
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '2px',
            marginBottom: '20px',
        },
        leftTitle: {
            fontSize: '28px',
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: '16px',
            color: '#ffffff',
        },
        leftDesc: {
            fontSize: '14px',
            color: '#94a3b8',
            lineHeight: 1.7,
            marginBottom: '32px',
        },
        featureRow: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
        },
        featureIcon: {
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'rgba(129, 140, 248, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#818cf8',
            flexShrink: 0,
        },
        featureText: {
            fontSize: '13px',
            fontWeight: 600,
            color: '#cbd5e1',
        },
        toggle: {
            display: 'flex',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '10px',
            padding: '4px',
            marginTop: '32px',
        },
        toggleBtn: (active) => ({
            flex: 1,
            padding: '8px 0',
            fontSize: '13px',
            fontWeight: 600,
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: active ? '#6366f1' : 'transparent',
            color: active ? '#fff' : '#64748b',
        }),
        // Right panel
        right: {
            flex: 1,
            padding: '32px',
            background: '#eef2f7',
            overflowY: 'auto',
            maxHeight: '85vh',
        },
        closeBtn: {
            position: 'absolute',
            top: '16px',
            right: '16px',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(0,0,0,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#64748b',
            transition: 'background 0.2s',
            zIndex: 10,
        },
        cardsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
        },
        card: (plan, isHovered) => ({
            background: '#ffffff',
            borderRadius: 'var(--radius-lg)',
            border: plan.popular ? `2px solid ${plan.accent}` : '1px solid #e2e8f0',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            transition: 'all 0.25s ease',
            transform: isHovered ? 'translateY(-4px)' : plan.popular ? 'translateY(-8px)' : 'none',
            boxShadow: plan.popular
                ? '0 20px 40px rgba(14, 165, 233, 0.15)'
                : isHovered
                    ? 'var(--shadow-lg)'
                    : 'var(--shadow-sm)',
        }),
        popularBadge: {
            position: 'absolute',
            top: '-12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0ea5e9',
            color: '#fff',
            fontSize: '10px',
            fontWeight: 700,
            padding: '4px 14px',
            borderRadius: '20px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            whiteSpace: 'nowrap',
        },
        cardIcon: (accent, accentLight) => ({
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: accentLight,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '16px',
        }),
        cardTitle: {
            fontSize: '18px',
            fontWeight: 700,
            color: '#1e293b',
            marginBottom: '8px',
        },
        cardPrice: {
            fontSize: '32px',
            fontWeight: 800,
            color: '#0f172a',
            lineHeight: 1,
        },
        cardPriceSuffix: {
            fontSize: '14px',
            fontWeight: 500,
            color: '#94a3b8',
            marginLeft: '4px',
        },
        cardFeatures: {
            listStyle: 'none',
            padding: 0,
            margin: '20px 0',
            flex: 1,
        },
        cardFeatureItem: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: '#475569',
            marginBottom: '10px',
        },
        cardBtn: (plan) => ({
            width: '100%',
            padding: '12px',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: plan.popular ? plan.accent : '#f1f5f9',
            color: plan.popular ? '#fff' : '#1e293b',
        }),
    };

    /* ─── Render ──────────────────────────────────────────── */
    return (
        <dialog ref={dialogRef} style={s.dialog}>
            <style>{`
                dialog::backdrop {
                    background: rgba(15, 23, 42, 0.7);
                    backdrop-filter: blur(6px);
                }
                dialog[open] {
                    max-height: 90vh;
                    overflow-y: auto;
                    -webkit-overflow-scrolling: touch;
                }
                @media (max-width: 768px) {
                    dialog[open] {
                        max-height: 95vh;
                        width: 100% !important;
                        border-radius: 12px !important;
                        margin: 8px auto !important;
                    }
                    .paywall-wrapper { 
                        flex-direction: column !important; 
                        max-height: none !important;
                        overflow: visible !important;
                    }
                    .paywall-left { 
                        width: 100% !important; 
                        min-width: unset !important; 
                        padding: 20px 16px !important;
                        min-height: auto !important;
                    }
                    .paywall-right { 
                        padding: 16px !important; 
                    }
                    .paywall-cards { 
                        grid-template-columns: 1fr !important; 
                    }
                }
            `}</style>

            <div className="paywall-wrapper" style={s.wrapper}>

                {/* ── Left Panel ── */}
                <div className="paywall-left" style={s.left}>
                    <div>
                        <div style={s.leftBadge}>
                            <Crown size={14} /> Premium
                        </div>
                        <h2 style={s.leftTitle}>{getHeadline()}</h2>
                        <p style={s.leftDesc}>
                            Profitiere von allen Funktionen und maximiere deinen Erfolg in der Immobilienverwaltung.
                        </p>

                        <div style={s.featureRow}>
                            <div style={s.featureIcon}><Zap size={18} /></div>
                            <span style={s.featureText}>Volle Verwaltungspower</span>
                        </div>
                        <div style={s.featureRow}>
                            <div style={s.featureIcon}><Shield size={18} /></div>
                            <span style={s.featureText}>Sichere Dokumentenablage</span>
                        </div>
                        <div style={s.featureRow}>
                            <div style={s.featureIcon}><Star size={18} /></div>
                            <span style={s.featureText}>Prioritärer Support</span>
                        </div>
                    </div>

                    {/* Billing Toggle */}
                    <div style={s.toggle}>
                        <button style={s.toggleBtn(isMonthly)} onClick={() => setBillingPeriod('monthly')}>Monatlich</button>
                        <button style={s.toggleBtn(!isMonthly)} onClick={() => setBillingPeriod('yearly')}>Jährlich (-10%)</button>
                    </div>
                </div>

                {/* ── Right Panel ── */}
                <div className="paywall-right" style={s.right}>

                    {/* Close Button */}
                    <button
                        style={s.closeBtn}
                        onClick={() => setShowPaywall(false)}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.08)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
                    >
                        <X size={20} />
                    </button>

                    {/* Plan Cards */}
                    <div className="paywall-cards" style={s.cardsGrid}>
                        {PLANS.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                isMonthly={isMonthly}
                                loading={loadingPlan === plan.id}
                                onSubscribe={() => handleSubscribe(plan.id)}
                                styles={s}
                            />
                        ))}
                    </div>

                    {/* Footer */}
                    <div style={{ marginTop: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '12px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Shield size={12} /> Sichere Zahlung via Stripe</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} /> Sofortiger Zugriff</span>
                    </div>
                </div>
            </div>
        </dialog>
    );
};

/* ─── Plan Card Sub-Component ──────────────────────────── */
const PlanCard = ({ plan, isMonthly, loading, onSubscribe, styles }) => {
    const [hovered, setHovered] = useState(false);
    const s = styles;

    const icons = {
        starter: <Shield size={22} />,
        professional: <Zap size={22} />,
        business: <Crown size={22} />,
    };

    return (
        <div
            style={s.card(plan, hovered)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {plan.popular && <div style={s.popularBadge}>Beliebt</div>}

            <div style={s.cardIcon(plan.accent, plan.accentLight)}>
                {icons[plan.id]}
            </div>

            <div style={s.cardTitle}>{plan.title}</div>

            <div style={{ marginBottom: '20px' }}>
                <span style={s.cardPrice}>{isMonthly ? plan.monthly : plan.yearly}€</span>
                <span style={s.cardPriceSuffix}>/Monat</span>
            </div>

            <ul style={s.cardFeatures}>
                {plan.features.map((f, i) => (
                    <li key={i} style={s.cardFeatureItem}>
                        <Check size={15} color="#10b981" />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            <button
                onClick={onSubscribe}
                disabled={loading}
                style={s.cardBtn(plan)}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}
            >
                {loading ? <Loader2 size={18} className="animate-spin" /> : plan.popular ? 'Jetzt upgraden' : 'Wählen'}
            </button>
        </div>
    );
};

export default PaywallModal;
