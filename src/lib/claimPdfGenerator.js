import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { supabase } from './supabase';

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('de-DE');
};

export const generateClaimPdf = async (claim, totals, items, documentType, deadlineDays, internalNote) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
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
    // Fallback tenant address to property address if tenant address is missing
    const prop = claim.leases?.units?.properties || {};
    const tenantStreet = tenant.street ? `${tenant.street} ${tenant.house_number || ''}`.trim() : `${prop.street || ''} ${prop.house_number || ''}`.trim();
    const tenantCity = tenant.zip ? `${tenant.zip} ${tenant.city || ''}`.trim() : `${prop.zip || ''} ${prop.city || ''}`.trim();

    // Setup Fonts
    doc.setFont('helvetica');

    // 1. Interner Titel Oben Links
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    const internalTitle = `${documentType} Zahlungsverzug ${tenantName}`;
    doc.text(internalTitle, margin, yPos);
    yPos += 15;

    // 2. Absenderzeile
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(senderLine, margin, yPos);
    yPos += 2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.line(margin, yPos, margin + 70, yPos);
    yPos += 10;

    // 3. Empfängerblock
    doc.setFontSize(11);
    if (tenant.company) {
        doc.text('Firma', margin, yPos);
        yPos += 5;
        doc.text(tenant.company, margin, yPos);
    } else {
        doc.text('Herrn/Frau', margin, yPos);
        yPos += 5;
        doc.text(tenantName, margin, yPos);
    }
    yPos += 5;
    doc.text(tenantStreet, margin, yPos);
    yPos += 5;
    doc.text(tenantCity, margin, yPos);

    // 4. Ort, Datum rechts
    doc.setFontSize(11);
    const docDate = new Date();
    const dateStr = docDate.toLocaleDateString('de-DE');
    const placeDate = `${profile?.city || 'Ort'}, den ${dateStr}`;
    doc.text(placeDate, pageWidth - margin - doc.getTextWidth(placeDate), yPos);
    yPos += 25;

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
    
    // Create text lines for formatting
    const introText = `zwischen uns besteht seit dem Mietbeginn ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.\n\nDie Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.\n\n${callToAction}`;
    
    const splitIntro = doc.splitTextToSize(introText, usableWidth);
    doc.text(splitIntro, margin, yPos);
    yPos += splitIntro.length * 5 + 10;

    // Forderungszusammenfassung Table
    doc.autoTable({
        startY: yPos,
        margin: { left: margin },
        tableWidth: usableWidth * 0.8,
        theme: 'plain',
        body: [
            ['Miet-/Betriebskosten-/Heizkostenrückstand', formatCurrency(totals.current_principal_open)],
            [`Verzugszinsen bis einschließlich ${dateStr}`, formatCurrency(totals.total_interest_open)],
            ['Mahnauslagen für dieses Schreiben', formatCurrency(totals.total_fees_open)]
        ],
        columnStyles: {
            0: { fontStyle: 'normal', textColor: [0, 0, 0] },
            1: { halign: 'right', fontStyle: 'normal', textColor: [0, 0, 0] }
        },
        styles: { fontSize: 11, cellPadding: 2 }
    });
    
    yPos = doc.lastAutoTable.finalY;
    
    doc.autoTable({
        startY: yPos,
        margin: { left: margin },
        tableWidth: usableWidth * 0.8,
        theme: 'plain',
        body: [
            [`Gesamtforderung zum ${dateStr}`, formatCurrency(totals.total_due)]
        ],
        columnStyles: {
            0: { fontStyle: 'bold', textColor: [0, 0, 0] },
            1: { halign: 'right', fontStyle: 'bold', textColor: [0, 0, 0] }
        },
        styles: { fontSize: 11, cellPadding: 2 }
    });

    yPos = doc.lastAutoTable.finalY + 15;

    // Zahlungsfrist & Bank
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + parseInt(deadlineDays));
    const nextDay = new Date(deadlineDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const bankText = `Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von ${formatCurrency(totals.total_due)} spätestens bis zum ${deadlineDate.toLocaleDateString('de-DE')} auf folgendes Konto:\n\nKontoinhaber: ${senderName}\nIBAN: ${profile?.iban || '—'}\nBIC: ${profile?.bic || '—'}\nVerwendungszweck: Mietrückstand ${prop.street || ''}\n\nBitte beachten Sie, dass ab dem ${nextDay.toLocaleDateString('de-DE')} weitere Verzugszinsen bis zum vollständigen Zahlungseingang entstehen können.`;
    const splitBank = doc.splitTextToSize(bankText, usableWidth);
    doc.text(splitBank, margin, yPos);
    yPos += splitBank.length * 5 + 10;

    // Legal Text
    const splitLegal = doc.splitTextToSize(legalText, usableWidth);
    
    // Check if legal text fits on page, else new page
    if (yPos + splitLegal.length * 5 > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
    }

    doc.text(splitLegal, margin, yPos);
    yPos += splitLegal.length * 5 + 15;

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

    doc.autoTable({
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [['Monat', 'Sollmiete', 'Zahlung / Anrechnung', 'Offener Betrag']],
        body: items.map(item => [
            formatDate(item.claim_items?.period_month),
            formatCurrency(item.original_amount),
            item.paid_principal > 0 ? formatCurrency(item.paid_principal) : '—',
            formatCurrency(item.open_amount)
        ]),
        foot: [['Summe offener Miet-/Betriebskosten-/Heizkostenbetrag', '', '', formatCurrency(totals.current_principal_open)]],
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
    const zinsText = `Berechnet wurden Verzugszinsen nach § 288 Abs. 1 BGB mit fünf Prozentpunkten über dem jeweiligen Basiszinssatz. Für die Berechnung wurde der im System hinterlegte Zinssatz von ${claim.interest_rate}% p.a. verwendet.`;
    const splitZins = doc.splitTextToSize(zinsText, usableWidth);
    doc.text(splitZins, margin, currentY);
    currentY += splitZins.length * 5 + 5;

    // Calculate days for the simple representation
    const startDate = claim.interest_start_date ? new Date(claim.interest_start_date) : new Date();
    const endDate = new Date();
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    doc.autoTable({
        startY: currentY,
        margin: { left: margin, right: margin },
        head: [['Monat', 'Verzinslicher Betrag', 'Zeitraum', 'Tage', 'Zinsen']],
        body: [
            [
                'Gesamte Hauptforderung',
                formatCurrency(totals.current_principal_open),
                `${startDate.toLocaleDateString('de-DE')} - ${endDate.toLocaleDateString('de-DE')}`,
                diffDays.toString(),
                formatCurrency(totals.total_interest_open)
            ]
        ],
        foot: [['Summe Verzugszinsen bis einschließlich ' + endDate.toLocaleDateString('de-DE'), '', '', '', formatCurrency(totals.total_interest_open)]],
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

    doc.autoTable({
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
        principal_snapshot: totals.current_principal_open,
        fees_snapshot: totals.total_fees_open,
        interest_snapshot: totals.total_interest_open,
        total_snapshot: totals.total_due,
        deadline: deadlineDate.toISOString(),
        document_path: fileName,
        document_sha256: document_sha256,
        template_reference: "Abmahnung_Zahlungsverzug_Marco_Weber_2026-05-19(1).docx"
    };

    // Save to claim_events
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

    // Optional: Upload to Supabase Storage if a bucket exists
    // const { error: uploadError } = await supabase.storage.from('claims_documents').upload(`${claim.id}/${fileName}`, pdfBlob);

    return { fileName, eventMetadata };
};
