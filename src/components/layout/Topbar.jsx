import React from 'react';
import { User, LogOut, Plus, Clock, Crown, Mail, Cloud, Check, X, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import { useNavigate } from 'react-router-dom';
import NotificationBell from '../ui/NotificationBell';
import { supabase } from '../../lib/supabase';
import { useViewMode } from '../../context/ViewModeContext';
import { useSubscription } from '../../context/SubscriptionContext';

const DEFAULT_OPENING_HOURS = 'Mo-Fr 9:00 - 17:00 Uhr';

const Topbar = ({ onboardingLocked }) => {
    const { user, signOut, isTenant, roleData } = useAuth();
    const { portfolios, selectedPortfolioID, setSelectedPortfolioID } = usePortfolio();
    const { subscription, isTrialActive, isSubscriptionActive, setShowPaywall, setPaywallReason } = useSubscription() || {};

    const navigate = useNavigate();
    const { isMobile } = useViewMode();
    // Erst nach dem Laden der Vermieter-Einstellung anzeigen (kein kurzes Aufblitzen ausgeblendeter Zeiten)
    const [openingHours, setOpeningHours] = React.useState({ visible: false, text: DEFAULT_OPENING_HOURS });

    // Calculate remaining days
    const trialDaysLeft = subscription?.trial_ends_at
        ? Math.ceil((new Date(subscription.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24))
        : 0; // Default fallback

    const [emailStatus, setEmailStatus] = React.useState({ connected: false });
    const [cloudStatus, setCloudStatus] = React.useState({ connected: false, connections: [] });
    const [activePopup, setActivePopup] = React.useState(null); // 'email' | 'cloud' | 'profile' | null

    const emailRef = React.useRef(null);
    const cloudRef = React.useRef(null);
    const profileRef = React.useRef(null);

    const fetchConnectionStatuses = React.useCallback(async () => {
        if (!user) return;
        try {
            // Nur Anzeige-Spalten laden – Passwort und Tokens gehören nicht in den Browser
            const { data: smtpData, error: smtpError } = await supabase
                .from('user_smtp_settings')
                .select('smtp_host, smtp_user, smtp_sender')
                .eq('user_id', user.id)
                .maybeSingle();
            if (smtpError) console.error('Error fetching SMTP status in Topbar:', smtpError);

            setEmailStatus({
                connected: !!smtpData?.smtp_host && !!smtpData?.smtp_user,
                email: smtpData?.smtp_sender || smtpData?.smtp_user || ''
            });

            // Fetch Cloud connections (ohne access_token/refresh_token)
            const { data: cloudData, error: cloudError } = await supabase
                .from('cloud_connections')
                .select('id, provider, account_email')
                .eq('user_id', user.id);
            if (cloudError) console.error('Error fetching cloud status in Topbar:', cloudError);

            setCloudStatus({
                connected: (cloudData || []).length > 0,
                connections: cloudData || []
            });
        } catch (err) {
            console.error('Error fetching connection statuses in Topbar:', err);
        }
    }, [user]);

    React.useEffect(() => {
        if (user) {
            fetchConnectionStatuses();
            
            const handleUpdate = () => fetchConnectionStatuses();
            window.addEventListener('smtp-changed', handleUpdate);
            window.addEventListener('cloud-changed', handleUpdate);
            return () => {
                window.removeEventListener('smtp-changed', handleUpdate);
                window.removeEventListener('cloud-changed', handleUpdate);
            };
        }
    }, [user, fetchConnectionStatuses]);

    React.useEffect(() => {
        const handleClickOutside = (e) => {
            const inside = [emailRef, cloudRef, profileRef].some(ref => ref.current && ref.current.contains(e.target));
            if (!inside) {
                setActivePopup(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);



    React.useEffect(() => {
        if (!isTenant) return;
        let cancelled = false;

        // Öffnungszeiten des Vermieters: nur diese zwei Werte über die Datenbank-Funktion –
        // nicht mehr die ganze Profil-/Portfolio-Zeile (Bankverbindung, Steuernummer …);
        // Mieter lesen properties/units nicht direkt
        const fetchOwnerSettings = async () => {
            let settings = null;
            try {
                const { data: info, error: infoError } = await supabase.rpc('get_my_landlord_info');

                if (infoError) {
                    console.warn('Could not fetch owner opening hours:', infoError.message);
                } else if (info) {
                    settings = { visible: info.opening_hours_visible, text: info.opening_hours_text };
                }
            } catch (err) {
                console.error('Error fetching owner settings:', err);
            }

            // Ohne Vermieter-Einstellung wie bisher die Standardzeiten
            if (!cancelled) {
                setOpeningHours({
                    visible: settings?.visible !== false,
                    text: settings?.text || DEFAULT_OPENING_HOURS
                });
            }
        };

        fetchOwnerSettings();
        return () => { cancelled = true; };
        // roleData: neu laden, wenn sich die Mieterrolle ändert (die Funktion liest sie serverseitig)
    }, [isTenant, roleData]);

    const handleLogout = async () => {
        setActivePopup(null);
        await signOut();
        navigate('/login');
    };

    // Portfolio-Auswahl (Desktop und mobil)
    const renderPortfolioSelect = (compact = false) => (
        <select
            value={selectedPortfolioID}
            onChange={(e) => setSelectedPortfolioID(e.target.value)}
            aria-label="Portfolio auswählen"
            style={{
                padding: compact ? '4px 6px' : 'var(--spacing-sm) var(--spacing-md)',
                borderRadius: 'var(--radius-md)',
                border: 'none', // Removed border
                backgroundColor: 'rgba(255,255,255,0.6)', // Glassy
                backdropFilter: 'blur(4px)',
                boxShadow: 'var(--shadow-sm)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                outline: 'none',
                minWidth: compact ? 0 : '200px',
                maxWidth: compact ? '120px' : undefined,
                fontSize: compact ? '0.75rem' : '0.9rem',
                fontFamily: 'inherit'
            }}
        >
            <option value="">Alle Portfolios</option>
            {portfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
    );



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
                        {/* Gleiche Rollenquelle wie Sidebar/BottomNav: alles außer 'tenant' ist Investor-Oberfläche */}
                        {!isTenant ? (
                            <>
                                {renderPortfolioSelect()}
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

                        {/* E-Mail connection status */}
                        {!isTenant && (
                            <div ref={emailRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', ...(onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}) }}>
                                <button
                                    onClick={() => setActivePopup(activePopup === 'email' ? null : 'email')}
                                    className="glass-icon-btn"
                                    style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: 'var(--radius-md)',
                                        position: 'relative',
                                        backgroundColor: activePopup === 'email' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)',
                                        border: 'none',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                    title="E-Mail Server Status"
                                >
                                    <Mail size={18} color={emailStatus.connected ? "var(--primary-color)" : "var(--text-secondary)"} />
                                    <span style={{
                                        position: 'absolute',
                                        top: '6px',
                                        right: '6px',
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: emailStatus.connected ? '#10B981' : '#EF4444',
                                        border: '1.5px solid var(--surface-color, white)'
                                    }} />
                                </button>

                                {activePopup === 'email' && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '44px',
                                        right: 0,
                                        width: '280px',
                                        backgroundColor: 'var(--surface-color, white)',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border-color)',
                                        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                        padding: '16px',
                                        zIndex: 100,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                                            <Mail size={16} color="var(--primary-color)" />
                                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>E-Mail-Einrichtung</span>
                                        </div>
                                        {emailStatus.connected ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <Check size={14} /> Verbunden
                                                </div>
                                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    Absender: {emailStatus.email}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991B1B', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <AlertCircle size={14} /> Nicht verbunden
                                                </div>
                                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                                    E-Mails werden über die Plattform-Fallbacks versendet.
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => {
                                                setActivePopup(null);
                                                navigate('/settings', { state: { activeTab: 'email-settings' } });
                                            }}
                                            style={{
                                                width: '100%',
                                                padding: '8px',
                                                borderRadius: '6px',
                                                border: 'none',
                                                backgroundColor: 'var(--primary-color)',
                                                color: 'white',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                textAlign: 'center'
                                            }}
                                        >
                                            {emailStatus.connected ? 'Einstellungen verwalten' : 'Jetzt einrichten'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Cloud connection status */}
                        {!isTenant && (
                            <div ref={cloudRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', ...(onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}) }}>
                                <button
                                    onClick={() => setActivePopup(activePopup === 'cloud' ? null : 'cloud')}
                                    className="glass-icon-btn"
                                    style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: 'var(--radius-md)',
                                        position: 'relative',
                                        backgroundColor: activePopup === 'cloud' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)',
                                        border: 'none',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                    title="Cloud-Speicher Status"
                                >
                                    <Cloud size={18} color={cloudStatus.connected ? "var(--primary-color)" : "var(--text-secondary)"} />
                                    <span style={{
                                        position: 'absolute',
                                        top: '6px',
                                        right: '6px',
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: cloudStatus.connected ? '#10B981' : '#64748B',
                                        border: '1.5px solid var(--surface-color, white)'
                                    }} />
                                </button>

                                {activePopup === 'cloud' && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '44px',
                                        right: 0,
                                        width: '280px',
                                        backgroundColor: 'var(--surface-color, white)',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border-color)',
                                        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                        padding: '16px',
                                        zIndex: 100,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                                            <Cloud size={16} color="var(--primary-color)" />
                                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Cloud-Verbindungen</span>
                                        </div>
                                        {cloudStatus.connected ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <Check size={14} /> Verbunden
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                                                    {cloudStatus.connections.map(c => (
                                                        <div key={c.id} style={{ fontSize: '0.75rem', color: 'var(--text-primary)', borderBottom: '1px solid #f1f5f9', paddingBottom: '2px' }}>
                                                            <strong>{c.provider === 'onedrive' ? 'OneDrive' : 'Google Drive'}:</strong>
                                                            <br />
                                                            {c.account_email}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748B', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <AlertCircle size={14} /> Keine Verbindung
                                                </div>
                                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                                    Kein OneDrive oder Google Drive Account verbunden.
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => {
                                                setActivePopup(null);
                                                navigate('/settings', { state: { activeTab: 'cloud' } });
                                            }}
                                            style={{
                                                width: '100%',
                                                padding: '8px',
                                                borderRadius: '6px',
                                                border: 'none',
                                                backgroundColor: 'var(--primary-color)',
                                                color: 'white',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                textAlign: 'center'
                                            }}
                                        >
                                            {cloudStatus.connected ? 'Verbindungen verwalten' : 'Jetzt einrichten'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Central Notification Bell (all notifications in one place) */}
                        <div style={onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                            <NotificationBell />
                        </div>

                        {/* User Profile: Menü statt Abmelden per Klick (kein versehentliches Abmelden) */}
                        <div ref={profileRef} style={{ position: 'relative' }}>
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
                                onClick={() => setActivePopup(activePopup === 'profile' ? null : 'profile')}
                                title="Konto-Menü"
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

                            {activePopup === 'profile' && (
                                <div style={{
                                    position: 'absolute',
                                    top: '48px',
                                    right: 0,
                                    width: '220px',
                                    backgroundColor: 'var(--surface-color, white)',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border-color)',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                    padding: '8px',
                                    zIndex: 100,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px'
                                }}>
                                    {!isTenant && (
                                        <button
                                            onClick={() => { setActivePopup(null); navigate('/settings', { state: { activeTab: 'profile' } }); }}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)', textAlign: 'left' }}
                                        >
                                            <User size={16} /> Profil & Einstellungen
                                        </button>
                                    )}
                                    <button
                                        onClick={handleLogout}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--danger-color, #DC2626)', textAlign: 'left' }}
                                    >
                                        <LogOut size={16} /> Abmelden
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', padding: '0 var(--spacing-sm)', gap: '6px' }}>
                    {/* Portfolio-Auswahl auch auf dem Handy (sonst Spacer für zentriertes Logo) */}
                    {!isTenant && portfolios.length > 0 ? (
                        <div style={onboardingLocked ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
                            {renderPortfolioSelect(true)}
                        </div>
                    ) : (
                        <div style={{ width: '32px' }}></div>
                    )}
                    <img src="/logo.svg" alt="ImmoControl Pro 360" style={{ maxHeight: '40px', minWidth: 0, maxWidth: '38%', objectFit: 'contain' }} />
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
                            onClick={() => {
                                if (window.confirm('Wirklich abmelden? Nicht gespeicherte Eingaben gehen verloren.')) handleLogout();
                            }}
                            title="Abmelden"
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
