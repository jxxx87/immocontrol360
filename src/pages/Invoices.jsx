import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
    const contentRef = React.useRef(null);
    const [menuStyle, setMenuStyle] = useState({});

    useEffect(() => {
        const handleClickOutside = (event) => {
            const isOutsideTrigger = menuRef.current && !menuRef.current.contains(event.target);
            const isOutsideContent = contentRef.current && !contentRef.current.contains(event.target);

            if (isOutsideTrigger && isOutsideContent) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            if (menuRef.current) {
                const rect = menuRef.current.getBoundingClientRect();
                setMenuStyle({
                    position: 'fixed',
                    top: `${rect.bottom + 5}px`,
                    left: `${rect.right - 160}px`,
                    zIndex: 9999
                });
            }
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const MenuContent = (
        <div
            ref={contentRef}
            style={{
                ...menuStyle,
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                minWidth: '160px',
                overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
        >
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
    );

    return (
        <div style={{ position: 'relative' }} ref={menuRef}>
            <Button variant="ghost" size="sm" icon={MoreVertical} onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} />
            {isOpen && createPortal(MenuContent, document.body)}
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
    const fetchInvoiceTemplates = async (portfolioId) => {
        const results = {
            invoice_intro: `<p>Sehr geehrte Damen und Herren,</p><p>vielen Dank für Ihren Aufenthalt. Wir berechnen Ihnen vereinbarungsgemäß folgende Leistungen für den Zeitraum vom <span data-id="buchungszeitraum">Leistungszeitraum</span>:</p>`,
            invoice_outro: `<p>Bitte überweisen Sie den Gesamtbetrag sofort und ohne Abzug auf unser unten genanntes Bankkonto. Vielen Dank für Ihren Aufenthalt und wir freuen uns auf Ihren nächsten Besuch.</p>`,
            credit_note_intro: `<p>Sehr geehrte Damen und Herren,</p><p>wir schreiben Ihnen für Ihren Aufenthalt folgende Leistungen gut:</p>`,
            fewo_invoice_template: null,
            fewo_credit_note_template: null
        };

        if (!user) return results;

        try {
            // 1. Fetch 'fewo_invoice'
            let invoiceQuery = supabase
                .from('document_templates')
                .select('content_html')
                .eq('type', 'fewo_invoice');
            if (portfolioId) {
                invoiceQuery = invoiceQuery.eq('portfolio_id', portfolioId);
            } else {
                invoiceQuery = invoiceQuery.eq('user_id', user.id).is('portfolio_id', null);
            }

            let { data: invData } = await invoiceQuery.maybeSingle();

            if (!invData && portfolioId) {
                const { data: globalInv } = await supabase
                    .from('document_templates')
                    .select('content_html')
                    .eq('user_id', user.id)
                    .eq('type', 'fewo_invoice')
                    .is('portfolio_id', null)
                    .maybeSingle();
                if (globalInv) invData = globalInv;
            }

            if (invData?.content_html) {
                results.fewo_invoice_template = invData.content_html;
                const parts = invData.content_html.split(/<span[^>]*data-id="positions_tabelle"[^>]*>.*?<\/span>|<span[^>]*data-id="positions_tabelle"[^>]*>.*?<\/span>|{positions_tabelle}/);
                results.invoice_intro = parts[0] || '';
                results.invoice_outro = parts[1] || '';
            } else {
                // Try old invoice_intro and invoice_outro
                const oldIntroQ = supabase.from('document_templates').select('content_html').eq('type', 'invoice_intro');
                const oldOutroQ = supabase.from('document_templates').select('content_html').eq('type', 'invoice_outro');
                
                const introRes = await (portfolioId 
                    ? oldIntroQ.eq('portfolio_id', portfolioId) 
                    : oldIntroQ.eq('user_id', user.id).is('portfolio_id', null)
                ).maybeSingle();
                const outroRes = await (portfolioId 
                    ? oldOutroQ.eq('portfolio_id', portfolioId) 
                    : oldOutroQ.eq('user_id', user.id).is('portfolio_id', null)
                ).maybeSingle();

                if (introRes.data?.content_html) results.invoice_intro = introRes.data.content_html;
                if (outroRes.data?.content_html) results.invoice_outro = outroRes.data.content_html;
            }


            // 2. Fetch 'fewo_credit_note'
            let cnQuery = supabase
                .from('document_templates')
                .select('content_html')
                .eq('type', 'fewo_credit_note');
            if (portfolioId) {
                cnQuery = cnQuery.eq('portfolio_id', portfolioId);
            } else {
                cnQuery = cnQuery.eq('user_id', user.id).is('portfolio_id', null);
            }

            let { data: cnData } = await cnQuery.maybeSingle();

            if (!cnData && portfolioId) {
                const { data: globalCn } = await supabase
                    .from('document_templates')
                    .select('content_html')
                    .eq('user_id', user.id)
                    .eq('type', 'fewo_credit_note')
                    .is('portfolio_id', null)
                    .maybeSingle();
                if (globalCn) cnData = globalCn;
            }

            if (cnData?.content_html) {
                results.fewo_credit_note_template = cnData.content_html;
                const parts = cnData.content_html.split(/<span[^>]*data-id="positions_tabelle"[^>]*>.*?<\/span>|<span[^>]*data-id="positions_tabelle"[^>]*>.*?<\/span>|{positions_tabelle}/);
                results.credit_note_intro = parts[0] || '';
            } else {
                // Try old credit_note_intro
                const oldCnQ = supabase.from('document_templates').select('content_html').eq('type', 'credit_note_intro');
                const cnRes = await (portfolioId 
                    ? oldCnQ.eq('portfolio_id', portfolioId) 
                    : oldCnQ.eq('user_id', user.id).is('portfolio_id', null)
                ).maybeSingle();
                if (cnRes.data?.content_html) results.credit_note_intro = cnRes.data.content_html;
            }

        } catch (e) {
            console.error('Error fetching invoice writing templates:', e);
        }

        return results;
    };

    // ===== PRINT =====
    const handlePrint = async (invoice) => {
        const writingTemplates = await fetchInvoiceTemplates(invoice.portfolio_id);
        const html = generateInvoiceHTML(invoice, writingTemplates);
        const win = window.open('', '_blank');
        if (!win) {
            alert('Bitte Popups erlauben.');
            return;
        }

        const isCredit = invoice.status === 'credited';
        const originalInvoiceNum = invoice.invoice_number || 'ENTWURF';
        const displayNum = isCredit ? `GS-${originalInvoiceNum}` : originalInvoiceNum;
        const filename = `${isCredit ? 'Gutschrift' : 'Rechnung'}_${displayNum}`;

        win.document.open();
        win.document.write(html);

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
            const writingTemplates = await fetchInvoiceTemplates(invoice.portfolio_id);
            const html = generateInvoiceHTML(invoice, writingTemplates);

            // Load html2pdf from CDN
            const loadScript = () => new Promise((resolve) => {
                if (window.html2pdf) return resolve();
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });

            await loadScript();

            // Use iframe to preserve full HTML document structure
            const iframe = document.createElement('iframe');
            iframe.style.position = 'absolute';
            iframe.style.left = '-9999px';
            iframe.style.width = '210mm';
            iframe.style.height = '297mm';
            document.body.appendChild(iframe);
            iframe.contentDocument.open();
            iframe.contentDocument.write(html);
            iframe.contentDocument.close();

            // Wait for iframe to fully render
            await new Promise(r => setTimeout(r, 500));

            const recipientName = invoice.recipient_name || (invoice.tenant?.name || 'Unbekannt');
            const originalInvoiceNum = invoice.invoice_number || 'ENTWURF';
            const displayNum = isCredit ? `GS-${originalInvoiceNum}` : originalInvoiceNum;
            const safeName = recipientName.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim().replace(/\s+/g, '_');
            const filename = `${isCredit ? 'Gutschrift' : 'Rechnung'}_${displayNum}_${safeName}.pdf`;

            window.html2pdf().set({
                margin: 10,
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).from(iframe.contentDocument.body).save().then(() => {
                document.body.removeChild(iframe);
            });

        } catch (error) {
            console.error(error);
            alert('PDF Fehler: ' + error.message);
        }
    };

    const generateInvoiceHTML = (inv, writingTemplates = null) => {
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

        const recipientName = inv.recipient_name || (inv.tenant?.name || 'Unbekannt');
        const recipientAddress = inv.recipient_street ? `${inv.recipient_street}\n${inv.recipient_zip} ${inv.recipient_city}` : (inv.tenant?.address || '');
        const invoiceDate = inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('de-DE') : new Date().toLocaleDateString('de-DE');
        const originalInvoiceNum = inv.invoice_number || 'ENTWURF';
        const isCredit = inv.status === 'credited';
        const displayNum = isCredit ? `GS-${originalInvoiceNum}` : originalInvoiceNum;

        const servicePeriod = inv.move_in && inv.move_out
            ? `${new Date(inv.move_in).toLocaleDateString('de-DE')} - ${new Date(inv.move_out).toLocaleDateString('de-DE')}`
            : (inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('de-DE') : '');

        // Generate Positions Table HTML
        const posRows = (inv.positions || []).map(p => `
            <tr>
                <td style="text-align:center;padding:6px;vertical-align:top;border-bottom:1px solid #cbd5e1;">${p.pos || ''}</td>
                <td style="text-align:left;padding:6px 10px;word-wrap:break-word;vertical-align:top;border-bottom:1px solid #cbd5e1;">${(p.description || '').replace(/\n/g, '<br>')}</td>
                <td style="text-align:right;padding:6px;white-space:nowrap;vertical-align:top;border-bottom:1px solid #cbd5e1;">${p.isFirst ? fmt(p.pricePerNight || 0) + ' €' : ''}</td>
                <td style="text-align:right;padding:6px;white-space:nowrap;vertical-align:top;border-bottom:1px solid #cbd5e1;">${fmt((p.netTotal || 0))} €</td>
                <td style="text-align:right;padding:6px;vertical-align:top;border-bottom:1px solid #cbd5e1;">7%</td>
                <td style="text-align:right;padding:6px;font-weight:bold;white-space:nowrap;vertical-align:top;border-bottom:1px solid #cbd5e1;">${fmt((p.grossTotal || 0))} €</td>
            </tr>
        `).join('');

        const tableHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 6px; text-align: center; width: 8%;">Pos.</th>
                    <th style="padding: 6px 10px; text-align: left; width: 42%;">Bezeichnung</th>
                    <th style="padding: 6px; text-align: right; width: 12%;">Einzel</th>
                    <th style="padding: 6px; text-align: right; width: 12%;">Netto</th>
                    <th style="padding: 6px; text-align: right; width: 10%;">MwSt.</th>
                    <th style="padding: 6px; text-align: right; width: 16%; font-weight: bold;">Gesamt</th>
                </tr>
            </thead>
            <tbody>
                ${posRows}
                <tr style="border-top: 2px solid #000;">
                    <td colspan="3" style="padding: 6px; font-weight: bold;">Zwischensumme (Netto):</td>
                    <td style="padding: 6px; text-align: right; font-weight: bold;">${fmt(inv.net_amount || 0)} €</td>
                    <td colspan="2"></td>
                </tr>
                <tr>
                    <td colspan="3" style="padding: 6px; font-weight: bold;">zzgl. 7% MwSt.:</td>
                    <td style="padding: 6px; text-align: right; font-weight: bold;">${fmt(inv.vat_amount || 0)} €</td>
                    <td colspan="2"></td>
                </tr>
                <tr style="border-top: 1px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                    <td colspan="3" style="padding: 8px; font-weight: bold; font-size: 11pt;">${isCredit ? 'Gutschriftsbetrag' : 'Gesamtbetrag'} (Brutto):</td>
                    <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt;">${fmt(inv.gross_amount || 0)} €</td>
                </tr>
            </tbody>
        </table>`;

        const localVars = {
            gast_name: recipientName,
            gast_adresse: recipientAddress.replace(/\n/g, '<br>'),
            buchungszeitraum: servicePeriod,
            gaeste_anzahl: `${inv.persons || 1}`,
            rechnungsnummer: displayNum,
            rechnungsdatum: invoiceDate,
            netto_betrag: `${fmt(inv.net_amount || 0)} €`,
            mwst_betrag: `${fmt(inv.vat_amount || 0)} €`,
            brutto_betrag: `${fmt(inv.gross_amount || 0)} €`,
            original_rechnungsnummer: originalInvoiceNum,
            vermieter_name: sender.name,
            vermieter_bankverbindung: `Bank: ${sender.bank}, IBAN: ${sender.iban}, BIC: ${sender.bic}`,
            vermieter_steuernummer: sender.tax_number,
            vermieter_ust_id: sender.vat_id,
            positions_tabelle: tableHtml,
            objekt_adresse: portfolio?.street ? (portfolio?.street + (portfolio?.house_number ? ' ' + portfolio.house_number : '')) : "Musterstraße 1"
        };

        const replaceHTMLVariables = (htmlStr, vars) => {
            if (!htmlStr) return '';
            let result = htmlStr;
            for (const [key, value] of Object.entries(vars)) {
                const regex = new RegExp(`(<span[^>]*data-id="${key}"[^>]*>.*?<\/span>|{${key}})`, 'g');
                result = result.replace(regex, value);
            }
            return result;
        };

        const DEFAULT_FEWO_INVOICE = `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Leistungszeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Rechnung Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>wir bedanken uns herzlich für Ihren Aufenthalt in unserem Hause. Vereinbarungsgemäß erlauben wir uns, Ihnen die erbrachten Leistungen in Rechnung zu stellen:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Bitte überweisen Sie den fälligen Gesamtbetrag innerhalb von 14 Tagen auf unser angegebenes Bankkonto.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`;

        const DEFAULT_FEWO_CREDIT_NOTE = `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Leistungszeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Gutschrift Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>vereinbarungsgemäß erhalten Sie nachfolgend die Gutschrift für Ihren Aufenthalt bzw. Ihre Buchung:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Der Gutschriftbetrag wird Ihrem Konto in den nächsten Tagen gutgeschrieben oder vereinbarungsgemäß verrechnet.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`;

        let templateHtml = isCredit 
            ? (writingTemplates?.fewo_credit_note_template || DEFAULT_FEWO_CREDIT_NOTE)
            : (writingTemplates?.fewo_invoice_template || DEFAULT_FEWO_INVOICE);

        const renderedContent = replaceHTMLVariables(templateHtml, localVars);

        return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${isCredit ? 'Gutschrift' : 'Rechnung'} ${displayNum}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
            @page { size: A4; margin: 0; }
            * { box-sizing: border-box; }
            body { margin: 0; padding: 0; background: #fff; font-family: 'Open Sans', Arial, sans-serif; font-size: 11pt; color: #000; }
            .letter-page {
                width: 210mm;
                height: 297mm;
                padding: 20mm 20mm 20mm 25mm;
                margin: 0 auto;
                background: #ffffff;
                color: #000000;
                box-sizing: border-box;
                position: relative;
                display: flex;
                flex-direction: column;
                text-align: left;
                page-break-after: always;
                page-break-inside: avoid;
            }
            .letter-sender {
                font-size: 8pt;
                color: #555555;
                border-bottom: 1px solid #cccccc;
                padding-bottom: 2mm;
                margin-bottom: 5mm;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .letter-header-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 10mm;
            }
            .letter-recipient {
                width: 85mm;
                font-size: 10pt;
                line-height: 1.4;
                color: #111111;
                text-align: left;
            }
            .letter-date {
                font-size: 10pt;
                color: #333333;
                text-align: right;
            }
            .letter-subject {
                font-size: 13pt;
                font-weight: bold;
                margin-bottom: 4mm;
                color: #000000;
                text-align: left;
            }
            .letter-object {
                font-size: 10pt;
                color: #444444;
                margin-bottom: 8mm;
                padding-bottom: 2mm;
                border-bottom: 1px dotted #e2e8f0;
                text-align: left;
            }
            .letter-body {
                flex-grow: 1;
                font-size: 11pt;
                line-height: 1.6;
                text-align: left;
            }
            .letter-body p {
                margin-bottom: 1em !important;
            }
            .letter-footer {
                display: flex;
                justify-content: space-between;
                border-top: 1px solid #dddddd;
                padding-top: 5mm;
                margin-top: 10mm;
                font-size: 8pt;
                color: #666666;
                line-height: 1.4;
                text-align: left;
            }
            .footer-col {
                width: 30%;
            }
            @media print {
                body {
                    margin: 0;
                    padding: 0;
                    background: #fff;
                }
            }
        </style>
        </head>
        <body>
            ${renderedContent}
        </body>
        </html>`;
    };

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
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
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
            </div>

            {/* Table */}
            <Card>
                {filteredInvoices.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {hasFilters ? 'Keine Rechnungen für die gewählten Filter gefunden.' : 'Keine Rechnungen gefunden.'}
                    </div>
                ) : (
                    <>
                        <div className="hidden-mobile">
                            <Table
                                columns={columns}
                                data={filteredInvoices}
                                getRowStyle={(row) => row.status === 'credited' ? { color: 'var(--text-secondary)', textDecoration: 'line-through' } : {}}
                            />
                        </div>

                        {/* Mobile Card View */}
                        <div className="hidden-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            {filteredInvoices.map((row) => {
                                const isCredited = row.status === 'credited';
                                const unit = units.find(u => u.id === row.unit_id);
                                const property = properties.find(p => p.id === unit?.property_id);

                                return (
                                    <div key={row.id} style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--spacing-md)',
                                        backgroundColor: 'var(--surface-color)',
                                        position: 'relative',
                                        opacity: isCredited ? 0.7 : 1
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '1rem', textDecoration: isCredited ? 'line-through' : 'none' }}>
                                                    {row.invoice_number}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                    {row.invoice_date ? new Date(row.invoice_date).toLocaleDateString('de-DE') : '-'}
                                                </div>
                                            </div>
                                            <div style={{ fontWeight: 700, fontSize: '1rem', color: isCredited ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                                {fmt(row.gross_amount || 0)} €
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '12px', fontSize: '0.9rem' }}>
                                            <div style={{ fontWeight: 500 }}>{row.recipient_name || row.contact?.name || '-'}</div>
                                            {(unit || property) && (
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                    {unit?.unit_name} {property ? `• ${property.street}` : ''}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                            <ActionMenu
                                                onEdit={() => navigate(`/invoices/edit/${row.id}`)}
                                                onPrint={() => handlePrint(row)}
                                                onPDF={() => handlePDF(row)}
                                                onCredit={() => handleCredit(row)}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </Card>
        </div>
    );
};

export default Invoices;
