import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Wallet, Menu, Home, TicketCheck, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const BottomNav = ({ onMenuClick }) => {
    const { userRole } = useAuth();

    const tabs = userRole === 'tenant' ? [
        { path: '/tenant', icon: Home, label: 'Home' },
        { path: '/tenant/tickets', icon: TicketCheck, label: 'Tickets' },
        { path: '/tenant/messages', icon: MessageSquare, label: 'Chat' },
    ] : [
        { path: '/', icon: LayoutDashboard, label: 'Dash' },
        { path: '/properties', icon: Building2, label: 'Immo' },
        { path: '/finance', icon: Wallet, label: 'Finanz' },
    ];

    return (
        <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            height: '60px', backgroundColor: 'var(--surface-color)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
            zIndex: 100,
            boxShadow: '0 -2px 10px rgba(0,0,0,0.05)'
        }}>
            {tabs.map((tab) => (
                <NavLink
                    key={tab.path}
                    to={tab.path}
                    end
                    style={({ isActive }) => ({
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        color: isActive ? 'var(--primary-color)' : 'var(--text-secondary)',
                        textDecoration: 'none', fontSize: '0.7rem',
                        padding: '8px',
                        flex: 1
                    })}
                >
                    <tab.icon size={20} style={{ marginBottom: '4px' }} />
                    {tab.label}
                </NavLink>
            ))}
            <div
                onClick={onMenuClick}
                style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.7rem',
                    padding: '8px',
                    flex: 1
                }}
            >
                <Menu size={20} style={{ marginBottom: '4px' }} />
                Menü
            </div>
        </div>
    );
};

export default BottomNav;
