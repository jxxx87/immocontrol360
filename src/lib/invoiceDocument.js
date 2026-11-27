// Gemeinsame, vorlagenbasierte Rechnungs-/Gutschrift-Erzeugung.
//
// Diese Logik ist eine 1:1-Übernahme der erprobten Pipeline aus Invoices.jsx,
// damit ALLE Rechnungen (Liste UND Rechnungsformular) über dieselbe
// Schreibvorlage (document_templates type 'fewo_invoice'/'fewo_credit_note')
// und denselben Renderer laufen. So bleibt die Ausgabe konsistent und es gibt
// keine zweite, abweichende PDF-Pipeline mehr (vorher: manuelles jsPDF in InvoiceForm).

import { supabase } from './supabase';

const fmt = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DEFAULT_FEWO_INVOICE = `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Leistungszeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Rechnung Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>wir bedanken uns herzlich für Ihren Aufenthalt in unserem Hause. Vereinbarungsgemäß erlauben wir uns, Ihnen die erbrachten Leistungen in Rechnung zu stellen:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Bitte überweisen Sie den fälligen Gesamtbetrag innerhalb von 14 Tagen auf unser angegebenes Bankkonto.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`;

export const DEFAULT_FEWO_CREDIT_NOTE = `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="gast_name" data-label="Gast-Name">Gast-Name</span></strong><br><span data-type="mention" data-id="gast_adresse" data-label="Gast-Adresse">Gast-Adresse</span></div><div class="letter-date" style="text-align: right; background-color: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 10pt; line-height: 1.4;">Nummer: <strong><span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></strong><br>Datum: <strong><span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></strong><br>Leistungszeitraum: <strong><span data-type="mention" data-id="buchungszeitraum" data-label="Buchungszeitraum">Buchungszeitraum</span></strong></div></div><div class="letter-subject">Gutschrift Nr. <span data-type="mention" data-id="rechnungsnummer" data-label="Rechnungsnummer">Rechnungsnummer</span></div><div class="letter-body"><p>Sehr geehrte Damen und Herren,</p><p>vereinbarungsgemäß erhalten Sie nachfolgend die Gutschrift für Ihren Aufenthalt bzw. Ihre Buchung:</p><p><span data-type="mention" data-id="positions_tabelle" data-label="Rechnungspositionen-Tabelle">Rechnungspositionen-Tabelle</span></p><p>Der Gutschriftbetrag wird Ihrem Konto in den nächsten Tagen gutgeschrieben oder vereinbarungsgemäß verrechnet.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`;

// Einheitliche Platzhalter-Ersetzung (identisch zu Invoices.jsx / UtilityCosts.jsx)
export const replaceHTMLVariables = (htmlStr, vars) => {
    if (!htmlStr) return '';
    let result = htmlStr;
    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`(<span[^>]*data-id="${key}"[^>]*>.*?<\/span>|{${key}})`, 'g');
        result = result.replace(regex, value ?? '');
    }
    return result;
};

// Lädt die Rechnungs-/Gutschrift-Schreibvorlage (portfolio-spezifisch -> global -> Default-Fallback).
export const fetchInvoiceTemplates = async (user, portfolioId) => {
    const results = { fewo_invoice_template: null, fewo_credit_note_template: null };
    if (!user) return results;
    try {
        let invoiceQuery = supabase.from('document_templates').select('content_html').eq('type', 'fewo_invoice');
        invoiceQuery = portfolioId
            ? invoiceQuery.eq('portfolio_id', portfolioId)
            : invoiceQuery.eq('user_id', user.id).is('portfolio_id', null);
        let { data: invData } = await invoiceQuery.maybeSingle();
        if (!invData && portfolioId) {
            const { data: globalInv } = await supabase
                .from('document_templates').select('content_html')
                .eq('user_id', user.id).eq('type', 'fewo_invoice').is('portfolio_id', null).maybeSingle();
            if (globalInv) invData = globalInv;
        }
        if (invData?.content_html) results.fewo_invoice_template = invData.content_html;

        let cnQuery = supabase.from('document_templates').select('content_html').eq('type', 'fewo_credit_note');
        cnQuery = portfolioId
            ? cnQuery.eq('portfolio_id', portfolioId)
            : cnQuery.eq('user_id', user.id).is('portfolio_id', null);
        let { data: cnData } = await cnQuery.maybeSingle();
        if (!cnData && portfolioId) {
            const { data: globalCn } = await supabase
                .from('document_templates').select('content_html')
                .eq('user_id', user.id).eq('type', 'fewo_credit_note').is('portfolio_id', null).maybeSingle();
            if (globalCn) cnData = globalCn;
        }
        if (cnData?.content_html) results.fewo_credit_note_template = cnData.content_html;
    } catch (e) {
        console.error('Error fetching invoice writing templates:', e);
    }
    return results;
};

// Erzeugt das vollständige Druck-HTML (A4-Briefseite) für eine Rechnung/Gutschrift.
export const generateInvoiceHtml = (inv, { portfolios = [], writingTemplates = null } = {}) => {
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

    const templateHtml = isCredit
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
            padding: 20mm 20mm 35mm 25mm;
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
        .letter-page > p { min-height: 1.2em; margin: 0; }
        .letter-sender { font-size: 8pt; color: #555555; border-bottom: 1px solid #cccccc; padding-bottom: 2mm; margin-bottom: 5mm; text-transform: uppercase; letter-spacing: 0.5px; }
        .letter-header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10mm; }
        .letter-recipient { width: 85mm; font-size: 10pt; line-height: 1.4; color: #111111; text-align: left; }
        .letter-date { font-size: 10pt; color: #333333; text-align: right; }
        .letter-subject { font-size: 13pt; font-weight: bold; margin-bottom: 4mm; color: #000000; text-align: left; }
        .letter-object { font-size: 10pt; color: #444444; margin-bottom: 8mm; padding-bottom: 2mm; border-bottom: 1px dotted #e2e8f0; text-align: left; }
        .letter-body { flex-grow: 1; flex-shrink: 1; min-height: 0; overflow: hidden; font-size: 11pt; line-height: 1.6; text-align: left; }
        .letter-body p { margin-bottom: 1em !important; }
        .letter-footer { position: absolute !important; bottom: 10mm !important; left: 25mm !important; right: 20mm !important; height: 18mm !important; margin-top: 0 !important; display: flex !important; justify-content: space-between !important; border-top: 1px solid #dddddd !important; padding-top: 3mm !important; font-size: 8pt !important; color: #666666 !important; line-height: 1.4 !important; text-align: left !important; box-sizing: border-box !important; background-color: #ffffff !important; }
        .footer-col { width: 30%; white-space: pre-wrap; }
        .variable-chip { white-space: pre-wrap; background: transparent; border: none; padding: 0; color: inherit; font-weight: normal; font-family: inherit; }
        .variable-chip.multiline-variable { display: inline-block; max-width: 100%; vertical-align: top; line-height: 1.4; }
        @media print { body { margin: 0; padding: 0; background: #fff; } }
    </style>
    </head>
    <body>
        ${renderedContent}
    </body>
    </html>`;
};

// Öffnet ein Druckfenster und löst den Browser-Druck aus.
export const printInvoice = async (inv, { user, portfolios } = {}) => {
    const writingTemplates = await fetchInvoiceTemplates(user, inv.portfolio_id);
    const html = generateInvoiceHtml(inv, { portfolios, writingTemplates });
    const win = window.open('', '_blank');
    if (!win) {
        alert('Bitte Popups erlauben.');
        return;
    }
    const isCredit = inv.status === 'credited';
    const displayNum = isCredit ? `GS-${inv.invoice_number || 'ENTWURF'}` : (inv.invoice_number || 'ENTWURF');
    const filename = `${isCredit ? 'Gutschrift' : 'Rechnung'}_${displayNum}`;
    win.document.open();
    win.document.write(html);
    const script = win.document.createElement('script');
    script.textContent = `document.title = "${filename}";`;
    win.document.head.appendChild(script);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 800);
};

// Erzeugt und lädt das PDF (html2pdf, identisch zur Rechnungsliste).
export const downloadInvoicePdf = async (inv, { user, portfolios } = {}) => {
    const writingTemplates = await fetchInvoiceTemplates(user, inv.portfolio_id);
    const html = generateInvoiceHtml(inv, { portfolios, writingTemplates });

    const loadScript = () => new Promise((resolve) => {
        if (window.html2pdf) return resolve();
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
        script.onload = resolve;
        document.head.appendChild(script);
    });
    await loadScript();

    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    await new Promise(r => setTimeout(r, 500));

    const isCredit = inv.status === 'credited';
    const recipientName = inv.recipient_name || (inv.tenant?.name || 'Unbekannt');
    const displayNum = isCredit ? `GS-${inv.invoice_number || 'ENTWURF'}` : (inv.invoice_number || 'ENTWURF');
    const safeName = recipientName.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim().replace(/\s+/g, '_');
    const filename = `${isCredit ? 'Gutschrift' : 'Rechnung'}_${displayNum}_${safeName}.pdf`;

    return window.html2pdf().set({
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(iframe.contentDocument.body).save().then(() => {
        document.body.removeChild(iframe);
    });
};
