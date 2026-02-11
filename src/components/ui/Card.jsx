import React from 'react';

const Card = ({ children, className = '', title, action }) => {
    return (
        <div style={{
            backgroundColor: 'var(--surface-color)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            padding: 'var(--spacing-lg)',
            border: '1px solid var(--border-color)',
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
        }} className={className}>
            {(title || action) && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--spacing-md)'
                }}>
                    {title && <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>{title}</h3>}
                    {action && <div>{action}</div>}
                </div>
            )}
            <div style={{ flex: 1 }}>
                {children}
            </div>
        </div>
    );
};

export default Card;
