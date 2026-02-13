import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    Building2,
    Users,
    Wallet,
    FileText,
    Gauge,
    Contact,
    Files,
    Settings,
    Calculator,
    Megaphone,
    KanbanSquare,
    MessageSquare,
    ClipboardList,
    Pin,
    Home,
    TicketCheck,
    Send,
    Sun,
    Moon,
    TrendingUp,
    Smartphone,
    Monitor
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';

const Sidebar = ({ mobileOpen, onClose }) => {
    const { userRole } = useAuth();
    const { isMobile, toggleViewMode } = useViewMode();
    const [openSubMenus, setOpenSubMenus] = React.useState({});
    const location = useLocation();
    const navigate = useNavigate();

    // Nav visibility from localStorage
    const [navVisibility, setNavVisibility] = useState(() => {
        try {
            const saved = localStorage.getItem('navVisibility');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    // Dark mode state
    const [darkMode, setDarkMode] = useState(() => {
        const saved = localStorage.getItem('darkMode');
        if (saved === 'true') {
            document.documentElement.setAttribute('data-theme', 'dark');
            return true;
        }
        return false;
    });

    const toggleDarkMode = () => {
        const next = !darkMode;
        setDarkMode(next);
        localStorage.setItem('darkMode', String(next));
        if (next) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    };

    useEffect(() => {
        const handleChange = () => {
            try {
                const saved = localStorage.getItem('navVisibility');
                setNavVisibility(saved ? JSON.parse(saved) : {});
            } catch { /* ignore */ }
        };
        window.addEventListener('navVisibilityChanged', handleChange);
        return () => window.removeEventListener('navVisibilityChanged', handleChange);
    }, []);

    const isVisible = (key) => navVisibility[key] !== false;

    // ── INVESTOR NAV ITEMS ──────────────────────────────────────────
    const allInvestorNavItems = [
        { path: '/', label: 'Dashboard', icon: LayoutDashboard, navKey: 'dashboard' },
        { path: '/properties', label: 'Immobilien', icon: Building2, navKey: 'properties' },
        { path: '/tenants', label: 'Mietverhältnisse', icon: Users, navKey: 'tenants' },
        {
            label: 'Finanzen',
            icon: Wallet,
            navKey: 'finance',
            subItems: [
                { path: '/finance', label: 'Buchhaltung' },
                { path: '/invoices', label: 'Rechnungen Fewo' }
            ]
        },
        { path: '/utility-costs', label: 'Nebenkosten', icon: Calculator, navKey: 'utility-costs' },
        { path: '/meters', label: 'Zähler', icon: Gauge, navKey: 'meters' },
        { path: '/contacts', label: 'Kontakte', icon: Contact, navKey: 'contacts' },
        { type: 'divider' },
        {
            label: 'Mieterportal',
            icon: Home,
            navKey: 'mieterportal',
            subItems: [
                { path: '/tenant-management', label: 'Mieter-Verwaltung' },
                { path: '/ticket-board', label: 'Ticket-Board' },
                { path: '/announcements', label: 'Aushänge' },
                { path: '/investor-messages', label: 'Nachrichten' },
                { path: '/documents', label: 'Dokumente' }
            ]
        },
        {
            label: 'Investorportal',
            icon: TrendingUp,
            navKey: 'investorportal',
            subItems: [
                { path: '/investor-portal', label: 'Cockpit' },
                { path: '/investor-portal?tab=deals', label: 'Neue Deals' },
                { path: '/investor-portal?tab=calculator', label: 'Rechner' },
                { path: '/loans', label: 'Darlehens-Check' }
            ]
        },
        { path: '/settings', label: 'Einstellungen', icon: Settings }
    ];

    const investorNavItems = allInvestorNavItems.filter(item => {
        if (item.type === 'divider') return true;
        if (!item.navKey) return true; // always show items without navKey (e.g. Einstellungen)
        return isVisible(item.navKey);
    });

    // ── TENANT NAV ITEMS ────────────────────────────────────────────
    const tenantNavItems = [
        { path: '/tenant', label: 'Dashboard', icon: Home },
        { path: '/tenant/tickets', label: 'Tickets', icon: TicketCheck },
        { path: '/tenant/messages', label: 'Nachrichten', icon: MessageSquare },
        { path: '/tenant/announcements', label: 'Aushang', icon: Pin },
        { path: '/tenant/documents', label: 'Dokumente', icon: Files },
    ];

    const navItems = userRole === 'tenant' ? tenantNavItems : investorNavItems;

    const toggleSubMenu = (label) => {
        setOpenSubMenus(prev => ({ ...prev, [label]: !prev[label] }));
    };

    React.useEffect(() => {
        // Auto-open sub-menus based on current path
        const financeActive = ['/finance', '/invoices'].some(p => location.pathname.startsWith(p));
        const portalActive = ['/tenant-management', '/ticket-board', '/announcements', '/investor-messages', '/documents'].some(p => location.pathname.startsWith(p));
        const investorPortalActive = ['/investor-portal', '/loans'].some(p => location.pathname.startsWith(p));

        setOpenSubMenus(prev => ({
            ...prev,
            'Finanzen': financeActive,
            'Mieterportal': portalActive,
            'Investorportal': investorPortalActive
        }));
    }, [location.pathname]);

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
            zIndex: isMobile ? 200 : 10,
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: isMobile ? (mobileOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
            boxShadow: isMobile && mobileOpen ? '0 0 15px rgba(0,0,0,0.1)' : 'none'
        }}>
            {isMobile && (
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px'
                    }}
                >
                    <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>×</span>
                </button>
            )}
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

            {/* Dark Mode Toggle */}
            <div style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sun size={14} color={!darkMode ? '#F59E0B' : 'var(--text-secondary)'} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Modus</span>
                    <Moon size={14} color={darkMode ? '#4A9EFF' : 'var(--text-secondary)'} />
                </div>
                <button
                    onClick={toggleDarkMode}
                    style={{
                        width: '36px', height: '20px', borderRadius: '10px',
                        backgroundColor: darkMode ? '#4A9EFF' : '#D1D5DB',
                        border: 'none', cursor: 'pointer',
                        position: 'relative', transition: 'background-color 0.3s',
                        flexShrink: 0
                    }}
                >
                    <div style={{
                        width: '16px', height: '16px', borderRadius: '50%',
                        backgroundColor: 'var(--surface-color)',
                        position: 'absolute', top: '2px',
                        left: darkMode ? '18px' : '2px',
                        transition: 'left 0.3s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                    }} />
                </button>
            </div>

            {/* View Mode Toggle */}
            <div style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Monitor size={14} color={!isMobile ? '#4A9EFF' : 'var(--text-secondary)'} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>View</span>
                    <Smartphone size={14} color={isMobile ? '#10B981' : 'var(--text-secondary)'} />
                </div>
                <button
                    onClick={toggleViewMode}
                    style={{
                        width: '36px', height: '20px', borderRadius: '10px',
                        backgroundColor: isMobile ? '#10B981' : '#D1D5DB',
                        border: 'none', cursor: 'pointer',
                        position: 'relative', transition: 'background-color 0.3s',
                        flexShrink: 0
                    }}
                >
                    <div style={{
                        width: '16px', height: '16px', borderRadius: '50%',
                        backgroundColor: 'var(--surface-color)',
                        position: 'absolute', top: '2px',
                        left: isMobile ? '18px' : '2px',
                        transition: 'left 0.3s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                    }} />
                </button>
            </div>

            {userRole === 'tenant' && (
                <div style={{
                    padding: '12px var(--spacing-md)',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'linear-gradient(135deg, #E0F2FE 0%, #F0F9FF 100%)'
                }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--primary-color)', fontWeight: 600 }}>
                        Mieterportal
                    </div>
                </div>
            )}

            <nav style={{ flex: 1, padding: 'var(--spacing-md)', overflowY: 'auto' }}>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                    {navItems.map((item, index) => {
                        if (item.type === 'divider') {
                            return (
                                <li key={`divider - ${index} `} style={{
                                    height: '1px',
                                    backgroundColor: 'var(--border-color)',
                                    margin: '12px 0'
                                }} />
                            );
                        }

                        return (
                            <li key={index} style={{ marginBottom: 'var(--spacing-xs)' }}>
                                {item.subItems ? (
                                    <div>
                                        <div
                                            onClick={() => toggleSubMenu(item.label)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                                borderRadius: 'var(--radius-md)',
                                                color: 'var(--text-secondary)',
                                                cursor: 'pointer',
                                                justifyContent: 'space-between'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <item.icon size={20} style={{ marginRight: 'var(--spacing-sm)' }} />
                                                {item.label}
                                            </div>
                                            <span style={{ fontSize: '0.8rem' }}>{openSubMenus[item.label] ? '▼' : '▶'}</span>
                                        </div>
                                        {openSubMenus[item.label] && (
                                            <ul style={{ listStyle: 'none', paddingLeft: '2.5rem', marginTop: '4px' }}>
                                                {item.subItems.map((subItem) => {
                                                    // Custom active check: match pathname + search to handle query params
                                                    const [subPath, subSearch] = subItem.path.split('?');
                                                    const currentSearch = location.search ? location.search.substring(1) : '';
                                                    const subActive = location.pathname === subPath && (subSearch || '') === currentSearch;
                                                    return (
                                                        <li key={subItem.path} style={{ marginBottom: '4px' }}>
                                                            <div
                                                                onClick={() => navigate(subItem.path)}
                                                                style={{
                                                                    display: 'block',
                                                                    padding: '6px 8px',
                                                                    borderRadius: '4px',
                                                                    color: subActive ? 'var(--primary-color)' : 'var(--text-secondary)',
                                                                    backgroundColor: subActive ? '#E0F2FE' : 'transparent',
                                                                    fontSize: '0.9rem',
                                                                    textDecoration: 'none',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                {subItem.label}
                                                            </div>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                ) : (
                                    <NavLink
                                        to={item.path}
                                        end={item.path === '/' || item.path === '/tenant'}
                                        style={({ isActive }) => ({
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: 'var(--spacing-sm) var(--spacing-md)',
                                            borderRadius: 'var(--radius-md)',
                                            color: isActive ? 'var(--primary-color)' : 'var(--text-secondary)',
                                            backgroundColor: isActive ? '#E0F2FE' : 'transparent',
                                            fontWeight: isActive ? 500 : 400,
                                            transition: 'all 0.2s',
                                            textDecoration: 'none'
                                        })}
                                    >
                                        <item.icon size={20} style={{ marginRight: 'var(--spacing-sm)' }} />
                                        {item.label}
                                    </NavLink>
                                )}
                            </li>
                        );
                    })}
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
