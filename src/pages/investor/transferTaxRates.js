/**
 * Grunderwerbsteuersätze je Bundesland (in %), gemeinsame Quelle für die Investor-Rechner.
 *
 * Letzte berücksichtigte Änderungen: Hamburg 5,5 % (seit 01.01.2023), Sachsen 5,5 % (seit 01.01.2023),
 * Thüringen 5,0 % (seit 01.01.2024), Bremen 5,5 % (seit 01.07.2025).
 * Bei Änderungen eines Landes diese Tabelle und das Stand-Datum anpassen.
 */
export const TRANSFER_TAX_RATES_AS_OF = 'Juli 2025';

export const TRANSFER_TAX_RATES = [
    { name: 'Bayern', tax: 3.5 },
    { name: 'Baden-Württemberg', tax: 5.0 },
    { name: 'Niedersachsen', tax: 5.0 },
    { name: 'Rheinland-Pfalz', tax: 5.0 },
    { name: 'Sachsen-Anhalt', tax: 5.0 },
    { name: 'Thüringen', tax: 5.0 },
    { name: 'Bremen', tax: 5.5 },
    { name: 'Hamburg', tax: 5.5 },
    { name: 'Sachsen', tax: 5.5 },
    { name: 'Berlin', tax: 6.0 },
    { name: 'Hessen', tax: 6.0 },
    { name: 'Mecklenburg-Vorpommern', tax: 6.0 },
    { name: 'Brandenburg', tax: 6.5 },
    { name: 'Nordrhein-Westfalen', tax: 6.5 },
    { name: 'Saarland', tax: 6.5 },
    { name: 'Schleswig-Holstein', tax: 6.5 },
];
