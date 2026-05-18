import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingOverlay = ({ message = 'Wird gespeichert...' }) => {
    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            borderRadius: 'var(--radius-md)'
        }}>
            <div style={{
                backgroundColor: 'var(--surface-color)',
                padding: '24px 48px',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg)',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
                gap: '16px',
                border: '1px solid var(--border-color)'
            }}>
                <Loader2 size={48} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{message}</span>
            </div>
        </div>
    );
};

export default LoadingOverlay;
