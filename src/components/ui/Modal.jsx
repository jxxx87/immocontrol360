import React from 'react';
import { X } from 'lucide-react';
import Button from './Button';

const Modal = ({ isOpen, onClose, title, children, footer, maxWidth = '500px' }) => {
    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            backdropFilter: 'blur(2px)'
        }}>
            <div style={{
                backgroundColor: 'var(--surface-color)',
                borderRadius: 'var(--radius-lg)',
                width: '100%',
                maxWidth: maxWidth,
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: 'var(--shadow-lg)',
                margin: 'var(--spacing-md)'
            }}>
                {/* Header */}
                <div style={{
                    padding: 'var(--spacing-lg)',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{title}</h3>
                    <button
                        onClick={onClose}
                        style={{
                            color: 'var(--text-secondary)',
                            padding: '4px',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            display: 'flex'
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    padding: 'var(--spacing-lg)',
                    overflowY: 'auto'
                }}>
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div style={{
                        padding: 'var(--spacing-lg)',
                        borderTop: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 'var(--spacing-md)',
                        backgroundColor: 'var(--background-color)',
                        borderBottomLeftRadius: 'var(--radius-lg)',
                        borderBottomRightRadius: 'var(--radius-lg)'
                    }}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
