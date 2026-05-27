import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabase';
import QRCode from 'qrcode';

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('de-DE');
};

const DEFAULT_DUNNING_TEMPLATES = {
    payment_reminder: {
        subject: 'Zahlungserinnerung zu offenen Mietforderungen',
        content_html: `<p>Sehr geehrte/r <span data-id="mieter_anrede">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-id="nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p><p>Trotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen. Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.</p><p><span data-id="forderungs_tabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-id="offener_betrag">Offener Betrag</span> spätestens bis zum <span data-id="zahlungsfrist_datum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-id="vermieter_bankverbindung">Vermieter Bankverbindung</span></p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><span data-id="vermieter_name">Vermieter Name</span></p>`
    },
    dunning_1: {
        subject: 'Mahnung wegen Mietrückstand',
        content_html: `<p>Sehr geehrte/r <span data-id="mieter_anrede">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-id="nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-id="forderungs_tabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-id="offener_betrag">Offener Betrag</span> spätestens bis zum <span data-id="zahlungsfrist_datum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-id="vermieter_bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><span data-id="vermieter_name">Vermieter Name</span></p>`
    },
    dunning_2: {
        subject: 'Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug',
        content_html: `<p>Sehr geehrte/r <span data-id="mieter_anrede">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-id="nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-id="forderungs_tabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-id="offener_betrag">Offener Betrag</span> spätestens bis zum <span data-id="zahlungsfrist_datum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-id="vermieter_bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Aufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><span data-id="vermieter_name">Vermieter Name</span></p>`
    },
    dunning_final: {
        subject: 'Letzte Zahlungsaufforderung vor weiteren Schritten',
        content_html: `<p>Sehr geehrte/r <span data-id="mieter_anrede">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-id="nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-id="forderungs_tabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-id="offener_betrag">Offener Betrag</span> spätestens bis zum <span data-id="zahlungsfrist_datum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-id="vermieter_bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><span data-id="vermieter_name">Vermieter Name</span></p>`
    }
};

const drawDunningText = (doc, htmlText, variables, margin, usableWidth, pageHeight, yPos) => {
    let text = htmlText;
    
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`(<span[^>]*data-id="${key}"[^>]*>.*?<\/span>|{${key}})`, 'g');
        text = text.replace(regex, value);
    }

    let cleanText = text
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '\n\n')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();

    const paragraphs = cleanText.split('\n\n');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    for (const p of paragraphs) {
        if (!p.trim()) continue;

        if (p.includes('fristlosen Kündigung') || p.includes('Kontoinhaber:') || p.includes('Zahlungsfrist:')) {
            doc.setFont('helvetica', 'bold');
        } else {
            doc.setFont('helvetica', 'normal');
        }

        const splitP = doc.splitTextToSize(p.trim(), usableWidth);
        
        if (yPos + splitP.length * 5 > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
        }

        doc.text(splitP, margin, yPos);
        yPos += splitP.length * 5 + 6;
    }

    return yPos;
};

export const generateClaimPdf = async (claim, totals, items, documentType, deadlineDays, internalNote, targetItemId, portalLinkData) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const usableWidth = pageWidth - (margin * 2);
    let yPos = margin;

    // Fetch Sender Data
    const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, company, street, house_number, zip, city, bank_name, iban, bic')
        .eq('id', claim.user_id)
        .single();

    const senderName = profile?.company || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Vermieter';
    const senderStreet = `${profile?.street || ''} ${profile?.house_number || ''}`.trim();
    const senderCity = `${profile?.zip || ''} ${profile?.city || ''}`.trim();
    const senderLine = `${senderName} · ${senderStreet} · ${senderCity}`;

    // Tenant Data
    const tenant = claim.tenants || {};
    const tenantName = `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim();
    // Fallback tenant address to property address
    const prop = claim.leases?.units?.properties || {};
    const tenantStreet = `${prop.street || ''} ${prop.house_number || ''}`.trim();
    const tenantCity = `${prop.zip || ''} ${prop.city || ''}`.trim();

    // Setup Fonts
    doc.setFont('helvetica');

    // 1. Absenderzeile (DIN 5008 Typ B: y=45)
    yPos = 45;
    doc.setFontSize(6); // Max 2mm height
    doc.setTextColor(0, 0, 0);
    doc.text(senderLine, margin, yPos);
    
    // Zone 2 is a 20mm blank space for Sendungskennzeichnung
    yPos += 20;

    // 2. Empfängerblock (Zone 3 starts at Y=65)
    doc.setFontSize(9); // Min 9pt for 5 lines
    doc.text('Herrn/Frau', margin, yPos);
    yPos += 5;
    doc.text(tenantName, margin, yPos);
    yPos += 5;
    doc.text(tenantStreet, margin, yPos);
    yPos += 5;
    doc.text(tenantCity, margin, yPos);

    // Fetch Portfolio Bank Data (if available)
    const portfolioId = claim.leases?.units?.properties?.portfolio_id;
    let portfolio = null;
    if (portfolioId) {
        const { data: pData } = await supabase
            .from('portfolios')
            .select('bank_name, iban, bic')
            .eq('id', portfolioId)
            .single();
        portfolio = pData;
    }

    // Load Template from DB
    let templateType = 'payment_reminder';
    if (documentType === 'Mahnung') templateType = 'dunning_1';
    else if (documentType === 'Abmahnung') templateType = 'dunning_2';
    else if (documentType === 'Letzte Zahlungsaufforderung' || documentType === 'dunning_final') templateType = 'dunning_final';
    
    if (!['payment_reminder', 'dunning_1', 'dunning_2', 'dunning_final'].includes(templateType)) {
        if (documentType.toLowerCase().includes('erinnerung')) templateType = 'payment_reminder';
        else if (documentType.toLowerCase().includes('abmahnung')) templateType = 'dunning_2';
        else if (documentType.toLowerCase().includes('letzte')) templateType = 'dunning_final';
        else templateType = 'dunning_1';
    }

    let template = DEFAULT_DUNNING_TEMPLATES[templateType];
    try {
        let query = supabase
            .from('document_templates')
            .select('*')
            .eq('user_id', claim.user_id)
            .eq('type', templateType);

        if (portfolioId) {
            query = query.eq('portfolio_id', portfolioId);
        } else {
            query = query.is('portfolio_id', null);
        }

        const { data, error } = await query.maybeSingle();
        if (!error && data) {
            template = data;
        } else if (portfolioId) {
            const { data: globalData } = await supabase
                .from('document_templates')
                .select('*')
                .eq('user_id', claim.user_id)
                .eq('type', templateType)
                .is('portfolio_id', null)
                .maybeSingle();
            if (globalData) template = globalData;
        }
    } catch (e) {
        console.error('Error fetching template for dunning PDF:', e);
    }

    // 3. Ort, Datum rechts (DIN 5008: below fold 1, roughly y=105)
    yPos = 105;
    doc.setFontSize(11);
    const docDate = new Date();
    const dateStr = docDate.toLocaleDateString('de-DE');
    const placeDate = `${profile?.city || 'Ort'}, den ${dateStr}`;
    doc.text(placeDate, pageWidth - margin - doc.getTextWidth(placeDate), yPos);
    yPos += 15;

    // 5. Betreff
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    const subject = template.subject || DEFAULT_DUNNING_TEMPLATES[templateType].subject;
    doc.text(subject, margin, yPos);
    yPos += 8;

    // Mietobjekt
    doc.setFont('helvetica', 'normal');
    const unitName = claim.leases?.units?.unit_name ? ` (Einheit: ${claim.leases?.units?.unit_name})` : '';
    const objStr = `Mietobjekt: ${prop.street || ''} ${prop.house_number || ''}, ${prop.zip || ''} ${prop.city || ''}${unitName}`;
    doc.text(objStr, margin, yPos);
    yPos += 15;

    // Haupttext
    doc.text(`Sehr geehrte/r ${tenantName},`, margin, yPos);
    yPos += 10;
    
    const endDate = new Date();
    const interestRate = claim.interest_rate || 5.0;
    
    // Check if single item
    let activeItems = JSON.parse(JSON.stringify(items));
    let isSingleItem = false;
    let activeTotals = { ...totals };
    
    // DYNAMIC INTEREST CALCULATION & BREAKDOWN
    let totalCalculatedInterest = 0;
    for (let i = 0; i < activeItems.length; i++) {
        let item = activeItems[i];
        if (Number(item.open_amount) <= 0) continue;
        
        let dynamicInterest = 0;
        item.claim_items.interest_breakdown = [];
        
        if (item.claim_items?.rent_ledger_ids && item.claim_items.rent_ledger_ids.length > 1) {
            const { data: ledgers } = await supabase
                .from('rent_ledger')
                .select('period_month, expected_rent, paid_amount')
                .in('id', item.claim_items.rent_ledger_ids)
                .order('period_month', { ascending: true });
                
            if (ledgers) {
                let remainingOpen = Number(item.open_amount);
                for (let ledger of ledgers) {
                    let ledgerOpen = Math.min(remainingOpen, Number(ledger.expected_rent) - Number(ledger.paid_amount));
                    if (ledgerOpen <= 0) continue;
                    
                    let fM = new Date(ledger.period_month);
                    fM.setDate(fM.getDate() + 3);
                    if (fM > endDate) fM = endDate;
                    
                    const diffTime = Math.max(0, endDate - fM);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    const ledgerInt = (ledgerOpen * interestRate * diffDays) / (100 * 365);
                    dynamicInterest += ledgerInt;
                    remainingOpen -= ledgerOpen;
                    
                    item.claim_items.interest_breakdown.push({
                        description: `Mietrückstand ${new Date(ledger.period_month).toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' })}`,
                        amount: ledgerOpen,
                        fM: fM,
                        diffDays: diffDays,
                        interest: ledgerInt
                    });
                }
            }
        } else {
            let fM = new Date(item.claim_items?.due_date || item.claim_items?.period_month || claim.interest_start_date || new Date());
            if (fM > endDate) fM = endDate;

            const diffTime = Math.max(0, endDate - fM);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            dynamicInterest = (Number(item.open_amount) * interestRate * diffDays) / (100 * 365);
            
            item.claim_items.interest_breakdown.push({
                description: item.claim_items?.description || item.claim_items?.item_type || 'Forderung',
                amount: Number(item.open_amount),
                fM: fM,
                diffDays: diffDays,
                interest: dynamicInterest
            });
        }
        item.claim_items.dynamic_interest = dynamicInterest;
    }
    
    if (targetItemId) {
        const item = activeItems.find(i => i.claim_item_id === targetItemId);
        if (item) {
            activeItems = [item];
            isSingleItem = true;
            
            const itemFee = Number(item.claim_items?.fee_amount || 0);
            const itemInterest = Number(item.claim_items?.dynamic_interest || 0);
            const principalOpen = Number(item.open_amount);
            
            activeTotals = {
                current_principal_open: principalOpen,
                total_interest_open: itemInterest,
                total_fees_open: itemFee,
                total_due: principalOpen + itemInterest + itemFee
            };
        }
    } else {
        let totalFees = 0;
        let totalInterest = 0;
        let totalPrincipalOpen = 0;
        activeItems.forEach(item => {
            const openAmt = Number(item.open_amount || 0);
            const itemFee = Number(item.claim_items?.fee_amount || 0);
            const itemInterest = Number(item.claim_items?.dynamic_interest || 0);
            totalFees += itemFee;
            totalInterest += itemInterest;
            totalPrincipalOpen += openAmt;
        });
        activeTotals = {
            current_principal_open: totalPrincipalOpen,
            total_interest_open: totalInterest,
            total_fees_open: totalFees,
            total_due: totalPrincipalOpen + totalInterest + totalFees
        };
    }

    // Prepare variables for text replacement
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + parseInt(deadlineDays));
    const nextDay = new Date(deadlineDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    const bankName = portfolio?.bank_name || profile?.bank_name;
    const iban = portfolio?.iban || profile?.iban;
    const bic = portfolio?.bic || profile?.bic;
    const vwz = `Mietrückstand ${prop.street || ''}`;
    
    const bankDetailsStr = (iban && iban.trim() !== '')
        ? `Kontoinhaber: ${senderName}, ${bankName ? 'Bank: ' + bankName + ', ' : ''}IBAN: ${iban}${bic ? ', BIC: ' + bic : ''}, Verwendungszweck: ${vwz}`
        : 'das Ihnen bekannte Bankkonto';

    const leaseStart = claim.leases?.start_date ? formatDate(claim.leases.start_date) : 'Mietbeginn';
    
    const variables = {
        mieter_name: tenantName,
        mieter_anrede: `Sehr geehrte/r ${tenantName}`,
        mieter_adresse: `${tenantStreet}, ${tenantCity}`,
        objekt_name: prop.name || 'Immobilie',
        einheit_name: claim.leases?.units?.unit_name || 'Einheit',
        objekt_adresse: `${prop.street || ''} ${prop.house_number || ''}, ${prop.zip || ''} ${prop.city || ''}`.trim(),
        offener_betrag: formatCurrency(activeTotals.total_due),
        zahlungsfrist_datum: deadlineDate.toLocaleDateString('de-DE'),
        verzugstage: activeItems.length > 0 ? (activeItems[0].claim_items?.interest_breakdown?.[0]?.diffDays || '0') : '0',
        mahnstufe: documentType,
        zinsbetrag: formatCurrency(activeTotals.total_interest_open),
        nutzungszeitraum: leaseStart,
        vermieter_name: senderName,
        vermieter_bankverbindung: bankDetailsStr
    };

    // Split template into text before and after the table
    const fullTextHtml = template.content_html || DEFAULT_DUNNING_TEMPLATES[templateType].content_html;
    const parts = fullTextHtml.split(/<span[^>]*data-id="forderungs_tabelle"[^>]*>.*?<\/span>|{forderungs_tabelle}/);

    const beforeTableHtml = parts[0] || '';
    const afterTableHtml = parts[1] || '';

    // Draw before table text
    yPos = drawDunningText(doc, beforeTableHtml, variables, margin, usableWidth, pageHeight, yPos);

    // Forderungszusammenfassung Table
    autoTable(doc, {
        startY: yPos,
        margin: { left: margin },
        tableWidth: usableWidth * 0.8,
        theme: 'plain',
        body: [
            [isSingleItem ? (activeItems[0].claim_items?.description || 'Hauptforderung') : 'Offene Hauptforderungen (Miete/Nebenkosten etc.)', formatCurrency(activeTotals.current_principal_open)],
            [`Verzugszinsen bis einschließlich ${dateStr}`, formatCurrency(activeTotals.total_interest_open)],
            ['Mahnauslagen für dieses Schreiben', formatCurrency(activeTotals.total_fees_open)]
        ],
        columnStyles: {
            0: { fontStyle: 'normal', textColor: [0, 0, 0] },
            1: { halign: 'right', fontStyle: 'normal', textColor: [0, 0, 0] }
        },
        styles: { fontSize: 11, cellPadding: 2 }
    });
    
    yPos = doc.lastAutoTable.finalY;
    
    autoTable(doc, {
        startY: yPos,
        margin: { left: margin },
        tableWidth: usableWidth * 0.8,
        theme: 'plain',
        body: [
            [`Gesamtforderung zum ${dateStr}`, formatCurrency(activeTotals.total_due)]
        ],
        columnStyles: {
            0: { fontStyle: 'bold', textColor: [0, 0, 0] },
            1: { halign: 'right', fontStyle: 'bold', textColor: [0, 0, 0] }
        },
        styles: { fontSize: 11, cellPadding: 2 }
    });

    yPos = doc.lastAutoTable.finalY + 10;

    // Draw after table text
    yPos = drawDunningText(doc, afterTableHtml, variables, margin, usableWidth, pageHeight, yPos);

    yPos += 5;

    // QR Code / Forderungsportal
    if (portalLinkData && portalLinkData.token && portalLinkData.pin) {
        const portalUrl = portalLinkData.link || `${window.location.origin}/forderung/portal/${portalLinkData.token}`;
        
        try {
            const qrDataUrl = await QRCode.toDataURL(portalUrl, { margin: 1, width: 120 });
            const qrSize = 35;
            
            const boxWidth = usableWidth;
            const boxPadding = 12;
            const textWidth = boxWidth - (boxPadding * 2);
            
            const titleText = 'Online Forderungsportal';
            const infoText = 'Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.';
            const pinText = `Zugangscode (PIN): ${portalLinkData.pin}`;
            
            doc.setFontSize(9.5);
            const splitPortalText = doc.splitTextToSize(infoText, textWidth);
            const infoLinesCount = splitPortalText.length;
            
            // Calculate total height of the box:
            // Padding Top (8) + QR Code (35) + Gap (6) + Title (5) + Gap (4) + Text Lines (count * 4.5) + Gap (5) + PIN (6) + Padding Bottom (8)
            const boxHeight = 8 + qrSize + 6 + 5 + 4 + (infoLinesCount * 4.5) + 5 + 6 + 8;
            
            if (yPos + boxHeight > pageHeight - margin) {
                doc.addPage();
                yPos = margin;
            }
            
            // Draw background gray box
            doc.setFillColor(245, 247, 250);
            doc.rect(margin, yPos, boxWidth, boxHeight, 'F');
            
            // Draw dashed border
            doc.setDrawColor(180, 187, 200);
            doc.setLineWidth(0.4);
            doc.setLineDashPattern([2, 2], 0);
            doc.rect(margin, yPos, boxWidth, boxHeight, 'D');
            doc.setLineDashPattern([], 0); // reset to solid lines
            
            // Add QR Code centered
            const qrX = margin + (boxWidth - qrSize) / 2;
            const qrY = yPos + 8;
            doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
            
            // Add Title centered
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(30, 41, 59);
            doc.text(titleText, margin + (boxWidth / 2), qrY + qrSize + 7, { align: 'center' });
            
            // Add Info Text centered
            doc.setFontSize(9.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(71, 85, 105);
            const textYStart = qrY + qrSize + 7 + 6;
            for (let i = 0; i < splitPortalText.length; i++) {
                doc.text(splitPortalText[i], margin + (boxWidth / 2), textYStart + (i * 4.5), { align: 'center' });
            }
            
            // Add PIN centered
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(30, 41, 59);
            const pinY = textYStart + (infoLinesCount * 4.5) + 4;
            doc.text(pinText, margin + (boxWidth / 2), pinY, { align: 'center' });
            
            // Reset text color to black for following text
            doc.setTextColor(0, 0, 0);
            
            yPos += boxHeight + 12; // Add 12mm of space below the box
        } catch (qrErr) {
            console.error('Failed to generate QR code', qrErr);
        }
    }

    // Schluss
    if (yPos + 40 > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
    }
    
    doc.text('Mit freundlichen Grüßen', margin, yPos);
    yPos += 15;
    doc.text(senderName, margin, yPos);
    yPos += 15;

    doc.setFontSize(9);
    doc.text('Anlagen:', margin, yPos);
    yPos += 5;
    doc.text('1. Forderungsaufstellung', margin, yPos);
    yPos += 5;
    doc.text('2. Zinsberechnung', margin, yPos);
    yPos += 5;
    doc.text('3. Übersicht: Ablauf bei Mietrückstand und mögliche Folgekosten', margin, yPos);

    // ==========================================
    // ANLAGE 1: Forderungsaufstellung
    // ==========================================
    doc.addPage();
    let currentY = margin;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Anlage 1: Forderungsaufstellung', margin, currentY);
    currentY += 10;

    autoTable(doc, {
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [['Position', 'Forderungsbetrag', 'Zahlung / Anrechnung', 'Offener Betrag']],
        body: activeItems.map(item => [
            item.claim_items?.description || item.claim_items?.item_type || 'Forderung',
            formatCurrency(item.original_amount),
            item.paid_principal > 0 ? formatCurrency(item.paid_principal) : '0,00 €',
            formatCurrency(item.open_amount)
        ]),
        foot: [['Summe offener Hauptforderungen', '', '', formatCurrency(activeTotals.current_principal_open)]],
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 3, textColor: [0, 0, 0], lineColor: [200, 200, 200], lineWidth: 0.1 },
        columnStyles: {
            1: { halign: 'right' },
            2: { halign: 'right' },
            3: { halign: 'right', fontStyle: 'bold' }
        }
    });

    // ==========================================
    // ANLAGE 2: Zinsberechnung
    // ==========================================
    currentY = doc.lastAutoTable.finalY + 20;
    if (currentY > pageHeight - 60) {
        doc.addPage();
        currentY = margin;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Anlage 2: Zinsberechnung', margin, currentY);
    currentY += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const zinsText = `Berechnet werden dürfen Verzugszinsen nach § 288 Abs. 1 BGB mit fünf Prozentpunkten über dem jeweiligen Basiszinssatz. Für die Berechnung wurde aus Kulanz lediglich ein Zinssatz von ${Number(claim.interest_rate || 5.00).toFixed(2)}% p.a. verwendet.`;
    const splitZins = doc.splitTextToSize(zinsText, usableWidth);
    doc.text(splitZins, margin, currentY);
    currentY += splitZins.length * 5 + 5;

    const endDateRef = new Date();
    let totalCalculatedInterestRef = 0;
    const interestBody = [];

    activeItems.filter(item => Number(item.open_amount) > 0).forEach(item => {
        if (item.claim_items?.interest_breakdown) {
            item.claim_items.interest_breakdown.forEach(b => {
                totalCalculatedInterestRef += b.interest;
                interestBody.push([
                    b.description,
                    formatCurrency(b.amount),
                    `${b.fM.toLocaleDateString('de-DE')} - ${endDateRef.toLocaleDateString('de-DE')}`,
                    b.diffDays.toString(),
                    formatCurrency(b.interest)
                ]);
            });
        }
    });

    // If there is no item with open amount, show a fallback
    if (interestBody.length === 0) {
        interestBody.push(['Keine offenen Beträge für Zinsberechnung', '', '', '', '0,00 €']);
    }

    autoTable(doc, {
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [['Position', 'Verzinslicher Betrag', 'Zeitraum', 'Tage', 'Zinsen']],
        body: interestBody,
        foot: [['Summe berechneter Verzugszinsen', '', '', '', formatCurrency(totalCalculatedInterestRef)]],
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 3, textColor: [0, 0, 0], lineColor: [200, 200, 200], lineWidth: 0.1 },
        columnStyles: {
            1: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right', fontStyle: 'bold' }
        }
    });

    // ==========================================
    // ANLAGE 3: Ablauf bei Mietrückstand
    // ==========================================
    doc.addPage();
    currentY = margin;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Anlage 3: Ablauf bei Mietrückstand und mögliche Folgekosten', margin, currentY);
    currentY += 10;

    autoTable(doc, {
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [['Schritt', 'Erläuterung', 'Mögliche Folgekosten']],
        body: [
            ['1. Mietzahlung fällig', 'Die Miete ist bis spätestens zum dritten Werktag des Monats zu zahlen.', 'Keine Zusatzkosten bei fristgerechter Zahlung'],
            ['2. Rückstand festgestellt', 'Offene Miete wird ermittelt und tagesgenaue Verzugszinsen laufen an.', 'Verzugszinsen nach § 288 BGB'],
            ['3. Mahnung / Abmahnung', 'Zahlungsfrist wird gesetzt. Die Forderung wird schriftlich beziffert.', 'Auslagen für Porto/Druck'],
            ['4. Keine fristgerechte Zahlung', 'Weitere Beitreibung kann eingeleitet werden: Anwalt, Mahnbescheid oder Klage.', 'Rechtsverfolgungs- und Gerichtskosten möglich'],
            ['5. Kündigungsprüfung', 'Bei erheblichem Mietrückstand kann eine fristlose, hilfsweise ordentliche Kündigung geprüft werden.', 'Weitere Kostenrisiken für den Mieter'],
            ['6. Gerichtliche Durchsetzung', 'Bei weiterem Ausbleiben kann die Forderung tituliert und vollstreckt werden; bei Kündigung ggf. Räumungsklage.', 'Gerichts-, Anwalts- und Vollstreckungskosten möglich']
        ],
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 4, textColor: [0, 0, 0], lineColor: [200, 200, 200], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 40, fontStyle: 'bold' }
        }
    });

    currentY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Wichtig: Durch vollständige und fristgerechte Zahlung können weitere Kosten und rechtliche Schritte vermieden werden. Die tatsächlichen Kosten hängen vom weiteren Verlauf und den gesetzlichen Gebühren ab.', margin, currentY, { maxWidth: usableWidth });

    // ==========================================
    // FOOTER (All Pages)
    // ==========================================
    const pageCount = doc.internal.getNumberOfPages();
    const footerText = `${documentType} - Stand ${dateStr}`;
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(footerText, margin, pageHeight - 10);
        doc.text(`Seite ${i} von ${pageCount}`, pageWidth - margin - 20, pageHeight - 10);
    }

    // Generate output
    const cleanTenantName = tenantName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    const dateYMD = docDate.toISOString().split('T')[0];
    const fileName = `${documentType}_Zahlungsverzug_${cleanTenantName}_${dateYMD}.pdf`;

    // Calculate SHA256 (for tracking)
    const pdfArrayBuffer = doc.output('arraybuffer');
    const hashBuffer = await crypto.subtle.digest('SHA-256', pdfArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const document_sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Open PDF in new tab
    const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, '_blank');

    // Create Metadata Snapshot
    const eventMetadata = {
        document_type: documentType,
        snapshot_date: docDate.toISOString(),
        principal_snapshot: activeTotals.current_principal_open,
        fees_snapshot: activeTotals.total_fees_open,
        interest_snapshot: activeTotals.total_interest_open,
        total_snapshot: activeTotals.total_due,
        deadline: deadlineDate.toISOString(),
        document_path: fileName,
        document_sha256: document_sha256,
        template_reference: "Abmahnung_Zahlungsverzug_Marco_Weber_2026-05-19(1).docx",
        target_item_id: targetItemId || null
    };

    // Save to claim_events (Deduplicate by documentType)
    const { data: existingEvents } = await supabase
        .from('claim_events')
        .select('id, event_metadata')
        .eq('claim_id', claim.id)
        .eq('event_type', 'dunning_sent');

    const existingEvent = existingEvents?.find(e => e.event_metadata?.document_type === documentType);

    if (existingEvent) {
        // Update the existing event to refresh its timestamp and metadata
        const { error: updateError } = await supabase
            .from('claim_events')
            .update({
                event_date: new Date().toISOString(),
                event_metadata: eventMetadata
            })
            .eq('id', existingEvent.id);
            
        if (updateError) console.error('Error updating claim_event:', updateError);
    } else {
        // Insert new event
        const { error: eventError } = await supabase.from('claim_events').insert([{
            user_id: claim.user_id,
            claim_id: claim.id,
            event_type: 'dunning_sent',
            description: `${documentType} generiert`,
            event_metadata: eventMetadata
        }]);

        if (eventError) {
            console.error('Error saving claim_event:', eventError);
            throw new Error('Fehler beim Speichern der Historie.');
        }
    }

    // Optional: Upload to Supabase Storage if a bucket exists
    // const { error: uploadError } = await supabase.storage.from('claims_documents').upload(`${claim.id}/${fileName}`, pdfBlob);

    return { fileName, eventMetadata };
};
