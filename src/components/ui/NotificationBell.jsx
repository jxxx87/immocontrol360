import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../context/NotificationContext';
import {
    Bell, MessageSquare, Ticket, Megaphone, FileText, UserCheck,
    MessageCircle, Check, BellOff, X, CheckCheck, Trash2
} from 'lucide-react';

const iconMap = {
    message: MessageSquare,
    ticket: Ticket,
    ticket_comment: MessageCircle,
    announcement: Megaphone,
    document: FileText,
    registration: UserCheck,
};

const colorMap = {
    message: '#3B82F6',
    ticket: '#F59E0B',
    ticket_comment: '#8B5CF6',
    announcement: '#10B981',
    document: '#6366F1',
    registration: '#22C55E',
};

const NotificationBell = () => {
    const { notifications, unreadCount, markAllRead, markRead, permissionGranted, requestPermission } = useNotifications();
    const [isOpen, setIsOpen] = useState(false);
    const bellRef = useRef(null);
    const panelRef = useRef(null);
    const [panelStyle, setPanelStyle] = useState({});
    const navigate = useNavigate();

    // Recalculate panel position when opening or on resize
    const updatePanelPosition = () => {
        if (!bellRef.current) return;
        const rect = bellRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const isMobile = vw < 768;

        if (isMobile) {
            // Full-width on mobile, centered
            setPanelStyle({
                position: 'fixed',
                top: `${rect.bottom + 4}px`,
                left: '8px',
                right: '8px',
                width: 'auto',
                maxHeight: `${window.innerHeight - rect.bottom - 20}px`,
                zIndex: 99999,
            });
        } else {
            // Desktop: align to right of bell, clamped to viewport
            const panelWidth = 380;
            let right = vw - rect.right;
            // Ensure it doesn't go off the left side
            if (rect.right - panelWidth < 8) {
                right = vw - panelWidth - 8;
            }
            setPanelStyle({
                position: 'fixed',
                top: `${rect.bottom + 8}px`,
                right: `${Math.max(8, right)}px`,
                width: `${panelWidth}px`,
                maxHeight: `${Math.min(520, window.innerHeight - rect.bottom - 20)}px`,
                zIndex: 99999,
            });
        }
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (bellRef.current && !bellRef.current.contains(e.target) &&
                panelRef.current && !panelRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            updatePanelPosition();
            window.addEventListener('resize', updatePanelPosition);
            window.addEventListener('scroll', updatePanelPosition, true);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', updatePanelPosition);
            window.removeEventListener('scroll', updatePanelPosition, true);
        };
    }, [isOpen]);

    const timeAgo = (date) => {
        if (!date) return '';
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        if (seconds < 60) return 'Gerade eben';
        if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} Min.`;
        if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} Std.`;
        const days = Math.floor(seconds / 86400);
        if (days === 1) return 'Gestern';
        if (days < 7) return `vor ${days} Tagen`;
        return new Date(date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    };

    const handleNotificationClick = (notif) => {
        markRead(notif.id);
        if (notif.route) {
            navigate(notif.route);
        }
        setIsOpen(false);
    };

    const isMobile = window.innerWidth < 768;

    return (
        <>
            <div ref={bellRef} style={{ position: 'relative', cursor: 'pointer' }}>
                <button
                    id="notification-bell-btn"
                    onClick={() => setIsOpen(!isOpen)}
                    className={isMobile ? undefined : 'glass-icon-btn'}
                    style={{
                        ...(isMobile ? {
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-secondary)',
                        } : {}),
                        position: 'relative',
                    }}
                >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                        <span style={{
                            position: 'absolute',
                            top: isMobile ? '4px' : '6px',
                            right: isMobile ? '4px' : '6px',
                            minWidth: '18px',
                            height: '18px',
                            borderRadius: '9px',
                            backgroundColor: '#EF4444',
                            color: 'white',
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '2px solid var(--surface-color, white)',
                            padding: '0 3px',
                            lineHeight: 1,
                            animation: 'pulse-bell 2s infinite',
                        }}>
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </button>
            </div>

            {isOpen && createPortal(
                <>
                    {/* Mobile backdrop */}
                    {isMobile && (
                        <div
                            style={{
                                position: 'fixed',
                                inset: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                backdropFilter: 'blur(2px)',
                                WebkitBackdropFilter: 'blur(2px)',
                                zIndex: 99998,
                            }}
                            onClick={() => setIsOpen(false)}
                        />
                    )}

                    <div
                        ref={panelRef}
                        id="notification-dropdown"
                        style={{
                            ...panelStyle,
                            backgroundColor: 'var(--surface-color, #fff)',
                            borderRadius: isMobile ? '16px' : '14px',
                            border: '1px solid var(--border-color)',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.1)',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            animation: 'notif-slide-in 0.2s ease-out',
                        }}
                    >
                        {/* ── Header ── */}
                        <div style={{
                            padding: '14px 16px',
                            borderBottom: '1px solid var(--border-color-soft, #e2e8f0)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexShrink: 0,
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}>
                                <span style={{
                                    fontWeight: 700,
                                    fontSize: '0.95rem',
                                    color: 'var(--text-primary)',
                                }}>
                                    Benachrichtigungen
                                </span>
                                {unreadCount > 0 && (
                                    <span style={{
                                        fontSize: '0.7rem',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                        color: '#EF4444',
                                        fontWeight: 600,
                                    }}>
                                        {unreadCount} neu
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllRead}
                                        title="Alle als gelesen markieren"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            color: 'var(--primary-color)',
                                            borderRadius: '8px',
                                            transition: 'background 0.2s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(14, 165, 233, 0.08)'}
                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <CheckCheck size={14} />
                                        {!isMobile && 'Alle gelesen'}
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsOpen(false)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '6px',
                                        color: 'var(--text-secondary)',
                                        borderRadius: '8px',
                                        transition: 'background 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* ── Permission Hint ── */}
                        {!permissionGranted && (
                            <div
                                onClick={requestPermission}
                                style={{
                                    padding: '10px 16px',
                                    backgroundColor: '#FEF3C7',
                                    borderBottom: '1px solid var(--border-color-soft, #e2e8f0)',
                                    fontSize: '0.78rem',
                                    color: '#92400E',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    flexShrink: 0,
                                    transition: 'background 0.2s',
                                }}
                            >
                                <BellOff size={14} />
                                Push-Benachrichtigungen aktivieren
                            </div>
                        )}

                        {/* ── Notification List ── */}
                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            overscrollBehavior: 'contain',
                            WebkitOverflowScrolling: 'touch',
                        }}>
                            {notifications.length === 0 ? (
                                <div style={{
                                    padding: '48px 20px',
                                    textAlign: 'center',
                                    color: 'var(--text-secondary)',
                                }}>
                                    <div style={{
                                        width: '56px',
                                        height: '56px',
                                        borderRadius: '50%',
                                        backgroundColor: 'rgba(100, 116, 139, 0.08)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        margin: '0 auto 12px',
                                    }}>
                                        <Bell size={24} style={{ opacity: 0.4 }} />
                                    </div>
                                    <p style={{
                                        fontSize: '0.9rem',
                                        fontWeight: 600,
                                        color: 'var(--text-primary)',
                                        margin: '0 0 4px',
                                    }}>
                                        Keine Benachrichtigungen
                                    </p>
                                    <p style={{ fontSize: '0.8rem', margin: 0 }}>
                                        Neue Benachrichtigungen erscheinen hier
                                    </p>
                                </div>
                            ) : (
                                notifications.map(notif => {
                                    const Icon = iconMap[notif.type] || Bell;
                                    const color = colorMap[notif.type] || '#6B7280';

                                    return (
                                        <div
                                            key={notif.id}
                                            onClick={() => handleNotificationClick(notif)}
                                            style={{
                                                padding: '12px 16px',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '12px',
                                                cursor: 'pointer',
                                                borderBottom: '1px solid var(--border-color-soft, #f1f5f9)',
                                                backgroundColor: notif.read ? 'transparent' : `${color}08`,
                                                transition: 'background 0.15s',
                                                position: 'relative',
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-bg, #f9fafb)'}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = notif.read ? 'transparent' : `${color}08`}
                                        >
                                            {/* Unread dot */}
                                            {!notif.read && (
                                                <div style={{
                                                    position: 'absolute',
                                                    left: '6px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    width: '6px',
                                                    height: '6px',
                                                    borderRadius: '50%',
                                                    backgroundColor: color,
                                                }} />
                                            )}

                                            {/* Icon */}
                                            <div style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '10px',
                                                backgroundColor: `${color}15`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <Icon size={16} color={color} />
                                            </div>

                                            {/* Content */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontWeight: notif.read ? 500 : 600,
                                                    fontSize: '0.84rem',
                                                    color: 'var(--text-primary)',
                                                    lineHeight: 1.3,
                                                    marginBottom: '2px',
                                                }}>
                                                    {notif.title}
                                                </div>
                                                {notif.body && (
                                                    <div style={{
                                                        fontSize: '0.78rem',
                                                        color: 'var(--text-secondary)',
                                                        lineHeight: 1.3,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        marginBottom: '3px',
                                                    }}>
                                                        {notif.body}
                                                    </div>
                                                )}
                                                <div style={{
                                                    fontSize: '0.68rem',
                                                    color: 'var(--text-secondary)',
                                                    opacity: 0.7,
                                                }}>
                                                    {timeAgo(notif.timestamp)}
                                                </div>
                                            </div>

                                            {/* Unread indicator */}
                                            {!notif.read && (
                                                <span style={{
                                                    width: '8px',
                                                    height: '8px',
                                                    borderRadius: '50%',
                                                    backgroundColor: color,
                                                    flexShrink: 0,
                                                    alignSelf: 'center',
                                                }} />
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>,
                document.body
            )}

            <style>{`
                @keyframes pulse-bell {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                @keyframes notif-slide-in {
                    from {
                        opacity: 0;
                        transform: translateY(-8px) scale(0.97);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
            `}</style>
        </>
    );
};

export default NotificationBell;
