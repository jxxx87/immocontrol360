import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import { Plus, Printer, Edit2, Download, Loader2, Search, X, FileText, MoreVertical } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import { useAuth } from '../context/AuthContext';

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const fmt = (v) => r2(v).toFixed(2).replace('.', ',');

const ActionMenu = ({ onEdit, onPrint, onPDF, onCredit }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = React.useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div style={{ position: 'relative' }} ref={menuRef}>
            <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} />
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    backgroundColor: 'var(--surface-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    zIndex: 50,
                    minWidth: '160px',
                    overflow: 'hidden'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', padding: '4px' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); onEdit(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 12px', width: '100%', textAlign: 'left',
                                border: 'none', background: 'none', cursor: 'pointer',
                                fontSize: '0.875rem', color: 'var(--text-primary)',
                                borderRadius: '4px', transition: 'background 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Edit2 size={16} /> Bearbeiten
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); onPrint(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 12px', width: '100%', textAlign: 'left',
                                border: 'none', background: 'none', cursor: 'pointer',
                                fontSize: '0.875rem', color: 'var(--text-primary)',
                                borderRadius: '4px', transition: 'background 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Printer size={16} /> Drucken
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); onPDF(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 12px', width: '100%', textAlign: 'left',
                                border: 'none', background: 'none', cursor: 'pointer',
                                fontSize: '0.875rem', color: 'var(--text-primary)',
                                borderRadius: '4px', transition: 'background 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Download size={16} /> Download PDF
                        </button>
                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); onCredit(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 12px', width: '100%', textAlign: 'left',
                                border: 'none', background: 'none', cursor: 'pointer',
                                fontSize: '0.875rem', color: 'var(--text-primary)',
                                borderRadius: '4px', transition: 'background 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <FileText size={16} /> Gutschreiben
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const Invoices = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID, portfolios } = usePortfolio();
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

        // Helper to construct filename
        const isCredit = invoice.status === 'credited';
        const originalInvoiceNum = invoice.invoice_number || 'ENTWURF';
        const displayNum = isCredit ? `GS-${originalInvoiceNum}` : originalInvoiceNum;
        const filename = `${isCredit ? 'Gutschrift' : 'Rechnung'}_${displayNum}`;

        win.document.open();
        win.document.write(html);

        // Inject script to set title for print dialog
        const script = win.document.createElement('script');
        script.textContent = `document.title = "${filename}";`;
        win.document.head.appendChild(script);

        win.document.close();
        setTimeout(() => {
            win.focus();
            win.print();
        }, 800);
    };

    const handleCredit = async (invoice) => {
        if (!window.confirm('Möchten Sie eine Gutschrift für diese Rechnung erstellen? Der Status wird auf "Gutschrift" gesetzt.')) return;

        try {
            const { error } = await supabase
                .from('invoices')
                .update({ status: 'credited' })
                .eq('id', invoice.id);

            if (error) throw error;

            setInvoices(prev => prev.map(inv => inv.id === invoice.id ? { ...inv, status: 'credited' } : inv));
            handlePDF(invoice, true);
        } catch (error) {
            console.error('Error crediting invoice:', error);
            alert('Fehler: ' + error.message);
        }
    };

    const handlePDF = async (invoice, isCredit = false) => {
        try {
            // Lazy load jsPDF
            if (!window.jspdf) {
                await new Promise((resolve) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                    script.onload = resolve;
                    document.head.appendChild(script);
                });
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            // --- DATA PREPARATION ---
            const portfolio = portfolios.find(p => p.id === invoice.portfolio_id);

            const sender = {
                name: invoice.sender_name || portfolio?.company_name || portfolio?.name || "ImmoControl pro 360",
                street: invoice.sender_street || portfolio?.street ? (portfolio?.street + (portfolio?.house_number ? ' ' + portfolio.house_number : '')) : "Musterstraße 1",
                city: invoice.sender_city || portfolio?.zip ? `${portfolio?.zip} ${portfolio?.city}` : "12345 Musterstadt",
                email: portfolio?.email || "info@immocontrol.de",
                phone: portfolio?.phone || "01234 / 567890",
                bank: portfolio?.bank_name || "Musterbank",
                iban: portfolio?.iban || "DE12 3456 7890 1234 5678 90",
                bic: portfolio?.bic || "MUSDEFF",
                tax_number: portfolio?.tax_number || "",
                vat_id: portfolio?.vat_id || ""
            };

            const inv = invoice || {};
            const recipientName = inv.recipient_name || (inv.tenant?.name || 'Unbekannt');
            const recipientAddress = inv.recipient_street ? `${inv.recipient_street}\n${inv.recipient_zip} ${inv.recipient_city}` : (inv.tenant?.address || '');

            const invoiceDate = inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('de-DE') : new Date().toLocaleDateString('de-DE');
            const originalInvoiceNum = inv.invoice_number || 'ENTWURF';
            const displayNum = isCredit ? `GS-${originalInvoiceNum}` : originalInvoiceNum;

            const servicePeriod = inv.move_in && inv.move_out
                ? `${new Date(inv.move_in).toLocaleDateString('de-DE')} - ${new Date(inv.move_out).toLocaleDateString('de-DE')}`
                : (inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('de-DE') : '');

            // --- HELPER: Draw Footer ---
            const drawFooter = (pageNumber) => {
                doc.setPage(pageNumber);
                const footerY = 265;
                doc.setFontSize(8);
                doc.setTextColor(50);
                doc.setFont("helvetica", "normal");

                // Column 1: Address
                doc.text("Anschrift", 25, footerY);
                doc.text(`${sender.name}`, 25, footerY + 4);
                doc.text(`${sender.street}`, 25, footerY + 8);
                doc.text(`${sender.city}`, 25, footerY + 12);

                // Column 2: Contact
                doc.text("Kontakt", 85, footerY);
                doc.text(`Tel: ${sender.phone}`, 85, footerY + 4);
                doc.text(`Email: ${sender.email}`, 85, footerY + 8);

                // Column 3: Bank & Tax
                doc.text("Bankverbindung", 145, footerY);
                doc.text(`${sender.bank}`, 145, footerY + 4);
                doc.text(`IBAN: ${sender.iban}`, 145, footerY + 8);
                doc.text(`BIC: ${sender.bic}`, 145, footerY + 12);
                if (sender.tax_number) {
                    doc.text(`St.-Nr.: ${sender.tax_number}`, 145, footerY + 16);
                }
                if (sender.vat_id) {
                    doc.text(`USt-IdNr.: ${sender.vat_id}`, 145, footerY + 20);
                }

                // Page Number
                // doc.text(`Seite ${pageNumber}`, 190, 290, { align: 'right' }); 
                // (Optional, usually 5008 doesn't strictly require page numbers but nice to have)
            };

            // --- LAYOUT ---
            const leftMargin = 25;
            const rightMargin = 20;
            let y = 45;

            // Sender Line
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(`${sender.name} • ${sender.street} • ${sender.city}`, leftMargin, y);

            // Recipient
            y = 55;
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text(recipientName, leftMargin, y);
            y += 6;
            if (recipientAddress) {
                const addrLines = doc.splitTextToSize(recipientAddress.replace(/<br>/g, '\n'), 85);
                doc.text(addrLines, leftMargin, y);
            }

            // Info Block
            const infoX = 125;
            let infoY = 50;
            doc.setFontSize(10);

            const addInfoRow = (label, value) => {
                doc.text(label, infoX, infoY);
                doc.text(value, infoX + 60, infoY, { align: 'right' });
                infoY += 5;
            };

            addInfoRow(isCredit ? "Gutschrift Nr.:" : "Rechnungsnummer:", displayNum);
            addInfoRow("Datum:", invoiceDate);
            addInfoRow("Leistungszeitraum:", servicePeriod);
            addInfoRow("Anzahl Gäste:", `${inv.persons || 1}`);
            if (inv.customer_id) addInfoRow("Kundennummer:", inv.customer_id);

            // Headline
            y = 105;
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.text(isCredit ? `Gutschrift Nr. ${displayNum}` : `Rechnung Nr. ${displayNum}`, leftMargin, y);

            if (isCredit) {
                y += 6;
                doc.setFontSize(10);
                doc.setFont("helvetica", "normal");
                doc.text(`zur Rechnung Nr. ${originalInvoiceNum}`, leftMargin, y);
            }

            // Intro
            y += 10;
            doc.setFontSize(11);
            doc.setFont("helvetica", "normal");
            doc.text("Sehr geehrte Damen und Herren,", leftMargin, y);
            y += 6;

            if (isCredit) {
                doc.text("wir schreiben Ihnen folgende Leistungen gut:", leftMargin, y);
            } else {
                doc.text("vielen Dank für Ihren Aufenthalt. Wir berechnen Ihnen folgende Leistungen:", leftMargin, y);
            }
            y += 15;

            // Table Header Helper
            const drawTableHeader = (posY) => {
                const col1 = leftMargin;      // Pos
                const col2 = leftMargin + 12; // Desc
                const col3 = 140;             // Price/Night
                const col4 = 160;             // Net
                const col5 = 175;             // VAT
                const col6 = 190;             // Gross

                doc.setDrawColor(0);
                doc.setLineWidth(0.2);
                doc.line(leftMargin, posY, 210 - rightMargin, posY);

                let hY = posY + 5;
                doc.setFontSize(10);
                doc.setFont("helvetica", "bold");
                doc.text("Pos.", col1, hY);
                doc.text("Bezeichnung", col2, hY);
                doc.text("Einzel", col3, hY, { align: 'right' });
                doc.text("Netto", col4, hY, { align: 'right' });
                doc.text("MwSt", col5, hY, { align: 'right' });
                doc.text("Brutto", col6, hY, { align: 'right' });

                hY += 2;
                doc.line(leftMargin, hY, 210 - rightMargin, hY);

                return hY + 6; // Return new Y
            };

            y = drawTableHeader(y);

            // Items
            doc.setFont("helvetica", "normal");

            const col1 = leftMargin;
            const col2 = leftMargin + 12;
            const col3 = 140;
            const col4 = 160;
            const col5 = 175;
            const col6 = 190;

            (inv.positions || []).forEach((item) => {
                const descText = item.description || '';
                const descLines = doc.splitTextToSize(descText, 85);
                const lineHeight = descLines.length * 5;

                if (y + lineHeight > 240) {
                    doc.addPage();
                    y = 30;
                    y = drawTableHeader(y); // Repeat header on new page
                    doc.setFont("helvetica", "normal"); // Reset font
                }

                doc.text(`${item.pos}`, col1, y);
                doc.text(descLines, col2, y);
                doc.text(item.isFirst ? fmt(item.pricePerNight) + ' €' : '', col3, y, { align: 'right' });
                doc.text(fmt(item.netTotal) + " €", col4, y, { align: 'right' });
                doc.text("7%", col5, y, { align: 'right' });
                doc.text(fmt(item.grossTotal) + " €", col6, y, { align: 'right' });

                y += Math.max(6, lineHeight + 2);
            });

            // Totals
            if (y + 40 > 240) {
                doc.addPage();
                y = 30;
            } else {
                y += 5;
            }

            // Totals Box
            const totalsX = 140;
            const totalsValX = 190;

            doc.text("Summe Netto:", totalsX, y);
            doc.text(fmt(inv.net_amount || 0) + " €", totalsValX, y, { align: 'right' });
            y += 5;

            doc.text("zzgl. 7% MwSt:", totalsX, y);
            doc.text(fmt(inv.vat_amount || 0) + " €", totalsValX, y, { align: 'right' });
            y += 2;

            doc.line(totalsX, y, 210 - rightMargin, y);
            y += 6;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text(isCredit ? "Gutschriftsbetrag:" : "Gesamtbetrag:", totalsX, y);
            doc.text(fmt(inv.gross_amount || 0) + " €", totalsValX, y, { align: 'right' });
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);

            // Footer Instructions
            y += 20;
            if (y > 250) { doc.addPage(); y = 30; }

            if (isCredit) {
                doc.text("Der Betrag wird Ihrem Konto gutgeschrieben.", leftMargin, y);
            } else {
                doc.text("Bitte überweisen Sie den Gesamtbetrag sofort und ohne Abzug auf das unten genannte Konto.", leftMargin, y);
            }

            // Draw Footer on ALL pages
            const pageCount = doc.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                drawFooter(i);
            }

            // Construct Filename with name
            const safeName = recipientName.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim().replace(/\s+/g, '_');
            const filename = `${isCredit ? 'Gutschrift' : 'Rechnung'}_${displayNum}_${safeName}.pdf`;

            doc.save(filename);

        } catch (error) {
            console.error(error);
            alert('PDF Fehler: ' + error.message);
        }
    };

    const generateInvoiceHTML = (inv) => {
        const portfolio = portfolios.find(p => p.id === inv.portfolio_id);

        const sender = {
            name: inv.sender_name || portfolio?.company_name || portfolio?.name || "ImmoControl pro 360",
            street: inv.sender_street || portfolio?.street ? (portfolio?.street + (portfolio?.house_number ? ' ' + portfolio.house_number : '')) : "Musterstraße 1",
            city: inv.sender_city || portfolio?.zip ? `${portfolio?.zip} ${portfolio?.city}` : "12345 Musterstadt",
            email: portfolio?.email || "info@immocontrol.de",
            phone: portfolio?.phone || "01234 / 567890",
            bank: portfolio?.bank_name || "Musterbank",
            iban: portfolio?.iban || "DE12 3456 7890 1234 5678 90",
            bic: portfolio?.bic || "MUSDEFF",
            tax_number: portfolio?.tax_number || "",
            vat_id: portfolio?.vat_id || ""
        };

        const senderLine = `${sender.name} • ${sender.street} • ${sender.city}`;

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
                table { width: 100%; border-collapse: collapse; margin-bottom: 8mm; }
                thead th { border-bottom: 2px solid #000; text-align: left; padding: 8px 0; font-weight: 700; }
                tbody tr { border-bottom: 1px solid #ddd; }
                tbody td { padding: 8px 0; }

                /* Totals */
                .totals {
                    display: flex;
                    justify-content: flex-end;
                    margin-bottom: 20mm;
                }
                .totals-box { width: 80mm; }
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
                    bottom: 25mm;
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
                <!-- Folding Marks -->
                <div class="mark fold-1"></div>
                <div class="mark center"></div>
                <div class="mark fold-2"></div>

                <!-- Address -->
                <div class="address-zone">
                    <div class="sender-line">${senderLine}</div>
                    <div class="recipient">
                        ${inv.recipient_name || ''}<br>
                        ${inv.recipient_street || ''}<br>
                        ${inv.recipient_zip || ''} ${inv.recipient_city || ''}
                    </div>
                </div>

                <!-- Info Block -->
                <div class="info-block">
                    <div class="info-row"><span>Rechnungs-Nr.</span><span>${inv.invoice_number}</span></div>
                    <div class="info-row"><span>Datum</span><span>${fmtDate(inv.invoice_date)}</span></div>
                    <div class="info-row"><span>Leistungszeitraum</span><span>${inv.move_in ? fmtDate(inv.move_in) : '-'}</span></div>
                    <div class="info-row"><span>bis</span><span>${inv.move_out ? fmtDate(inv.move_out) : '-'}</span></div>
                    <br>
                    <div class="info-row"><span>Anzahl Gäste</span><span>${inv.persons || '-'}</span></div>
                </div>

                <!-- Main Content -->
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
                        Bitte überweisen Sie den Gesamtbetrag sofort und ohne Abzug auf das unten genannte Konto.<br>
                    </div>
                </div>

                <!-- Footer -->
                <div class="footer">
                    <div class="f-col">
                        <h4>Anschrift</h4>
                        <p>${sender.name}<br>${sender.street}<br>${sender.city}</p>
                    </div>
                    <div class="f-col">
                        <h4>Kontakt</h4>
                        <p>Tel: ${sender.phone}<br>Email: ${sender.email}</p>
                    </div>
                    <div class="f-col">
                        <h4>Bankverbindung</h4>
                        <p>${sender.bank}<br>IBAN: ${sender.iban}<br>BIC: ${sender.bic}${sender.tax_number ? '<br>St.-Nr.: ' + sender.tax_number : ''}${sender.vat_id ? '<br>USt-IdNr.: ' + sender.vat_id : ''}</p>
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
            header: 'Objekt / Wohnung',
            accessor: 'unit_id',
            render: (row) => {
                const unit = units.find(u => u.id === row.unit_id);
                const property = properties.find(p => p.id === unit?.property_id);

                if (!unit) return '-';

                return (
                    <div>
                        <div style={{ fontWeight: 500 }}>{unit.unit_name}</div>
                        {property && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{property.street}, {property.city}</div>}
                    </div>
                );
            }
        },
        {
            header: 'Brutto',
            accessor: 'gross_amount',
            align: 'right',
            render: (row) => <span style={{ fontWeight: 600 }}>{fmt(row.gross_amount || 0)} €</span>
        },
        {
            header: 'Aktionen',
            accessor: 'actions',
            align: 'right',
            render: (row) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <ActionMenu
                        onEdit={() => navigate(`/invoices/edit/${row.id}`)}
                        onPrint={() => handlePrint(row)}
                        onPDF={() => handlePDF(row)}
                        onCredit={() => handleCredit(row)}
                    />
                </div>
            )
        }
    ];

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-xl)' }}>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>Rechnungen Fewo</h1>
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
                    <Table
                        columns={columns}
                        data={filteredInvoices}
                        getRowStyle={(row) => row.status === 'credited' ? { color: 'var(--text-secondary)', textDecoration: 'line-through' } : {}}
                    />
                )}
            </Card>
        </div>
    );
};

export default Invoices;
