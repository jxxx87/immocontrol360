/**
 * Translates technical database errors into user-friendly German messages.
 * Zuordnung zuerst über den Fehlercode (Postgres/PostgREST/Supabase-Auth), danach über typische Texte.
 * Unbekannte technische (englische) Meldungen werden nicht roh angezeigt, sondern nur protokolliert;
 * verständliche deutsche Meldungen (z.B. aus Datenbankfunktionen) bleiben unverändert.
 * @param {Error|object|string} error The error object or message.
 * @returns {string} The translated error message.
 */

const GENERIC_MESSAGE = 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.';
const MSG_PERMISSION = 'Sie haben keine Berechtigung, diese Aktion durchzuführen.';
const MSG_NETWORK = 'Verbindungsfehler. Bitte prüfen Sie Ihre Internetverbindung.';
const MSG_SESSION = 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.';
const MSG_DUPLICATE = 'Ein Eintrag mit diesen Daten existiert bereits.';
const MSG_CHECK = 'Ein eingegebener Wert ist ungültig (z.B. negatives Datum oder falsches Format).';
const MSG_FK = 'Die gewählte Verknüpfung (z.B. Immobilie oder Mieter) ist ungültig oder existiert nicht mehr.';
const MSG_FK_IN_USE = 'Der Eintrag kann nicht gelöscht werden, da er noch mit anderen Daten verknüpft ist.';
const MSG_RATE_LIMIT = 'Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut.';
const MSG_TIMEOUT = 'Die Anfrage hat zu lange gedauert. Bitte versuchen Sie es erneut.';
const MSG_SERVER = 'Auf dem Server ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.';

const FIELD_LABELS = {
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

// Supabase-Auth (error.code)
const AUTH_CODE_MESSAGES = {
    invalid_credentials: 'E-Mail-Adresse oder Passwort ist falsch.',
    email_not_confirmed: 'Ihre E-Mail-Adresse ist noch nicht bestätigt. Bitte nutzen Sie den Link in der Bestätigungs-E-Mail.',
    user_already_exists: 'Diese E-Mail-Adresse wird bereits verwendet.',
    email_exists: 'Diese E-Mail-Adresse wird bereits verwendet.',
    identity_already_exists: 'Dieses Konto ist bereits mit einem anderen Benutzer verknüpft.',
    weak_password: 'Das Passwort ist zu schwach. Bitte wählen Sie ein längeres Passwort.',
    same_password: 'Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.',
    email_address_invalid: 'Die E-Mail-Adresse ist ungültig.',
    validation_failed: 'Die Eingaben sind unvollständig oder ungültig.',
    signup_disabled: 'Neue Registrierungen sind derzeit nicht möglich.',
    provider_disabled: 'Diese Anmeldemethode ist derzeit nicht verfügbar.',
    email_provider_disabled: 'Die Anmeldung per E-Mail ist derzeit nicht verfügbar.',
    user_banned: 'Dieses Konto ist gesperrt.',
    otp_expired: 'Der Link oder Code ist abgelaufen. Bitte fordern Sie einen neuen an.',
    flow_state_expired: 'Der Anmeldevorgang ist abgelaufen. Bitte versuchen Sie es erneut.',
    over_email_send_rate_limit: 'Es wurden zu viele E-Mails angefordert. Bitte warten Sie einige Minuten.',
    over_request_rate_limit: MSG_RATE_LIMIT,
    session_expired: MSG_SESSION,
    session_not_found: MSG_SESSION,
    refresh_token_not_found: MSG_SESSION,
    refresh_token_already_used: MSG_SESSION,
    bad_jwt: MSG_SESSION,
    no_authorization: MSG_SESSION,
    reauthentication_needed: 'Bitte melden Sie sich zur Bestätigung erneut an.',
    request_timeout: MSG_TIMEOUT
};

// Postgres (SQLSTATE) und PostgREST
const DB_CODE_MESSAGES = {
    '23505': MSG_DUPLICATE,
    '23514': MSG_CHECK,
    '23P01': 'Der Eintrag überschneidet sich mit einem bestehenden Eintrag.',
    '42501': MSG_PERMISSION,
    '22P02': 'Ein eingegebener Wert hat ein ungültiges Format.',
    '22001': 'Eine Eingabe ist zu lang.',
    '22003': 'Ein Zahlenwert liegt außerhalb des zulässigen Bereichs.',
    '22007': 'Ein Datum oder eine Uhrzeit ist ungültig.',
    '22008': 'Ein Datum oder eine Uhrzeit ist ungültig.',
    '22012': 'Bei der Berechnung ist ein Fehler aufgetreten (Division durch null).',
    '40001': 'Die Daten wurden gleichzeitig geändert. Bitte versuchen Sie es erneut.',
    '40P01': 'Die Daten wurden gleichzeitig geändert. Bitte versuchen Sie es erneut.',
    '57014': MSG_TIMEOUT,
    '53300': 'Der Server ist ausgelastet. Bitte versuchen Sie es in Kürze erneut.',
    'PGRST116': 'Der Eintrag wurde nicht gefunden oder ist nicht mehr verfügbar.',
    'PGRST301': MSG_SESSION,
    'PGRST302': MSG_SESSION
};

// Typische Texte (kleingeschrieben), falls kein Code mitkommt – Reihenfolge = Priorität
const TEXT_RULES = [
    // Berechtigung / RLS
    [['row-level security', 'row level security', 'permission denied', 'not authorized', 'access denied', 'does not belong to the user'], MSG_PERMISSION],
    // Netzwerk (fetch-Fehler der Browser: Chrome, Firefox, Safari, Node)
    [['failed to fetch', 'network request failed', 'networkerror', 'network error', 'load failed', 'fetch failed', 'err_internet_disconnected', 'err_network', 'internet connection appears to be offline', 'failed to send a request to the edge function'], MSG_NETWORK],
    // Sitzung
    [['jwt expired', 'invalid jwt', 'refresh token', 'auth session missing', 'not authenticated'], MSG_SESSION],
    // Anmeldung / Registrierung (ältere Supabase-Versionen ohne Code)
    [['invalid login credentials'], AUTH_CODE_MESSAGES.invalid_credentials],
    [['email not confirmed'], AUTH_CODE_MESSAGES.email_not_confirmed],
    [['user already registered', 'already been registered'], AUTH_CODE_MESSAGES.user_already_exists],
    [['password should be at least', 'password is too weak'], AUTH_CODE_MESSAGES.weak_password],
    [['new password should be different'], AUTH_CODE_MESSAGES.same_password],
    [['unable to validate email address', 'invalid email'], AUTH_CODE_MESSAGES.email_address_invalid],
    [['signups not allowed'], AUTH_CODE_MESSAGES.signup_disabled],
    [['token has expired or is invalid', 'email link is invalid or has expired'], AUTH_CODE_MESSAGES.otp_expired],
    [['email rate limit exceeded', 'for security purposes, you can only request this'], AUTH_CODE_MESSAGES.over_email_send_rate_limit],
    [['rate limit', 'too many requests'], MSG_RATE_LIMIT],
    // Dateiablage (Supabase Storage)
    [['exceeded the maximum allowed size', 'payload too large', 'entity too large'], 'Die Datei ist zu groß.'],
    [['the resource already exists'], 'Eine Datei mit diesem Namen existiert bereits.'],
    [['invalid key'], 'Der Dateiname enthält ungültige Zeichen. Bitte benennen Sie die Datei um.'],
    [['mime type'], 'Dieser Dateityp wird nicht unterstützt.'],
    [['object not found'], 'Die Datei wurde nicht gefunden.'],
    // Edge Functions
    [['edge function returned a non-2xx status code', 'relay error invoking the edge function'], MSG_SERVER],
    // Bekannte englische Meldungen aus Datenbankfunktionen
    [['claim not found'], 'Die Forderung wurde nicht gefunden.'],
    [['posted payments cannot be modified', 'allocations for posted payments cannot be modified'], 'Gebuchte Zahlungen können nicht mehr geändert werden. Bitte nutzen Sie eine Stornierung.'],
    [['original_amount cannot be changed'], 'Der Betrag kann nicht mehr geändert werden, weil bereits Zahlungen gebucht sind. Bitte nutzen Sie eine Stornierung oder neue Positionen.'],
    [['already assigned to an active claim'], 'Diese Miete ist bereits einer aktiven Forderung zugeordnet.'],
    [['sum of allocations', 'allocations must be'], 'Die Aufteilung der Zahlung stimmt nicht mit dem Zahlungsbetrag überein.'],
    [['does not belong to this claim', 'does not match the claim_payment'], 'Die Zuordnung passt nicht zu dieser Forderung.'],
    [['immutable audit log'], 'Der Verlauf ist unveränderlich und kann nicht bearbeitet werden.'],
    // Zeitüberschreitung
    [['statement timeout', 'canceling statement due to', 'timed out', 'timeout'], MSG_TIMEOUT]
];

// Erkennt verständliche deutsche Meldungen (z.B. RAISE EXCEPTION aus eigenen Datenbankfunktionen)
const GERMAN_HINT = /[äöüßÄÖÜ]|\b(bitte|nicht|kein|keine|keinen|wurde|wurden|konnte|konnten|ist|sind|der|die|das|den|dem|und|oder|mit|eine|einen|einer|bereits|fehler|ungültig|vorhanden|gefunden|abgelaufen|betrag|forderung|miete|mieter|zahlung|vertrag|immobilie|einheit)\b/i;
// Erkennt technische englische Meldungen, die Endnutzern nicht roh gezeigt werden sollen
const TECHNICAL_HINT = /\b(the|of|for|does|did|not|cannot|could|failed|invalid|unexpected|undefined|column|relation|function|violates|constraint|syntax|denied|request|exceeded|unauthorized|forbidden|found|exist|exists|allowed|must|error|is|are|was|to|with|null|value|type|missing|unknown|reading)\b/i;

const isDatabaseCode = (code) => /^PGRST\d+$/.test(code) || /^[0-9A-Z]{5}$/.test(code);

// Nur eigene Einträge der Zuordnungstabellen (kein Treffer auf geerbte Namen wie "constructor")
const lookupCode = (map, code) => (code && Object.prototype.hasOwnProperty.call(map, code) ? map[code] : null);

const toRawMessage = (error) => {
    if (typeof error === 'string') return error;
    const candidates = [error.message, error.error_description, error.msg, error.error, error.details];
    const found = candidates.find(c => typeof c === 'string' && c.trim() !== '');
    if (found) return found;
    try {
        return JSON.stringify(error) || '';
    } catch {
        return String(error);
    }
};

const logUntranslated = (error) => {
    // Details nur für die Fehlersuche protokollieren, nicht anzeigen
    console.warn('Nicht übersetzte Fehlermeldung:', error);
};

export const translateError = (error) => {
    if (!error) return 'Ein unbekannter Fehler ist aufgetreten.';

    const rawMessage = toRawMessage(error).trim();
    const message = rawMessage.toLowerCase();
    const code = typeof error === 'object' && error.code != null ? String(error.code) : '';
    const status = typeof error === 'object' ? Number(error.status || error.statusCode) || 0 : 0;

    // 1. Anmeldung (Supabase-Auth-Codes)
    const authMessage = lookupCode(AUTH_CODE_MESSAGES, code);
    if (authMessage) return authMessage;

    // 2. Pflichtfelder (Not Null Violation)
    if (code === '23502' || message.includes('not-null constraint') || message.includes('null value in column')) {
        const match = message.match(/column "([^"]+)"/);
        const column = match ? match[1] : 'einem Pflichtfeld';
        const translatedField = lookupCode(FIELD_LABELS, column) || column;
        return `Bitte füllen Sie das Feld "${translatedField}" aus.`;
    }

    // 3. Fremdschlüssel: beim Löschen = noch verwendet, sonst ungültige Verknüpfung
    if (code === '23503' || message.includes('foreign key constraint')) {
        return message.includes('update or delete on table') ? MSG_FK_IN_USE : MSG_FK;
    }

    // 4. Übrige bekannte Datenbank-Codes
    const dbMessage = lookupCode(DB_CODE_MESSAGES, code);
    if (dbMessage) return dbMessage;

    // 5. Bekannte Texte (auch ohne Code, z.B. eingepackte Fehler oder Storage-Fehler)
    if (message.includes('unique constraint') || message.includes('duplicate key')) return MSG_DUPLICATE;
    if (message.includes('check constraint')) return MSG_CHECK;
    for (const [needles, translation] of TEXT_RULES) {
        if (needles.some(needle => message.includes(needle))) return translation;
    }
    if (error && error.name === 'AbortError') return MSG_TIMEOUT;

    // 6. HTTP-Status (Storage/Edge Functions)
    if (status === 401) return MSG_SESSION;
    if (status === 403) return MSG_PERMISSION;
    if (status === 413) return 'Die Datei ist zu groß.';
    if (status === 429) return MSG_RATE_LIMIT;
    if (status >= 500) return MSG_SERVER;

    // 7. Eigene, verständliche Meldungen (z.B. aus Datenbankfunktionen) unverändert anzeigen
    const isRaisedByApp = code === '' || code === 'P0001';
    if (isRaisedByApp && GERMAN_HINT.test(rawMessage)) return rawMessage;

    // 8. Technische Meldung: allgemeiner Hinweis, Details nur ins Protokoll
    if ((code && code !== 'P0001' && isDatabaseCode(code)) || TECHNICAL_HINT.test(rawMessage) || rawMessage === '' || /^[[{]/.test(rawMessage)) {
        logUntranslated(error);
        return code ? `${GENERIC_MESSAGE} (Fehlercode: ${code})` : GENERIC_MESSAGE;
    }

    return rawMessage;
};
