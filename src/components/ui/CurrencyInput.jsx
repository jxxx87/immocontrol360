import React, { useState, useEffect, useRef } from 'react';

const CurrencyInput = ({ label, value, onChange, placeholder, allowDecimals = false, ...props }) => {

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    // Formatiert Nummer zu String
    const formatValue = (val) => {
        if (val === '' || val === null || val === undefined) return '';

        // Versuche val zu parsen, falls es ein String ist (z.B. "1000.50")
        const num = typeof val === 'string' ? parseFloat(val) : val;

        if (isNaN(num)) return '';

        return new Intl.NumberFormat('de-DE', {
            minimumFractionDigits: allowDecimals ? 2 : 0,
            maximumFractionDigits: allowDecimals ? 2 : 0
        }).format(num);
    };

    // Parst String (User Input) zu Nummer
    const parseToNumber = (str) => {
        if (!str) return 0;
        // Integer-Modus: Alles außer Ziffern und Minus weg
        if (!allowDecimals) {
            const cleanStr = str.replace(/[^\d-]/g, '');
            const num = parseInt(cleanStr, 10);
            return isNaN(num) ? 0 : num;
        }
        // Decimal-Modus: Alles außer Ziffern, Komma, Minus weg. Komma -> Punkt
        else {
            const cleanStr = str.replace(/[^\d,-]/g, '').replace(',', '.');
            const num = parseFloat(cleanStr);
            return isNaN(num) ? 0 : num;
        }
    };

    // Live-Formatierung während Eingabe
    const formatInputString = (inputRaw) => {
        if (!inputRaw) return '';
        const isNegative = inputRaw.includes('-');

        if (!allowDecimals) {
            // Nur Ziffern
            const clean = inputRaw.replace(/[^\d]/g, '');
            if (!clean) return '';
            const num = parseInt(clean, 10);
            return (isNegative ? '-' : '') + num.toLocaleString('de-DE');
        } else {
            // Mit Komma
            let clean = inputRaw.replace(/[^\d,]/g, '');
            // Nur erstes Komma erlauben
            const parts = clean.split(',');
            let integerPart = parts[0];
            let decimalPart = parts.length > 1 ? ',' + parts[1].substring(0, 2) : '';

            // Tausenderpunkte in Integer-Teil
            integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

            // Wenn User Komma tippt
            if (inputRaw.endsWith(',') && !decimalPart) decimalPart = ',';

            return (isNegative ? '-' : '') + integerPart + decimalPart;
        }
    };

    // -------------------------------------------------------------------------
    // STATE & EFFECT
    // -------------------------------------------------------------------------
    const [displayValue, setDisplayValue] = useState('');
    const inputRef = useRef(null);
    const isFocused = useRef(false);

    // Sync externer Value -> Anzeige (nur wenn nicht fokussiert oder leer)
    useEffect(() => {
        if (!isFocused.current) {
            // Prüfen ob sich der numerische Wert wirklich geändert hat
            const currentNum = parseToNumber(displayValue);
            const newNum = typeof value === 'number' ? value : (parseFloat(value) || 0);

            // Toleranzvergleich bei Float
            if (Math.abs(currentNum - newNum) > (allowDecimals ? 0.001 : 0)) {
                setDisplayValue(formatValue(newNum));
            }
        }
    }, [value, allowDecimals]);

    const handleChange = (e) => {
        const raw = e.target.value;
        const formatted = formatInputString(raw);
        setDisplayValue(formatted);

        const num = parseToNumber(formatted);
        onChange({ target: { value: num } });
    };

    const handleFocus = () => isFocused.current = true;

    const handleBlur = () => {
        isFocused.current = false;
        // Beim Verlassen hübsch machen (z.B. 1000,5 -> 1.000,50)
        const num = parseToNumber(displayValue);
        setDisplayValue(formatValue(num));
    };

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
                ref={inputRef}
                type="text"
                inputMode={allowDecimals ? "decimal" : "numeric"}
                value={displayValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={placeholder}
                style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    ...props.style
                }}
            />
        </div>
    );
};

export default CurrencyInput;
