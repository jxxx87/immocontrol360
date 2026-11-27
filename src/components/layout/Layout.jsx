import React, { useState, useEffect, Suspense } from 'react';
import PageLoader from '../ui/PageLoader';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BottomNav from './BottomNav';
import PushPermissionPrompt from '../ui/PushPermissionPrompt';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useViewMode } from '../../context/ViewModeContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Mail, ShieldAlert, X } from 'lucide-react';

const Layout = () => {
    const { isMobile } = useViewMode();
    const { user, userRole } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [onboardingLocked, setOnboardingLocked] = useState(false);
    const [onboardingChecked, setOnboardingChecked] = useState(false);
    const [dismissedNoticeKey, setDismissedNoticeKey] = useState(null);

    // Invite popup state
    const [showInvitePopup, setShowInvitePopup] = useState(false);
    const [inviteCount, setInviteCount] = useState(0);

    useEffect(() => {
        const checkOnboarding = async () => {
            if (!user) {
                setOnboardingChecked(true);
                return;
            }
            if (userRole === null) {
                return; // Wait for role to finish loading
            }
            if (userRole !== 'investor') {
                setOnboardingChecked(true);
                return;
            }
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('onboarding_complete')
                    .eq('id', user.id)
                    .maybeSingle();

                // Nur bei erfolgreicher Antwort sperren – ein Netz-/Rechtefehler darf
                // ein abgeschlossenes Onboarding nicht erneut erzwingen.
                if (error) {
                    console.error('Onboarding check error:', error);
                } else if (!data || !data.onboarding_complete) {
                    setOnboardingLocked(true);
                    navigate('/settings', { replace: true });
                }
            } catch (e) {
                console.error('Onboarding check error:', e);
            } finally {
                setOnboardingChecked(true);
            }
        };

        const checkInvitations = async () => {
            if (!user || userRole !== 'investor') return;
            // Pro Nutzer merken, damit ein anderer Login im selben Tab seine Einladungen sieht
            const shownKey = `invitePopupShown:${user.id}`;
            let alreadyShown = false;
            try { alreadyShown = !!sessionStorage.getItem(shownKey); } catch { /* ignore */ }
            if (alreadyShown) return;

            try {
                let count = 0;
                const { data, error } = await supabase.rpc('get_pending_invitations');
                if (error) {
                    // Fallback: direkte Zählung (RLS liefert nur an mich gerichtete Freigaben)
                    const { count: fallbackCount, error: countError } = await supabase
                        .from('portfolio_shares')
                        .select('id', { count: 'exact', head: true })
                        .ilike('shared_with_email', user.email || '')
                        .eq('status', 'pending');
                    if (countError) throw countError;
                    count = fallbackCount || 0;
                } else {
                    count = (data || []).length;
                }

                if (count > 0) {
                    setInviteCount(count);
                    setShowInvitePopup(true);
                    try { sessionStorage.setItem(shownKey, 'true'); } catch { /* ignore */ }
                }
            } catch (e) {
                console.error('Error checking invitations:', e);
            }
        };

        checkOnboarding();
        checkInvitations();
        // navigate ist stabil genug; die Prüfung soll nur bei Nutzer-/Rollenwechsel laufen
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, userRole]);

    // If locked and user tries to navigate away from settings, push them back
    useEffect(() => {
        if (onboardingLocked && location.pathname !== '/settings') {
            navigate('/settings', { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, onboardingLocked]);

    const lockedStyle = onboardingLocked ? { pointerEvents: 'none', opacity: 0.5, userSelect: 'none' } : {};

    // Für Investoren erst rendern, wenn die Onboarding-Prüfung durch ist (kein Flackern)
    const showOutlet = onboardingChecked || userRole !== 'investor';

    // Hinweis nach Umleitung durch einen Routen-Guard (fehlende Berechtigung)
    const accessNotice = location.state?.accessNotice;
    const showAccessNotice = !!accessNotice && dismissedNoticeKey !== location.key;

    return (
        <div style={{ display: 'flex', minHeight: '100vh', position: 'relative' }}>

            {/* Mobile Backdrop */}
            {isMobile && mobileSidebarOpen && (
                <div
                    style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 150 }}
                    onClick={() => setMobileSidebarOpen(false)}
                />
            )}

            <div style={lockedStyle}>
                <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}>
                <Topbar onboardingLocked={onboardingLocked} />
                <main style={{
                    marginTop: 'calc(var(--topbar-height) + env(safe-area-inset-top, 0px))',
                    marginLeft: isMobile ? 0 : 'var(--sidebar-width)',
                    padding: isMobile ? '12px 10px' : 'var(--spacing-xl)',
                    marginBottom: isMobile ? '80px' : 0,
                    flex: 1,
                    overflowX: 'hidden',
                    maxWidth: '100vw',
                    boxSizing: 'border-box'
                }}>
                    {showAccessNotice && (
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: '10px',
                            padding: '12px 14px', marginBottom: 'var(--spacing-md)',
                            backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 'var(--radius-md)',
                            color: '#92400E', fontSize: '0.9rem'
                        }}>
                            <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                            <div style={{ flex: 1 }}>{accessNotice}</div>
                            <button
                                type="button"
                                onClick={() => setDismissedNoticeKey(location.key)}
                                title="Hinweis schließen"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400E', padding: 0 }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    )}
                    {showOutlet ? (
                        <Suspense fallback={<PageLoader />}>
                            <Outlet context={{ onboardingLocked, unlockOnboarding: () => setOnboardingLocked(false) }} />
                        </Suspense>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
                            Lade...
                        </div>
                    )}
                </main>
            </div>

            {isMobile && (
                <div style={lockedStyle}>
                    <BottomNav onMenuClick={() => setMobileSidebarOpen(true)} />
                </div>
            )}

            {/* Push Notification Permission Dialog (shows once on first launch) */}
            {!onboardingLocked && <PushPermissionPrompt />}

            {/* Invite Notification Modal */}
            <Modal
                isOpen={showInvitePopup}
                onClose={() => setShowInvitePopup(false)}
                title="Neue Portfolio-Einladung"
                footer={<Button onClick={() => { setShowInvitePopup(false); navigate('/settings', { state: { activeTab: 'portfolios' } }); }}>Zu den Portfolios</Button>}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                    <div style={{ backgroundColor: '#DBEAFE', color: 'var(--primary-color)', padding: '12px', borderRadius: '50%' }}>
                        <Mail size={32} />
                    </div>
                    <div>
                        <p style={{ margin: 0, fontSize: '1rem' }}>Sie haben <strong>{inviteCount} neue Einladung(en)</strong> erhalten, einem Portfolio beizutreten.</p>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Wechseln Sie in die Einstellungen unter "Portfolios", um die Einladung(en) anzunehmen oder abzulehnen.</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Layout;

