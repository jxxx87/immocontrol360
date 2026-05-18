import React from 'react';
import { User, LogOut, Plus, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useNavigate } from 'react-router-dom';
import NotificationBell from '../ui/NotificationBell';
import { supabase } from '../../lib/supabase';
import { useViewMode } from '../../context/ViewModeContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { Crown } from 'lucide-react';

const Topbar = ({ onboardingLocked }) => {
    const { user, signOut, isInvestor, isTenant, roleData } = useAuth();
    const { portfolios, selectedPortfolioID, setSelectedPortfolioID } = usePortfolio();
    const { subscription, subscriptionLoading = true, isTrialActive, isSubscriptionActive, setShowPaywall, setPaywallReason } = useSubscription() || {};

    const navigate = useNavigate();
    const { isMobile } = useViewMode();
    const [openingHours, setOpeningHours] = React.useState({ visible: true, text: 'Mo-Fr 9:00 - 17:00 Uhr' });

    // Calculate remaining days
    const trialDaysLeft = subscription?.trial_ends_at
        ? Math.ceil((new Date(subscription.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
        : 0; // Default fallback



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
            backgroundColor: 'transparent', // Removed white background
            borderBottom: 'none', // Removed border
            position: 'fixed',
            top: 'env(safe-area-inset-top, 0px)',
            left: isMobile ? 0 : 'var(--sidebar-width)',
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 var(--spacing-xl)',
            zIndex: 9,
            background: 'var(--topbar-bg)',
            backdropFilter: 'blur(4px)' // Slight blur for readability
        }}>
            {!isMobile && (
                <>
                    {/* Left: Portfolio Filter (Investor only) OR Tenant Label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...(onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}) }}>
                        {isInvestor ? (
                            <>
                                <select
                                    value={selectedPortfolioID}
                                    onChange={(e) => setSelectedPortfolioID(e.target.value)}
                                    style={{
                                        padding: 'var(--spacing-sm) var(--spacing-md)',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none', // Removed border
                                        backgroundColor: 'rgba(255,255,255,0.6)', // Glassy
                                        backdropFilter: 'blur(4px)',
                                        boxShadow: 'var(--shadow-sm)',
                                        color: 'var(--text-primary)',
                                        cursor: 'pointer',
                                        outline: 'none',
                                        minWidth: '200px',
                                        fontSize: '0.9rem',
                                        fontFamily: 'inherit'
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
                                    className="glass-icon-btn"
                                    style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)' }}
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
                                background: 'rgba(255,255,255,0.6)',
                                backdropFilter: 'blur(4px)',
                                boxShadow: 'var(--shadow-sm)'
                            }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-color)' }}>
                                    Mieterportal
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Center: Search Removed per request */}
                    <div></div>

                    {/* Right: Actions & User */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                        {isTenant && openingHours.visible && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 14px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'rgba(255,255,255,0.5)',
                                backdropFilter: 'blur(4px)',
                                marginRight: '8px'
                            }}>
                                <Clock size={16} color="var(--primary-color)" />
                                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Öffnungszeiten</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{openingHours.text}</span>
                                </div>
                            </div>
                        )}

                        <div style={onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                            {/* Upgrade / Trial Indicator – visible whenever user has no active paid subscription */}
                            {subscription !== null && !isSubscriptionActive() && (
                                <button
                                    onClick={() => {
                                        setPaywallReason('manual_upgrade');
                                        setShowPaywall(true);
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '6px 12px',
                                        borderRadius: '20px',
                                        background: isTrialActive()
                                            ? 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)'
                                            : 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                                        border: isTrialActive() ? '1px solid #bfdbfe' : '1px solid #fbbf24',
                                        color: isTrialActive() ? '#0369a1' : '#92400e',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        marginRight: '8px'
                                    }}
                                >
                                    <Crown size={16} />
                                    {isTrialActive()
                                        ? `${trialDaysLeft} Tage · Upgrade`
                                        : 'Upgrade'
                                    }
                                </button>
                            )}
                        </div>

                        {/* Central Notification Bell (all notifications in one place) */}
                        <div style={onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                            <NotificationBell />
                        </div>

                        {/* User Profile */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '30px', // More rounded
                            backgroundColor: 'rgba(255,255,255,0.5)', // Glassy
                            backdropFilter: 'blur(4px)',
                            transition: 'background 0.2s',
                            boxShadow: 'var(--shadow-sm)'
                        }}
                            onClick={handleLogout}
                            title="Klicken zum Abmelden"
                        >
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: isTenant ? '#DCFCE7' : 'var(--primary-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: isTenant ? '#16A34A' : 'white',
                                marginRight: 'var(--spacing-sm)'
                            }}>
                                <User size={18} />
                            </div>
                            <div style={{ marginRight: 'var(--spacing-sm)' }}>
                                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{user?.email || 'User'}</div>
                            </div>
                            <LogOut size={16} color="var(--text-secondary)" />
                        </div>
                    </div>
                </>
            )}

            {isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', padding: '0 var(--spacing-sm)' }}>
                    <div style={{ width: '32px' }}></div> {/* Spacer to center logo */}
                    <img src="/logo.svg" alt="ImmoControl Pro 360" style={{ maxHeight: '40px' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {/* Mobile Upgrade Badge */}
                        <div style={onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                            {subscription !== null && !isSubscriptionActive() && (
                                <button
                                    onClick={() => {
                                        setPaywallReason('manual_upgrade');
                                        setShowPaywall(true);
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 10px',
                                        borderRadius: '16px',
                                        background: isTrialActive()
                                            ? 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)'
                                            : 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                                        border: isTrialActive() ? '1px solid #bfdbfe' : '1px solid #fbbf24',
                                        color: isTrialActive() ? '#0369a1' : '#92400e',
                                        cursor: 'pointer',
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                    }}
                                >
                                    <Crown size={14} />
                                    {isTrialActive() ? `${trialDaysLeft}` : '⬆'}
                                </button>
                            )}
                        </div>
                        <div style={onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                            <NotificationBell />
                        </div>
                        <button
                            onClick={handleLogout}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '8px',
                                color: 'var(--text-secondary)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            <LogOut size={20} />
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
};

export default Topbar;
