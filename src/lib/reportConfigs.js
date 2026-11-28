// ─── PDF Report Configurations ──────────────────────────────────────
// Central config for all report types: columns, presets, defaults
// Nur Berichtstypen mit Aufrufer (die nie genutzten 'einheiten', 'kpi', 'offene_mieten' und 'deals' sind entfallen;
// 'bankaufstellung' hängt an der Entscheidung zu generate-report-pdf).

export const REPORT_CONFIGS = {
    immobilien: {
        label: 'Immobilienübersicht',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: false,
        dsgvoRelevant: false,
        extraOptions: [
            { key: 'includeUnits', label: 'Einheiten je Immobilie anzeigen', default: true },
        ],
        sumColumns: ['kaufpreis', 'marktpreis', 'restschuld', 'miete_monat', 'bankrate', 'cashflow_monat'],
        columns: [
            { key: 'adresse', label: 'Straße + Hausnr.', always: true },
            { key: 'einheiten', label: 'Einheiten', compact: true },
            // Schlüssel 'kaufpreis' bleibt (Export-Auswahl), befüllt wird die Gesamtinvestition des Objekts
            { key: 'kaufpreis', label: 'Gesamtinvestition', compact: true, format: 'currency' },
            { key: 'marktpreis', label: 'Marktpreis', compact: true, format: 'currency' },
            { key: 'restschuld', label: 'Restschuld', compact: true, format: 'currency' },
            { key: 'miete_monat', label: 'Miete Ist (Monat)', compact: true, format: 'currency' },
            { key: 'bankrate', label: 'Bankrate (Monat)', compact: true, format: 'currency' },
            // Miete Ist minus Bankrate, ohne Bewirtschaftungskosten
            { key: 'cashflow_monat', label: 'Miete − Bankrate (Monat)', compact: true, format: 'currency' },
            { key: 'wohnflaeche', label: 'Wohnfläche', detail: true, format: 'area' },
            { key: 'leerstand', label: 'Leerstand', detail: true },
            { key: 'ltv', label: 'LTV', detail: true, format: 'percent' },
            { key: 'dscr', label: 'DSCR', detail: true, format: 'decimal' },
        ],
    },
    mietverhaeltnisse: {
        label: 'Mietverhältnisse',
        defaultOrientation: 'portrait',
        sumsEnabled: true,
        groupByProperty: true,
        dsgvoRelevant: true,
        sumColumns: ['kaltmiete', 'warmmiete'],
        dsgvoFields: ['mietername', 'telefon', 'email', 'notizen'],
        columns: [
            { key: 'mietername', label: 'Mieter', always: true, dsgvo: true },
            { key: 'immobilie_einheit', label: 'Immobilie + Einheit', compact: true },
            { key: 'kaltmiete', label: 'Kaltmiete', compact: true, format: 'currency' },
            { key: 'nebenkosten', label: 'Nebenkosten', compact: true, format: 'currency' },
            { key: 'warmmiete', label: 'Warmmiete', compact: true, format: 'currency' },
            { key: 'mietbeginn', label: 'Mietbeginn', compact: true, format: 'date' },
            { key: 'wohnflaeche', label: 'Wohnfläche', detail: true, format: 'area' },
            { key: 'kaution', label: 'Kaution', detail: true, format: 'currency' },
            { key: 'status', label: 'Status', detail: true },
        ],
    },
    bankaufstellung: {
        label: 'Bankaufstellung',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: false,
        // Keine Spalte mit Personenbezug: nur Objektadresse und Kennzahlen wie bei 'immobilien' (Adressen sind auch
        // dort und bei 'mietverhaeltnisse' kein DSGVO-Feld); Mieterliste/Transaktionen werden nicht angehängt (s. u.).
        // Ohne DSGVO-Felder bliebe der Schalter „Namen pseudonymisieren" wirkungslos – daher nicht angeboten.
        // Kommen Spalten mit Namen, IBAN oder Verwendungszweck hinzu: dsgvoRelevant: true und deren Schlüssel hier eintragen.
        dsgvoRelevant: false,
        dsgvoFields: [],
        hasCoverPage: true,
        sumColumns: ['kaufpreis', 'marktpreis', 'restschuld', 'miete_monat', 'bankrate', 'cashflow_monat'],
        // Keine extraOptions: "Mieterliste/Transaktionen anhängen" wurde nie ausgewertet (pdfGenerator.js kennt
        // nur includeUnits) und ist entfallen, damit der Dialog keinen Schalter ohne Wirkung anbietet.
        columns: [
            { key: 'objekt', label: 'Objekt', always: true },
            // Schlüssel 'kaufpreis' bleibt (Export-Auswahl), befüllt wird die Gesamtinvestition des Objekts
            { key: 'kaufpreis', label: 'Gesamtinvestition', compact: true, format: 'currency' },
            { key: 'marktpreis', label: 'Marktpreis', compact: true, format: 'currency' },
            { key: 'restschuld', label: 'Restschuld', compact: true, format: 'currency' },
            { key: 'miete_monat', label: 'Miete Ist (Monat)', compact: true, format: 'currency' },
            { key: 'bankrate', label: 'Bankrate (Monat)', compact: true, format: 'currency' },
            // Miete Ist minus Bankrate, ohne Bewirtschaftungskosten
            { key: 'cashflow_monat', label: 'Miete − Bankrate (Monat)', compact: true, format: 'currency' },
            { key: 'dscr', label: 'DSCR', compact: true, format: 'decimal' },
            { key: 'einheiten', label: 'Einheiten', detail: true },
            { key: 'wohnflaeche', label: 'Wohnfläche', detail: true, format: 'area' },
            { key: 'leerstand', label: 'Leerstand', detail: true },
            { key: 'ltv', label: 'LTV', detail: true, format: 'percent' },
        ],
    },
    buchhaltung: {
        label: 'Buchhaltungsreport',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: true,
        dsgvoRelevant: false,
        sumColumns: ['betrag'],
        // Keine extraOptions: "Einnahmen/Ausgaben getrennt" und ein zweites "Gruppieren nach Immobilie" wurden nie
        // ausgewertet; Gruppieren bietet der Dialog bereits über groupByProperty an.
        // Keine Spalte 'Rechnung': Buchungen haben kein erfasstes Belegfeld, sie wäre immer leer.
        columns: [
            { key: 'datum', label: 'Datum', always: true, format: 'date' },
            { key: 'empfaenger', label: 'Empfänger/Absender', compact: true },
            { key: 'verwendungszweck', label: 'Verwendungszweck', compact: true, maxLen: 40 },
            { key: 'betrag', label: 'Betrag', compact: true, format: 'currency' },
            { key: 'kategorie', label: 'Kategorie', detail: true },
            { key: 'immobilie', label: 'Immobilie', detail: true },
        ],
    },
    finanzierungen: {
        label: 'Finanzierungsübersicht',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: true,
        dsgvoRelevant: false,
        sumColumns: ['darlehensbetrag', 'restschuld', 'rate_monat'],
        columns: [
            { key: 'bank', label: 'Bank / Darlehensgeber', always: true },
            { key: 'immobilie', label: 'Immobilie', compact: true },
            { key: 'darlehensbetrag', label: 'Darlehensbetrag', compact: true, format: 'currency' },
            { key: 'zinssatz', label: 'Zinssatz', compact: true, format: 'percent' },
            { key: 'tilgung', label: 'Anf. Tilgung', compact: true, format: 'percent' },
            { key: 'rate_monat', label: 'Rate (mtl.)', compact: true, format: 'currency' },
            { key: 'restschuld', label: 'Restschuld', compact: true, format: 'currency' },
            { key: 'beginn', label: 'Beginn', detail: true, format: 'date' },
            { key: 'zinsbindung_bis', label: 'Zinsbindung bis', detail: true, format: 'date' },
            { key: 'konto_nr', label: 'Kontonummer', detail: true },
        ],
    },
    deal_kalkulation: {
        label: 'Deal-Kalkulation',
        defaultOrientation: 'portrait',
        sumsEnabled: false,
        groupByProperty: false,
        dsgvoRelevant: false,
        columns: [
            { key: 'position', label: 'Position', always: true },
            { key: 'wert', label: 'Wert', compact: true },
        ],
    },
    sanierung: {
        label: 'Sanierungsprojekte',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: false,
        dsgvoRelevant: false,
        sumColumns: ['budget_soll', 'ist_bezahlt'],
        columns: [
            { key: 'projekt', label: 'Projekt', always: true },
            { key: 'objekt', label: 'Objekt', compact: true },
            { key: 'budget_soll', label: 'Budget Soll', compact: true, format: 'currency' },
            { key: 'ist_bezahlt', label: 'Ist bezahlt', compact: true, format: 'currency' },
            { key: 'fortschritt', label: 'Fortschritt %', compact: true, format: 'percent' },
            { key: 'ziel_enddatum', label: 'Ziel-Enddatum', compact: true, format: 'date' },
            { key: 'offene_aufgaben', label: 'Offene Aufgaben', compact: true },
        ],
    },
    sanierung_rechner: {
        label: 'Sanierungsrechner',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: false,
        dsgvoRelevant: false,
        sumColumns: ['summe'],
        // Positionen steuert die Spaltenauswahl ('positionen'); eine Zusatzoption dafür wurde nie ausgewertet.
        columns: [
            { key: 'gewerk', label: 'Gewerk', always: true },
            { key: 'summe', label: 'Summe', compact: true, format: 'currency' },
            { key: 'positionen', label: 'Positionen', detail: true },
        ],
    },
    mahnwesen: {
        label: 'Mahnwesen & Forderungen',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: false,
        dsgvoRelevant: true,
        sumColumns: ['ursprung', 'offen', 'gebuehren', 'zinsen'],
        dsgvoFields: ['mietername'],
        columns: [
            { key: 'mietername', label: 'Mieter', always: true, dsgvo: true },
            { key: 'immobilie', label: 'Immobilie', compact: true },
            { key: 'ursprung', label: 'Ursprung', compact: true, format: 'currency' },
            { key: 'offen', label: 'Offener Betrag', compact: true, format: 'currency' },
            { key: 'status', label: 'Status', compact: true },
            { key: 'frist', label: 'Zahlungsfrist', compact: true, format: 'date' },
            { key: 'gebuehren', label: 'Mahngebühren', detail: true, format: 'currency' },
            { key: 'zinsen', label: 'Verzugszinsen', detail: true, format: 'currency' },
            { key: 'erstellt_am', label: 'Erstellt am', detail: true, format: 'date' },
        ],
    },
};

// Which columns to include for compact vs. detail presets
export const getColumnsForPreset = (reportType, preset = 'compact') => {
    const config = REPORT_CONFIGS[reportType];
    if (!config) return [];
    return config.columns
        .filter(c => c.always || c[preset] || (preset === 'detail' && (c.compact || c.detail)))
        .map(c => c.key);
};

// Einheitliche Standard-Optionen für Schnell-Export (Dropdown) und Export-Dialog
export const getDefaultExportOptions = (reportType) => {
    const config = REPORT_CONFIGS[reportType];
    const extraOptions = {};
    (config?.extraOptions || []).forEach(o => { extraOptions[o.key] = o.default ?? false; });
    return {
        orientation: 'auto',
        showSums: config?.sumsEnabled ?? false,
        groupByProperty: false,
        dsgvoAnonymize: false,
        extraOptions,
    };
};

// 'YYYY-MM-DD' als lokales Datum lesen (new Date('YYYY-MM-DD') wäre UTC-Mitternacht)
const parseDateValue = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(value);
};

// Lokales Datum 'YYYY-MM-DD' (toISOString wäre UTC -> kurz nach Mitternacht der Vortag)
const localDateStamp = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Format helpers (German locale)
export const formatValue = (value, format) => {
    if (value === null || value === undefined) return '–';
    switch (format) {
        case 'currency':
            return Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
        case 'area':
            return `${Number(value).toLocaleString('de-DE', { minimumFractionDigits: 1 })} m²`;
        case 'percent':
            return `${Number(value * 100).toLocaleString('de-DE', { minimumFractionDigits: 1 })} %`;
        case 'decimal':
            return Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2 });
        case 'date': {
            if (!value) return '–';
            const d = parseDateValue(value);
            return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('de-DE');
        }
        default:
            return String(value);
    }
};

// Generate filename
export const generateFilename = (reportType, portfolioName, propertyName = null) => {
    const config = REPORT_CONFIGS[reportType];
    const label = config?.label || 'Report';
    const shortLabel = label.replace(/übersicht|report/gi, '').trim() || label;
    const objectName = propertyName || portfolioName || 'Export';
    const clean = (s) => String(s || '').replace(/[^a-zA-Z0-9äöüÄÖÜß\-_\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
    const date = localDateStamp();
    return `${clean(shortLabel)}_${clean(objectName)}_${date}.pdf`;
};
