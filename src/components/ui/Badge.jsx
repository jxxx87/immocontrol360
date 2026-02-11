import React from 'react';

const Badge = ({ children, variant = 'default' }) => {
    const variants = {
        default: { bg: '#E5E7EB', color: '#374151' },
        success: { bg: '#D1FAE5', color: '#065F46' },
        warning: { bg: '#FEF3C7', color: '#92400E' },
        danger: { bg: '#FEE2E2', color: '#991B1B' },
        blue: { bg: '#DBEAFE', color: '#1E40AF' }
    };

    const style = variants[variant] || variants.default;

    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.125rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: 500,
            backgroundColor: style.bg,
            color: style.color
        }}>
            {children}
        </span>
    );
};

export default Badge;
