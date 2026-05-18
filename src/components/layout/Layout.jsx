import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BottomNav from './BottomNav';
import PushPermissionPrompt from '../ui/PushPermissionPrompt';
import { useViewMode } from '../../context/ViewModeContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const Layout = () => {
    const { isMobile } = useViewMode();
    const { user, userRole } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [onboardingLocked, setOnboardingLocked] = useState(false);
    const [onboardingChecked, setOnboardingChecked] = useState(false);

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
        checkOnboarding();
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
        </div>
    );
};

export default Layout;

