/**
 * Translates technical database errors into user-friendly German messages.
 * @param {Error|object|string} error The error object or message.
 * @returns {string} The translated error message.
 */
export const translateError = (error) => {
    if (!error) return 'Ein unbekannter Fehler ist aufgetreten.';

    const message = (error.message || error.details || (typeof error === 'string' ? error : JSON.stringify(error))).toLowerCase();

    // Required fields (Not Null Violation)
    if (message.includes('not-null constraint') || message.includes('null value in column')) {
        // Extract column name if possible
        const match = message.match(/column "([^"]+)"/);
        const column = match ? match[1] : 'einem Pflichtfeld';

        const fieldMap = {
            'amount': 'Betrag',
            'booking_date': 'Buchungsdatum',
            'payee': 'Zahlungsempfänger',
            'property_id': 'Immobilie',
            'unit_id': 'Einheit',
            'name': 'Name',
            'street': 'Straße',
            'city': 'Stadt',
            'zip': 'PLZ',
            'start_date': 'Mietbeginn',
            'cold_rent': 'Kaltmiete',
            'first_name': 'Vorname',
            'last_name': 'Nachname',
            'email': 'E-Mail',
            'phone': 'Telefon',
            'company_name': 'Firmenname',
            'contact_person': 'Ansprechpartner',
            'entity_type': 'Rechtsform',
            'ownership_percent': 'Eigentumsanteil'
        };

        const translatedField = fieldMap[column] || column;
        return `Bitte füllen Sie das Feld "${translatedField}" aus.`;
    }

    // Foreign Key Violation
    if (message.includes('foreign key constraint')) {
        return 'Die gewählte Verknüpfung (z.B. Immobilie oder Mieter) ist ungültig oder existiert nicht mehr.';
    }

    // Unique Violation
    if (message.includes('unique constraint') || message.includes('duplicate key')) {
        return 'Ein Eintrag mit diesen Daten existiert bereits.';
    }

    // Check Constraint
    if (message.includes('check constraint')) {
        return 'Ein eingegebener Wert ist ungültig (z.B. negatives Datum oder falsches Format).';
    }

    // RLS / Policy
    if (message.includes('row-level security') || message.includes('policy')) {
        return 'Sie haben keine Berechtigung, diese Aktion durchzuführen.';
    }

    // Network / Fetch
    if (message.includes('network request failed') || message.includes('fetch')) {
        return 'Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.';
    }

    // Default fallback: Return the technical message if we can't translate it, 
    // but maybe prefix it so user knows it's raw.
    // Or better: generic message + valid detail if safe.
    // For now, return the message but cleaner.
    return `Fehler: ${error.message || message}`;
};
