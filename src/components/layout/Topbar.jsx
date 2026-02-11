import React from 'react';
import { Search, Bell, User, ChevronDown, LogOut, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useNavigate } from 'react-router-dom';

const Topbar = () => {
    const { user, signOut } = useAuth();
    const { portfolios, selectedPortfolioID, setSelectedPortfolioID } = usePortfolio();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    return (
        <header style={{
            height: 'var(--topbar-height)',
            backgroundColor: 'var(--surface-color)',
            borderBottom: '1px solid var(--border-color)',
            position: 'fixed',
            top: 0,
            left: 'var(--sidebar-width)',
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 var(--spacing-xl)',
            zIndex: 9
        }}>
            {/* Left: Portfolio Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                    value={selectedPortfolioID}
                    onChange={(e) => setSelectedPortfolioID(e.target.value)}
                    style={{
                        padding: 'var(--spacing-sm) var(--spacing-md)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'white',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        outline: 'none',
                        minWidth: '200px'
                    }}
                >
                    <option value="">Alle Portfolios</option>
                    {portfolios.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
                <button
                    onClick={() => navigate('/settings', { state: { activeTab: 'portfolios' } })}
                    title="Portfolio verwalten"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '32px',
                        height: '32px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                        color: 'var(--primary-color)'
                    }}
                >
                    <Plus size={18} />
                </button>
            </div>

            {/* Center: Search */}
            <div style={{ position: 'relative', width: '300px' }}>
                <Search size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input
                    type="text"
                    placeholder="Suchen..."
                    style={{
                        width: '100%',
                        padding: 'var(--spacing-sm) var(--spacing-md) var(--spacing-sm) 36px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        outline: 'none',
                        fontSize: 'var(--font-size-sm)'
                    }}
                />
            </div>

            {/* Right: Actions & User */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                <button style={{ position: 'relative', color: 'var(--text-secondary)' }}>
                    <Bell size={20} />
                    <span style={{
                        position: 'absolute',
                        top: '-2px',
                        right: '-2px',
                        width: '8px',
                        height: '8px',
                        backgroundColor: 'var(--danger-color)',
                        borderRadius: '50%'
                    }}></span>
                </button>

                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    padding: 'var(--spacing-xs) var(--spacing-sm)',
                    borderRadius: 'var(--radius-md)',
                    transition: 'background 0.2s',
                    position: 'relative',
                    group: 'hover'
                }}
                    onClick={handleLogout}
                    title="Klicken zum Abmelden"
                >
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: '#E0F2FE',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--primary-color)',
                        marginRight: 'var(--spacing-sm)'
                    }}>
                        <User size={18} />
                    </div>
                    <div style={{ marginRight: 'var(--spacing-sm)' }}>
                        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{user?.email || 'User'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Logout</div>
                    </div>
                    <LogOut size={16} color="var(--text-secondary)" />
                </div>
            </div>
        </header>
    );
};

export default Topbar;
