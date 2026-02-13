import React from 'react';

const Button = ({
    children,
    variant = 'primary',
    size = 'md',
    icon: Icon,
    onClick,
    className = '',
    style = {},
    type = 'button',
    disabled = false,
    ...props
}) => {

    // We now use CSS classes defined in index.css for styling
    // .btn, .btn-primary, .btn-sm etc.

    const combinedClassName = `btn btn-${variant} btn-${size} ${className}`;

    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            className={combinedClassName}
            style={style}
            {...props}
        >
            {Icon && <Icon size={18} style={{ marginRight: children ? '0.5rem' : 0 }} />}
            {children}
        </button>
    );
};

export default Button;
