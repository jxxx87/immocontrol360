export const properties = [
    {
        id: 1,
        name: 'Wohnanlage Nord',
        address: 'Musterstraße 123, 10115 Berlin',
        type: 'Wohnen',
        units: 12,
        area: '850 m²',
        year: 1995,
        imageUrl: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=60'
    },
    {
        id: 2,
        name: 'Gewerbezentrum Süd',
        address: 'Industrieweg 45, 80331 München',
        type: 'Gewerbe',
        units: 5,
        area: '1.200 m²',
        year: 2010,
        imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=60'
    },
    {
        id: 3,
        name: 'Mehrfamilienhaus Lindenpark',
        address: 'Lindenallee 8, 20095 Hamburg',
        type: 'Wohnen',
        units: 8,
        area: '640 m²',
        year: 1988,
        imageUrl: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=60'
    }
];

export const units = [
    { id: 101, propertyId: 1, name: 'Whg 1.01', floor: '1. OG', type: 'Wohnung', size: '75 m²', rooms: 3, status: 'Vermietet', rent: '850 €' },
    { id: 102, propertyId: 1, name: 'Whg 1.02', floor: '1. OG', type: 'Wohnung', size: '68 m²', rooms: 2, status: 'Leerstand', rent: '720 €' },
    { id: 201, propertyId: 2, name: 'Büro A', floor: 'EG', type: 'Gewerbe', size: '150 m²', rooms: 5, status: 'Vermietet', rent: '2.500 €' },
    { id: 301, propertyId: 3, name: 'Whg 3.01', floor: 'DG', type: 'Wohnung', size: '90 m²', rooms: 3, status: 'Vermietet', rent: '1.100 €' },
];

export const tenants = [
    { id: 1, unitId: 101, name: 'Max Mustermann', email: 'max@example.com', phone: '0171-1234567', contractStart: '01.05.2023', rent: '850 €' },
    { id: 2, unitId: 201, name: 'Tech Solutions GmbH', email: 'info@tech-solutions.de', phone: '089-9876543', contractStart: '15.01.2024', rent: '2.500 €' },
];

export const costs = [
    { id: 1, date: '12.02.2026', category: 'Instandhaltung', description: 'Reparatur Heizung', propertyId: 1, amount: '- 450,00 €', status: 'Bezahlt' },
    { id: 2, date: '10.02.2026', category: 'Versicherung', description: 'Gebäudeversicherung Q1', propertyId: 1, amount: '- 1.200,00 €', status: 'Bezahlt' },
    { id: 3, date: '05.02.2026', category: 'Verwaltung', description: 'Hausmeister Service', propertyId: 2, amount: '- 350,00 €', status: 'Offen' },
];

export const payments = [
    { id: 1, date: '03.02.2026', tenant: 'Max Mustermann', unit: 'Whg 1.01', amount: '+ 850,00 €', status: 'Pünktlich' },
    { id: 2, date: '01.02.2026', tenant: 'Tech Solutions GmbH', unit: 'Büro A', amount: '+ 2.500,00 €', status: 'Pünktlich' },
    { id: 3, date: '04.02.2026', tenant: 'Sarah Klein', unit: 'Whg 3.01', amount: '+ 1.100,00 €', status: 'Verspätet' },
];

export const loans = [
    { id: 1, bank: 'Sparkasse', propertyId: 1, amount: '500.000 €', interest: '3,5 %', rate: '2.100 €', remaining: '425.000 €', end: '2030' },
    { id: 2, bank: 'Volksbank', propertyId: 2, amount: '1.200.000 €', interest: '2,8 %', rate: '4.500 €', remaining: '980.000 €', end: '2032' },
];

export const invoices = [
    { id: 'RE-2023-001', date: '01.02.2026', recipient: 'Max Mustermann', amount: '850,00 €', status: 'Versendet', type: 'Miete' },
    { id: 'RE-2023-002', date: '01.02.2026', recipient: 'Tech Solutions GmbH', amount: '2.500,00 €', status: 'Bezahlt', type: 'Miete' },
    { id: 'RE-2023-003', date: '28.01.2026', recipient: 'Sarah Klein', amount: '120,50 €', status: 'Entwurf', type: 'Nebenkosten' },
];

export const meters = [
    { id: 1, type: 'Strom', number: '12345678', propertyId: 1, unitId: 101, lastReading: '45.230 kWh', lastDate: '31.12.2025', nextDate: '31.12.2026' },
    { id: 2, type: 'Wasser', number: '87654321', propertyId: 1, unitId: 101, lastReading: '1.240 m³', lastDate: '31.12.2025', nextDate: '31.12.2026' },
    { id: 3, type: 'Gas', number: '11223344', propertyId: 1, unitId: null, lastReading: '12.500 m³', lastDate: '31.12.2025', nextDate: '31.12.2026' },
];

export const contacts = [
    { id: 1, name: 'Sanitär Meyer', category: 'Handwerker', phone: '030-123456', email: 'info@meyer-sanitaer.de', address: 'Handwerkerstr. 1, Berlin' },
    { id: 2, name: 'Elektro Müller', category: 'Handwerker', phone: '030-987654', email: 'kontakt@elektro-mueller.de', address: 'Stromweg 5, Berlin' },
    { id: 3, name: 'Hausverwaltung Schmidt', category: 'Verwaltung', phone: '089-112233', email: 'service@hv-schmidt.de', address: 'Verwaltungsallee 10, München' },
];

export const documents = [
    { id: 1, name: 'Mietvertrag_Mustermann.pdf', type: 'Vertrag', date: '01.05.2023', size: '2.4 MB' },
    { id: 2, name: 'Versicherungspolice_2026.pdf', type: 'Versicherung', date: '02.01.2026', size: '1.1 MB' },
    { id: 3, name: 'Grundriss_Whg_1.01.jpg', type: 'Plan', date: '15.03.2015', size: '4.5 MB' },
    { id: 4, name: 'Ableseprotokoll_2025.pdf', type: 'Protokoll', date: '31.12.2025', size: '0.8 MB' },
];
