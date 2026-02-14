import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BottomNav from './BottomNav';
import { useViewMode } from '../../context/ViewModeContext';

const Layout = () => {
    const { isMobile } = useViewMode();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

    return (
        <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--background-color)', position: 'relative' }}>

            {/* Mobile Backdrop */}
            {isMobile && mobileSidebarOpen && (
                <div
                    style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 150 }}
                    onClick={() => setMobileSidebarOpen(false)}
                />
            )}

            <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}>
                <Topbar />
                <main style={{
                    marginTop: 'var(--topbar-height)',
                    marginLeft: isMobile ? 0 : 'var(--sidebar-width)',
                    padding: isMobile ? 'var(--spacing-md)' : 'var(--spacing-xl)',
                    marginBottom: isMobile ? '60px' : 0, // Space for BottomNav
                    flex: 1,
                    overflowX: 'hidden'
                }}>
                    <Outlet />
                </main>
            </div>

            {isMobile && <BottomNav onMenuClick={() => setMobileSidebarOpen(true)} />}
        </div>
    );
};

export default Layout;
