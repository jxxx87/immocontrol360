import React from 'react';
import Input from './Input';

// Prozent-/Zinseingabe: liefert immer eine Zahl oder '' (leeres Feld) an onChange
const RateInput = ({ label, value, onChange, max = 999, min = 0, ...props }) => {
    const handleChange = (e) => {
        let val = parseFloat(e.target.value);
        if (!Number.isFinite(val)) val = ''; // Erlaube leere Eingabe

        // Auf den erlaubten Bereich begrenzen (wenn Zahl)
        if (val !== '') {
            const upper = parseFloat(max);
            const lower = parseFloat(min);
            if (Number.isFinite(upper) && val > upper) val = upper;
            if (Number.isFinite(lower) && val < lower) val = lower;
        }

        // Rufe Original onChange auf mit simuliertem Event
        onChange({ target: { value: val } });
    };

    return (
        <Input
            label={label}
            type="number"
            step="0.01" // Standard für Rates
            min={min}
            max={max}
            value={value}
            onChange={handleChange}
            {...props}
        />
    );
};

export default RateInput;
