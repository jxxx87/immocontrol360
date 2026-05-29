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
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Zahlungserinnerung zu offenen Mietforderungen</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Bezüglich der offenen Posten besteht aktuell ein Zahlungsrückstand.</p><p>Trotz Fälligkeit wurde die nachfolgend aufgeführte Forderung nicht vollständig ausgeglichen. Bitte prüfen Sie den Vorgang und gleichen Sie den offenen Betrag aus.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_1: {
        subject: 'Mahnung wegen Mietrückstand',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Mahnung wegen Mietrückstand</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_2: {
        subject: 'Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Abmahnung und Zahlungsaufforderung wegen Zahlungsverzug</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag" data-label="Offener Betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Aufgrund der Höhe des Rückstands kann zudem die Prüfung einer außerordentlichen fristlosen Kündigung gemäß § 543 Abs. 2 Nr. 3 BGB, hilfsweise einer ordentlichen Kündigung, in Betracht kommen. Für Wohnraummietverhältnisse sind zusätzlich die Regelungen des § 569 BGB zu beachten.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    },
    dunning_final: {
        subject: 'Letzte Zahlungsaufforderung vor weiteren Schritten',
        content_html: `<div class="letter-page"><div class="letter-sender"><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span> · <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span></div><div class="letter-header-row"><div class="letter-recipient">Herrn/Frau<br><strong><span data-type="mention" data-id="mieter_name" data-label="Mieter Name">Mieter Name</span></strong><br><span data-type="mention" data-id="mieter_adresse" data-label="Mieter Adresse">Mieter Adresse</span></div><div class="letter-date">Ort, den <span data-type="mention" data-id="rechnungsdatum" data-label="Rechnungsdatum">Rechnungsdatum</span></div></div><div class="letter-subject">Letzte Zahlungsaufforderung vor weiteren Schritten</div><div class="letter-object">Mietobjekt: <span data-type="mention" data-id="objekt_adresse" data-label="Objekt-Adresse">Objekt-Adresse</span> (Einheit: <span data-type="mention" data-id="einheit_name" data-label="Wohneinheit">Wohneinheit</span>)</div><div class="letter-body"><p>Sehr geehrte/r <span data-type="mention" data-id="mieter_anrede" data-label="Sehr geehrte/r ...">Sehr geehrte/r ...</span>,</p><p>zwischen uns besteht seit dem <span data-type="mention" data-id="nutzungszeitraum" data-label="Nutzungszeitraum">Mietbeginn</span> ein Mietverhältnis über die oben bezeichnete Mietwohnung. Nach der Zahlungsübersicht sind Mietforderungen bislang offen.</p><p>Die Miete ist nach § 556b Abs. 1 BGB zu Beginn, spätestens bis zum dritten Werktag des jeweiligen Monats, zu entrichten. Trotz Fälligkeit wurden die nachfolgend aufgeführten Mietforderungen nicht vollständig ausgeglichen.</p><p>Ich mahne Sie hiermit ausdrücklich wegen Zahlungsverzuges ab und fordere Sie auf, den unten genannten Gesamtbetrag vollständig auszugleichen.</p><p><span data-type="mention" data-id="forderungs_tabelle" data-label="Forderungstabelle">Forderungstabelle</span></p><p>Zahlungsfrist: Bitte zahlen Sie den Gesamtbetrag in Höhe von <span data-type="mention" data-id="offener_betrag">Offener Betrag</span> spätestens bis zum <span data-type="mention" data-id="zahlungsfrist_datum" data-label="Fälligkeitsdatum">Fälligkeitsdatum</span> auf folgende Bankverbindung:</p><p><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></p><p>Sollte der vorgenannte Betrag nicht vollständig und fristgerecht eingehen, behalte ich mir vor, weitere rechtliche Schritte einzuleiten, insbesondere die Beantragung eines gerichtlichen Mahnbescheids beziehungsweise die gerichtliche Geltendmachung der Forderung. Außerdem behalte ich mir vor, einen Rechtsanwalt mit der weiteren Beitreibung zu beauftragen und die hierdurch erforderlichen Rechtsverfolgungskosten geltend zu machen.</p><p>Sollten Sie die Forderung ganz oder teilweise bestreiten, teilen Sie mir dies bitte innerhalb der oben genannten Frist schriftlich unter Vorlage geeigneter Zahlungsnachweise mit.</p><p>Mit freundlichen Grüßen,</p><p><strong><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></strong></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div><div class="letter-page"><div class="letter-subject" style="font-size: 12pt; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10mm;">Anlage zur Mahnung: Forderungsaufstellung &amp; Informationen</div><div class="letter-body"><p>Nachfolgend finden Sie die detaillierte Aufstellung der offenen Forderungen sowie Zinsen und Mahngebühren:</p><p><span data-type="mention" data-id="forderungs_detail_tabelle" data-label="Detaillierte Forderungstabelle">Detaillierte Forderungstabelle</span></p></div><div class="letter-footer"><div class="footer-col"><strong>Anschrift</strong><br><span data-type="mention" data-id="vermieter_name" data-label="Vermieter Name">Vermieter Name</span></div><div class="footer-col"><strong>Kontakt</strong><br>E-Mail: info@immocontrol.de</div><div class="footer-col"><strong>Bankverbindung</strong><br><span data-type="mention" data-id="vermieter_bankverbindung" data-label="Vermieter Bankverbindung">Vermieter Bankverbindung</span></div></div></div>`
    }
};

export const generateClaimPdf = async (claim, totals, items, documentType, deadlineDays, internalNote, targetItemId, portalLinkData) => {
    // 1. Fetch Sender Profile Data
    const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, company, street, house_number, zip, city, bank_name, iban, bic')
        .eq('id', claim.user_id)
        .single();

    const senderName = profile?.company || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Vermieter';
    const senderStreet = `${profile?.street || ''} ${profile?.house_number || ''}`.trim();
    const senderCity = `${profile?.zip || ''} ${profile?.city || ''}`.trim();
    const senderLine = `${senderName} · ${senderStreet} · ${senderCity}`;

    // 2. Fetch Tenant Data
    const tenant = claim.tenants || {};
    const tenantName = `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim();
    const prop = claim.leases?.units?.properties || {};
    const tenantStreet = `${prop.street || ''} ${prop.house_number || ''}`.trim();
    const tenantCity = `${prop.zip || ''} ${prop.city || ''}`.trim();

    // 3. Fetch Portfolio Bank Data (if available)
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

    // 4. Resolve Template Type
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

    // 5. Load Template from Supabase
    let template = DEFAULT_DUNNING_TEMPLATES[templateType];
    try {
        let query = supabase
            .from('document_templates')
            .select('*')
            .eq('type', templateType);

        if (portfolioId) {
            query = query.eq('portfolio_id', portfolioId);
        } else {
            query = query.eq('user_id', claim.user_id).is('portfolio_id', null);
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

    const docDate = new Date();
    const dateStr = docDate.toLocaleDateString('de-DE');

    // 6. Interest rate calculation
    const endDate = new Date();
    const interestRate = claim.interest_rate || 5.0;
    
    let activeItems = JSON.parse(JSON.stringify(items));
    let isSingleItem = false;
    let activeTotals = { ...totals };
    
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

    // 7. Prep details for templates
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + parseInt(deadlineDays));
    
    const bankName = portfolio?.bank_name || profile?.bank_name;
    const iban = portfolio?.iban || profile?.iban;
    const bic = portfolio?.bic || profile?.bic;
    const vwz = `Mietrückstand ${prop.street || ''}`;
    
    const bankDetailsStr = (iban && iban.trim() !== '')
        ? `Inhaber: ${senderName}, ${bankName ? 'Bank: ' + bankName + ', ' : ''}IBAN: ${iban}${bic ? ', BIC: ' + bic : ''}, Verwendungszweck: ${vwz}`
        : 'das Ihnen bekannte Bankkonto';

    const leaseStart = claim.leases?.start_date ? formatDate(claim.leases.start_date) : 'Mietbeginn';

    // 8. Generate Table HTMLs
    const summaryTableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt;">
        <thead>
            <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                <th style="padding: 6px; text-align: left;">Forderungsposition</th>
                <th style="padding: 6px; text-align: right; width: 30%;">Betrag</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">${isSingleItem ? (activeItems[0].claim_items?.description || 'Hauptforderung') : 'Offene Hauptforderungen (Miete/Nebenkosten etc.)'}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${formatCurrency(activeTotals.current_principal_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Verzugszinsen bis einschließlich ${dateStr}</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${formatCurrency(activeTotals.total_interest_open)}</td>
            </tr>
            <tr>
                <td style="padding: 6px; border-bottom: 1px solid #cbd5e1;">Mahnauslagen für dieses Schreiben</td>
                <td style="padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1;">${formatCurrency(activeTotals.total_fees_open)}</td>
            </tr>
            <tr style="border-top: 2px solid #000; border-bottom: 2px double #000; background-color: #f8fafc;">
                <td style="padding: 8px; font-weight: bold; font-size: 11pt;">Gesamtforderung zum ${dateStr}:</td>
                <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 11pt; color: #dc2626;">${formatCurrency(activeTotals.total_due)}</td>
            </tr>
        </tbody>
    </table>`;

    const interestBodyRows = [];
    let totalCalculatedInterestRef = 0;
    
    activeItems.filter(item => Number(item.open_amount) > 0).forEach(item => {
        if (item.claim_items?.interest_breakdown) {
            item.claim_items.interest_breakdown.forEach(b => {
                totalCalculatedInterestRef += b.interest;
                interestBodyRows.push([
                    b.description,
                    formatCurrency(b.amount),
                    `${new Date(b.fM).toLocaleDateString('de-DE')} - ${endDate.toLocaleDateString('de-DE')}`,
                    b.diffDays.toString(),
                    formatCurrency(b.interest)
                ]);
            });
        }
    });

    if (interestBodyRows.length === 0) {
        interestBodyRows.push(['Keine offenen Beträge für Zinsberechnung', '', '', '', '0,00 €']);
    }

    const detailTableHtml = `
    <div>
        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 10px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 1: Forderungsaufstellung</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 20px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left;">Position</th>
                    <th style="padding: 5px; text-align: right; width: 22%;">Forderungsbetrag</th>
                    <th style="padding: 5px; text-align: right; width: 22%;">Zahlung / Anrechnung</th>
                    <th style="padding: 5px; text-align: right; width: 22%; font-weight: bold;">Offener Betrag</th>
                </tr>
            </thead>
            <tbody>
                ${activeItems.map(item => `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${item.claim_items?.description || item.claim_items?.item_type || 'Forderung'}</td>
                        <td style="padding: 5px; text-align: right;">${formatCurrency(item.original_amount)}</td>
                        <td style="padding: 5px; text-align: right;">${item.paid_principal > 0 ? formatCurrency(item.paid_principal) : '0,00 €'}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${formatCurrency(item.open_amount)}</td>
                    </tr>
                `).join('')}
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td style="padding: 6px;">Summe offener Hauptforderungen:</td>
                    <td></td>
                    <td></td>
                    <td style="padding: 6px; text-align: right;">${formatCurrency(activeTotals.current_principal_open)}</td>
                </tr>
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 2: Zinsberechnung</h3>
        <p style="font-size: 8.5pt; color: #475569; margin-bottom: 8px;">
            Berechnet werden dürfen Verzugszinsen nach § 288 Abs. 1 BGB mit fünf Prozentpunkten über dem jeweiligen Basiszinssatz.
            Für die Berechnung wurde aus Kulanz lediglich ein Zinssatz von ${Number(claim.interest_rate || 5.00).toFixed(2)}% p.a. verwendet.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 20px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left;">Position</th>
                    <th style="padding: 5px; text-align: right; width: 20%;">Verzinslicher Betrag</th>
                    <th style="padding: 5px; text-align: left; width: 25%;">Zeitraum</th>
                    <th style="padding: 5px; text-align: right; width: 12%;">Tage</th>
                    <th style="padding: 5px; text-align: right; width: 18%; font-weight: bold;">Zinsen</th>
                </tr>
            </thead>
            <tbody>
                ${interestBodyRows.map(row => `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px; text-align: left;">${row[0]}</td>
                        <td style="padding: 5px; text-align: right;">${row[1]}</td>
                        <td style="padding: 5px; text-align: left;">${row[2]}</td>
                        <td style="padding: 5px; text-align: right;">${row[3]}</td>
                        <td style="padding: 5px; text-align: right; font-weight: bold;">${row[4]}</td>
                    </tr>
                `).join('')}
                <tr style="border-top: 2px solid #000; font-weight: bold; background-color: #f8fafc;">
                    <td colspan="4" style="padding: 6px;">Summe berechneter Verzugszinsen:</td>
                    <td style="padding: 6px; text-align: right;">${formatCurrency(totalCalculatedInterestRef)}</td>
                </tr>
            </tbody>
        </table>

        <h3 style="font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 2px;">Anlage 3: Ablauf bei Mietrückstand und mögliche Folgekosten</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 10px;">
            <thead>
                <tr style="border-bottom: 2px solid #000; font-weight: bold; background-color: #f1f5f9;">
                    <th style="padding: 5px; text-align: left; width: 25%;">Schritt</th>
                    <th style="padding: 5px; text-align: left;">Erläuterung</th>
                    <th style="padding: 5px; text-align: left; width: 30%;">Mögliche Folgekosten</th>
                </tr>
            </thead>
            <tbody>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">1. Mietzahlung fällig</td>
                    <td style="padding: 4px;">Die Miete ist bis spätestens zum dritten Werktag des Monats zu zahlen.</td>
                    <td style="padding: 4px;">Keine Zusatzkosten bei fristgerechter Zahlung</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">2. Rückstand festgestellt</td>
                    <td style="padding: 4px;">Offene Miete wird ermittelt und tagesgenaue Verzugszinsen laufen an.</td>
                    <td style="padding: 4px;">Verzugszinsen nach § 288 BGB</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">3. Mahnung / Abmahnung</td>
                    <td style="padding: 4px;">Zahlungsfrist wird gesetzt. Die Forderung wird schriftlich beziffert.</td>
                    <td style="padding: 4px;">Auslagen für Porto/Druck</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">4. Keine fristgerechte Zahlung</td>
                    <td style="padding: 4px;">Weitere Beitreibung kann eingeleitet werden: Anwalt, Mahnbescheid oder Klage.</td>
                    <td style="padding: 4px;">Rechtsverfolgungs- und Gerichtskosten möglich</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">5. Kündigungsprüfung</td>
                    <td style="padding: 4px;">Bei erheblichem Mietrückstand kann eine fristlose, hilfsweise ordentliche Kündigung geprüft werden.</td>
                    <td style="padding: 4px;">Weitere Kostenrisiken für den Mieter</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 4px; font-weight: bold;">6. Gerichtliche Durchsetzung</td>
                    <td style="padding: 4px;">Bei weiterem Ausbleiben kann die Forderung tituliert und vollstreckt werden; bei Kündigung ggf. Räumungsklage.</td>
                    <td style="padding: 4px;">Gerichts-, Anwalts- und Vollstreckungskosten möglich</td>
                </tr>
            </tbody>
        </table>
        <div style="font-size: 8.5pt; font-weight: bold; color: #1e293b; margin-top: 8px; line-height: 1.4;">
            Wichtig: Durch vollständige und fristgerechte Zahlung können weitere Kosten und rechtliche Schritte vermieden werden.
            Die tatsächlichen Kosten hängen vom weiteren Verlauf und den gesetzlichen Gebühren ab.
        </div>
    </div>`;

    // 9. QR Code / Portal link box
    let qrBlockHtml = '';
    if (portalLinkData && portalLinkData.token && portalLinkData.pin) {
        const portalUrl = portalLinkData.link || `${window.location.origin}/forderung/portal/${portalLinkData.token}`;
        try {
            const qrDataUrl = await QRCode.toDataURL(portalUrl, { margin: 1, width: 120 });
            qrBlockHtml = `
            <div style="margin-top: 15px; margin-bottom: 15px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; text-align: center; font-size: 9.5pt; page-break-inside: avoid;">
                <div style="margin-bottom: 6px;">
                    <img src="${qrDataUrl}" style="width: 80px; height: 80px; display: inline-block;" alt="QR Code" />
                </div>
                <div style="font-weight: bold; color: #1e293b; margin-bottom: 4px; font-size: 10pt;">Online Forderungsportal</div>
                <div style="color: #475569; line-height: 1.4; max-width: 480px; margin: 0 auto 6px; font-size: 8.5pt;">
                    Sie können die aktuelle Forderung auch online einsehen und eine Ratenzahlung anfragen. Scannen Sie hierzu den QR-Code und geben Sie den unten genannten Zugangscode ein.
                </div>
                <div style="font-weight: bold; color: #1e293b; font-size: 10pt;">
                    Zugangscode (PIN): <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${portalLinkData.pin}</span>
                </div>
            </div>`;
        } catch (qrErr) {
            console.error('Failed to generate QR code for HTML print', qrErr);
        }
    }

    const localVars = {
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
        vermieter_bankverbindung: bankDetailsStr,
        rechnungsdatum: dateStr,
        forderungs_tabelle: summaryTableHtml + qrBlockHtml,
        forderungs_detail_tabelle: detailTableHtml
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

    const fullTemplateHtml = template.content_html || DEFAULT_DUNNING_TEMPLATES[templateType].content_html;
    const renderedContent = replaceHTMLVariables(fullTemplateHtml, localVars);

    // Build the final printed HTML
    const finalHtml = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${documentType} - ${tenantName}</title>
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
            .letter-page {
                margin: 0 !important;
                border: none !important;
                box-shadow: none !important;
                page-break-after: always !important;
                page-break-inside: avoid !important;
                width: 210mm !important;
                height: 297mm !important;
            }
        }
    </style></head><body style="background:#fff">
    ${renderedContent}
    </body></html>`;

    // 10. Generate file name
    const cleanTenantName = tenantName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    const dateYMD = docDate.toISOString().split('T')[0];
    const fileName = `${documentType}_Zahlungsverzug_${cleanTenantName}_${dateYMD}.pdf`;

    // 11. Render PDF using iframe + html2pdf.js to calculate SHA256 and open/download
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    iframe.style.width = '210mm';
    iframe.style.height = '297mm';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(finalHtml);
    iframe.contentDocument.close();

    const loadScript = () => new Promise((resolve) => {
        if (window.html2pdf) return resolve();
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
        script.onload = resolve;
        document.head.appendChild(script);
    });

    await loadScript();

    // Wait for iframe to render fully
    await new Promise(r => setTimeout(r, 600));

    // Generate pdf array buffer
    const pdfArrayBuffer = await window.html2pdf().set({
        margin: 10,
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(iframe.contentDocument.body).output('arraybuffer');

    document.body.removeChild(iframe);

    // Calculate SHA256
    const hashBuffer = await crypto.subtle.digest('SHA-256', pdfArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const document_sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Open PDF in new tab
    const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, '_blank');

    // Create Event Metadata Snapshot
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

    // Save/Update claim_event
    const { data: existingEvents } = await supabase
        .from('claim_events')
        .select('id, event_metadata')
        .eq('claim_id', claim.id)
        .eq('event_type', 'dunning_sent');

    const existingEvent = existingEvents?.find(e => e.event_metadata?.document_type === documentType);

    if (existingEvent) {
        const { error: updateError } = await supabase
            .from('claim_events')
            .update({
                event_date: new Date().toISOString(),
                event_metadata: eventMetadata
            })
            .eq('id', existingEvent.id);
            
        if (updateError) console.error('Error updating claim_event:', updateError);
    } else {
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

    return { fileName, eventMetadata };
};
