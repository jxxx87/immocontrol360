import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    Building2,
    DoorOpen,
    Users,
    Wallet,
    FileText,
    Gauge,
    Contact,
    Files,
    Settings,
    Calculator
} from 'lucide-react';

const Sidebar = () => {
    const navItems = [
        { path: '/', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/properties', label: 'Immobilien', icon: Building2 },

        { path: '/tenants', label: 'Mietverhältnisse', icon: Users },
        { path: '/finance', label: 'Finanzen', icon: Wallet },
        { path: '/utility-costs', label: 'Nebenkosten', icon: Calculator },
        { path: '/invoices', label: 'Rechnungen', icon: FileText },
        { path: '/meters', label: 'Zähler', icon: Gauge },
        { path: '/contacts', label: 'Kontakte', icon: Contact },
        { path: '/documents', label: 'Dokumente', icon: Files },
        { path: '/settings', label: 'Einstellungen', icon: Settings },
    ];

    return (
        <aside style={{
            width: 'var(--sidebar-width)',
            height: '100vh',
            backgroundColor: 'var(--surface-color)',
            borderRight: '1px solid var(--border-color)',
            position: 'fixed',
            left: 0,
            top: 0,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10
        }}>
            <div style={{
                height: 'auto',
                minHeight: 'var(--topbar-height)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px var(--spacing-md)',
                borderBottom: '1px solid var(--border-color)'
            }}>
                <img src="/logo.png?v=5" alt="ImmoControl Pro 360" style={{ width: '85%', height: 'auto', maxHeight: '120px' }} />
            </div>

            <nav style={{ flex: 1, padding: 'var(--spacing-md)', overflowY: 'auto' }}>
                <ul style={{ listStyle: 'none' }}>
                    {navItems.map((item) => (
                        <li key={item.path} style={{ marginBottom: 'var(--spacing-xs)' }}>
                            <NavLink
                                to={item.path}
                                style={({ isActive }) => ({
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: 'var(--spacing-sm) var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    color: isActive ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    backgroundColor: isActive ? '#E0F2FE' : 'transparent',
                                    fontWeight: isActive ? 500 : 400,
                                    transition: 'all 0.2s'
                                })}
                            >
                                <item.icon size={20} style={{ marginRight: 'var(--spacing-sm)' }} />
                                {item.label}
                            </NavLink>
                        </li>
                    ))}
                </ul>
            </nav>

            <div style={{ padding: 'var(--spacing-md)', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    © 2026 ImmoControl
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
