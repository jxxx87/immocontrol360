import React from 'react';
import Card from '../ui/Card';

const AuthLayout = ({ children, title, subtitle }) => {
    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--background-color)',
            padding: 'var(--spacing-md)'
        }}>
            <div style={{ width: '100%', maxWidth: '400px' }}>
                <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-xl)' }}>
                    <img
                        src="/logo.png?v=3"
                        alt="ImmoControl Pro 360"
                        style={{
                            maxHeight: '60px',
                            maxWidth: '100%',
                            height: 'auto',
                            marginBottom: 'var(--spacing-md)',
                            display: 'inline-block'
                        }}
                        onError={(e) => {
                            // Fallback if image not found, hide it or show text
                            console.warn('Logo not found, using fallback');
                            e.target.style.display = 'none';
                        }}
                    />
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>{title}</h1>
                    {subtitle && <p style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
                </div>
                <Card>
                    {children}
                </Card>
            </div>
        </div>
    );
};

export default AuthLayout;
