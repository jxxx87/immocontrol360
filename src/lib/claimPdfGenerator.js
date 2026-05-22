import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabase';

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('de-DE');
};

export const generateClaimPdf = async (claim, totals, items, documentType, deadlineDays, internalNote, targetItemId) => {
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
    let subject = '';
    let mainTextIntro = '';
    let callToAction = '';
    let legalText = '';

    if (documentType === 'Zahlungserinnerung') {
        subject = 'Zahlungserinnerung zu offenen Mietforderungen';
        callToAction = 'Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.';
        legalText = 'Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.';
    } else if (documentType === 'Mahnung') {
        subject = 'Mahnung wegen Mietrückstand';
        callToAction = 'Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.';
        legalText = 'Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.\n\nSollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.';
    } else if (documentType === 'Abmahnung') {
        subject = 'Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug';
        callToAction = 'Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.';
        legalText = 'Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.\n\nAufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.\n\nSollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.';
    } else {
        subject = 'Letzte Zahlungsaufforderung vor weiteren Schritten';
        callToAction = 'Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.';
        legalText = 'Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.\n\nSollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.';
    }

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
    
    // Check if single item
    let activeItems = items;
    let isSingleItem = false;
    let activeTotals = { ...totals };
    
    if (targetItemId) {
        const item = items.find(i => i.claim_item_id === targetItemId);
        if (item) {
            activeItems = [item];
            isSingleItem = true;
            
            // Use the stored fee_amount and interest_amount from the item
            const itemFee = Number(item.claim_items?.fee_amount || 0);
            const itemInterest = Number(item.claim_items?.interest_amount || 0);
            // Principal = open_amount minus the fee/interest that are part of the total
            // But open_amount already includes fee+interest in original_amount
            // So principal_open = open_amount - itemFee - itemInterest (if not yet paid)
            const principalOpen = Math.max(0, Number(item.open_amount) - itemFee - itemInterest);
            
            activeTotals = {
                current_principal_open: principalOpen,
                total_interest_open: itemInterest,
                total_fees_open: itemFee,
                total_due: Number(item.open_amount)
            };
        }
    } else {
        // For the full claim: sum fee_amount and interest_amount from all items
        let totalFees = 0;
        let totalInterest = 0;
        let totalPrincipalOpen = 0;
        items.forEach(item => {
            const openAmt = Number(item.open_amount || 0);
            const itemFee = Number(item.claim_items?.fee_amount || 0);
            const itemInterest = Number(item.claim_items?.interest_amount || 0);
            totalFees += itemFee;
            totalInterest += itemInterest;
            totalPrincipalOpen += Math.max(0, openAmt - itemFee - itemInterest);
        });
        activeTotals = {
            current_principal_open: totalPrincipalOpen,
            total_interest_open: totalInterest,
            total_fees_open: totalFees,
            total_due: totalPrincipalOpen + totalInterest + totalFees
        };
    }

    // Create text lines for formatting
    const leaseStart = claim.leases?.start_date ? formatDate(claim.leases.start_date) : 'Mietbeginn';
    let intro1, introBold, intro2;

    if (isSingleItem) {
        const desc = activeItems[0].claim_items?.description || activeItems[0].claim_items?.item_type;
        intro1 = `zwischen uns besteht seit dem ${leaseStart} ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der Position "${desc}" besteht aktuell ein Zahlungsrückstand.\n\nTrotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen.`;
        introBold = ``;
        intro2 = ``;
    } else {
        intro1 = `zwischen uns besteht seit dem ${leaseStart} ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.\n\nDie Miete ist nach § 556b Abs. 1 BGB zu Beginn, `;
        introBold = `spätestens bis zum dritten Werktag`;
        intro2 = ` des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.`;
    }
    
    // First part
    const splitIntro1 = doc.splitTextToSize(intro1, usableWidth);
    doc.text(splitIntro1, margin, yPos);
    yPos += (splitIntro1.length - 1) * 5; // Move to the last line of splitIntro1
    
    // Calculate X position at the end of intro1
    const lastLineText1 = splitIntro1[splitIntro1.length - 1];
    let currentX = margin + doc.getTextWidth(lastLineText1);
    
    if (introBold) {
        // Bold part
        doc.setFont('helvetica', 'bold');
        doc.text(introBold, currentX, yPos);
        currentX += doc.getTextWidth(introBold);
        
        // Remaining part
        doc.setFont('helvetica', 'normal');
        const intro2Words = intro2.split(' ');
        let currentLine = '';
        for (let word of intro2Words) {
            if (word === '') continue;
            const wordWithSpace = currentLine.length === 0 && word.startsWith(',') ? word : ' ' + word;
            if (currentX + doc.getTextWidth(currentLine + wordWithSpace) > margin + usableWidth) {
                doc.text(currentLine, currentX, yPos);
                yPos += 5;
                currentX = margin;
                currentLine = word; // Start new line
            } else {
                currentLine += wordWithSpace;
            }
        }
        if (currentLine) {
            doc.text(currentLine, currentX, yPos);
            yPos += 10;
        }
    } else {
        yPos += 10;
    }
    
    // Render call to action
    const splitCall = doc.splitTextToSize(callToAction, usableWidth);
    doc.text(splitCall, margin, yPos);
    yPos += splitCall.length * 5 + 10;

    // Forderungszusammenfassung Table
    autoTable(doc, {
        startY: yPos,
        margin: { left: margin },
        tableWidth: usableWidth * 0.8,
        theme: 'plain',
        body: [
            ['Miet-/Betriebskosten-/Heizkostenrückstand', formatCurrency(activeTotals.current_principal_open)],
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

    yPos = doc.lastAutoTable.finalY + 15;
    
    // Check space for the Bank and Deadline block (needs approx 50mm)
    if (yPos + 50 > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
    }

    // Zahlungsfrist & Bank
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + parseInt(deadlineDays));
    const nextDay = new Date(deadlineDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const introBank = `Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von ${formatCurrency(activeTotals.total_due)} spätestens bis zum ${deadlineDate.toLocaleDateString('de-DE')} auf folgendes Konto:`;
    const splitIntroBank = doc.splitTextToSize(introBank, usableWidth);
    doc.text(splitIntroBank, margin, yPos);
    yPos += splitIntroBank.length * 5 + 5;

    // Determine bank data
    const bankName = portfolio?.bank_name || profile?.bank_name;
    const iban = portfolio?.iban || profile?.iban;
    const bic = portfolio?.bic || profile?.bic;
    const vwz = `Mietrückstand ${prop.street || ''}`;

    doc.setFont('helvetica', 'bold');
    if (iban && iban.trim() !== '') {
        doc.text(`Kontoinhaber: ${senderName}`, margin, yPos);
        yPos += 5;
        if (bankName) {
            doc.text(`Bank: ${bankName}`, margin, yPos);
            yPos += 5;
        }
        doc.text(`IBAN: ${iban}`, margin, yPos);
        yPos += 5;
        if (bic) {
            doc.text(`BIC: ${bic}`, margin, yPos);
            yPos += 5;
        }
        doc.text(`Verwendungszweck: ${vwz}`, margin, yPos);
        yPos += 10;
    } else {
        doc.text(`Bitte überweisen Sie den offenen Betrag auf das Ihnen bekannte Bankkonto.`, margin, yPos);
        yPos += 5;
        doc.text(`Verwendungszweck: ${vwz}`, margin, yPos);
        yPos += 15;
    }
    
    doc.setFont('helvetica', 'normal');
    const warningBank = `Bitte beachten Sie, dass ab dem ${nextDay.toLocaleDateString('de-DE')} weitere Verzugszinsen bis zum vollständigen Zahlungseingang entstehen können.`;
    const splitWarningBank = doc.splitTextToSize(warningBank, usableWidth);
    doc.text(splitWarningBank, margin, yPos);
    yPos += splitWarningBank.length * 5 + 10;

    // Legal Text
    const paragraphs = legalText.split('\n\n');
    for (const p of paragraphs) {
        if (p.includes('fristlosen Kündigung')) {
            doc.setFont('helvetica', 'bold');
        } else {
            doc.setFont('helvetica', 'normal');
        }
        const splitP = doc.splitTextToSize(p, usableWidth);
        
        // Check if paragraph fits on page, else new page
        if (yPos + splitP.length * 5 > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
        }
        doc.text(splitP, margin, yPos);
        yPos += splitP.length * 5 + 5;
    }
    doc.setFont('helvetica', 'normal');
    yPos += 5;

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
        head: [['Position', 'Sollmiete', 'Zahlung / Anrechnung', 'Offener Betrag']],
        body: activeItems.map(item => [
            item.claim_items?.description || item.claim_items?.item_type || 'Forderung',
            formatCurrency(item.original_amount),
            item.paid_principal > 0 ? formatCurrency(item.paid_principal) : '0,00 €',
            formatCurrency(item.open_amount)
        ]),
        foot: [['Summe offener Miet-/Betriebskosten-/Heizkostenbetrag', '', '', formatCurrency(activeTotals.current_principal_open)]],
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

    const endDate = new Date();
    const interestRate = claim.interest_rate || 5.0;
    let totalCalculatedInterest = 0;

    const interestBody = activeItems.filter(item => Number(item.open_amount) > 0).map(item => {
        // Use due_date from claim_items first, then period_month, then claim interest_start_date
        let fM = new Date(item.claim_items?.due_date || item.claim_items?.period_month || claim.interest_start_date || new Date());
        if (fM > endDate) fM = endDate;

        const diffTime = Math.max(0, endDate - fM);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const itemInterest = (Number(item.open_amount) * interestRate * diffDays) / (100 * 365);
        totalCalculatedInterest += itemInterest;

        return [
            item.claim_items?.description || item.claim_items?.item_type || 'Forderung',
            formatCurrency(item.open_amount),
            `${fM.toLocaleDateString('de-DE')} - ${endDate.toLocaleDateString('de-DE')}`,
            diffDays.toString(),
            formatCurrency(itemInterest)
        ];
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
        foot: [['Summe berechneter Verzugszinsen', '', '', '', formatCurrency(totalCalculatedInterest)]],
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
