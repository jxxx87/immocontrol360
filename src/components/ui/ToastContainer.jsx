import React from 'react';
import { useNotifications } from '../../context/NotificationContext';
import { X, MessageSquare, Ticket, Megaphone, FileText, UserCheck, MessageCircle } from 'lucide-react';

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

const ToastContainer = () => {
    const { toasts, removeToast } = useNotifications();

    if (toasts.length === 0) return null;

    return (
        <div style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '380px',
            width: '100%',
            pointerEvents: 'none',
        }}>
            {toasts.map((toast) => {
                const Icon = iconMap[toast.type] || MessageSquare;
                const color = colorMap[toast.type] || '#3B82F6';

                return (
                    <div
                        key={toast.toastId}
                        style={{
                            pointerEvents: 'auto',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '12px',
                            padding: '14px 16px',
                            backgroundColor: 'var(--surface-color, #fff)',
                            borderRadius: '12px',
                            border: '1px solid var(--border-color, #e5e7eb)',
                            boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
                            animation: 'slideInRight 0.35s ease-out',
                            position: 'relative',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Accent bar */}
                        <div style={{
                            position: 'absolute',
                            left: 0, top: 0, bottom: 0,
                            width: '4px',
                            backgroundColor: color,
                            borderRadius: '12px 0 0 12px',
                        }} />

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
                            marginLeft: '4px',
                        }}>
                            <Icon size={18} color={color} />
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                color: 'var(--text-primary)',
                                marginBottom: '2px',
                            }}>
                                {toast.title}
                            </div>
                            <div style={{
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)',
                                lineHeight: 1.4,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                            }}>
                                {toast.body}
                            </div>
                        </div>

                        {/* Close */}
                        <button
                            onClick={() => removeToast(toast.toastId)}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)',
                                padding: '2px',
                                flexShrink: 0,
                                transition: 'color 0.2s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                        >
                            <X size={16} />
                        </button>

                        {/* Progress bar */}
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: '3px',
                            backgroundColor: `${color}20`,
                        }}>
                            <div style={{
                                height: '100%',
                                backgroundColor: color,
                                animation: 'shrinkBar 5s linear forwards',
                            }} />
                        </div>
                    </div>
                );
            })}

            <style>{`
                @keyframes slideInRight {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                @keyframes shrinkBar {
                    from { width: 100%; }
                    to { width: 0%; }
                }
            `}</style>
        </div>
    );
};

export default ToastContainer;
