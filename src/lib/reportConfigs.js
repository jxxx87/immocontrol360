// ─── PDF Report Configurations ──────────────────────────────────────
// Central config for all report types: columns, presets, defaults

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
        sumColumns: ['kaufpreis', 'marktpreis', 'restschuld', 'miete_monat', 'cashflow_monat'],
        columns: [
            { key: 'adresse', label: 'Straße + Hausnr.', always: true },
            { key: 'einheiten', label: 'Einheiten', compact: true },
            { key: 'kaufpreis', label: 'Kaufpreis', compact: true, format: 'currency' },
            { key: 'marktpreis', label: 'Marktpreis', compact: true, format: 'currency' },
            { key: 'restschuld', label: 'Restschuld', compact: true, format: 'currency' },
            { key: 'miete_monat', label: 'Miete (Monat)', compact: true, format: 'currency' },
            { key: 'cashflow_monat', label: 'Cashflow (Monat)', compact: true, format: 'currency' },
            { key: 'wohnflaeche', label: 'Wohnfläche', detail: true, format: 'area' },
            { key: 'leerstand', label: 'Leerstand', detail: true },
            { key: 'ltv', label: 'LTV', detail: true, format: 'percent' },
            { key: 'dscr', label: 'DSCR', detail: true, format: 'decimal' },
        ],
    },
    einheiten: {
        label: 'Einheitenübersicht',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: true,
        dsgvoRelevant: false,
        sumColumns: ['flaeche', 'kaltmiete_soll'],
        columns: [
            { key: 'immobilie', label: 'Immobilie', always: true },
            { key: 'einheit', label: 'Einheit', always: true },
            { key: 'etage', label: 'Etage', compact: true },
            { key: 'flaeche', label: 'Fläche (m²)', compact: true, format: 'area' },
            { key: 'zimmer', label: 'Zimmer', compact: true },
            { key: 'kaltmiete_soll', label: 'Kaltmiete Soll', compact: true, format: 'currency' },
            { key: 'status', label: 'Status', compact: true },
            { key: 'balkon', label: 'Balkon', detail: true },
            { key: 'einbaukueche', label: 'Einbauküche', detail: true },
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
            { key: 'zahlstatus', label: 'Zahlstatus', detail: true },
        ],
    },
    kpi: {
        label: 'KPI Summary',
        defaultOrientation: 'portrait',
        sumsEnabled: false,
        groupByProperty: false,
        dsgvoRelevant: false,
        singlePage: true,
        columns: [
            { key: 'mieteinnahmen_monat', label: 'Mieteinnahmen (Monat)', compact: true, format: 'currency' },
            { key: 'cashflow_monat', label: 'Cashflow (Monat)', compact: true, format: 'currency' },
            { key: 'restschuld_gesamt', label: 'Restschuld gesamt', compact: true, format: 'currency' },
            { key: 'dscr_avg', label: 'DSCR Ø', compact: true, format: 'decimal' },
            { key: 'ltv_avg', label: 'LTV Ø', compact: true, format: 'percent' },
            { key: 'leerstand_pct', label: 'Leerstand %', compact: true, format: 'percent' },
            { key: 'chart_cashflow', label: 'Cashflow Verlauf (Chart)', detail: true, isChart: true },
            { key: 'chart_miete', label: 'Miete Verlauf (Chart)', detail: true, isChart: true },
        ],
    },
    bankaufstellung: {
        label: 'Bankaufstellung',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: false,
        dsgvoRelevant: true,
        hasCoverPage: true,
        sumColumns: ['kaufpreis', 'marktpreis', 'restschuld', 'miete_monat', 'cashflow_monat'],
        extraOptions: [
            { key: 'mieterliste_anhaengen', label: 'Mieterliste anonymisiert anhängen', default: false },
            { key: 'transaktionen_anhaengen', label: 'Transaktionen anhängen', default: false },
        ],
        columns: [
            { key: 'objekt', label: 'Objekt', always: true },
            { key: 'kaufpreis', label: 'Kaufpreis', compact: true, format: 'currency' },
            { key: 'marktpreis', label: 'Marktpreis', compact: true, format: 'currency' },
            { key: 'restschuld', label: 'Restschuld', compact: true, format: 'currency' },
            { key: 'miete_monat', label: 'Miete (Monat)', compact: true, format: 'currency' },
            { key: 'cashflow_monat', label: 'Cashflow (Monat)', compact: true, format: 'currency' },
            { key: 'dscr', label: 'DSCR', compact: true, format: 'decimal' },
            { key: 'einheiten', label: 'Einheiten', detail: true },
            { key: 'wohnflaeche', label: 'Wohnfläche', detail: true, format: 'area' },
            { key: 'leerstand', label: 'Leerstand', detail: true },
            { key: 'ltv', label: 'LTV', detail: true, format: 'percent' },
        ],
    },
    offene_mieten: {
        label: 'Offene Mieten',
        defaultOrientation: 'portrait',
        sumsEnabled: true,
        groupByProperty: true,
        dsgvoRelevant: true,
        sumColumns: ['offen_gesamt'],
        dsgvoFields: ['mieter'],
        columns: [
            { key: 'mieter', label: 'Mieter', always: true, dsgvo: true },
            { key: 'immobilie_einheit', label: 'Immobilie + Einheit', compact: true },
            { key: 'offen_gesamt', label: 'Offen gesamt', compact: true, format: 'currency' },
            { key: 'aeltester_monat', label: 'Ältester offener Monat', compact: true },
            { key: 'offene_monate', label: 'Offene Monate', compact: true },
            { key: 'letzte_zahlung', label: 'Letzte Zahlung', compact: true },
            { key: 'warmmiete', label: 'Warmmiete (Monat)', detail: true, format: 'currency' },
        ],
    },
    buchhaltung: {
        label: 'Buchhaltungsreport',
        defaultOrientation: 'landscape',
        sumsEnabled: true,
        groupByProperty: true,
        dsgvoRelevant: false,
        sumColumns: ['betrag'],
        extraOptions: [
            { key: 'einnahmen_ausgaben_trennen', label: 'Einnahmen/Ausgaben getrennt', default: true },
            { key: 'nach_immobilie_gruppieren', label: 'Gruppieren nach Immobilie', default: false },
        ],
        columns: [
            { key: 'datum', label: 'Datum', always: true, format: 'date' },
            { key: 'empfaenger', label: 'Empfänger/Absender', compact: true },
            { key: 'verwendungszweck', label: 'Verwendungszweck', compact: true, maxLen: 40 },
            { key: 'betrag', label: 'Betrag', compact: true, format: 'currency' },
            { key: 'kategorie', label: 'Kategorie', detail: true },
            { key: 'immobilie', label: 'Immobilie', detail: true },
            { key: 'rechnung', label: 'Rechnung', detail: true },
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
    deals: {
        label: 'Deal-Übersicht',
        defaultOrientation: 'landscape',
        sumsEnabled: false,
        groupByProperty: false,
        dsgvoRelevant: false,
        columns: [
            { key: 'dealname', label: 'Dealname', always: true },
            { key: 'kaufpreis', label: 'Kaufpreis', compact: true, format: 'currency' },
            { key: 'ek', label: 'EK', compact: true, format: 'currency' },
            { key: 'rendite', label: 'Rendite', compact: true, format: 'percent' },
            { key: 'cashflow', label: 'Cashflow', compact: true, format: 'currency' },
            { key: 'dscr', label: 'DSCR', compact: true, format: 'decimal' },
            { key: 'status', label: 'Status', compact: true },
            { key: 'sanierungsbudget', label: 'Sanierungsbudget', detail: true, format: 'currency' },
            { key: 'exit_preis', label: 'Exit-Preis', detail: true, format: 'currency' },
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
        extraOptions: [
            { key: 'positionen_anzeigen', label: 'Positionen anzeigen', default: false },
        ],
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
        case 'date':
            if (!value) return '–';
            return new Date(value).toLocaleDateString('de-DE');
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
    const clean = (s) => s.replace(/[^a-zA-Z0-9äöüÄÖÜß\-_\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
    const date = new Date().toISOString().split('T')[0];
    return `${clean(shortLabel)}_${clean(objectName)}_${date}.pdf`;
};
