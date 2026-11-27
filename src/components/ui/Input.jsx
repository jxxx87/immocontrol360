import React, { useId } from 'react';

const Input = ({ label, type = 'text', placeholder, value, onChange, style, id, ...props }) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
            {label && (
                <label htmlFor={inputId} style={{
                    display: 'block',
                    marginBottom: '0.25rem',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)'
                }}>
                    {label}
                </label>
            )}
            {/* Übrige Props zuerst, damit sie den zusammengeführten style nicht überschreiben */}
            <input
                {...props}
                id={inputId}
                type={type}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                style={{
                    width: '100%',
                    // managed by global CSS
                    fontSize: '0.875rem',
                    outline: 'none',
                    ...style
                }}
            />
        </div>
    );
};

export default Input;
