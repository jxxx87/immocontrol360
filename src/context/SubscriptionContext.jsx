import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';


const SubscriptionContext = createContext();

export const useSubscription = () => {
    return useContext(SubscriptionContext);
};

export const SubscriptionProvider = ({ children }) => {
    const { session, userRole } = useAuth();
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showPaywall, setShowPaywall] = useState(false);
    const [paywallReason, setPaywallReason] = useState(null); // 'manual_upgrade', 'trial_expired', 'limit_reached', 'feature_locked'

    const [initialAuthChecked, setInitialAuthChecked] = useState(false);

    useEffect(() => {
        if (session?.user) {
            fetchSubscription();
            setInitialAuthChecked(true);
        } else if (session === null && initialAuthChecked) {
            // Session explicitly null after auth check completed
            setSubscription(null);
            setLoading(false);
        } else if (session === null) {
            // First render – wait briefly for auth to resolve
            const timer = setTimeout(() => {
                setInitialAuthChecked(true);
                if (!session?.user) {
                    setSubscription(null);
                    setLoading(false);
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [session]);

    // Auto-check access when subscription loads/changes
    useEffect(() => {
        if (!loading && session?.user) {
            checkGlobalAccess(true);
        }
    }, [subscription, loading, session]);

    const fetchSubscription = async () => {
        try {
            const { data, error } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (error) console.error('Error fetching subscription:', error);
            setSubscription(data);
        } catch (err) {
            console.error('Subscription fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    // ── LOGIC ──

    const isTrialActive = () => {
        if (!subscription) return false;
        return subscription.status === 'trialing' && new Date(subscription.trial_ends_at) > new Date();
    };

    const isSubscriptionActive = () => {
        if (!subscription) return false;
        return subscription.status === 'active';
    };

    const hasAccess = () => {
        if (!subscription) return false; // No sub -> no access
        return isTrialActive() || isSubscriptionActive();
    };

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

        // If no subscription or expired trial -> SHOW PAYWALL
        if (!subscription) {
            setPaywallReason('no_subscription');
            // Don't auto-show paywall for 'no_subscription' (avoids flickering on load)
            // User will see locks and trigger it manually if they try to access features.
            if (!isAutoCheck) setShowPaywall(true);
            return false;
        }

        if (subscription.status === 'trialing' && new Date(subscription.trial_ends_at) < new Date()) {
            setPaywallReason('trial_expired');
            // Expired trial is a definite state we want to show immediately
            if (!isAutoCheck) setShowPaywall(true);
            return false;
        }

        if (subscription.status === 'canceled' || subscription.status === 'past_due') {
            setPaywallReason('subscription_inactive');
            setShowPaywall(true);
            return false;
        }

        if (paywallReason === 'no_subscription' || paywallReason === 'subscription_inactive') {
            setPaywallReason(null);
            setShowPaywall(false);
        }

        return true; // Access granted
    };

    // 2. Feature Check (e.g. 'investor_portal')
    // 2. Feature Check (e.g. 'investor_portal')
    const hasFeature = (featureKey) => {
        // Tenants always have full access — their portal is free
        if (userRole === 'tenant') return true;

        if (loading) return false;

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
    const checkUsageLimit = (currentCount, limitType = 'units') => {
        if (!checkGlobalAccess()) return false;

        // During trial, user has Business limits (250) or Unlimited?
        // Let's assume Business limits for Trial
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
            refreshSubscription: fetchSubscription,
        }}>
            {children}
        </SubscriptionContext.Provider>
    );
};
