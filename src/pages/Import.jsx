import React, { useState, useRef } from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Loader2, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import { useSubscription } from '../context/SubscriptionContext';
import { fetchAllRows } from '../lib/rentArrears';

// --- Vorlage ---
const TEMPLATE_MARKER = 'ImmoControlpro360';
const HEADER_ROW_INDEX = 4; // Excel-Zeile 5
const DATA_ROW_INDEX = 5;   // ab Excel-Zeile 6
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 5000;
const INSERT_CHUNK = 200;
const FAR_FUTURE = '9999-12-31';
// Der Import läuft in EINER Datenbanktransaktion (import_rows, höchstens 60 s). Grobe Laufzeit je
// Datensatz inkl. Trigger (gemessen 11/2026, mit Reserve): Vertrag erzeugt zusätzlich je Monat ab
// Mietbeginn eine Sollstellung. Größere Dateien werden vorab abgelehnt (aufteilen statt Abbruch).
const IMPORT_COST_MS = { portfolio: 2, property: 2, unit: 2, tenant: 3, lease: 8, ledgerMonth: 0.4 };
const IMPORT_BUDGET_MS = 30000;
const MAX_ROWS_IN_MESSAGE = 10;

// Erwartete Spaltenüberschriften (Präfix, ohne Groß-/Kleinschreibung) laut offizieller Vorlage
const EXPECTED_HEADERS = {
    A: 'Portfolio', B: 'Straße', C: 'Hausnummer', D: 'Postleitzahl', E: 'Stadt', F: 'Baujahr', G: 'Typ',
    H: 'Einheit', I: 'Etage', J: 'Wohnfläche', K: 'Anzahl der Zimmer', L: 'Badezimmer', M: 'Schlafzimmer',
    N: 'Balkon', O: 'Einbauküche', P: 'FEWO', Q: 'Kaltmiete Ist', R: 'Kaltmiete Soll', S: 'Vorname',
    T: 'Nachname', U: 'Telefon', V: 'E-Mail', W: 'Mietbeginn', X: 'Anzahl Bewohner', Y: 'Kaltmiete',
    Z: 'Betriebskosten', AA: 'Heizkosten', AB: 'Sonstige Kosten', AC: 'Kaution', AD: 'Letzte Mieterhöhung'
};
const TENANT_COLUMNS = ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'];

// --- Parser (ohne React-State) ---
const pad2 = (n) => String(n).padStart(2, '0');
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const normText = (v) => (isBlank(v) ? '' : String(v).replace(/\s+/g, ' ').trim());
const keyText = (v) => normText(v).toLowerCase();
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
// 'YYYY-MM-DD' -> 'MM.YYYY'
const formatMonthDE = (value) => (value ? `${value.slice(5, 7)}.${value.slice(0, 4)}` : '');
// 'YYYY-MM-DD' -> 'TT.MM.JJJJ'
const formatDateDE = (value) => (value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '');
// Anzahl Monate Mietkonto von Mietbeginn bis einschließlich des laufenden Monats
const monthsUntilNow = (startDate, now) => {
    if (!startDate) return 0;
    const months = (now.getFullYear() * 12 + now.getMonth()) - (Number(startDate.slice(0, 4)) * 12 + Number(startDate.slice(5, 7)) - 1) + 1;
    return Math.max(0, months);
};

// Zahl aus Excel-Zelle: Zahl bleibt Zahl; Text im deutschen (1.234,56 / 850,50) oder internationalen Format
const parseNumberCell = (val) => {
    if (isBlank(val)) return { value: null };
    if (typeof val === 'number') return Number.isFinite(val) ? { value: val } : { error: true };
    let s = String(val).trim().replace(/\s/g, '').replace(/€|eur/gi, '');
    if (!s) return { value: null };
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d+(,\d+)?$/.test(s)) s = s.replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: true };
    const n = parseFloat(s);
    return Number.isFinite(n) ? { value: n } : { error: true };
};

const validYMD = (y, m, d) => {
    if (!(y >= 1900 && y <= 2100)) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
};

// Datum aus Excel-Zelle -> 'YYYY-MM-DD' (Seriennummer, TT.MM.JJJJ oder JJJJ-MM-TT)
const parseDateCell = (val) => {
    if (isBlank(val)) return { value: null };
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return { error: true };
        const v = validYMD(val.getFullYear(), val.getMonth() + 1, val.getDate());
        return v ? { value: v } : { error: true };
    }
    if (typeof val === 'number') {
        const dc = XLSX.SSF.parse_date_code(val);
        const v = dc ? validYMD(dc.y, dc.m, dc.d) : null;
        return v ? { value: v } : { error: true };
    }
    const s = String(val).trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (m) {
        const v = validYMD(Number(m[3]), Number(m[2]), Number(m[1]));
        return v ? { value: v } : { error: true };
    }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
        const v = validYMD(Number(m[1]), Number(m[2]), Number(m[3]));
        return v ? { value: v } : { error: true };
    }
    return { error: true };
};

const parseBool = (val) => {
    if (isBlank(val)) return false;
    const s = String(val).toLowerCase().trim();
    return s === 'ja' || s === 'true' || s === '1' || s === 'x' || s === 'yes';
};

const PROPERTY_TYPES = {
    residential: ['wohnen', 'wohnung', 'wohnhaus', 'wohngebäude', 'residential', 'mfh', 'efh'],
    commercial: ['gewerbe', 'gewerblich', 'büro', 'commercial'],
    mixed: ['gemischt', 'mischnutzung', 'wohn- und geschäftshaus', 'mixed']
};
const mapPropertyType = (val) => {
    const s = keyText(val);
    if (!s) return { value: 'residential' };
    const found = Object.entries(PROPERTY_TYPES).find(([, names]) => names.includes(s));
    return found ? { value: found[0] } : { value: 'residential', unknown: true };
};

const propertyKeyOf = (street, houseNumber, zip, city) => [street, houseNumber, zip, city].map(keyText).join('|');
const tenantKeyOf = (firstName, lastName, email) =>
    (keyText(email) ? `e:${keyText(email)}|${keyText(lastName)}` : `n:${keyText(firstName)}|${keyText(lastName)}`);

// Eine Excel-Zeile prüfen und normalisieren
const validateRow = (raw, ctx) => {
    const rowNo = (typeof raw.__rowNum__ === 'number' ? raw.__rowNum__ : 0) + 1; // Excel-Zeilennummer
    const errors = [];
    const warnings = [];
    const num = (col, label, { integer = false, min = 0 } = {}) => {
        const r = parseNumberCell(raw[col]);
        if (r.error) { errors.push(`${label} (Spalte ${col}) ist keine gültige Zahl: „${normText(raw[col])}“`); return null; }
        if (r.value === null) return null;
        if (integer && !Number.isInteger(r.value)) { errors.push(`${label} (Spalte ${col}) muss eine ganze Zahl sein.`); return null; }
        if (r.value < min) { errors.push(`${label} (Spalte ${col}) darf nicht kleiner als ${min} sein.`); return null; }
        return r.value;
    };
    const date = (col, label) => {
        const r = parseDateCell(raw[col]);
        if (r.error) { errors.push(`${label} (Spalte ${col}) ist kein gültiges Datum (TT.MM.JJJJ): „${normText(raw[col])}“`); return null; }
        return r.value;
    };

    // Portfolio
    let portfolioName = normText(raw.A);
    let portfolioId = null;
    if (!portfolioName) {
        if (ctx.defaultPortfolio) {
            portfolioId = ctx.defaultPortfolio.id;
            portfolioName = ctx.defaultPortfolio.name;
        } else {
            errors.push('Portfolio fehlt (Spalte A) – bitte angeben oder oben ein Portfolio für Zeilen ohne Angabe wählen.');
        }
    }

    // Immobilie
    const street = normText(raw.B);
    const houseNumber = normText(raw.C);
    let zip = '';
    if (typeof raw.D === 'number') {
        zip = String(Math.trunc(raw.D));
        if (zip.length < 5) {
            const padded = zip.padStart(5, '0');
            warnings.push(`PLZ ${zip} (Zahlenzelle) als ${padded} übernommen.`);
            zip = padded;
        }
    } else {
        zip = normText(raw.D);
    }
    const city = normText(raw.E);
    if (!street) errors.push('Straße fehlt (Spalte B).');
    if (!houseNumber) errors.push('Hausnummer fehlt (Spalte C).');
    if (!zip) errors.push('Postleitzahl fehlt (Spalte D).');
    else if (!/^\d{5}$/.test(zip)) warnings.push(`PLZ „${zip}“ ist keine 5-stellige deutsche Postleitzahl.`);
    if (!city) errors.push('Ort fehlt (Spalte E).');

    const constructionYear = num('F', 'Baujahr', { integer: true, min: 1000 });
    if (constructionYear !== null && constructionYear > 2100) errors.push('Baujahr (Spalte F) ist unplausibel.');
    const type = mapPropertyType(raw.G);
    if (type.unknown) warnings.push(`Typ „${normText(raw.G)}“ (Spalte G) unbekannt – als Wohnen angelegt.`);

    // Einheit
    const unitName = normText(raw.H);
    const unit = unitName ? {
        unit_name: unitName,
        floor: normText(raw.I) || null,
        sqm: num('J', 'Wohnfläche') ?? 0,
        rooms: num('K', 'Anzahl der Zimmer') ?? 0,
        bathrooms: num('L', 'Badezimmer', { integer: true }) ?? 0,
        bedrooms: num('M', 'Schlafzimmer', { integer: true }) ?? 0,
        balcony: parseBool(raw.N),
        fitted_kitchen: parseBool(raw.O),
        is_vacation_rental: parseBool(raw.P),
        cold_rent_ist: num('Q', 'Kaltmiete Ist'),
        target_rent: num('R', 'Kaltmiete Soll') ?? 0
    } : null;

    // Mieter + Mietvertrag
    const hasTenantData = TENANT_COLUMNS.some(col => !isBlank(raw[col]));
    let tenant = null;
    let lease = null;
    if (hasTenantData) {
        const firstName = normText(raw.S);
        const lastName = normText(raw.T);
        const email = normText(raw.V);
        if (!unitName) errors.push('Mieterdaten ohne Einheit (Spalte H).');
        if (!lastName) errors.push('Nachname des Mieters fehlt (Spalte T).');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`E-Mail „${email}“ (Spalte V) ist ungültig.`);
        const startDate = date('W', 'Mietbeginn');
        if (!startDate && isBlank(raw.W)) errors.push('Mietbeginn fehlt (Spalte W).');
        const lastIncrease = date('AD', 'Letzte Mieterhöhung');
        tenant = {
            first_name: firstName || null,
            last_name: lastName,
            email: email || null,
            phone: normText(raw.U) || null,
            occupants: num('X', 'Anzahl Bewohner', { integer: true }),
            key: tenantKeyOf(firstName, lastName, email)
        };
        lease = {
            start_date: startDate,
            cold_rent: round2(num('Y', 'Kaltmiete') ?? 0),
            service_charge: round2(num('Z', 'Betriebskosten') ?? 0),
            heating_cost: round2(num('AA', 'Heizkosten') ?? 0),
            other_costs: round2(num('AB', 'Sonstige Kosten') ?? 0),
            deposit: (() => { const v = num('AC', 'Kaution'); return v === null ? null : round2(v); })(),
            last_rent_increase: lastIncrease
        };
    }

    return {
        rowNo,
        errors,
        warnings,
        portfolioName,
        portfolioId,
        portfolioKey: keyText(portfolioName),
        property: { street, house_number: houseNumber, zip, city, construction_year: constructionYear, property_type: type.value },
        propertyKey: propertyKeyOf(street, houseNumber, zip, city),
        unit,
        tenant,
        lease
    };
};

// Excel-Datei lesen und gegen die Vorlage prüfen
const readWorkbook = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.onabort = () => reject(new Error('Das Lesen der Datei wurde abgebrochen.'));
    reader.onload = (e) => {
        try {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!sheet) throw new Error('Die Datei enthält kein Tabellenblatt.');

            const cellA1 = sheet['A1'] ? normText(sheet['A1'].v) : '';
            if (cellA1 !== TEMPLATE_MARKER) {
                throw new Error(`Zelle A1 enthält „${cellA1}“ statt „${TEMPLATE_MARKER}“. Bitte die offizielle Importvorlage verwenden.`);
            }

            const headerRow = XLSX.utils.sheet_to_json(sheet, { range: HEADER_ROW_INDEX, header: 'A', defval: null })[0] || {};
            const wrong = Object.entries(EXPECTED_HEADERS)
                .filter(([col, title]) => !keyText(headerRow[col]).startsWith(title.toLowerCase()))
                .map(([col, title]) => `${col} („${title}“)`);
            if (wrong.length > 0) {
                throw new Error(`Die Spaltenüberschriften in Zeile 5 passen nicht zur Vorlage: ${wrong.join(', ')}. Bitte Spalten nicht verschieben.`);
            }

            const rows = XLSX.utils.sheet_to_json(sheet, { range: DATA_ROW_INDEX, header: 'A', defval: null })
                .filter(r => Object.values(r).some(v => !isBlank(v)));
            resolve(rows);
        } catch (err) {
            reject(err);
        }
    };
    reader.readAsArrayBuffer(file);
});

// Excel-Zeilen für Fehlermeldungen der Datenbank (gekürzt)
const rowsForMessage = (rowNos) => (rowNos.length > MAX_ROWS_IN_MESSAGE
    ? [...rowNos.slice(0, MAX_ROWS_IN_MESSAGE), '…']
    : rowNos);

// Geprüften Plan in die Form der Datenbankfunktion import_rows bringen:
// vorhandene Datensätze per ID, neu anzulegende per Index (0-basiert) in der jeweiligen Liste.
const buildImportPayload = (plan, bookingStartDate) => {
    const portfolios = [...plan.newPortfolios.entries()];
    const properties = [...plan.newProperties.entries()];
    const units = [...plan.newUnits.entries()];
    const tenants = [...plan.newTenants.entries()];
    const indexByKey = (entries) => new Map(entries.map(([key], i) => [key, i]));
    const portfolioIdx = indexByKey(portfolios);
    const propertyIdx = indexByKey(properties);
    const unitIdx = indexByKey(units);
    const tenantIdx = indexByKey(tenants);
    const ref = (r, idx, idField, idxField) => (r.id ? { [idField]: r.id } : { [idxField]: idx.get(r.key) });

    return {
        portfolios: portfolios.map(([, p]) => ({ name: p.name, rows: rowsForMessage(p.rowNos) })),
        properties: properties.map(([, p]) => ({
            ...ref(p.portfolioRef, portfolioIdx, 'portfolio_id', 'portfolio_idx'),
            ...p.data,
            rows: rowsForMessage(p.rowNos)
        })),
        units: units.map(([, u]) => ({
            ...ref(u.propertyRef, propertyIdx, 'property_id', 'property_idx'),
            ...u.data,
            rows: rowsForMessage(u.rowNos)
        })),
        tenants: tenants.map(([, t]) => ({
            first_name: t.data.first_name,
            last_name: t.data.last_name,
            email: t.data.email,
            phone: t.data.phone,
            occupants: t.data.occupants,
            rows: rowsForMessage(t.rowNos)
        })),
        // Bestandsverträge: Mietkonto ab dem Importmonat (siehe handleExecute)
        leases: plan.newLeases.map(l => ({
            ...ref(l.unitRef, unitIdx, 'unit_id', 'unit_idx'),
            ...ref(l.tenantRef, tenantIdx, 'tenant_id', 'tenant_idx'),
            ...l.data,
            booking_start_date: l.data.start_date && l.data.start_date < bookingStartDate ? bookingStartDate : null,
            rows: [l.rowNo]
        }))
    };
};

// Funktion import_rows noch nicht eingespielt -> bisheriger schrittweiser Import
const isMissingImportRpc = (error) => ['PGRST202', '42883'].includes(String(error?.code || ''));

// Fehler der Datenbankfunktion import_rows: bei einem Datenbankfehler wurde die Transaktion
// vollständig zurückgerollt; ohne Fehlercode (Verbindung/Gateway) ist das Ergebnis unklar.
const describeImportError = (error, status) => {
    const code = String(error?.code || '');
    const message = error?.message || 'Unbekannter Fehler';
    if (code === '57014') {
        return { outcome: 'aborted', text: 'Der Import hat zu lange gedauert und wurde abgebrochen. Bitte die Datei aufteilen (z. B. nach Objekten) und die Teile nacheinander importieren.' };
    }
    if (code === 'PGRST301' || code === 'PGRST303' || status === 401) {
        return { outcome: 'aborted', text: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden und den Import erneut starten.' };
    }
    if (code) return { outcome: 'aborted', text: message };
    if (status === 413) {
        return { outcome: 'aborted', text: 'Die Datenmenge ist für einen Import zu groß. Bitte die Datei aufteilen und die Teile nacheinander importieren.' };
    }
    if (status >= 400 && status < 500) return { outcome: 'aborted', text: message };
    return {
        outcome: 'unknown',
        text: 'Die Verbindung wurde während des Imports unterbrochen. Ob die Daten gespeichert wurden, ist unklar – bitte unter Immobilien und Mieter prüfen, bevor Sie den Import erneut starten.'
    };
};

const Import = () => {
    const { user } = useAuth();
    const { portfolios, selectedPortfolioID, refreshPortfolios } = usePortfolio();
    const { checkGlobalAccess, checkUsageLimit } = useSubscription() || {};
    const fileInputRef = useRef(null);

    const [file, setFile] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState(null); // null | 'analyze' | 'import'
    const [progress, setProgress] = useState('');
    const [logs, setLogs] = useState([]);
    const [plan, setPlan] = useState(null);
    const [importResult, setImportResult] = useState(null);
    // null = noch nicht gewählt -> Vorschlag aus dem gewählten bzw. primären eigenen Portfolio
    const [defaultPortfolioChoice, setDefaultPortfolioChoice] = useState(null);

    const ownPortfolios = (portfolios || []).filter(p => p.user_id === user?.id);
    const suggestedPortfolioId = ownPortfolios.some(p => p.id === selectedPortfolioID)
        ? selectedPortfolioID
        : ((ownPortfolios.find(p => p.is_primary) || ownPortfolios[0])?.id || '');
    const defaultPortfolioId = defaultPortfolioChoice ?? suggestedPortfolioId;

    const addLog = (message, type = 'info') => {
        setLogs(prev => [...prev, { message, type, timestamp: new Date() }]);
    };

    const resetState = () => {
        setLogs([]);
        setPlan(null);
        setImportResult(null);
        setProgress('');
    };

    const validateAndSetFile = (selected) => {
        resetState();
        if (!selected) return;

        if (!selected.name.toLowerCase().endsWith('.xlsx')) {
            addLog('Fehler: Nur .xlsx Dateien sind erlaubt.', 'error');
            return;
        }
        if (selected.size > MAX_FILE_SIZE) {
            addLog(`Fehler: Die Datei ist zu groß (${(selected.size / 1024 / 1024).toFixed(1)} MB, höchstens 5 MB).`, 'error');
            return;
        }

        setFile(selected);
        addLog(`Datei ausgewählt: ${selected.name} (${(selected.size / 1024).toFixed(2)} KB)`, 'info');
    };

    const handleFileSelect = (e) => {
        validateAndSetFile(e.target.files[0]);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        validateAndSetFile(e.dataTransfer.files[0]);
    };

    // --- Schritt 1: prüfen (keine Schreibzugriffe) ---
    const handleAnalyze = async () => {
        if (!file || busy) return;
        if (checkGlobalAccess && !checkGlobalAccess()) {
            addLog('Import nicht möglich: kein aktives Abo bzw. Testzeitraum.', 'error');
            return;
        }
        resetState();
        setBusy('analyze');
        setProgress('Datei wird gelesen und geprüft...');
        try {
            const rawRows = await readWorkbook(file);
            if (rawRows.length === 0) throw new Error('Keine Daten ab Zeile 6 gefunden.');
            if (rawRows.length > MAX_ROWS) throw new Error(`Zu viele Zeilen (${rawRows.length}). Höchstens ${MAX_ROWS} Zeilen pro Import.`);
            addLog(`${rawRows.length} Datenzeile(n) ab Zeile 6 gefunden.`, 'info');

            // Eigene Daten laden (nur Portfolios des eigenen Kontos)
            setProgress('Vorhandene Daten werden abgeglichen...');
            const { data: ownPorts, error: portError } = await supabase.from('portfolios').select('id, name').eq('user_id', user.id);
            if (portError) throw portError;
            const ownPortIds = new Set((ownPorts || []).map(p => p.id));
            const defaultPortfolio = (ownPorts || []).find(p => p.id === defaultPortfolioId) || null;

            const rows = rawRows.map(r => validateRow(r, { defaultPortfolio }));

            const [propRes, unitRes, leaseRes, tenantRes, countRes] = await Promise.all([
                fetchAllRows('properties', 'id, street, house_number, zip, city, portfolio_id'),
                fetchAllRows('units', 'id, property_id, unit_name'),
                fetchAllRows('leases', 'id, unit_id, tenant_id, status, start_date, end_date'),
                fetchAllRows('tenants', 'id, user_id, first_name, last_name, email'),
                supabase.from('units').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
            ]);
            const loadError = [propRes, unitRes, leaseRes, tenantRes, countRes].find(r => r.error)?.error;
            if (loadError) throw loadError;

            const ownProps = (propRes.data || []).filter(p => ownPortIds.has(p.portfolio_id));
            const ownPropIds = new Set(ownProps.map(p => p.id));
            const ownUnits = (unitRes.data || []).filter(u => ownPropIds.has(u.property_id));
            const ownUnitIds = new Set(ownUnits.map(u => u.id));
            const ownLeases = (leaseRes.data || []).filter(l => ownUnitIds.has(l.unit_id));
            const leaseTenantIds = new Set(ownLeases.map(l => l.tenant_id).filter(Boolean));
            const ownTenants = (tenantRes.data || []).filter(t => t.user_id === user.id || leaseTenantIds.has(t.id));

            const portfoliosByKey = new Map();
            (ownPorts || []).forEach(p => {
                const k = keyText(p.name);
                portfoliosByKey.set(k, [...(portfoliosByKey.get(k) || []), p]);
            });
            const propsByKey = new Map();
            ownProps.forEach(p => {
                const k = propertyKeyOf(p.street, p.house_number, p.zip, p.city);
                propsByKey.set(k, [...(propsByKey.get(k) || []), p]);
            });
            const unitsByKey = new Map();
            ownUnits.forEach(u => {
                const k = `${u.property_id}|${keyText(u.unit_name)}`;
                unitsByKey.set(k, [...(unitsByKey.get(k) || []), u]);
            });
            const portfolioName = (id) => (ownPorts || []).find(p => p.id === id)?.name || 'anderes Portfolio';

            const result = {
                rows: rows.length,
                newPortfolios: new Map(),   // key -> { name, rowNos }
                newProperties: new Map(),   // propertyKey -> { data, portfolioRef, rowNos }
                newUnits: new Map(),        // unitKey -> { data, propertyRef, rowNos }
                newTenants: new Map(),      // tenantKey -> { data, rowNos }
                newLeases: [],              // { unitRef, tenantRef, data, rowNo }
                existing: { properties: new Set(), units: new Set(), tenants: new Set() },
                skippedLeases: 0,
                errors: [],
                warnings: []
            };
            const rowError = (rowNo, msg) => result.errors.push({ rowNo, message: msg });
            const rowWarning = (rowNo, msg) => result.warnings.push({ rowNo, message: msg });

            const propPortfolio = new Map(); // propertyKey -> portfolio key/id aus der Datei
            const leasePairs = new Set();
            const leaseRowByUnit = new Map(); // Einheit (id bzw. key) -> Excel-Zeile des neuen Vertrags

            rows.forEach(row => {
                row.errors.forEach(m => rowError(row.rowNo, m));
                row.warnings.forEach(m => rowWarning(row.rowNo, m));
                if (row.errors.length > 0) return;

                // Portfolio
                let portfolioRef;
                if (row.portfolioId) {
                    portfolioRef = { id: row.portfolioId };
                } else {
                    const matches = portfoliosByKey.get(row.portfolioKey) || [];
                    if (matches.length > 1) { rowError(row.rowNo, `Portfolio „${row.portfolioName}“ ist mehrfach vorhanden – bitte eindeutig benennen.`); return; }
                    if (matches.length === 1) portfolioRef = { id: matches[0].id };
                    else {
                        portfolioRef = { key: row.portfolioKey };
                        const np = result.newPortfolios.get(row.portfolioKey) || { name: row.portfolioName, rowNos: [] };
                        np.rowNos.push(row.rowNo);
                        result.newPortfolios.set(row.portfolioKey, np);
                    }
                }
                const portfolioTag = portfolioRef.id || `new:${portfolioRef.key}`;

                // Immobilie
                const prevPortfolio = propPortfolio.get(row.propertyKey);
                if (prevPortfolio && prevPortfolio !== portfolioTag) {
                    rowError(row.rowNo, 'Dieselbe Adresse ist in der Datei verschiedenen Portfolios zugeordnet.');
                    return;
                }
                propPortfolio.set(row.propertyKey, portfolioTag);

                let propertyRef;
                const existingProps = propsByKey.get(row.propertyKey) || [];
                if (existingProps.length > 1) { rowError(row.rowNo, 'Diese Adresse ist bereits mehrfach angelegt – bitte zuerst bereinigen.'); return; }
                if (existingProps.length === 1) {
                    const ep = existingProps[0];
                    if (!portfolioRef.id || ep.portfolio_id !== portfolioRef.id) {
                        rowError(row.rowNo, `Die Immobilie existiert bereits im Portfolio „${portfolioName(ep.portfolio_id)}“ – Zeile passt nicht zum angegebenen Portfolio.`);
                        return;
                    }
                    propertyRef = { id: ep.id };
                    result.existing.properties.add(ep.id);
                } else {
                    propertyRef = { key: row.propertyKey };
                    const np = result.newProperties.get(row.propertyKey);
                    if (np) {
                        np.rowNos.push(row.rowNo);
                    } else {
                        result.newProperties.set(row.propertyKey, { data: row.property, portfolioRef, rowNos: [row.rowNo] });
                    }
                }

                if (!row.unit) return; // Zeile ohne Einheit: nur Immobilie

                // Einheit
                const unitKey = `${propertyRef.id || `new:${propertyRef.key}`}|${keyText(row.unit.unit_name)}`;
                let unitRef;
                const existingUnits = propertyRef.id ? (unitsByKey.get(`${propertyRef.id}|${keyText(row.unit.unit_name)}`) || []) : [];
                if (existingUnits.length > 1) { rowError(row.rowNo, `Einheit „${row.unit.unit_name}“ ist in dieser Immobilie mehrfach vorhanden.`); return; }
                if (existingUnits.length === 1) {
                    unitRef = { id: existingUnits[0].id };
                    if (!result.existing.units.has(existingUnits[0].id)) {
                        rowWarning(row.rowNo, `Einheit „${row.unit.unit_name}“ existiert bereits – Stammdaten werden nicht geändert.`);
                    }
                    result.existing.units.add(existingUnits[0].id);
                } else {
                    unitRef = { key: unitKey };
                    const nu = result.newUnits.get(unitKey);
                    if (nu) nu.rowNos.push(row.rowNo);
                    else result.newUnits.set(unitKey, { data: row.unit, propertyRef, rowNos: [row.rowNo] });
                }

                if (!row.tenant) return;

                // Mieter (Abgleich: E-Mail + Nachname, ohne E-Mail: Vor- + Nachname)
                let tenantRef;
                const email = keyText(row.tenant.email);
                let candidates;
                if (email) {
                    const byEmail = ownTenants.filter(t => keyText(t.email) === email);
                    candidates = byEmail.filter(t => keyText(t.last_name) === keyText(row.tenant.last_name));
                    if (byEmail.length > 0 && candidates.length === 0) {
                        rowError(row.rowNo, `Die E-Mail ${row.tenant.email} gehört bereits zu einem Mieter mit anderem Nachnamen.`);
                        return;
                    }
                } else {
                    candidates = ownTenants.filter(t =>
                        keyText(t.last_name) === keyText(row.tenant.last_name) &&
                        keyText(t.first_name) === keyText(row.tenant.first_name)
                    );
                }
                if (candidates.length > 1) { rowError(row.rowNo, `Mieter „${row.tenant.last_name}“ ist mehrfach vorhanden – Zuordnung nicht eindeutig.`); return; }
                if (candidates.length === 1) {
                    tenantRef = { id: candidates[0].id };
                    if (!result.existing.tenants.has(candidates[0].id)) {
                        rowWarning(row.rowNo, `Vorhandener Mieter „${row.tenant.last_name}“ wird verknüpft${email ? '' : ' (Abgleich nur über den Namen)'}.`);
                    }
                    result.existing.tenants.add(candidates[0].id);
                } else {
                    tenantRef = { key: row.tenant.key };
                    const nt = result.newTenants.get(row.tenant.key);
                    if (nt) {
                        rowWarning(row.rowNo, `Mieter „${row.tenant.last_name}“ steht auch in Zeile ${nt.rowNos[0]} – wird als ein Mieter mit mehreren Verträgen angelegt.`);
                        nt.rowNos.push(row.rowNo);
                    } else {
                        result.newTenants.set(row.tenant.key, { data: row.tenant, rowNos: [row.rowNo] });
                    }
                }

                // Mietvertrag je (Einheit, Mieter)
                const pairKey = `${unitRef.id || unitRef.key}#${tenantRef.id || tenantRef.key}`;
                if (leasePairs.has(pairKey)) {
                    rowWarning(row.rowNo, 'Doppelte Zeile für denselben Mieter in derselben Einheit – Mietvertrag wird nur einmal angelegt.');
                    result.skippedLeases++;
                    return;
                }
                leasePairs.add(pairKey);
                if (unitRef.id) {
                    const activeOnUnit = ownLeases.filter(l => l.unit_id === unitRef.id && l.status === 'active');
                    if (tenantRef.id && activeOnUnit.some(l => l.tenant_id === tenantRef.id)) {
                        rowWarning(row.rowNo, 'Aktiver Mietvertrag für diesen Mieter in dieser Einheit besteht bereits – übersprungen.');
                        result.skippedLeases++;
                        return;
                    }
                    // Keine zweite Belegung im selben Zeitraum – gleiche Regel wie findOverlappingLeases
                    // (leaseRentPeriods.js) und Trigger trg_leases_check_overlap; importierte Verträge sind unbefristet.
                    const overlap = ownLeases.find(l =>
                        l.unit_id === unitRef.id &&
                        !(l.status && l.status !== 'active' && !l.end_date) &&
                        row.lease.start_date <= (l.end_date || FAR_FUTURE)
                    );
                    if (overlap) {
                        rowError(row.rowNo, `Für die Einheit „${row.unit.unit_name}“ besteht ab ${formatDateDE(row.lease.start_date)} bereits ein Mietvertrag (${formatDateDE(overlap.start_date)} – ${overlap.end_date ? formatDateDE(overlap.end_date) : 'unbefristet'}). Bitte zuerst den bestehenden Vertrag beenden oder einen Mietbeginn nach dessen Ende angeben.`);
                        return;
                    }
                }
                const unitTag = unitRef.id || `new:${unitRef.key}`;
                const prevLeaseRow = leaseRowByUnit.get(unitTag);
                if (prevLeaseRow) {
                    rowError(row.rowNo, `Für die Einheit „${row.unit.unit_name}“ steht bereits in Zeile ${prevLeaseRow} ein Mietvertrag – je Einheit kann nur ein laufender Vertrag importiert werden.`);
                    return;
                }
                leaseRowByUnit.set(unitTag, row.rowNo);
                result.newLeases.push({ unitRef, tenantRef, data: row.lease, rowNo: row.rowNo });
            });

            // Tarif-Limit für neue Einheiten
            const existingUnitCount = countRes.count || 0;
            const newUnitCount = result.newUnits.size;
            if (newUnitCount > 0 && checkUsageLimit && !checkUsageLimit(existingUnitCount + newUnitCount - 1)) {
                result.errors.push({ rowNo: null, message: `Das Einheiten-Limit Ihres Tarifs würde überschritten (vorhanden: ${existingUnitCount}, neu: ${newUnitCount}).` });
            }

            // Umfang für einen Import in einer Transaktion
            const now = new Date();
            const ledgerMonths = result.newLeases.reduce((sum, l) => sum + monthsUntilNow(l.data.start_date, now), 0);
            const estimatedMs =
                result.newPortfolios.size * IMPORT_COST_MS.portfolio +
                result.newProperties.size * IMPORT_COST_MS.property +
                newUnitCount * IMPORT_COST_MS.unit +
                result.newTenants.size * IMPORT_COST_MS.tenant +
                result.newLeases.length * IMPORT_COST_MS.lease +
                ledgerMonths * IMPORT_COST_MS.ledgerMonth;
            if (estimatedMs > IMPORT_BUDGET_MS) {
                result.errors.push({
                    rowNo: null,
                    message: `Die Datei ist zu umfangreich, um sie in einem Schritt zu importieren (${newUnitCount} neue Einheiten, ${result.newTenants.size} neue Mieter, ${result.newLeases.length} Mietverträge mit zusammen ${ledgerMonths} Monaten Mietkonto). Bitte die Datei aufteilen (z. B. nach Objekten) und die Teile nacheinander importieren – bereits importierte Objekte, Einheiten und Mieter werden dabei wiedererkannt.`
                });
            }

            result.errors.forEach(e => addLog(`${e.rowNo ? `Zeile ${e.rowNo}: ` : ''}${e.message}`, 'error'));
            result.warnings.forEach(w => addLog(`${w.rowNo ? `Zeile ${w.rowNo}: ` : ''}${w.message}`, 'warning'));
            addLog(
                result.errors.length > 0
                    ? `Prüfung abgeschlossen: ${result.errors.length} Fehler – es wird nichts importiert.`
                    : 'Prüfung abgeschlossen: keine Fehler. Bitte Vorschau kontrollieren und Import ausführen.',
                result.errors.length > 0 ? 'error' : 'success'
            );
            setPlan(result);
        } catch (error) {
            console.error('Import analyze error:', error);
            addLog(`Prüfung fehlgeschlagen: ${error.message || 'Unbekannter Fehler'}`, 'error');
        } finally {
            setBusy(null);
            setProgress('');
        }
    };

    // Tabelle in Blöcken befüllen; scheitert ein Block, werden dessen Zeilen einzeln wiederholt,
    // damit fehlerhafte Excel-Zeilen benannt werden können (ein Block ist atomar).
    const insertRows = async (table, items, selectCols, onError) => {
        const inserted = [];
        for (let i = 0; i < items.length; i += INSERT_CHUNK) {
            const chunk = items.slice(i, i + INSERT_CHUNK);
            const { data, error } = await supabase.from(table).insert(chunk.map(c => c.payload)).select(selectCols);
            if (!error) {
                inserted.push(...(data || []));
                continue;
            }
            for (const item of chunk) {
                const { data: one, error: oneError } = await supabase.from(table).insert([item.payload]).select(selectCols);
                if (oneError) onError(item, oneError);
                else inserted.push(...(one || []));
            }
        }
        return inserted;
    };

    // Bisheriger Weg – nur solange die Datenbankfunktion import_rows noch nicht eingespielt ist:
    // Tabelle für Tabelle ohne gemeinsame Transaktion; scheitern einzelne Datensätze, werden sie
    // gemeldet, der Rest bleibt gespeichert.
    const executeStepwise = async (stats, failed, bookingStartDate) => {
        // 1. Portfolios
        setProgress('Schritt 1/5: Portfolios anlegen...');
        const portfolioIds = new Map();
        const portItems = [...plan.newPortfolios.entries()].map(([key, p]) => ({ key, rowNos: p.rowNos, payload: { user_id: user.id, name: p.name } }));
        const newPorts = await insertRows('portfolios', portItems, 'id, name', (item, err) => failed(item.rowNos, `Portfolio „${item.payload.name}“ konnte nicht angelegt werden: ${err.message}`));
        newPorts.forEach(p => portfolioIds.set(keyText(p.name), p.id));
        stats.portfolios = newPorts.length;
        const resolvePortfolio = (ref) => ref.id || portfolioIds.get(ref.key) || null;

        // 2. Immobilien
        setProgress('Schritt 2/5: Immobilien anlegen...');
        const propertyIds = new Map();
        const propItems = [];
        plan.newProperties.forEach((p, key) => {
            const portfolioId = resolvePortfolio(p.portfolioRef);
            if (!portfolioId) { failed(p.rowNos, 'Immobilie übersprungen, weil das Portfolio nicht angelegt werden konnte.'); return; }
            propItems.push({ key, rowNos: p.rowNos, payload: { user_id: user.id, portfolio_id: portfolioId, ...p.data } });
        });
        const newProps = await insertRows('properties', propItems, 'id, street, house_number, zip, city', (item, err) => failed(item.rowNos, `Immobilie ${item.payload.street} ${item.payload.house_number} konnte nicht angelegt werden: ${err.message}`));
        newProps.forEach(p => propertyIds.set(propertyKeyOf(p.street, p.house_number, p.zip, p.city), p.id));
        stats.properties = newProps.length;
        const resolveProperty = (ref) => ref.id || propertyIds.get(ref.key) || null;

        // 3. Einheiten
        setProgress('Schritt 3/5: Einheiten anlegen...');
        const unitIds = new Map();
        const unitItems = [];
        const unitKeyByPropAndName = new Map();
        plan.newUnits.forEach((u, key) => {
            const propertyId = resolveProperty(u.propertyRef);
            if (!propertyId) { failed(u.rowNos, `Einheit „${u.data.unit_name}“ übersprungen, weil die Immobilie nicht angelegt werden konnte.`); return; }
            unitKeyByPropAndName.set(`${propertyId}|${keyText(u.data.unit_name)}`, key);
            unitItems.push({ key, rowNos: u.rowNos, payload: { user_id: user.id, property_id: propertyId, ...u.data } });
        });
        const newUnits = await insertRows('units', unitItems, 'id, property_id, unit_name', (item, err) => failed(item.rowNos, `Einheit „${item.payload.unit_name}“ konnte nicht angelegt werden: ${err.message}`));
        newUnits.forEach(u => {
            const key = unitKeyByPropAndName.get(`${u.property_id}|${keyText(u.unit_name)}`);
            if (key) unitIds.set(key, u.id);
        });
        stats.units = newUnits.length;

        // 4. Mieter
        setProgress('Schritt 4/5: Mieter anlegen...');
        const tenantIds = new Map();
        const tenantItems = [...plan.newTenants.entries()].map(([key, t]) => {
            const payload = { user_id: user.id, first_name: t.data.first_name, last_name: t.data.last_name, email: t.data.email, phone: t.data.phone, occupants: t.data.occupants };
            return { key, rowNos: t.rowNos, payload };
        });
        const newTenants = await insertRows('tenants', tenantItems, 'id, first_name, last_name, email', (item, err) => failed(item.rowNos, `Mieter ${item.payload.last_name} konnte nicht angelegt werden: ${err.message}`));
        newTenants.forEach(t => tenantIds.set(tenantKeyOf(t.first_name, t.last_name, t.email), t.id));
        stats.tenants = newTenants.length;

        // 5. Mietverträge
        setProgress('Schritt 5/5: Mietverträge anlegen...');
        const leaseItems = [];
        plan.newLeases.forEach(l => {
            const unitId = l.unitRef.id || unitIds.get(l.unitRef.key);
            const tenantId = l.tenantRef.id || tenantIds.get(l.tenantRef.key);
            if (!unitId || !tenantId) {
                failed([l.rowNo], 'Mietvertrag übersprungen, weil Einheit oder Mieter nicht angelegt werden konnte.');
                return;
            }
            const bookingStart = l.data.start_date && l.data.start_date < bookingStartDate ? { booking_start_date: bookingStartDate } : {};
            leaseItems.push({ rowNos: [l.rowNo], payload: { user_id: user.id, tenant_id: tenantId, unit_id: unitId, status: 'active', ...l.data, ...bookingStart } });
        });
        const newLeases = await insertRows('leases', leaseItems, 'id, booking_start_date', (item, err) => failed(item.rowNos, `Mietvertrag konnte nicht angelegt werden: ${err.message}`));
        stats.leases = newLeases.length;
        stats.bookingStart = {
            date: bookingStartDate,
            leases: newLeases.filter(l => l.booking_start_date).length
        };
    };

    // --- Schritt 2: ausführen ---
    // Alles in EINER Datenbanktransaktion (import_rows): scheitert ein Datensatz, wird nichts gespeichert.
    const handleExecute = async () => {
        if (!plan || plan.errors.length > 0 || busy) return;
        if (checkGlobalAccess && !checkGlobalAccess()) {
            addLog('Import nicht möglich: kein aktives Abo bzw. Testzeitraum.', 'error');
            return;
        }
        setBusy('import');
        // outcome: 'done' (gespeichert) | 'stepwise' (bisheriger Weg) | 'aborted' (nichts gespeichert) | 'unknown'
        const stats = { portfolios: 0, properties: 0, units: 0, tenants: 0, leases: 0, errors: [], outcome: 'done' };
        const failed = (rowNos, msg) => {
            stats.errors.push(`${rowNos && rowNos.length ? `Zeile ${rowNos.join(', ')}: ` : ''}${msg}`);
            addLog(`${rowNos && rowNos.length ? `Zeile ${rowNos.join(', ')}: ` : ''}${msg}`, 'error');
        };
        // Bestandsverträge: Das Mietkonto wird ab dem Importmonat geführt. Frühere Monate wurden außerhalb
        // der App abgerechnet und zählen nicht als Rückstand (in den Finanzen einblendbar).
        const importDate = new Date();
        const bookingStartDate = `${importDate.getFullYear()}-${pad2(importDate.getMonth() + 1)}-01`;
        try {
            setProgress('Alle Datensätze werden gemeinsam gespeichert...');
            const { data, error, status } = await supabase.rpc('import_rows', { p_plan: buildImportPayload(plan, bookingStartDate) });
            if (error && isMissingImportRpc(error)) {
                stats.outcome = 'stepwise';
                await executeStepwise(stats, failed, bookingStartDate);
            } else if (error) {
                const described = describeImportError(error, status);
                stats.outcome = described.outcome;
                failed(null, described.text);
            } else {
                stats.portfolios = data?.portfolios || 0;
                stats.properties = data?.properties || 0;
                stats.units = data?.units || 0;
                stats.tenants = data?.tenants || 0;
                stats.leases = data?.leases || 0;
                stats.bookingStart = { date: bookingStartDate, leases: data?.booking_start_leases || 0 };
            }
        } catch (error) {
            console.error('Import Error:', error);
            if (stats.outcome !== 'stepwise') stats.outcome = 'unknown';
            failed(null, `Import abgebrochen: ${error.message || 'Unbekannter Fehler'}`);
        } finally {
            stats.skippedLeases = plan.skippedLeases;
            stats.existing = {
                properties: plan.existing.properties.size,
                units: plan.existing.units.size,
                tenants: plan.existing.tenants.size
            };
            setImportResult(stats);
            if (stats.outcome === 'aborted') {
                addLog('Import abgebrochen – es wurde nichts gespeichert.', 'error');
            } else if (stats.outcome === 'unknown') {
                addLog('Import-Ergebnis unklar – bitte die Daten prüfen, bevor der Import wiederholt wird.', 'error');
            } else {
                addLog(
                    `Import ${stats.errors.length > 0 ? 'mit Fehlern ' : ''}abgeschlossen: ${stats.portfolios} Portfolios, ${stats.properties} Immobilien, ${stats.units} Einheiten, ${stats.tenants} Mieter, ${stats.leases} Mietverträge angelegt.`,
                    stats.errors.length > 0 ? 'error' : 'success'
                );
            }
            if ((stats.portfolios > 0 || stats.outcome === 'unknown') && refreshPortfolios) refreshPortfolios();
            // Datei zurücksetzen, damit derselbe Import nicht versehentlich erneut gestartet wird
            setPlan(null);
            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setBusy(null);
            setProgress('');
        }
    };

    const planSummary = plan ? [
        { label: 'Portfolios', created: plan.newPortfolios.size, existing: null },
        { label: 'Immobilien', created: plan.newProperties.size, existing: plan.existing.properties.size },
        { label: 'Einheiten', created: plan.newUnits.size, existing: plan.existing.units.size },
        { label: 'Mieter', created: plan.newTenants.size, existing: plan.existing.tenants.size },
        { label: 'Mietverträge', created: plan.newLeases.length, existing: null }
    ] : [];

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {busy && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
                }}>
                    <Loader2 size={64} className="animate-spin" style={{ marginBottom: '20px' }} />
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '10px' }}>{busy === 'analyze' ? 'Datei wird geprüft...' : 'Import läuft...'}</h2>
                    <p style={{ fontSize: '1.1rem', marginBottom: '20px' }}>{busy === 'analyze' ? 'Es wird noch nichts gespeichert.' : 'Es kann einen Augenblick dauern, bis alle Objekte angelegt sind. Bitte die Seite nicht schließen.'}</p>
                    <div style={{ fontSize: '1rem', opacity: 0.8 }}>{progress}</div>
                </div>
            )}

            <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Import (XLSX)</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-xl)' }}>
                Hier kannst du Immobilien, Einheiten und Mieter aus der offiziellen ImmoControlpro360-Excelvorlage importieren. Die Datei wird zuerst geprüft; gespeichert wird erst nach deiner Bestätigung.
            </p>

            <Card style={{ padding: 'var(--spacing-xl)', marginBottom: 'var(--spacing-xl)', borderLeft: '4px solid var(--primary-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '20px' }}>
                    <div style={{ flex: '1', minWidth: '280px' }}>
                        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FileSpreadsheet className="text-primary" size={20} />
                            Excel-Vorlage herunterladen
                        </h3>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                            Verwende die offizielle Import-Vorlage, um deine Daten korrekt vorzubereiten. Importiere keine manipulierten Tabellenstrukturen.
                        </p>
                    </div>
                    <div>
                        <a
                            href="/Import_immocontrolpro360_Excelvorlage.xlsx"
                            download="Import_immocontrolpro360_Excelvorlage.xlsx"
                            className="btn btn-secondary btn-md"
                            style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                        >
                            <Download size={18} style={{ marginRight: '0.5rem' }} />
                            Vorlage herunterladen
                        </a>
                    </div>
                </div>
            </Card>

            <Card style={{ padding: 'var(--spacing-xl)' }}>
                <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Portfolio für Zeilen ohne Angabe in Spalte A</label>
                    <select
                        value={defaultPortfolioId}
                        onChange={e => { setDefaultPortfolioChoice(e.target.value); setPlan(null); }}
                        style={{ width: '100%', maxWidth: '420px', padding: '0.6rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface-color)' }}
                    >
                        <option value="">Keines – Spalte A muss ausgefüllt sein</option>
                        {ownPortfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>

                <div
                    style={{
                        border: `2px dashed ${dragging ? 'var(--primary-color)' : 'var(--border-color)'}`,
                        borderRadius: 'var(--radius-lg)',
                        padding: '40px',
                        textAlign: 'center',
                        backgroundColor: dragging ? '#E0F2FE' : 'transparent',
                        transition: 'all 0.2s'
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                >
                    <FileSpreadsheet size={48} style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }} />
                    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <p style={{ fontWeight: 500, marginBottom: '5px' }}>Ziehe deine XLSX-Datei hierher</p>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>oder klicke auf den Button (höchstens 5 MB)</p>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        id="file-upload"
                    />
                    <label htmlFor="file-upload" style={{ display: 'inline-block', cursor: 'pointer' }}>
                        <span className="btn btn-primary btn-md" style={{ display: 'inline-flex', alignItems: 'center' }}>
                            <Upload size={18} style={{ marginRight: '0.5rem' }} />
                            XLSX-Datei auswählen
                        </span>
                    </label>

                    {file && (
                        <div style={{ marginTop: 'var(--spacing-lg)', padding: '10px', backgroundColor: 'var(--background-color)', borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                            <FileSpreadsheet size={16} />
                            <span style={{ fontWeight: 500 }}>{file.name}</span>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                    )}
                </div>

                {file && !plan && (
                    <div style={{ marginTop: 'var(--spacing-xl)', textAlign: 'center' }}>
                        <Button size="lg" onClick={handleAnalyze} disabled={!!busy}>Datei prüfen</Button>
                    </div>
                )}

                {plan && (
                    <div style={{ marginTop: 'var(--spacing-xl)' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '10px' }}>Vorschau ({plan.rows} Zeilen)</h3>
                        <table style={{ width: '100%', maxWidth: '520px', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: '12px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                                    <th style={{ padding: '6px' }}></th>
                                    <th style={{ padding: '6px', textAlign: 'right' }}>neu</th>
                                    <th style={{ padding: '6px', textAlign: 'right' }}>vorhanden</th>
                                </tr>
                            </thead>
                            <tbody>
                                {planSummary.map(s => (
                                    <tr key={s.label} style={{ borderTop: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '6px' }}>{s.label}</td>
                                        <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600 }}>{s.created}</td>
                                        <td style={{ padding: '6px', textAlign: 'right' }}>{s.existing === null ? '–' : s.existing}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {plan.skippedLeases > 0 && (
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>{plan.skippedLeases} Mietvertrag/-verträge werden übersprungen (bestehen bereits oder doppelt in der Datei).</p>
                        )}
                        {plan.errors.length > 0 ? (
                            <div style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid #FCA5A5', backgroundColor: 'rgba(239, 68, 68, 0.06)', color: '#991B1B' }}>
                                <p style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}><AlertTriangle size={16} /> {plan.errors.length} Fehler – es wird nichts importiert.</p>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px', marginTop: '6px', maxHeight: '220px', overflowY: 'auto', fontSize: '0.85rem' }}>
                                    {plan.errors.map((e, i) => <li key={i}>{e.rowNo ? `Zeile ${e.rowNo}: ` : ''}{e.message}</li>)}
                                </ul>
                                <p style={{ fontSize: '0.85rem', marginTop: '8px' }}>Bitte die Datei korrigieren und erneut auswählen.</p>
                            </div>
                        ) : (
                            <>
                                {plan.warnings.length > 0 && (
                                    <div style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid #FCD34D', backgroundColor: 'rgba(245, 158, 11, 0.08)', color: '#92400E', marginBottom: '12px' }}>
                                        <p style={{ fontWeight: 600 }}>{plan.warnings.length} Hinweis(e):</p>
                                        <ul style={{ listStyle: 'disc', paddingLeft: '20px', marginTop: '6px', maxHeight: '200px', overflowY: 'auto', fontSize: '0.85rem' }}>
                                            {plan.warnings.map((w, i) => <li key={i}>{w.rowNo ? `Zeile ${w.rowNo}: ` : ''}{w.message}</li>)}
                                        </ul>
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                    <Button size="lg" onClick={handleExecute} disabled={!!busy}>Import ausführen</Button>
                                    <Button size="lg" variant="secondary" onClick={() => setPlan(null)} disabled={!!busy}>Abbrechen</Button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Card>

            <div style={{ marginTop: 'var(--spacing-xl)' }}>
                {importResult && (
                    <div style={{
                        marginBottom: '20px', padding: '15px', backgroundColor: 'var(--surface-color)', borderRadius: '8px',
                        border: `1px solid ${importResult.errors.length > 0 ? '#F87171' : '#10B981'}`,
                        color: importResult.errors.length > 0 ? '#991B1B' : '#065F46'
                    }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {importResult.errors.length > 0 ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
                            {importResult.outcome === 'aborted'
                                ? 'Import abgebrochen – es wurde nichts gespeichert'
                                : importResult.outcome === 'unknown'
                                    ? 'Import-Ergebnis unklar'
                                    : importResult.errors.length > 0 ? 'Import mit Fehlern abgeschlossen' : 'Import abgeschlossen'}
                        </h3>
                        {importResult.outcome === 'aborted' && (
                            <p style={{ fontSize: '0.9rem' }}>Der Import läuft als Ganzes: Weil ein Datensatz nicht gespeichert werden konnte, wurde nichts übernommen. Bitte die Datei korrigieren und erneut importieren.</p>
                        )}
                        {(importResult.outcome === 'done' || importResult.outcome === 'stepwise') && (
                            <>
                                <p>Neu angelegt:</p>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px', marginTop: '5px' }}>
                                    <li>Portfolios: {importResult.portfolios}</li>
                                    <li>Immobilien: {importResult.properties}</li>
                                    <li>Einheiten: {importResult.units}</li>
                                    <li>Mieter: {importResult.tenants}</li>
                                    <li>Mietverträge: {importResult.leases}</li>
                                </ul>
                                <p style={{ marginTop: '6px', fontSize: '0.85rem' }}>
                                    Bereits vorhanden (unverändert): {importResult.existing.properties} Immobilien, {importResult.existing.units} Einheiten, {importResult.existing.tenants} Mieter
                                    {importResult.skippedLeases > 0 ? `; ${importResult.skippedLeases} Mietverträge übersprungen` : ''}.
                                </p>
                            </>
                        )}
                        {importResult.bookingStart?.leases > 0 && (
                            <p style={{ marginTop: '6px', fontSize: '0.85rem' }}>
                                Mietkonto geführt ab {formatMonthDE(importResult.bookingStart.date)}: Bei {importResult.bookingStart.leases} Mietvertr{importResult.bookingStart.leases !== 1 ? 'ägen' : 'ag'} mit früherem
                                Mietbeginn gelten Monate vor dem Importmonat nicht als Mietrückstand (unter Finanzen einblendbar).
                            </p>
                        )}
                        {importResult.errors.length > 0 && (
                            <div style={{ marginTop: '10px', color: '#B91C1C' }}>
                                <p style={{ fontWeight: 600 }}>{importResult.outcome === 'stepwise' ? 'Nicht importiert:' : 'Fehler:'}</p>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px' }}>
                                    {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </div>
                        )}
                        <div style={{ marginTop: '15px' }}>
                            <Button size="sm" onClick={() => window.location.reload()}>Seite neu laden (Daten aktualisieren)</Button>
                        </div>
                    </div>
                )}

                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--spacing-md)' }}>Import-Log</h3>
                <Card style={{ padding: '0', maxHeight: '300px', overflowY: 'auto', backgroundColor: '#111827', color: '#E5E7EB' }}>
                    {logs.length === 0 ? (
                        <div style={{ padding: '20px', color: '#6B7280', fontStyle: 'italic' }}>Warte auf Import...</div>
                    ) : (
                        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '5px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                            {logs.map((log, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: '10px', color: log.type === 'error' ? '#EF4444' : log.type === 'success' ? '#10B981' : log.type === 'warning' ? '#FBBF24' : '#E5E7EB' }}>
                                    <span style={{ opacity: 0.5 }}>[{log.timestamp.toLocaleTimeString()}]</span>
                                    <span>{log.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default Import;
