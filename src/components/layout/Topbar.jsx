import React from 'react';
import { Search, Bell, User, LogOut, Plus, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const Topbar = () => {
    const { user, signOut, isInvestor, isTenant, roleData } = useAuth();
    const { portfolios, selectedPortfolioID, setSelectedPortfolioID } = usePortfolio();
    const navigate = useNavigate();
    const [openingHours, setOpeningHours] = React.useState({ visible: true, text: 'Mo-Fr 9:00 - 17:00 Uhr' });

    React.useEffect(() => {
        if (isTenant && roleData?.property_id) {
            const fetchOwnerSettings = async () => {
                try {
                    // Trace back to owner: property -> portfolio -> user_id
                    const { data: propData } = await supabase
                        .from('properties')
                        .select('portfolio:portfolios(user_id)')
                        .eq('id', roleData.property_id)
                        .single();

                    if (propData?.portfolio?.user_id) {
                        const { data: profile, error: profError } = await supabase
                            .from('profiles')
                            .select('settings_opening_hours_visible, settings_opening_hours_text')
                            .eq('id', propData.portfolio.user_id)
                            .single();

                        if (profError) {
                            console.warn('Could not fetch owner profile settings:', profError.message);
                            return;
                        }

                        if (profile) {
                            setOpeningHours({
                                visible: profile.settings_opening_hours_visible !== false,
                                text: profile.settings_opening_hours_text || 'Mo-Fr 9:00 - 17:00 Uhr'
                            });
                        }
                    }
                } catch (err) {
                    console.error('Error fetching owner settings:', err);
                }
            };
            fetchOwnerSettings();
        }
    }, [isTenant, roleData]);

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
            {/* Left: Portfolio Filter (Investor only) OR Tenant Label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isInvestor ? (
                    <>
                        <select
                            value={selectedPortfolioID}
                            onChange={(e) => setSelectedPortfolioID(e.target.value)}
                            style={{
                                padding: 'var(--spacing-sm) var(--spacing-md)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--surface-color)',
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
                                backgroundColor: 'var(--surface-color)',
                                cursor: 'pointer',
                                color: 'var(--primary-color)'
                            }}
                        >
                            <Plus size={18} />
                        </button>
                    </>
                ) : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: 'linear-gradient(135deg, #E0F2FE 0%, #F0F9FF 100%)',
                        border: '1px solid #BAE6FD'
                    }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--primary-color)' }}>
                            Mieterportal
                        </span>
                    </div>
                )}
            </div>

            {/* Center: Search (Investor only) */}
            {isInvestor && (
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
            )}

            {/* Right: Actions & User */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                {isTenant && openingHours.visible && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 14px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                        border: '1px solid rgba(59, 130, 246, 0.1)',
                        marginRight: '8px'
                    }}>
                        <Clock size={16} color="var(--primary-color)" />
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Öffnungszeiten</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{openingHours.text}</span>
                        </div>
                    </div>
                )}
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
                }}
                    onClick={handleLogout}
                    title="Klicken zum Abmelden"
                >
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: isTenant ? '#DCFCE7' : '#E0F2FE',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isTenant ? '#16A34A' : 'var(--primary-color)',
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
