import React from 'react';
import { useViewMode } from '../../context/ViewModeContext';

const Card = ({ children, className = '', title, action, style = {} }) => {
    const { isMobile } = useViewMode();

    if (isMobile) {
        // Mobile: simple block layout, no flex, no overflow constraints
        return (
            <div style={{
                backgroundColor: 'var(--glass-bg)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                padding: '12px',
                border: '1px solid var(--glass-border)',
                maxWidth: '100%',
                boxSizing: 'border-box',
                ...style
            }} className={className}>
                {(title || action) && (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 'var(--spacing-md)',
                        flexWrap: 'wrap',
                        gap: '8px'
                    }}>
                        {title && <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{title}</h3>}
                        {action && <div>{action}</div>}
                    </div>
                )}
                {children}
            </div>
        );
    }

    // Desktop: original flex layout
    return (
        <div style={{
            backgroundColor: 'var(--glass-bg)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            padding: 'var(--spacing-lg)',
            border: '1px solid var(--glass-border)',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            ...style
        }} className={className}>
            {(title || action) && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--spacing-md)',
                    flexWrap: 'wrap',
                    gap: '8px'
                }}>
                    {title && <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>{title}</h3>}
                    {action && <div>{action}</div>}
                </div>
            )}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {children}
            </div>
        </div>
    );
};

export default Card;
