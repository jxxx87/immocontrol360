import React from 'react';
import { X } from 'lucide-react';
import Button from './Button';

const Modal = ({ isOpen, onClose, title, children, footer, maxWidth = '500px' }) => {
    if (!isOpen) return null;

    const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: isMobileView ? 'var(--surface-color)' : 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: isMobileView ? 'stretch' : 'center',
            justifyContent: 'center',
            zIndex: 110,
            backdropFilter: isMobileView ? 'none' : 'blur(2px)'
        }}>
            <div style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: isMobileView ? 0 : 'var(--radius-lg)',
                width: '100%',
                maxWidth: isMobileView ? '100%' : maxWidth,
                height: isMobileView ? '100%' : 'auto',
                maxHeight: isMobileView ? '100%' : '90vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: isMobileView ? 'none' : 'var(--shadow-lg)',
                margin: isMobileView ? 0 : 'var(--spacing-md)',
                paddingTop: isMobileView ? 'env(safe-area-inset-top)' : 0,
                paddingBottom: isMobileView ? 'calc(60px + env(safe-area-inset-bottom))' : 0
            }}>
                {/* Header */}
                <div style={{
                    padding: isMobileView ? '14px 16px' : 'var(--spacing-lg)',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0
                }}>
                    <h3 style={{ fontSize: isMobileView ? '1.05rem' : '1.25rem', fontWeight: 600 }}>{title}</h3>
                    <button
                        onClick={onClose}
                        style={{
                            color: 'var(--text-secondary)',
                            padding: '8px',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            display: 'flex',
                            minHeight: '44px',
                            minWidth: '44px',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={22} />
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    padding: isMobileView ? '14px 16px' : 'var(--spacing-lg)',
                    overflowY: 'auto',
                    flex: 1,
                    WebkitOverflowScrolling: 'touch',
                    minHeight: 0
                }}>
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div style={{
                        padding: isMobileView ? '12px 16px' : 'var(--spacing-lg)',
                        paddingBottom: isMobileView ? 'calc(12px + env(safe-area-inset-bottom))' : 'var(--spacing-lg)',
                        borderTop: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 'var(--spacing-md)',
                        backgroundColor: 'var(--background-color)',
                        borderBottomLeftRadius: isMobileView ? 0 : 'var(--radius-lg)',
                        borderBottomRightRadius: isMobileView ? 0 : 'var(--radius-lg)',
                        flexShrink: 0,
                        flexWrap: 'wrap'
                    }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;

