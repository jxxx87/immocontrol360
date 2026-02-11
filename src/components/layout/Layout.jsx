import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const Layout = () => {
    return (
        <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--background-color)' }}>
            <Sidebar />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Topbar />
                <main style={{
                    marginTop: 'var(--topbar-height)',
                    marginLeft: 'var(--sidebar-width)',
                    padding: 'var(--spacing-xl)',
                    flex: 1
                }}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
