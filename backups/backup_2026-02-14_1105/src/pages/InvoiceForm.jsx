import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    Plus,
    Trash2,
    Printer,
    Download,
    Check,
    Search,
    UserPlus,
    Loader2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePortfolio } from '../context/PortfolioContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import CurrencyInput from '../components/ui/CurrencyInput';
import Modal from '../components/ui/Modal';
import LoadingOverlay from '../components/ui/LoadingOverlay';

const InvoiceForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const editId = id;
    const navigate = useNavigate();
    const { user } = useAuth();
    const { selectedPortfolioID } = usePortfolio();

    // State
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [successModal, setSuccessModal] = useState(false);
    const [savedInvoice, setSavedInvoice] = useState(null);

    // Form Data
    const [portfolios, setPortfolios] = useState([]);
    const [properties, setProperties] = useState([]);
    const [allUnits, setAllUnits] = useState([]);
    const [contacts, setContacts] = useState([]);

    const [senderPortfolioId, setSenderPortfolioId] = useState('');
    const [senderName, setSenderName] = useState('');
    const [senderStreet, setSenderStreet] = useState('');
    const [senderZip, setSenderZip] = useState('');
    const [senderCity, setSenderCity] = useState('');

    const [recipientContactId, setRecipientContactId] = useState(null);
    const [recipientName, setRecipientName] = useState('');
    const [recipientStreet, setRecipientStreet] = useState('');
    const [recipientZip, setRecipientZip] = useState('');
    const [recipientCity, setRecipientCity] = useState('');

    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [selectedUnitId, setSelectedUnitId] = useState('');
    const [moveIn, setMoveIn] = useState('');
    const [moveOut, setMoveOut] = useState('');
    const [persons, setPersons] = useState(1);
    const [positions, setPositions] = useState([]);

    // Contact Picker State
    const [contactPickerOpen, setContactPickerOpen] = useState(false);
    const [contactSearch, setContactSearch] = useState('');

    // Helpers
    const r2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
    const fmt = (num) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num || 0);
    const fmtEur = (num) => fmt(num) + ' €';

    // Derived
    // Units might have 'Ferienwohnung' in type or usage_type. We check both to be safe or just 'type'.
    // In previous versions it was 'type'.
    const vacationUnits = useMemo(() => {
        let filtered = allUnits.filter(u => u.is_vacation_rental === true);

        if (selectedPortfolioID && selectedPortfolioID !== 'all') {
            const portfolioProps = properties.filter(p => p.portfolio_id === selectedPortfolioID).map(p => p.id);
            filtered = filtered.filter(u => portfolioProps.includes(u.property_id));
        }
        return filtered;
    }, [allUnits, properties, selectedPortfolioID]);
    const selectedUnit = useMemo(() => allUnits.find(u => u.id === selectedUnitId), [allUnits, selectedUnitId]);

    const nights = useMemo(() => {
        if (!moveIn || !moveOut) return 0;
        const start = new Date(moveIn);
        const end = new Date(moveOut);
        const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        return diff > 0 ? diff : 0;
    }, [moveIn, moveOut]);

    const unitAddress = useMemo(() => {
        if (!selectedUnit) return '';
        const prop = properties.find(p => p.id === selectedUnit.property_id);
        if (!prop) return '';
        return `${prop.street} ${prop.house_number || ''}, ${prop.zip} ${prop.city}`;
    }, [selectedUnit, properties]);

    // ===== DATA FETCHING =====
    useEffect(() => {
        if (user) fetchData();
    }, [user, isEdit, editId]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [portRes, propRes, unitRes, contactRes] = await Promise.all([
                supabase.from('portfolios').select('*'),
                supabase.from('properties').select('*'),
                supabase.from('units').select('*'),
                supabase.from('contacts').select('*').order('name')
            ]);

            const ports = portRes.data || [];
            const props = propRes.data || [];
            const units = unitRes.data || [];

            setPortfolios(ports);
            setProperties(props);
            setAllUnits(units);
            setContacts(contactRes.data || []);

            // Set default sender from current selected portfolio if one is selected
            if (selectedPortfolioID && selectedPortfolioID !== 'all') {
                const portfolio = ports.find(p => p.id === selectedPortfolioID);
                if (portfolio && !isEdit) {
                    setSenderPortfolioId(portfolio.id);
                    setSenderName(portfolio.company_name || portfolio.name || '');
                    setSenderStreet(portfolio.street ? `${portfolio.street} ${portfolio.house_number || ''}`.trim() : '');
                    setSenderZip(portfolio.zip || '');
                    setSenderCity(portfolio.city || '');
                }
            }

            if (isEdit && editId) {
                const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', editId).single();
                if (inv) {
                    setSenderName(inv.sender_name || '');
                    setSenderStreet(inv.sender_street || '');
                    setSenderZip(inv.sender_zip || '');
                    setSenderCity(inv.sender_city || '');
                    setRecipientName(inv.recipient_name || '');
                    setRecipientStreet(inv.recipient_street || '');
                    setRecipientZip(inv.recipient_zip || '');
                    setRecipientCity(inv.recipient_city || '');
                    setRecipientContactId(inv.contact_id || null);
                    setInvoiceDate(inv.invoice_date || '');
                    setInvoiceNumber(inv.invoice_number || '');
                    setSelectedUnitId(inv.unit_id || '');
                    setMoveIn(inv.move_in || '');
                    setMoveOut(inv.move_out || '');
                    setPersons(inv.persons || 1);
                    setSenderPortfolioId(inv.portfolio_id || '');

                    if (inv.positions && Array.isArray(inv.positions)) {
                        setPositions(inv.positions);
                    }
                }
            } else {
                // If a portfolio is already selected, generate number and potentially select first unit
                if (selectedPortfolioID && selectedPortfolioID !== 'all') {
                    await generateInvoiceNumber(selectedPortfolioID);

                    const portProps = props.filter(p => p.portfolio_id === selectedPortfolioID).map(p => p.id);
                    const firstUnit = units.find(u => u.is_vacation_rental === true && portProps.includes(u.property_id));
                    if (firstUnit && !selectedUnitId) {
                        setSelectedUnitId(firstUnit.id);
                    }
                }
            }
        } catch (err) {
            console.error('InvoiceForm load error:', err);
        } finally {
            setLoading(false);
        }
    };

    // ===== AUTO-FILL SENDER FROM UNIT =====
    useEffect(() => {
        if (!selectedUnitId || isEdit || loading) return;

        const unit = allUnits.find(u => u.id === selectedUnitId);
        if (!unit) return;

        const property = properties.find(p => p.id === unit.property_id);
        if (!property) return;

        const portfolio = portfolios.find(p => p.id === property.portfolio_id);
        if (portfolio) {
            setSenderPortfolioId(portfolio.id);
            setSenderName(portfolio.company_name || portfolio.name || '');
            setSenderStreet(portfolio.street ? `${portfolio.street} ${portfolio.house_number || ''}`.trim() : '');
            setSenderZip(portfolio.zip || '');
            setSenderCity(portfolio.city || '');

            // Regenerate invoice number for this specific portfolio
            generateInvoiceNumber(portfolio.id);
        }
    }, [selectedUnitId, allUnits, properties, portfolios, isEdit, loading]);

    // Reset unit selection if portfolio changes and currently selected unit is no longer valid
    useEffect(() => {
        if (!isEdit && selectedUnitId && vacationUnits.length > 0 && !vacationUnits.find(u => u.id === selectedUnitId)) {
            setSelectedUnitId('');
        }
    }, [vacationUnits, selectedUnitId, isEdit]);

    // ===== INVOICE NUMBER GENERATION =====
    const generateInvoiceNumber = async (portfolioId) => {
        try {
            const year = new Date().getFullYear();
            const yearStr = String(year);

            let query = supabase
                .from('invoices')
                .select('invoice_number')
                .like('invoice_number', `${yearStr}-%`)
                .order('invoice_number', { ascending: false })
                .limit(1);

            if (portfolioId && portfolioId !== 'all') {
                query = query.eq('portfolio_id', portfolioId);
            }

            const { data } = await query;

            let nextNum = 1;
            if (data && data.length > 0) {
                const lastNum = data[0].invoice_number;
                const parts = lastNum.split('-');
                if (parts.length >= 2) {
                    nextNum = parseInt(parts[1], 10) + 1;
                }
            }

            setInvoiceNumber(`${yearStr}-${String(nextNum).padStart(3, '0')}`);
        } catch (err) {
            console.error('Error generating invoice number:', err);
            setInvoiceNumber(`${new Date().getFullYear()}-001`);
        }
    };

    // ===== POSITION 1 AUTO-SETUP =====
    useEffect(() => {
        if (positions.length === 0 && !isEdit && !loading) {
            setPositions([{
                pos: 1,
                description: '',
                pricePerNight: 0,
                netTotal: 0,
                vat: 0,
                grossTotal: 0,
                isFirst: true
            }]);
        }
    }, [isEdit, loading]);

    const buildFirstDescription = () => {
        const unitLabel = selectedUnit ? (selectedUnit.unit_name || 'Ferienwohnung') : 'Ferienwohnung';
        const addr = unitAddress ? ` (${unitAddress})` : '';
        const lines = [];

        if (nights > 0) {
            lines.push(`${nights} Übernachtung${nights > 1 ? 'en' : ''} in Ferienwohnung ${unitLabel}${addr}`);
        } else {
            lines.push(`Übernachtungen in Ferienwohnung ${unitLabel}${addr}`);
        }

        if (persons > 0) lines.push(`${persons} Person${persons > 1 ? 'en' : ''}`);
        return lines.join('\n');
    };

    useEffect(() => {
        if (positions.length > 0 && positions[0].isFirst) {
            const desc = buildFirstDescription();
            const updated = [...positions];
            if (updated[0].description !== desc) {
                updated[0] = { ...updated[0], description: desc };
                setPositions(updated);
            }
        }
    }, [nights, unitAddress, persons, selectedUnitId]);

    // ===== CALCULATIONS =====
    const updatePosition = (idx, field, value) => {
        const updated = [...positions];
        const item = { ...updated[idx] };
        const n = item.isFirst ? (nights || 1) : 1;

        // Handle German format from CurrencyInput (1.000,00 -> 1000.00)
        let numVal = 0;
        if (typeof value === 'string') {
            numVal = parseFloat(value.replace(/\./g, '').replace(',', '.')) || 0;
        } else {
            numVal = parseFloat(value) || 0;
        }

        if (field === 'pricePerNight') {
            item.pricePerNight = numVal;
            item.netTotal = r2(n * numVal);
            item.vat = r2(item.netTotal * 0.07);
            item.grossTotal = r2(item.netTotal + item.vat);
        } else if (field === 'netTotal') {
            item.netTotal = numVal;
            item.pricePerNight = r2(numVal / n);
            item.vat = r2(item.netTotal * 0.07);
            item.grossTotal = r2(item.netTotal + item.vat);
        } else if (field === 'grossTotal') {
            item.grossTotal = numVal;
            item.netTotal = r2(numVal / 1.07);
            item.vat = r2(item.grossTotal - item.netTotal);
            item.pricePerNight = r2(item.netTotal / n);
        } else if (field === 'description') {
            item.description = value;
        }

        updated[idx] = item;
        setPositions(updated);
    };

    useEffect(() => {
        if (positions.length > 0 && positions[0].isFirst && nights > 0) {
            const item = { ...positions[0] };
            if (item.pricePerNight > 0) {
                const newNet = r2(nights * item.pricePerNight);
                if (item.netTotal !== newNet) {
                    item.netTotal = newNet;
                    item.vat = r2(item.netTotal * 0.07);
                    item.grossTotal = r2(item.netTotal + item.vat);
                    const updated = [...positions];
                    updated[0] = item;
                    setPositions(updated);
                }
            }
        }
    }, [nights]);

    const addPosition = () => {
        setPositions([...positions, {
            pos: positions.length + 1,
            description: '',
            pricePerNight: 0,
            netTotal: 0,
            vat: 0,
            grossTotal: 0,
            isFirst: false
        }]);
    };

    const removePosition = (idx) => {
        if (idx === 0) return;
        const updated = positions.filter((_, i) => i !== idx).map((p, i) => ({ ...p, pos: i + 1 }));
        setPositions(updated);
    };

    const totalNet = useMemo(() => r2(positions.reduce((s, p) => s + (p.netTotal || 0), 0)), [positions]);
    const totalVat = useMemo(() => r2(positions.reduce((s, p) => s + (p.vat || 0), 0)), [positions]);
    const totalGross = useMemo(() => r2(positions.reduce((s, p) => s + (p.grossTotal || 0), 0)), [positions]);

    // ===== CONTACTS =====
    const filteredContacts = useMemo(() => {
        if (!contactSearch) return contacts;
        const q = contactSearch.toLowerCase();
        return contacts.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.street || '').toLowerCase().includes(q) ||
            (c.city || '').toLowerCase().includes(q)
        );
    }, [contacts, contactSearch]);

    const selectContact = (contact) => {
        setRecipientName(contact.name || '');
        setRecipientStreet(contact.street || '');
        setRecipientZip(contact.zip || '');
        setRecipientCity(contact.city || '');
        setRecipientContactId(contact.id);
        setContactPickerOpen(false);
        setContactSearch('');
    };

    const saveAsContact = async () => {
        if (!recipientName.trim()) return alert('Bitte Name eingeben.');
        try {
            const payload = {
                user_id: user.id,
                name: recipientName,
                contact_type: 'guest',
                street: recipientStreet,
                zip: recipientZip,
                city: recipientCity
            };

            const { data: existingByName } = await supabase
                .from('contacts')
                .select('id, name')
                .eq('name', recipientName.trim())
                .limit(1);

            let targetId = recipientContactId;
            let isNew = !recipientContactId;

            if (existingByName && existingByName.length > 0) {
                targetId = existingByName[0].id;
                isNew = false;
                if (!recipientContactId || recipientContactId !== targetId) {
                    if (!confirm(`Ein Kontakt mit dem Namen "${recipientName}" existiert bereits. Möchten Sie diesen aktualisieren?`)) return;
                }
            }

            if (!isNew && targetId) {
                const { error } = await supabase.from('contacts').update(payload).eq('id', targetId);
                if (error) throw error;
                setRecipientContactId(targetId);
                alert('Kontakt aktualisiert!');
            } else {
                const { data, error } = await supabase.from('contacts').insert([payload]).select().single();
                if (error) throw error;
                if (data) setRecipientContactId(data.id);
                alert('Kontakt neu angelegt!');
            }
            const { data: refreshed } = await supabase.from('contacts').select('*').order('name');
            setContacts(refreshed || []);
        } catch (err) {
            console.error('Error saving contact:', err);
            alert('Fehler: ' + (err.message || err));
        }
    };

    const generateInvoiceHTML = (invoiceData) => {
        // Construct Sender Data from invoice (which might have portfolio info injected) or fallback
        // Ideally, we should receive the portfolio object, but we might only have IDs.
        // Let's try to find the portfolio from state if possible.
        let portfolio = null;
        if (invoiceData.portfolio_id) {
            portfolio = portfolios.find(p => p.id === invoiceData.portfolio_id);
        } else if (senderPortfolioId) {
            portfolio = portfolios.find(p => p.id === senderPortfolioId);
        }

        const sender = {
            name: invoiceData.sender_name || portfolio?.company_name || portfolio?.name || "ImmoControl pro 360",
            street: invoiceData.sender_street || portfolio?.street ? `${portfolio?.street} ${portfolio?.house_number || ''}` : "Musterstraße 1",
            city: invoiceData.sender_city || portfolio?.zip ? `${portfolio?.zip} ${portfolio?.city}` : "12345 Musterstadt",
            email: portfolio?.email || "info@immocontrol.de",
            phone: portfolio?.phone || "01234 / 567890",
            bank: portfolio?.bank_name || "Musterbank",
            iban: portfolio?.iban || "DE12 3456 7890 1234 5678 90",
            bic: portfolio?.bic || "MUSDEFF"
        };

        const senderLine = `${sender.name} • ${sender.street} • ${sender.city}`;

        const inv = invoiceData || {};

        const posRows = (inv.positions || []).map(p => `
            <tr>
                <td style="text-align:center;padding:6px 0;vertical-align:top;">${p.pos}</td>
                <td style="text-align:left;padding:6px 10px;word-wrap:break-word;vertical-align:top;">${(p.description || '').replace(/\n/g, '<br>')}</td>
                <td style="text-align:right;padding:6px 0;white-space:nowrap;vertical-align:top;">${p.isFirst ? fmt(p.pricePerNight) + ' €' : ''}</td>
                <td style="text-align:right;padding:6px 0;white-space:nowrap;vertical-align:top;">${fmt(p.netTotal)} €</td>
                <td style="text-align:right;padding:6px 0;vertical-align:top;">7%</td>
                <td style="text-align:right;padding:6px 0;font-weight:bold;white-space:nowrap;vertical-align:top;">${fmt(p.grossTotal)} €</td>
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
                
                /* Address Zone: 45mm from top */
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
                <!-- Folding Marks -->
                <div class="mark fold-1"></div>
                <div class="mark center"></div>
                <div class="mark fold-2"></div>

                <!-- Address -->
                <div class="address-zone">
                    <div class="sender-line">${senderLine}</div>
                    <div class="recipient">
                        ${inv.recipient_name}<br>
                        ${inv.recipient_street}<br>
                        ${inv.recipient_zip} ${inv.recipient_city}
                    </div>
                </div>

                <!-- Info Block -->
                <div class="info-block">
                    <div class="info-row"><span>Rechnungs-Nr.</span><span>${inv.invoice_number}</span></div>
                    <div class="info-row"><span>Datum</span><span>${fmtDate(inv.invoice_date)}</span></div>
                    <div class="info-row"><span>Leistungszeitraum</span><span>${inv.move_in ? fmtDate(inv.move_in) : '-'}</span></div>
                    <div class="info-row"><span>bis</span><span>${inv.move_out ? fmtDate(inv.move_out) : '-'}</span></div>
                    <br>
                    <div class="info-row"><span>Anzahl Gäste</span><span>${inv.persons}</span></div>
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
                            <div class="t-row"><span>Summe Netto</span><span>${fmt(inv.net_amount)} €</span></div>
                            <div class="t-row"><span>zzgl. 7% MwSt</span><span>${fmt(inv.vat_amount)} €</span></div>
                            <div class="t-row final"><span>Gesamtbetrag</span><span>${fmt(inv.gross_amount)} €</span></div>
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
                        <p>${sender.bank}<br>IBAN: ${sender.iban}<br>BIC: ${sender.bic}</p>
                    </div>
                </div>
            </div>
        </body>
        </html>`;
    };

    const handlePrint = (data) => {
        const win = window.open('', '_blank');
        if (!win) {
            alert('Bitte Popups erlauben.');
            return;
        }
        win.document.open();
        win.document.write(generateInvoiceHTML(data));
        win.document.close();
        // Slightly longer delay to ensure styles render
        setTimeout(() => {
            win.focus();
            win.print();
        }, 800);
    };

    // ===== PDF (Client-Side Vector Drawing) =====
    const handlePDF = async (data) => {
        setPdfGenerating(true);
        try {
            // Lazy load jsPDF to avoid large bundle size
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
            // Construct Sender Data
            let portfolio = null;
            if (data.portfolio_id) {
                portfolio = portfolios.find(p => p.id === data.portfolio_id);
            } else if (senderPortfolioId) {
                portfolio = portfolios.find(p => p.id === senderPortfolioId);
            }

            const sender = {
                name: data.sender_name || portfolio?.company_name || portfolio?.name || "ImmoControl pro 360",
                street: data.sender_street || portfolio?.street ? (portfolio?.street + (portfolio?.house_number ? ' ' + portfolio.house_number : '')) : "Musterstraße 1",
                city: data.sender_city || portfolio?.zip ? `${portfolio?.zip} ${portfolio?.city}` : "12345 Musterstadt",
                email: portfolio?.email || "info@immocontrol.de",
                phone: portfolio?.phone || "01234 / 567890",
                bank: portfolio?.bank_name || "Musterbank",
                iban: portfolio?.iban || "DE12 3456 7890 1234 5678 90",
                bic: portfolio?.bic || "MUSDEFF"
            };

            const inv = data || {};
            const recipientName = inv.recipient_name || (inv.tenant?.name || 'Unbekannt');
            const recipientAddress = inv.recipient_street ? `${inv.recipient_street}\n${inv.recipient_zip} ${inv.recipient_city}` : (inv.tenant?.address || '');

            const invoiceDate = inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('de-DE') : new Date().toLocaleDateString('de-DE');
            const invoiceNum = inv.invoice_number || 'ENTWURF';
            // Use move_in / move_out as service period for invoice form
            const servicePeriod = inv.move_in && inv.move_out
                ? `${new Date(inv.move_in).toLocaleDateString('de-DE')} - ${new Date(inv.move_out).toLocaleDateString('de-DE')}`
                : (inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('de-DE') : '');

            // --- FONTS ---
            doc.setFont("helvetica"); // Standard font

            // --- LAYOUT CONSTANTS (DIN 5008 Form B) ---
            const leftMargin = 25;
            const rightMargin = 20;
            // const contentWidth = 210 - leftMargin - rightMargin;
            let y = 0;

            // 1. Sender Line (Small) - 45mm from top
            y = 45;
            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(`${sender.name} • ${sender.street} • ${sender.city}`, leftMargin, y);

            // 2. Recipient Address - 50mm from top 
            y = 55;
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text(recipientName, leftMargin, y);
            y += 6;
            if (recipientAddress) {
                const addrLines = doc.splitTextToSize(recipientAddress.replace(/<br>/g, '\n'), 85);
                doc.text(addrLines, leftMargin, y);
            }

            // 3. Info Block (Date, Number) - Right side
            const infoX = 125;
            let infoY = 50;
            doc.setFontSize(10);

            const addInfoRow = (label, value) => {
                doc.text(label, infoX, infoY);
                doc.text(value, infoX + 60, infoY, { align: 'right' });
                infoY += 5;
            };

            addInfoRow("Rechnungsnummer:", invoiceNum);
            addInfoRow("Rechnungsdatum:", invoiceDate);
            addInfoRow("Leistungszeitraum:", servicePeriod);
            addInfoRow("Anzahl Gäste:", `${inv.persons || 1}`);
            if (inv.customer_id) addInfoRow("Kundennummer:", inv.customer_id);

            // 4. Headline - 98.4mm from top (Subject line)
            y = 105;
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.text(`Rechnung Nr. ${invoiceNum}`, leftMargin, y);

            // Intro Text
            y += 10;
            doc.setFontSize(11);
            doc.setFont("helvetica", "normal");
            doc.text("Sehr geehrte Damen und Herren,", leftMargin, y);
            y += 6;
            doc.text("vielen Dank für Ihren Aufenthalt. Wir berechnen Ihnen folgende Leistungen:", leftMargin, y);
            y += 15;

            // 5. Item Table
            // Header
            const col1 = leftMargin; // Pos
            const col2 = leftMargin + 12; // Description
            const col3 = 140; // Price per Night (Einzelpreis)
            const col4 = 160; // Net Total
            const col5 = 175; // VAT
            const col6 = 190; // Gross Total

            // Draw Header Line
            doc.setDrawColor(0);
            doc.setLineWidth(0.2);
            doc.line(leftMargin, y, 210 - rightMargin, y); // Top line
            y += 5;

            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.text("Pos.", col1, y);
            doc.text("Bezeichnung", col2, y);
            doc.text("Einzel", col3, y, { align: 'right' });
            doc.text("Netto", col4, y, { align: 'right' });
            doc.text("MwSt", col5, y, { align: 'right' });
            doc.text("Brutto", col6, y, { align: 'right' });

            y += 2;
            doc.line(leftMargin, y, 210 - rightMargin, y); // Bottom line
            y += 6;

            // Items
            doc.setFont("helvetica", "normal");

            (inv.positions || []).forEach((item) => {
                // Determine description text
                const descText = item.description || '';
                const descLines = doc.splitTextToSize(descText, 85);
                const lineHeight = descLines.length * 5;

                // Check page break
                if (y + lineHeight > 240) {
                    doc.addPage();
                    y = 30;
                    // Reprint header? Usually yes, but simple version for now
                }

                doc.text(`${item.pos}`, col1, y);
                doc.text(descLines, col2, y);
                doc.text(item.isFirst ? fmt(item.pricePerNight) + ' €' : '', col3, y, { align: 'right' });
                doc.text(fmt(item.netTotal) + " €", col4, y, { align: 'right' });
                doc.text("7%", col5, y, { align: 'right' });
                doc.text(fmt(item.grossTotal) + " €", col6, y, { align: 'right' });

                y += Math.max(6, lineHeight + 2);
            });

            // 6. Totals
            y += 5;

            // Totals Box
            const totalsX = 140; // Start X for totals labels
            const totalsValX = 190; // End X for values

            // Net
            doc.text("Summe Netto:", totalsX, y);
            doc.text(fmt(inv.net_amount || totalNet) + " €", totalsValX, y, { align: 'right' });
            y += 5;

            // VAT
            doc.text("zzgl. 7% MwSt:", totalsX, y);
            doc.text(fmt(inv.vat_amount || totalVat) + " €", totalsValX, y, { align: 'right' });
            y += 2;

            // Double Line / Bold Total
            doc.line(totalsX, y, 210 - rightMargin, y);
            y += 6;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text("Gesamtbetrag:", totalsX, y);
            doc.text(fmt(inv.gross_amount || totalGross) + " €", totalsValX, y, { align: 'right' });
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);

            // 7. Footer Instructions
            y += 20;
            if (y > 250) { doc.addPage(); y = 30; }

            doc.text("Bitte überweisen Sie den Gesamtbetrag sofort und ohne Abzug auf das unten genannte Konto.", leftMargin, y);

            // 8. Bottom Footer (Bank Details) - Fixed at bottom
            const footerY = 275;
            doc.setFontSize(8);
            doc.setTextColor(50);

            // Column 1: Address
            doc.text("Anschrift", 25, footerY);
            doc.text(`${sender.name}`, 25, footerY + 4);
            doc.text(`${sender.street}`, 25, footerY + 8);
            doc.text(`${sender.city}`, 25, footerY + 12);

            // Column 2: Contact
            doc.text("Kontakt", 85, footerY);
            doc.text(`Tel: ${sender.phone}`, 85, footerY + 4);
            doc.text(`Email: ${sender.email}`, 85, footerY + 8);

            // Column 3: Bank
            doc.text("Bankverbindung", 145, footerY);
            doc.text(`${sender.bank}`, 145, footerY + 4);
            doc.text(`IBAN: ${sender.iban}`, 145, footerY + 8);
            doc.text(`BIC: ${sender.bic}`, 145, footerY + 12);

            // Save
            doc.save(`${invoiceNum}.pdf`);

        } catch (error) {
            console.error(error);
            alert('PDF Fehler: ' + error.message);
        } finally {
            setPdfGenerating(false);
        }
    };

    // ===== SAVE =====
    const handleSave = async () => {
        if (!senderName.trim()) return alert('Absender fehlt.');
        if (!recipientName.trim()) return alert('Empfänger fehlt.');
        setSaving(true);
        try {
            const payload = {
                user_id: user.id,
                portfolio_id: senderPortfolioId || null,
                contact_id: recipientContactId || null,
                unit_id: selectedUnitId || null,
                invoice_number: invoiceNumber,
                invoice_date: invoiceDate,
                sender_name: senderName,
                sender_street: senderStreet,
                sender_zip: senderZip,
                sender_city: senderCity,
                recipient_name: recipientName,
                recipient_street: recipientStreet,
                recipient_zip: recipientZip,
                recipient_city: recipientCity,
                move_in: moveIn || null,
                move_out: moveOut || null,
                persons: persons || 1,
                positions: positions,
                net_amount: totalNet,
                vat_amount: totalVat,
                gross_amount: totalGross,
                status: 'draft'
            };

            let result;
            if (isEdit) {
                const { data, error } = await supabase.from('invoices').update(payload).eq('id', editId).select().single();
                if (error) throw error;
                result = data;
            } else {
                const { data, error } = await supabase.from('invoices').insert([payload]).select().single();
                if (error) throw error;
                result = data;
            }
            setSavedInvoice(result);
            setSuccessModal(true);
        } catch (err) {
            alert('Fehler: ' + (err.message || 'Schema nicht aktuell. Bitte Datenbank-Migration prüfen.'));
        } finally { setSaving(false); }
    };

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><Loader2 className="animate-spin" /></div>;

    // Premium Styles
    const selectStyle = {
        width: '100%',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        fontSize: '0.9rem',
        outline: 'none',
        backgroundColor: 'var(--surface-color)'
    };

    const labelStyle = {
        display: 'block',
        marginBottom: '6px',
        fontWeight: 500,
        fontSize: '0.875rem',
        color: 'var(--text-primary)'
    };

    const sectionTitle = {
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        marginBottom: '1rem'
    };

    return (
        <div style={{ position: 'relative' }}>
            {saving && <LoadingOverlay message="Rechnung wird gespeichert..." />}
            {pdfGenerating && <LoadingOverlay message="PDF wird erstellt..." />}

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: 'var(--spacing-lg)' }}>
                <button onClick={() => navigate('/invoices')} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--spacing-xs)' }}>
                        {isEdit ? 'Rechnung bearbeiten' : 'Rechnung erstellen'}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>
                        {isEdit ? `Rechnungs - Nr.${invoiceNumber} ` : 'Neue Rechnung mit automatischer Nummernvergabe'}
                    </p>
                </div>
            </div>

            {/* Main Layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)' }}>
                {/* LEFT: Sender */}
                <Card>
                    <div style={sectionTitle}>Rechnungssteller</div>
                    <Input label="Name" value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Max Mustermann" />
                    <Input label="Straße & Nr." value={senderStreet} onChange={e => setSenderStreet(e.target.value)} placeholder="Musterstraße 1" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                        <Input label="PLZ" value={senderZip} onChange={e => setSenderZip(e.target.value)} placeholder="12345" />
                        <Input label="Ort" value={senderCity} onChange={e => setSenderCity(e.target.value)} placeholder="Musterstadt" />
                    </div>
                </Card>

                {/* RIGHT: Date / Number / Unit */}
                <Card>
                    <div style={sectionTitle}>Rechnungsdetails</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                        <Input label="Rechnungsdatum" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label style={labelStyle}>Rechnungsnummer</label>
                            <input
                                type="text"
                                value={invoiceNumber}
                                readOnly
                                style={{ ...selectStyle, backgroundColor: 'var(--background-color)', cursor: 'not-allowed', color: '#6b7280' }}
                            />
                        </div>
                    </div>
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label style={labelStyle}>Ferienwohnung</label>
                        <select style={selectStyle} value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)}>
                            <option value="">– Bitte wählen –</option>
                            {vacationUnits.map(u => {
                                const prop = properties.find(p => p.id === u.property_id);
                                const addr = prop ? `${prop.street} ${prop.house_number || ''}, ${prop.zip} ${prop.city} ` : '';
                                return <option key={u.id} value={u.id}>{u.unit_name} – {addr}</option>;
                            })}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)' }}>
                        <Input label="Einzug" type="date" value={moveIn} onChange={e => setMoveIn(e.target.value)} />
                        <Input label="Auszug" type="date" value={moveOut} onChange={e => setMoveOut(e.target.value)} />
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label style={labelStyle}>Nächte</label>
                            <input type="text" value={nights} readOnly style={{ ...selectStyle, backgroundColor: 'var(--background-color)', cursor: 'not-allowed', textAlign: 'center', fontWeight: 600 }} />
                        </div>
                    </div>
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label style={labelStyle}>Anzahl Personen</label>
                        <select style={selectStyle} value={persons} onChange={e => setPersons(parseInt(e.target.value))}>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                    </div>
                </Card>
            </div>

            {/* Recipient */}
            <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={sectionTitle}>Rechnungsempfänger</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Button variant="secondary" size="sm" icon={Search} onClick={() => setContactPickerOpen(true)}>Aus Kontakten</Button>
                        <Button variant="secondary" size="sm" icon={UserPlus} onClick={saveAsContact}>Als Kontakt speichern</Button>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)' }}>
                    <div>
                        <Input label="Name / Firma" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Name des Empfängers" />
                        <Input label="Straße & Nr." value={recipientStreet} onChange={e => setRecipientStreet(e.target.value)} placeholder="Straße" />
                    </div>
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-md)' }}>
                            <Input label="PLZ" value={recipientZip} onChange={e => setRecipientZip(e.target.value)} placeholder="PLZ" />
                            <Input label="Ort" value={recipientCity} onChange={e => setRecipientCity(e.target.value)} placeholder="Ort" />
                        </div>
                    </div>
                </div>
            </Card>

            {/* Positions */}
            <Card style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div style={sectionTitle}>Positionen</div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                <th style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '50px' }}>Pos.</th>
                                <th style={{ padding: '10px 8px', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Bezeichnung</th>
                                <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '120px' }}>Preis/Nacht (€)</th>
                                <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '120px' }}>Netto (€)</th>
                                <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '90px' }}>MwSt 7%</th>
                                <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '120px' }}>Brutto (€)</th>
                                <th style={{ width: '40px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {positions.map((p, idx) => (
                                <tr key={idx} className="table-row" style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600 }}>{p.pos}</td>
                                    <td style={{ padding: '10px 8px' }}>
                                        <textarea
                                            value={p.description}
                                            onChange={e => updatePosition(idx, 'description', e.target.value)}
                                            readOnly={p.isFirst}
                                            rows={2}
                                            style={{
                                                width: '100%', padding: '8px 10px', borderRadius: '8px',
                                                border: '1px solid var(--border-color)', resize: 'vertical',
                                                fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
                                                backgroundColor: p.isFirst ? '#f9fafb' : 'white'
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: '10px 8px' }}>
                                        {p.isFirst ? (
                                            <CurrencyInput
                                                allowDecimals
                                                value={p.pricePerNight}
                                                onChange={e => updatePosition(idx, 'pricePerNight', e.target.value)}
                                                style={{ ...selectStyle, textAlign: 'right' }}
                                            />
                                        ) : (
                                            <div style={{ color: 'var(--text-disabled)', textAlign: 'right', fontSize: '0.8rem' }}>–</div>
                                        )}
                                    </td>
                                    <td style={{ padding: '10px 8px' }}>
                                        <CurrencyInput
                                            allowDecimals
                                            value={p.netTotal}
                                            onChange={e => updatePosition(idx, 'netTotal', e.target.value)}
                                            style={{ ...selectStyle, textAlign: 'right' }}
                                        />
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        {fmt(p.vat)} €
                                    </td>
                                    <td style={{ padding: '10px 8px' }}>
                                        <CurrencyInput
                                            allowDecimals
                                            value={p.grossTotal}
                                            onChange={e => updatePosition(idx, 'grossTotal', e.target.value)}
                                            style={{ ...selectStyle, textAlign: 'right', fontWeight: 600 }}
                                        />
                                    </td>
                                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                        {!p.isFirst && (
                                            <button onClick={() => removePosition(idx)} style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                                <td colSpan={3} style={{ padding: '10px 8px' }}>
                                    <Button variant="secondary" size="sm" icon={Plus} onClick={addPosition}>Position hinzufügen</Button>
                                </td>
                                <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtEur(totalNet)}</td>
                                <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{fmtEur(totalVat)}</td>
                                <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, fontSize: '1.05rem' }}>{fmtEur(totalGross)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </Card>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-xl)' }}>
                <Card style={{ minWidth: '320px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Summe Netto</span><span>{fmtEur(totalNet)}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>MwSt 7%</span><span>{fmtEur(totalVat)}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700, borderTop: '2px solid var(--primary-color)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                            <span>Gesamtsumme Brutto</span><span>{fmtEur(totalGross)}</span>
                        </div>
                        <Button icon={Check} onClick={handleSave} style={{ marginTop: '1rem', width: '100%', padding: '12px' }}>RECHNUNG SPEICHERN</Button>
                    </div>
                </Card>
            </div>

            {/* Modals */}
            <Modal isOpen={successModal} onClose={() => navigate('/invoices')} title="Erfolg">
                <div style={{ textAlign: 'center', padding: '1rem' }}>
                    <p style={{ marginBottom: '1.5rem' }}>Die Rechnung wurde erfolgreich gespeichert.</p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        <Button variant="secondary" icon={Printer} onClick={() => handlePrint(savedInvoice)}>Drucken</Button>
                        <Button variant="secondary" icon={Download} onClick={() => handlePDF(savedInvoice)}>PDF</Button>
                        <Button onClick={() => navigate('/invoices')}>Schließen</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={contactPickerOpen} onClose={() => setContactPickerOpen(false)} title="Kontakt wählen">
                <Input icon={Search} placeholder="Name suchen..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
                <div style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '1rem' }}>
                    {filteredContacts.map(c => (
                        <div key={c.id} onClick={() => selectContact(c)} style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                            <div style={{ fontWeight: 600 }}>{c.name}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.street}, {c.zip} {c.city}</div>
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    );
};

export default InvoiceForm;
