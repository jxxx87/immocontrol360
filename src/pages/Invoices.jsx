import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import { Plus, Printer, Edit2, Download, Loader2, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const fmt = (v) => r2(v).toFixed(2).replace('.', ',');

const Invoices = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [units, setUnits] = useState([]);
    const [properties, setProperties] = useState([]);

    // Filter State
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo] = useState('');
    const [filterUnit, setFilterUnit] = useState('');
    const [filterSearch, setFilterSearch] = useState('');

    const fetchInvoices = async () => {
        try {
            setLoading(true);
            const [invRes, unitRes, propRes] = await Promise.all([
                supabase
                    .from('invoices')
                    .select(`*, contact:contacts(name)`)
                    .order('invoice_date', { ascending: false }),
                supabase.from('units').select('*').eq('is_vacation_rental', true),
                supabase.from('properties').select('*')
            ]);

            if (invRes.error) throw invRes.error;

            let data = invRes.data || [];
            if (selectedPortfolioID) {
                data = data.filter(i => i.portfolio_id === selectedPortfolioID);
            }

            setInvoices(data);
            setUnits(unitRes.data || []);
            setProperties(propRes.data || []);
        } catch (error) {
            console.error('Error fetching invoices:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchInvoices();
        }
    }, [user, selectedPortfolioID]);

    // ===== FILTERED DATA =====
    const filteredInvoices = useMemo(() => {
        let result = [...invoices];

        if (filterFrom) {
            result = result.filter(i => i.invoice_date >= filterFrom);
        }
        if (filterTo) {
            result = result.filter(i => i.invoice_date <= filterTo);
        }
        if (filterUnit) {
            result = result.filter(i => i.unit_id === filterUnit);
        }
        if (filterSearch) {
            const q = filterSearch.toLowerCase();
            result = result.filter(i => {
                const fields = [
                    i.invoice_number,
                    i.recipient_name,
                    i.sender_name,
                    i.contact?.name,
                    ...(i.positions || []).map(p => p.description)
                ].filter(Boolean).join(' ').toLowerCase();
                return fields.includes(q);
            });
        }

        return result;
    }, [invoices, filterFrom, filterTo, filterUnit, filterSearch]);

    const hasFilters = filterFrom || filterTo || filterUnit || filterSearch;

    const clearFilters = () => {
        setFilterFrom('');
        setFilterTo('');
        setFilterUnit('');
        setFilterSearch('');
    };

    // ===== PRINT =====
    const handlePrint = (invoice) => {
        const html = generateInvoiceHTML(invoice);
        const win = window.open('', '_blank');
        if (!win) {
            alert('Bitte Popups erlauben.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        setTimeout(() => {
            win.focus();
            win.print();
        }, 800);
    };

    // ===== PDF =====
    const handlePDF = async (invoice) => {
        try {
            const html = generateInvoiceHTML(invoice);
            const filename = `Rechnung_${invoice.invoice_number}.pdf`;

            // Use environemnt variable or fallback to localhost
            const apiUrl = import.meta.env.VITE_PDF_API_URL || 'http://localhost:3001/generate-pdf';

            // Call PDF server
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html })
            });

            if (!response.ok) throw new Error('PDF Server Error');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            console.error(error);
            alert('Fehler: PDF Server läuft nicht? (cd server && node server.js)');
        }
    };

    const generateInvoiceHTML = (inv) => {
        const posRows = (inv.positions || []).map(p => `
            <tr>
                <td style="text-align:center;padding:6px 0;vertical-align:top;">${p.pos || ''}</td>
                <td style="text-align:left;padding:6px 10px;word-wrap:break-word;vertical-align:top;">${(p.description || '').replace(/\n/g, '<br>')}</td>
                <td style="text-align:right;padding:6px 0;white-space:nowrap;vertical-align:top;">${p.isFirst ? fmt(p.pricePerNight || 0) + ' €' : ''}</td>
                <td style="text-align:right;padding:6px 0;white-space:nowrap;vertical-align:top;">${fmt((p.netTotal || 0))} €</td>
                <td style="text-align:right;padding:6px 0;vertical-align:top;">7%</td>
                <td style="text-align:right;padding:6px 0;font-weight:bold;white-space:nowrap;vertical-align:top;">${fmt((p.grossTotal || 0))} €</td>
            </tr>
        `).join('');

        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('de-DE') : '–';

        return `<!DOCTYPE html>
        <html lang="de">
        <head>
            <meta charset="UTF-8">
            <title>Rechnung ${inv.invoice_number}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
                
                @page { 
                    size: A4; 
                    margin: 0; 
                }
                
                body { 
                    margin: 0; 
                    padding: 0; 
                    font-family: 'Open Sans', Arial, sans-serif; 
                    font-size: 10pt; 
                    color: #000; 
                    background: #fff;
                    -webkit-print-color-adjust: exact; 
                }
                
                * { box-sizing: border-box; }
                
                .page-container {
                    width: 210mm;
                    height: 296mm; 
                    position: relative;
                    margin: 0 auto;
                    background: white;
                    overflow: hidden;
                }

                /* DIN 5008 Form B Marks */
                .mark { position: absolute; left: 0; width: 5mm; height: 1px; background: #000; }
                .mark.fold-1 { top: 105mm; } 
                .mark.fold-2 { top: 210mm; } 
                .mark.center { top: 148.5mm; width: 10mm; } 
                
                /* Address Zone */
                .address-zone {
                    position: absolute;
                    top: 45mm;
                    left: 20mm;
                    width: 85mm;
                    height: 45mm;
                }
                
                .sender-line {
                    font-size: 7pt;
                    text-decoration: underline;
                    margin-bottom: 2mm;
                    color: #555;
                }
                
                .recipient {
                    font-size: 11pt;
                    line-height: 1.4;
                }

                /* Info Block */
                .info-block {
                    position: absolute;
                    top: 45mm;
                    left: 125mm;
                    right: 20mm;
                    font-size: 10pt;
                }
                
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 3px;
                }
                .info-row span:first-child { color: #555; }
                .info-row span:last-child { font-weight: 600; }

                /* Content Area */
                .content {
                    position: absolute;
                    top: 98mm; 
                    left: 25mm; 
                    right: 20mm;
                }
                
                .doc-title {
                    font-size: 18pt;
                    font-weight: 700;
                    margin-bottom: 8mm;
                }
                
                .intro-text {
                    margin-bottom: 8mm;
                    line-height: 1.4;
                }
                
                /* Table Styles */
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 8mm;
                }
                
                thead th {
                    border-bottom: 2px solid #000;
                    text-align: left;
                    padding: 8px 0;
                    font-weight: 700;
                }
                
                tbody tr {
                    border-bottom: 1px solid #ddd;
                }

                tbody td {
                    padding: 8px 0;
                }

                /* Totals */
                .totals {
                    display: flex;
                    justify-content: flex-end;
                    margin-bottom: 20mm;
                }
                .totals-box {
                    width: 80mm;
                }
                .t-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                .t-row.final { 
                    border-top: 2px solid #000; 
                    padding-top: 4px; 
                    margin-top: 4px; 
                    font-weight: 700; 
                    font-size: 11pt; 
                }

                /* Footer */
                .footer {
                    position: absolute;
                    bottom: 15mm;
                    left: 25mm;
                    right: 20mm;
                    border-top: 1px solid #ccc;
                    padding-top: 3mm;
                    font-size: 7.5pt;
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                    color: #444;
                }
                .f-col h4 { margin: 0 0 2px 0; color: #000; font-size: 8pt; }
                .f-col p { margin: 0; line-height: 1.25; }

                @media print {
                    body, .page-container { margin: 0; box-shadow: none; }
                }
            </style>
        </head>
        <body>
            <div class="page-container">
                <div class="mark fold-1"></div>
                <div class="mark center"></div>
                <div class="mark fold-2"></div>

                <div class="address-zone">
                    <div class="sender-line">${inv.sender_name || ''} • ${inv.sender_street || ''} • ${inv.sender_zip || ''} ${inv.sender_city || ''}</div>
                    <div class="recipient">
                        ${inv.recipient_name || ''}<br>
                        ${inv.recipient_street || ''}<br>
                        ${inv.recipient_zip || ''} ${inv.recipient_city || ''}
                    </div>
                </div>

                <div class="info-block">
                    <div class="info-row"><span>Rechnungs-Nr.</span><span>${inv.invoice_number}</span></div>
                    <div class="info-row"><span>Datum</span><span>${fmtDate(inv.invoice_date)}</span></div>
                    <div class="info-row"><span>Leistungszeitraum</span><span>${inv.move_in ? fmtDate(inv.move_in) : '-'}</span></div>
                    <div class="info-row"><span>bis</span><span>${inv.move_out ? fmtDate(inv.move_out) : '-'}</span></div>
                    <br>
                    <div class="info-row"><span>Anzahl Gäste</span><span>${inv.persons || '-'}</span></div>
                </div>

                <div class="content">
                    <div class="doc-title">Rechnung</div>
                    <div class="intro-text">
                        Sehr geehrte Damen und Herren,<br><br>
                        vielen Dank für Ihren Aufenthalt. Wir berechnen Ihnen folgende Leistungen:
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th style="width: 8%; text-align: center;">Pos.</th>
                                <th style="width: 42%;">Bezeichnung</th>
                                <th style="width: 15%; text-align: right;">Einzelpreis</th>
                                <th style="width: 15%; text-align: right;">Netto</th>
                                <th style="width: 5%; text-align: right;">MwSt</th>
                                <th style="width: 15%; text-align: right;">Brutto</th>
                            </tr>
                        </thead>
                        <tbody>${posRows}</tbody>
                    </table>

                    <div class="totals">
                        <div class="totals-box">
                            <div class="t-row"><span>Summe Netto</span><span>${fmt(inv.net_amount || 0)} €</span></div>
                            <div class="t-row"><span>zzgl. 7% MwSt</span><span>${fmt(inv.vat_amount || 0)} €</span></div>
                            <div class="t-row final"><span>Gesamtbetrag</span><span>${fmt(inv.gross_amount || 0)} €</span></div>
                        </div>
                    </div>

                    <div class="intro-text">
                        Bitte überweisen Sie den Gesamtbetrag innerhalb von 14 Tagen auf das unten genannte Konto.<br>
                        <small style="color:#666;">Es gelten unsere AGB.</small>
                    </div>
                </div>

                <div class="footer">
                    <div class="f-col">
                        <h4>Anschrift</h4>
                        <p>${inv.sender_name || ''}<br>${inv.sender_street || ''}<br>${inv.sender_zip || ''} ${inv.sender_city || ''}</p>
                    </div>
                    <div class="f-col">
                        <h4>Kontakt</h4>
                        <p>Tel: -<br>Email: -<br>Web: -</p>
                    </div>
                    <div class="f-col">
                        <h4>Bankverbindung</h4>
                        <p>Bank: -<br>IBAN: -<br>BIC: -</p>
                    </div>
                </div>
            </div>
        </body>
        </html>`;
    };

    // ===== COLUMNS =====
    const columns = [
        { header: 'Rechnungs-Nr.', accessor: 'invoice_number', render: (row) => <span style={{ fontWeight: 600 }}>{row.invoice_number}</span> },
        {
            header: 'Datum',
            accessor: 'invoice_date',
            render: (row) => row.invoice_date ? new Date(row.invoice_date).toLocaleDateString('de-DE') : '-'
        },
        {
            header: 'Empfänger',
            accessor: 'recipient_name',
            render: (row) => row.recipient_name || row.contact?.name || '-'
        },
        {
            header: 'Brutto',
            accessor: 'gross_amount',
            align: 'right',
            render: (row) => <span style={{ fontWeight: 600 }}>{fmt(row.gross_amount || 0)} €</span>
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => {
                const variants = { 'paid': 'success', 'sent': 'blue', 'draft': 'default', 'canceled': 'danger' };
                const labels = { 'paid': 'Bezahlt', 'sent': 'Versendet', 'draft': 'Entwurf', 'canceled': 'Storniert' };
                return <Badge variant={variants[row.status] || 'default'}>{labels[row.status] || row.status}</Badge>;
            }
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" icon={Edit2} onClick={(e) => { e.stopPropagation(); navigate(`/invoices/edit/${row.id}`); }}>
                        Bearbeiten
                    </Button>
                    <Button variant="ghost" size="sm" icon={Printer} onClick={(e) => { e.stopPropagation(); handlePrint(row); }} />
                    <Button variant="ghost" size="sm" icon={Download} onClick={(e) => { e.stopPropagation(); handlePDF(row); }} />
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Rechnungen</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Erstellen und verwalten Sie Ihre Rechnungen</p>
                </div>
                <Button icon={Plus} onClick={() => navigate('/invoices/new')}>Neue Rechnung</Button>
            </div>

            {/* Filters */}
            <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                        <Input label="Von" type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                        <Input label="Bis" type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 200px', marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500, fontSize: '0.875rem' }}>Objekt</label>
                        <select
                            value={filterUnit}
                            onChange={e => setFilterUnit(e.target.value)}
                            style={{
                                width: '100%', padding: '0.5rem 0.75rem',
                                borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                fontSize: '0.875rem'
                            }}
                        >
                            <option value="">Alle Objekte</option>
                            {units.map(u => {
                                const prop = properties.find(p => p.id === u.property_id);
                                return <option key={u.id} value={u.id}>{u.unit_name}{prop ? ` – ${prop.street}` : ''}</option>;
                            })}
                        </select>
                    </div>
                    <div style={{ flex: '2 1 300px' }}>
                        <Input
                            label="Suche"
                            placeholder="Name, Rechnungsnummer, Objekt..."
                            value={filterSearch}
                            onChange={e => setFilterSearch(e.target.value)}
                        />
                    </div>
                    {hasFilters && (
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>Filter zurücksetzen</Button>
                        </div>
                    )}
                </div>
            </Card>

            {/* Table */}
            <Card>
                {filteredInvoices.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {hasFilters ? 'Keine Rechnungen für die gewählten Filter gefunden.' : 'Keine Rechnungen gefunden.'}
                    </div>
                ) : (
                    <Table columns={columns} data={filteredInvoices} />
                )}
            </Card>
        </div>
    );
};

export default Invoices;
