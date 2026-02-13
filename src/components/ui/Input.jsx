import React from 'react';

const Input = ({ label, type = 'text', placeholder, value, onChange, ...props }) => {
    return (
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
            {label && (
                <label style={{
                    display: 'block',
                    marginBottom: '0.25rem',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)'
                }}>
                    {label}
                </label>
            )}
            <input
                type={type}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.875rem',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                }}
                {...props}
            />
        </div>
    );
};

export default Input;
