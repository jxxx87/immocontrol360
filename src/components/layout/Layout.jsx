import React, { useState, useEffect } from 'react';
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
import { Mail } from 'lucide-react';

const Layout = () => {
    const { isMobile } = useViewMode();
    const { user, userRole } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [onboardingLocked, setOnboardingLocked] = useState(false);
    const [onboardingChecked, setOnboardingChecked] = useState(false);
    
    // Invite popup state
    const [showInvitePopup, setShowInvitePopup] = useState(false);
    const [inviteCount, setInviteCount] = useState(0);

    useEffect(() => {
        const checkOnboarding = async () => {
            if (!user || userRole === 'tenant') {
                setOnboardingChecked(true);
                return;
            }
            try {
                const { data } = await supabase
                    .from('profiles')
                    .select('onboarding_complete')
                    .eq('id', user.id)
                    .maybeSingle();

                if (!data || !data.onboarding_complete) {
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
            if (!user) return;
            const alreadyShown = sessionStorage.getItem('invitePopupShown');
            if (alreadyShown) return;

            try {
                const { count } = await supabase
                    .from('portfolio_shares')
                    .select('*', { count: 'exact', head: true })
                    .eq('shared_with_email', user.email)
                    .eq('status', 'pending');
                    
                if (count > 0) {
                    setInviteCount(count);
                    setShowInvitePopup(true);
                    sessionStorage.setItem('invitePopupShown', 'true');
                }
            } catch (e) {
                console.error('Error checking invitations:', e);
            }
        };

        checkOnboarding();
        checkInvitations();
    }, [user, userRole]);

    // If locked and user tries to navigate away from settings, push them back
    useEffect(() => {
        if (onboardingLocked && location.pathname !== '/settings') {
            navigate('/settings', { replace: true });
        }
    }, [location.pathname, onboardingLocked]);

    const lockedStyle = onboardingLocked ? { pointerEvents: 'none', opacity: 0.5, userSelect: 'none' } : {};

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
                    <Outlet context={{ onboardingLocked, unlockOnboarding: () => setOnboardingLocked(false) }} />
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

