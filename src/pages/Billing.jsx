import React, { useState, useEffect, useRef } from 'react';
import {
    CreditCard,
    Receipt,
    ExternalLink,
    AlertTriangle,
    CheckCircle2,
    Clock,
    XCircle,
    Loader2,
    Crown,
    Shield,
    Zap,
    ArrowRight,
    Sparkles
} from 'lucide-react';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

/* ─── Plan Display Data ─────────────────────────────────── */
const PLAN_INFO = {
    starter: { label: 'Starter', icon: Shield, color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' },
    professional: { label: 'Professional', icon: Zap, color: '#0ea5e9', bg: '#e0f2fe', border: '#bae6fd' },
    business: { label: 'Business', icon: Crown, color: '#f59e0b', bg: '#fef3c7', border: '#fde68a' },
};

const STATUS_MAP = {
    active: { label: 'Aktiv', color: '#16a34a', bg: '#dcfce7', icon: CheckCircle2 },
    trialing: { label: 'Testphase', color: '#0ea5e9', bg: '#e0f2fe', icon: Clock },
    past_due: { label: 'Zahlung ausstehend', color: '#dc2626', bg: '#fef2f2', icon: AlertTriangle },
    canceled: { label: 'Gekündigt', color: '#6b7280', bg: '#f3f4f6', icon: XCircle },
    incomplete: { label: 'Unvollständig', color: '#f59e0b', bg: '#fef3c7', icon: AlertTriangle },
};

/* ─── Component ─────────────────────────────────────────── */
const Billing = () => {
    const { subscription, refreshSubscription, setShowPaywall, setPaywallReason } = useSubscription();
    const { session } = useAuth();
    const [portalLoading, setPortalLoading] = useState(false);
    const [invoicesLoading, setInvoicesLoading] = useState(false);

    // ── Auto-Refresh wenn User vom Stripe Portal zurückkommt ──
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && refreshSubscription) {
                console.log('[Billing] Tab sichtbar → Subscription wird aktualisiert...');
                refreshSubscription();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refreshSubscription]);

    // ── Portal öffnen ──
    const openPortal = async (section = 'default') => {
        if (section === 'invoices') {
            setInvoicesLoading(true);
        } else {
            setPortalLoading(true);
        }

        try {
            const origin = window.location.origin;
            const { data, error } = await supabase.functions.invoke('create-portal-session', {
                body: {
                    user_id: session.user.id,
                    return_url: `${origin}/settings`,
                },
            });

            if (error) throw error;

            if (data?.error === 'no_customer') {
                alert(data.message);
                return;
            }

            if (data?.url) {
                window.location.href = data.url;
            }
        } catch (err) {
            console.error('Portal error:', err);
            alert('Fehler beim Öffnen des Stripe Portals.');
        } finally {
            setPortalLoading(false);
            setInvoicesLoading(false);
        }
    };

    // ── Checkout öffnen ──
    const openCheckout = () => {
        setPaywallReason('manual_upgrade');
        setShowPaywall(true);
    };

    /* ─── Styles ────────────────────────────────────────── */
    const styles = {
        page: {
            maxWidth: '780px',
            margin: '0 auto',
            padding: '32px 20px',
            fontFamily: 'var(--font-family)',
        },
        header: {
            marginBottom: '32px',
        },
        title: {
            fontSize: '28px',
            fontWeight: 800,
            color: 'var(--text-primary)',
            marginBottom: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '14px',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
        },
        card: {
            background: 'var(--surface-color)',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            padding: '28px',
            marginBottom: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        },
        cardTitle: {
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        row: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 0',
            borderBottom: '1px solid var(--border-color)',
        },
        rowLast: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 0',
        },
        label: {
            fontSize: '13px',
            color: 'var(--text-secondary)',
            fontWeight: 500,
        },
        value: {
            fontSize: '14px',
            color: 'var(--text-primary)',
            fontWeight: 600,
        },
        badge: (color, bg) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 700,
            background: bg,
            color: color,
        }),
        btnPrimary: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            borderRadius: '12px',
            border: 'none',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
            color: '#fff',
            boxShadow: '0 2px 8px rgba(14,165,233,0.3)',
        },
        btnSecondary: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: 'var(--surface-color)',
            color: 'var(--text-primary)',
        },
        btnWarning: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            borderRadius: '12px',
            border: 'none',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            color: '#fff',
            boxShadow: '0 2px 8px rgba(239,68,68,0.3)',
        },
        btnCheckout: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '14px 28px',
            borderRadius: '12px',
            border: 'none',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            color: '#fff',
            boxShadow: '0 4px 15px rgba(99,102,241,0.3)',
        },
        warningBanner: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderRadius: '12px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            marginBottom: '20px',
        },
        hint: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginTop: '16px',
            padding: '10px 14px',
            background: 'var(--background-color)',
            borderRadius: '10px',
        },
        noSubCard: {
            background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%)',
            borderRadius: '16px',
            border: '1px solid #bae6fd',
            padding: '40px 32px',
            textAlign: 'center',
        },
        actions: {
            display: 'flex',
            gap: '12px',
            marginTop: '24px',
            flexWrap: 'wrap',
        },
    };

    const plan = subscription?.plan || null;
    const status = subscription?.status || null;
    const planInfo = PLAN_INFO[plan] || null;
    const statusInfo = STATUS_MAP[status] || null;

    const hasSub = !!subscription;
    const isTrial = subscription?.status === 'trialing';
    const hasCustomer = !!subscription?.stripe_customer_id;

    // Trial: Verbleibende Tage
    const trialDaysLeft = subscription?.trial_ends_at
        ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24)))
        : 0;

    const trialEndDate = subscription?.trial_ends_at
        ? new Date(subscription.trial_ends_at).toLocaleDateString('de-DE', {
            day: '2-digit', month: 'long', year: 'numeric'
        })
        : null;

    const nextBillingDate = subscription?.current_period_end
        ? new Date(subscription.current_period_end).toLocaleDateString('de-DE', {
            day: '2-digit', month: 'long', year: 'numeric'
        })
        : null;

    /* ─── Render ─────────────────────────────────────────── */
    return (
        <div style={styles.page}>

            {/* Header */}
            <div style={styles.header}>
                <h1 style={styles.title}>
                    <CreditCard size={28} color="#0ea5e9" />
                    Abrechnung & Abo
                </h1>
                <p style={styles.subtitle}>
                    Verwalte dein Abonnement, Zahlungsmethoden und Rechnungen.
                </p>
            </div>

            {/* past_due Warning Banner */}
            {status === 'past_due' && (
                <div style={styles.warningBanner}>
                    <AlertTriangle size={22} color="#dc2626" />
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#991b1b', marginBottom: '2px' }}>
                            Zahlung fehlgeschlagen
                        </div>
                        <div style={{ fontSize: '13px', color: '#b91c1c' }}>
                            Bitte aktualisiere deine Zahlungsmethode, um dein Abo fortzusetzen.
                        </div>
                    </div>
                    <button
                        style={{ ...styles.btnWarning, marginLeft: 'auto', whiteSpace: 'nowrap' }}
                        onClick={() => openPortal()}
                        disabled={portalLoading}
                    >
                        {portalLoading ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                        Zahlungsmethode aktualisieren
                    </button>
                </div>
            )}

            {/* ── 1. Testphase (Trial) ── */}
            {hasSub && isTrial && !hasCustomer && (
                <>
                    <div style={{
                        ...styles.card,
                        background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                        border: '1px solid #bae6fd',
                    }}>
                        <div style={styles.cardTitle}>
                            <Clock size={18} color="#0ea5e9" />
                            Kostenlose Testphase
                        </div>

                        {/* Status */}
                        <div style={styles.row}>
                            <span style={styles.label}>Status</span>
                            <span style={styles.badge('#0ea5e9', '#e0f2fe')}>
                                <Clock size={14} />
                                Testphase aktiv
                            </span>
                        </div>

                        {/* Verbleibende Tage */}
                        <div style={styles.row}>
                            <span style={styles.label}>Verbleibende Tage</span>
                            <span style={{
                                ...styles.value,
                                color: trialDaysLeft <= 3 ? '#dc2626' : '#0ea5e9',
                                fontWeight: 700,
                            }}>
                                {trialDaysLeft} {trialDaysLeft === 1 ? 'Tag' : 'Tage'}
                            </span>
                        </div>

                        {/* Enddatum */}
                        <div style={styles.rowLast}>
                            <span style={styles.label}>Testphase endet am</span>
                            <span style={styles.value}>{trialEndDate || '—'}</span>
                        </div>

                        {/* Upgrade CTA */}
                        <div style={styles.actions}>
                            <button
                                style={styles.btnCheckout}
                                onClick={openCheckout}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                            >
                                <Crown size={18} />
                                Jetzt Abo abschließen
                                <ArrowRight size={16} />
                            </button>
                        </div>

                        {/* Hint */}
                        <div style={styles.hint}>
                            <Sparkles size={14} color="#0ea5e9" />
                            Nach Ablauf der Testphase benötigst du ein Abo, um die App weiter zu nutzen.
                        </div>
                    </div>
                </>
            )}

            {/* ── 2. Bezahltes Abo (mit stripe_customer_id) ── */}
            {hasCustomer && (
                <>
                    {/* Card: Dein Abo */}
                    <div style={styles.card}>
                        <div style={styles.cardTitle}>
                            <Crown size={18} color="#0ea5e9" />
                            Dein Abo
                        </div>

                        {/* Plan */}
                        <div style={styles.row}>
                            <span style={styles.label}>Plan</span>
                            {planInfo ? (
                                <span style={styles.badge(planInfo.color, planInfo.bg)}>
                                    {React.createElement(planInfo.icon, { size: 14 })}
                                    {planInfo.label}
                                </span>
                            ) : (
                                <span style={styles.value}>{plan || '—'}</span>
                            )}
                        </div>

                        {/* Status */}
                        <div style={styles.row}>
                            <span style={styles.label}>Status</span>
                            {statusInfo ? (
                                <span style={styles.badge(statusInfo.color, statusInfo.bg)}>
                                    {React.createElement(statusInfo.icon, { size: 14 })}
                                    {statusInfo.label}
                                </span>
                            ) : (
                                <span style={styles.value}>{status || '—'}</span>
                            )}
                        </div>

                        {/* Next billing */}
                        <div style={styles.rowLast}>
                            <span style={styles.label}>Nächste Abrechnung</span>
                            <span style={styles.value}>{nextBillingDate || 'Siehe Stripe-Portal'}</span>
                        </div>

                        {/* Actions */}
                        <div style={styles.actions}>
                            <button
                                style={styles.btnPrimary}
                                onClick={() => openPortal()}
                                disabled={portalLoading}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                            >
                                {portalLoading ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                                Abo verwalten
                                <ExternalLink size={14} />
                            </button>

                            <button
                                style={styles.btnSecondary}
                                onClick={() => openPortal('invoices')}
                                disabled={invoicesLoading}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--background-color)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-color)'; }}
                            >
                                {invoicesLoading ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
                                Rechnungen anzeigen
                                <ExternalLink size={14} />
                            </button>
                        </div>

                        {/* Hint */}
                        <div style={styles.hint}>
                            <Shield size={14} color="var(--text-secondary)" />
                            Du verwaltest Zahlung, Rechnungen und Kündigung sicher über Stripe.
                        </div>
                    </div>

                    {/* Card: Was du im Portal tun kannst */}
                    <div style={styles.card}>
                        <div style={styles.cardTitle}>
                            <Sparkles size={18} color="#0ea5e9" />
                            Was du im Stripe-Portal tun kannst
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                            {[
                                { icon: CreditCard, text: 'Zahlungsmethode ändern' },
                                { icon: Receipt, text: 'Rechnungen & Belege' },
                                { icon: Crown, text: 'Plan wechseln (Up-/Downgrade)' },
                                { icon: XCircle, text: 'Abo kündigen' },
                            ].map(({ icon: Icon, text }, i) => (
                                <div key={i} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '12px 14px',
                                    borderRadius: '10px',
                                    background: 'var(--background-color)',
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    color: 'var(--text-secondary)',
                                }}>
                                    <Icon size={16} color="#0ea5e9" />
                                    {text}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* ── 3. Gar kein Abo ── */}
            {!hasSub && (
                <div style={styles.noSubCard}>
                    <Sparkles size={40} color="#0ea5e9" style={{ marginBottom: '16px' }} />
                    <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                        Kein aktives Abo gefunden
                    </h2>
                    <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px', maxWidth: '400px', margin: '0 auto 24px' }}>
                        Schließe jetzt ein Abo ab, um alle Funktionen von ImmoControl Pro 360 freizuschalten.
                    </p>
                    <button
                        style={styles.btnCheckout}
                        onClick={openCheckout}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                        <Crown size={18} />
                        Zum Checkout
                        <ArrowRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default Billing;
