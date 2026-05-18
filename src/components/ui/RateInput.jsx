import React from 'react';
import Input from './Input';

const RateInput = ({ label, value, onChange, max = 999, ...props }) => {
    const handleChange = (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = ''; // Erlaube leere Eingabe

        // Begrenze auf max (wenn Zahl)
        if (val !== '' && val > max) {
            val = max;
        }

        // Rufe Original onChange auf mit simuliertem Event
        onChange({ target: { value: val } });
    };

    return (
        <Input
            label={label}
            type="number"
            step="0.01" // Standard für Rates
            max={max}
            value={value}
            onChange={handleChange}
            {...props}
        />
    );
};

export default RateInput;
