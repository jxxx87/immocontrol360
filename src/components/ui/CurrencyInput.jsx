import React, { useState, useRef, useId } from 'react';

// -----------------------------------------------------------------------------
// Wert-Schnittstelle (für alle Aufrufer kompatibel):
//   onChange(e)          -> e.target.value ist die Zahl (bei leerem Feld 0, wie bisher;
//                           mit allowEmpty bei leerem Feld '' = "keine Angabe")
//   onValueChange(num)   -> die Zahl direkt; bei leerem Feld null ("keine Angabe")
// allowEmpty ist für optionale Betragsfelder gedacht (z. B. Kaution), bei denen ein
// geleertes Feld nicht als 0 gespeichert werden soll (G03-16).
// Weitere Props (disabled, readOnly, name, id, required, aria-*, onBlur ...) werden
// an das <input> durchgereicht.
// -----------------------------------------------------------------------------

// Zeichen, die beim Wiederherstellen der Cursorposition mitgezählt werden
const SIGNIFICANT_CHAR = /[\d,-]/;

const countSignificant = (str) => {
    let count = 0;
    for (const ch of str) if (SIGNIFICANT_CHAR.test(ch)) count++;
    return count;
};

const positionForSignificant = (str, significantCount) => {
    let pos = 0;
    let count = 0;
    while (pos < str.length && count < significantCount) {
        if (SIGNIFICANT_CHAR.test(str[pos])) count++;
        pos++;
    }
    return pos;
};

// Tolerante Erkennung eingefügter Beträge: "1.234,56", "1,234.56", "12.50", "850,50 €", "1.500"
const parseFlexibleNumber = (text) => {
    if (text === null || text === undefined) return null;
    let s = String(text).trim().replace(/EUR/gi, '').replace(/[\s€]/g, '');
    if (!s) return null;
    const negative = s.startsWith('-') || s.endsWith('-');
    s = s.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let decimalSep = null;
    if (lastComma !== -1 && lastDot !== -1) {
        // Beide Trenner vorhanden: der letzte ist der Dezimaltrenner
        decimalSep = lastComma > lastDot ? ',' : '.';
    } else if (lastComma !== -1) {
        // Ein einzelnes Komma ist (deutsch) ein Dezimaltrenner, mehrere sind Tausendertrenner
        decimalSep = (s.match(/,/g) || []).length === 1 ? ',' : null;
    } else if (lastDot !== -1) {
        // Ein einzelner Punkt mit genau 3 Folgeziffern ist ein Tausenderpunkt ("1.500"),
        // sonst ein Dezimalpunkt ("12.50")
        const dotCount = (s.match(/\./g) || []).length;
        const digitsAfter = s.length - lastDot - 1;
        decimalSep = (dotCount === 1 && digitsAfter !== 3) ? '.' : null;
    }

    let normalized;
    if (decimalSep) {
        const idx = s.lastIndexOf(decimalSep);
        normalized = s.slice(0, idx).replace(/[.,]/g, '') + '.' + s.slice(idx + 1).replace(/[.,]/g, '');
    } else {
        normalized = s.replace(/[.,]/g, '');
    }
    const num = parseFloat(normalized);
    if (isNaN(num)) return null;
    return negative ? -num : num;
};

const hasFraction = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && Math.abs(n - Math.round(n)) > 0.0001;
};

const CurrencyInput = ({
    label,
    value,
    onChange,
    onValueChange,
    placeholder,
    allowDecimals = false,
    allowEmpty = false,
    id,
    style,
    onFocus,
    onBlur,
    onPaste,
    ...rest
}) => {
    const autoId = useId();
    const inputId = id || autoId;

    // Ganzzahl-Felder zeigen vorhandene Cent-Beträge trotzdem mit zwei Nachkommastellen an,
    // damit beim Bearbeiten nichts gerundet und so gespeichert wird (G03-04).
    const [sawFraction, setSawFraction] = useState(() => !allowDecimals && hasFraction(value));
    if (!allowDecimals && !sawFraction && hasFraction(value)) setSawFraction(true);
    const decimals = allowDecimals || sawFraction;

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
            minimumFractionDigits: decimals ? 2 : 0,
            maximumFractionDigits: decimals ? 2 : 0
        }).format(num);
    };

    // Parst die Anzeige (deutsches Format) zu einer Zahl; leeres Feld -> null
    const parseToNumber = (str) => {
        if (!str) return null;
        const isNegative = str.includes('-');
        const [intRaw, decRaw = ''] = str.split(',');
        const intDigits = intRaw.replace(/[^\d]/g, '');
        const decDigits = decRaw.replace(/[^\d]/g, '');
        if (!intDigits && !decDigits) return null;
        const num = parseFloat(`${intDigits || '0'}.${decDigits || '0'}`);
        if (isNaN(num)) return null;
        // Ganzzahl-Modus: Nachkommastellen werden gerundet statt an die Zahl angehängt
        const result = decimals ? num : Math.round(num);
        return isNegative ? -result : result;
    };

    // Live-Formatierung während Eingabe
    const formatInputString = (inputRaw) => {
        if (!inputRaw) return '';
        const isNegative = inputRaw.includes('-');
        const sign = isNegative ? '-' : '';

        const clean = inputRaw.replace(/[^\d,]/g, '');
        const parts = clean.split(',');
        const hasComma = parts.length > 1;
        const intDigits = parts[0];
        const decDigits = hasComma ? parts[1].substring(0, 2) : '';

        if (!intDigits && !hasComma) return sign; // z. B. nur "-" getippt

        // Tausenderpunkte in Integer-Teil
        const integerPart = decimals
            ? (intDigits || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
            : (intDigits ? parseInt(intDigits, 10).toLocaleString('de-DE') : '0');

        return sign + integerPart + (hasComma ? ',' + decDigits : '');
    };

    // Anzeige aus einem externen Wert ableiten (nur wenn sich der Zahlenwert geändert hat)
    const deriveDisplay = (current) => {
        if (value === '' || value === null || value === undefined) return '';
        const newNum = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(newNum)) return '';
        const currentNum = parseToNumber(current) ?? 0;
        if (Math.abs(currentNum - newNum) > (decimals ? 0.001 : 0)) {
            return formatValue(newNum);
        }
        return current;
    };

    // -------------------------------------------------------------------------
    // STATE
    // -------------------------------------------------------------------------
    const [displayValue, setDisplayValue] = useState(() => deriveDisplay(''));
    const [isFocused, setIsFocused] = useState(false);
    const [syncedValue, setSyncedValue] = useState(value);
    const [syncedDecimals, setSyncedDecimals] = useState(decimals);
    const inputRef = useRef(null);

    // Sync externer Value -> Anzeige (nur wenn nicht fokussiert).
    // Object.is statt !==: sonst wäre NaN !== NaN immer wahr -> Endlos-Rendern.
    if (!isFocused && (!Object.is(value, syncedValue) || decimals !== syncedDecimals)) {
        setSyncedValue(value);
        setSyncedDecimals(decimals);
        const next = deriveDisplay(displayValue);
        if (next !== displayValue) setDisplayValue(next);
    }

    const emitValue = (num) => {
        // Leeres Feld: Standard 0 (bisheriges Verhalten), mit allowEmpty '' (keine Angabe)
        const emptyValue = allowEmpty ? '' : 0;
        if (onChange) onChange({ target: { value: num === null ? emptyValue : num, name: rest.name } });
        if (onValueChange) onValueChange(num);
    };

    const restoreCaret = (significantCount) => {
        requestAnimationFrame(() => {
            const el = inputRef.current;
            if (!el || document.activeElement !== el) return;
            const pos = positionForSignificant(el.value, significantCount);
            try { el.setSelectionRange(pos, pos); } catch { /* z. B. nicht unterstützter Input-Typ */ }
        });
    };

    const handleChange = (e) => {
        let raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;

        // Dezimalmodus: einen frisch getippten Punkt als Dezimalkomma deuten (Tastaturen ohne Komma)
        if (decimals && !raw.includes(',') && raw.length === displayValue.length + 1 && raw[caret - 1] === '.') {
            raw = raw.slice(0, caret - 1) + ',' + raw.slice(caret);
        }

        const formatted = formatInputString(raw);
        setDisplayValue(formatted);
        emitValue(parseToNumber(formatted));
        restoreCaret(countSignificant(raw.slice(0, caret)));
    };

    const handlePaste = (e) => {
        const text = e.clipboardData?.getData('text');
        const el = e.target;
        const replacesAll = !el.value || (el.selectionStart === 0 && el.selectionEnd === el.value.length);
        if (text && replacesAll) {
            const parsed = parseFlexibleNumber(text);
            if (parsed !== null) {
                e.preventDefault();
                const num = decimals ? Math.round(parsed * 100) / 100 : Math.round(parsed);
                setDisplayValue(formatValue(num));
                emitValue(num);
            }
        }
        if (onPaste) onPaste(e);
    };

    const handleFocus = (e) => {
        setIsFocused(true);
        if (onFocus) onFocus(e);
    };

    const handleBlur = (e) => {
        setIsFocused(false);
        // Beim Verlassen hübsch machen (z.B. 1000,5 -> 1.000,50); leeres Feld bleibt leer
        const num = parseToNumber(displayValue);
        setDisplayValue(num === null ? '' : formatValue(num));
        if (onBlur) onBlur(e);
    };

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
            <input
                inputMode={decimals ? "decimal" : "numeric"}
                {...rest}
                id={inputId}
                ref={inputRef}
                type="text"
                value={displayValue}
                onChange={handleChange}
                onPaste={handlePaste}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={placeholder}
                style={{
                    width: '100%',
                    // padding: handled by global CSS
                    // border: handled by global CSS
                    fontSize: '0.9rem',
                    outline: 'none',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    ...style
                }}
            />
        </div>
    );
};

export default CurrencyInput;
