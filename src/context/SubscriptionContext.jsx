import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';


const SubscriptionContext = createContext();

export const useSubscription = () => {
    return useContext(SubscriptionContext);
};

// Wartezeiten für erneute Versuche, wenn das Abo nicht geladen werden konnte (ms)
const RETRY_DELAYS = [2000, 5000, 15000];

// ── Zugangslogik (eine gemeinsame Quelle für alle Prüfungen) ──
// Positivliste: Zugang nur bei aktivem Abo oder gültiger Testphase, alles andere ist gesperrt.

// App-eigene Testphase (register-trial): trialing ohne Stripe-Abo, Enddatum in der Zukunft
const isAppTrialActive = (sub) => {
    if (!sub || sub.status !== 'trialing' || sub.stripe_subscription_id) return false;
    return !!sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date();
};

// Bezahltes Abo: active – oder eine Testphase, die über Stripe läuft (mit Stripe-Abo)
const isPaidActive = (sub) => {
    if (!sub) return false;
    if (sub.status === 'active') return true;
    if (sub.status === 'trialing' && sub.stripe_subscription_id) {
        const end = sub.trial_ends_at || sub.current_period_end;
        return !end || new Date(end) > new Date();
    }
    return false;
};

/** Liefert { granted, reason } – reason wie bisher: no_subscription | trial_expired | subscription_inactive */
const getAccessState = (sub) => {
    if (!sub) return { granted: false, reason: 'no_subscription' };
    if (isPaidActive(sub) || isAppTrialActive(sub)) return { granted: true, reason: null };
    if (sub.status === 'trialing') return { granted: false, reason: 'trial_expired' };
    // canceled, past_due, unpaid, incomplete, incomplete_expired, paused, unbekannt
    return { granted: false, reason: 'subscription_inactive' };
};

export const SubscriptionProvider = ({ children }) => {
    const { session, userRole } = useAuth();
    const [subscriptionRow, setSubscription] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showPaywall, setShowPaywall] = useState(false);
    const [paywallReason, setPaywallReason] = useState(null); // 'manual_upgrade', 'trial_expired', 'limit_reached', 'feature_locked'

    const initialAuthCheckedRef = useRef(false);
    const retryTimerRef = useRef(null);

    const userId = session?.user?.id || null;
    // Nur die Zeile des aktuell angemeldeten Nutzers verwenden (z. B. nach Kontowechsel)
    const subscription = subscriptionRow && subscriptionRow.user_id === userId ? subscriptionRow : null;

    /**
     * Lädt die Abo-Zeile. Bei einem Fehler bleibt der zuletzt bekannte Stand erhalten
     * und es wird später erneut versucht. Gibt die geladene Zeile (oder null) zurück,
     * bei einem Fehler undefined.
     */
    const fetchSubscription = useCallback(async (attempt = 0) => {
        if (!userId) return undefined;
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        try {
            const { data, error } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) throw error;
            setSubscription(data);
            setLoadError(null);
            return data;
        } catch (err) {
            console.error('Error fetching subscription:', err);
            setLoadError(err);
            if (attempt < RETRY_DELAYS.length) {
                retryTimerRef.current = setTimeout(() => {
                    retryTimerRef.current = null;
                    fetchSubscription(attempt + 1);
                }, RETRY_DELAYS[attempt]);
            }
            return undefined;
        } finally {
            setLoading(false);
        }
    }, [userId]);

    // Öffentliche Variante ohne Parameter (bisherige Signatur)
    const refreshSubscription = useCallback(() => fetchSubscription(0), [fetchSubscription]);

    useEffect(() => {
        if (userId) {
            // Aufruf im Callback, damit kein setState synchron im Effekt-Body passiert
            initialAuthCheckedRef.current = true;
            const timer = setTimeout(() => fetchSubscription(0), 0);
            return () => clearTimeout(timer);
        } else if (session === null && initialAuthCheckedRef.current) {
            // Session explicitly null after auth check completed
            const timer = setTimeout(() => {
                setSubscription(null);
                setLoadError(null);
                setLoading(false);
            }, 0);
            return () => clearTimeout(timer);
        } else if (session === null) {
            // First render – wait briefly for auth to resolve
            const timer = setTimeout(() => {
                initialAuthCheckedRef.current = true;
                setSubscription(null);
                setLoading(false);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [userId, session, fetchSubscription]);

    // Laufende Wiederholungsversuche beim Abmelden/Unmount abbrechen
    useEffect(() => () => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    }, [userId]);

    // ── LOGIC ──

    // Unbekannter Stand (Ladefehler ohne bisher geladene Daten): nicht sperren
    const isUnknown = !!loadError && !subscription;

    const isTrialActive = () => isAppTrialActive(subscription);

    const isSubscriptionActive = () => isPaidActive(subscription);

    const hasAccess = () => getAccessState(subscription).granted;

    const getPlanFeatures = () => {
        const plan = subscription?.plan || 'starter'; // Default fallback

        // Limits based on user requirement
        switch (plan) {
            case 'starter':
                return { maxUnits: 5, features: ['basic'] };
            case 'professional':
                return { maxUnits: 50, features: ['basic', 'tenant_portal', 'investor_portal'] };
            case 'business':
                return { maxUnits: 250, features: ['basic', 'tenant_portal', 'investor_portal', 'multi_user'] };
            default:
                return { maxUnits: 0, features: [] };
        }
    };

    // ── CHECKS ──

    // 1. Global Lock (Trial Expired / No Payment)
    const checkGlobalAccess = (isAutoCheck = false) => {
        if (loading) return true; // Let it load
        if (isUnknown) return true; // Abo konnte nicht geladen werden → keine Paywall auf Verdacht

        const { granted, reason } = getAccessState(subscription);

        if (!granted) {
            setPaywallReason(reason);
            if (reason === 'subscription_inactive') {
                // Gekündigt / Zahlung offen / unvollständig → wie bisher sofort anzeigen
                setShowPaywall(true);
            } else if (!isAutoCheck) {
                // Kein Abo / abgelaufene Testphase: erst beim Versuch, eine Funktion zu nutzen
                // (vermeidet Flackern beim Laden)
                setShowPaywall(true);
            }
            return false;
        }

        if (paywallReason === 'no_subscription' || paywallReason === 'subscription_inactive' || paywallReason === 'trial_expired') {
            setPaywallReason(null);
            setShowPaywall(false);
        }

        return true; // Access granted
    };

    // Auto-check access when subscription loads/changes
    const checkGlobalAccessRef = useRef(checkGlobalAccess);
    useEffect(() => { checkGlobalAccessRef.current = checkGlobalAccess; });
    useEffect(() => {
        if (!loading && userId && !(loadError && !subscription)) {
            const timer = setTimeout(() => checkGlobalAccessRef.current(true), 0);
            return () => clearTimeout(timer);
        }
    }, [subscription, loading, userId, loadError]);

    // 2. Feature Check (e.g. 'investor_portal')
    const hasFeature = (featureKey) => {
        // Tenants always have full access — their portal is free
        if (userRole === 'tenant') return true;

        if (loading) return false;
        if (isUnknown) return true; // Ladefehler: nicht fälschlich sperren

        // Strict check: Must have valid access (Trial or Active Subscription)
        if (!hasAccess()) return false;

        // During trial, everything is unlocked
        if (isTrialActive()) return true;

        const { features } = getPlanFeatures();
        return features.includes(featureKey);
    };

    const checkFeatureAccess = (featureKey) => {
        // Tenants always have full access — their portal is free
        if (userRole === 'tenant') return true;

        if (!checkGlobalAccess()) return false;

        if (!hasFeature(featureKey)) {
            setPaywallReason('feature_locked');
            setShowPaywall(true);
            return false;
        }

        return true;
    };

    // 3. Usage Limit Check (e.g. adding 6th unit on Starter)
    // limitType ist derzeit immer 'units' (Parameter bleibt für bestehende Aufrufer erhalten)
    const checkUsageLimit = (currentCount) => {
        if (!checkGlobalAccess()) return false;
        if (isUnknown) return true;

        // During trial, user has Business limits (250)
        const limits = isTrialActive() ? { maxUnits: 250 } : getPlanFeatures();

        const max = limits.maxUnits;

        if (currentCount >= max) {
            setPaywallReason('limit_reached');
            setShowPaywall(true);
            return false;
        }

        return true;
    };

    return (
        <SubscriptionContext.Provider value={{
            subscription,
            subscriptionLoading: loading,
            subscriptionError: loadError,
            isTrialActive,
            isSubscriptionActive,
            checkGlobalAccess,
            hasFeature,
            checkFeatureAccess,
            checkUsageLimit,
            paywallReason,
            setPaywallReason,
            showPaywall,
            setShowPaywall,
            refreshSubscription,
        }}>
            {children}
        </SubscriptionContext.Provider>
    );
};
